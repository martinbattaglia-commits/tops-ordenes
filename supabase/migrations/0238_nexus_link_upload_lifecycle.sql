-- 0238_nexus_link_upload_lifecycle.sql — NEXUS LINK · ciclo de vida de la subida.
-- ─────────────────────────────────────────────────────────────────────────
-- EL AGUJERO QUE CIERRA
--
-- El flujo de adjuntos es: `prepare` firma una URL de subida → el cliente sube
-- el binario → `finalize` lo valida y lo registra. Si el cliente sube y NUNCA
-- llama a `finalize`, el objeto queda en el bucket sin dueño y sin registro.
-- Nadie lo ve, nadie lo borra, y crece.
--
-- La limpieza ingenua —"¿existe un adjunto que lo referencie? no ⇒ borrar"— es
-- una ventana TOCTOU: entre la consulta y el borrado, otra transacción puede
-- estar finalizando ese mismo objeto, y el barrido se lleva puesto un adjunto
-- recién publicado. Consultar y después borrar NO es coordinar.
--
-- ─── CÓMO SE COORDINA DE VERDAD ───────────────────────────────────────────
--
-- Con una IDENTIDAD DE SUBIDA PENDIENTE y una máquina de estados cuya
-- transición es una comparación-e-intercambio atómica dentro de un único
-- UPDATE. Gana quien logra la transición; el otro se entera de que perdió.
--
--     pending ──(finalize gana)──▶ finalized ─────▶ terminal
--        │
--        └─────(cleanup gana)────▶ reclaiming ────▶ purged
--
--   · `pending → finalized` exige status='pending' EN EL MISMO UPDATE. Dos
--     finalize concurrentes: uno obtiene la fila, el otro no, y al no obtenerla
--     lee 'finalized' y devuelve `already_finalized` para seguir por el camino
--     idempotente en vez de romper.
--   · `pending → reclaiming` exige status='pending' y `purgeable_at < now()`.
--     Una subida VIGENTE nunca se toca.
--   · Desde 'reclaiming' o 'purged' el finalize es imposible: la CAS pide
--     'pending' y no lo va a encontrar. Un objeto marcado para limpieza no
--     puede resucitar como adjunto.
--   · Desde 'finalized' la limpieza es imposible por la misma razón.
--   · `for update skip locked` hace que dos barridos simultáneos nunca reclamen
--     la misma fila.
--
-- ─── NUNCA BORRAR POR INCERTIDUMBRE ───────────────────────────────────────
--
-- El barrido excluye toda fila cuyo objeto esté referenciado en
-- `connect_attachments`, y antes de reclamar nada AUTOCORRIGE a 'finalized'
-- cualquier pendiente que sí tenga adjunto: si hay duda, el objeto se conserva.
--
-- Si el borrado en Storage falla, la fila queda en 'reclaiming' con el contador
-- incrementado y el barrido siguiente la vuelve a tomar. El fallo es
-- REINTENTABLE y nunca se declara 'purged' algo que no se borró.
--
-- ─── IMPOSIBLE BORRAR ADJUNTOS AJENOS CON EL BARRIDO ──────────────────────
--
-- `connect_upload_reclaim_expired()` NO recibe rutas: elige sus propios
-- objetivos dentro de su tabla. No hay forma de nombrarle un blanco. Y sólo
-- puede ejecutarlo `service_role`.
--
-- ─── LA PROPIEDAD NO VIENE DEL NAVEGADOR ──────────────────────────────────
--
-- `initiated_by` es `auth.uid()` dentro de la función, nunca un valor del
-- payload. La ruta también la elige el servidor (`gen_random_uuid()`), así que
-- el cliente no controla ni quién es dueño ni dónde cae el objeto. Conocer una
-- ruta ajena no habilita nada: la CAS exige `initiated_by = auth.uid()` Y
-- `conversation_id` coincidente.
--
-- ─── Y ADEMÁS, ESTRUCTURALMENTE ───────────────────────────────────────────
--
-- Un trigger `before insert` en `connect_attachments` rechaza cualquier adjunto
-- cuya subida pendiente no esté 'finalized', o pertenezca a otra conversación,
-- o a otro usuario. Si el código de aplicación se equivocara, la base no lo
-- acompaña. El trigger es INERTE para rutas sin registro pendiente (audio y
-- adjuntos previos a esta migración): no rompe nada existente.
--
-- ─── DOS VENTANAS, NO UNA, Y LA SEGUNDA ES DERIVADA ───────────────────────
--
-- `finalize_deadline` (corta, 30 min por defecto) cierra el finalize.
-- `purgeable_at` habilita el borrado, y NO es un número elegido a ojo: sale del
-- vencimiento real del token de subida más un margen explícito.
--
-- POR QUÉ HACE FALTA LA SEGUNDA VENTANA. Borrar el objeto mientras el token de
-- subida sigue vivo dejaría que una subida tardía cayera en una ranura ya
-- purgada: el objeto reaparece sin registro y nadie lo vuelve a mirar.
--
-- VIDA DEL TOKEN — VERIFICADA POR CONTRATO, NO SUPUESTA. `createSignedUploadUrl()`
-- no acepta parámetro de expiración: verificado leyendo `@supabase/storage-js`
-- 2.106.2, donde la llamada no envía ninguno. El valor lo fija el servicio, y la
-- referencia oficial de Supabase lo declara de forma explícita y concordante en
-- sus tres SDK —JavaScript, Dart y Python—: «Signed upload URLs … are valid for
-- 2 hours». De ahí `UPLOAD_URL_TTL = 7200 s`.
--
--   HECHO VERIFICADO   la vida del token es 7200 s, por contrato documentado.
--   NO MEDIDO          no se acuñó un token contra el servicio productivo para
--                      leerle el `exp`: eso habría exigido la service_role, y el
--                      contrato ya responde la pregunta sin tocar credenciales.
--
-- El TTL se GUARDA POR FILA (`upload_url_ttl_seconds`), no se hornea en la
-- función: si Supabase cambiara el contrato, las filas viejas siguen siendo
-- auditables con el valor bajo el que nacieron.
--
-- LA GARANTÍA ES ESTRUCTURAL, NO DE CÁLCULO. El CHECK
-- `purgeable_at >= created_at + upload_url_ttl_seconds` hace IMPOSIBLE que
-- exista una fila cuya ventana de purga se abra mientras su token puede seguir
-- vivo. No depende de que la función calcule bien: no hay forma de escribir esa
-- fila. Y como segunda barrera independiente, aunque un objeto reapareciera,
-- jamás podría volverse adjunto — la CAS exige 'pending' y el trigger de (6)
-- exige 'finalized'.
--
-- ─── ALINEACIÓN DE MIME DEL BUCKET ────────────────────────────────────────
--
-- Medido en producción (2026-08-14): `connect-files` acepta 25 MiB y una lista
-- blanca de 13 MIME que NO incluye HEIC ni PPTX, mientras el validador de la
-- aplicación sí los acepta. Es la misma divergencia dos veces: el archivo se
-- rechazaría en la carga con un error opaco. Se agregan exactamente esos tres
-- (`image/heic`, `image/heif`, PPTX) y ninguno más.
--
-- `text/plain` y `text/csv` quedan en el bucket pero el validador los RECHAZA
-- por no tener firma binaria. La divergencia es fail-closed —la aplicación es
-- más estricta que el bucket— y se deja anotada en vez de tocarla, porque
-- angostar el bucket no era lo pedido.
--
-- Rollback: ROLLBACK_0238_nexus_link_upload_lifecycle.sql
-- ─────────────────────────────────────────────────────────────────────────

-- ═══ (1) Identidad de subida pendiente ═══

create table if not exists public.connect_pending_uploads (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.connect_conversations(id) on delete cascade,
  channel           public.connect_conversation_kind_t not null,
  storage_bucket    text not null,
  storage_path      text not null,
  initiated_by      uuid not null,
  status            text not null default 'pending',
  created_at        timestamptz not null default now(),
  finalize_deadline timestamptz not null,
  purgeable_at      timestamptz not null,
  -- Vida del token de subida bajo la que nació esta fila. Se persiste para que
  -- el invariante de abajo sea verificable fila por fila.
  upload_url_ttl_seconds integer not null,
  finalized_at      timestamptz,
  reclaimed_at      timestamptz,
  purged_at         timestamptz,
  reclaim_attempts  integer not null default 0,
  constraint connect_pending_uploads_status_ck
    check (status in ('pending','finalized','reclaiming','purged')),
  -- EL invariante: la purga no puede habilitarse antes de que el token muera.
  -- Es una regla de la TABLA, así que ninguna función —presente o futura—
  -- puede saltearla por error de cálculo.
  constraint connect_pending_uploads_purge_after_token_ck
    check (purgeable_at >= created_at + make_interval(secs => upload_url_ttl_seconds)),
  constraint connect_pending_uploads_ttl_ck
    check (upload_url_ttl_seconds between 60 and 86400),
  constraint connect_pending_uploads_object_uk unique (storage_bucket, storage_path)
);

comment on table public.connect_pending_uploads is
  'Nexus Link · identidad de subida pendiente. Coordina finalize y limpieza por transición de estado atómica; no es un registro de adjuntos.';

create index if not exists connect_pending_uploads_barrido_idx
  on public.connect_pending_uploads (status, purgeable_at);
create index if not exists connect_pending_uploads_conv_idx
  on public.connect_pending_uploads (conversation_id, initiated_by);

-- La tabla NO se expone por la API: nadie la lee ni la escribe directamente.
-- Todo pasa por las funciones de abajo, que son las que aplican la máquina de
-- estados. RLS activa como segunda barrera, sin ninguna policy permisiva.
alter table public.connect_pending_uploads enable row level security;
revoke all on table public.connect_pending_uploads from public, anon, authenticated;

-- ═══ (2) Apertura: la identidad la crea el servidor ═══

create or replace function public.connect_upload_begin(
  p_conversation_id uuid,
  p_bucket text default 'connect-files',
  p_finalize_ttl_seconds integer default 1800
)
-- Los parámetros de salida NO se llaman como las columnas a propósito: en
-- PL/pgSQL un OUT homónimo puede capturar una referencia y el error aparecería
-- recién en ejecución.
returns table (upload_id uuid, object_path text, deadline timestamptz)
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_kind public.connect_conversation_kind_t;
  v_cap  text;
  -- Ventana corta y acotada por los dos lados: ni un minuto, ni una hora.
  v_ttl  integer := least(greatest(coalesce(p_finalize_ttl_seconds, 1800), 60), 3600);
  -- Vida del token de subida, por contrato de Supabase (2 h). NO es parámetro:
  -- si el llamador pudiera achicarlo, podría abrir la ventana de purga mientras
  -- su propio token sigue vivo, que es exactamente lo que hay que impedir.
  v_url_ttl constant integer := 7200;
  -- Margen explícito por desfasaje de reloj y peticiones en vuelo.
  v_margen  constant integer := 1800;
  v_path text;
  v_id   uuid;
  v_dl   timestamptz;
  v_purge timestamptz;
begin
  if v_user is null then
    raise exception 'Sin sesión.' using errcode = '42501';
  end if;
  if p_bucket is distinct from 'connect-files' then
    raise exception 'Bucket no admitido.' using errcode = '22023';
  end if;

  select c.kind into v_kind
    from public.connect_conversations c
   where c.id = p_conversation_id;

  -- Un solo mensaje para inexistente, no-miembro y canal denegado: el error no
  -- puede servir de oráculo para saber si un hilo existe o de qué canal es.
  if v_kind is null
     or not public._connect_is_member(p_conversation_id)
     or not public._connect_channel_allowed(p_conversation_id) then
    raise exception 'No tenés acceso a esta conversación.' using errcode = '42501';
  end if;

  v_cap := case when v_kind = 'whatsapp'
                then 'nexus_link.whatsapp.media'
                else 'nexus_link.internal_chat.media' end;
  if not public.nexus_link_can(v_cap) then
    raise exception 'No tenés acceso a esta conversación.' using errcode = '42501';
  end if;

  -- Ruta elegida por el SERVIDOR. El primer segmento es la conversación, que es
  -- lo que la policy de storage de 0237 exige que coincida con el adjunto.
  v_path := p_conversation_id::text || '/files/' || gen_random_uuid()::text;
  v_dl := now() + make_interval(secs => v_ttl);
  -- La purga se cuenta desde el NACIMIENTO de la fila —que es cuando nace el
  -- token—, no desde el cierre del finalize: son dos relojes distintos y sólo
  -- el primero gobierna la vida del token.
  v_purge := greatest(v_dl, now() + make_interval(secs => v_url_ttl + v_margen));

  insert into public.connect_pending_uploads (
    conversation_id, channel, storage_bucket, storage_path,
    initiated_by, status, finalize_deadline, purgeable_at, upload_url_ttl_seconds
  ) values (
    p_conversation_id, v_kind, p_bucket, v_path,
    v_user, 'pending', v_dl, v_purge, v_url_ttl
  )
  returning id into v_id;

  return query select v_id, v_path, v_dl;
end;
$fn$;

revoke all on function public.connect_upload_begin(uuid, text, integer) from public, anon;
grant execute on function public.connect_upload_begin(uuid, text, integer) to authenticated;

-- ═══ (3) Transición bloqueante hacia 'finalized' ═══

create or replace function public.connect_upload_claim_finalize(
  p_conversation_id uuid,
  p_bucket text,
  p_path text
)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
  v_row  public.connect_pending_uploads%rowtype;
begin
  if v_user is null then
    raise exception 'Sin sesión.' using errcode = '42501';
  end if;

  -- LA transición. Todas las condiciones viven dentro del mismo UPDATE, así que
  -- la decisión y la escritura son el mismo acto: no hay ventana entre "está
  -- pendiente" y "lo tomo". Sólo una llamada puede obtener la fila.
  update public.connect_pending_uploads u
     set status = 'finalized', finalized_at = now()
   where u.storage_bucket = p_bucket
     and u.storage_path = p_path
     and u.conversation_id = p_conversation_id
     and u.initiated_by = v_user
     and u.status = 'pending'
     and u.finalize_deadline > now()
  returning u.id into v_id;

  if v_id is not null then
    return 'claimed';
  end if;

  select * into v_row
    from public.connect_pending_uploads u
   where u.storage_bucket = p_bucket and u.storage_path = p_path;

  -- Perdió la carrera contra un finalize gemelo: la operación YA está hecha, y
  -- el llamador debe seguir por el camino idempotente en vez de fallar.
  if found
     and v_row.status = 'finalized'
     and v_row.conversation_id = p_conversation_id
     and v_row.initiated_by = v_user then
    return 'already_finalized';
  end if;

  -- Todo lo demás —inexistente, de otro usuario, de otra conversación, vencida,
  -- ya reclamada para limpieza— responde igual: el llamador no aprende nada.
  return 'denied';
end;
$fn$;

revoke all on function public.connect_upload_claim_finalize(uuid, text, text) from public, anon;
grant execute on function public.connect_upload_claim_finalize(uuid, text, text) to authenticated;

-- ═══ (4) Barrido de pendientes vencidas ═══

create or replace function public.connect_upload_reclaim_expired(p_limit integer default 100)
returns table (upload_id uuid, bucket_id text, object_path text)
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
begin
  -- (a) AUTOCORRECCIÓN ANTES DE BORRAR NADA. Si una pendiente tiene adjunto
  --     registrado, la subida se completó aunque su estado diga otra cosa. Se
  --     la promueve a 'finalized' y queda fuera del barrido para siempre.
  --
  --     Con el trigger de (6) activo este caso no debería darse por el camino
  --     normal —un adjunto no puede insertarse sobre una subida no finalizada—,
  --     y justamente por eso se conserva: es la red que queda si alguien
  --     desactivara el trigger o escribiera por un camino que lo saltee. Ante
  --     la duda, el objeto se conserva.
  update public.connect_pending_uploads u
     set status = 'finalized', finalized_at = coalesce(u.finalized_at, now())
   where u.status in ('pending','reclaiming')
     and exists (
       select 1 from public.connect_attachments a
        where a.storage_bucket = u.storage_bucket
          and a.storage_path = u.storage_path);

  -- (b) Reclamo atómico. `skip locked` impide que dos barridos concurrentes
  --     tomen la misma fila. Se incluyen las 'reclaiming' para que un borrado
  --     de Storage que falló vuelva a intentarse en la pasada siguiente.
  return query
  with reclamadas as (
    update public.connect_pending_uploads u
       set status = 'reclaiming',
           reclaimed_at = now(),
           reclaim_attempts = u.reclaim_attempts + 1
     where u.id in (
       select s.id
         from public.connect_pending_uploads s
        where s.status in ('pending','reclaiming')
          and s.purgeable_at < now()
          and not exists (
            select 1 from public.connect_attachments a
             where a.storage_bucket = s.storage_bucket
               and a.storage_path = s.storage_path)
        order by s.purgeable_at
          for update skip locked
        limit v_lim)
    returning u.id, u.storage_bucket, u.storage_path)
  select r.id, r.storage_bucket, r.storage_path from reclamadas r;
end;
$fn$;

-- Sólo el proceso de mantenimiento. Un usuario autenticado NO puede barrer.
revoke all on function public.connect_upload_reclaim_expired(integer) from public, anon, authenticated;
grant execute on function public.connect_upload_reclaim_expired(integer) to service_role;

-- ═══ (5) Cierre del barrido: sólo tras un borrado efectivo ═══

create or replace function public.connect_upload_mark_purged(p_upload_id uuid)
returns boolean
language sql volatile security definer set search_path = public, pg_temp
as $fn$
  with hecho as (
    update public.connect_pending_uploads u
       set status = 'purged', purged_at = now()
     where u.id = p_upload_id
       and u.status = 'reclaiming'
    returning 1)
  select exists (select 1 from hecho);
$fn$;

revoke all on function public.connect_upload_mark_purged(uuid) from public, anon, authenticated;
grant execute on function public.connect_upload_mark_purged(uuid) to service_role;

-- ═══ (6) La atadura estructural: adjunto ⇄ subida finalizada ═══

create or replace function public._connect_attachment_requires_finalized_upload()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_row public.connect_pending_uploads%rowtype;
begin
  select * into v_row
    from public.connect_pending_uploads u
   where u.storage_bucket = new.storage_bucket
     and u.storage_path = new.storage_path;

  -- Sin registro pendiente el trigger es INERTE: audio y todo lo anterior a
  -- esta migración siguen funcionando exactamente igual.
  if not found then
    return new;
  end if;

  if v_row.status <> 'finalized' then
    raise exception 'La subida no está finalizada.' using errcode = '42501';
  end if;
  if v_row.conversation_id <> new.conversation_id then
    raise exception 'La subida pertenece a otra conversación.' using errcode = '42501';
  end if;
  if new.uploaded_by is not null and v_row.initiated_by <> new.uploaded_by then
    raise exception 'La subida pertenece a otro usuario.' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists connect_attachments_upload_binding on public.connect_attachments;
create trigger connect_attachments_upload_binding
  before insert on public.connect_attachments
  for each row execute function public._connect_attachment_requires_finalized_upload();

-- ═══ (7) Alineación de MIME del bucket ═══

update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg','image/png','image/webp','image/gif',
     'image/heic','image/heif',                                   -- ← alineado
     'application/pdf','text/plain','text/csv',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation', -- ← alineado
     'audio/webm','audio/mp4','audio/ogg','audio/mpeg'
   ]
 where id = 'connect-files';

notify pgrst, 'reload schema';

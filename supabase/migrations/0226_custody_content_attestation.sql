-- =========================================================================
-- 0226 · CUSTODIA IA — ATESTACIÓN SERVER-SIDE DEL CONTENIDO Y ANTI-REPLAY (M2)
--
-- Depende de: 0036 (custody_events / custody_evidence / hash-chain) · 0037 ·
--             0038 · 0222 (política única de acceso, attach_custody_evidence) ·
--             0224 · 0225
--
-- FORWARD-ONLY. No edita ninguna migración histórica: 0036–0039 y 0221–0225
-- quedan byte-invariantes.
--
-- ─── DEFECTO REMEDIADO (DB-C4 · W22 · M-2) ────────────────────────────────
--
-- `attach_custody_evidence` (0038, reemplazada en 0222) recibe `p_sha256` del
-- llamador y lo pliega en la hash-chain como si fuera la identidad del
-- contenido. El adaptador de aplicación calculaba ese digest sobre el buffer
-- que le llegó en el `FormData` y NUNCA releía el objeto efectivamente
-- almacenado. Consecuencias, ambas explotables:
--
--   1. el digest no acredita los bytes guardados, sino los que el proceso creyó
--      subir — un objeto distinto en Storage produce el mismo evento «válido»;
--   2. la MISMA fotografía subida a otro `path` genera otra evidencia, con otro
--      `id` y el mismo contenido, y podía acreditar una segunda inspección.
--
-- Un `unique (sha256)` no arregla nada de esto mientras el digest siga siendo
-- declarado por el caller: bastaría declarar un digest distinto.
--
-- ─── FRONTERA DE CONFIANZA QUE ESTABLECE ESTA MIGRACIÓN ───────────────────
--
-- La DB deja de creerle al caller y pasa a exigir una ATESTACIÓN emitida por el
-- rol interno de servidor, que es el único que puede releer el objeto de
-- Storage. La atestación ata bucket, path, digest, tamaño, actor, sesión,
-- tenant, entidad, etapa, tipo de evento e instante server-side; es privada,
-- de un solo uso y caduca.
--
-- La DB no puede leer Storage: lo que garantiza es que NINGÚN camino acepta una
-- inspección humana sin una atestación emitida por el servidor, y que el digest
-- que entra a la cadena es el ATESTADO, jamás el del parámetro. La lectura real
-- de los bytes es responsabilidad del adaptador server-side, y esta migración
-- la vuelve obligatoria al negarse a operar sin su producto.
-- =========================================================================

-- =========================================================================
-- 1) ATESTACIÓN DE CONTENIDO — privada, de un solo uso, caduca
-- =========================================================================
create table if not exists public.custody_content_attestations (
  id uuid primary key default gen_random_uuid(),
  bucket text not null
    check (bucket in ('custody-evidence','custody-pii','custody-pod')),
  storage_path text not null,
  -- Digest calculado por el servidor sobre los bytes REALMENTE almacenados.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  -- Vínculo con quién y con qué: una atestación no es un cupón al portador.
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  client_id uuid not null,
  scope text not null check (scope in ('packing_unit','shipment')),
  entity_id uuid not null,
  stage public.custody_stage_t not null,
  event_type public.custody_event_type_t not null,
  attested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_evidence_id uuid references public.custody_evidence(id) on delete restrict,
  revoked_at timestamptz,
  -- Un objeto de Storage se atesta UNA vez: dos atestaciones sobre el mismo
  -- (bucket, path) serían dos verdades sobre el mismo archivo.
  constraint custody_content_attestations_object_uk unique (bucket, storage_path)
);

create index if not exists custody_content_attestations_sha_idx
  on public.custody_content_attestations (sha256);
create index if not exists custody_content_attestations_entity_idx
  on public.custody_content_attestations (scope, entity_id);

alter table public.custody_content_attestations enable row level security;

-- Superficie CERO para la Data API: ni lectura. La atestación se emite y se
-- consume exclusivamente dentro de funciones SECURITY DEFINER.
revoke all on public.custody_content_attestations
  from public, anon, authenticated, service_role;

-- =========================================================================
-- 2) LEDGER DE CONTENIDO YA UTILIZADO COMO INSPECCIÓN
--
--    La identidad del contenido es el digest ATESTADO. La PK sobre `sha256` es
--    lo que vuelve el anti-replay atómico: dos transacciones concurrentes con
--    los mismos bytes compiten por la MISMA fila y sólo una puede insertarla.
--
--    ALCANCE ACOTADO, a propósito: sólo la inspección humana. Un POD, un
--    documento o una foto de packing pueden compartir contenido legítimamente
--    —un mismo remito adjunto dos veces no es un fraude—, y prohibirlo
--    globalmente rompería flujos sanos sin cerrar ningún ataque.
--
--    El claim NO se libera nunca: ni la redacción de la evidencia ni el cierre
--    del caso devuelven el digest al pozo. Ese era exactamente el rodeo.
-- =========================================================================
create table if not exists public.custody_inspection_content_claims (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  evidence_id uuid not null references public.custody_evidence(id) on delete restrict,
  event_id uuid not null references public.custody_events(id) on delete restrict,
  attestation_id uuid not null references public.custody_content_attestations(id) on delete restrict,
  client_id uuid not null,
  scope text not null,
  entity_id uuid not null,
  claimed_by uuid not null references auth.users(id) on delete restrict,
  claimed_at timestamptz not null default now()
);

create index if not exists custody_inspection_content_claims_entity_idx
  on public.custody_inspection_content_claims (scope, entity_id);

alter table public.custody_inspection_content_claims enable row level security;
revoke all on public.custody_inspection_content_claims
  from public, anon, authenticated, service_role;

-- Append-only: un claim consumido no se borra ni se reescribe.
create or replace function public.prevent_custody_claim_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'custody_inspection_content_claims es append-only'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_custody_claims_immutable on public.custody_inspection_content_claims;
create trigger trg_custody_claims_immutable
  before update or delete on public.custody_inspection_content_claims
  for each row execute function public.prevent_custody_claim_mutation();

drop trigger if exists trg_custody_claims_no_truncate on public.custody_inspection_content_claims;
create trigger trg_custody_claims_no_truncate
  before truncate on public.custody_inspection_content_claims
  for each statement execute function public.prevent_custody_claim_mutation();

-- =========================================================================
-- 3) EMISIÓN — sólo el rol interno de servidor
--
--    Es el único contexto que puede haber releído el objeto de Storage. No se
--    acepta `authenticated`: si un usuario final pudiera emitir la atestación,
--    volveríamos exactamente al digest declarado por el caller.
--
--    El actor y la sesión se RECIBEN porque el rol de servidor no tiene sesión
--    propia, pero se VALIDAN contra `auth.sessions`: no basta con nombrarlos.
--    El tenant no se recibe: se deriva de la entidad.
-- =========================================================================
create or replace function public.attest_custody_content(
  p_bucket       text,
  p_storage_path text,
  p_sha256       text,
  p_size_bytes   bigint,
  p_actor_id     uuid,
  p_session_id   uuid,
  p_scope        text,
  p_entity_id    uuid,
  p_stage        public.custody_stage_t,
  p_event_type   public.custody_event_type_t,
  p_ttl_seconds  int default 900
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_client uuid;
  v_id uuid;
begin
  -- Gate de emisor: rol interno de servidor, comprobado sobre el claim del token.
  v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if v_role is distinct from 'service_role' then
    raise exception 'la atestación de contenido sólo la emite el rol interno de servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'digest inválido' using errcode = 'check_violation';
  end if;
  if coalesce(p_size_bytes, 0) <= 0 then
    raise exception 'tamaño verificado inválido' using errcode = 'check_violation';
  end if;
  if p_scope not in ('packing_unit','shipment') or p_entity_id is null then
    raise exception 'scope o entidad inválidos' using errcode = 'check_violation';
  end if;
  if coalesce(p_ttl_seconds, 0) <= 0 or p_ttl_seconds > 3600 then
    raise exception 'ttl inválido' using errcode = 'check_violation';
  end if;

  -- Actor y sesión REALES: la sesión debe existir y pertenecer al actor.
  if p_actor_id is null or p_session_id is null then
    raise exception 'actor o sesión ausentes' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_actor_id
  ) then
    raise exception 'sesión inválida para el actor' using errcode = 'insufficient_privilege';
  end if;

  -- Tenant DERIVADO de la entidad, nunca recibido.
  v_client := public.custody_entity_client_id(p_scope, p_entity_id);
  if v_client is null then
    raise exception 'entidad sin client_id resuelto' using errcode = 'check_violation';
  end if;

  -- ANTI-REPLAY, comprobado ya en la emisión para no atestar lo que después no
  -- se va a poder consumir. El control DECISIVO sigue estando en el consumo,
  -- que es donde la inserción del claim lo vuelve atómico.
  if p_stage = 'despacho' and p_event_type = 'inspeccion_humana'
     and exists (select 1 from public.custody_inspection_content_claims c where c.sha256 = p_sha256) then
    raise exception 'ese contenido ya acreditó una inspección humana'
      using errcode = 'unique_violation';
  end if;

  insert into public.custody_content_attestations
    (bucket, storage_path, sha256, size_bytes, actor_id, session_id, client_id,
     scope, entity_id, stage, event_type, expires_at)
  values
    (p_bucket, p_storage_path, p_sha256, p_size_bytes, p_actor_id, p_session_id, v_client,
     p_scope, p_entity_id, p_stage, p_event_type, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.attest_custody_content(text,text,text,bigint,uuid,uuid,text,uuid,public.custody_stage_t,public.custody_event_type_t,int)
  from public, anon, authenticated;
grant execute on function public.attest_custody_content(text,text,text,bigint,uuid,uuid,text,uuid,public.custody_stage_t,public.custody_event_type_t,int)
  to service_role;

/** Revocación explícita (rol interno). Un objeto que resultó no ser el esperado
    deja de poder acreditar nada, sin borrar la traza de que fue atestado. */
create or replace function public.revoke_custody_content_attestation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_rows int;
begin
  v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if v_role is distinct from 'service_role' then
    raise exception 'sólo el rol interno de servidor revoca una atestación'
      using errcode = 'insufficient_privilege';
  end if;
  update public.custody_content_attestations
     set revoked_at = now()
   where id = p_id and revoked_at is null and consumed_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'atestación inexistente, ya consumida o ya revocada'
      using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.revoke_custody_content_attestation(uuid) from public, anon, authenticated;
grant execute on function public.revoke_custody_content_attestation(uuid) to service_role;

-- =========================================================================
-- 4) CAPTURA — `attach_custody_evidence` con la MISMA firma de 0038/0222
--
--    Cambia UNA cosa y sólo una: la inspección humana deja de poder nacer de un
--    `p_sha256` declarado. Para `(despacho, inspeccion_humana)` se exige una
--    atestación server-side sobre EXACTAMENTE ese objeto, se consume de forma
--    atómica y se reclama el contenido en el ledger. El digest que entra a la
--    hash-chain es el ATESTADO; `p_sha256` sólo se compara para poder decir que
--    difiere, nunca para decidir.
--
--    Los demás pares históricos conservan el comportamiento de 0222 sin
--    alteraciones: esta migración no rompe packing, tránsito, entrega ni POD.
-- =========================================================================
create or replace function public.attach_custody_evidence(
  p_packing_unit_id uuid,
  p_shipment_id     uuid,
  p_stage           custody_stage_t,
  p_event_type      custody_event_type_t,
  p_kind            evidence_kind_t,
  p_bucket          text,
  p_storage_path    text,
  p_sha256          text,
  p_file_name       text default null,
  p_mime_type       text default null,
  p_size_bytes      bigint default null,
  p_captured_at     timestamptz default null,
  p_exif            jsonb default null,
  p_geo_lat         double precision default null,
  p_geo_lng         double precision default null,
  p_geo_accuracy_m  numeric default null,
  p_geo_source      text default null,
  p_device_ref      text default null,
  p_notes           text default null,
  p_occurred_at     timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_evi_id   uuid;
  v_pub      text;
  v_exists_redacted boolean;
  v_ret_class text;
  v_ret_until timestamptz;
  v_is_inspection boolean;
  v_scope text;
  v_entity uuid;
  v_client uuid;
  v_actor uuid; v_session uuid; v_role text;
  v_occurred timestamptz;
  v_redacted boolean;
  v_created_by uuid;
  v_actor_id uuid;
  att public.custody_content_attestations;
  v_rows int;
  v_sha text;
  v_size bigint;
begin
  if num_nonnulls(p_packing_unit_id, p_shipment_id) <> 1 then
    raise exception 'indicar exactamente uno de packing_unit_id / shipment_id';
  end if;

  v_is_inspection := (p_stage = 'despacho' and p_event_type = 'inspeccion_humana');
  v_scope  := case when p_packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(p_packing_unit_id, p_shipment_id);
  v_sha    := p_sha256;
  v_size   := p_size_bytes;

  if v_is_inspection then
    select a.actor_id, a.session_id, a.actor_role into v_actor, v_session, v_role
      from public.assert_custody_access('wms.edit') a;
    if v_role not in ('admin','operaciones','supervisor') then
      raise exception 'no autorizado' using errcode = 'insufficient_privilege';
    end if;
    if p_kind <> 'foto' then
      raise exception 'la inspección humana se acredita con foto, no con %', p_kind
        using errcode = 'check_violation';
    end if;
    v_client := public.custody_entity_client_id(v_scope, v_entity);
    if v_client is null then
      raise exception 'entidad sin client_id resuelto: no se registra inspección'
        using errcode = 'check_violation';
    end if;
    perform public.assert_custody_tenant(v_role, v_client);
    v_occurred := now();

    -- ── M2 · CONSUMO ATÓMICO DE LA ATESTACIÓN ────────────────────────────
    -- Un solo UPDATE hace de lock, de validación y de consumo: si otra
    -- transacción ya la consumió, `consumed_at is null` no matchea y la
    -- cardinalidad es 0. No hay ventana entre comprobar y consumir.
    update public.custody_content_attestations a
       set consumed_at = now()
     where a.bucket = p_bucket
       and a.storage_path = p_storage_path
       and a.consumed_at is null
       and a.revoked_at is null
       and a.expires_at > now()
       and a.actor_id = v_actor
       and a.session_id = v_session
       and a.client_id = v_client
       and a.scope = v_scope
       and a.entity_id = v_entity
       and a.stage = p_stage
       and a.event_type = p_event_type
    returning a.* into att;
    get diagnostics v_rows = row_count;

    if v_rows <> 1 or att.id is null then
      raise exception
        'inspección humana sin atestación server-side válida del contenido almacenado'
        using errcode = 'insufficient_privilege';
    end if;

    -- El digest AUTORITATIVO es el atestado. `p_sha256` sólo sirve para dejar
    -- constancia de que el caller decía otra cosa.
    if p_sha256 is not null and p_sha256 <> att.sha256 then
      raise exception 'el digest declarado no coincide con el contenido atestado'
        using errcode = 'check_violation';
    end if;
    if p_size_bytes is not null and p_size_bytes <> att.size_bytes then
      raise exception 'el tamaño declarado no coincide con el contenido atestado'
        using errcode = 'check_violation';
    end if;
    v_sha  := att.sha256;
    v_size := att.size_bytes;
  else
    if public.current_role() is null
       or public.current_role() not in ('admin','operaciones','supervisor') then
      raise exception 'no autorizado' using errcode = 'insufficient_privilege';
    end if;
    v_occurred := coalesce(p_occurred_at, now());
  end if;

  if p_packing_unit_id is not null
     and not exists (select 1 from public.packing_units where id = p_packing_unit_id) then
    raise exception 'packing_unit % inexistente', p_packing_unit_id using errcode = 'no_data_found';
  end if;
  if p_shipment_id is not null
     and not exists (select 1 from public.shipments where id = p_shipment_id) then
    raise exception 'shipment % inexistente', p_shipment_id using errcode = 'no_data_found';
  end if;

  if not (
        (p_stage = 'packing'    and p_event_type = 'foto_packing')
     or (p_stage = 'despacho'   and p_event_type in ('cargado','inspeccion_humana'))
     or (p_stage = 'transporte' and p_event_type = 'en_transito')
     or (p_stage = 'entrega'    and p_event_type in ('foto_entrega','firmado'))
     or (p_stage = 'pod'        and p_event_type = 'pod')
  ) then
    raise exception 'event_type % no es válido para stage %', p_event_type, p_stage;
  end if;

  if p_bucket not in ('custody-evidence','custody-pii','custody-pod') then
    raise exception 'bucket % inválido', p_bucket;
  end if;

  if v_sha is null or length(trim(v_sha)) = 0 then
    raise exception 'sha256 obligatorio';
  end if;

  select redacted into v_exists_redacted from public.custody_evidence
    where storage_bucket = p_bucket and storage_path = p_storage_path;
  if found then
    if v_exists_redacted then
      raise exception 'el path % ya pertenece a una evidencia REDACTADA — no reutilizable', p_storage_path;
    end if;
    raise exception 'ya existe evidencia en %/%', p_bucket, p_storage_path;
  end if;

  v_ret_class := case p_bucket
                   when 'custody-pii' then 'pii'
                   when 'custody-evidence' then 'evidence'
                   when 'custody-pod' then 'pod' end;
  v_ret_until := coalesce(p_captured_at, now()) + case v_ret_class
                   when 'pii'      then interval '1 year'
                   when 'evidence' then interval '2 years'
                   when 'pod'      then interval '10 years' end;

  insert into public.custody_events
    (packing_unit_id, shipment_id, stage, event_type, actor_id, occurred_at,
     geo_lat, geo_lng, geo_accuracy_m, geo_source, device_ref, notes, evidence_sha256)
  values
    (p_packing_unit_id, p_shipment_id, p_stage, p_event_type, auth.uid(), v_occurred,
     p_geo_lat, p_geo_lng, p_geo_accuracy_m, p_geo_source, p_device_ref, p_notes, v_sha)
  returning id, public_id into v_event_id, v_pub;

  insert into public.custody_evidence
    (event_id, kind, storage_bucket, storage_path, file_name, mime_type, size_bytes,
     sha256, captured_at, exif, retention_class, retention_until, created_by)
  values
    (v_event_id, p_kind, p_bucket, p_storage_path, p_file_name, p_mime_type, v_size,
     v_sha, p_captured_at, p_exif, v_ret_class, v_ret_until, auth.uid())
  returning id into v_evi_id;

  if v_is_inspection then
    select e.created_by, e.redacted, ev.actor_id
      into v_created_by, v_redacted, v_actor_id
      from public.custody_evidence e
      join public.custody_events ev on ev.id = e.event_id
     where e.id = v_evi_id;
    if v_actor_id is null or v_created_by is null or v_actor_id <> v_created_by
       or v_actor_id <> v_actor then
      raise exception 'inspección sin actor acreditado' using errcode = 'integrity_constraint_violation';
    end if;
    if v_redacted then
      raise exception 'una inspección no puede nacer redactada' using errcode = 'check_violation';
    end if;

    -- ── M2 · CLAIM DEL CONTENIDO ─────────────────────────────────────────
    -- La PK sobre `sha256` es el anti-replay: dos transacciones concurrentes
    -- con los MISMOS bytes compiten por esta fila y sólo una la inserta. La
    -- otra recibe unique_violation y aborta entera, evidencia incluida.
    begin
      insert into public.custody_inspection_content_claims
        (sha256, evidence_id, event_id, attestation_id, client_id, scope, entity_id, claimed_by)
      values
        (v_sha, v_evi_id, v_event_id, att.id, v_client, v_scope, v_entity, v_actor);
    exception when unique_violation then
      raise exception 'ese contenido ya acreditó una inspección humana'
        using errcode = 'unique_violation';
    end;

    update public.custody_content_attestations
       set consumed_by_evidence_id = v_evi_id
     where id = att.id;
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'custody_evidence', v_evi_id, 'custody.attach',
          jsonb_build_object('event_id', v_event_id, 'event_public_id', v_pub,
                             'kind', p_kind, 'bucket', p_bucket, 'path', p_storage_path,
                             'sha256', v_sha, 'retention_class', v_ret_class,
                             'content_attested', v_is_inspection));

  return jsonb_build_object('event_id', v_event_id, 'event_public_id', v_pub, 'evidence_id', v_evi_id);
end;
$$;

revoke all on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz) from public, anon;
grant execute on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz) to authenticated, service_role;

comment on table public.custody_content_attestations is
  'W22-TER-C/M2: atestación server-side del contenido realmente almacenado. Privada, de un solo uso, caduca y atada a actor, sesión, tenant, entidad y objeto. Sin superficie de Data API.';
comment on table public.custody_inspection_content_claims is
  'W22-TER-C/M2: ledger append-only del contenido que ya acreditó una inspección humana. La PK sobre el digest atestado vuelve atómico el anti-replay bajo concurrencia.';

notify pgrst, 'reload schema';

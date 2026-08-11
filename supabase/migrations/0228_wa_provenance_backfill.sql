-- 0228_wa_provenance_backfill.sql — LINK-WA WA-8R9 · H-3 · procedencia histórica.
-- ENTREGADA, NO APLICADA. Sin ejecución contra Supabase remoto.
-- Numeración: 0221–0226 WMS, 0227 WhatsApp (estado atómico); 0228 es el siguiente
-- libre verificado sobre los worktrees del repositorio.
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ RESUELVE Y QUÉ NO
--
-- Conviven dos poblaciones anteriores a la remediación, y ninguna trae
-- `meta.wa.status_source`:
--
--   (a) filas del outbound escritas antes de WA-8R7: tienen estado y a veces
--       sello, pero nada dice quién observó ese estado;
--   (b) filas del import histórico (`wa-import/ingest`): se insertan SIN `meta`
--       y con un `external_msg_id` que es un sha256 NUESTRO, no un wamid de
--       Meta. Tener sello ahí no significa "salió por Meta".
--
-- El backfill NO inventa evidencia. Sólo acredita procedencia donde la
-- derivación es DETERMINISTA, y deja explícitamente ambiguo todo lo demás.
--
-- ── REGLA DE DERIVACIÓN SEGURA ──────────────────────────────────────────────
--
-- `status_source = 'server'` se deriva ÚNICAMENTE para estados que sólo el
-- servidor puede haber escrito: `queued`, `sending`, `reconciliation_required`.
-- Meta jamás reporta ninguno de los tres —su webhook sólo emite sent,
-- delivered, read y failed—, así que la inferencia es una implicación, no una
-- suposición.
--
-- `sent`, `delivered`, `read` y `failed` son AMBIGUOS: los puede haber escrito
-- el servidor (sealSent, un fallo local) o Meta (webhook). No se derivan. Esas
-- filas quedan sin procedencia y la UI las muestra neutras (`historical`), que
-- es la lectura honesta: hay un mensaje y una hora, no hay evidencia de envío.
--
-- ── DIRECCIÓN ───────────────────────────────────────────────────────────────
--
-- Se acredita `outbound` sólo con evidencia estructural: la fila tiene autor
-- de perfil (`author_profile_id`), que es lo que deja `connect_post_message`
-- cuando un operador escribe. Las filas entrantes las inserta el proyector del
-- webhook con participante y SIN perfil.
--
-- NUNCA se deriva dirección de `external_msg_id`: los espacios de
-- identificadores del importador y de Meta son distintos, y tener sello no
-- dice de qué lado vino el mensaje. Una fila `inbound` jamás se convierte en
-- `outbound`.
--
-- ── OPERACIÓN ───────────────────────────────────────────────────────────────
--
-- Todo pasa por `p_dry_run`, que por defecto es TRUE: la primera ejecución
-- informa y no toca nada. Cada escritura deja la marca
-- `meta.wa.provenance_backfill`, que hace la operación idempotente y permite
-- una reversión EXACTA — se revierte lo que este backfill escribió, nada más.
--
-- 100% ADITIVA. Idempotente. No borra mensajes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- (1) CLASIFICACIÓN — la autoridad única de qué población es cada fila
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public._wa_backfill_class(
  p_meta              jsonb,
  p_author_profile_id uuid
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with w as (select coalesce(p_meta->'wa', '{}'::jsonb) as wa)
  select case
    -- Ya tiene procedencia: nada que hacer. Se declara aparte para que el
    -- inventario distinga "ya resuelto" de "no derivable".
    when (select wa->>'status_source' from w) in ('server','meta') then 'ya_acreditada'
    -- Entrante declarada: intocable. Ninguna regla puede volverla saliente.
    when (select wa->>'direction' from w) = 'inbound' then 'inbound_intocable'
    -- Sin estado registrado: no hay procedencia que derivar.
    when (select wa->>'status' from w) is null then 'sin_estado'
    -- Estado que SÓLO escribe el servidor ⇒ derivación determinista.
    when (select wa->>'status' from w) in ('queued','sending','reconciliation_required')
         and p_author_profile_id is not null then 'derivable_server'
    -- Estado que sólo escribe el servidor pero sin autor de perfil: no se puede
    -- acreditar la dirección, así que tampoco se toca.
    when (select wa->>'status' from w) in ('queued','sending','reconciliation_required')
      then 'ambigua_sin_autor'
    -- sent / delivered / read / failed: ambiguos entre dominios.
    else 'ambigua_por_estado'
  end;
$$;

comment on function public._wa_backfill_class(jsonb, uuid) is
  'LINK-WA WA-8R9 · clasifica una fila para el backfill de procedencia. Sin efectos.';

-- ═════════════════════════════════════════════════════════════════════════════
-- (2) INVENTARIO / DRY-RUN — cuenta sin tocar nada
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.wa_backfill_provenance_inventory()
returns table (clase text, filas bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._wa_backfill_class(m.meta, m.author_profile_id) as clase,
         count(*)::bigint
    from public.connect_messages m
    join public.connect_conversations c on c.id = m.conversation_id
   where c.kind = 'whatsapp'
   group by 1
   order by 1;
$$;

revoke all on function public.wa_backfill_provenance_inventory()
  from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- (3) BACKFILL — dry-run por defecto, idempotente, con conteos
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.wa_backfill_provenance(
  p_dry_run boolean default true
) returns table (accion text, filas bigint)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidatas bigint;
  v_escritas   bigint := 0;
begin
  -- Universo EXACTO de lo que se tocaría, calculado igual en ambos modos: el
  -- dry-run informa sobre el mismo predicado que después ejecuta la escritura.
  select count(*) into v_candidatas
    from public.connect_messages m
    join public.connect_conversations c on c.id = m.conversation_id
   where c.kind = 'whatsapp'
     and public._wa_backfill_class(m.meta, m.author_profile_id) = 'derivable_server';

  if p_dry_run then
    accion := 'dry_run_candidatas'; filas := v_candidatas; return next;
    accion := 'escritas';           filas := 0;            return next;
    return;
  end if;

  with objetivo as (
    select m.id,
           coalesce(m.meta,'{}'::jsonb) as meta,
           -- ¿La dirección ya estaba, o la agrega este backfill? La reversión
           -- necesita saberlo para no quitar un hecho que no escribió.
           (coalesce(m.meta->'wa','{}'::jsonb) ? 'direction') as tenia_direccion
      from public.connect_messages m
      join public.connect_conversations c on c.id = m.conversation_id
     where c.kind = 'whatsapp'
       and public._wa_backfill_class(m.meta, m.author_profile_id) = 'derivable_server'
     for update
  ), escrito as (
    update public.connect_messages t
       set meta = jsonb_set(
             jsonb_set(
               jsonb_set(o.meta, '{wa,status_source}', '"server"'::jsonb, true),
               '{wa,direction}', '"outbound"'::jsonb, true),
             -- Marca de autoría del backfill: hace la reversión EXACTA y la
             -- segunda corrida un no-op.
             '{wa,provenance_backfill}',
             jsonb_build_object(
               'at', public._wa_server_now_iso(),
               'rule', 'server_only_state',
               'added_direction', not o.tenia_direccion),
             true)
      from objetivo o
     where t.id = o.id
     returning t.id
  )
  select count(*) into v_escritas from escrito;

  accion := 'dry_run_candidatas'; filas := v_candidatas; return next;
  accion := 'escritas';           filas := v_escritas;   return next;
end;
$$;

comment on function public.wa_backfill_provenance(boolean) is
  'LINK-WA WA-8R9 · backfill de procedencia. Dry-run por defecto. Idempotente por la marca provenance_backfill.';

revoke all on function public.wa_backfill_provenance(boolean)
  from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- (4) REVERSIÓN — deshace EXACTAMENTE lo que este backfill escribió
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Se revierten sólo las filas que llevan la marca. Una fila cuya procedencia
-- escribió el código productivo —o un operador— no se toca: la reversión no es
-- "borrar toda procedencia", es "deshacer este backfill".

create or replace function public.wa_backfill_provenance_rollback(
  -- Igual que el backfill: por defecto INFORMA y no toca nada.
  p_dry_run boolean default true
) returns table (accion text, filas bigint)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidatas bigint;
  v_revertidas bigint := 0;
begin
  -- Universo exacto: sólo lo que lleva la marca del backfill. Una fila cuya
  -- procedencia escribió después el código productivo YA no la tiene (0227 la
  -- caduca al escribir), así que no entra acá.
  select count(*) into v_candidatas
    from public.connect_messages m
   where m.meta->'wa' ? 'provenance_backfill';

  if p_dry_run then
    accion := 'dry_run_candidatas'; filas := v_candidatas; return next;
    accion := 'revertidas';         filas := 0;            return next;
    return;
  end if;

  with objetivo as (
    select m.id,
           (m.meta->'wa'->'provenance_backfill'->>'added_direction')::boolean as agrego_direccion
      from public.connect_messages m
     where m.meta->'wa' ? 'provenance_backfill'
     for update
  ), revertido as (
    update public.connect_messages t
       set meta = case
             -- Se quita la dirección SÓLO si la puso este backfill.
             when coalesce(o.agrego_direccion, false)
               then ((t.meta #- '{wa,status_source}') #- '{wa,direction}')
                    #- '{wa,provenance_backfill}'
             else (t.meta #- '{wa,status_source}') #- '{wa,provenance_backfill}'
           end
      from objetivo o
     where t.id = o.id
     returning t.id
  )
  select count(*) into v_revertidas from revertido;

  accion := 'dry_run_candidatas'; filas := v_candidatas; return next;
  accion := 'revertidas';         filas := v_revertidas; return next;
end;
$$;

comment on function public.wa_backfill_provenance_rollback(boolean) is
  'LINK-WA WA-8R9 · revierte SÓLO lo escrito por wa_backfill_provenance, identificado por su marca.';

revoke all on function public.wa_backfill_provenance_rollback(boolean)
  from public, anon, authenticated;

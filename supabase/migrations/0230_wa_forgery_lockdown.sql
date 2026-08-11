-- 0230_wa_forgery_lockdown.sql — LINK-WA WA-8R9 CLOSEOUT · §4.A/§4.B.
-- ENTREGADA, NO APLICADA. Sin ejecución contra Supabase remoto.
-- Numeración: 0221–0226 WMS · 0227 estado atómico · 0228 backfill ·
-- 0229 cola inbound · 0230 libre verificado sobre los worktrees.
-- ─────────────────────────────────────────────────────────────────────────────
-- EL RIESGO
--
-- La policy de INSERT de `connect_messages` (0143) exige permiso, membresía y
-- que el autor sea `auth.uid()`. Eso protege QUIÉN escribe y DÓNDE, pero no QUÉ:
-- las columnas `meta` y `external_msg_id` quedaban libres.
--
-- Un usuario `authenticated` legítimo —un operador con `connect.create` en su
-- propia conversación— podía insertar directamente una fila con:
--
--     meta = {"wa":{"direction":"outbound","status":"read",
--                   "status_source":"meta","audit_sent":{...}}}
--     external_msg_id = 'wamid.INVENTADO'
--
-- y fabricar un mensaje que la UI muestra como ENTREGADO Y AUDITADO por Meta,
-- sin que Meta haya visto nada. Todo el trabajo de procedencia de este
-- expediente —who wrote the fact— se evade escribiendo el hecho a mano.
--
-- ── LA CORRECCIÓN ───────────────────────────────────────────────────────────
--
-- El INSERT directo deja de poder declarar estado de WhatsApp. Las columnas que
-- constituyen evidencia sólo las escribe el servidor:
--
--   · `connect_post_message`  crea la fila con metadata canónica;
--   · `connect_wa_apply_status` / `connect_wa_mark_audited` la hacen avanzar.
--
-- Las tres son SECURITY DEFINER: corren como el owner y no las alcanza la
-- policy, así que el camino legítimo sigue intacto.
--
-- 100% ADITIVA sobre policies existentes. No borra datos.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- (1) PREDICADO DE NO-FORJA
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Un INSERT directo puede traer `meta` con claves de otros módulos, pero NO
-- puede traer la rama `wa`: ésa es evidencia de canal y la escribe el servidor.

create or replace function public._wa_insert_sin_evidencia(
  p_meta            jsonb,
  p_external_msg_id text
) returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    -- Ni la rama `wa` completa…
    not coalesce(p_meta, '{}'::jsonb) ? 'wa'
    -- …ni un sello de proveedor inventado.
    and p_external_msg_id is null;
$$;

comment on function public._wa_insert_sin_evidencia(jsonb, text) is
  'LINK-WA WA-8R9 · un INSERT directo no puede declarar evidencia de WhatsApp.';

-- ═════════════════════════════════════════════════════════════════════════════
-- (2) POLICY DE INSERT ENDURECIDA
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Se conservan las tres condiciones de 0143 —permiso, membresía, autoría— y se
-- agrega la cuarta. Reemplaza la policy anterior por nombre, de forma idempotente.

drop policy if exists "connect_messages insert" on public.connect_messages;
create policy "connect_messages insert" on public.connect_messages
  for insert to authenticated
  with check (
    public.has_permission('connect.create')
    and public._connect_is_member(conversation_id)
    and author_profile_id = auth.uid()
    -- WA-8R9 · el INSERT directo no declara estado, procedencia ni sello.
    and public._wa_insert_sin_evidencia(meta, external_msg_id)
  );

-- El UPDATE directo ya estaba prohibido en 0143 (`using (false)`); se reafirma
-- acá para que este archivo sea autosuficiente al auditarlo.
drop policy if exists "connect_messages no direct update" on public.connect_messages;
create policy "connect_messages no direct update" on public.connect_messages
  for update to authenticated
  using (false);

-- ═════════════════════════════════════════════════════════════════════════════
-- (3) GRANTS EXPLÍCITOS  (§4.B)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- No se depende de los default privileges: cada RPC declara a quién sirve.
--
--   · las RPC INTERNAS (estado, auditoría, cola, backfill) son del backend:
--     sólo `service_role`, que es quien corre el webhook, el consumidor y los
--     runbooks;
--   · `connect_post_message` es el camino del OPERADOR y conserva su grant a
--     `authenticated`, que es su contrato explícito.
--
-- Ninguna recibe EXECUTE por `PUBLIC`, `anon` ni `authenticated` fuera de eso.

do $$
declare
  v_fn text;
  -- Firmas exactas: un grant por firma, no por nombre.
  v_internas text[] := array[
    'public.connect_wa_apply_status(uuid, text, text, text, text, text, text, text, text, text, text, boolean)',
    'public.connect_wa_mark_audited(uuid, text, text)',
    'public.wa_claim_inbound_events(uuid, integer, integer, interval)',
    'public.wa_release_inbound_event(bigint, uuid, text, text)',
    'public.wa_replay_inbound_event(bigint)',
    'public.wa_inbound_queue_health()',
    'public.wa_backfill_provenance(boolean)',
    'public.wa_backfill_provenance_rollback(boolean)',
    'public.wa_backfill_provenance_inventory()'
  ];
begin
  foreach v_fn in array v_internas loop
    -- `to_regprocedure` devuelve null si la función no existe: la migración es
    -- tolerante al orden de aplicación y no rompe si falta una.
    if to_regprocedure(v_fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', v_fn);
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
end $$;

-- El camino del operador: explícito, no heredado.
do $$
begin
  if to_regprocedure('public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[])') is not null then
    revoke all on function public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[])
      from public, anon;
    grant execute on function public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[])
      to authenticated, service_role;
  end if;
end $$;

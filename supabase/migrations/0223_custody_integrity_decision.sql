-- =========================================================================
-- 0223 · CUSTODIA IA — EVALUACIÓN Y DECISIÓN (D1 validación + D3)
--
-- Depende de: 0221 (enums) · 0222 (tablas, helpers de política, atestación D2,
--             lock de cadena, intentos de evaluación)
--
-- ─── D3 · NO_AUTOMATIC_RELEASE ─────────────────────────────────────────────
-- No existe ninguna ruta por la que un caso alcance 'RELEASED' sin una fila de
-- `custody_integrity_decisions` escrita por un humano autenticado, autorizado y
-- auditado, bajo CAS. La IA NO decide: su resultado es una CONDICIÓN NECESARIA
-- que puede bloquear, jamás una condición suficiente que libere.
--
-- NO SE INVENTA NINGÚN UMBRAL NUMÉRICO. `model_confidence` se valida como
-- magnitud bien formada (rango [0,1]); no se compara contra ningún corte. El
-- «90 %» nunca existió como regla y no se introduce acá.
--
-- ─── §2 · PROCEDENCIA SERVER-OWNED DE LA EVALUACIÓN ────────────────────────
-- Hallazgo DB-C4: `record_custody_integrity_evaluation` permitía que
-- `authenticated` DECLARARA provider, modelo, execution_mode, outcome, verdict
-- y confidence. Un resultado declarado por el interesado no acredita nada.
--
-- Esa RPC SE ELIMINA. En su lugar, dos tiempos con un intento durable:
--
--   1. `begin_custody_integrity_evaluation`  · authenticated
--      Deriva server-side actor, sesión, rol, caso, versión, entidad, cliente,
--      evidencias de ingreso/egreso e instante. Valida sesión, permiso WMS,
--      tenant y CAS. El intento nace 'pending'.
--
--   2. `complete_custody_integrity_evaluation` · SÓLO rol interno de servidor
--      EXECUTE revocado a public/anon/authenticated. Recibe un intento
--      pendiente, verifica su binding COMPLETO, no admite completar dos veces,
--      no admite cambiar caso, versión, cliente ni evidencias, persiste
--      provider/modelo/resultados únicamente dentro de esta finalización,
--      re-deriva la atestación de cadena y audita sin imágenes, sin texto
--      sensible y sin secretos.
--
-- El rol de servidor NO tiene escritura directa sobre las tablas (0222 §11):
-- toda escritura pasa por estas RPC y por el intento previamente autorizado.
--
-- ─── §5 · POLÍTICA ÚNICA DE ACCESO ─────────────────────────────────────────
-- Todas las RPC user-facing SECURITY DEFINER de este feature aplican
-- `assert_custody_access` + `assert_custody_tenant` (0222): sesión real, sesión
-- acreditada, permiso requerido (SIEMPRE con coalesce por el hallazgo
-- 0009:164), rol real, y entidad/client_id DERIVADOS server-side. Los roles
-- internos globales conservan exclusivamente la política canónica existente;
-- un usuario client-bound sólo opera sobre su propio client_id. Cualquier NULL
-- falla cerrado.
--
-- ─── §5 · RELEASE ADMIN-ONLY (resolución conservadora de la fase inicial) ───
-- SÓLO 'admin' puede ejecutar la decisión de LIBERACIÓN. 'operaciones' y
-- 'supervisor' NO reciben automáticamente `wms.custody.decide` (0222 no siembra
-- `role_permissions`), y aunque se les otorgue explícitamente, la liberación
-- les sigue estando vedada. La CUARENTENA y el resto de las operaciones
-- conservan sus permisos existentes: cerrar el paso más peligroso no puede
-- costar la capacidad de retener una carga sospechosa.
-- Una delegación futura exige autorización separada y visible en su diff.
-- Además de esta RPC, el CHECK `custody_integrity_decisions_release_admin_chk`
-- (0222) lo acredita en la fila: una liberación con otro rol no puede existir
-- ni siquiera escrita a mano.
-- =========================================================================

-- =========================================================================
-- 0) §2 · La RPC de evaluación declarativa DEJA DE EXISTIR
--
--    No basta con revocarle EXECUTE a `authenticated`: mientras la función
--    exista, sigue siendo una vía de escritura de las columnas de evaluación
--    que NO exige intento previo, y bastaría un GRANT descuidado —o el rol de
--    servidor— para reabrirla. Se elimina.
-- =========================================================================
drop function if exists public.record_custody_integrity_evaluation(
  uuid, int, text, text, text, text, text, text, numeric, text
);

-- =========================================================================
-- 1) Creación / assessment ATÓMICOS
--    client_id derivado bajo lock; jamás recibido del caller.
-- =========================================================================
create or replace function public.upsert_custody_integrity_assessment(
  p_scope text,
  p_entity_id uuid,
  p_expected_version int,
  p_ingress_evidence_id uuid,
  p_egress_evidence_id uuid,
  p_state text,
  p_hold_reasons text[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_case public.custody_integrity_cases; v_id uuid; v_rows int;
  v_actor uuid; v_session uuid; v_role text;
begin
  -- §5 · política única.
  select a.actor_id, a.session_id, a.actor_role into v_actor, v_session, v_role
    from public.assert_custody_access('wms.edit') a;

  if p_scope not in ('packing_unit','shipment') then
    raise exception 'scope inválido' using errcode = 'check_violation';
  end if;
  -- Un estado terminal NO es derivable: sólo lo produce una decisión humana.
  if p_state not in ('PENDING_EVIDENCE','REVIEW_REQUIRED') then
    raise exception 'estado no derivable' using errcode = 'check_violation';
  end if;

  if p_scope = 'packing_unit' then
    perform 1 from public.packing_units where id = p_entity_id for update;
  else
    perform 1 from public.shipments where id = p_entity_id for update;
  end if;

  v_client := public.custody_entity_client_id(p_scope, p_entity_id);
  if v_client is null then
    raise exception 'entidad sin client_id resuelto: no se crea el caso' using errcode = 'check_violation';
  end if;
  -- §5 · el tenant se DERIVA de la entidad y después se contrasta con el
  -- alcance del actor. Antes esto no existía: un usuario client-bound podía
  -- abrir casos sobre entidades de OTRO cliente.
  perform public.assert_custody_tenant(v_role, v_client);

  select * into v_case from public.custody_integrity_cases
   where coalesce(packing_unit_id, shipment_id) = p_entity_id
     and ingress_evidence_id is not distinct from p_ingress_evidence_id
     and egress_evidence_id  is not distinct from p_egress_evidence_id
   for update;

  if not found then
    insert into public.custody_integrity_cases (
      public_id, packing_unit_id, shipment_id, client_id, version, state, hold_reasons,
      ingress_evidence_id, egress_evidence_id
    ) values (
      'CINT-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.custody_integrity_case_short_id_seq')::text, 4, '0'),
      case when p_scope = 'packing_unit' then p_entity_id end,
      case when p_scope = 'shipment'     then p_entity_id end,
      v_client, 1, p_state, coalesce(p_hold_reasons, '{}'),
      p_ingress_evidence_id, p_egress_evidence_id
    ) returning id into v_id;
    return v_id;
  end if;

  if v_case.state in ('RELEASED','QUARANTINED') then
    raise exception 'caso ya decidido' using errcode = 'unique_violation';
  end if;
  if p_expected_version is null or p_expected_version <= 0 or v_case.version <> p_expected_version then
    raise exception 'conflicto de versión' using errcode = 'serialization_failure';
  end if;

  update public.custody_integrity_cases
     set state = p_state, hold_reasons = coalesce(p_hold_reasons,'{}'),
         version = v_case.version + 1, updated_at = now()
   where id = v_case.id and version = p_expected_version
   returning id into v_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'assessment no aplicado' using errcode = 'serialization_failure';
  end if;
  return v_id;
end;
$$;

revoke all on function public.upsert_custody_integrity_assessment(text,uuid,int,uuid,uuid,text,text[]) from public, anon, authenticated;
grant execute on function public.upsert_custody_integrity_assessment(text,uuid,int,uuid,uuid,text,text[]) to authenticated;

-- =========================================================================
-- 2) §2.A · APERTURA del intento de evaluación — authenticated
--
--    El caller NO aporta ningún hecho: sólo señala qué caso y en qué versión.
--    Todo lo demás lo fija el servidor y queda CONGELADO en la fila del
--    intento, que es lo que después permite comprobar que la finalización se
--    refiere exactamente a lo que se autorizó.
-- =========================================================================
create or replace function public.begin_custody_integrity_evaluation(
  p_case_id uuid,
  p_expected_version int
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.custody_integrity_cases;
  v_actor uuid; v_session uuid; v_role text;
  v_scope text; v_entity uuid; v_client uuid;
  v_attempt uuid;
begin
  -- §5 · política única.
  select a.actor_id, a.session_id, a.actor_role into v_actor, v_session, v_role
    from public.assert_custody_access('wms.edit') a;

  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'versión esperada inválida' using errcode = 'check_violation';
  end if;

  select * into c from public.custody_integrity_cases where id = p_case_id for update;
  if not found then raise exception 'caso inexistente' using errcode = 'no_data_found'; end if;
  if c.decision_id is not null or c.state in ('RELEASED','QUARANTINED') then
    raise exception 'caso ya decidido' using errcode = 'unique_violation';
  end if;
  if c.version <> p_expected_version then
    raise exception 'conflicto de versión' using errcode = 'serialization_failure';
  end if;

  v_scope  := case when c.packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(c.packing_unit_id, c.shipment_id);

  -- Tenant DERIVADO de la entidad y contrastado contra el caso: si difirieran,
  -- el caso estaría mal construido y no corresponde evaluarlo.
  v_client := public.custody_entity_client_id(v_scope, v_entity);
  if v_client is null or v_client <> c.client_id then
    raise exception 'tenant no resuelto o incoherente con el caso'
      using errcode = 'integrity_constraint_violation';
  end if;
  perform public.assert_custody_tenant(v_role, v_client);

  -- A lo sumo un intento pendiente por caso. El anterior se abandona bajo el
  -- lock de la fila del caso: el índice parcial único nunca llega a colisionar.
  update public.custody_integrity_evaluation_attempts
     set status = 'abandoned', closed_at = now()
   where case_id = c.id and status = 'pending';

  insert into public.custody_integrity_evaluation_attempts (
    case_id, client_id, scope, entity_id, case_version_at_start,
    ingress_evidence_id, egress_evidence_id,
    requested_by, requested_session_id, requested_role,
    status, requested_at, expires_at
  ) values (
    c.id, v_client, v_scope, v_entity, c.version,
    c.ingress_evidence_id, c.egress_evidence_id,
    v_actor, v_session, v_role,
    'pending', now(), now() + interval '30 minutes'
  ) returning id into v_attempt;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (v_actor, 'custody_integrity_case', c.id, 'custody.integrity_evaluation_opened',
          jsonb_build_object('attempt_id', v_attempt, 'case_version', c.version,
                             'scope', v_scope, 'role', v_role));

  return v_attempt;
end;
$$;

revoke all on function public.begin_custody_integrity_evaluation(uuid,int) from public, anon, authenticated;
grant execute on function public.begin_custody_integrity_evaluation(uuid,int) to authenticated;

-- =========================================================================
-- 3) §2.B · CIERRE del intento — SÓLO el rol interno de servidor
--
--    DOS BARRERAS, distintas y ambas necesarias:
--
--    · Barrera de privilegio (la efectiva): EXECUTE revocado a public, anon y
--      authenticated, y concedido únicamente a `service_role`. Una sesión de
--      usuario recibe «permission denied for function» antes de entrar.
--
--    · Barrera de contexto (defensa en profundidad): dentro de SECURITY
--      DEFINER `current_user` ya es el owner, así que el rol del llamador no
--      puede leerse de ahí; lo que sí sobrevive es el claim del request. Un
--      token de usuario final trae role='authenticated' (o 'anon'): con ese
--      contexto la finalización se rechaza aunque alguien haya reabierto el
--      GRANT por descuido.
--
--    Lo único que el servidor aporta son HECHOS DEL PROVEEDOR. Todo lo demás
--    —caso, versión, cliente, entidad, evidencias, actor humano— viene del
--    intento y se verifica pieza por pieza.
-- =========================================================================
create or replace function public.complete_custody_integrity_evaluation(
  p_attempt_id uuid,
  p_case_id uuid,
  p_expected_version int,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_execution_mode text,
  p_outcome text,
  p_verdict text default null,
  p_model_confidence numeric default null,
  p_provider_error text default null
)
returns int language plpgsql security definer set search_path = public as $$
declare
  a public.custody_integrity_evaluation_attempts;
  c public.custody_integrity_cases;
  v_chain jsonb; v_rows int; v_new_version int;
  v_scope text; v_entity uuid; v_client uuid;
  v_error text;
begin
  -- Barrera de contexto (ver cabecera).
  if coalesce(auth.role(), 'anon') in ('anon','authenticated') then
    raise exception 'finalización reservada al rol interno de servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_attempt_id is null or p_case_id is null then
    raise exception 'intento y caso son obligatorios' using errcode = 'check_violation';
  end if;

  -- ── El intento: existente, PENDIENTE, vigente y del caso indicado ──
  select * into a from public.custody_integrity_evaluation_attempts
   where id = p_attempt_id for update;
  if not found then
    raise exception 'intento inexistente' using errcode = 'no_data_found';
  end if;
  if a.status <> 'pending' then
    raise exception 'intento ya utilizado o abandonado (%)', a.status using errcode = 'unique_violation';
  end if;
  if now() > a.expires_at then
    raise exception 'intento vencido' using errcode = 'check_violation';
  end if;
  if a.case_id <> p_case_id then
    raise exception 'intento ajeno al caso' using errcode = 'integrity_constraint_violation';
  end if;
  if p_expected_version is null or p_expected_version <> a.case_version_at_start then
    raise exception 'versión distinta de la del intento' using errcode = 'serialization_failure';
  end if;

  -- ── El caso: sigue siendo el mismo, en la misma versión y sin decidir ──
  select * into c from public.custody_integrity_cases where id = a.case_id for update;
  if not found then raise exception 'caso inexistente' using errcode = 'no_data_found'; end if;
  if c.decision_id is not null or c.state in ('RELEASED','QUARANTINED') then
    raise exception 'caso ya decidido' using errcode = 'unique_violation';
  end if;
  if c.version <> a.case_version_at_start then
    raise exception 'conflicto de versión' using errcode = 'serialization_failure';
  end if;
  if c.client_id <> a.client_id then
    raise exception 'cliente distinto del intento' using errcode = 'integrity_constraint_violation';
  end if;
  if c.ingress_evidence_id is distinct from a.ingress_evidence_id
     or c.egress_evidence_id is distinct from a.egress_evidence_id then
    raise exception 'evidencias distintas de las del intento' using errcode = 'integrity_constraint_violation';
  end if;

  v_scope  := case when c.packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(c.packing_unit_id, c.shipment_id);
  if v_scope <> a.scope or v_entity <> a.entity_id then
    raise exception 'entidad distinta de la del intento' using errcode = 'integrity_constraint_violation';
  end if;

  -- Tenant RE-DERIVADO: que el caso y el intento coincidan no basta si la
  -- entidad dejó de resolver el mismo cliente.
  v_client := public.custody_entity_client_id(v_scope, v_entity);
  if v_client is null or v_client <> c.client_id then
    raise exception 'tenant no resuelto o incoherente con el caso'
      using errcode = 'integrity_constraint_violation';
  end if;

  -- ── Atestación RE-DERIVADA, serializada contra la cadena de la entidad ──
  perform public.custody_chain_lock(v_scope, v_entity);
  v_chain := public.custody_chain_attestation(v_scope, v_entity);
  if (v_chain ->> 'entity_id')::uuid is distinct from v_entity
     or (v_chain ->> 'scope') is distinct from v_scope then
    raise exception 'atestación ajena a la entidad del caso' using errcode = 'integrity_constraint_violation';
  end if;

  -- El error del proveedor es texto ajeno: se acota antes de persistirlo.
  v_error := left(nullif(btrim(coalesce(p_provider_error, '')), ''), 500);

  update public.custody_integrity_cases
     set provider = p_provider, model = p_model, prompt_version = p_prompt_version,
         execution_mode = p_execution_mode, outcome = p_outcome, verdict = p_verdict,
         model_confidence = p_model_confidence, provider_error = v_error,
         chain_status         = v_chain ->> 'status',
         chain_events_checked = (v_chain ->> 'events_checked')::int,
         chain_head           = v_chain ->> 'chain_head',
         chain_attested_at    = (v_chain ->> 'attested_at')::timestamptz,
         -- Con la evaluación registrada el caso queda a la espera de un humano.
         state = 'REVIEW_REQUIRED',
         version = c.version + 1,
         updated_at = now()
   where id = c.id and version = a.case_version_at_start and decision_id is null
   returning version into v_new_version;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'evaluación no aplicada' using errcode = 'serialization_failure';
  end if;

  -- Cierre del intento. `where status = 'pending'` + GET DIAGNOSTICS: si dos
  -- finalizaciones concurrentes llegaran hasta acá, sólo una afecta la fila.
  update public.custody_integrity_evaluation_attempts
     set status = 'completed', closed_at = now(), completed_case_version = v_new_version,
         provider = p_provider, model = p_model, prompt_version = p_prompt_version,
         execution_mode = p_execution_mode, outcome = p_outcome, verdict = p_verdict,
         model_confidence = p_model_confidence, provider_error = v_error
   where id = a.id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'intento no cerrado' using errcode = 'serialization_failure';
  end if;

  -- AUDITORÍA sin imágenes, sin texto del proveedor y sin secretos: se
  -- registra QUE hubo error, nunca su contenido, y jamás la evidencia.
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (a.requested_by, 'custody_integrity_case', c.id, 'custody.integrity_evaluated',
          jsonb_build_object('attempt_id', a.id,
                             'outcome', p_outcome, 'execution_mode', p_execution_mode,
                             'verdict', p_verdict, 'chain_status', v_chain ->> 'status',
                             'provider', p_provider, 'model', p_model,
                             'prompt_version', p_prompt_version,
                             'provider_error_present', v_error is not null));

  return v_new_version;
end;
$$;

revoke all on function public.complete_custody_integrity_evaluation(uuid,uuid,int,text,text,text,text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.complete_custody_integrity_evaluation(uuid,uuid,int,text,text,text,text,text,text,numeric,text) to service_role;

-- =========================================================================
-- 4) D1 · ¿esta evidencia acredita una inspección humana de ESTE caso?
--
--    Predicado único, para que la RPC de decisión y cualquier auditoría
--    posterior apliquen EXACTAMENTE la misma regla.
--
--    §3 · Se agrega la exigencia de PROCEDENCIA HUMANA: el evento debe tener
--    actor, la evidencia debe tener autor, y ambos deben ser la MISMA persona.
--    Una inspección sin actor acreditado es indistinguible de una fila
--    fabricada, y era exactamente lo que un INSERT directo producía.
-- =========================================================================
create or replace function public.is_custody_inspection_evidence(
  p_evidence_id uuid,
  p_entity_id uuid,
  p_client_id uuid,
  p_ingress_evidence_id uuid,
  p_egress_evidence_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.custody_evidence e
      join public.custody_events ev on ev.id = e.event_id
     where e.id = p_evidence_id
       -- tipo y etapa CANÓNICOS de la inspección humana (D1)
       and ev.event_type = 'inspeccion_humana'
       and ev.stage      = 'despacho'
       -- soporte: foto
       and e.kind = 'foto'
       -- no redactada
       and e.redacted = false
       -- PROCEDENCIA HUMANA acreditada y coherente
       and ev.actor_id is not null
       and e.created_by is not null
       and e.created_by = ev.actor_id
       -- misma entidad que el caso
       and coalesce(ev.packing_unit_id, ev.shipment_id) = p_entity_id
       -- mismo cliente que el caso
       and public.custody_entity_client_id(
             case when ev.packing_unit_id is not null then 'packing_unit' else 'shipment' end,
             coalesce(ev.packing_unit_id, ev.shipment_id)
           ) = p_client_id
       -- distinta de las evidencias comparadas por la IA
       and e.id is distinct from p_ingress_evidence_id
       and e.id is distinct from p_egress_evidence_id
  );
$$;
revoke all on function public.is_custody_inspection_evidence(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;

-- =========================================================================
-- 5) RPC transaccional de decisión — ÚNICA vía a un estado terminal
-- =========================================================================
create or replace function public.decide_custody_integrity(
  p_case_id uuid,
  p_expected_version int,
  p_decision text,
  p_reason text,
  p_observations text default null,
  p_inspection_evidence_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.custody_integrity_cases;
  v_role text; v_new_state text; v_decision_id uuid; v_evidence uuid;
  v_session uuid; v_actor uuid; v_entity uuid; v_scope text; v_rows int; v_updated uuid;
  v_live_head text; v_head_seq bigint; v_event uuid;
  v_seen uuid[] := '{}';
begin
  -- 1. §5 · política única: sesión real y acreditada, permiso y rol reales.
  select a.actor_id, a.session_id, a.actor_role into v_actor, v_session, v_role
    from public.assert_custody_access('wms.custody.decide') a;

  -- 2. Forma del comando.
  if p_decision not in ('release','quarantine') then
    raise exception 'decisión inválida' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'motivo insuficiente' using errcode = 'check_violation';
  end if;
  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'versión esperada inválida' using errcode = 'check_violation';
  end if;

  -- 3. Lock de fila + CAS.
  select * into c from public.custody_integrity_cases where id = p_case_id for update;
  if not found then raise exception 'caso inexistente' using errcode = 'no_data_found'; end if;
  if c.decision_id is not null or c.state in ('RELEASED','QUARANTINED') then
    raise exception 'caso ya decidido' using errcode = 'unique_violation';
  end if;
  if c.state <> 'REVIEW_REQUIRED' then
    raise exception 'estado no decidible: %', c.state using errcode = 'check_violation';
  end if;
  if c.version <> p_expected_version then
    raise exception 'conflicto de versión' using errcode = 'serialization_failure';
  end if;

  -- 4. §5 · tenant. El acotamiento por cliente rige para TODA decisión, no
  --    sólo para la liberación: retener la carga de otro cliente tampoco es
  --    algo que un usuario client-bound deba poder hacer.
  perform public.assert_custody_tenant(v_role, c.client_id);

  v_new_state := case when p_decision = 'release' then 'RELEASED' else 'QUARANTINED' end;
  v_scope  := case when c.packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(c.packing_unit_id, c.shipment_id);

  -- 5. §4 · MISMO advisory lock por entidad que usa la hash-chain (0036),
  --    tomado ANTES de leer nada de la cadena y sostenido hasta el fin de la
  --    transacción. Sin esto, un evento concurrente podía insertarse entre el
  --    control del head y el commit, y la decisión quedaba tomada sobre una
  --    cadena que ya no era la vigente.
  perform public.custody_chain_lock(v_scope, v_entity);

  -- 6. D3 · política conservadora de liberación. Espejo de release-policy.ts.
  --    NINGÚN umbral numérico: se exige forma válida, no un corte inventado.
  if p_decision = 'release' then
    -- §5 · RELEASE ADMIN-ONLY. Se comprueba DESPUÉS del tenant para que un
    -- intruso de otro cliente reciba 'cliente ajeno' y no una pista sobre
    -- qué rol haría falta.
    if v_role <> 'admin' then
      raise exception 'liberación reservada a admin en la fase inicial (rol: %)', v_role
        using errcode = 'insufficient_privilege';
    end if;

    if not (c.hold_reasons @> array['NO_CALIBRATED_THRESHOLD']
            and array_length(c.hold_reasons,1) = 1) then
      raise exception 'liberación bloqueada: retenciones distintas de NO_CALIBRATED_THRESHOLD'
        using errcode = 'check_violation';
    end if;
    if c.chain_status is distinct from 'verified' or coalesce(c.chain_events_checked,0) <= 0
       or c.chain_head is null or c.chain_attested_at is null then
      raise exception 'liberación bloqueada: cadena no verificada' using errcode = 'check_violation';
    end if;

    -- El head vigente NO lo aporta el caller: se recomputa DESPUÉS de adquirir
    -- el advisory lock, contra la cadena real, y se compara con lo atestado.
    select ev.row_hash into v_live_head
      from public.custody_events ev
     where coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity
     order by ev.chain_seq desc limit 1;
    if c.chain_head is distinct from v_live_head then
      raise exception 'liberación bloqueada: la cadena avanzó desde la atestación'
        using errcode = 'check_violation';
    end if;
    if now() - c.chain_attested_at > interval '60 minutes' then
      raise exception 'liberación bloqueada: atestación de cadena vencida' using errcode = 'check_violation';
    end if;

    if c.outcome is distinct from 'ok' or c.execution_mode is distinct from 'real'
       or c.verdict is distinct from 'coincide'
       or c.model_confidence is null or c.model_confidence < 0 or c.model_confidence > 1 then
      raise exception 'liberación bloqueada: evaluación no apta' using errcode = 'check_violation';
    end if;
    -- §2 · La evaluación que sostiene la liberación tiene que provenir de una
    -- finalización server-owned: sin intento completado, los resultados no
    -- tienen procedencia acreditable.
    if not exists (
      select 1 from public.custody_integrity_evaluation_attempts t
       where t.case_id = c.id and t.status = 'completed'
         and t.completed_case_version = c.version
    ) then
      raise exception 'liberación bloqueada: evaluación sin intento confiable'
        using errcode = 'check_violation';
    end if;
    if c.ingress_evidence_id is null or c.egress_evidence_id is null then
      raise exception 'liberación bloqueada: evidencias incompletas' using errcode = 'check_violation';
    end if;
    if coalesce(array_length(p_inspection_evidence_ids,1),0) = 0 then
      raise exception 'liberación bloqueada: sin evidencia de inspección' using errcode = 'check_violation';
    end if;
  end if;

  -- 7. Decisión append-only.
  insert into public.custody_integrity_decisions
    (case_id, decision, actor_user_id, actor_session_id, actor_role, client_id, permission,
     reason, observations, previous_state, new_state, case_version_at_decision, chain_head_at_decision)
  values
    (c.id, p_decision, v_actor, v_session, v_role, c.client_id, 'wms.custody.decide',
     btrim(p_reason), nullif(btrim(coalesce(p_observations,'')),''),
     c.state, v_new_state, c.version, c.chain_head)
  returning id into v_decision_id;

  -- 8. D1 · evidencias de inspección, verificadas contra el JOIN REAL y contra
  --    la cadena atestada. Cada una debe ser inspección humana (despacho +
  --    inspeccion_humana), foto, no redactada, con actor y autor coherentes,
  --    de la misma entidad y cliente, distinta de ingreso/egreso, no repetida,
  --    NUNCA usada en otra decisión, y DENTRO de la hash-chain.
  -- `chain_head` es el row_hash del ÚLTIMO evento recorrido por la atestación:
  -- su chain_seq es la frontera de lo efectivamente verificado. Un evento
  -- posterior existe en la tabla pero NO fue atestado. Se deriva acá, bajo el
  -- advisory lock ya tomado, sin volver a llamar a `verify_custody_chain`,
  -- cuyo gate de rol es más estrecho que el de esta decisión.
  if c.chain_head is not null then
    select ev.chain_seq into v_head_seq
      from public.custody_events ev
     where coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity
       and ev.row_hash = c.chain_head;
  end if;

  foreach v_evidence in array coalesce(p_inspection_evidence_ids,'{}') loop
    if v_evidence = any(v_seen) then
      raise exception 'evidencia de inspección repetida' using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_evidence;

    -- §4 · ANTI-REPLAY entre decisiones. El índice único de 0222 lo impediría
    -- igual, pero un error de unicidad no explica el hecho: una inspección
    -- consumida no vuelve a acreditar nada.
    if exists (
      select 1 from public.custody_integrity_inspection_evidence i
       where i.evidence_id = v_evidence
    ) then
      raise exception 'evidencia de inspección ya utilizada en otra decisión'
        using errcode = 'unique_violation';
    end if;

    if not public.is_custody_inspection_evidence(
         v_evidence, v_entity, c.client_id, c.ingress_evidence_id, c.egress_evidence_id) then
      raise exception 'evidencia de inspección inválida: tipo/etapa/soporte, actor, entidad, cliente, redacción o duplicación con las comparadas'
        using errcode = 'check_violation';
    end if;

    -- DENTRO de la hash-chain atestada (D1): el evento de la inspección debe
    -- caer en el tramo que la atestación efectivamente recorrió y validó.
    select e.event_id into v_event from public.custody_evidence e where e.id = v_evidence;
    if v_head_seq is null or not exists (
      select 1 from public.custody_events ev
       where ev.id = v_event
         and coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity
         and ev.chain_seq <= v_head_seq
    ) then
      raise exception 'evidencia de inspección fuera de la cadena atestada'
        using errcode = 'check_violation';
    end if;

    insert into public.custody_integrity_inspection_evidence (decision_id, evidence_id)
    values (v_decision_id, v_evidence);
  end loop;

  -- 9. Cierre del caso. RETURNING + GET DIAGNOSTICS: si no afecta exactamente
  --    una fila, se aborta y la decisión NO queda huérfana (misma transacción).
  update public.custody_integrity_cases
     set state = v_new_state, decision_id = v_decision_id,
         version = c.version + 1, updated_at = now()
   where id = c.id and version = p_expected_version and decision_id is null
   returning id into v_updated;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 or v_updated is null then
    raise exception 'cierre del caso no aplicado; decisión revertida' using errcode = 'serialization_failure';
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (v_actor, 'custody_integrity_case', c.id, 'custody.integrity_decided',
          jsonb_build_object('decision', p_decision, 'new_state', v_new_state,
                             'decision_id', v_decision_id, 'role', v_role));

  return v_decision_id;
end;
$$;

revoke all on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[]) to authenticated;

notify pgrst, 'reload schema';

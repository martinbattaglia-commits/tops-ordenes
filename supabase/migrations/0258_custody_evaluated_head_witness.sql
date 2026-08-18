-- =========================================================================
-- 0258 · CUSTODIA DIGITAL · EL TESTIGO DE LA PUNTA EVALUADA (V4 · FASE 1)
--
-- Expediente CUSTODIA-CERTIFICADO-EMISIBLE · Opción 2 firmada (R-21).
-- Aditiva y forward-only. No edita ninguna migración anterior; redefine dos
-- funciones de 0250a por copia exacta + parche mínimo, que es el patrón del
-- módulo (0251 redefinió decide; 0254 no tocó funciones).
--
-- ─── EL DEFECTO, MEDIDO ──────────────────────────────────────────────────
--
-- `complete_custody_integrity_evaluation_v2` escribe en el caso el head de la
-- cadena AL EVALUAR (`chain_head`), y `decide_custody_integrity_v2` (0251)
-- lo SOBRESCRIBE con el head vivo al decidir. `is_custody_inspection_evidence_v2`
-- resuelve `eval_ev` contra `c.chain_head`: pre-decisión eso es el head
-- evaluado y el predicado funciona; post-decisión es el head de la decisión
-- —que INCLUYE la foto de inspección— y la condición
-- `ev.chain_seq > eval_ev.chain_seq` se vuelve imposible para la evidencia
-- que la propia decisión validó. Toda re-derivación canónica post-decisión da
-- vacío, y el certificado no puede compararse contra nada.
--
-- ─── LA CORRECCIÓN · TRES PIEZAS ─────────────────────────────────────────
--
--  1. Columna testigo `chain_head_at_evaluation`: la escribe complete_v2 en el
--     MISMO punto donde escribe `chain_head`, y NADIE más la escribe. decide_v2
--     no se redefine: no la toca, así que el testigo sobrevive a la decisión.
--  2. El predicado resuelve `eval_ev` contra
--     `coalesce(chain_head_at_evaluation, chain_head)`: pre-backfill los casos
--     viejos conservan el comportamiento EXACTO de 0250a (testigo null ⇒ cae a
--     `chain_head`), y los nuevos quedan inmunes a la sobrescritura.
--  3. `custody_certificate_document_v2`: RPC de LECTURA para el camino del
--     documento. MEDIDO contra la base (2026-08-18): `verify_custody_chain_v2`
--     exige `wms.edit` y `custody_inspection_candidates_v2` exige
--     `wms.custody.decide`; `supervisor` y los usuarios de cliente —que SÍ leen
--     su certificado por la política de 0254— no tienen ninguno de los dos.
--     Sin esta pieza, la atestación viva y el canónico re-derivado serían
--     inalcanzables para quien el documento existe. La compuerta es LA MISMA
--     de la política 0254, literal: roles operativos o tenant propio.
--
-- ─── LO QUE NO HACE ──────────────────────────────────────────────────────
--
-- No toca decide_custody_integrity_v2 ni su autoridad. No hace backfill del
-- testigo para casos ya decididos: el head de evaluación fue sobrescrito y su
-- recuperabilidad sólo puede saberse inspeccionando datos productivos
-- (decisión de Dirección, reportada aparte). Sin backfill, los casos
-- históricos siguen resolviendo acta: fail-closed.
-- =========================================================================

begin;

-- -------------------------------------------------------------------------
-- 1 · El testigo. text como chain_head; nullable: null = «pre-0258».
-- -------------------------------------------------------------------------

alter table public.custody_integrity_cases
  add column if not exists chain_head_at_evaluation text;

comment on column public.custody_integrity_cases.chain_head_at_evaluation is
  '0258 · head de la cadena AL CERRAR LA EVALUACIÓN. Lo escribe únicamente '
  'complete_custody_integrity_evaluation_v2; decide_v2 no lo toca. Es el ancla '
  'contra la que is_custody_inspection_evidence_v2 resuelve el eslabón evaluado '
  'después de la decisión.';

-- -------------------------------------------------------------------------
-- 2 · complete_custody_integrity_evaluation_v2 · copia exacta de 0250a:1405
--     + UNA asignación: chain_head_at_evaluation, en el mismo punto.
-- -------------------------------------------------------------------------

create or replace function public.complete_custody_integrity_evaluation_v2(
  p_attempt_id uuid,
  p_case_id uuid,
  p_expected_version int,
  p_ingress_observed_sha256 text,
  p_egress_observed_sha256 text,
  p_score_components jsonb,
  p_model_confidence numeric,
  p_verdict text,
  p_packaging_changed boolean,
  p_missing_items_suspected boolean,
  p_damage_suspected boolean,
  p_provider_response_id text,
  p_response_model text,
  p_system_fingerprint text,
  p_request_sha256 text,
  p_response_sha256 text,
  p_provider_details jsonb default '{}'::jsonb
) returns int language plpgsql security definer set search_path=public as $$
declare
  a public.custody_integrity_evaluation_attempts;
  c public.custody_integrity_cases;
  v_chain jsonb; v_rows int; v_version int;
  v_identity numeric; v_packaging numeric; v_quantity numeric; v_condition numeric;
  v_score numeric(5,2); v_result text; v_state text; v_holds text[]:='{}';
  v_details jsonb;
begin
  if coalesce(auth.role(),'anon') in('anon','authenticated') then
    raise exception 'finalización reservada al rol interno' using errcode='insufficient_privilege';
  end if;
  select * into a from public.custody_integrity_evaluation_attempts where id=p_attempt_id for update;
  if not found then raise exception 'intento inexistente' using errcode='no_data_found'; end if;
  if a.status<>'pending' or now()>a.expires_at then raise exception 'intento no vigente' using errcode='object_not_in_prerequisite_state'; end if;
  if a.case_id<>p_case_id or a.case_version_at_start<>p_expected_version or a.scope<>'physical_unit' then
    raise exception 'binding del intento inválido' using errcode='integrity_constraint_violation';
  end if;
  select * into c from public.custody_integrity_cases where id=a.case_id for update;
  if not found or c.physical_unit_id<>a.entity_id or c.version<>a.case_version_at_start
     or c.client_id<>a.client_id or c.ingress_evidence_id is distinct from a.ingress_evidence_id
     or c.egress_evidence_id is distinct from a.egress_evidence_id or c.decision_id is not null then
    raise exception 'caso distinto del snapshot' using errcode='integrity_constraint_violation';
  end if;
  if p_ingress_observed_sha256 is distinct from a.ingress_sha256
     or p_egress_observed_sha256 is distinct from a.egress_sha256
     or p_ingress_observed_sha256 !~ '^[0-9a-f]{64}$'
     or p_egress_observed_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'hash observado no coincide con evidencia congelada'
      using errcode='XX001';
  end if;
  perform 1
    from public.custody_evidence ingress_evidence
    join public.custody_events ingress_event
      on ingress_event.id=ingress_evidence.event_id
    cross join public.custody_evidence egress_evidence
    join public.custody_events egress_event
      on egress_event.id=egress_evidence.event_id
   where ingress_evidence.id=a.ingress_evidence_id
     and egress_evidence.id=a.egress_evidence_id
     and not ingress_evidence.redacted and not egress_evidence.redacted
     and ingress_evidence.kind='foto' and egress_evidence.kind='foto'
     and ingress_evidence.sha256=a.ingress_sha256
     and egress_evidence.sha256=a.egress_sha256
     and ingress_event.physical_unit_id=a.entity_id
     and egress_event.physical_unit_id=a.entity_id
     and ingress_event.stage='recepcion'
     and ingress_event.event_type='foto_ingreso'
     and egress_event.stage='despacho'
     and egress_event.event_type='foto_egreso'
   for share of ingress_evidence,egress_evidence;
  if not found then
    raise exception 'evidencia viva distinta del snapshot del intento'
      using errcode='integrity_constraint_violation';
  end if;
  if jsonb_typeof(p_score_components)<>'object'
     or coalesce(p_score_components - array['identity','packaging','quantity','condition']::text[],'{}'::jsonb)<>'{}'::jsonb
     or jsonb_typeof(p_score_components->'identity')<>'number'
     or jsonb_typeof(p_score_components->'packaging')<>'number'
     or jsonb_typeof(p_score_components->'quantity')<>'number'
     or jsonb_typeof(p_score_components->'condition')<>'number' then
    raise exception 'componentes de score inválidos' using errcode='check_violation';
  end if;
  v_identity:=(p_score_components->>'identity')::numeric;
  v_packaging:=(p_score_components->>'packaging')::numeric;
  v_quantity:=(p_score_components->>'quantity')::numeric;
  v_condition:=(p_score_components->>'condition')::numeric;
  if v_identity not between 0 and 100 or v_packaging not between 0 and 100
     or v_quantity not between 0 and 100 or v_condition not between 0 and 100 then
    raise exception 'componente fuera de 0..100' using errcode='check_violation';
  end if;
  if p_model_confidence is null or p_model_confidence not between 0 and 1
     or p_verdict is null or p_verdict not in('coincide','diferencias','posible_dano')
     or p_packaging_changed is null or p_missing_items_suspected is null or p_damage_suspected is null then
    raise exception 'resultado del proveedor incompleto' using errcode='check_violation';
  end if;
  if (p_damage_suspected and p_verdict<>'posible_dano')
     or (not p_damage_suspected and (p_packaging_changed or p_missing_items_suspected)
         and p_verdict<>'diferencias')
     or (p_verdict='coincide'
         and (p_packaging_changed or p_missing_items_suspected or p_damage_suspected)) then
    raise exception 'verdict incoherente con flags de daño' using errcode='check_violation';
  end if;
  if p_response_model is distinct from a.expected_model then
    raise exception 'modelo de respuesta distinto del congelado' using errcode='integrity_constraint_violation';
  end if;
  if p_provider_response_id is null or length(p_provider_response_id)>128
     or p_request_sha256 !~ '^[0-9a-f]{64}$' or p_response_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'provenance de proveedor inválida' using errcode='check_violation';
  end if;

  v_score:=round((v_identity*a.identity_weight+v_packaging*a.packaging_weight
    +v_quantity*a.quantity_weight+v_condition*a.condition_weight)/100,2);
  v_result:=case when v_score>=a.threshold_percent then 'ABOVE_OR_EQUAL' else 'BELOW' end;
  if v_result='BELOW' then v_holds:=array_append(v_holds,'BELOW_SIMILARITY_THRESHOLD'); end if;
  if p_verdict='diferencias' then v_holds:=array_append(v_holds,'VERDICT_DIFFERENCES'); end if;
  if p_verdict='posible_dano' then v_holds:=array_append(v_holds,'VERDICT_POSSIBLE_DAMAGE'); end if;
  if p_packaging_changed then v_holds:=array_append(v_holds,'PACKAGING_CHANGED'); end if;
  if p_missing_items_suspected then v_holds:=array_append(v_holds,'MISSING_ITEMS_SUSPECTED'); end if;
  if p_damage_suspected then v_holds:=array_append(v_holds,'DAMAGE_SUSPECTED'); end if;

  perform public.custody_chain_lock('physical_unit',c.physical_unit_id);
  v_chain:=public.custody_chain_attestation('physical_unit',c.physical_unit_id);
  if (v_chain->>'status') is distinct from 'verified' then
    v_holds:=array_append(v_holds,'CHAIN_UNVERIFIABLE');
  end if;
  v_state:=case when cardinality(v_holds)=0 then 'REVIEW_REQUIRED' else 'HOLD' end;
  if jsonb_typeof(p_provider_details)<>'object'
     or octet_length(p_provider_details::text)>8192
     or coalesce(p_provider_details-array['observations','zones','openai_request_id']::text[],'{}'::jsonb)<>'{}'::jsonb
     or jsonb_typeof(p_provider_details->'observations')<>'array'
     or jsonb_typeof(p_provider_details->'zones')<>'array'
     or jsonb_array_length(p_provider_details->'observations')>6
     or jsonb_array_length(p_provider_details->'zones')>6
     or exists(select 1 from jsonb_array_elements(p_provider_details->'observations') x
               where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 240)
     or exists(select 1 from jsonb_array_elements(p_provider_details->'zones') x
               where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 120)
     or (p_provider_details ? 'openai_request_id'
         and jsonb_typeof(p_provider_details->'openai_request_id') not in('string','null')) then
    raise exception 'provider_details inválido' using errcode='check_violation';
  end if;
  v_details:=p_provider_details;

  update public.custody_integrity_cases set
    provider=a.expected_provider,model=a.expected_model,prompt_version=a.expected_prompt_version,
    execution_mode='real',outcome='ok',verdict=p_verdict,model_confidence=p_model_confidence,
    similarity_score=v_score,threshold_percent=a.threshold_percent,
    threshold_policy_version=a.policy_version,threshold_result=v_result,
    score_components=p_score_components,packaging_changed=p_packaging_changed,
    missing_items_suspected=p_missing_items_suspected,damage_suspected=p_damage_suspected,
    provider_details=v_details,provider_response_id=p_provider_response_id,
    response_model=p_response_model,system_fingerprint=left(p_system_fingerprint,128),
    request_sha256=p_request_sha256,response_sha256=p_response_sha256,
    prompt_sha256=a.expected_prompt_sha256,response_schema_sha256=a.expected_schema_sha256,
    ingress_observed_sha256=p_ingress_observed_sha256,egress_observed_sha256=p_egress_observed_sha256,
    evaluation_attempt_id=a.id,provider_error=null,hold_reasons=v_holds,state=v_state,
    chain_status=v_chain->>'status',chain_events_checked=(v_chain->>'events_checked')::int,
    chain_head=v_chain->>'chain_head',chain_head_at_evaluation=v_chain->>'chain_head',chain_attested_at=(v_chain->>'attested_at')::timestamptz,
    version=c.version+1,updated_at=now()
   where id=c.id and version=a.case_version_at_start and decision_id is null
   returning version into v_version;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'evaluación no aplicada' using errcode='serialization_failure'; end if;

  update public.custody_integrity_evaluation_attempts set
    status='completed',closed_at=now(),completed_case_version=v_version,
    provider=a.expected_provider,model=a.expected_model,prompt_version=a.expected_prompt_version,
    execution_mode='real',outcome='ok',verdict=p_verdict,model_confidence=p_model_confidence,
    similarity_score=v_score,threshold_result=v_result,score_components=p_score_components,
    packaging_changed=p_packaging_changed,missing_items_suspected=p_missing_items_suspected,
    damage_suspected=p_damage_suspected,provider_details=v_details,
    provider_response_id=p_provider_response_id,response_model=p_response_model,
    system_fingerprint=left(p_system_fingerprint,128),request_sha256=p_request_sha256,
    response_sha256=p_response_sha256,ingress_observed_sha256=p_ingress_observed_sha256,
    egress_observed_sha256=p_egress_observed_sha256
   where id=a.id and status='pending';
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'intento no cerrado' using errcode='serialization_failure'; end if;

  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(a.requested_by,'custody_integrity_case',c.id,'custody.integrity_evaluated_v2',
    jsonb_build_object('attempt_id',a.id,'score',v_score,'threshold',a.threshold_percent,
      'policy',a.policy_version,'threshold_result',v_result,'state',v_state,
      'damage_flags',jsonb_build_object('packaging_changed',p_packaging_changed,
        'missing_items_suspected',p_missing_items_suspected,'damage_suspected',p_damage_suspected)));
  return v_version;
end;
$$;

revoke all on function public.complete_custody_integrity_evaluation_v2(
  uuid,uuid,int,text,text,jsonb,numeric,text,boolean,boolean,boolean,text,text,text,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.complete_custody_integrity_evaluation_v2(
  uuid,uuid,int,text,text,jsonb,numeric,text,boolean,boolean,boolean,text,text,text,text,text,jsonb
) to service_role;

-- -------------------------------------------------------------------------
-- 3 · is_custody_inspection_evidence_v2 · copia exacta de 0250a:1999 con el
--     eslabón evaluado resuelto contra coalesce(testigo, chain_head).
-- -------------------------------------------------------------------------

create or replace function public.is_custody_inspection_evidence_v2(
  p_evidence_id uuid,
  p_case_id uuid
) returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
      from public.custody_integrity_cases c
      join public.custody_integrity_evaluation_attempts a
        on a.id=c.evaluation_attempt_id and a.case_id=c.id
       and a.status='completed' and a.closed_at is not null
      join public.custody_evidence e on e.id=p_evidence_id
      join public.custody_events ev on ev.id=e.event_id
      left join public.custody_events eval_ev
        on eval_ev.physical_unit_id=c.physical_unit_id and eval_ev.row_hash=coalesce(c.chain_head_at_evaluation,c.chain_head)
      join public.custody_inspection_content_claims cl
        on cl.evidence_id=e.id and cl.event_id=ev.id and cl.sha256=e.sha256
      join public.custody_content_attestations att
        on att.id=cl.attestation_id and att.consumed_by_evidence_id=e.id
     where c.id=p_case_id and c.physical_unit_id is not null
       and ev.physical_unit_id=c.physical_unit_id
       and ev.stage='despacho' and ev.event_type='inspeccion_humana'
       and e.kind='foto' and not e.redacted
       and ev.actor_id is not null and e.created_by=ev.actor_id
       and cl.client_id=c.client_id and cl.scope='physical_unit'
       and cl.entity_id=c.physical_unit_id and cl.claimed_by=ev.actor_id
       and att.scope='physical_unit' and att.entity_id=c.physical_unit_id
       and att.client_id=c.client_id and att.revoked_at is null
       and e.id is distinct from c.ingress_evidence_id
       and e.id is distinct from c.egress_evidence_id
       and ev.occurred_at>=a.closed_at and e.created_at>=a.closed_at
       and (coalesce(c.chain_head_at_evaluation,c.chain_head) is null
            or (eval_ev.id is not null and ev.chain_seq>eval_ev.chain_seq))
       and ev.occurred_at >= (
         select max(cmp.occurred_at)
           from public.custody_evidence ce
           join public.custody_events cmp on cmp.id=ce.event_id
          where ce.id in(c.ingress_evidence_id,c.egress_evidence_id)
            and cmp.physical_unit_id=c.physical_unit_id
       )
  );
$$;
revoke all on function public.is_custody_inspection_evidence_v2(uuid,uuid)
  from public,anon,authenticated;


-- -------------------------------------------------------------------------
-- 4 · La lectura del documento, con la compuerta de 0254
--
-- Devuelve, en una sola llamada de sesión:
--   · attestation: la atestación VIVA (custody_chain_attestation), con
--     verified_event_ids y chain_head — lo que la política necesita para
--     EVIDENCE_NOT_LINKED, CHAIN_ATTESTATION_STALE y DECISION_CHAIN_HEAD_MISMATCH;
--   · canonical_inspection_evidence_ids: la re-derivación del conjunto de
--     inspección por el predicado único — el canónico REAL, no un alias del
--     declarado.
-- No expone digests, rutas de storage ni heads ajenos: el head propio del caso
-- ya viaja al documento por el camino existente.
-- -------------------------------------------------------------------------

create or replace function public.custody_certificate_document_v2(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  c public.custody_integrity_cases;
  v_scope text; v_entity uuid; v_att jsonb; v_ids uuid[]:='{}';
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode='insufficient_privilege';
  end if;
  select * into c from public.custody_integrity_cases where id=p_case_id;
  if not found then raise exception 'caso inexistente' using errcode='no_data_found'; end if;
  -- La MISMA compuerta que la política de lectura del certificado (0254:66-69).
  if not (public.current_role() in ('admin','operaciones','supervisor')
          or c.client_id = public.current_client_id()) then
    raise exception 'documento fuera de alcance' using errcode='insufficient_privilege';
  end if;
  if c.physical_unit_id is not null then
    v_scope:='physical_unit'; v_entity:=c.physical_unit_id;
  elsif c.packing_unit_id is not null then
    v_scope:='packing_unit'; v_entity:=c.packing_unit_id;
  else
    v_scope:='shipment'; v_entity:=c.shipment_id;
  end if;
  v_att := public.custody_chain_attestation(v_scope, v_entity);
  if c.physical_unit_id is not null then
    select coalesce(array_agg(e.id order by ev.occurred_at, e.id),'{}') into v_ids
      from public.custody_evidence e
      join public.custody_events ev on ev.id=e.event_id
     where ev.physical_unit_id=c.physical_unit_id
       and public.is_custody_inspection_evidence_v2(e.id, c.id);
  end if;
  return jsonb_build_object(
    'attestation', v_att,
    'canonical_inspection_evidence_ids', to_jsonb(v_ids)
  );
end;
$$;
revoke all on function public.custody_certificate_document_v2(uuid)
  from public,anon,authenticated;
grant execute on function public.custody_certificate_document_v2(uuid)
  to authenticated,service_role;

comment on function public.custody_certificate_document_v2(uuid) is
  '0258 · atestación viva + canónico re-derivado para el documento probatorio. '
  'Compuerta idéntica a la política de lectura de 0254: operativos o tenant.';

commit;

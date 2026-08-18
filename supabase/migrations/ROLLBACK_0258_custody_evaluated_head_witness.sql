-- =========================================================================
-- ROLLBACK LÓGICO · 0258 · EL TESTIGO DE LA PUNTA EVALUADA
--
-- Inversa lógica e IDEMPOTENTE de 0258. NO es forward. Patrón de 0254.
--
-- Restaura las dos funciones redefinidas a su cuerpo EXACTO de 0250a
-- (complete_custody_integrity_evaluation_v2 sin la asignación del testigo;
-- is_custody_inspection_evidence_v2 resolviendo contra c.chain_head), retira
-- la RPC de lectura y elimina la columna testigo.
--
-- ─── LO QUE NO DESHACE, A PROPÓSITO ──────────────────────────────────────
--
-- No borra casos, decisiones, evidencias, certificados ni auditoría. La
-- eliminación de la columna descarta ÚNICAMENTE el testigo — un dato derivado
-- que la re-ejecución de 0258 + una nueva evaluación vuelve a producir; ningún
-- dato primario del expediente vive en ella. Ejecutarlo devuelve el módulo al
-- estado 0257: la re-derivación canónica post-decisión vuelve a dar vacío y el
-- documento vuelve a resolver acta — el defecto que 0258 corrige, documentado
-- en su cabecera.
-- =========================================================================

begin;

drop function if exists public.custody_certificate_document_v2(uuid);

-- is_custody_inspection_evidence_v2 · cuerpo exacto de 0250a:1999
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
        on eval_ev.physical_unit_id=c.physical_unit_id and eval_ev.row_hash=c.chain_head
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
       and (c.chain_head is null
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

-- complete_custody_integrity_evaluation_v2 · cuerpo exacto de 0250a:1405
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
    chain_head=v_chain->>'chain_head',chain_attested_at=(v_chain->>'attested_at')::timestamptz,
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

alter table public.custody_integrity_cases
  drop column if exists chain_head_at_evaluation;

commit;

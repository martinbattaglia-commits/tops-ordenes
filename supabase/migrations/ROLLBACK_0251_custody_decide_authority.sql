-- =========================================================================
-- ROLLBACK LÓGICO · 0251 · AUTORIDAD DE DECISIÓN Y EVIDENCIA COMPLETA
--
-- Inversa lógica e IDEMPOTENTE de 0251. NO es forward.
--
-- Deshace: la guarda de delegación, la concesión a `operaciones`, la lista de
-- roles de cuarentena y la corrección del adjunto. Devuelve las dos funciones
-- a su cuerpo de 0250a.
--
-- ─── LO QUE ESTE ROLLBACK NO DESHACE, A PROPÓSITO ────────────────────────
--
-- NO vuelve a conceder `wms.custody.decide` a `gerencia_comercial` ni a
-- `administracion_finanzas`.
--
-- Un rollback existe para retirar un cambio que salió mal, no para reinstalar
-- una escalada de privilegio. Esa concesión nunca fue una decisión: fue el
-- efecto colateral de un cross join que no excluyó este permiso. Restaurarla
-- «por simetría» dejaría a comercial y a finanzas liberando mercadería de un
-- cliente un lunes a la mañana, que es exactamente el estado que 0251 vino a
-- cerrar. Si Dirección quiere ese estado de vuelta, es una decisión escrita y
-- con su propio diff.
--
-- No borra identidades, eventos, evidencias, intentos, decisiones,
-- certificados ni auditoría.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Retirar la guarda de delegación
-- -------------------------------------------------------------------------

drop trigger if exists trg_custody_forbid_decide_delegation on public.role_permissions;
drop function if exists public.custody_forbid_decide_delegation();


-- -------------------------------------------------------------------------
-- 2. Retirar la concesión a `operaciones`
-- -------------------------------------------------------------------------

delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.slug = 'operaciones'
  and p.slug = 'wms.custody.decide';


-- -------------------------------------------------------------------------
-- 3. `decide_custody_integrity_v2` vuelve al cuerpo de 0250a
--
-- Es decir: SIN lista de roles para la cuarentena. Queda anotado que ese es
-- el hueco que 0251 cerraba.
-- -------------------------------------------------------------------------

create or replace function public.decide_custody_integrity_v2(
  p_case_id uuid,
  p_expected_version int,
  p_decision text,
  p_reason text,
  p_observations text default null,
  p_inspection_evidence_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  c public.custody_integrity_cases;
  a public.custody_integrity_evaluation_attempts;
  v_actor uuid; v_session uuid; v_role text;
  v_new_state text; v_decision uuid; v_evidence uuid; v_seen uuid[]:='{}';
  v_basis text;
  v_live jsonb; v_live_head text; v_eval_seq bigint; v_rows int; v_updated uuid;
begin
  select x.actor_id,x.session_id,x.actor_role into v_actor,v_session,v_role
    from public.assert_custody_access('wms.custody.decide') x;
  if p_decision not in('release','quarantine') then raise exception 'decisión inválida' using errcode='check_violation'; end if;
  if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'motivo insuficiente' using errcode='check_violation'; end if;
  if p_expected_version is null or p_expected_version<=0 then raise exception 'versión inválida' using errcode='check_violation'; end if;

  select * into c from public.custody_integrity_cases where id=p_case_id for update;
  if not found then raise exception 'caso inexistente' using errcode='no_data_found'; end if;
  if c.physical_unit_id is null then raise exception 'decisión v2 exige scope physical_unit' using errcode='check_violation'; end if;
  if c.version<>p_expected_version then raise exception 'conflicto de versión' using errcode='serialization_failure'; end if;
  if c.state not in('REVIEW_REQUIRED','HOLD') or c.decision_id is not null then
    raise exception 'caso no decidible' using errcode='object_not_in_prerequisite_state';
  end if;
  perform public.assert_custody_tenant(v_role,c.client_id);
  perform public.custody_chain_lock('physical_unit',c.physical_unit_id);
  v_live:=public.custody_chain_attestation('physical_unit',c.physical_unit_id);
  if (v_live->>'status') is distinct from 'verified' then
    raise exception 'cadena física no verificable' using errcode='XX001';
  end if;
  v_live_head:=v_live->>'chain_head';
  v_new_state:=case when p_decision='release' then 'RELEASED' else 'QUARANTINED' end;

  if p_decision='release' then
    if v_role<>'admin' then raise exception 'liberación reservada a admin' using errcode='insufficient_privilege'; end if;
    if c.state='REVIEW_REQUIRED' then
      if cardinality(c.hold_reasons)<>0
         or c.outcome is distinct from 'ok' or c.execution_mode is distinct from 'real'
         or c.verdict is distinct from 'coincide'
         or c.threshold_result is distinct from 'ABOVE_OR_EQUAL'
         or c.similarity_score is null or c.threshold_percent is null
         or c.similarity_score<c.threshold_percent
         or coalesce(c.packaging_changed,true) or coalesce(c.missing_items_suspected,true)
         or coalesce(c.damage_suspected,true) then
        raise exception 'evaluación no habilita liberación' using errcode='check_violation';
      end if;
      select * into a from public.custody_integrity_evaluation_attempts
       where id=c.evaluation_attempt_id and case_id=c.id and status='completed'
         and outcome='ok' and completed_case_version=c.version;
      if not found then raise exception 'evaluación sin intento confiable' using errcode='integrity_constraint_violation'; end if;
      if c.chain_head is null then raise exception 'head evaluado ausente' using errcode='check_violation'; end if;
      select chain_seq into v_eval_seq from public.custody_events
       where physical_unit_id=c.physical_unit_id and row_hash=c.chain_head;
      if v_eval_seq is null then raise exception 'head evaluado ajeno al scope' using errcode='XX001'; end if;
      if exists(select 1 from public.custody_events ev
        where ev.physical_unit_id=c.physical_unit_id and ev.chain_seq>v_eval_seq
          and ev.event_type<>'inspeccion_humana') then
        raise exception 'cadena avanzó con eventos no inspeccionados' using errcode='check_violation';
      end if;
      v_basis:='vision_policy';
    else
      if length(btrim(coalesce(p_reason,'')))<20 then
        raise exception 'override de HOLD exige motivo reforzado' using errcode='check_violation';
      end if;
      select * into a from public.custody_integrity_evaluation_attempts
       where id=c.evaluation_attempt_id and case_id=c.id and status='completed';
      if not found then
        raise exception 'override de HOLD sin intento productivo cerrado'
          using errcode='integrity_constraint_violation';
      end if;
      v_basis:='human_override';
    end if;
    if coalesce(array_length(p_inspection_evidence_ids,1),0)=0 then
      raise exception 'inspección humana obligatoria' using errcode='check_violation';
    end if;
  end if;

  insert into public.custody_integrity_decisions(
    case_id,decision,actor_user_id,actor_session_id,actor_role,client_id,permission,
    reason,observations,previous_state,new_state,case_version_at_decision,chain_head_at_decision
  ) values(
    c.id,p_decision,v_actor,v_session,v_role,c.client_id,'wms.custody.decide',
    btrim(p_reason),nullif(btrim(coalesce(p_observations,'')),''),c.state,v_new_state,
    c.version,v_live_head
  ) returning id into v_decision;

  foreach v_evidence in array coalesce(p_inspection_evidence_ids,'{}') loop
    if v_evidence=any(v_seen) then raise exception 'evidencia repetida' using errcode='check_violation'; end if;
    v_seen:=v_seen||v_evidence;
    if not public.is_custody_inspection_evidence_v2(v_evidence,c.id) then
      raise exception 'evidencia de inspección inválida' using errcode='check_violation';
    end if;
    insert into public.custody_integrity_inspection_evidence(decision_id,evidence_id)
    values(v_decision,v_evidence);
  end loop;

  update public.custody_integrity_cases set
    state=v_new_state,decision_id=v_decision,chain_status=v_live->>'status',
    chain_events_checked=(v_live->>'events_checked')::int,chain_head=v_live_head,
    chain_attested_at=(v_live->>'attested_at')::timestamptz,
    version=c.version+1,updated_at=now()
   where id=c.id and version=p_expected_version and decision_id is null
   returning id into v_updated;
  get diagnostics v_rows=row_count;
  if v_rows<>1 or v_updated is null then raise exception 'decisión no aplicada' using errcode='serialization_failure'; end if;

  if p_decision='release' then
    insert into public.custody_release_certificates(
      case_id,decision_id,basis,evaluation_attempt_id,policy_id,physical_unit_id,
      chain_head_at_release,issued_by
    ) values(c.id,v_decision,v_basis,a.id,a.policy_id,c.physical_unit_id,v_live_head,v_actor);
  end if;
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(v_actor,'custody_integrity_case',c.id,'custody.integrity_decided_v2',
    jsonb_build_object('decision',p_decision,'decision_id',v_decision,'new_state',v_new_state,
      'score',c.similarity_score,'threshold',c.threshold_percent,'chain_head',v_live_head,
      'release_basis',v_basis));
  return v_decision;
end;
$$;
revoke all on function public.decide_custody_integrity_v2(uuid,int,text,text,text,uuid[])
  from public,anon,authenticated;
grant execute on function public.decide_custody_integrity_v2(uuid,int,text,text,text,uuid[])
  to authenticated;


-- -------------------------------------------------------------------------
-- 4. `attach_custody_physical_evidence` vuelve al cuerpo de 0250a
--
-- Es decir: con la reescritura incondicional de `EVIDENCE_MISSING`. Queda
-- anotado que ese es el defecto que 0251 corregía.
-- -------------------------------------------------------------------------

create or replace function public.attach_custody_physical_evidence(
  p_physical_unit_id uuid,
  p_stage custody_stage_t,
  p_event_type custody_event_type_t,
  p_storage_path text,
  p_attestation_id uuid,
  p_file_name text default null,
  p_captured_at timestamptz default null,
  p_exif jsonb default null,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_session uuid; v_role text; v_client uuid;
  v_event uuid; v_evidence uuid; v_public text;
  v_case public.custody_integrity_cases;
  att public.custody_content_attestations;
  v_rows int;
begin
  select a.actor_id,a.session_id,a.actor_role into v_actor,v_session,v_role
    from public.assert_custody_access('wms.edit') a;
  select client_id into v_client from public.custody_physical_units
   where id=p_physical_unit_id;
  if not found then raise exception 'unidad física inexistente' using errcode='no_data_found'; end if;
  perform public.assert_custody_tenant(v_role,v_client);
  if not ((p_stage='recepcion' and p_event_type='foto_ingreso')
       or (p_stage='despacho' and p_event_type in('foto_egreso','inspeccion_humana'))) then
    raise exception 'par stage/event_type físico inválido' using errcode='check_violation';
  end if;
  if p_event_type='inspeccion_humana'
     and v_role not in('admin','operaciones','supervisor') then
    raise exception 'inspección no autorizada' using errcode='insufficient_privilege';
  end if;
  if p_storage_path is null or btrim(p_storage_path)='' or length(p_storage_path)>512 then
    raise exception 'storage_path inválido' using errcode='check_violation';
  end if;
  if exists(select 1 from public.custody_evidence
            where storage_bucket='custody-evidence' and storage_path=p_storage_path) then
    raise exception 'storage_path ya utilizado' using errcode='unique_violation';
  end if;

  select * into v_case from public.custody_integrity_cases
   where physical_unit_id=p_physical_unit_id for update;
  if not found then raise exception 'CUSTODY_CASE_MISSING' using errcode='integrity_constraint_violation'; end if;
  if v_case.state in('RELEASED','QUARANTINED') then
    raise exception 'caso terminal' using errcode='unique_violation';
  end if;
  if exists(select 1 from public.custody_integrity_evaluation_attempts
            where case_id=v_case.id and status='pending') then
    raise exception 'evaluación en curso' using errcode='lock_not_available';
  end if;

  update public.custody_content_attestations a set consumed_at=now()
   where a.id=p_attestation_id and a.bucket='custody-evidence'
     and a.storage_path=p_storage_path and a.consumed_at is null
     and a.revoked_at is null and a.expires_at>now()
     and a.actor_id=v_actor and a.session_id=v_session and a.client_id=v_client
     and a.scope='physical_unit' and a.entity_id=p_physical_unit_id
     and a.stage=p_stage and a.event_type=p_event_type
     and a.sha256~'^[0-9a-f]{64}$' and a.size_bytes between 1 and 8388608
     and a.observed_mime_type in('image/jpeg','image/png','image/webp')
  returning a.* into att;
  get diagnostics v_rows=row_count;
  if v_rows<>1 or att.id is null then
    raise exception 'evidencia física sin atestación vigente de bytes reales'
      using errcode='insufficient_privilege';
  end if;
  if p_event_type='foto_egreso' and exists(
    select 1 from public.custody_evidence e
     where e.id=v_case.ingress_evidence_id and e.sha256=att.sha256
  ) then
    raise exception 'la foto de egreso no puede reutilizar los bytes de ingreso'
      using errcode='unique_violation';
  end if;

  insert into public.custody_events(
    physical_unit_id,stage,event_type,actor_id,occurred_at,notes,evidence_sha256
  ) values(p_physical_unit_id,p_stage,p_event_type,v_actor,now(),p_notes,att.sha256)
  returning id,public_id into v_event,v_public;

  insert into public.custody_evidence(
    event_id,kind,storage_bucket,storage_path,file_name,mime_type,size_bytes,sha256,
    captured_at,exif,retention_class,retention_until,created_by
  ) values(
    v_event,'foto','custody-evidence',p_storage_path,p_file_name,att.observed_mime_type,
    att.size_bytes,att.sha256,p_captured_at,p_exif,'evidence',
    coalesce(p_captured_at,now())+interval '2 years',v_actor
  ) returning id into v_evidence;

  if p_event_type='inspeccion_humana' then
    begin
      insert into public.custody_inspection_content_claims(
        sha256,evidence_id,event_id,attestation_id,client_id,scope,entity_id,claimed_by
      ) values(
        att.sha256,v_evidence,v_event,att.id,v_client,'physical_unit',
        p_physical_unit_id,v_actor
      );
    exception when unique_violation then
      raise exception 'contenido de inspección ya utilizado' using errcode='unique_violation';
    end;
  else
    update public.custody_integrity_cases set
      ingress_evidence_id=case when p_event_type='foto_ingreso' then v_evidence else ingress_evidence_id end,
      egress_evidence_id=case when p_event_type='foto_egreso' then v_evidence else egress_evidence_id end,
      state='PENDING_EVIDENCE',hold_reasons=array['EVIDENCE_MISSING']::text[],
      provider=null,model=null,prompt_version=null,execution_mode=null,outcome=null,
      verdict=null,model_confidence=null,provider_error=null,similarity_score=null,
      threshold_percent=null,threshold_policy_version=null,threshold_result=null,
      score_components=null,packaging_changed=null,missing_items_suspected=null,
      damage_suspected=null,provider_details=null,provider_response_id=null,
      response_model=null,system_fingerprint=null,request_sha256=null,response_sha256=null,
      prompt_sha256=null,response_schema_sha256=null,ingress_observed_sha256=null,
      egress_observed_sha256=null,evaluation_attempt_id=null,chain_status=null,
      chain_events_checked=null,chain_head=null,chain_attested_at=null,
      version=version+1,updated_at=now()
    where id=v_case.id;
  end if;

  update public.custody_content_attestations
     set consumed_by_evidence_id=v_evidence where id=att.id;
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(v_actor,'custody_evidence',v_evidence,'custody.physical_evidence_attach',
    jsonb_build_object('physical_unit_id',p_physical_unit_id,'stage',p_stage,
      'event_type',p_event_type,'event_id',v_event,'event_public_id',v_public,
      'content_attested',true));
  return jsonb_build_object('event_id',v_event,'event_public_id',v_public,
    'evidence_id',v_evidence);
end;
$$;
revoke all on function public.attach_custody_physical_evidence(
  uuid,custody_stage_t,custody_event_type_t,text,uuid,text,timestamptz,jsonb,text
) from public,anon,authenticated;
grant execute on function public.attach_custody_physical_evidence(
  uuid,custody_stage_t,custody_event_type_t,text,uuid,text,timestamptz,jsonb,text
) to authenticated,service_role;

notify pgrst, 'reload schema';

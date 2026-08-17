-- =========================================================================
-- 0251 · CUSTODIA DIGITAL · AUTORIDAD DE DECISIÓN Y EVIDENCIA COMPLETA
--
-- Expediente CUSTODIA-CIERRE-CIRCUITO · Sesión 1 · S1-1 y S1-4.
-- Aditiva y forward-only. No edita ninguna migración anterior.
--
-- Cuatro actos:
--
--   1. REVOCAR   `wms.custody.decide` de `gerencia_comercial` y
--                `administracion_finanzas`, y dejar la exclusión ESTRUCTURAL.
--   2. OTORGAR   `wms.custody.decide` a `operaciones`.
--   3. CERRAR    la cuarentena con una lista de roles explícita.
--   4. CORREGIR  `attach_custody_physical_evidence`, que declaraba evidencia
--                faltante incluso cuando el adjunto completaba el par.
--
-- Nada de esto toca identidades, eventos, evidencias, decisiones, certificados
-- ni auditoría.
-- =========================================================================


-- -------------------------------------------------------------------------
-- ACTO 1 · REVOCAR EL COMODÍN
--
-- `20260811230310_rbac_gerencia_finanzas_constraint_safe.sql` hace un cross
-- join sobre TODOS los permisos excluyendo sólo `sistema.%` y
-- `rrhh.documentacion.view`. `wms.custody.decide` no está en ninguna de las dos
-- exclusiones, así que esos dos roles pueden decidir casos de custodia.
--
-- POR QUÉ NO ALCANZA UN DELETE, Y ESTO NO ES CELO DE MÁS.
--
-- El orden de aplicación no es único en este repositorio y las dos lecturas
-- posibles dan resultados opuestos:
--
--   · por el ledger de `supabase/lineage/catalog.json`, el comodín es orden 76
--     y `0222` —que CREA el permiso— es orden 188: el cross join corre antes de
--     que `wms.custody.decide` exista y no lo otorga;
--   · por orden lexicográfico de nombre de archivo, que es lo que hace
--     `supabase db reset`, `0222` corre primero, el comodín después, y SÍ lo
--     otorga. En esa lectura `0251` también ordena ANTES del comodín
--     ('0' < '2'), de modo que un DELETE de una sola vez quedaría deshecho por
--     el propio comodín unos segundos más tarde.
--
-- Por eso el acto es doble: se borra la concesión existente Y se instala una
-- guarda que impide volver a concederla. La guarda NO levanta excepción: omite
-- la fila. Levantarla haría abortar la migración del comodín en una base
-- reconstruida —y con ella el reset entero—, que es un daño mayor que el que
-- se está evitando.
--
-- MOTIVO, ESCRITO PARA QUE QUEDE: decidir sobre un documento probatorio no es
-- función comercial ni contable. Quien libera mercadería de un cliente firma
-- una pieza que puede terminar ante un perito.
-- -------------------------------------------------------------------------

delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.slug in ('gerencia_comercial', 'administracion_finanzas')
  and p.slug = 'wms.custody.decide';

create or replace function public.custody_forbid_decide_delegation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_perm text;
begin
  select slug into v_role from public.roles       where id = new.role_id;
  select slug into v_perm from public.permissions where id = new.permission_id;

  if v_perm = 'wms.custody.decide'
     and v_role in ('gerencia_comercial', 'administracion_finanzas') then
    -- Se OMITE la fila, no se aborta la transacción: un comodín que corra
    -- después de esta migración tiene que poder terminar sin llevarse puesto
    -- el reset completo de la base.
    raise warning
      'wms.custody.decide NO es delegable a %: decidir sobre un documento probatorio no es función comercial ni contable (0251)',
      v_role;
    return null;
  end if;

  return new;
end;
$$;
revoke all on function public.custody_forbid_decide_delegation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_custody_forbid_decide_delegation on public.role_permissions;
create trigger trg_custody_forbid_decide_delegation
  before insert or update on public.role_permissions
  for each row execute function public.custody_forbid_decide_delegation();

comment on function public.custody_forbid_decide_delegation() is
  'S1-1 Acto 1: impide delegar wms.custody.decide a gerencia_comercial y '
  'administracion_finanzas. Omite la fila en vez de abortar, para no romper '
  'la migración comodín 20260811230310 en una base reconstruida. Ampliar la '
  'lista de roles vedados es decisión de Dirección, no de desarrollo.';


-- -------------------------------------------------------------------------
-- ACTO 2 · OTORGAR A `operaciones`
--
-- Decisión de Dirección (D1). Jorge Merino y Juan Carlos Reynoso operan bajo
-- ese rol. NO se crea un rol «encargado de depósito»: el enum de `actor_role`
-- que se graba en la cadena de custodia admite exactamente cuatro valores
-- —admin, operaciones, supervisor, cliente— y extenderlo tocaría una
-- estructura probatoria inmutable. `operaciones` graba `operaciones`, que es
-- verdadero: su descripción en 0009 es literalmente «Encargados de depósito,
-- picking, recepción.».
--
-- Esto habilita CUARENTENA, no liberación. La liberación sigue reservada a
-- `admin` por doble candado —el chequeo de la función y el CHECK de la fila de
-- decisión—, y este acto no lo toca.
-- -------------------------------------------------------------------------

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r, public.permissions p
 where r.slug = 'operaciones'
   and p.slug = 'wms.custody.decide'
on conflict do nothing;


-- -------------------------------------------------------------------------
-- ACTO 3 · CERRAR LA CUARENTENA
--
-- `decide_custody_integrity_v2` (0250a) no tenía NINGUNA lista de roles para
-- la rama de cuarentena: bastaba con tener el permiso. La liberación sí la
-- tenía. Se agrega la lista explícita.
--
-- `cliente` queda EXCLUIDO. Un depositante no cuarentena la mercadería que
-- está bajo custodia de TOPS: informa, y TOPS decide. Si Dirección quiere
-- habilitarlo, será una decisión escrita, no un hueco heredado.
--
-- El resto del cuerpo se reproduce sin cambios respecto de 0250a.
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
  else
    -- 0251 · ACTO 3. Antes de esta línea la cuarentena no tenía ninguna lista
    -- de roles: cualquiera con el permiso podía retener mercadería ajena.
    -- `cliente` queda fuera por decisión de Dirección.
    if v_role not in('admin','operaciones','supervisor') then
      raise exception 'cuarentena reservada a admin, operaciones y supervisor'
        using errcode='insufficient_privilege';
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
-- ACTO 4 · EL ADJUNTO DEJA DE MENTIR SOBRE LA EVIDENCIA (S1-4)
--
-- La versión de 0250a reescribía SIEMPRE `state='PENDING_EVIDENCE'` y
-- `hold_reasons=['EVIDENCE_MISSING']`, también cuando el adjunto que acababa
-- de entrar era el que completaba el par. Con las dos fotos cargadas el caso
-- seguía diciendo que faltaba una, y el checklist del operario mentía.
--
-- Qué cambia, y sólo esto: cuando los dos slots quedan poblados, la retención
-- pasa a `PROVIDER_NOT_EXECUTED` —«el análisis todavía no se ejecutó»—, que es
-- lo que de verdad falta. El estado sigue siendo `PENDING_EVIDENCE` porque sin
-- análisis el caso todavía no es revisable, y la invalidación del análisis
-- previo se conserva entera: las fotos cambiaron, el resultado viejo no vale.
--
-- El resto del cuerpo se reproduce sin cambios respecto de 0250a.
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
  v_ingress uuid; v_egress uuid;
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
    -- 0251 · ACTO 4. Se resuelven los DOS slots primero y recién después se
    -- decide la retención, en vez de afirmar `EVIDENCE_MISSING` de entrada.
    v_ingress := case when p_event_type='foto_ingreso' then v_evidence
                      else v_case.ingress_evidence_id end;
    v_egress  := case when p_event_type='foto_egreso'  then v_evidence
                      else v_case.egress_evidence_id  end;

    update public.custody_integrity_cases set
      ingress_evidence_id=v_ingress,
      egress_evidence_id=v_egress,
      state='PENDING_EVIDENCE',
      hold_reasons=case
        when v_ingress is not null and v_egress is not null
          then array['PROVIDER_NOT_EXECUTED']::text[]
        else array['EVIDENCE_MISSING']::text[]
      end,
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

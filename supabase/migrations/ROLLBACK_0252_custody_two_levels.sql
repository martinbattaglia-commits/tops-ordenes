-- =========================================================================
-- ROLLBACK LÓGICO · 0252 · LOS DOS NIVELES DE CUSTODIA
--
-- Inversa lógica e IDEMPOTENTE de 0252. NO es forward.
--
-- Devuelve las tres funciones a su cuerpo de 0250a —materialización
-- incondicional, genealogía sin filtro de nivel y gate sin excepción— y retira
-- las dos superficies de lectura que 0252 agregó.
--
-- ─── LO QUE NO DESHACE, A PROPÓSITO ──────────────────────────────────────
--
-- NO borra las columnas `clients.custody_level`, `receptions.custody_reforzada`
-- ni `custody_physical_units.custody_level`.
--
-- Un DROP COLUMN destruye el dato: el nivel con el que cada unidad INGRESÓ es
-- información probatoria —dice bajo qué régimen se recibió el bien— y una
-- columna vacía no se puede reconstruir desde el cliente, que puede haber
-- cambiado de plan desde entonces. Volver atrás la lógica es reversible;
-- borrar el registro de cómo entró la mercadería, no.
--
-- Con las funciones repuestas, las columnas quedan inertes: nadie las lee.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Retirar las superficies de lectura de 0252
-- -------------------------------------------------------------------------

drop function if exists public.custody_reception_units(uuid);
drop function if exists public.custody_client_level(uuid);
drop function if exists public.custody_reception_level(uuid);


-- -------------------------------------------------------------------------
-- 2. `custody_materialize_reception_item_row` vuelve al cuerpo de 0250a
--    (materialización INCONDICIONAL: unidad y caso para todo el mundo)
-- -------------------------------------------------------------------------

create or replace function public.custody_materialize_reception_item_row(p_item_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  ri public.reception_items;
  r public.receptions;
  u public.custody_physical_units;
  c public.custody_integrity_cases;
  v_unit uuid;
  v_identity text;
  v_unit_short int;
  v_case_short int;
  v_unit_created boolean:=false;
  v_case_created boolean:=false;
begin
  select * into ri from public.reception_items where id=p_item_id for update;
  if not found then raise exception 'reception_item inexistente' using errcode='no_data_found'; end if;
  if ri.status not in ('recibido','cuarentena') or ri.inventory_item_id is null then
    return null;
  end if;
  select * into r from public.receptions where id=ri.reception_id for share;
  if r.client_id is null then
    raise exception 'recepción sin client_id: identidad física no materializable'
      using errcode='integrity_constraint_violation';
  end if;

  v_identity := encode(sha256(convert_to(concat_ws('|','custody-physical-unit/v1',
    ri.id::text,ri.reception_id::text,ri.inventory_item_id::text,r.client_id::text,
    ri.sku,ri.quantity::text,coalesce(ri.lot_number,''),coalesce(ri.expiration_date::text,''),
    coalesce(ri.position_id::text,'')),'UTF8')),'hex');

  select * into u from public.custody_physical_units where reception_item_id=ri.id;
  if found then
    if u.reception_id<>ri.reception_id or u.inventory_item_id<>ri.inventory_item_id
       or u.client_id<>r.client_id or u.sku<>ri.sku or u.quantity<>ri.quantity
       or u.lot_number is distinct from ri.lot_number
       or u.expiration_date is distinct from ri.expiration_date
       or u.initial_position_id is distinct from ri.position_id
       or u.identity_sha256<>v_identity then
      raise exception 'identidad física preservada divergente'
        using errcode='integrity_constraint_violation';
    end if;
    v_unit:=u.id;
  else
    v_unit_short:=nextval('public.custody_physical_unit_short_id_seq');
    insert into public.custody_physical_units(
      short_id,public_id,reception_id,reception_item_id,inventory_item_id,client_id,sku,quantity,
      lot_number,expiration_date,initial_position_id,identity_sha256,created_by
    ) values (
      v_unit_short,'CPU-'||to_char(now(),'YYYY')||'-'||lpad(v_unit_short::text,6,'0'),
      ri.reception_id,ri.id,ri.inventory_item_id,r.client_id,ri.sku,ri.quantity,
      ri.lot_number,ri.expiration_date,ri.position_id,v_identity,auth.uid()
    ) returning id into v_unit;
    v_unit_created:=true;
  end if;

  select * into c from public.custody_integrity_cases where physical_unit_id=v_unit;
  if found then
    if c.client_id<>r.client_id or c.packing_unit_id is not null or c.shipment_id is not null then
      raise exception 'caso físico preservado divergente'
        using errcode='integrity_constraint_violation';
    end if;
  else
    v_case_short:=nextval('public.custody_integrity_case_short_id_seq');
    insert into public.custody_integrity_cases(
      short_id,public_id,physical_unit_id,client_id,version,state,hold_reasons
    ) values (
      v_case_short,'CINT-'||to_char(now(),'YYYY')||'-'||lpad(v_case_short::text,4,'0'),
      v_unit,r.client_id,1,'PENDING_EVIDENCE',array['EVIDENCE_MISSING']::text[]
    );
    v_case_created:=true;
  end if;

  if v_unit_created or v_case_created then
    insert into public.audit_log(user_id,entity,entity_id,action,payload)
    values(auth.uid(),'custody_physical_unit',v_unit,'custody.physical_unit_materialized',
      jsonb_build_object('reception_id',ri.reception_id,'reception_item_id',ri.id,
        'identity_sha256',v_identity,'unit_created',v_unit_created,
        'case_created',v_case_created));
  end if;
  return v_unit;
end;
$$;
revoke all on function public.custody_materialize_reception_item_row(uuid)
  from public,anon,authenticated,service_role;


-- -------------------------------------------------------------------------
-- 3. `custody_bind_allocation` vuelve al cuerpo de 0250a (sin filtro de nivel)
-- -------------------------------------------------------------------------

create or replace function public.custody_bind_allocation(p_allocation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.stock_allocations;
  u record;
  v_remaining numeric(14,3);
  v_available numeric(14,3);
  v_take numeric(14,3);
  v_bound numeric(14,3);
begin
  select * into a from public.stock_allocations where id=p_allocation_id for update;
  if not found then raise exception 'allocation inexistente' using errcode='no_data_found'; end if;
  perform pg_advisory_xact_lock(hashtext('custody-allocation:'||a.inventory_item_id::text));
  select coalesce(sum(quantity),0) into v_bound
    from public.custody_allocation_physical_units where allocation_id=a.id;
  if v_bound>=a.quantity then return; end if;
  v_remaining:=a.quantity-v_bound;
  for u in
    select pu.*,
      pu.quantity-coalesce((
        select sum(g.quantity)
          from public.custody_allocation_physical_units g
          join public.stock_allocations sa on sa.id=g.allocation_id
         where g.physical_unit_id=pu.id and sa.status<>'liberada'
      ),0) as available
    from public.custody_physical_units pu
    where pu.inventory_item_id=a.inventory_item_id
      and not exists(
        select 1 from public.custody_allocation_physical_units g2
         where g2.allocation_id=a.id and g2.physical_unit_id=pu.id
      )
    order by pu.expiration_date asc nulls last,pu.created_at,pu.id
    for update of pu
  loop
    exit when v_remaining<=0;
    v_available:=u.available;
    if v_available<=0 then continue; end if;
    v_take:=least(v_remaining,v_available);
    insert into public.custody_allocation_physical_units(allocation_id,physical_unit_id,quantity)
    values(a.id,u.id,v_take);
    v_remaining:=v_remaining-v_take;
  end loop;
end;
$$;
revoke all on function public.custody_bind_allocation(uuid)
  from public,anon,authenticated,service_role;


-- -------------------------------------------------------------------------
-- 4. `custody_assert_physical_unit_released` vuelve al cuerpo de 0250a
--    (sin excepción de nivel: toda unidad exige caso y certificado)
-- -------------------------------------------------------------------------

create or replace function public.custody_assert_physical_unit_released(p_physical_unit_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c public.custody_integrity_cases; rc public.custody_release_certificates; v_head text;
begin
  select * into c from public.custody_integrity_cases
   where physical_unit_id=p_physical_unit_id for share;
  if not found then raise exception 'CUSTODY_CASE_MISSING' using errcode='check_violation'; end if;
  perform public.custody_chain_lock('physical_unit',p_physical_unit_id);
  if c.state<>'RELEASED' or c.decision_id is null then
    raise exception 'CUSTODY_HOLD: unidad física no liberada' using errcode='check_violation';
  end if;
  select * into rc from public.custody_release_certificates
     where case_id=c.id and decision_id=c.decision_id and physical_unit_id=p_physical_unit_id
     and basis in('vision_policy','human_override');
  if not found then raise exception 'CUSTODY_RELEASE_CERTIFICATE_MISSING' using errcode='check_violation'; end if;
  select row_hash into v_head from public.custody_events
   where physical_unit_id=p_physical_unit_id order by chain_seq desc limit 1;
  if v_head is null or rc.chain_head_at_release is distinct from v_head then
    raise exception 'CUSTODY_CHAIN_ADVANCED_AFTER_RELEASE' using errcode='check_violation';
  end if;
end;
$$;
revoke all on function public.custody_assert_physical_unit_released(uuid)
  from public,anon,authenticated,service_role;

-- -------------------------------------------------------------------------
-- 5. `attach_custody_physical_evidence` vuelve al cuerpo de 0251
--    (exige caso de integridad para cualquier unidad)
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

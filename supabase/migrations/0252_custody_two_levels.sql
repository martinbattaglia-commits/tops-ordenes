-- =========================================================================
-- 0252 · CUSTODIA DIGITAL · LOS DOS NIVELES (D3)
--
-- Expediente CUSTODIA-CIERRE-CIRCUITO · bloque 2-A · Punto 1.
-- Aditiva y forward-only. No edita ninguna migración anterior.
--
-- ─── EL PROBLEMA ─────────────────────────────────────────────────────────
--
-- El trigger de materialización de 0250a es INCONDICIONAL respecto del
-- cliente: cada ítem recibido abre una unidad física Y un caso de integridad
-- para todo el mundo. La Adenda contrata custodia reforzada por cliente, no
-- para el universo, y un caso abierto arrastra IA, inspección humana
-- bloqueante, certificado y gate de despacho.
--
-- ─── LOS DOS NIVELES ─────────────────────────────────────────────────────
--
--   NIVEL 1 · universal. Unidad física con su foto de ingreso, y nada más:
--             sin caso, sin IA, sin certificado, sin gate de despacho. Es
--             evidencia defensiva propia de TOPS.
--   NIVEL 2 · contratado. Todo el aparato: caso, IA, inspección, certificado
--             y gate. Se habilita POR CLIENTE, con casilla por recepción para
--             elevar un ingreso puntual.
--
-- ─── POR QUÉ SON TRES FUNCIONES Y NO UNA ─────────────────────────────────
--
-- Hacer condicional SÓLO la materialización deja el nivel 1 PEOR que hoy, no
-- mejor, y esto se verificó leyendo el camino entero:
--
--   · `custody_bind_allocation` vincula a la genealogía CUALQUIER unidad
--     física del ítem, sin mirar nivel;
--   · al despachar, `custody_assert_allocation_released` recorre esa
--     genealogía y llama a `custody_assert_physical_unit_released`, que
--     levanta `CUSTODY_CASE_MISSING` si la unidad no tiene caso.
--
-- Es decir: una unidad de nivel 1 —que por definición NO tiene caso— quedaría
-- imposible de despachar para siempre. Las tres funciones se corrigen juntas
-- porque el defecto sólo existe en su composición.
--
-- Esto NO es la «puerta de egreso» del bloque 2-B: aquello es la superficie de
-- picking, packing y despacho. Acá sólo se enseña a los gates existentes que
-- el nivel 1 no tiene gate, que es la mitad de la definición de nivel 1.
--
-- ─── LO QUE NO SE TOCA ───────────────────────────────────────────────────
--
-- Ninguna unidad ni caso ya materializado cambia. `custody_physical_units`
-- estrena la columna con DEFAULT 2, de modo que todo lo preexistente —que sí
-- tiene caso— queda declarado nivel 2, que es lo que de hecho es.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. El nivel contratado vive en el cliente
-- -------------------------------------------------------------------------

alter table public.clients
  add column if not exists custody_level smallint not null default 1;

alter table public.clients
  drop constraint if exists clients_custody_level_ck;
alter table public.clients
  add constraint clients_custody_level_ck check (custody_level in (1, 2));

comment on column public.clients.custody_level is
  'D3 · nivel de custodia contratado. 1 = universal (foto de ingreso). '
  '2 = reforzada (QR, IA, inspección humana, certificado y gate de despacho). '
  'Por defecto 1: la custodia reforzada se contrata, no se presume.';


-- -------------------------------------------------------------------------
-- 2. La recepción puede ELEVAR un ingreso puntual
--
-- Sólo eleva. No existe la operación inversa: un cliente con nivel 2
-- contratado no puede degradarse por recepción, porque eso dejaría bienes
-- contratados fuera del aparato probatorio sin decisión escrita.
-- -------------------------------------------------------------------------

alter table public.receptions
  add column if not exists custody_reforzada boolean not null default false;

comment on column public.receptions.custody_reforzada is
  'D3 · casilla «esta mercadería ingresa por custodia digital reforzada». '
  'ELEVA este ingreso a nivel 2 aunque el cliente sea nivel 1. Nunca degrada.';


-- -------------------------------------------------------------------------
-- 3. Nivel efectivo de una recepción
-- -------------------------------------------------------------------------

create or replace function public.custody_reception_level(p_reception_id uuid)
returns smallint language sql stable security definer set search_path = public as $$
  select case
           when r.custody_reforzada then 2::smallint
           else coalesce(c.custody_level, 1)::smallint
         end
    from public.receptions r
    left join public.clients c on c.id = r.client_id
   where r.id = p_reception_id;
$$;
revoke all on function public.custody_reception_level(uuid)
  from public, anon, authenticated, service_role;

/**
 * Lectura del nivel para la PANTALLA de recepción.
 *
 * `clients` exige `clientes.view` por RLS (0241), que un encargado de depósito
 * no tiene. Sin esto, la casilla de la recepción no podría tomar su valor por
 * defecto de la bandera del cliente y el operario tendría que adivinarlo.
 *
 * Devuelve un entero y nada más: ni razón social, ni CUIT, ni ningún dato del
 * maestro. Exige `wms.view`, que es el permiso de quien opera recepciones.
 */
create or replace function public.custody_client_level(p_client_id uuid)
returns smallint language plpgsql stable security definer set search_path = public as $$
declare v_level smallint;
begin
  perform public.assert_custody_access('wms.view');
  if p_client_id is null then return 1::smallint; end if;
  select coalesce(custody_level, 1) into v_level from public.clients where id = p_client_id;
  return coalesce(v_level, 1)::smallint;
end;
$$;
revoke all on function public.custody_client_level(uuid) from public, anon;
grant execute on function public.custody_client_level(uuid) to authenticated, service_role;


-- -------------------------------------------------------------------------
-- 4. El nivel queda ESTAMPADO en la unidad física
--
-- No se re-deriva del cliente al despachar: el cliente puede cambiar de plan
-- entre el ingreso y la salida, y el bien tiene que salir bajo el régimen con
-- el que entró. DEFAULT 2 preserva todo lo ya materializado.
-- -------------------------------------------------------------------------

alter table public.custody_physical_units
  add column if not exists custody_level smallint not null default 2;

alter table public.custody_physical_units
  drop constraint if exists custody_physical_units_level_ck;
alter table public.custody_physical_units
  add constraint custody_physical_units_level_ck check (custody_level in (1, 2));

comment on column public.custody_physical_units.custody_level is
  'D3 · régimen con el que la unidad INGRESÓ. Nivel 1 no tiene caso de '
  'integridad ni gate de despacho. DEFAULT 2 porque toda unidad anterior a '
  '0252 se materializó con caso.';


-- -------------------------------------------------------------------------
-- 5. Materialización CONDICIONAL
--
-- La unidad se crea SIEMPRE: es lo que sostiene la foto de ingreso, que el
-- nivel 1 también exige. El CASO se crea sólo en nivel 2.
--
-- El resto del cuerpo se reproduce sin cambios respecto de 0250a.
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
  v_level smallint;
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

  -- 0252 · D3. El nivel se resuelve UNA vez, acá, y queda estampado.
  v_level := public.custody_reception_level(ri.reception_id);

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
    v_level:=u.custody_level;  -- el régimen de ingreso no se re-deriva
  else
    v_unit_short:=nextval('public.custody_physical_unit_short_id_seq');
    insert into public.custody_physical_units(
      short_id,public_id,reception_id,reception_item_id,inventory_item_id,client_id,sku,quantity,
      lot_number,expiration_date,initial_position_id,identity_sha256,created_by,custody_level
    ) values (
      v_unit_short,'CPU-'||to_char(now(),'YYYY')||'-'||lpad(v_unit_short::text,6,'0'),
      ri.reception_id,ri.id,ri.inventory_item_id,r.client_id,ri.sku,ri.quantity,
      ri.lot_number,ri.expiration_date,ri.position_id,v_identity,auth.uid(),v_level
    ) returning id into v_unit;
    v_unit_created:=true;
  end if;

  -- 0252 · el CASO es aparato de nivel 2. En nivel 1 la unidad queda con su
  -- foto y sin caso, que es exactamente la definición del nivel.
  if v_level >= 2 then
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
  end if;

  if v_unit_created or v_case_created then
    insert into public.audit_log(user_id,entity,entity_id,action,payload)
    values(auth.uid(),'custody_physical_unit',v_unit,'custody.physical_unit_materialized',
      jsonb_build_object('reception_id',ri.reception_id,'reception_item_id',ri.id,
        'identity_sha256',v_identity,'unit_created',v_unit_created,
        'case_created',v_case_created,'custody_level',v_level));
  end if;
  return v_unit;
end;
$$;
revoke all on function public.custody_materialize_reception_item_row(uuid)
  from public,anon,authenticated,service_role;


-- -------------------------------------------------------------------------
-- 6. La genealogía sólo vincula unidades de NIVEL 2
--
-- Vincular una unidad de nivel 1 la sometería a `custody_assert_allocation_released`,
-- que exige caso y certificado. El nivel 1 no los tiene por definición, así que
-- entraría a la genealogía sólo para volverse indespachable.
--
-- El resto del cuerpo se reproduce sin cambios respecto de 0250a.
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
      -- 0252 · D3. El nivel 1 no entra a la genealogía: no tiene gate.
      and pu.custody_level >= 2
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
  -- DECISIÓN DE DOMINIO conservada de 0250a: la cobertura incompleta NO aborta
  -- la reserva. Reservar no saca el bien de custodia; despachar sí.
end;
$$;
revoke all on function public.custody_bind_allocation(uuid)
  from public,anon,authenticated,service_role;


-- -------------------------------------------------------------------------
-- 7. El gate reconoce el nivel 1 — defensa en profundidad
--
-- Con el punto 6 una unidad de nivel 1 no debería llegar acá. Si llegara por
-- una genealogía anterior a 0252 o por un camino futuro, el gate tiene que
-- decir la verdad —el nivel 1 no tiene gate— en vez de levantar
-- `CUSTODY_CASE_MISSING`, que sería culpar a la unidad de no tener algo que su
-- régimen no contempla.
--
-- El resto del cuerpo se reproduce sin cambios respecto de 0250a.
-- -------------------------------------------------------------------------

create or replace function public.custody_assert_physical_unit_released(p_physical_unit_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  c public.custody_integrity_cases;
  rc public.custody_release_certificates;
  v_head text;
  v_level smallint;
begin
  select custody_level into v_level from public.custody_physical_units
   where id=p_physical_unit_id;
  if v_level is null then
    raise exception 'unidad física inexistente' using errcode='no_data_found';
  end if;
  -- 0252 · D3. Nivel 1: evidencia defensiva, sin gate de despacho.
  if v_level < 2 then return; end if;

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
-- 7b. El adjunto de evidencia acepta el NIVEL 1
--
-- CUARTO lugar del mismo acoplamiento, y lo encontró la prueba de recorrido,
-- no una lectura: `attach_custody_physical_evidence` (0251) levantaba
-- `CUSTODY_CASE_MISSING` si la unidad no tenía caso. Con 0252 el nivel 1 no lo
-- tiene POR DEFINICIÓN, así que la foto de ingreso —que es literalmente lo
-- único que el nivel 1 contempla— resultaba imposible de registrar.
--
-- Qué cambia, y sólo esto: sin caso, el evento y la evidencia se registran
-- igual en la cadena de la unidad y se omite la actualización del caso. La
-- inspección humana sigue exigiendo caso: es un acto del aparato de nivel 2.
--
-- El resto del cuerpo se reproduce sin cambios respecto de 0251.
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
  v_level smallint;
  v_con_caso boolean;
begin
  select a.actor_id,a.session_id,a.actor_role into v_actor,v_session,v_role
    from public.assert_custody_access('wms.edit') a;
  select client_id,custody_level into v_client,v_level from public.custody_physical_units
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
  v_con_caso := found;

  -- 0252 · NIVEL 1. Sin caso no hay aparato que actualizar, pero la foto sí se
  -- registra: es la evidencia defensiva que el nivel 1 contrata.
  if not v_con_caso then
    if v_level >= 2 then
      raise exception 'CUSTODY_CASE_MISSING' using errcode='integrity_constraint_violation';
    end if;
    if p_event_type='inspeccion_humana' then
      raise exception 'la inspección humana exige un caso de integridad'
        using errcode='object_not_in_prerequisite_state';
    end if;
  else
    if v_case.state in('RELEASED','QUARANTINED') then
      raise exception 'caso terminal' using errcode='unique_violation';
    end if;
    if exists(select 1 from public.custody_integrity_evaluation_attempts
              where case_id=v_case.id and status='pending') then
      raise exception 'evaluación en curso' using errcode='lock_not_available';
    end if;
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
  if v_con_caso and p_event_type='foto_egreso' and exists(
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
  elsif v_con_caso then
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
      'content_attested',true,'custody_level',v_level));
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

-- -------------------------------------------------------------------------
-- 8. Lectura de las unidades creadas por una recepción (S2-2)
--
-- La pantalla necesita listar, después de confirmar, qué unidades nacieron y
-- enlazar a su caso cuando lo tengan. `custody_physical_units` ya es legible
-- por RLS para los roles internos; esto agrega la unión con el caso sin
-- exponer nada nuevo.
-- -------------------------------------------------------------------------

create or replace function public.custody_reception_units(p_reception_id uuid)
returns table(
  physical_unit_id uuid,
  reception_item_id uuid,
  unit_public_id text,
  sku text,
  quantity numeric,
  lot_number text,
  custody_level smallint,
  case_id uuid,
  case_public_id text,
  case_state text,
  has_ingress_photo boolean
) language plpgsql stable security definer set search_path=public as $$
declare v_role text;
begin
  select a.actor_role into v_role from public.assert_custody_access('wms.view') a;
  return query
    select u.id, u.reception_item_id, u.public_id, u.sku, u.quantity, u.lot_number, u.custody_level,
           c.id, c.public_id, c.state,
           exists(select 1 from public.custody_events ev
                   where ev.physical_unit_id=u.id and ev.event_type='foto_ingreso')
      from public.custody_physical_units u
      left join public.custody_integrity_cases c on c.physical_unit_id=u.id
     where u.reception_id=p_reception_id
       and (v_role in ('admin','operaciones','supervisor')
            or u.client_id=public.current_client_id())
     order by u.public_id;
end;
$$;
revoke all on function public.custody_reception_units(uuid) from public,anon;
grant execute on function public.custody_reception_units(uuid) to authenticated,service_role;

notify pgrst, 'reload schema';

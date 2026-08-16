-- =========================================================================
-- 0250a · CUSTODIA VISIÓN PRODUCTIVA 001
--
-- Scope físico DB-owned, evidencia de ingreso/egreso, evaluación OpenAI con
-- política inmutable (umbral 90), score reproducible, HOLD, decisión humana y
-- gates globales para despacho, entrega y POD.
--
-- Depende de: 0035, 0039, 0220, 0222–0226, 0231, 0232 y 0250.
-- No ejecuta migraciones ni despliegues productivos por sí sola.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Identidad física inmutable: una unidad trazable por reception_item.
--    quantity es numeric(14,3); no se inventa que cada entero sea una pieza.
-- -------------------------------------------------------------------------

create sequence if not exists public.custody_physical_unit_short_id_seq start 1;

create table if not exists public.custody_physical_units (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.custody_physical_unit_short_id_seq'),
  public_id text not null unique,
  custody_token uuid not null default gen_random_uuid() unique,
  reception_id uuid not null references public.receptions(id) on delete restrict,
  reception_item_id uuid not null unique references public.reception_items(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  sku text not null,
  quantity numeric(14,3) not null,
  lot_number text,
  expiration_date date,
  initial_position_id uuid references public.warehouse_positions(id) on delete restrict,
  identity_sha256 text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint custody_physical_units_qty_ck check (quantity > 0),
  constraint custody_physical_units_hash_ck check (identity_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists custody_physical_units_inventory_idx
  on public.custody_physical_units(inventory_item_id, created_at, id);
create index if not exists custody_physical_units_client_idx
  on public.custody_physical_units(client_id);

create or replace function public.prevent_custody_physical_unit_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'custody_physical_units es inmutable: % no está permitido', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_custody_physical_units_immutable on public.custody_physical_units;
create trigger trg_custody_physical_units_immutable
  before update or delete on public.custody_physical_units
  for each row execute function public.prevent_custody_physical_unit_mutation();
drop trigger if exists trg_custody_physical_units_no_truncate on public.custody_physical_units;
create trigger trg_custody_physical_units_no_truncate
  before truncate on public.custody_physical_units
  for each statement execute function public.prevent_custody_physical_unit_mutation();

alter table public.custody_physical_units enable row level security;
revoke all on public.custody_physical_units from public, anon, authenticated, service_role;
grant select on public.custody_physical_units to authenticated, service_role;
drop policy if exists custody_physical_units_read on public.custody_physical_units;
create policy custody_physical_units_read on public.custody_physical_units
  for select to authenticated
  using (
    public.current_role() in ('admin','operaciones','supervisor')
    or client_id = public.current_client_id()
  );

-- -------------------------------------------------------------------------
-- 2. Tercer scope real. Los hashes legacy conservan su fórmula byte a byte.
-- -------------------------------------------------------------------------

alter table public.custody_events
  add column if not exists physical_unit_id uuid
    references public.custody_physical_units(id) on delete restrict;
create index if not exists custody_events_physical_unit_idx
  on public.custody_events(physical_unit_id, chain_seq);

alter table public.custody_events
  drop constraint if exists custody_events_one_scope_chk;
alter table public.custody_events
  add constraint custody_events_one_scope_chk
  check (num_nonnulls(physical_unit_id, packing_unit_id, shipment_id) = 1);

alter table public.custody_events
  drop constraint if exists custody_events_stage_type_chk;
alter table public.custody_events
  add constraint custody_events_stage_type_chk check (
       (stage = 'recepcion'  and event_type = 'foto_ingreso')
    or (stage = 'packing'    and event_type = 'foto_packing')
    or (stage = 'despacho'   and event_type in ('foto_egreso','cargado','inspeccion_humana'))
    or (stage = 'transporte' and event_type = 'en_transito')
    or (stage = 'entrega'    and event_type in ('foto_entrega','firmado'))
    or (stage = 'pod'        and event_type = 'pod')
  );

alter table public.custody_integrity_cases
  add column if not exists physical_unit_id uuid
    references public.custody_physical_units(id) on delete restrict;
create unique index if not exists custody_integrity_cases_physical_unit_uk
  on public.custody_integrity_cases(physical_unit_id)
  where physical_unit_id is not null;

alter table public.custody_integrity_cases
  drop constraint if exists custody_integrity_cases_one_scope_chk;
alter table public.custody_integrity_cases
  add constraint custody_integrity_cases_one_scope_chk
  check (num_nonnulls(physical_unit_id, packing_unit_id, shipment_id) = 1);

alter table public.custody_integrity_cases
  drop constraint if exists custody_integrity_cases_state_chk;
alter table public.custody_integrity_cases
  add constraint custody_integrity_cases_state_chk
  check (state in ('PENDING_EVIDENCE','HOLD','REVIEW_REQUIRED','RELEASED','QUARANTINED'));

alter table public.custody_integrity_evaluation_attempts
  drop constraint if exists custody_integrity_attempts_scope_chk;
alter table public.custody_integrity_evaluation_attempts
  add constraint custody_integrity_attempts_scope_chk
  check (scope in ('physical_unit','packing_unit','shipment'));

create or replace function public.custody_entity_client_id(p_scope text, p_entity_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_scope
    when 'physical_unit' then (
      select u.client_id from public.custody_physical_units u where u.id = p_entity_id
    )
    when 'packing_unit' then (
      select lo.client_id
        from public.packing_units pu
        join public.logistics_orders lo on lo.id = pu.order_id
       where pu.id = p_entity_id
    )
    when 'shipment' then (
      select lo.client_id
        from public.shipments s
        join public.logistics_orders lo on lo.id = s.order_id
       where s.id = p_entity_id
    )
  end;
$$;
revoke all on function public.custody_entity_client_id(text,uuid)
  from public, anon, authenticated;

create or replace function public.custody_row_client_id_v2(
  p_physical_unit_id uuid,
  p_packing_unit_id uuid,
  p_shipment_id uuid
) returns uuid language sql stable security definer set search_path = public as $$
  select case
    when p_physical_unit_id is not null
      then public.custody_entity_client_id('physical_unit', p_physical_unit_id)
    when p_packing_unit_id is not null
      then public.custody_entity_client_id('packing_unit', p_packing_unit_id)
    when p_shipment_id is not null
      then public.custody_entity_client_id('shipment', p_shipment_id)
  end;
$$;
revoke all on function public.custody_row_client_id_v2(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.custody_row_client_id_v2(uuid,uuid,uuid)
  to authenticated, service_role;

drop policy if exists "custody_events read" on public.custody_events;
create policy "custody_events read" on public.custody_events for select to authenticated
  using (
    public.current_role() in ('admin','operaciones','supervisor')
    or public.custody_row_client_id_v2(physical_unit_id,packing_unit_id,shipment_id)
       = public.current_client_id()
  );

drop policy if exists "custody_evidence read" on public.custody_evidence;
create policy "custody_evidence read" on public.custody_evidence for select to authenticated
  using (
    public.current_role() in ('admin','operaciones','supervisor')
    or public.custody_evidence_client_id(id) = public.current_client_id()
  );

create or replace function public.custody_evidence_client_id(p_evidence_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select public.custody_row_client_id_v2(
    ev.physical_unit_id, ev.packing_unit_id, ev.shipment_id
  )
    from public.custody_evidence e
    join public.custody_events ev on ev.id = e.event_id
   where e.id = p_evidence_id;
$$;
revoke all on function public.custody_evidence_client_id(uuid)
  from public, anon, authenticated;
grant execute on function public.custody_evidence_client_id(uuid)
  to authenticated, service_role;

create or replace function public.custody_chain_lock(p_scope text, p_entity_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_entity_id is null then
    raise exception 'entidad nula: no hay cadena que serializar' using errcode = 'check_violation';
  end if;
  case p_scope
    when 'physical_unit' then
      perform pg_advisory_xact_lock(hashtext('custody_chain:phys:' || p_entity_id::text));
    when 'packing_unit' then
      perform pg_advisory_xact_lock(hashtext('custody_chain:pu:' || p_entity_id::text));
    when 'shipment' then
      perform pg_advisory_xact_lock(hashtext('custody_chain:sh:' || p_entity_id::text));
    else
      raise exception 'scope inválido para lock de cadena: %', p_scope
        using errcode = 'check_violation';
  end case;
end;
$$;
revoke all on function public.custody_chain_lock(text,uuid)
  from public, anon, authenticated;

create or replace function public.custody_event_hashchain()
returns trigger language plpgsql set search_path = public as $$
declare
  v_scope text;
  v_entity uuid;
  v_prev text;
  v_canon text;
begin
  if num_nonnulls(new.physical_unit_id,new.packing_unit_id,new.shipment_id) <> 1 then
    raise exception 'scope de cadena inválido' using errcode = 'check_violation';
  end if;

  if new.physical_unit_id is not null then
    v_scope := 'physical_unit'; v_entity := new.physical_unit_id;
  elsif new.packing_unit_id is not null then
    v_scope := 'packing_unit'; v_entity := new.packing_unit_id;
  else
    v_scope := 'shipment'; v_entity := new.shipment_id;
  end if;

  perform public.custody_chain_lock(v_scope,v_entity);

  select e.row_hash into v_prev
    from public.custody_events e
   where (v_scope='physical_unit' and e.physical_unit_id=v_entity)
      or (v_scope='packing_unit' and e.packing_unit_id=v_entity)
      or (v_scope='shipment' and e.shipment_id=v_entity)
   order by e.chain_seq desc limit 1;

  new.prev_hash := v_prev;
  if v_scope = 'physical_unit' then
    v_canon := concat_ws('|',
      new.physical_unit_id::text, '', '',
      new.stage::text, new.event_type::text,
      coalesce(new.actor_id::text,''),
      to_char(new.occurred_at at time zone 'UTC','YYYYMMDD"T"HH24MISS.US'),
      coalesce(new.geo_lat::text,''), coalesce(new.geo_lng::text,''),
      coalesce(new.evidence_sha256,''), coalesce(new.notes,''));
  else
    -- Fórmula legacy EXACTA de 0036/0222. No añadir un separador vacío.
    v_canon := concat_ws('|',
      coalesce(new.packing_unit_id::text,''),
      coalesce(new.shipment_id::text,''),
      new.stage::text, new.event_type::text,
      coalesce(new.actor_id::text,''),
      to_char(new.occurred_at at time zone 'UTC','YYYYMMDD"T"HH24MISS.US'),
      coalesce(new.geo_lat::text,''), coalesce(new.geo_lng::text,''),
      coalesce(new.evidence_sha256,''), coalesce(new.notes,''));
  end if;
  new.row_hash := encode(sha256(convert_to(coalesce(v_prev,'') || '||' || v_canon,'UTF8')),'hex');
  return new;
end;
$$;

create or replace function public.custody_chain_attestation(p_scope text,p_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_total int := 0;
  v_valid boolean := true;
  v_first_error jsonb;
  v_expected_prev text;
  v_canon text;
  v_expected_row text;
  v_ids uuid[] := '{}';
  v_head text;
  v_status text;
  v_attested timestamptz;
begin
  if p_scope not in ('physical_unit','packing_unit','shipment') or p_entity_id is null then
    raise exception 'scope o entidad inválidos' using errcode = 'check_violation';
  end if;

  for r in
    select e.* from public.custody_events e
     where (p_scope='physical_unit' and e.physical_unit_id=p_entity_id)
        or (p_scope='packing_unit' and e.packing_unit_id=p_entity_id)
        or (p_scope='shipment' and e.shipment_id=p_entity_id)
     order by e.chain_seq
  loop
    v_total := v_total + 1;
    if p_scope = 'physical_unit' then
      v_canon := concat_ws('|',r.physical_unit_id::text,'','',r.stage::text,r.event_type::text,
        coalesce(r.actor_id::text,''),
        to_char(r.occurred_at at time zone 'UTC','YYYYMMDD"T"HH24MISS.US'),
        coalesce(r.geo_lat::text,''),coalesce(r.geo_lng::text,''),
        coalesce(r.evidence_sha256,''),coalesce(r.notes,''));
    else
      v_canon := concat_ws('|',coalesce(r.packing_unit_id::text,''),coalesce(r.shipment_id::text,''),
        r.stage::text,r.event_type::text,coalesce(r.actor_id::text,''),
        to_char(r.occurred_at at time zone 'UTC','YYYYMMDD"T"HH24MISS.US'),
        coalesce(r.geo_lat::text,''),coalesce(r.geo_lng::text,''),
        coalesce(r.evidence_sha256,''),coalesce(r.notes,''));
    end if;
    v_expected_row := encode(sha256(convert_to(coalesce(v_expected_prev,'') || '||' || v_canon,'UTF8')),'hex');
    if r.prev_hash is distinct from v_expected_prev then
      v_valid := false;
      v_first_error := jsonb_build_object('public_id',r.public_id,'chain_seq',r.chain_seq,'reason','prev_hash discontinuo');
      exit;
    end if;
    if r.row_hash is distinct from v_expected_row then
      v_valid := false;
      v_first_error := jsonb_build_object('public_id',r.public_id,'chain_seq',r.chain_seq,'reason','row_hash no coincide');
      exit;
    end if;
    v_ids := v_ids || r.id;
    v_expected_prev := r.row_hash;
  end loop;

  if v_total=0 then v_status:='unverifiable'; v_valid:=false;
  elsif v_valid then v_status:='verified';
  else v_status:='invalid'; end if;
  if v_status='verified' then v_head:=v_expected_prev; v_attested:=now(); end if;

  return jsonb_build_object(
    'valid',v_valid,'events_checked',v_total,'first_error',v_first_error,
    'status',v_status,'scope',p_scope,'entity_id',p_entity_id,
    'verified_event_ids',to_jsonb(v_ids),'chain_head',v_head,'attested_at',v_attested
  );
end;
$$;
revoke all on function public.custody_chain_attestation(text,uuid)
  from public, anon, authenticated;

create or replace function public.verify_custody_chain_v2(p_scope text,p_entity_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_client uuid; v_att jsonb;
begin
  select a.actor_role into v_role from public.assert_custody_access('wms.edit') a;
  v_client := public.custody_entity_client_id(p_scope,p_entity_id);
  perform public.assert_custody_tenant(v_role,v_client);
  perform public.custody_chain_lock(p_scope,p_entity_id);
  v_att := public.custody_chain_attestation(p_scope,p_entity_id);
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(auth.uid(),p_scope,p_entity_id,'custody.chain_verify_v2',
    jsonb_build_object('status',v_att->>'status','events_checked',v_att->'events_checked'));
  return v_att;
end;
$$;
revoke all on function public.verify_custody_chain_v2(text,uuid) from public,anon,authenticated;
grant execute on function public.verify_custody_chain_v2(text,uuid) to authenticated,service_role;

-- -------------------------------------------------------------------------
-- 3. Materialización DB-owned: recepción -> unidad física -> caso obligatorio.
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

create or replace function public.custody_materialize_reception_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.custody_materialize_reception_item_row(new.id);
  return new;
end;
$$;

drop trigger if exists trg_custody_materialize_reception_item on public.reception_items;
create trigger trg_custody_materialize_reception_item
  after insert or update of status,inventory_item_id on public.reception_items
  for each row when (new.status in ('recibido','cuarentena') and new.inventory_item_id is not null)
  execute function public.custody_materialize_reception_item();

create or replace function public.custody_lock_reception_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.custody_physical_units u where u.reception_item_id=old.id) then
    if tg_op='DELETE' then
      raise exception 'reception_item con identidad física: DELETE bloqueado'
        using errcode='restrict_violation';
    end if;
    if new.reception_id is distinct from old.reception_id
       or new.inventory_item_id is distinct from old.inventory_item_id
       or new.sku is distinct from old.sku
       or new.quantity is distinct from old.quantity
       or new.lot_number is distinct from old.lot_number
       or new.expiration_date is distinct from old.expiration_date
       or new.position_id is distinct from old.position_id then
      raise exception 'identidad física de recepción ya materializada'
        using errcode='restrict_violation';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_custody_lock_reception_identity on public.reception_items;
create trigger trg_custody_lock_reception_identity
  before update or delete on public.reception_items
  for each row execute function public.custody_lock_reception_identity();

-- Backfill idempotente y determinista sobre filas ya confirmadas.
do $$ declare x record; begin
  for x in
    select id from public.reception_items
     where status in ('recibido','cuarentena') and inventory_item_id is not null
     order by created_at,id
  loop
    perform public.custody_materialize_reception_item_row(x.id);
  end loop;
end $$;

-- Coherencia de caso ampliada a scope físico y comparación explícita de scope.
create or replace function public.assert_custody_integrity_case_coherence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.custody_integrity_cases;
  d public.custody_integrity_decisions;
  v_scope text;
  v_entity uuid;
  v_client uuid;
begin
  select * into c from public.custody_integrity_cases where id=new.id;
  if not found then return null; end if;
  if c.physical_unit_id is not null then v_scope:='physical_unit'; v_entity:=c.physical_unit_id;
  elsif c.packing_unit_id is not null then v_scope:='packing_unit'; v_entity:=c.packing_unit_id;
  else v_scope:='shipment'; v_entity:=c.shipment_id; end if;
  v_client:=public.custody_entity_client_id(v_scope,v_entity);
  if v_client is null or v_client<>c.client_id then
    raise exception 'client_id del caso no coincide con su entidad'
      using errcode='integrity_constraint_violation';
  end if;
  if exists(
    select 1 from public.custody_evidence e
    join public.custody_events ev on ev.id=e.event_id
    where e.id in(c.ingress_evidence_id,c.egress_evidence_id)
      and not (
        (v_scope='physical_unit' and ev.physical_unit_id=v_entity)
        or (v_scope='packing_unit' and ev.packing_unit_id=v_entity)
        or (v_scope='shipment' and ev.shipment_id=v_entity)
      )
  ) then
    raise exception 'evidencia ajena al scope del caso'
      using errcode='integrity_constraint_violation';
  end if;
  if c.state in('RELEASED','QUARANTINED') then
    select * into d from public.custody_integrity_decisions where id=c.decision_id;
    if not found or d.case_id<>c.id or d.new_state<>c.state or d.client_id<>c.client_id then
      raise exception 'decisión incoherente con caso terminal'
        using errcode='integrity_constraint_violation';
    end if;
    if d.decision='release' and not exists(
      select 1 from public.custody_integrity_inspection_evidence i where i.decision_id=d.id
    ) then
      raise exception 'liberación sin inspección humana'
        using errcode='integrity_constraint_violation';
    end if;
  end if;
  return null;
end;
$$;

-- -------------------------------------------------------------------------
-- 4. Genealogía cuantitativa inventory allocation -> unidad física.
-- -------------------------------------------------------------------------

create table if not exists public.custody_allocation_physical_units(
  allocation_id uuid not null references public.stock_allocations(id) on delete restrict,
  physical_unit_id uuid not null references public.custody_physical_units(id) on delete restrict,
  quantity numeric(14,3) not null,
  created_at timestamptz not null default now(),
  primary key(allocation_id,physical_unit_id),
  constraint custody_allocation_physical_qty_ck check(quantity>0)
);

create index if not exists custody_allocation_physical_unit_idx
  on public.custody_allocation_physical_units(physical_unit_id);
alter table public.custody_allocation_physical_units enable row level security;
revoke all on public.custody_allocation_physical_units from public,anon,authenticated,service_role;
grant select on public.custody_allocation_physical_units to authenticated,service_role;

drop trigger if exists trg_custody_allocation_physical_immutable on public.custody_allocation_physical_units;
create trigger trg_custody_allocation_physical_immutable
  before update or delete on public.custody_allocation_physical_units
  for each row execute function public.prevent_custody_integrity_mutation();
drop trigger if exists trg_custody_allocation_physical_no_truncate on public.custody_allocation_physical_units;
create trigger trg_custody_allocation_physical_no_truncate
  before truncate on public.custody_allocation_physical_units
  for each statement execute function public.prevent_custody_integrity_mutation();

create or replace function public.guard_custody_allocation_physical_unit()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  a public.stock_allocations;
  u public.custody_physical_units;
  v_used numeric(14,3);
begin
  select * into a from public.stock_allocations where id=new.allocation_id;
  select * into u from public.custody_physical_units where id=new.physical_unit_id;
  -- La coherencia que importa es el ÍTEM: es lo que identifica al bien. El lote
  -- de la allocation es el representativo que estampa `allocate_order` (0031),
  -- no el conjunto de lotes efectivamente picados, así que exigir igualdad acá
  -- rechazaba la segunda mitad de toda reserva multi-lote.
  if a.id is null or u.id is null
     or a.inventory_item_id<>u.inventory_item_id then
    raise exception 'bridge físico incoherente con el ítem de inventario'
      using errcode='integrity_constraint_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('custody-allocation:'||a.inventory_item_id::text));
  select coalesce(sum(g.quantity),0) into v_used
    from public.custody_allocation_physical_units g
    join public.stock_allocations sa on sa.id=g.allocation_id
   where g.physical_unit_id=u.id and sa.status<>'liberada';
  if a.status<>'liberada' and v_used+new.quantity>u.quantity then
    raise exception 'sobreasignación física concurrente'
      using errcode='integrity_constraint_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_custody_allocation_physical_coherence
  on public.custody_allocation_physical_units;
create trigger trg_custody_allocation_physical_coherence
  before insert on public.custody_allocation_physical_units
  for each row execute function public.guard_custody_allocation_physical_unit();

-- Marker durable: permite re-aplicar el forward después de un rollback lógico
-- sin convertir allocations ajenas/preexistentes en genealogía inventada.
create table if not exists public.custody_productive_installations(
  installation text primary key,
  installed_at timestamptz not null default now(),
  constraint custody_productive_installation_name_ck
    check(installation='0250a_custody_productive_vision')
);
alter table public.custody_productive_installations enable row level security;
revoke all on public.custody_productive_installations from public,anon,authenticated,service_role;
grant select on public.custody_productive_installations to service_role;
drop trigger if exists trg_custody_productive_installations_immutable
  on public.custody_productive_installations;
create trigger trg_custody_productive_installations_immutable
  before update or delete on public.custody_productive_installations
  for each row execute function public.prevent_custody_integrity_mutation();
drop trigger if exists trg_custody_productive_installations_no_truncate
  on public.custody_productive_installations;
create trigger trg_custody_productive_installations_no_truncate
  before truncate on public.custody_productive_installations
  for each statement execute function public.prevent_custody_integrity_mutation();

-- El snapshot productivo verificado no tiene allocations preexistentes. En la
-- primera instalación, cualquier allocation detiene el proceso. En un rerun
-- sólo se acepta la genealogía exacta que el forward ya materializó.
do $$ begin
  if exists(select 1 from public.stock_allocations)
     and not exists(
       select 1 from public.custody_productive_installations
        where installation='0250a_custody_productive_vision'
     ) then
    raise exception 'CUSTODY_ALLOCATION_BACKFILL_NOT_PROVABLE'
      using errcode='object_not_in_prerequisite_state';
  end if;
  -- En un rerun sólo es divergencia la SOBRE-cobertura: una allocation con más
  -- genealogía que cantidad es corrupción. La sub-cobertura es un estado
  -- conocido y registrado —stock por ajuste, o genealogía que todavía no
  -- llegó— y bloquear el rerun por ella dejaba el forward permanentemente
  -- irreaplicable después de cualquier rollback con operación normal.
  if exists(
    select 1
      from public.stock_allocations a
      join (
        select allocation_id,sum(quantity) quantity
          from public.custody_allocation_physical_units
         group by allocation_id
      ) g on g.allocation_id=a.id
     where g.quantity>a.quantity
  ) and exists(
    select 1 from public.custody_productive_installations
     where installation='0250a_custody_productive_vision'
  ) then
    raise exception 'CUSTODY_REAPPLY_GENEALOGY_DIVERGENT'
      using errcode='integrity_constraint_violation';
  end if;
end $$;

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
  -- El lock es POR ÍTEM, no por (ítem, lote): la vinculación recorre todas las
  -- unidades del ítem, así que dos reservas concurrentes del mismo ítem con
  -- lotes representativos distintos compiten por las mismas unidades.
  perform pg_advisory_xact_lock(hashtext('custody-allocation:'||a.inventory_item_id::text));
  select coalesce(sum(quantity),0) into v_bound
    from public.custody_allocation_physical_units where allocation_id=a.id;
  if v_bound>=a.quantity then return; end if;
  -- Una cobertura parcial preexistente se COMPLETA, no se rechaza: es el estado
  -- normal de una allocation cuya genealogía llegó después (o nunca, si el
  -- stock entró por ajuste). Reintentar es idempotente porque sólo se agrega
  -- lo que falta.
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
    -- FEFO real del ÍTEM. `a.lot_number` NO filtra: `allocate_order` lo estampa
    -- como lote "representativo" (0031: `limit 1` sobre el vencimiento más
    -- próximo) mientras dimensiona la reserva con el stock del ítem completo,
    -- de modo que una reserva legítima abarca varios lotes. Filtrar por él
    -- hacía abortar toda reserva multi-lote, que en la ruta ANMAT —donde el
    -- lote es obligatorio— es el caso normal.
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
  -- DECISIÓN DE DOMINIO: la cobertura incompleta NO aborta la reserva.
  -- Reservar no saca el bien de custodia; despachar sí. El stock ingresado por
  -- ajuste de inventario (`register_inventory_movement` con 'ajuste', 0027) no
  -- pasa por recepción y por tanto no tiene unidad física ni QR ni foto de
  -- ingreso: nunca podrá satisfacer la Adenda §4.2. Abortar acá convertía esa
  -- carencia en la imposibilidad de reservarlo, que es un freno operativo sin
  -- contrapartida de custodia. El bloqueo se mantiene donde importa:
  -- `custody_assert_allocation_released` exige cobertura EXACTA antes de
  -- despachar, y sin ella sólo libera la vía de certificado humano legado.
end;
$$;
revoke all on function public.custody_bind_allocation(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.custody_bind_stock_allocation()
returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.custody_bind_allocation(new.id); return new; end;
$$;
drop trigger if exists trg_custody_bind_stock_allocation on public.stock_allocations;
create trigger trg_custody_bind_stock_allocation
  after insert on public.stock_allocations
  for each row execute function public.custody_bind_stock_allocation();

-- -------------------------------------------------------------------------
-- 5. Evidencia física autenticada. La DB jamás acepta el hash declarado por
--    el cliente: consume una atestación emitida por service_role después de
--    descargar, inspeccionar y hashear los bytes realmente almacenados.
-- -------------------------------------------------------------------------

alter table public.custody_content_attestations
  add column if not exists observed_mime_type text;
alter table public.custody_content_attestations
  drop constraint if exists custody_content_attestations_scope_check,
  drop constraint if exists custody_content_attestations_observed_mime_ck;
alter table public.custody_content_attestations
  add constraint custody_content_attestations_scope_check
    check(scope in('physical_unit','packing_unit','shipment')),
  add constraint custody_content_attestations_observed_mime_ck
    check(observed_mime_type is null or observed_mime_type in(
      'image/jpeg','image/png','image/webp'
    ));

create or replace function public.attest_custody_physical_content(
  p_bucket text,
  p_storage_path text,
  p_sha256 text,
  p_size_bytes bigint,
  p_observed_mime_type text,
  p_actor_id uuid,
  p_session_id uuid,
  p_physical_unit_id uuid,
  p_stage custody_stage_t,
  p_event_type custody_event_type_t,
  p_ttl_seconds int default 900
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_client uuid;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'atestación física reservada al rol interno'
      using errcode='insufficient_privilege';
  end if;
  if p_bucket is distinct from 'custody-evidence'
     or p_storage_path is null or btrim(p_storage_path)=''
     or length(p_storage_path)>512 then
    raise exception 'objeto físico inválido' using errcode='check_violation';
  end if;
  if p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$'
     or p_size_bytes is null or p_size_bytes<1 or p_size_bytes>8388608
     or lower(coalesce(p_observed_mime_type,'')) not in(
       'image/jpeg','image/png','image/webp'
     ) then
    raise exception 'identidad de bytes inválida' using errcode='check_violation';
  end if;
  if not ((p_stage='recepcion' and p_event_type='foto_ingreso')
       or (p_stage='despacho' and p_event_type in('foto_egreso','inspeccion_humana'))) then
    raise exception 'par físico inválido' using errcode='check_violation';
  end if;
  if coalesce(p_ttl_seconds,0)<=0 or p_ttl_seconds>3600 then
    raise exception 'ttl inválido' using errcode='check_violation';
  end if;
  if p_actor_id is null or p_session_id is null or not exists(
    select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_actor_id
  ) then
    raise exception 'sesión inválida para el actor' using errcode='insufficient_privilege';
  end if;
  select client_id into v_client from public.custody_physical_units
   where id=p_physical_unit_id;
  if not found then raise exception 'unidad física inexistente' using errcode='no_data_found'; end if;
  if p_event_type='inspeccion_humana' and exists(
    select 1 from public.custody_inspection_content_claims where sha256=p_sha256
  ) then
    raise exception 'contenido de inspección ya utilizado' using errcode='unique_violation';
  end if;
  insert into public.custody_content_attestations(
    bucket,storage_path,sha256,size_bytes,observed_mime_type,actor_id,session_id,
    client_id,scope,entity_id,stage,event_type,expires_at
  ) values(
    p_bucket,p_storage_path,p_sha256,p_size_bytes,lower(p_observed_mime_type),
    p_actor_id,p_session_id,v_client,'physical_unit',p_physical_unit_id,
    p_stage,p_event_type,now()+make_interval(secs=>p_ttl_seconds)
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.attest_custody_physical_content(
  text,text,text,bigint,text,uuid,uuid,uuid,custody_stage_t,custody_event_type_t,int
) from public,anon,authenticated;
grant execute on function public.attest_custody_physical_content(
  text,text,text,bigint,text,uuid,uuid,uuid,custody_stage_t,custody_event_type_t,int
) to service_role;

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

-- -------------------------------------------------------------------------
-- 6. Política y activación append-only. Score DB-owned con pesos versionados.
-- -------------------------------------------------------------------------

create table if not exists public.custody_integrity_policies(
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  similarity_threshold numeric(5,2) not null,
  cooldown_seconds int not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  prompt_sha256 text not null,
  response_schema_version text not null,
  response_schema_sha256 text not null,
  score_algorithm_version text not null,
  identity_weight numeric(5,2) not null,
  packaging_weight numeric(5,2) not null,
  quantity_weight numeric(5,2) not null,
  condition_weight numeric(5,2) not null,
  created_at timestamptz not null default now(),
  constraint custody_policy_threshold_ck check(similarity_threshold between 0 and 100),
  constraint custody_policy_cooldown_ck check(cooldown_seconds between 0 and 3600),
  constraint custody_policy_hashes_ck check(
    prompt_sha256 ~ '^[0-9a-f]{64}$' and response_schema_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint custody_policy_weights_ck check(
    identity_weight>=0 and packaging_weight>=0 and quantity_weight>=0 and condition_weight>=0
    and identity_weight+packaging_weight+quantity_weight+condition_weight=100
  )
);

create table if not exists public.custody_integrity_policy_activations(
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.custody_integrity_policies(id) on delete restrict,
  enabled boolean not null default true,
  activated_at timestamptz not null default now(),
  activated_by uuid references auth.users(id) on delete set null,
  reason text not null,
  constraint custody_policy_activation_reason_ck check(length(btrim(reason))>=10)
);
create index if not exists custody_policy_activations_latest_idx
  on public.custody_integrity_policy_activations(activated_at desc,id desc);

alter table public.custody_integrity_policies enable row level security;
alter table public.custody_integrity_policy_activations enable row level security;
revoke all on public.custody_integrity_policies from public,anon,authenticated,service_role;
revoke all on public.custody_integrity_policy_activations from public,anon,authenticated,service_role;
grant select on public.custody_integrity_policies to authenticated,service_role;
grant select on public.custody_integrity_policy_activations to authenticated,service_role;

drop trigger if exists trg_custody_integrity_policies_immutable on public.custody_integrity_policies;
create trigger trg_custody_integrity_policies_immutable
  before update or delete on public.custody_integrity_policies
  for each row execute function public.prevent_custody_integrity_mutation();
drop trigger if exists trg_custody_integrity_policies_no_truncate on public.custody_integrity_policies;
create trigger trg_custody_integrity_policies_no_truncate
  before truncate on public.custody_integrity_policies
  for each statement execute function public.prevent_custody_integrity_mutation();
drop trigger if exists trg_custody_policy_activations_immutable on public.custody_integrity_policy_activations;
create trigger trg_custody_policy_activations_immutable
  before update or delete on public.custody_integrity_policy_activations
  for each row execute function public.prevent_custody_integrity_mutation();
drop trigger if exists trg_custody_policy_activations_no_truncate on public.custody_integrity_policy_activations;
create trigger trg_custody_policy_activations_no_truncate
  before truncate on public.custody_integrity_policy_activations
  for each statement execute function public.prevent_custody_integrity_mutation();

insert into public.custody_integrity_policies(
  version,similarity_threshold,cooldown_seconds,provider,model,prompt_version,prompt_sha256,
  response_schema_version,response_schema_sha256,score_algorithm_version,
  identity_weight,packaging_weight,quantity_weight,condition_weight
) values(
  'custody-similarity/v1',90,60,'openai','gpt-5.4-mini-2026-03-17','custody-vision/v3',
  '831992df4a2eb04b73506acbd2e254efaa47e997f1a65562f3b9a14d18db961f',
  'custody-vision-schema/v1',
  'cae065149ca3c1cace80a3344ca68f4c7e938b2055ea8d4179dea8a894759e17',
  'custody-weighted-components/v1',35,25,20,20
) on conflict(version) do nothing;

do $$ begin
  if not exists(
    select 1 from public.custody_integrity_policies p
     where p.version='custody-similarity/v1' and p.similarity_threshold=90
       and p.cooldown_seconds=60 and p.provider='openai'
       and p.model='gpt-5.4-mini-2026-03-17'
       and p.prompt_version='custody-vision/v3'
       and p.prompt_sha256='831992df4a2eb04b73506acbd2e254efaa47e997f1a65562f3b9a14d18db961f'
       and p.response_schema_version='custody-vision-schema/v1'
       and p.response_schema_sha256='cae065149ca3c1cace80a3344ca68f4c7e938b2055ea8d4179dea8a894759e17'
       and p.score_algorithm_version='custody-weighted-components/v1'
       and p.identity_weight=35 and p.packaging_weight=25
       and p.quantity_weight=20 and p.condition_weight=20
  ) then
    raise exception 'POLICY_CONTRACT_MISMATCH: custody-similarity/v1 divergente'
      using errcode='integrity_constraint_violation';
  end if;
end $$;

insert into public.custody_integrity_policy_activations(policy_id,enabled,reason)
select p.id,true,'Activación inicial CUSTODIA VISIÓN PRODUCTIVA 001'
from public.custody_integrity_policies p
where p.version='custody-similarity/v1'
  and coalesce((
    select a.enabled from public.custody_integrity_policy_activations a
     where a.policy_id=p.id
     order by a.activated_at desc,a.id desc limit 1
  ),false)=false;

-- Resultados y provenance durable en caso + intento.
alter table public.custody_integrity_cases
  drop constraint if exists custody_integrity_cases_similarity_ck,
  drop constraint if exists custody_integrity_cases_threshold_ck,
  drop constraint if exists custody_integrity_cases_threshold_result_ck,
  drop constraint if exists custody_integrity_cases_details_ck;
alter table public.custody_integrity_cases
  add column if not exists similarity_score numeric(5,2),
  add column if not exists threshold_percent numeric(5,2),
  add column if not exists threshold_policy_version text,
  add column if not exists threshold_result text,
  add column if not exists score_components jsonb,
  add column if not exists packaging_changed boolean,
  add column if not exists missing_items_suspected boolean,
  add column if not exists damage_suspected boolean,
  add column if not exists provider_details jsonb,
  add column if not exists provider_response_id text,
  add column if not exists response_model text,
  add column if not exists system_fingerprint text,
  add column if not exists request_sha256 text,
  add column if not exists response_sha256 text,
  add column if not exists prompt_sha256 text,
  add column if not exists response_schema_sha256 text,
  add column if not exists ingress_observed_sha256 text,
  add column if not exists egress_observed_sha256 text,
  add column if not exists evaluation_attempt_id uuid;

alter table public.custody_integrity_cases
  add constraint custody_integrity_cases_similarity_ck check(similarity_score is null or similarity_score between 0 and 100),
  add constraint custody_integrity_cases_threshold_ck check(threshold_percent is null or threshold_percent between 0 and 100),
  add constraint custody_integrity_cases_threshold_result_ck check(threshold_result is null or threshold_result in('ABOVE_OR_EQUAL','BELOW')),
  add constraint custody_integrity_cases_details_ck check(provider_details is null or (jsonb_typeof(provider_details)='object' and octet_length(provider_details::text)<=8192));

alter table public.custody_integrity_evaluation_attempts
  add column if not exists policy_id uuid references public.custody_integrity_policies(id) on delete restrict,
  add column if not exists policy_version text,
  add column if not exists threshold_percent numeric(5,2),
  add column if not exists cooldown_seconds int,
  add column if not exists expected_provider text,
  add column if not exists expected_model text,
  add column if not exists expected_prompt_version text,
  add column if not exists expected_prompt_sha256 text,
  add column if not exists expected_schema_version text,
  add column if not exists expected_schema_sha256 text,
  add column if not exists score_algorithm_version text,
  add column if not exists identity_weight numeric(5,2),
  add column if not exists packaging_weight numeric(5,2),
  add column if not exists quantity_weight numeric(5,2),
  add column if not exists condition_weight numeric(5,2),
  add column if not exists ingress_sha256 text,
  add column if not exists egress_sha256 text,
  add column if not exists evaluation_key text,
  add column if not exists similarity_score numeric(5,2),
  add column if not exists threshold_result text,
  add column if not exists score_components jsonb,
  add column if not exists packaging_changed boolean,
  add column if not exists missing_items_suspected boolean,
  add column if not exists damage_suspected boolean,
  add column if not exists provider_details jsonb,
  add column if not exists provider_response_id text,
  add column if not exists response_model text,
  add column if not exists system_fingerprint text,
  add column if not exists request_sha256 text,
  add column if not exists response_sha256 text,
  add column if not exists ingress_observed_sha256 text,
  add column if not exists egress_observed_sha256 text,
  add column if not exists failure_code text;

create unique index if not exists custody_integrity_attempts_evaluation_key_uk
  on public.custody_integrity_evaluation_attempts(evaluation_key)
  where evaluation_key is not null and status='completed' and outcome='ok';

-- El binding y el snapshot de política del intento son inmutables.
create or replace function public.guard_custody_integrity_attempt()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op in('DELETE','TRUNCATE') then
    -- Misma razón que arriba: T-C1-06 afirma sobre la frase de 0222.
    raise exception 'los intentos de evaluación no se borran: son append-only'
      using errcode='restrict_violation';
  end if;
  if new.id<>old.id or new.case_id<>old.case_id or new.client_id<>old.client_id
     or new.scope<>old.scope or new.entity_id<>old.entity_id
     or new.case_version_at_start<>old.case_version_at_start
     or new.ingress_evidence_id is distinct from old.ingress_evidence_id
     or new.egress_evidence_id is distinct from old.egress_evidence_id
     or new.requested_by<>old.requested_by
     or new.requested_session_id<>old.requested_session_id
     or new.requested_role<>old.requested_role
     or new.requested_at<>old.requested_at or new.expires_at<>old.expires_at
     or new.policy_id is distinct from old.policy_id
     or new.policy_version is distinct from old.policy_version
     or new.threshold_percent is distinct from old.threshold_percent
     or new.cooldown_seconds is distinct from old.cooldown_seconds
     or new.expected_provider is distinct from old.expected_provider
     or new.expected_model is distinct from old.expected_model
     or new.expected_prompt_version is distinct from old.expected_prompt_version
     or new.expected_prompt_sha256 is distinct from old.expected_prompt_sha256
     or new.expected_schema_version is distinct from old.expected_schema_version
     or new.expected_schema_sha256 is distinct from old.expected_schema_sha256
     or new.score_algorithm_version is distinct from old.score_algorithm_version
     or new.identity_weight is distinct from old.identity_weight
     or new.packaging_weight is distinct from old.packaging_weight
     or new.quantity_weight is distinct from old.quantity_weight
     or new.condition_weight is distinct from old.condition_weight
     or new.ingress_sha256 is distinct from old.ingress_sha256
     or new.egress_sha256 is distinct from old.egress_sha256
     or new.evaluation_key is distinct from old.evaluation_key then
    -- El texto conserva la frase de 0222: T-C1-06 afirma sobre ella y el
    -- contrato no cambió, sólo se amplió a las columnas de política.
    raise exception 'el binding del intento es inmutable, incluida su política'
      using errcode='restrict_violation';
  end if;
  if old.status<>'pending' or new.status not in('completed','abandoned') then
    raise exception 'transición de intento inválida: % -> %',old.status,new.status
      using errcode='restrict_violation';
  end if;
  return new;
end;
$$;

-- -------------------------------------------------------------------------
-- 7. Begin v2: congela evidencia, política, modelo, prompt, schema y pesos.
--    Dispositions estables evitan clasificar errores por texto en TypeScript.
-- -------------------------------------------------------------------------

create or replace function public.begin_custody_integrity_evaluation_v2(
  p_case_id uuid,
  p_expected_version int
) returns table(
  attempt_id uuid,
  disposition text,
  retry_after_seconds int,
  case_version int,
  ingress_evidence_id uuid,
  egress_evidence_id uuid,
  ingress_sha256 text,
  egress_sha256 text,
  policy_id uuid,
  policy_version text,
  threshold_percent numeric,
  provider text,
  model text,
  prompt_version text,
  prompt_sha256 text,
  response_schema_version text,
  response_schema_sha256 text,
  score_algorithm_version text,
  identity_weight numeric,
  packaging_weight numeric,
  quantity_weight numeric,
  condition_weight numeric
) language plpgsql security definer set search_path=public as $$
declare
  c public.custody_integrity_cases;
  p public.custody_integrity_policies;
  v_policy_id uuid;
  v_enabled boolean;
  v_actor uuid; v_session uuid; v_role text;
  v_ingress text; v_egress text; v_key text;
  v_ingress_seq bigint; v_egress_seq bigint;
  v_attempt public.custody_integrity_evaluation_attempts;
  v_spent int;
  v_retry int;
begin
  select a.actor_id,a.session_id,a.actor_role into v_actor,v_session,v_role
    from public.assert_custody_access('wms.edit') a;
  if p_expected_version is null or p_expected_version<=0 then
    raise exception 'versión esperada inválida' using errcode='check_violation';
  end if;
  select * into c from public.custody_integrity_cases where id=p_case_id for update;
  if not found then raise exception 'caso inexistente' using errcode='no_data_found'; end if;
  if c.physical_unit_id is null then
    raise exception 'evaluación v2 exige scope physical_unit' using errcode='check_violation';
  end if;
  if c.version<>p_expected_version then
    raise exception 'conflicto de versión' using errcode='serialization_failure';
  end if;
  if c.state in('RELEASED','QUARANTINED') or c.decision_id is not null then
    raise exception 'caso ya decidido' using errcode='unique_violation';
  end if;
  perform public.assert_custody_tenant(v_role,c.client_id);

  select e.sha256,ev.chain_seq into v_ingress,v_ingress_seq
    from public.custody_evidence e
    join public.custody_events ev on ev.id=e.event_id
   where e.id=c.ingress_evidence_id and e.kind='foto' and not e.redacted
     and ev.physical_unit_id=c.physical_unit_id
     and ev.stage='recepcion' and ev.event_type='foto_ingreso';
  select e.sha256,ev.chain_seq into v_egress,v_egress_seq
    from public.custody_evidence e
    join public.custody_events ev on ev.id=e.event_id
   where e.id=c.egress_evidence_id and e.kind='foto' and not e.redacted
     and ev.physical_unit_id=c.physical_unit_id
     and ev.stage='despacho' and ev.event_type='foto_egreso';
  if v_ingress is null or v_egress is null or c.ingress_evidence_id=c.egress_evidence_id
     or v_ingress=v_egress or v_ingress_seq is null or v_egress_seq is null
     or v_ingress_seq>=v_egress_seq then
    raise exception 'evidencia física incompleta o incompatible' using errcode='check_violation';
  end if;

  -- Un intento ya abierto siempre conserva SU snapshot, aunque otra política
  -- haya sido activada o desactivada después de la reserva.
  select * into v_attempt from public.custody_integrity_evaluation_attempts
   where case_id=c.id and status='pending' for update;
  if found then
    if v_attempt.case_version_at_start<>c.version
       or v_attempt.scope<>'physical_unit' or v_attempt.entity_id<>c.physical_unit_id
       or v_attempt.ingress_evidence_id is distinct from c.ingress_evidence_id
       or v_attempt.egress_evidence_id is distinct from c.egress_evidence_id
       or v_attempt.ingress_sha256 is distinct from v_ingress
       or v_attempt.egress_sha256 is distinct from v_egress then
      raise exception 'intento pendiente divergente del caso' using errcode='integrity_constraint_violation';
    end if;
    if now()<=v_attempt.expires_at then
      return query select v_attempt.id,'in_flight'::text,
        greatest(1,ceil(extract(epoch from(v_attempt.expires_at-now())))::int),
        v_attempt.case_version_at_start,v_attempt.ingress_evidence_id,
        v_attempt.egress_evidence_id,v_attempt.ingress_sha256,v_attempt.egress_sha256,
        v_attempt.policy_id,v_attempt.policy_version,v_attempt.threshold_percent,
        v_attempt.expected_provider,v_attempt.expected_model,
        v_attempt.expected_prompt_version,v_attempt.expected_prompt_sha256,
        v_attempt.expected_schema_version,v_attempt.expected_schema_sha256,
        v_attempt.score_algorithm_version,v_attempt.identity_weight,
        v_attempt.packaging_weight,v_attempt.quantity_weight,v_attempt.condition_weight;
      return;
    end if;
    update public.custody_integrity_evaluation_attempts
      set status='abandoned',closed_at=now() where id=v_attempt.id and status='pending';
  end if;

  select act.policy_id,act.enabled into v_policy_id,v_enabled
    from public.custody_integrity_policy_activations act
   order by act.activated_at desc,act.id desc limit 1;
  if not found or not v_enabled then
    raise exception 'política productiva desactivada' using errcode='object_not_in_prerequisite_state';
  end if;
  select * into p from public.custody_integrity_policies where id=v_policy_id;
  if not found then
    raise exception 'política productiva inexistente' using errcode='object_not_in_prerequisite_state';
  end if;

  v_key:=encode(sha256(convert_to(concat_ws('|','custody-evaluation/v2',c.id::text,
    c.physical_unit_id::text,c.ingress_evidence_id::text,v_ingress,
    c.egress_evidence_id::text,v_egress,p.id::text,p.version),'UTF8')),'hex');

  select * into v_attempt from public.custody_integrity_evaluation_attempts
   where evaluation_key=v_key and status='completed' and outcome='ok'
   order by closed_at desc limit 1;
  if found and c.evaluation_attempt_id=v_attempt.id then
    return query select v_attempt.id,'cached'::text,0,c.version,
      c.ingress_evidence_id,c.egress_evidence_id,v_ingress,v_egress,p.id,p.version,
      p.similarity_threshold,p.provider,p.model,p.prompt_version,p.prompt_sha256,
      p.response_schema_version,p.response_schema_sha256,p.score_algorithm_version,
      p.identity_weight,p.packaging_weight,p.quantity_weight,p.condition_weight;
    return;
  end if;

  -- Techo de gasto. El cooldown miraba SÓLO los intentos fallidos, y como
  -- `attach_custody_physical_evidence` cambia la evidencia de egreso, la clave
  -- de caché cambia con ella y ningún intento exitoso frenaba al siguiente:
  -- adjuntar y re-evaluar era un bucle de dos clics, cada vuelta facturada.
  -- Ahora enfría contra CUALQUIER intento cerrado del caso.
  select greatest(0,ceil(extract(epoch from((t.closed_at
       + make_interval(secs=>p.cooldown_seconds))-now())))::int)
    into v_retry
    from public.custody_integrity_evaluation_attempts t
   where t.case_id=c.id and t.status='completed'
     and t.closed_at>now()-make_interval(secs=>p.cooldown_seconds)
   order by t.closed_at desc limit 1;
  if coalesce(v_retry,0)>0 then
    return query select null::uuid,'cooldown'::text,v_retry,c.version,
      c.ingress_evidence_id,c.egress_evidence_id,v_ingress,v_egress,p.id,p.version,
      p.similarity_threshold,p.provider,p.model,p.prompt_version,p.prompt_sha256,
      p.response_schema_version,p.response_schema_sha256,p.score_algorithm_version,
      p.identity_weight,p.packaging_weight,p.quantity_weight,p.condition_weight;
    return;
  end if;

  -- Y un techo duro por caso: aun respetando el cooldown, un caso no puede
  -- consumir el proveedor de forma indefinida. Al llegar al tope el caso queda
  -- en manos del inspector, que es donde el contrato quiere la decisión.
  select count(*) into v_spent
    from public.custody_integrity_evaluation_attempts t
   where t.case_id=c.id and t.status='completed';
  if v_spent>=50 then
    raise exception 'CUSTODY_EVALUATION_BUDGET_EXHAUSTED: el caso agotó su presupuesto de análisis'
      using errcode='object_not_in_prerequisite_state';
  end if;

  insert into public.custody_integrity_evaluation_attempts(
    case_id,client_id,scope,entity_id,case_version_at_start,
    ingress_evidence_id,egress_evidence_id,requested_by,requested_session_id,requested_role,
    status,requested_at,expires_at,policy_id,policy_version,threshold_percent,cooldown_seconds,
    expected_provider,expected_model,expected_prompt_version,expected_prompt_sha256,
    expected_schema_version,expected_schema_sha256,score_algorithm_version,
    identity_weight,packaging_weight,quantity_weight,condition_weight,
    ingress_sha256,egress_sha256,evaluation_key
  ) values(
    c.id,c.client_id,'physical_unit',c.physical_unit_id,c.version,
    c.ingress_evidence_id,c.egress_evidence_id,v_actor,v_session,v_role,
    'pending',now(),now()+interval '30 minutes',p.id,p.version,p.similarity_threshold,p.cooldown_seconds,
    p.provider,p.model,p.prompt_version,p.prompt_sha256,p.response_schema_version,
    p.response_schema_sha256,p.score_algorithm_version,p.identity_weight,p.packaging_weight,
    p.quantity_weight,p.condition_weight,v_ingress,v_egress,v_key
  ) returning * into v_attempt;

  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(v_actor,'custody_integrity_case',c.id,'custody.integrity_evaluation_opened_v2',
    jsonb_build_object('attempt_id',v_attempt.id,'policy',p.version,'case_version',c.version));

  return query select v_attempt.id,'opened'::text,0,c.version,
    c.ingress_evidence_id,c.egress_evidence_id,v_ingress,v_egress,p.id,p.version,
    p.similarity_threshold,p.provider,p.model,p.prompt_version,p.prompt_sha256,
    p.response_schema_version,p.response_schema_sha256,p.score_algorithm_version,
    p.identity_weight,p.packaging_weight,p.quantity_weight,p.condition_weight;
end;
$$;
revoke all on function public.begin_custody_integrity_evaluation_v2(uuid,int)
  from public,anon,authenticated;
grant execute on function public.begin_custody_integrity_evaluation_v2(uuid,int)
  to authenticated;

-- -------------------------------------------------------------------------
-- 8. Complete/fail v2. La política se usa desde el snapshot del intento.
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

create or replace function public.fail_custody_integrity_evaluation_v2(
  p_attempt_id uuid,
  p_case_id uuid,
  p_expected_version int,
  p_failure_code text,
  p_ingress_observed_sha256 text default null,
  p_egress_observed_sha256 text default null
) returns int language plpgsql security definer set search_path=public as $$
declare
  a public.custody_integrity_evaluation_attempts;
  c public.custody_integrity_cases;
  v_outcome text; v_version int; v_rows int; v_chain jsonb;
begin
  if coalesce(auth.role(),'anon') in('anon','authenticated') then
    raise exception 'fallo reservado al rol interno' using errcode='insufficient_privilege';
  end if;
  if p_failure_code not in(
    'EVIDENCE_NOT_FOUND','EVIDENCE_REDACTED','EVIDENCE_SIZE_MISMATCH',
    'EVIDENCE_MIME_MISMATCH','EVIDENCE_HASH_MISMATCH','EVIDENCE_DOWNLOAD_FAILED',
    'POLICY_CONTRACT_MISMATCH','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE',
    'PROVIDER_INVALID_RESPONSE'
  ) then raise exception 'failure_code no permitido' using errcode='check_violation'; end if;
  if p_ingress_observed_sha256 is not null and p_ingress_observed_sha256!~'^[0-9a-f]{64}$' then
    raise exception 'hash observado inválido' using errcode='check_violation';
  end if;
  if p_egress_observed_sha256 is not null and p_egress_observed_sha256!~'^[0-9a-f]{64}$' then
    raise exception 'hash observado inválido' using errcode='check_violation';
  end if;
  select * into a from public.custody_integrity_evaluation_attempts where id=p_attempt_id for update;
  if not found or a.status<>'pending' or a.case_id<>p_case_id
     or a.case_version_at_start<>p_expected_version or now()>a.expires_at
     or a.scope<>'physical_unit' then
    raise exception 'intento inválido' using errcode='object_not_in_prerequisite_state';
  end if;
  select * into c from public.custody_integrity_cases where id=a.case_id for update;
  if not found or c.version<>a.case_version_at_start or c.decision_id is not null
     or c.physical_unit_id<>a.entity_id or c.client_id<>a.client_id
     or c.ingress_evidence_id is distinct from a.ingress_evidence_id
     or c.egress_evidence_id is distinct from a.egress_evidence_id then
    raise exception 'caso distinto del intento' using errcode='serialization_failure';
  end if;
  if p_failure_code='EVIDENCE_HASH_MISMATCH' then
    if (p_ingress_observed_sha256 is null or p_ingress_observed_sha256=a.ingress_sha256)
       and (p_egress_observed_sha256 is null or p_egress_observed_sha256=a.egress_sha256) then
      raise exception 'HASH_MISMATCH exige un digest observado divergente'
        using errcode='check_violation';
    end if;
  elsif p_failure_code in('PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_INVALID_RESPONSE') then
    if p_ingress_observed_sha256 is distinct from a.ingress_sha256
       or p_egress_observed_sha256 is distinct from a.egress_sha256 then
      raise exception 'fallo de proveedor exige evidencia previamente verificada'
        using errcode='check_violation';
    end if;
  elsif p_failure_code='POLICY_CONTRACT_MISMATCH'
        and (p_ingress_observed_sha256 is not null or p_egress_observed_sha256 is not null) then
    raise exception 'drift de política debe fallar antes de descargar evidencia'
      using errcode='check_violation';
  elsif p_failure_code in(
    'EVIDENCE_NOT_FOUND','EVIDENCE_REDACTED','EVIDENCE_SIZE_MISMATCH',
    'EVIDENCE_MIME_MISMATCH','EVIDENCE_DOWNLOAD_FAILED'
  ) then
    if (p_ingress_observed_sha256 is not null
        and p_ingress_observed_sha256 is distinct from a.ingress_sha256)
       or (p_egress_observed_sha256 is not null
           and p_egress_observed_sha256 is distinct from a.egress_sha256)
       or (p_ingress_observed_sha256 is not null
           and p_egress_observed_sha256 is not null) then
      raise exception 'fallo de evidencia exige hashes previos exactos y al menos un extremo no verificado'
        using errcode='check_violation';
    end if;
  end if;
  v_outcome:=case
    when p_failure_code='PROVIDER_TIMEOUT' then 'timeout'
    when p_failure_code='PROVIDER_UNAVAILABLE' then 'unavailable'
    when p_failure_code='PROVIDER_INVALID_RESPONSE' then 'invalid_response'
    else 'not_executed' end;

  perform public.custody_chain_lock('physical_unit',c.physical_unit_id);
  v_chain:=public.custody_chain_attestation('physical_unit',c.physical_unit_id);

  update public.custody_integrity_cases set
    provider=a.expected_provider,model=a.expected_model,prompt_version=a.expected_prompt_version,
    execution_mode='real',outcome=v_outcome,verdict=null,model_confidence=null,
    similarity_score=null,threshold_percent=a.threshold_percent,
    threshold_policy_version=a.policy_version,threshold_result=null,
    score_components=null,packaging_changed=null,missing_items_suspected=null,damage_suspected=null,
    provider_details=null,provider_response_id=null,response_model=null,system_fingerprint=null,
    request_sha256=null,response_sha256=null,
    prompt_sha256=a.expected_prompt_sha256,response_schema_sha256=a.expected_schema_sha256,
    ingress_observed_sha256=p_ingress_observed_sha256,
    egress_observed_sha256=p_egress_observed_sha256,evaluation_attempt_id=a.id,
    provider_error=p_failure_code,hold_reasons=array[p_failure_code]::text[],state='HOLD',
    chain_status=v_chain->>'status',
    chain_events_checked=case when (v_chain->>'events_checked')~'^[0-9]+$'
      then (v_chain->>'events_checked')::int else null end,
    chain_head=case when (v_chain->>'status')='verified' then v_chain->>'chain_head' else null end,
    chain_attested_at=case when (v_chain->>'attested_at') is not null
      then (v_chain->>'attested_at')::timestamptz else null end,
    version=c.version+1,updated_at=now()
   where id=c.id and version=a.case_version_at_start and decision_id is null
   returning version into v_version;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'fallo no aplicado' using errcode='serialization_failure'; end if;

  update public.custody_integrity_evaluation_attempts set
    status='completed',closed_at=now(),completed_case_version=v_version,
    provider=a.expected_provider,model=a.expected_model,prompt_version=a.expected_prompt_version,
    execution_mode='real',outcome=v_outcome,provider_error=p_failure_code,failure_code=p_failure_code,
    ingress_observed_sha256=p_ingress_observed_sha256,
    egress_observed_sha256=p_egress_observed_sha256
   where id=a.id and status='pending';
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'intento de fallo no cerrado' using errcode='serialization_failure'; end if;

  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(a.requested_by,'custody_integrity_case',c.id,'custody.integrity_failed_v2',
    jsonb_build_object('attempt_id',a.id,'failure_code',p_failure_code,'policy',a.policy_version));
  return v_version;
end;
$$;
revoke all on function public.fail_custody_integrity_evaluation_v2(uuid,uuid,int,text,text,text)
  from public,anon,authenticated;
grant execute on function public.fail_custody_integrity_evaluation_v2(uuid,uuid,int,text,text,text)
  to service_role;

-- Se cierran las vías históricas que no congelan política ni hashes reales.
revoke all on function public.begin_custody_integrity_evaluation(uuid,int)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_custody_integrity_evaluation(
  uuid,uuid,int,text,text,text,text,text,text,numeric,text
) from public,anon,authenticated,service_role;

-- -------------------------------------------------------------------------
-- 9. Decisión humana v2 y certificado de liberación append-only.
-- -------------------------------------------------------------------------

alter table public.custody_integrity_decisions
  drop constraint if exists custody_integrity_decisions_prev_state_chk;
alter table public.custody_integrity_decisions
  add constraint custody_integrity_decisions_prev_state_chk
  check(previous_state in('REVIEW_REQUIRED','HOLD'));

create table if not exists public.custody_release_certificates(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.custody_integrity_cases(id) on delete restrict,
  decision_id uuid not null unique references public.custody_integrity_decisions(id) on delete restrict,
  basis text not null,
  evaluation_attempt_id uuid references public.custody_integrity_evaluation_attempts(id) on delete restrict,
  policy_id uuid references public.custody_integrity_policies(id) on delete restrict,
  physical_unit_id uuid references public.custody_physical_units(id) on delete restrict,
  packing_unit_id uuid references public.packing_units(id) on delete restrict,
  shipment_id uuid references public.shipments(id) on delete restrict,
  chain_head_at_release text not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id) on delete set null,
  constraint custody_release_certificate_basis_ck
    check(basis in('vision_policy','human_override','legacy_human')),
  constraint custody_release_certificate_scope_ck
    check(num_nonnulls(physical_unit_id,packing_unit_id,shipment_id)=1),
  constraint custody_release_certificate_vision_ck check(
    basis<>'vision_policy'
    or (physical_unit_id is not null and evaluation_attempt_id is not null and policy_id is not null)
  ),
  constraint custody_release_certificate_legacy_ck check(
    basis<>'legacy_human'
    or (physical_unit_id is null and evaluation_attempt_id is null and policy_id is null)
  )
);

alter table public.custody_release_certificates
  drop constraint if exists custody_release_certificate_basis_ck,
  drop constraint if exists custody_release_certificate_vision_ck,
  drop constraint if exists custody_release_certificate_legacy_ck;
alter table public.custody_release_certificates
  add constraint custody_release_certificate_basis_ck
    check(basis in('vision_policy','human_override','legacy_human')),
  add constraint custody_release_certificate_vision_ck check(
    basis not in('vision_policy','human_override')
    or (physical_unit_id is not null and evaluation_attempt_id is not null and policy_id is not null)
  ),
  add constraint custody_release_certificate_legacy_ck check(
    basis<>'legacy_human'
    or (physical_unit_id is null and evaluation_attempt_id is null and policy_id is null)
  );
alter table public.custody_release_certificates enable row level security;
revoke all on public.custody_release_certificates from public,anon,authenticated,service_role;
grant select on public.custody_release_certificates to authenticated,service_role;
drop trigger if exists trg_custody_release_certificates_immutable on public.custody_release_certificates;
create trigger trg_custody_release_certificates_immutable
  before update or delete on public.custody_release_certificates
  for each row execute function public.prevent_custody_integrity_mutation();
drop trigger if exists trg_custody_release_certificates_no_truncate on public.custody_release_certificates;
create trigger trg_custody_release_certificates_no_truncate
  before truncate on public.custody_release_certificates
  for each statement execute function public.prevent_custody_integrity_mutation();

create or replace function public.custody_assert_release_certificate(p_certificate_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  rc public.custody_release_certificates;
  c public.custody_integrity_cases;
  d public.custody_integrity_decisions;
  a public.custody_integrity_evaluation_attempts;
  v_live_head text;
begin
  select * into rc from public.custody_release_certificates where id=p_certificate_id;
  if not found then raise exception 'certificado inexistente' using errcode='no_data_found'; end if;
  select * into c from public.custody_integrity_cases where id=rc.case_id;
  select * into d from public.custody_integrity_decisions where id=rc.decision_id;
  if c.id is null or d.id is null or c.state<>'RELEASED' or c.decision_id<>d.id
     or d.case_id<>c.id or d.decision<>'release' or d.new_state<>'RELEASED'
     or d.chain_head_at_decision is distinct from rc.chain_head_at_release
     or c.chain_head is distinct from rc.chain_head_at_release
     or not exists(select 1 from public.custody_integrity_inspection_evidence ie
                   where ie.decision_id=d.id) then
    raise exception 'certificado divergente de caso/decisión'
      using errcode='integrity_constraint_violation';
  end if;

  if rc.physical_unit_id is not null then
    perform public.custody_chain_lock('physical_unit',rc.physical_unit_id);
    if c.physical_unit_id is distinct from rc.physical_unit_id
       or c.packing_unit_id is not null or c.shipment_id is not null then
      raise exception 'scope físico del certificado divergente'
        using errcode='integrity_constraint_violation';
    end if;
    select row_hash into v_live_head from public.custody_events
     where physical_unit_id=rc.physical_unit_id order by chain_seq desc limit 1;
  elsif rc.packing_unit_id is not null then
    perform public.custody_chain_lock('packing_unit',rc.packing_unit_id);
    if c.packing_unit_id is distinct from rc.packing_unit_id or c.shipment_id is not null then
      raise exception 'scope packing del certificado divergente'
        using errcode='integrity_constraint_violation';
    end if;
    select row_hash into v_live_head from public.custody_events
     where packing_unit_id=rc.packing_unit_id order by chain_seq desc limit 1;
  else
    perform public.custody_chain_lock('shipment',rc.shipment_id);
    if c.shipment_id is distinct from rc.shipment_id or c.packing_unit_id is not null then
      raise exception 'scope shipment del certificado divergente'
        using errcode='integrity_constraint_violation';
    end if;
    select row_hash into v_live_head from public.custody_events
     where shipment_id=rc.shipment_id order by chain_seq desc limit 1;
  end if;
  if v_live_head is distinct from rc.chain_head_at_release then
    raise exception 'head del certificado no es el head vivo del scope'
      using errcode='integrity_constraint_violation';
  end if;

  if rc.basis in('vision_policy','human_override') then
    select * into a from public.custody_integrity_evaluation_attempts
     where id=rc.evaluation_attempt_id;
    if not found or a.case_id<>c.id or a.client_id<>c.client_id
       or a.scope<>'physical_unit' or a.entity_id<>c.physical_unit_id
       or a.policy_id is distinct from rc.policy_id or a.status<>'completed'
       or a.completed_case_version<>c.version-1 or c.evaluation_attempt_id<>a.id then
      raise exception 'provenance de evaluación del certificado divergente'
        using errcode='integrity_constraint_violation';
    end if;
    if rc.basis='vision_policy' and (a.outcome<>'ok' or c.outcome<>'ok'
       or c.similarity_score<c.threshold_percent or c.threshold_result<>'ABOVE_OR_EQUAL'
       or c.verdict<>'coincide' or cardinality(c.hold_reasons)<>0
       or coalesce(c.packaging_changed,true) or coalesce(c.missing_items_suspected,true)
       or coalesce(c.damage_suspected,true)) then
      raise exception 'certificado vision_policy sin evaluación habilitante'
        using errcode='integrity_constraint_violation';
    end if;
  elsif rc.evaluation_attempt_id is not null or rc.policy_id is not null
        or rc.physical_unit_id is not null then
    raise exception 'certificado legacy con provenance moderna inválida'
      using errcode='integrity_constraint_violation';
  end if;
end;
$$;
revoke all on function public.custody_assert_release_certificate(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.enforce_custody_release_certificate()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.custody_assert_release_certificate(new.id);
  return null;
end;
$$;
drop trigger if exists trg_custody_release_certificate_coherence
  on public.custody_release_certificates;
create constraint trigger trg_custody_release_certificate_coherence
  after insert on public.custody_release_certificates
  deferrable initially immediate for each row
  execute function public.enforce_custody_release_certificate();

-- Compatibilidad explícita: sólo RELEASED históricos materialmente acreditados.
insert into public.custody_release_certificates(
  case_id,decision_id,basis,packing_unit_id,shipment_id,chain_head_at_release,issued_at,issued_by
)
select c.id,d.id,'legacy_human',c.packing_unit_id,c.shipment_id,
       coalesce(d.chain_head_at_decision,c.chain_head),d.decided_at,d.actor_user_id
  from public.custody_integrity_cases c
  join public.custody_integrity_decisions d on d.id=c.decision_id and d.case_id=c.id
 where c.state='RELEASED' and c.physical_unit_id is null
   and d.decision='release' and d.actor_role='admin'
   and coalesce(d.chain_head_at_decision,c.chain_head) is not null
   and exists(select 1 from public.custody_integrity_inspection_evidence ie where ie.decision_id=d.id)
on conflict(case_id) do nothing;

do $$ declare x record; begin
  for x in select id from public.custody_release_certificates order by issued_at,id
  loop perform public.custody_assert_release_certificate(x.id); end loop;
end $$;

do $$ declare v_unqualified int; begin
  select count(*) into v_unqualified
    from public.custody_integrity_cases c
   where c.state='RELEASED'
     and not exists(select 1 from public.custody_release_certificates rc where rc.case_id=c.id);
  if v_unqualified<>0 then
    raise exception 'CUSTODY_LEGACY_RELEASE_UNVERIFIABLE: % caso(s)',v_unqualified
      using errcode='integrity_constraint_violation';
  end if;
end $$;

-- Cobertura legacy congelada por allocation: una certificación histórica no
-- puede convertirse en cupón para contenido agregado en el futuro.
create table if not exists public.custody_legacy_release_allocation_coverage(
  allocation_id uuid primary key references public.stock_allocations(id) on delete restrict,
  packing_unit_item_id uuid not null unique references public.packing_unit_items(id) on delete restrict,
  packing_unit_id uuid not null references public.packing_units(id) on delete restrict,
  certificate_id uuid not null references public.custody_release_certificates(id) on delete restrict,
  quantity numeric(14,3) not null check(quantity>0),
  chain_head_at_release text not null,
  frozen_at timestamptz not null default now()
);
alter table public.custody_legacy_release_allocation_coverage enable row level security;
revoke all on public.custody_legacy_release_allocation_coverage
  from public,anon,authenticated,service_role;
grant select on public.custody_legacy_release_allocation_coverage to service_role;
drop trigger if exists trg_custody_legacy_coverage_immutable
  on public.custody_legacy_release_allocation_coverage;
create trigger trg_custody_legacy_coverage_immutable
  before update or delete on public.custody_legacy_release_allocation_coverage
  for each row execute function public.prevent_custody_integrity_mutation();
drop trigger if exists trg_custody_legacy_coverage_no_truncate
  on public.custody_legacy_release_allocation_coverage;
create trigger trg_custody_legacy_coverage_no_truncate
  before truncate on public.custody_legacy_release_allocation_coverage
  for each statement execute function public.prevent_custody_integrity_mutation();

insert into public.custody_legacy_release_allocation_coverage(
  allocation_id,packing_unit_item_id,packing_unit_id,certificate_id,quantity,
  chain_head_at_release
)
select pui.allocation_id,pui.id,pui.packing_unit_id,rc.id,pui.quantity,
       rc.chain_head_at_release
  from public.custody_release_certificates rc
  join public.packing_units pu
    on (rc.packing_unit_id is not null and pu.id=rc.packing_unit_id)
    or (rc.shipment_id is not null and pu.shipment_id=rc.shipment_id)
  join public.packing_unit_items pui on pui.packing_unit_id=pu.id
 where rc.basis='legacy_human'
on conflict(allocation_id) do nothing;

do $$ begin
  if exists(
    select 1 from public.custody_legacy_release_allocation_coverage lc
    left join public.packing_unit_items pui on pui.id=lc.packing_unit_item_id
    left join public.packing_units pu on pu.id=lc.packing_unit_id
    left join public.custody_release_certificates rc on rc.id=lc.certificate_id
    where pui.id is null or pui.allocation_id<>lc.allocation_id
       or pui.packing_unit_id<>lc.packing_unit_id or pui.quantity<>lc.quantity
       or pu.id is null
       or rc.id is null or rc.basis<>'legacy_human'
       or not (
         (rc.packing_unit_id is not null and rc.packing_unit_id=lc.packing_unit_id)
         or (rc.shipment_id is not null and rc.shipment_id=pu.shipment_id)
       )
       or rc.chain_head_at_release<>lc.chain_head_at_release
  ) then
    raise exception 'CUSTODY_LEGACY_COVERAGE_DIVERGENT'
      using errcode='integrity_constraint_violation';
  end if;
  if exists(
    select pui.allocation_id,pui.id,pu.id,rc.id,pui.quantity,rc.chain_head_at_release
      from public.custody_release_certificates rc
      join public.packing_units pu
        on (rc.packing_unit_id is not null and pu.id=rc.packing_unit_id)
        or (rc.shipment_id is not null and pu.shipment_id=rc.shipment_id)
      join public.packing_unit_items pui on pui.packing_unit_id=pu.id
     where rc.basis='legacy_human'
    except
    select lc.allocation_id,lc.packing_unit_item_id,lc.packing_unit_id,
           lc.certificate_id,lc.quantity,lc.chain_head_at_release
      from public.custody_legacy_release_allocation_coverage lc
  ) then
    raise exception 'CUSTODY_LEGACY_COVERAGE_INCOMPLETE'
      using errcode='integrity_constraint_violation';
  end if;
end $$;

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

create or replace function public.custody_inspection_candidates_v2(p_case_id uuid)
returns table(evidence_id uuid) language plpgsql stable security definer set search_path=public as $$
declare
  c public.custody_integrity_cases;
  v_role text;
begin
  select a.actor_role into v_role
    from public.assert_custody_access('wms.custody.decide') a;
  select * into c from public.custody_integrity_cases where id=p_case_id;
  if not found then raise exception 'caso inexistente' using errcode='no_data_found'; end if;
  if c.physical_unit_id is null then
    raise exception 'candidatos v2 exigen scope physical_unit' using errcode='check_violation';
  end if;
  perform public.assert_custody_tenant(v_role,c.client_id);
  return query
    select e.id from public.custody_evidence e
    join public.custody_events ev on ev.id=e.event_id
    where ev.physical_unit_id=c.physical_unit_id
      and public.is_custody_inspection_evidence_v2(e.id,c.id)
    order by ev.occurred_at,e.id;
end;
$$;
revoke all on function public.custody_inspection_candidates_v2(uuid)
  from public,anon,authenticated;
grant execute on function public.custody_inspection_candidates_v2(uuid)
  to authenticated;

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
revoke execute on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[])
  from authenticated;

-- -------------------------------------------------------------------------
-- 9b. Read models físicos. No exponen storage_path, token de sesión ni PII.
-- -------------------------------------------------------------------------

create or replace function public.get_custody_physical_timeline(p_physical_unit_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  u public.custody_physical_units;
  v_role text;
  v_nodes jsonb;
begin
  select a.actor_role into v_role from public.assert_custody_access('wms.view') a;
  select * into u from public.custody_physical_units where id=p_physical_unit_id;
  if not found then raise exception 'unidad física inexistente' using errcode='no_data_found'; end if;
  perform public.assert_custody_tenant(v_role,u.client_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'type','event','event_id',ev.id,'public_id',ev.public_id,'stage',ev.stage,
    'event_type',ev.event_type,'actor_id',ev.actor_id,'occurred_at',ev.occurred_at,
    'geo',case when ev.geo_lat is null or ev.geo_lng is null then null else
      jsonb_build_object('lat',ev.geo_lat,'lng',ev.geo_lng,'source',ev.geo_source) end,
    'notes',ev.notes,'evidences',coalesce((
      select jsonb_agg(jsonb_build_object(
        'evidence_id',ce.id,'kind',ce.kind,'bucket',ce.storage_bucket,
        'sha256',ce.sha256,'redacted',ce.redacted
      ) order by ce.created_at,ce.id)
      from public.custody_evidence ce where ce.event_id=ev.id
    ),'[]'::jsonb)
  ) order by ev.chain_seq),'[]'::jsonb) into v_nodes
  from public.custody_events ev where ev.physical_unit_id=u.id;
  return jsonb_build_object('scope','physical_unit','entity_id',u.id,'nodes',v_nodes);
end;
$$;
revoke all on function public.get_custody_physical_timeline(uuid) from public,anon;
grant execute on function public.get_custody_physical_timeline(uuid) to authenticated,service_role;

create or replace function public.get_custody_physical_token(p_physical_unit_id uuid)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare
  u public.custody_physical_units;
  v_role text;
begin
  select a.actor_role into v_role from public.assert_custody_access('wms.view') a;
  select * into u from public.custody_physical_units where id=p_physical_unit_id;
  if not found then raise exception 'unidad física inexistente' using errcode='no_data_found'; end if;
  perform public.assert_custody_tenant(v_role,u.client_id);
  return u.custody_token;
end;
$$;
revoke all on function public.get_custody_physical_token(uuid) from public,anon;
grant execute on function public.get_custody_physical_token(uuid) to authenticated,service_role;

create or replace function public.get_custody_physical_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  u public.custody_physical_units;
  c public.custody_integrity_cases;
  v_role text;
  v_summary jsonb;
begin
  select a.actor_role into v_role from public.assert_custody_access('wms.view') a;
  select * into u from public.custody_physical_units where custody_token=p_token;
  if not found then raise exception 'token no resuelto' using errcode='no_data_found'; end if;
  perform public.assert_custody_tenant(v_role,u.client_id);
  select * into c from public.custody_integrity_cases where physical_unit_id=u.id;
  if not found then raise exception 'CUSTODY_CASE_MISSING' using errcode='integrity_constraint_violation'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stage',ev.stage,'event_type',ev.event_type,'occurred_at',ev.occurred_at
  ) order by ev.chain_seq),'[]'::jsonb) into v_summary
  from public.custody_events ev where ev.physical_unit_id=u.id;
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(auth.uid(),'physical_unit',u.id,'custody.token_resolve',
    jsonb_build_object('public_id',u.public_id,'scope','physical_unit'));
  return jsonb_build_object('scope','physical_unit','public_id',u.public_id,
    'status',c.state,'pod_present',false,'events',v_summary);
end;
$$;
revoke all on function public.get_custody_physical_by_token(uuid) from public,anon;
grant execute on function public.get_custody_physical_by_token(uuid) to authenticated,service_role;

-- -------------------------------------------------------------------------
-- 10. Gates globales. Ausencia de genealogía/caso/certificado = bloqueo.
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

create or replace function public.custody_assert_allocation_released(p_allocation_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  a public.stock_allocations;
  lc public.custody_legacy_release_allocation_coverage;
  v_sum numeric;
  v_n int;
  x record;
begin
  select * into a from public.stock_allocations where id=p_allocation_id for share;
  if not found then raise exception 'allocation inexistente' using errcode='no_data_found'; end if;
  select coalesce(sum(g.quantity),0),count(distinct g.physical_unit_id)
    into v_sum,v_n from public.custody_allocation_physical_units g
   where g.allocation_id=a.id;
  if v_n=0 or v_sum<>a.quantity then
    select coverage.* into lc
      from public.custody_legacy_release_allocation_coverage coverage
      join public.packing_unit_items pui
        on pui.id=coverage.packing_unit_item_id
       and pui.allocation_id=coverage.allocation_id
       and pui.packing_unit_id=coverage.packing_unit_id
       and pui.quantity=coverage.quantity
      join public.packing_units pu on pu.id=coverage.packing_unit_id
      join public.custody_release_certificates rc
        on rc.id=coverage.certificate_id
       and rc.basis='legacy_human'
       and rc.chain_head_at_release=coverage.chain_head_at_release
       and (
         (rc.packing_unit_id is not null and rc.packing_unit_id=coverage.packing_unit_id)
         or (rc.shipment_id is not null and rc.shipment_id=pu.shipment_id)
       )
      join public.custody_integrity_cases c
        on c.id=rc.case_id and c.state='RELEASED' and c.decision_id=rc.decision_id
     where coverage.allocation_id=a.id;
    if found then
      perform public.custody_assert_release_certificate(lc.certificate_id);
      return;
    end if;
    raise exception 'CUSTODY_GENEALOGY_MISSING: allocation sin cobertura física exacta'
      using errcode='check_violation';
  end if;
  for x in select physical_unit_id from public.custody_allocation_physical_units
            where allocation_id=a.id order by physical_unit_id
  loop perform public.custody_assert_physical_unit_released(x.physical_unit_id); end loop;
end;
$$;
revoke all on function public.custody_assert_allocation_released(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.custody_assert_packing_unit_released(p_packing_unit_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare x record; v_n int;
begin
  select count(*) into v_n from public.packing_unit_items where packing_unit_id=p_packing_unit_id;
  if v_n=0 then raise exception 'CUSTODY_ZERO_PACKING_CONTENT' using errcode='check_violation'; end if;
  for x in select allocation_id from public.packing_unit_items
            where packing_unit_id=p_packing_unit_id order by allocation_id
  loop perform public.custody_assert_allocation_released(x.allocation_id); end loop;
end;
$$;
revoke all on function public.custody_assert_packing_unit_released(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.custody_assert_shipment_released(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare x record; v_n int;
begin
  select count(*) into v_n from public.packing_units where shipment_id=p_shipment_id;
  if v_n=0 then raise exception 'CUSTODY_ZERO_APPLICABLE_CASES' using errcode='check_violation'; end if;
  for x in select id from public.packing_units where shipment_id=p_shipment_id order by id
  loop perform public.custody_assert_packing_unit_released(x.id); end loop;
end;
$$;
revoke all on function public.custody_assert_shipment_released(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.enforce_custody_allocation_dispatch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='despachada'
     and (tg_op='INSERT' or old.status is distinct from 'despachada') then
    perform public.custody_assert_allocation_released(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stock_allocations_custody_release on public.stock_allocations;
create trigger trg_stock_allocations_custody_release
  before insert or update of status on public.stock_allocations
  for each row execute function public.enforce_custody_allocation_dispatch();

create or replace function public.enforce_custody_packing_dispatch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  -- Un bulto SIN contenido no saca nada de custodia, así que exigirle
  -- liberación no protege ningún bien: sólo haría irrepresentable el
  -- contenedor vacío. Y no es una puerta trasera para llenarlo después:
  -- `enforce_custody_packing_content_freeze` rechaza todo alta de contenido
  -- sobre un bulto que ya está vinculado a un despacho o que no está
  -- 'abierta', de modo que un bulto vinculado vacío queda vacío para siempre.
  -- Lo que sí se exige, sin excepción, es la liberación de todo bulto CON
  -- contenido al vincularse o despacharse.
  if exists(select 1 from public.packing_unit_items where packing_unit_id=new.id)
     and ((new.shipment_id is not null
           and (tg_op='INSERT' or new.shipment_id is distinct from old.shipment_id))
          or (new.status='despachada'
              and (tg_op='INSERT' or old.status is distinct from 'despachada'))) then
    perform public.custody_assert_packing_unit_released(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_packing_units_custody_release on public.packing_units;
create trigger trg_packing_units_custody_release
  before insert or update of shipment_id,status on public.packing_units
  for each row execute function public.enforce_custody_packing_dispatch();

create or replace function public.enforce_custody_packing_content_freeze()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  p public.packing_units;
begin
  if tg_op in('UPDATE','DELETE') then
    select * into p from public.packing_units where id=old.packing_unit_id for share;
    if not found or p.status<>'abierta' or p.shipment_id is not null then
      raise exception 'CUSTODY_PACKING_CONTENT_FROZEN'
        using errcode='object_not_in_prerequisite_state';
    end if;
  end if;
  if tg_op in('INSERT','UPDATE') then
    select * into p from public.packing_units where id=new.packing_unit_id for share;
    if not found or p.status<>'abierta' or p.shipment_id is not null then
      raise exception 'CUSTODY_PACKING_CONTENT_FROZEN'
        using errcode='object_not_in_prerequisite_state';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_packing_unit_items_custody_freeze
  on public.packing_unit_items;
create trigger trg_packing_unit_items_custody_freeze
  before insert or update or delete on public.packing_unit_items
  for each row execute function public.enforce_custody_packing_content_freeze();

create or replace function public.enforce_custody_shipment_delivery()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='entregado' and old.status<>'entregado' then
    perform public.custody_assert_shipment_released(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_shipments_custody_release on public.shipments;
create trigger trg_shipments_custody_release
  before update of status on public.shipments
  for each row execute function public.enforce_custody_shipment_delivery();

create or replace function public.enforce_custody_pod_release()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  s public.shipments;
begin
  select * into s from public.shipments where id=new.shipment_id for share;
  if not found then raise exception 'despacho inexistente' using errcode='no_data_found'; end if;
  if s.status<>'entregado' then
    raise exception 'CUSTODY_POD_REQUIRES_DELIVERED_SHIPMENT'
      using errcode='object_not_in_prerequisite_state';
  end if;
  perform public.custody_assert_shipment_released(new.shipment_id);
  return new;
end;
$$;
drop trigger if exists trg_delivery_pods_custody_release on public.delivery_pods;
create trigger trg_delivery_pods_custody_release
  before insert or update of shipment_id on public.delivery_pods
  for each row execute function public.enforce_custody_pod_release();

create or replace function public.enforce_custody_shipment_final_state()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  -- Igual que en el bulto: un despacho sin bultos no transporta bienes. La
  -- afirmación de estado final se hace sobre los despachos CON contenido; el
  -- despacho vacío sigue siendo `unverifiable` para 0225 —nunca válido— y no
  -- puede entregarse ni emitir POD, porque `trg_shipments_custody_release` y
  -- `trg_delivery_pods_custody_release` llaman igual a
  -- `custody_assert_shipment_released`, que falla cerrado ante contenido cero.
  -- Vincularle un bulto con contenido pasa por `trg_packing_units_custody_release`,
  -- así que ningún bien entra a un despacho por esta vía sin liberación previa.
  if new.status in('despachado','entregado')
     and exists(select 1 from public.packing_units where shipment_id=new.id) then
    perform public.custody_assert_shipment_released(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_shipments_custody_final_state on public.shipments;
create constraint trigger trg_shipments_custody_final_state
  after insert or update on public.shipments
  deferrable initially deferred for each row
  execute function public.enforce_custody_shipment_final_state();

insert into public.custody_productive_installations(installation)
values('0250a_custody_productive_vision')
on conflict(installation) do nothing;

notify pgrst,'reload schema';

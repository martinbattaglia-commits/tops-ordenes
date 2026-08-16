-- CLIENTES FASE B · precio resoluble, snapshot pendiente y redacción económica.
-- 0244 permanece byte-idéntica. Esta migración amplía su modelo y reemplaza
-- únicamente las fronteras runtime que necesitan cotización pendiente.

alter table public.orders
  add column if not exists pricing_complete boolean not null default true;
alter table public.orders alter column total drop not null;
alter table public.orders alter column total drop default;
alter table public.orders alter column issued_total drop not null;
alter table public.orders alter column issued_total drop default;

alter table public.order_services
  add column if not exists pricing_status text not null default 'resolved',
  add column if not exists base_price_source text,
  add column if not exists original_rate_snapshot numeric(14,2),
  add column if not exists modified_rate_snapshot numeric(14,2),
  add column if not exists price_modified_by uuid references auth.users(id) on delete restrict,
  add column if not exists price_modified_at timestamptz,
  add column if not exists price_modification_reason text;
alter table public.order_services alter column rate drop not null;
alter table public.order_services alter column subtotal drop not null;
alter table public.order_services alter column rate_snapshot drop not null;
alter table public.order_services alter column subtotal_requested drop not null;

alter table public.order_services drop constraint if exists order_services_price_source_ck;
alter table public.order_services add constraint order_services_price_source_ck check (
  price_source in (
    'legacy','general_tariff','client_rate','client_rate_historical','derived',
    'manual','manual_override','bonification','pending_quote'
  )
);
alter table public.order_services drop constraint if exists order_services_pricing_formula_ck;
alter table public.order_services add constraint order_services_pricing_formula_ck check (
  jsonb_typeof(pricing_formula_snapshot)='object'
  and pricing_formula_snapshot->>'kind' in (
    'legacy','catalog_v1','transport_v1','derived_v1','manual_v1',
    'bonification_v1','historical_v1','pending_quote_v1'
  )
);
alter table public.order_services drop constraint if exists order_services_pricing_state_ck;
alter table public.order_services add constraint order_services_pricing_state_ck check (
  (
    pricing_status='resolved'
    and rate is not null and subtotal is not null
    and rate_snapshot is not null and subtotal_requested is not null
  ) or (
    pricing_status='pending_quote'
    and rate is null and subtotal is null
    and rate_snapshot is null and subtotal_requested is null
    and price_source='pending_quote'
  )
);

create table if not exists public.service_order_price_audit (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_service_id uuid not null references public.order_services(id) on delete restrict,
  source text not null check (source in (
    'client_rate','client_rate_historical','general_tariff','derived','manual',
    'manual_override','bonification','pending_quote'
  )),
  source_row_id uuid,
  original_value numeric(14,2),
  final_value numeric(14,2),
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  check (
    (source in ('manual','manual_override') and length(btrim(coalesce(reason,'')))>=3)
    or source not in ('manual','manual_override')
  )
);
create index if not exists service_order_price_audit_order_idx
  on public.service_order_price_audit(order_id,id);
alter table public.service_order_price_audit enable row level security;
drop trigger if exists trg_service_order_price_audit_immutable on public.service_order_price_audit;
create trigger trg_service_order_price_audit_immutable
before update or delete on public.service_order_price_audit
for each row execute function public._service_order_append_only();
drop trigger if exists trg_service_order_price_audit_no_truncate on public.service_order_price_audit;
create trigger trg_service_order_price_audit_no_truncate
before truncate on public.service_order_price_audit
for each statement execute function public._service_order_append_only();

-- Snapshot económico y de cantidades: las nuevas columnas también son
-- inmutables una vez emitida la OS.
create or replace function public._service_order_snapshot_immutable()
returns trigger language plpgsql as $$
declare v_mode text:=current_setting('app.service_order_mutation',true);
begin
  if row(
    old.order_id,old.service_slug,old.label,old.qty,old.unit,old.rate,old.subtotal,
    old.tariff_rate_id,old.client_rate_id,old.price_source,old.pricing_reason,
    old.pricing_formula_snapshot,old.min_qty_snapshot,old.min_billing_snapshot,
    old.qty_requested,old.qty_effective,old.rate_snapshot,old.subtotal_requested,
    old.line_sequence,old.pricing_snapshot_at,old.currency_snapshot,
    old.pricing_status,old.base_price_source,old.original_rate_snapshot,
    old.modified_rate_snapshot,old.price_modified_by,old.price_modified_at,
    old.price_modification_reason
  ) is distinct from row(
    new.order_id,new.service_slug,new.label,new.qty,new.unit,new.rate,new.subtotal,
    new.tariff_rate_id,new.client_rate_id,new.price_source,new.pricing_reason,
    new.pricing_formula_snapshot,new.min_qty_snapshot,new.min_billing_snapshot,
    new.qty_requested,new.qty_effective,new.rate_snapshot,new.subtotal_requested,
    new.line_sequence,new.pricing_snapshot_at,new.currency_snapshot,
    new.pricing_status,new.base_price_source,new.original_rate_snapshot,
    new.modified_rate_snapshot,new.price_modified_by,new.price_modified_at,
    new.price_modification_reason
  ) then raise exception 'El snapshot emitido de la OS es inmutable'; end if;
  if row(old.qty_provided,old.subtotal_provided,old.qty_billed,old.subtotal_billed)
     is distinct from row(new.qty_provided,new.subtotal_provided,new.qty_billed,new.subtotal_billed)
     and v_mode not in ('fulfillment','billing') then
    raise exception 'Prestacion y facturacion solo pueden cambiar mediante RPC autorizada';
  end if;
  return new;
end $$;

create or replace function public._service_order_header_snapshot_immutable()
returns trigger language plpgsql as $$
begin
  if row(
    old.depot,old.client_id,old.operator_id,old.h_start,old.h_end,old.hours,
    old.pallets,old.units,old.km,old.observ,old.total,old.issued_total,
    old.tariff_version_id,old.pricing_currency,old.pricing_snapshot_at,
    old.pricing_complete,old.created_by
  ) is distinct from row(
    new.depot,new.client_id,new.operator_id,new.h_start,new.h_end,new.hours,
    new.pallets,new.units,new.km,new.observ,new.total,new.issued_total,
    new.tariff_version_id,new.pricing_currency,new.pricing_snapshot_at,
    new.pricing_complete,new.created_by
  ) and exists(select 1 from public.service_order_events e
    where e.order_id=old.id and e.event_kind='issued') then
    raise exception 'La cabecera y el total emitido de la OS son inmutables';
  end if;
  return new;
end $$;

-- Direct table, realtime y vistas económicas quedan cerradas para las dos
-- identidades incluso si alguien manipula profiles.role.
drop policy if exists "catalog read all" on public.services_catalog;
create policy "catalog read all" on public.services_catalog for select using (
  auth.role()='authenticated' and public.nexus_is_depot_manager_principal() is distinct from true
);
drop policy if exists "ops read all" on public.operators;
create policy "ops read all" on public.operators for select using (
  auth.role()='authenticated' and (
    public.nexus_is_depot_manager_principal() is distinct from true
    or (
      public.nexus_depot_manager_valid() is not distinct from true
      and depot is not distinct from (select s.depot from public.nexus_depot_manager_scope() s)
    )
  )
);
drop policy if exists "orders read" on public.orders;
create policy "orders read" on public.orders for select using (
  public.nexus_is_depot_manager_principal() is distinct from true and (
    public.current_role() in ('admin','operaciones','supervisor')
    or client_id=(select client_id from public.profiles where id=auth.uid())
  )
);
drop policy if exists "order_services read" on public.order_services;
create policy "order_services read" on public.order_services for select using (
  public.nexus_is_depot_manager_principal() is distinct from true
  and exists(select 1 from public.orders o where o.id=order_id)
);
drop policy if exists "service tariff authenticated read" on public.service_tariff_versions;
create policy "service tariff authenticated read" on public.service_tariff_versions
for select to authenticated using (public.nexus_is_depot_manager_principal() is distinct from true);
drop policy if exists "service rates authenticated read" on public.service_tariff_rates;
create policy "service rates authenticated read" on public.service_tariff_rates
for select to authenticated using (public.nexus_is_depot_manager_principal() is distinct from true);
drop policy if exists "client service rates authorized read" on public.client_service_rates;
create policy "client service rates authorized read" on public.client_service_rates
for select to authenticated using (
  public.nexus_is_depot_manager_principal() is distinct from true
  and (public.has_permission('servicios.create') or public.has_permission('servicios.edit'))
);
drop policy if exists "service order events authorized read" on public.service_order_events;
create policy "service order events authorized read" on public.service_order_events
for select to authenticated using (
  public.nexus_is_depot_manager_principal() is distinct from true
  and public.has_permission('servicios.view')
);
drop policy if exists "service billing adjustments authorized read" on public.service_order_billing_adjustments;
create policy "service billing adjustments authorized read" on public.service_order_billing_adjustments
for select to authenticated using (
  public.nexus_is_depot_manager_principal() is distinct from true
  and public.has_permission('servicios.view')
);
create policy "service price audit authorized read" on public.service_order_price_audit
for select to authenticated using (
  public.nexus_is_depot_manager_principal() is distinct from true
  and public.has_permission('servicios.edit')
);
revoke all on public.service_order_price_audit from public,anon,authenticated,service_role;
grant select on public.service_order_price_audit to authenticated,service_role;

create or replace view public.v_orders_dashboard with (security_invoker=true) as
select o.id,o.public_id,o.short_id,o.date,o.depot,o.status,o.total,o.hours,
  o.signed_by,o.signed_at,o.created_at,c.razon client_razon,c.cuit client_cuit,
  c.tags client_tags,op.full_name operator_name,op.avatar operator_avatar
from public.orders o
left join public.clients c on c.id=o.client_id
left join public.operators op on op.id=o.operator_id;

update storage.buckets set public=false where id in ('signatures','pdfs');
drop policy if exists "public read signatures" on storage.objects;
drop policy if exists "public read pdfs" on storage.objects;
create policy "authenticated non-principal read signatures" on storage.objects
for select to authenticated using (
  bucket_id='signatures' and public.nexus_is_depot_manager_principal() is distinct from true
);
create policy "authenticated non-principal read pdfs" on storage.objects
for select to authenticated using (
  bucket_id='pdfs' and public.nexus_is_depot_manager_principal() is distinct from true
);
drop policy if exists "auth read attachments" on storage.objects;
create policy "auth read attachments" on storage.objects for select to authenticated using (
  bucket_id='attachments' and public.nexus_is_depot_manager_principal() is distinct from true
);
drop policy if exists "auth write signatures" on storage.objects;
create policy "auth write signatures" on storage.objects for insert to authenticated with check (
  bucket_id='signatures' and public.nexus_is_depot_manager_principal() is distinct from true
);
drop policy if exists "auth update signatures" on storage.objects;
create policy "auth update signatures" on storage.objects for update to authenticated
using (bucket_id='signatures' and public.nexus_is_depot_manager_principal() is distinct from true)
with check (bucket_id='signatures' and public.nexus_is_depot_manager_principal() is distinct from true);
drop policy if exists "auth write pdfs" on storage.objects;
create policy "auth write pdfs" on storage.objects for insert to authenticated with check (
  bucket_id='pdfs' and public.nexus_is_depot_manager_principal() is distinct from true
);
drop policy if exists "auth update pdfs" on storage.objects;
create policy "auth update pdfs" on storage.objects for update to authenticated
using (bucket_id='pdfs' and public.nexus_is_depot_manager_principal() is distinct from true)
with check (bucket_id='pdfs' and public.nexus_is_depot_manager_principal() is distinct from true);
drop policy if exists "auth write attachments" on storage.objects;
create policy "auth write attachments" on storage.objects for insert to authenticated with check (
  bucket_id='attachments' and public.nexus_is_depot_manager_principal() is distinct from true
);

-- Proyecciones operativas allowlist. Ninguna columna económica ni identidad de
-- tarifa cruza la frontera.
create or replace function public.nexus_depot_manager_orders(
  p_status text default null,p_search text default null,p_limit int default 18,p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_depot public.depot_t; v_rows jsonb; v_total bigint; v_counts jsonb;
begin
  if public.nexus_depot_manager_valid() is distinct from true
     or public.has_permission('servicios.view') is distinct from true then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  select s.depot into v_depot from public.nexus_depot_manager_scope() s;
  with scoped as (
    select o.* from public.orders o where o.depot=v_depot
      and (p_status is null or p_status='todas' or o.status::text=p_status)
      and (nullif(btrim(p_search),'') is null or o.public_id ilike '%'||btrim(p_search)||'%')
  ) select count(*) into v_total from scoped;
  select coalesce(jsonb_object_agg(status,count),'{}'::jsonb)
  into v_counts from (
    select o.status::text status,count(*) from public.orders o where o.depot=v_depot group by o.status
  ) s;
  select coalesce(jsonb_agg(row_data order by row_data->>'date' desc),'[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id',o.id,'public_id',o.public_id,'short_id',o.short_id,'date',o.date,
      'depot',o.depot,'status',o.status,'client_id',o.client_id,'operator_id',o.operator_id,
      'h_start',o.h_start,'h_end',o.h_end,'hours',o.hours,'pallets',o.pallets,
      'units',o.units,'km',o.km,'observ',o.observ,'signed_by',o.signed_by,
      'signed_doc',o.signed_doc,'signed_at',o.signed_at,'signature_hash',o.signature_hash,
      'created_at',o.created_at,'created_by',o.created_by,'pricing_complete',o.pricing_complete,
      'prices_hidden',true,'total',null,'issued_total',null,'provided_total',null,'billed_total',null,
      'client',jsonb_build_object('id',c.id,'razon',c.razon,'cuit',c.cuit,'tags',c.tags),
      'operator',jsonb_build_object('id',op.id,'full_name',op.full_name,'role',op.role,'avatar',op.avatar,'depot',op.depot),
      'services',coalesce((select jsonb_agg(jsonb_build_object(
        'id',os.id,'service_slug',os.service_slug,'label',os.label,'qty',os.qty,
        'unit',os.unit,'qty_requested',os.qty_requested,'qty_provided',os.qty_provided,
        'pricing_status',os.pricing_status,'rate',null,'subtotal',null
      ) order by os.line_sequence) from public.order_services os where os.order_id=o.id),'[]'::jsonb)
    ) row_data
    from public.orders o join public.clients c on c.id=o.client_id
    left join public.operators op on op.id=o.operator_id
    where o.depot=v_depot
      and (p_status is null or p_status='todas' or o.status::text=p_status)
      and (nullif(btrim(p_search),'') is null or o.public_id ilike '%'||btrim(p_search)||'%')
    order by o.date desc limit least(greatest(coalesce(p_limit,18),1),100)
    offset greatest(coalesce(p_offset,0),0)
  ) rows;
  return jsonb_build_object('rows',v_rows,'total',v_total,
    'counts',v_counts||jsonb_build_object('todas',(select count(*) from public.orders o where o.depot=v_depot)));
end $$;
revoke all on function public.nexus_depot_manager_orders(text,text,int,int) from public,anon;
grant execute on function public.nexus_depot_manager_orders(text,text,int,int) to authenticated;

create or replace function public.nexus_depot_manager_order(p_identifier text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb; v_depot public.depot_t;
begin
  if public.nexus_depot_manager_valid() is distinct from true
     or public.has_permission('servicios.view') is distinct from true then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  select s.depot into v_depot from public.nexus_depot_manager_scope() s;
  select jsonb_build_object(
    'id',o.id,'public_id',o.public_id,'short_id',o.short_id,'date',o.date,
    'depot',o.depot,'status',o.status,'client_id',o.client_id,'operator_id',o.operator_id,
    'h_start',o.h_start,'h_end',o.h_end,'hours',o.hours,'pallets',o.pallets,
    'units',o.units,'km',o.km,'observ',o.observ,'signed_by',o.signed_by,
    'signed_doc',o.signed_doc,'signed_at',o.signed_at,'signature_hash',o.signature_hash,
    'created_at',o.created_at,'created_by',o.created_by,'pricing_complete',o.pricing_complete,
    'prices_hidden',true,'total',null,'issued_total',null,'provided_total',null,'billed_total',null,
    'client',jsonb_build_object('id',c.id,'razon',c.razon,'cuit',c.cuit,'tags',c.tags),
    'operator',jsonb_build_object('id',op.id,'full_name',op.full_name,'role',op.role,'avatar',op.avatar,'depot',op.depot),
    'services',coalesce((select jsonb_agg(jsonb_build_object(
      'id',os.id,'service_slug',os.service_slug,'label',os.label,'qty',os.qty,
      'unit',os.unit,'qty_requested',os.qty_requested,'qty_provided',os.qty_provided,
      'pricing_status',os.pricing_status,'rate',null,'subtotal',null
    ) order by os.line_sequence) from public.order_services os where os.order_id=o.id),'[]'::jsonb)
  ) into v_result
  from public.orders o join public.clients c on c.id=o.client_id
  left join public.operators op on op.id=o.operator_id
  where o.depot=v_depot and (o.public_id=p_identifier or o.id::text=p_identifier)
  limit 1;
  return v_result;
end $$;
revoke all on function public.nexus_depot_manager_order(text) from public,anon;
grant execute on function public.nexus_depot_manager_order(text) to authenticated;

alter function public.service_order_issue(jsonb,jsonb) rename to service_order_issue_0244;
revoke all on function public.service_order_issue_0244(jsonb,jsonb)
  from public,anon,authenticated;

create function public.service_order_issue(p_order jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_principal boolean; v_scope record;
  v_order_id uuid; v_public_id text; v_short_id integer; v_order_date timestamptz;
  v_version public.service_tariff_versions%rowtype;
  v_line jsonb; v_rate public.service_tariff_rates%rowtype;
  v_client_rate public.client_service_rates%rowtype;
  v_service_id uuid; v_kind text; v_slug text; v_label text;
  v_unit public.service_unit_t; v_source text; v_base_source text; v_reason text;
  v_q_req numeric; v_q_eff numeric; v_price numeric; v_original numeric;
  v_subtotal numeric; v_min_qty numeric; v_min_billing numeric;
  v_total numeric:=0; v_transport_total numeric:=0; v_surcharge numeric;
  v_complete boolean:=true; v_line_sequence integer:=0;
  v_client_id uuid; v_client_total numeric; v_pricing_at timestamptz;
  v_signature_b64 text; v_signature_bytes bytea; v_signature_hash text;
  v_source_row_id uuid; v_formula jsonb; v_key text;
begin
  if v_actor is null then raise exception 'Auth requerida' using errcode='28000'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_actor and p.active is not distinct from true) then
    raise exception 'Perfil activo requerido' using errcode='42501';
  end if;
  if public.has_permission('servicios.create') is distinct from true
     or public.has_permission('servicios.sign') is distinct from true then
    raise exception 'no autorizado' using errcode='42501';
  end if;
  if coalesce(jsonb_typeof(p_order),'missing')<>'object'
     or coalesce(jsonb_typeof(p_lines),'missing')<>'array'
     or jsonb_array_length(p_lines)=0 then
    raise exception 'Orden de servicio inválida';
  end if;
  v_principal:=public.nexus_is_depot_manager_principal();
  if v_principal then
    select * into v_scope from public.nexus_depot_manager_scope();
    if v_scope.is_authorized is distinct from true
       or p_order->>'depot' is distinct from v_scope.depot::text then
      raise exception 'no autorizado' using errcode='42501';
    end if;
    if exists(select 1 from jsonb_array_elements(p_lines) x
      where x ? 'manual_rate' or x ? 'manual_subtotal'
        or x->>'pricing_kind' in ('manual','bonification','urgent')) then
      raise exception 'no autorizado' using errcode='42501';
    end if;
  end if;
  if coalesce(p_order->>'client_id','') !~* '^[0-9a-f-]{36}$'
     or coalesce(p_order->>'operator_id','') !~* '^[0-9a-f-]{36}$'
     or p_order->>'depot' not in ('MAGALDI','LUJAN') then
    raise exception 'Identidad canónica de OS inválida';
  end if;
  v_client_id:=(p_order->>'client_id')::uuid;
  if not exists(select 1 from public.clients c where c.id=v_client_id and coalesce(c.activo,true)) then
    raise exception 'Cliente inexistente o inactivo';
  end if;
  if not exists(select 1 from public.operators op where op.id=(p_order->>'operator_id')::uuid
    and coalesce(op.active,true)
    and (not v_principal or op.depot is not distinct from v_scope.depot)) then
    raise exception 'Responsable operativo fuera de sede' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_order->>'signed_by',''))) not between 2 and 120
     or coalesce(p_order->>'signature_data_url','') !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'
     or length(coalesce(p_order->>'observ',''))>2000 then
    raise exception 'Firma de OS inválida';
  end if;
  v_signature_b64:=substr(p_order->>'signature_data_url',23);
  begin v_signature_bytes:=decode(v_signature_b64,'base64');
  exception when others then raise exception 'Firma PNG inválida'; end;
  if not public._service_order_png_is_valid(v_signature_bytes) then raise exception 'Firma PNG inválida'; end if;
  v_signature_hash:=encode(sha256(v_signature_bytes),'hex');
  foreach v_key in array array['hours','pallets','units','km'] loop
    if coalesce(p_order->>v_key,'') !~ '^\d+$' then raise exception 'Magnitud operativa inválida'; end if;
  end loop;
  if coalesce(p_order->>'h_start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(p_order->>'h_end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Horario inválido';
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('tops:service-pricing:tariff:v1',0));
  perform pg_advisory_xact_lock_shared(hashtextextended('tops:service-pricing:client-rate:v1',0));
  v_pricing_at:=clock_timestamp();
  select * into strict v_version from public.service_tariff_versions
  where status in ('active','superseded') and effective_from<=v_pricing_at
    and (effective_to is null or effective_to>v_pricing_at);
  if not v_principal and (
    coalesce(p_order->>'expected_tariff_version_id','')!~*'^[0-9a-f-]{36}$'
    or (p_order->>'expected_tariff_version_id')::uuid<>v_version.id
  ) then raise exception 'El tarifario cambio durante la firma; recargue la orden'; end if;

  insert into public.orders(
    depot,client_id,operator_id,h_start,h_end,hours,pallets,units,km,observ,
    total,issued_total,tariff_version_id,pricing_currency,pricing_snapshot_at,
    pricing_complete,status,signed_by,signed_doc,signed_at,signature_hash,
    geo_lat,geo_lng,ip,created_by
  ) values(
    case when v_principal then v_scope.depot else (p_order->>'depot')::public.depot_t end,
    v_client_id,(p_order->>'operator_id')::uuid,p_order->>'h_start',p_order->>'h_end',
    (p_order->>'hours')::int,(p_order->>'pallets')::int,(p_order->>'units')::int,
    (p_order->>'km')::int,nullif(p_order->>'observ',''),null,null,v_version.id,
    v_version.currency,v_pricing_at,false,'FIRMADA',p_order->>'signed_by',
    nullif(p_order->>'signed_doc',''),now(),v_signature_hash,
    nullif(p_order->>'geo_lat','')::double precision,
    nullif(p_order->>'geo_lng','')::double precision,nullif(p_order->>'ip',''),v_actor
  ) returning id,public_id,short_id,date into v_order_id,v_public_id,v_short_id,v_order_date;
  insert into public.service_order_signatures(order_id,png,sha256,created_at)
  values(v_order_id,v_signature_bytes,v_signature_hash,v_pricing_at);

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_sequence:=v_line_sequence+1; v_kind:=v_line->>'pricing_kind';
    v_slug:=btrim(coalesce(v_line->>'service_slug',''));
    v_reason:=nullif(btrim(coalesce(v_line->>'pricing_reason','')),'');
    if v_kind not in ('catalog','transport','urgent','manual','bonification')
       or length(v_slug) not between 2 and 200
       or coalesce(jsonb_typeof(v_line->'qty_requested'),'missing')<>'number' then
      raise exception 'Línea de OS inválida';
    end if;
    v_q_req:=(v_line->>'qty_requested')::numeric;
    if v_q_req<=0 or v_q_req>=10000000000 or v_q_req<>round(v_q_req,2) then
      raise exception 'Cantidad solicitada inválida';
    end if;
    v_service_id:=gen_random_uuid(); v_rate.id:=null; v_client_rate.id:=null;
    v_price:=null; v_original:=null; v_subtotal:=null; v_source_row_id:=null;
    v_source:='pending_quote'; v_base_source:=null; v_min_qty:=0; v_min_billing:=0;
    v_q_eff:=v_q_req; v_formula:='{"kind":"pending_quote_v1"}'::jsonb;

    if v_kind in ('catalog','transport') then
      select * into v_rate from public.service_tariff_rates
      where version_id=v_version.id and service_slug=v_slug;
      if not found then raise exception 'Servicio fuera del tarifario vigente'; end if;
      if (v_kind='transport') is distinct from (v_rate.service_slug like 'transporte:%') then
        raise exception 'Tipo de servicio inválido';
      end if;
      if not v_principal and (
        coalesce(v_line->>'expected_tariff_rate_id','')!~*'^[0-9a-f-]{36}$'
        or (v_line->>'expected_tariff_rate_id')::uuid<>v_rate.id
      ) then raise exception 'La tarifa del servicio cambio durante la firma'; end if;
      v_label:=v_rate.label; v_unit:=v_rate.unit;

      if not v_principal then
        select * into v_client_rate from public.client_service_rates
        where client_id=v_client_id and service_slug=v_slug and currency=v_version.currency
          and valid_from<=v_pricing_at and (valid_to is null or valid_to>v_pricing_at)
        order by valid_from desc,created_at desc,id desc limit 1;
        if found then
          v_price:=v_client_rate.rate; v_original:=v_price; v_source:='client_rate';
          v_base_source:=v_source; v_source_row_id:=v_client_rate.id;
          v_min_qty:=coalesce(v_client_rate.min_qty,v_rate.min_qty);
          v_min_billing:=coalesce(v_client_rate.min_billing,v_rate.min_billing);
          if nullif(v_line->>'expected_client_rate_id','') is not null
             and (v_line->>'expected_client_rate_id')::uuid<>v_client_rate.id then
            raise exception 'El precio particular cambio durante la firma';
          end if;
        else
          -- Histórico aprobado = último snapshot inmutable emitido para el
          -- mismo cliente/servicio. No depende de una fila tarifaria expirada
          -- que el timeline continuo de 0244 hace inalcanzable.
          select os.rate_snapshot,os.id into v_price,v_source_row_id
          from public.order_services os
          join public.orders o on o.id=os.order_id
          where o.client_id=v_client_id and os.service_slug=v_slug
            and os.rate_snapshot is not null and os.pricing_status='resolved'
            and o.pricing_snapshot_at<v_pricing_at
            and exists(select 1 from public.service_order_events e
              where e.order_id=o.id and e.event_kind='issued')
          order by o.pricing_snapshot_at desc,os.line_sequence desc,os.id desc
          limit 1;
          if found then
            v_original:=v_price;
            v_source:='client_rate_historical'; v_base_source:=v_source;
            v_min_qty:=v_rate.min_qty; v_min_billing:=v_rate.min_billing;
            v_formula:='{"kind":"historical_v1"}'::jsonb;
          elsif v_rate.rate is not null then
            v_price:=v_rate.rate; v_original:=v_price; v_source:='general_tariff';
            v_base_source:=v_source; v_source_row_id:=v_rate.id;
            v_min_qty:=v_rate.min_qty; v_min_billing:=v_rate.min_billing;
          end if;
        end if;
        if v_line ? 'manual_rate' then
          if public.has_permission('servicios.edit') is distinct from true
             or v_reason is null or length(v_reason)<3
             or jsonb_typeof(v_line->'manual_rate')<>'number' then
            raise exception 'Precio manual no autorizado';
          end if;
          v_price:=(v_line->>'manual_rate')::numeric;
          if v_price<=0 or v_price<>round(v_price,2) then raise exception 'Precio manual inválido'; end if;
          v_source:=case when v_original is null then 'manual' else 'manual_override' end;
          v_min_qty:=coalesce(v_min_qty,0); v_min_billing:=coalesce(v_min_billing,0);
        end if;
      end if;

      if v_price is not null then
        v_q_eff:=greatest(v_q_req,v_min_qty); v_subtotal:=round(greatest(v_q_eff*v_price,v_min_billing),2);
        v_formula:=case when v_source='client_rate_historical' then '{"kind":"historical_v1"}'::jsonb
          else '{"kind":"catalog_v1"}'::jsonb end;
        if v_kind='transport' then
          if v_q_req<>trunc(v_q_req) then raise exception 'Viajes deben ser enteros'; end if;
          v_surcharge:=case coalesce(v_line->>'surcharge','none')
            when 'none' then 0 when '17_19' then .25 when '19_21' then .5 when '21_plus' then 1 else null end;
          if v_surcharge is null then raise exception 'Recargo inválido'; end if;
          if coalesce((v_line->>'second_trip_discount')::boolean,false) and v_q_eff>=2 then
            v_subtotal:=v_price+(v_q_eff-1)*v_price*.5;
          else v_subtotal:=v_q_eff*v_price; end if;
          v_subtotal:=round(greatest(v_subtotal,v_min_billing)*(1+v_surcharge),2);
          v_formula:=jsonb_build_object('kind','transport_v1','second_trip_discount',
            coalesce((v_line->>'second_trip_discount')::boolean,false),'surcharge_pct',v_surcharge);
          v_transport_total:=v_transport_total+v_subtotal;
        end if;
      else v_complete:=false; end if;
    elsif v_kind='urgent' then
      v_label:='Recargo envio urgente'; v_unit:='un'; v_q_req:=1; v_q_eff:=1;
      if v_transport_total>0 and v_complete then
        v_price:=v_transport_total; v_subtotal:=v_transport_total; v_source:='derived';
        v_base_source:='derived'; v_original:=v_price;
        v_formula:='{"kind":"derived_v1","basis":"transport_total"}'::jsonb;
      else v_complete:=false; end if;
    else
      if public.has_permission('servicios.edit') is distinct from true
         or v_reason is null or length(v_reason)<3
         or jsonb_typeof(v_line->'manual_rate')<>'number' then
        raise exception 'Precio manual no autorizado';
      end if;
      v_label:=left(coalesce(nullif(btrim(v_line->>'label'),''),v_slug),200);
      v_unit:=coalesce(nullif(v_line->>'unit',''),'un')::public.service_unit_t;
      v_price:=(v_line->>'manual_rate')::numeric; v_subtotal:=round(v_q_req*v_price,2);
      if (v_kind='manual' and v_price<=0) or (v_kind='bonification' and v_price>=0) then
        raise exception 'Precio manual inválido';
      end if;
      v_source:=v_kind; v_base_source:=v_kind;
      v_original:=case when v_kind='manual' then null else v_price end;
      v_formula:=jsonb_build_object('kind',case when v_kind='manual' then 'manual_v1' else 'bonification_v1' end);
    end if;

    if v_price is null then
      v_source:='pending_quote'; v_formula='{"kind":"pending_quote_v1"}'::jsonb;
      v_subtotal:=null; v_q_eff:=v_q_req; v_min_qty:=0; v_min_billing:=0;
    else v_total:=v_total+v_subtotal; end if;
    insert into public.order_services(
      id,order_id,service_slug,label,qty,unit,rate,subtotal,tariff_rate_id,client_rate_id,
      price_source,pricing_reason,pricing_formula_snapshot,min_qty_snapshot,min_billing_snapshot,
      qty_requested,qty_effective,rate_snapshot,subtotal_requested,line_sequence,pricing_snapshot_at,
      currency_snapshot,pricing_status,base_price_source,original_rate_snapshot,
      modified_rate_snapshot,price_modified_by,price_modified_at,price_modification_reason
    ) values(
      v_service_id,v_order_id,v_slug,v_label,v_q_eff,v_unit,v_price,v_subtotal,v_rate.id,
      case when v_source in ('client_rate','client_rate_historical') then v_client_rate.id end,
      v_source,v_reason,v_formula,v_min_qty,v_min_billing,v_q_req,v_q_eff,v_price,v_subtotal,
      v_line_sequence,v_pricing_at,v_version.currency,
      case when v_price is null then 'pending_quote' else 'resolved' end,v_base_source,v_original,
      case when v_source in ('manual','manual_override') then v_price end,
      case when v_source in ('manual','manual_override') then v_actor end,
      case when v_source in ('manual','manual_override') then v_pricing_at end,
      case when v_source in ('manual','manual_override') then v_reason end
    );
    insert into public.service_order_price_audit(
      order_id,order_service_id,source,source_row_id,original_value,final_value,actor_id,reason,created_at
    ) values(
      v_order_id,v_service_id,
      v_source,
      v_source_row_id,v_original,v_price,v_actor,
      case when v_source in ('manual','manual_override') then v_reason end,v_pricing_at
    );
  end loop;

  if v_complete and v_total<0 then raise exception 'Total emitido inválido'; end if;
  if v_complete then
    if jsonb_typeof(p_order->'client_total')<>'number' then raise exception 'Total firmado inválido'; end if;
    v_client_total:=(p_order->>'client_total')::numeric;
    if v_client_total is distinct from v_total then raise exception 'El total firmado no coincide'; end if;
  elsif jsonb_typeof(p_order->'client_total') is distinct from 'null' then
    raise exception 'Una cotización pendiente no lleva total';
  end if;
  update public.orders set total=case when v_complete then v_total end,
    issued_total=case when v_complete then v_total end,pricing_complete=v_complete
  where id=v_order_id;
  insert into public.service_order_events(order_id,event_kind,actor_id,payload,created_at)
  values(v_order_id,'issued',v_actor,
    case when v_principal then jsonb_build_object(
      'line_count',jsonb_array_length(p_lines),'pricing_complete',v_complete,
      'signature_hash',v_signature_hash,'pricing_snapshot_at',v_pricing_at
    ) else jsonb_build_object(
      'tariff_version_id',v_version.id,'currency',v_version.currency,
      'issued_total',case when v_complete then v_total end,'pricing_complete',v_complete,
      'signature_hash',v_signature_hash,'line_count',jsonb_array_length(p_lines),
      'pricing_snapshot_at',v_pricing_at
    ) end,v_pricing_at);
  insert into public.audit_log(user_id,entity,entity_id,action,payload,ip)
  values(v_actor,'orders',v_order_id,'create_signed_pricing_snapshot',
    case when v_principal then jsonb_build_object('pricing_complete',v_complete,'line_count',jsonb_array_length(p_lines))
      else jsonb_build_object('tariff_version_id',v_version.id,'currency',v_version.currency,
        'issued_total',case when v_complete then v_total end,'pricing_complete',v_complete) end,
    nullif(p_order->>'ip',''));
  if v_principal then
    return jsonb_build_object('id',v_order_id,'public_id',v_public_id,'short_id',v_short_id,
      'date',v_order_date,'pricing_complete',v_complete,'signature_hash',v_signature_hash);
  end if;
  return jsonb_build_object('id',v_order_id,'public_id',v_public_id,'short_id',v_short_id,
    'date',v_order_date,'total',case when v_complete then v_total end,
    'pricing_complete',v_complete,'tariff_version_id',v_version.id,
    'currency',v_version.currency,'signature_hash',v_signature_hash);
end $$;
revoke all on function public.service_order_issue(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_order_issue(jsonb,jsonb) to authenticated;

alter function public.service_order_record_fulfillment(uuid,numeric,text)
  rename to service_order_record_fulfillment_0244;
revoke all on function public.service_order_record_fulfillment_0244(uuid,numeric,text)
  from public,anon,authenticated;

create function public.service_order_record_fulfillment(
  p_order_service_id uuid,p_qty_provided numeric,p_reason text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_line public.order_services%rowtype; v_order public.orders%rowtype;
begin
  if public.nexus_is_depot_manager_principal() is distinct from true then
    perform public.service_order_record_fulfillment_0244(
      p_order_service_id,p_qty_provided,p_reason
    );
    return;
  end if;
  if public.nexus_depot_manager_valid() is distinct from true
     or public.has_permission('servicios.view') is distinct from true
     or p_qty_provided is null or p_qty_provided<0 or p_qty_provided>=10000000000
     or p_qty_provided<>round(p_qty_provided,2)
     or length(btrim(coalesce(p_reason,'')))<3 then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  select os.* into strict v_line from public.order_services os
  where os.id=p_order_service_id for update;
  select o.* into strict v_order from public.orders o where o.id=v_line.order_id for update;
  if v_order.depot is distinct from (select s.depot from public.nexus_depot_manager_scope() s) then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  perform set_config('app.service_order_mutation','fulfillment',true);
  update public.order_services set qty_provided=p_qty_provided,subtotal_provided=null
  where id=p_order_service_id;
  update public.orders set provided_total=null where id=v_order.id;
  insert into public.service_order_events(
    order_id,order_service_id,event_kind,reason,actor_id,payload
  ) values(
    v_order.id,v_line.id,'fulfillment_recorded',btrim(p_reason),auth.uid(),
    jsonb_build_object('qty_requested',v_line.qty_requested,'qty_provided',p_qty_provided)
  );
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(auth.uid(),'orders',v_order.id,'service_fulfillment_recorded',
    jsonb_build_object('order_service_id',v_line.id,'qty_provided',p_qty_provided,
      'reason',btrim(p_reason)));
end $$;
revoke all on function public.service_order_record_fulfillment(uuid,numeric,text)
  from public,anon,authenticated,service_role;
grant execute on function public.service_order_record_fulfillment(uuid,numeric,text)
  to authenticated;

notify pgrst,'reload schema';

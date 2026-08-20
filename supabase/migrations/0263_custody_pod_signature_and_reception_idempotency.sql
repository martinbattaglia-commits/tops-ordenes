-- 0263 · Custodia: firma POD temporal/autorizada + recepción durablemente idempotente.
-- Forward aditivo y fail-closed. No aplica datos productivos ni asigna capacidades.

begin;

-- ── 1. Capacidad estrecha, sin grants automáticos ────────────────────────
do $$
begin
  if exists (
    select 1 from public.permissions
     where module = 'wms'::public.permission_module_t
       and action = 'sign'::public.permission_action_t
       and slug <> 'wms.custody.pod'
  ) then
    raise exception '0263_PERMISSION_SLOT_COLLISION: wms/sign ya está ocupado';
  end if;
end $$;

insert into public.permissions(slug,module,action,label,description)
values (
  'wms.custody.pod','wms','sign','WMS · firmar y emitir POD de Custodia',
  'Capturar una firma post-entrega y emitir el POD contra el estado liberado exacto'
)
on conflict (slug) do nothing;

do $$
begin
  if not exists (
    select 1 from public.permissions
     where slug='wms.custody.pod' and module='wms' and action='sign'
  ) then
    raise exception '0263_PERMISSION_IDENTITY_MISMATCH: wms.custody.pod';
  end if;
end $$;

create or replace function public.assert_custody_explicit_access(p_permission text)
returns table(actor_id uuid, session_id uuid, actor_role text)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare v_actor uuid; v_session uuid; v_role text;
begin
  select a.actor_id,a.session_id,a.actor_role
    into v_actor,v_session,v_role
    from public.assert_custody_access(p_permission) a;
  if not exists (
    select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id=ur.role_id
      join public.permissions p on p.id=rp.permission_id
     where ur.user_id=v_actor and p.slug=p_permission
  ) then
    raise exception 'CUSTODY_EXPLICIT_CAPABILITY_REQUIRED: %',p_permission
      using errcode='42501';
  end if;
  return query select v_actor,v_session,v_role;
end $$;
revoke all on function public.assert_custody_explicit_access(text)
  from public,anon,authenticated,service_role;

-- ── 2. Snapshot canónico shipment → unidades físicas → casos/certificados ─
create or replace function public.custody_shipment_release_snapshot(p_shipment_id uuid)
returns text language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare v_doc jsonb;
begin
  if p_shipment_id is null then
    raise exception 'shipment requerido' using errcode='22023';
  end if;
  select jsonb_build_object(
    'contract','custody-pod-release/v1',
    'shipment',jsonb_build_object(
      'id',s.id,'order_id',s.order_id,'status',s.status,'delivered_at',s.delivered_at
    ),
    'packing_units',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',pu.id,'status',pu.status,'shipment_id',pu.shipment_id
      ) order by pu.id::text)
      from public.packing_units pu where pu.shipment_id=s.id
    ),'[]'::jsonb),
    'allocations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'packing_unit_id',pui.packing_unit_id,'packing_item_id',pui.id,
        'allocation_id',a.id,'allocation_status',a.status,'quantity',pui.quantity
      ) order by pui.packing_unit_id::text,pui.id::text)
      from public.packing_unit_items pui
      join public.packing_units pu on pu.id=pui.packing_unit_id
      join public.stock_allocations a on a.id=pui.allocation_id
      where pu.shipment_id=s.id
    ),'[]'::jsonb),
    'physical_units',coalesce((
      select jsonb_agg(jsonb_build_object(
        'allocation_id',g.allocation_id,'bridge_quantity',g.quantity,
        'physical_unit_id',u.id,'custody_level',u.custody_level,
        'case_id',c.id,'case_version',c.version,'case_state',c.state,
        'ingress_evidence_id',c.ingress_evidence_id,'egress_evidence_id',c.egress_evidence_id,
        'decision_id',c.decision_id,'certificate_id',rc.id,
        'certificate_head',rc.chain_head_at_release,
        'physical_head',(select e.row_hash from public.custody_events e
          where e.physical_unit_id=u.id order by e.chain_seq desc limit 1)
      ) order by g.allocation_id::text,u.id::text)
      from public.packing_unit_items pui
      join public.packing_units pu on pu.id=pui.packing_unit_id
      join public.custody_allocation_physical_units g on g.allocation_id=pui.allocation_id
      join public.custody_physical_units u on u.id=g.physical_unit_id
      left join public.custody_integrity_cases c on c.physical_unit_id=u.id
      left join public.custody_release_certificates rc on rc.case_id=c.id
      where pu.shipment_id=s.id
    ),'[]'::jsonb)
  ) into v_doc
  from public.shipments s where s.id=p_shipment_id;
  if v_doc is null then raise exception 'shipment inexistente' using errcode='P0002'; end if;
  return encode(extensions.digest(convert_to(v_doc::text,'UTF8'),'sha256'::text),'hex');
end $$;
revoke all on function public.custody_shipment_release_snapshot(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.custody_lock_shipment_physical_chains(p_shipment_id uuid)
returns void language plpgsql volatile security definer
set search_path=public,pg_catalog as $$
declare r record;
begin
  for r in
    select distinct g.physical_unit_id
      from public.packing_units pu
      join public.packing_unit_items pui on pui.packing_unit_id=pu.id
      join public.custody_allocation_physical_units g on g.allocation_id=pui.allocation_id
     where pu.shipment_id=p_shipment_id
     order by g.physical_unit_id
  loop
    perform public.custody_chain_lock('physical_unit',r.physical_unit_id);
  end loop;
end $$;
revoke all on function public.custody_lock_shipment_physical_chains(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.custody_pod_receiver_hash(p_name text,p_document text)
returns text language sql immutable security definer
set search_path = public, pg_catalog
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'name',btrim(coalesce(p_name,'')),
    'document',nullif(btrim(coalesce(p_document,'')),'')
  )::text,'UTF8'),'sha256'::text),'hex')
$$;
revoke all on function public.custody_pod_receiver_hash(text,text)
  from public,anon,authenticated,service_role;

-- ── 3. Autorización privada, de un solo uso, para la firma del POD ───────
create table if not exists public.custody_pod_signature_authorizations(
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique default gen_random_uuid(),
  attestation_id uuid not null unique references public.custody_content_attestations(id) on delete restrict,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  receiver_payload_sha256 text not null check(receiver_payload_sha256 ~ '^[0-9a-f]{64}$'),
  delivered_at_snapshot timestamptz not null,
  release_snapshot_sha256 text not null check(release_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_id uuid unique references public.custody_evidence(id) on delete restrict,
  event_id uuid unique references public.custody_events(id) on delete restrict,
  registered_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_pod_id uuid unique references public.delivery_pods(id) on delete restrict,
  pod_request_sha256 text check(pod_request_sha256 is null or pod_request_sha256 ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at>created_at),
  check((evidence_id is null)=(event_id is null)),
  check((registered_at is null)=(evidence_id is null)),
  check(consumed_at is null or (evidence_id is not null and consumed_by_pod_id is not null))
);
alter table public.custody_pod_signature_authorizations enable row level security;
revoke all on public.custody_pod_signature_authorizations
  from public,anon,authenticated,service_role;

create or replace function public.guard_custody_pod_signature_authorization()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then
    raise exception 'custody_pod_signature_authorizations es append-only'
      using errcode='23001';
  end if;
  if new.id<>old.id or new.operation_id<>old.operation_id
     or new.attestation_id<>old.attestation_id or new.shipment_id<>old.shipment_id
     or new.client_id<>old.client_id or new.actor_id<>old.actor_id
     or new.session_id<>old.session_id
     or new.receiver_payload_sha256<>old.receiver_payload_sha256
     or new.delivered_at_snapshot<>old.delivered_at_snapshot
     or new.release_snapshot_sha256<>old.release_snapshot_sha256
     or new.expires_at<>old.expires_at or new.created_at<>old.created_at then
    raise exception 'autorización de firma inmutable' using errcode='23001';
  end if;
  if old.evidence_id is not null and new.evidence_id is distinct from old.evidence_id then
    raise exception 'evidencia de firma inmutable' using errcode='23001';
  end if;
  if old.consumed_at is not null and new is distinct from old then
    raise exception 'autorización de firma ya consumida' using errcode='23001';
  end if;
  return new;
end $$;
revoke all on function public.guard_custody_pod_signature_authorization()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_custody_pod_signature_authorizations_immutable
  on public.custody_pod_signature_authorizations;
create trigger trg_custody_pod_signature_authorizations_immutable
  before update or delete on public.custody_pod_signature_authorizations
  for each row execute function public.guard_custody_pod_signature_authorization();
drop trigger if exists trg_custody_pod_signature_authorizations_no_truncate
  on public.custody_pod_signature_authorizations;
create trigger trg_custody_pod_signature_authorizations_no_truncate
  before truncate on public.custody_pod_signature_authorizations
  for each statement execute function public.guard_custody_pod_signature_authorization();

-- Servicio interno: atesta bytes reales sólo después de entrega/liberación y
-- crea una autorización ligada al receptor y snapshot exactos.
create or replace function public.attest_custody_pod_signature_content(
  p_bucket text,p_storage_path text,p_sha256 text,p_size_bytes bigint,p_mime_type text,
  p_actor_id uuid,p_session_id uuid,p_shipment_id uuid,
  p_receiver_name text,p_receiver_document text,p_ttl_seconds int default 900
) returns jsonb language plpgsql security definer
set search_path=public,pg_catalog
as $$
declare v_claim_role text; v_client uuid; v_delivered timestamptz;
  v_att uuid; v_operation uuid; v_snapshot text;
begin
  v_claim_role:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role';
  if v_claim_role is distinct from 'service_role' then
    raise exception 'service_role requerido' using errcode='42501';
  end if;
  if p_actor_id is null or p_session_id is null or not exists(
    select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_actor_id
  ) then raise exception 'actor/sesión inválidos' using errcode='42501'; end if;
  if not exists(
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_id=ur.role_id
    join public.permissions p on p.id=rp.permission_id
    where ur.user_id=p_actor_id and p.slug='wms.custody.pod'
  ) then raise exception 'capacidad explícita wms.custody.pod requerida' using errcode='42501'; end if;
  if p_bucket<>'custody-pii' or p_sha256 !~ '^[0-9a-f]{64}$'
     or coalesce(p_size_bytes,0)<=0
     or lower(coalesce(p_mime_type,'')) not in ('image/jpeg','image/png','image/webp')
     or coalesce(p_ttl_seconds,0)<=0 or p_ttl_seconds>900
     or btrim(coalesce(p_receiver_name,''))='' then
    raise exception 'firma atestada inválida' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('custody-pod:'||p_shipment_id::text,0));
  select s.delivered_at,lo.client_id into v_delivered,v_client
    from public.shipments s join public.logistics_orders lo on lo.id=s.order_id
    where s.id=p_shipment_id and s.status='entregado' for update of s;
  if not found or v_delivered is null or v_client is null then
    raise exception 'shipment no entregado o tenant no resuelto' using errcode='22023';
  end if;
  perform public.custody_assert_shipment_released(p_shipment_id);
  perform public.custody_lock_shipment_physical_chains(p_shipment_id);
  v_snapshot:=public.custody_shipment_release_snapshot(p_shipment_id);
  insert into public.custody_content_attestations(
    bucket,storage_path,sha256,size_bytes,actor_id,session_id,client_id,
    scope,entity_id,stage,event_type,observed_mime_type,expires_at
  ) values(
    p_bucket,p_storage_path,p_sha256,p_size_bytes,p_actor_id,p_session_id,v_client,
    'shipment',p_shipment_id,'entrega','firmado',lower(p_mime_type),now()+make_interval(secs=>p_ttl_seconds)
  ) returning id into v_att;
  insert into public.custody_pod_signature_authorizations(
    attestation_id,shipment_id,client_id,actor_id,session_id,receiver_payload_sha256,
    delivered_at_snapshot,release_snapshot_sha256,expires_at
  ) values(
    v_att,p_shipment_id,v_client,p_actor_id,p_session_id,
    public.custody_pod_receiver_hash(p_receiver_name,p_receiver_document),
    v_delivered,v_snapshot,now()+make_interval(secs=>p_ttl_seconds)
  ) returning operation_id into v_operation;
  return jsonb_build_object('operation_id',v_operation,'attestation_id',v_att);
end $$;
revoke all on function public.attest_custody_pod_signature_content(text,text,text,bigint,text,uuid,uuid,uuid,text,text,int)
  from public,anon,authenticated,service_role;
grant execute on function public.attest_custody_pod_signature_content(text,text,text,bigint,text,uuid,uuid,uuid,text,text,int)
  to service_role;

create or replace function public.attach_custody_pod_signature(
  p_operation_id uuid,p_shipment_id uuid,p_receiver_name text,p_receiver_document text,
  p_file_name text default null,p_mime_type text default null
) returns jsonb language plpgsql security definer
set search_path=public,pg_catalog
as $$
declare v_actor uuid; v_session uuid; v_role text; a public.custody_pod_signature_authorizations;
  att public.custody_content_attestations; v_client uuid; v_delivered timestamptz;
  v_event uuid; v_evidence uuid; v_public text; v_snapshot text;
begin
  select x.actor_id,x.session_id,x.actor_role into v_actor,v_session,v_role
    from public.assert_custody_explicit_access('wms.custody.pod') x;
  perform pg_advisory_xact_lock(hashtextextended('custody-pod:'||p_shipment_id::text,0));
  select s.delivered_at,lo.client_id into v_delivered,v_client
    from public.shipments s join public.logistics_orders lo on lo.id=s.order_id
    where s.id=p_shipment_id and s.status='entregado' for update of s;
  if not found or v_delivered is null then raise exception 'shipment no entregado' using errcode='22023'; end if;
  perform public.assert_custody_tenant(v_role,v_client);
  perform public.custody_assert_shipment_released(p_shipment_id);
  perform public.custody_lock_shipment_physical_chains(p_shipment_id);
  v_snapshot:=public.custody_shipment_release_snapshot(p_shipment_id);
  select * into a from public.custody_pod_signature_authorizations
    where operation_id=p_operation_id for update;
  if not found or a.shipment_id<>p_shipment_id or a.actor_id<>v_actor or a.session_id<>v_session
     or a.client_id<>v_client or a.delivered_at_snapshot<>v_delivered
     or a.release_snapshot_sha256<>v_snapshot
     or a.receiver_payload_sha256<>public.custody_pod_receiver_hash(p_receiver_name,p_receiver_document) then
    raise exception 'autorización de firma inválida o vencida' using errcode='42501';
  end if;
  if a.evidence_id is not null then
    select public_id into v_public from public.custody_events where id=a.event_id;
    if not found then raise exception 'firma registrada inconsistente' using errcode='23000'; end if;
    return jsonb_build_object('operation_id',p_operation_id,'evidence_id',a.evidence_id,'event_public_id',v_public);
  end if;
  if a.expires_at<=now() or a.revoked_at is not null then
    raise exception 'autorización de firma inválida o vencida' using errcode='42501';
  end if;
  update public.custody_content_attestations ca set consumed_at=now()
   where ca.id=a.attestation_id and ca.consumed_at is null and ca.revoked_at is null
     and ca.expires_at>now() and ca.actor_id=v_actor and ca.session_id=v_session
     and ca.client_id=v_client and ca.scope='shipment' and ca.entity_id=p_shipment_id
     and ca.stage='entrega' and ca.event_type='firmado' and ca.observed_mime_type is not null
   returning ca.* into att;
  if not found then raise exception 'atestación no consumible' using errcode='42501'; end if;
  if p_mime_type is not null and lower(p_mime_type)<>att.observed_mime_type then
    raise exception 'MIME declarado no coincide con bytes atestados' using errcode='22023';
  end if;
  insert into public.custody_events(
    shipment_id,stage,event_type,actor_id,occurred_at,evidence_sha256
  ) values(p_shipment_id,'entrega','firmado',v_actor,now(),att.sha256)
  returning id,public_id into v_event,v_public;
  insert into public.custody_evidence(
    event_id,kind,storage_bucket,storage_path,file_name,mime_type,size_bytes,sha256,
    captured_at,retention_class,retention_until,created_by
  ) values(
    v_event,'firma',att.bucket,att.storage_path,p_file_name,att.observed_mime_type,
    att.size_bytes,att.sha256,now(),'pii',now()+interval '1 year',v_actor
  ) returning id into v_evidence;
  update public.custody_content_attestations set consumed_by_evidence_id=v_evidence where id=att.id;
  update public.custody_pod_signature_authorizations set evidence_id=v_evidence,event_id=v_event,registered_at=now()
    where id=a.id;
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(v_actor,'custody_evidence',v_evidence,'custody.pod_signature_attach',
    jsonb_build_object('shipment_id',p_shipment_id,'operation_id',p_operation_id));
  return jsonb_build_object('operation_id',p_operation_id,'evidence_id',v_evidence,'event_public_id',v_public);
end $$;
revoke all on function public.attach_custody_pod_signature(uuid,uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.attach_custody_pod_signature(uuid,uuid,text,text,text,text)
  to authenticated;

create or replace function public.generate_delivery_pod_v2(
  p_shipment_id uuid,p_receiver_name text,p_receiver_document text default null,
  p_observations text default null,p_signature_operation_id uuid default null
) returns jsonb language plpgsql security definer
set search_path=public,pg_catalog
as $$
declare v_actor uuid; v_session uuid; v_role text; v_client uuid; v_delivered timestamptz;
  v_snapshot text; a public.custody_pod_signature_authorizations;
  v_pod uuid; v_public text; v_existing public.delivery_pods; v_request_hash text;
begin
  select x.actor_id,x.session_id,x.actor_role into v_actor,v_session,v_role
    from public.assert_custody_explicit_access('wms.custody.pod') x;
  if btrim(coalesce(p_receiver_name,''))='' then raise exception 'receptor obligatorio' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custody-pod:'||p_shipment_id::text,0));
  select s.delivered_at,lo.client_id into v_delivered,v_client
    from public.shipments s join public.logistics_orders lo on lo.id=s.order_id
    where s.id=p_shipment_id and s.status='entregado' for update of s;
  if not found or v_delivered is null then raise exception 'shipment no entregado' using errcode='22023'; end if;
  perform public.assert_custody_tenant(v_role,v_client);
  perform public.custody_assert_shipment_released(p_shipment_id);
  perform public.custody_lock_shipment_physical_chains(p_shipment_id);
  v_snapshot:=public.custody_shipment_release_snapshot(p_shipment_id);
  v_request_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'contract','custody-pod-generate/v2','shipment_id',p_shipment_id,
    'receiver_name',btrim(p_receiver_name),
    'receiver_document',nullif(btrim(coalesce(p_receiver_document,'')),''),
    'observations',nullif(btrim(coalesce(p_observations,'')),''),
    'signature_operation_id',p_signature_operation_id
  )::text,'UTF8'),'sha256'::text),'hex');
  select * into v_existing from public.delivery_pods where shipment_id=p_shipment_id;
  if found then
    if p_signature_operation_id is not null and exists(
      select 1 from public.custody_pod_signature_authorizations x
       where x.operation_id=p_signature_operation_id and x.consumed_by_pod_id=v_existing.id
         and x.actor_id=v_actor and x.session_id=v_session and x.client_id=v_client
         and x.shipment_id=p_shipment_id and x.pod_request_sha256=v_request_hash
    ) then return jsonb_build_object('pod_id',v_existing.id,'public_id',v_existing.public_id); end if;
    raise exception 'shipment ya tiene POD' using errcode='23505';
  end if;
  if p_signature_operation_id is not null then
    select * into a from public.custody_pod_signature_authorizations
      where operation_id=p_signature_operation_id for update;
    if not found or a.shipment_id<>p_shipment_id or a.client_id<>v_client
       or a.actor_id<>v_actor or a.session_id<>v_session or a.evidence_id is null
       or a.consumed_at is not null or a.revoked_at is not null or a.expires_at<=now()
       or a.delivered_at_snapshot<>v_delivered or a.release_snapshot_sha256<>v_snapshot
       or a.receiver_payload_sha256<>public.custody_pod_receiver_hash(p_receiver_name,p_receiver_document)
       or not exists(
         select 1 from public.custody_evidence ce join public.custody_events ev on ev.id=ce.event_id
          where ce.id=a.evidence_id and ce.redacted=false and ce.kind='firma'
            and ev.id=a.event_id and ev.shipment_id=p_shipment_id
            and ev.stage='entrega' and ev.event_type='firmado' and ev.occurred_at>=v_delivered
       ) then raise exception 'firma no consumible para este POD' using errcode='42501'; end if;
  end if;
  insert into public.delivery_pods(
    shipment_id,receiver_name,receiver_document,observations,signature_evidence_id,
    pod_storage_path,signed_at,created_by
  ) values(
    p_shipment_id,btrim(p_receiver_name),nullif(btrim(coalesce(p_receiver_document,'')),''),
    nullif(btrim(coalesce(p_observations,'')),''),a.evidence_id,null,now(),v_actor
  ) returning id,public_id into v_pod,v_public;
  if p_signature_operation_id is not null then
    update public.custody_pod_signature_authorizations
      set consumed_at=now(),consumed_by_pod_id=v_pod,pod_request_sha256=v_request_hash where id=a.id;
  end if;
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(v_actor,'delivery_pod',v_pod,'custody.pod_generate_v2',
    jsonb_build_object('shipment_id',p_shipment_id,'has_signature',p_signature_operation_id is not null));
  return jsonb_build_object('pod_id',v_pod,'public_id',v_public);
end $$;
revoke all on function public.generate_delivery_pod_v2(uuid,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.generate_delivery_pod_v2(uuid,text,text,text,uuid)
  to authenticated;

-- El POD emitido es un comprobante: sus datos nunca cambian. La única
-- transición posterior admitida es completar una vez la ruta del PDF generado.
create or replace function public.guard_custody_delivery_pod_immutable()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
declare v_expected public.delivery_pods;
begin
  if tg_op in ('DELETE','TRUNCATE') then
    raise exception 'CUSTODY_POD_IMMUTABLE' using errcode='23001';
  end if;
  v_expected:=old;
  v_expected.pod_storage_path:=new.pod_storage_path;
  if old.pod_storage_path is null and nullif(btrim(coalesce(new.pod_storage_path,'')),'') is not null
     and new is not distinct from v_expected then
    return new;
  end if;
  raise exception 'CUSTODY_POD_IMMUTABLE' using errcode='23001';
end $$;
revoke all on function public.guard_custody_delivery_pod_immutable()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_custody_delivery_pods_immutable on public.delivery_pods;
create trigger trg_custody_delivery_pods_immutable before update or delete on public.delivery_pods
  for each row execute function public.guard_custody_delivery_pod_immutable();
drop trigger if exists trg_custody_delivery_pods_no_truncate on public.delivery_pods;
create trigger trg_custody_delivery_pods_no_truncate before truncate on public.delivery_pods
  for each statement execute function public.guard_custody_delivery_pod_immutable();

-- La composición comparte exactamente el lock de firma/POD. Así un bulto no
-- puede entrar/salir mientras se calcula el snapshot ni después de entrega/POD.
create or replace function public.guard_custody_shipment_composition()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_old uuid;v_new uuid;r record;
begin
  v_old:=case when tg_op in('UPDATE','DELETE') then old.shipment_id else null end;
  v_new:=case when tg_op in('INSERT','UPDATE') then new.shipment_id else null end;
  if v_old is not distinct from v_new then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  for r in select distinct x from unnest(array[v_old,v_new]) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('custody-pod:'||r.x::text,0));
  end loop;
  if exists(
    select 1 from public.shipments s left join public.delivery_pods d on d.shipment_id=s.id
     where s.id in(v_old,v_new) and (s.status='entregado' or d.id is not null)
  ) then raise exception 'CUSTODY_SHIPMENT_COMPOSITION_FROZEN' using errcode='23001'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.guard_custody_shipment_composition()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_custody_shipment_composition_frozen on public.packing_units;
create trigger trg_custody_shipment_composition_frozen
  before insert or update of shipment_id or delete on public.packing_units
  for each row execute function public.guard_custody_shipment_composition();

create or replace function public.lock_custody_shipment_delivery_boundary()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if new.status='entregado' and old.status is distinct from new.status then
    perform pg_advisory_xact_lock(hashtextextended('custody-pod:'||new.id::text,0));
  end if;
  return new;
end $$;
revoke all on function public.lock_custody_shipment_delivery_boundary()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_custody_shipment_delivery_boundary on public.shipments;
create trigger trg_custody_shipment_delivery_boundary before update of status on public.shipments
  for each row execute function public.lock_custody_shipment_delivery_boundary();

-- ── 4. Cierre de RPC legacy sin copiar sus cuerpos ───────────────────────
do $$ begin
  if to_regprocedure('public.attach_custody_evidence_pre_0263(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz)') is null then
    alter function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz)
      rename to attach_custody_evidence_pre_0263;
  end if;
  if to_regprocedure('public.register_custody_event_pre_0263(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz)') is null then
    alter function public.register_custody_event(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz)
      rename to register_custody_event_pre_0263;
  end if;
  if to_regprocedure('public.generate_delivery_pod_pre_0263(uuid,text,text,text,uuid,text,timestamptz)') is null then
    alter function public.generate_delivery_pod(uuid,text,text,text,uuid,text,timestamptz)
      rename to generate_delivery_pod_pre_0263;
  end if;
end $$;
revoke all on function public.attach_custody_evidence_pre_0263(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.register_custody_event_pre_0263(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.generate_delivery_pod_pre_0263(uuid,text,text,text,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.attach_custody_evidence(
  p_packing_unit_id uuid,p_shipment_id uuid,p_stage custody_stage_t,p_event_type custody_event_type_t,
  p_kind evidence_kind_t,p_bucket text,p_storage_path text,p_sha256 text,p_file_name text default null,
  p_mime_type text default null,p_size_bytes bigint default null,p_captured_at timestamptz default null,
  p_exif jsonb default null,p_geo_lat double precision default null,p_geo_lng double precision default null,
  p_geo_accuracy_m numeric default null,p_geo_source text default null,p_device_ref text default null,
  p_notes text default null,p_occurred_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor uuid;v_session uuid;v_role text;v_scope text;v_entity uuid;v_client uuid;
begin
  select x.actor_id,x.session_id,x.actor_role into v_actor,v_session,v_role
    from public.assert_custody_explicit_access('wms.edit') x;
  if num_nonnulls(p_packing_unit_id,p_shipment_id)<>1 then raise exception 'scope inválido' using errcode='22023'; end if;
  v_scope:=case when p_packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity:=coalesce(p_packing_unit_id,p_shipment_id);
  v_client:=public.custody_entity_client_id(v_scope,v_entity);
  perform public.assert_custody_tenant(v_role,v_client);
  if p_event_type='firmado' or (p_kind='firma' and p_event_type<>'inspeccion_humana') then
    raise exception 'firma POD sólo por attach_custody_pod_signature' using errcode='42501';
  end if;
  if p_event_type='pod' then
    perform public.assert_custody_explicit_access('wms.custody.pod');
    if p_shipment_id is null or not exists(select 1 from public.delivery_pods d where d.shipment_id=p_shipment_id) then
      raise exception 'documento POD sin POD canónico' using errcode='22023';
    end if;
  end if;
  return public.attach_custody_evidence_pre_0263(
    p_packing_unit_id,p_shipment_id,p_stage,p_event_type,p_kind,p_bucket,p_storage_path,p_sha256,
    p_file_name,p_mime_type,p_size_bytes,null,p_exif,p_geo_lat,p_geo_lng,p_geo_accuracy_m,
    p_geo_source,p_device_ref,p_notes,null
  );
end $$;
revoke all on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz)
  to authenticated;

create or replace function public.register_custody_event(
  p_packing_unit_id uuid,p_shipment_id uuid,p_stage custody_stage_t,p_event_type custody_event_type_t,
  p_geo_lat double precision default null,p_geo_lng double precision default null,
  p_geo_accuracy_m numeric default null,p_geo_source text default null,p_device_ref text default null,
  p_notes text default null,p_occurred_at timestamptz default null
) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor uuid;v_session uuid;v_role text;v_scope text;v_entity uuid;v_client uuid;
begin
  select x.actor_id,x.session_id,x.actor_role into v_actor,v_session,v_role
    from public.assert_custody_explicit_access('wms.edit') x;
  if num_nonnulls(p_packing_unit_id,p_shipment_id)<>1 then raise exception 'scope inválido' using errcode='22023'; end if;
  if p_event_type in ('firmado','pod') then raise exception 'evento requiere evidencia dedicada' using errcode='42501'; end if;
  v_scope:=case when p_packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity:=coalesce(p_packing_unit_id,p_shipment_id);
  v_client:=public.custody_entity_client_id(v_scope,v_entity);
  perform public.assert_custody_tenant(v_role,v_client);
  return public.register_custody_event_pre_0263(
    p_packing_unit_id,p_shipment_id,p_stage,p_event_type,p_geo_lat,p_geo_lng,p_geo_accuracy_m,
    p_geo_source,p_device_ref,p_notes,null
  );
end $$;
revoke all on function public.register_custody_event(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.register_custody_event(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz)
  to authenticated;

-- ── 5. Recepción create+items+confirm en una sola transacción ────────────
create table if not exists public.wms_reception_operations(
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  business_unit public.business_unit_t not null,
  operation text not null check(operation='wms.reception.create_confirm/v1'),
  idempotency_key uuid not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_payload jsonb not null check(jsonb_typeof(canonical_payload)='object'),
  reception_id uuid not null unique references public.receptions(id) on delete restrict deferrable initially deferred,
  result jsonb,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(client_id,business_unit,operation,idempotency_key),
  check((result is null and completed_at is null) or (jsonb_typeof(result)='object' and completed_at is not null))
);
alter table public.wms_reception_operations enable row level security;
revoke all on public.wms_reception_operations from public,anon,authenticated,service_role;

create or replace function public.wms_create_confirm_reception_v1(
  p_idempotency_key uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor uuid;v_session uuid;v_role text;v_client uuid;v_bu public.business_unit_t;
  v_client_name text;v_level smallint;v_canonical jsonb;v_hash text;v_reception uuid:=gen_random_uuid();
  v_claim uuid;v_existing public.wms_reception_operations;v_item jsonb;v_item_id uuid;
  v_item_ids jsonb:='[]'::jsonb;v_units jsonb;v_result jsonb;v_line int:=0;v_rows int;
begin
  select x.actor_id,x.session_id,x.actor_role into v_actor,v_session,v_role
    from public.assert_custody_explicit_access('wms.edit') x;
  if p_idempotency_key is null or jsonb_typeof(p_payload)<>'object'
     or jsonb_typeof(p_payload->'items')<>'array' or jsonb_array_length(p_payload->'items')=0 then
    raise exception 'payload de recepción inválido' using errcode='22023';
  end if;
  begin v_client:=(p_payload->>'client_id')::uuid;
  exception when others then raise exception 'client_id inválido' using errcode='22023'; end;
  begin v_bu:=(p_payload->>'business_unit')::public.business_unit_t;
  exception when others then raise exception 'business_unit inválida' using errcode='22023'; end;
  perform public.assert_custody_tenant(v_role,v_client);

  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    v_line:=v_line+1;
    if jsonb_typeof(v_item)<>'object' or btrim(coalesce(v_item->>'sku',''))=''
       or btrim(coalesce(v_item->>'description',''))=''
       or coalesce((v_item->>'quantity')::numeric,0)<=0
       or nullif(v_item->>'position_id','') is null then
      raise exception 'línea de recepción % inválida',v_line using errcode='22023';
    end if;
    perform (v_item->>'position_id')::uuid;
    if v_bu='ANMAT' and (nullif(btrim(coalesce(v_item->>'lot_number','')),'') is null
       or nullif(v_item->>'expiration_date','') is null) then
      raise exception 'línea ANMAT incompleta' using errcode='22023';
    end if;
    if nullif(v_item->>'ingress_sha256','') is not null
       and (v_item->>'ingress_sha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'digest de foto inválido en línea %',v_line using errcode='22023';
    end if;
  end loop;

  select jsonb_build_object(
    'contract','wms.reception.create_confirm/v1','client_id',v_client,'business_unit',v_bu,
    'numero_oc',nullif(btrim(coalesce(p_payload->>'numero_oc','')),''),
    'numero_remito',nullif(btrim(coalesce(p_payload->>'numero_remito','')),''),
    'transportista',nullif(btrim(coalesce(p_payload->>'transportista','')),''),
    'patente',nullif(upper(btrim(coalesce(p_payload->>'patente',''))),''),
    'chofer',nullif(btrim(coalesce(p_payload->>'chofer','')),''),
    'requires_quarantine',coalesce((p_payload->>'requires_quarantine')::boolean,false),
    'notes',nullif(btrim(coalesce(p_payload->>'notes','')),''),
    'custody_reforzada',coalesce((p_payload->>'custody_reforzada')::boolean,false),
    'items',(select jsonb_agg(jsonb_build_object(
      'line_no',ord,'sku',btrim(value->>'sku'),'description',btrim(value->>'description'),
      'lot_number',nullif(btrim(coalesce(value->>'lot_number','')),''),
      'expiration_date',nullif(value->>'expiration_date',''),
      'quantity',(value->>'quantity')::numeric,'position_id',(value->>'position_id')::uuid,
      'ingress_sha256',nullif(value->>'ingress_sha256','')
    ) order by ord) from jsonb_array_elements(p_payload->'items') with ordinality t(value,ord))
  ) into v_canonical;
  v_hash:=encode(extensions.digest(convert_to(v_canonical::text,'UTF8'),'sha256'::text),'hex');

  select * into v_existing from public.wms_reception_operations
   where client_id=v_client and business_unit=v_bu
     and operation='wms.reception.create_confirm/v1' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.payload_sha256<>v_hash then
      raise exception 'WMS_RECEPTION_IDEMPOTENCY_CONFLICT' using errcode='22023';
    end if;
    if v_existing.result is null or v_existing.completed_at is null then
      raise exception 'WMS_RECEPTION_IDEMPOTENCY_INCOMPLETE' using errcode='40001';
    end if;
    return v_existing.result;
  end if;

  select btrim(c.razon),c.custody_level into v_client_name,v_level
    from public.clients c where c.id=v_client and c.activo=true for share;
  if not found or v_client_name='' then raise exception 'cliente activo inexistente' using errcode='P0002'; end if;
  if (v_canonical->>'custody_reforzada')::boolean then v_level:=2; end if;
  if v_level=2 and exists(
    select 1 from jsonb_array_elements(v_canonical->'items') i
     where coalesce(i->>'ingress_sha256','') !~ '^[0-9a-f]{64}$'
  ) then raise exception 'custodia N2 exige digest de foto por línea' using errcode='22023'; end if;

  insert into public.wms_reception_operations(
    client_id,business_unit,operation,idempotency_key,payload_sha256,canonical_payload,reception_id,actor_id,session_id
  ) values(v_client,v_bu,'wms.reception.create_confirm/v1',p_idempotency_key,v_hash,v_canonical,v_reception,v_actor,v_session)
  on conflict(client_id,business_unit,operation,idempotency_key) do nothing returning id into v_claim;
  if v_claim is null then
    select * into v_existing from public.wms_reception_operations
     where client_id=v_client and business_unit=v_bu
       and operation='wms.reception.create_confirm/v1' and idempotency_key=p_idempotency_key;
    if not found or v_existing.payload_sha256<>v_hash then
      raise exception 'WMS_RECEPTION_IDEMPOTENCY_CONFLICT' using errcode='22023';
    end if;
    if v_existing.result is null or v_existing.completed_at is null then
      raise exception 'WMS_RECEPTION_IDEMPOTENCY_INCOMPLETE' using errcode='40001';
    end if;
    return v_existing.result;
  end if;

  insert into public.receptions(
    id,client_id,client_name,business_unit,numero_oc,numero_remito,transportista,patente,chofer,
    requires_quarantine,notes,custody_reforzada,status,created_by
  ) values(
    v_reception,v_client,v_client_name,v_bu,v_canonical->>'numero_oc',v_canonical->>'numero_remito',
    v_canonical->>'transportista',v_canonical->>'patente',v_canonical->>'chofer',
    (v_canonical->>'requires_quarantine')::boolean,v_canonical->>'notes',
    v_level=2,'borrador',v_actor
  );
  for v_item in select value from jsonb_array_elements(v_canonical->'items') loop
    insert into public.reception_items(
      reception_id,sku,description,lot_number,expiration_date,quantity,position_id,status
    ) values(
      v_reception,v_item->>'sku',v_item->>'description',v_item->>'lot_number',
      (v_item->>'expiration_date')::date,(v_item->>'quantity')::numeric,
      (v_item->>'position_id')::uuid,'pendiente'
    ) returning id into v_item_id;
    v_item_ids:=v_item_ids||jsonb_build_array(v_item_id);
  end loop;
  update public.receptions set status='pendiente' where id=v_reception and status='borrador';
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'transición de recepción inválida' using errcode='40001'; end if;
  perform public.confirm_reception(v_reception);
  select coalesce(jsonb_agg(jsonb_build_object(
    'reception_item_id',ri.id,'physical_unit_id',u.id,'custody_level',u.custody_level,
    'case_id',c.id
  ) order by ri.created_at,ri.id),'[]'::jsonb) into v_units
  from public.reception_items ri
  left join public.custody_physical_units u on u.reception_item_id=ri.id
  left join public.custody_integrity_cases c on c.physical_unit_id=u.id
  where ri.reception_id=v_reception;
  v_result:=jsonb_build_object('version',1,'operation_id',v_claim,'reception_id',v_reception,'item_ids',v_item_ids,'units',v_units);
  update public.wms_reception_operations set result=v_result,completed_at=now() where id=v_claim;
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(v_actor,'reception',v_reception,'wms.reception.create_confirm_idempotent',
    jsonb_build_object('operation_id',v_claim,'idempotency_key',p_idempotency_key,'payload_sha256',v_hash));
  return v_result;
end $$;
revoke all on function public.wms_create_confirm_reception_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.wms_create_confirm_reception_v1(uuid,jsonb) to authenticated;

create table if not exists public.wms_reception_ingress_attachments(
  operation_id uuid not null references public.wms_reception_operations(id) on delete restrict,
  reception_item_id uuid not null unique references public.reception_items(id) on delete restrict,
  expected_sha256 text not null check(expected_sha256 ~ '^[0-9a-f]{64}$'),
  event_id uuid not null unique references public.custody_events(id) on delete restrict,
  evidence_id uuid not null unique references public.custody_evidence(id) on delete restrict,
  event_public_id text not null,
  created_at timestamptz not null default now(),
  primary key(operation_id,reception_item_id)
);
alter table public.wms_reception_ingress_attachments enable row level security;
revoke all on public.wms_reception_ingress_attachments from public,anon,authenticated,service_role;

create or replace function public.attach_wms_reception_ingress_v1(
  p_operation_id uuid,p_reception_item_id uuid,p_physical_unit_id uuid,
  p_storage_path text,p_attestation_id uuid,p_file_name text default null,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor uuid;v_session uuid;v_role text;v_op public.wms_reception_operations;
  v_existing public.wms_reception_ingress_attachments;v_expected text;v_att_sha text;v_result jsonb;
begin
  select x.actor_id,x.session_id,x.actor_role into v_actor,v_session,v_role
    from public.assert_custody_explicit_access('wms.edit') x;
  select * into v_op from public.wms_reception_operations where id=p_operation_id for update;
  if not found or v_op.actor_id<>v_actor or v_op.session_id<>v_session
     or v_op.result is null or not exists(
       select 1 from public.reception_items ri join public.custody_physical_units u on u.reception_item_id=ri.id
        where ri.id=p_reception_item_id and ri.reception_id=v_op.reception_id and u.id=p_physical_unit_id
     ) then raise exception 'operación de ingreso inválida' using errcode='42501'; end if;
  perform public.assert_custody_tenant(v_role,v_op.client_id);
  select * into v_existing from public.wms_reception_ingress_attachments
    where operation_id=p_operation_id and reception_item_id=p_reception_item_id;
  if found then
    return jsonb_build_object('event_id',v_existing.event_id,'evidence_id',v_existing.evidence_id,'event_public_id',v_existing.event_public_id);
  end if;
  select item->>'ingress_sha256' into v_expected
    from jsonb_array_elements(v_op.canonical_payload->'items') with ordinality x(item,ord)
    join jsonb_array_elements_text(v_op.result->'item_ids') with ordinality y(item_id,ord) using(ord)
   where y.item_id::uuid=p_reception_item_id;
  select sha256 into v_att_sha from public.custody_content_attestations
    where id=p_attestation_id and actor_id=v_actor and session_id=v_session
      and scope='physical_unit' and entity_id=p_physical_unit_id
      and stage='recepcion' and event_type='foto_ingreso';
  if v_expected is null or v_att_sha is distinct from v_expected then
    raise exception 'digest de ingreso no coincide con la operación' using errcode='22023';
  end if;
  v_result:=public.attach_custody_physical_evidence(
    p_physical_unit_id,'recepcion','foto_ingreso',p_storage_path,p_attestation_id,
    p_file_name,null,null,p_notes
  );
  insert into public.wms_reception_ingress_attachments(
    operation_id,reception_item_id,expected_sha256,event_id,evidence_id,event_public_id
  ) values(
    p_operation_id,p_reception_item_id,v_expected,(v_result->>'event_id')::uuid,
    (v_result->>'evidence_id')::uuid,v_result->>'event_public_id'
  );
  return v_result;
end $$;
revoke all on function public.attach_wms_reception_ingress_v1(uuid,uuid,uuid,text,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.attach_wms_reception_ingress_v1(uuid,uuid,uuid,text,uuid,text,text)
  to authenticated;

notify pgrst,'reload schema';
commit;

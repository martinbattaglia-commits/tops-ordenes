-- ROLLBACK lógico 0263. Preserva ledgers/auditoría; restaura las RPC legacy.
begin;

revoke all on function public.wms_create_confirm_reception_v1(uuid,jsonb) from public,anon,authenticated,service_role;
drop function if exists public.wms_create_confirm_reception_v1(uuid,jsonb);
revoke all on function public.attach_wms_reception_ingress_v1(uuid,uuid,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
drop function if exists public.attach_wms_reception_ingress_v1(uuid,uuid,uuid,text,uuid,text,text);

revoke all on function public.generate_delivery_pod_v2(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.attach_custody_pod_signature(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.attest_custody_pod_signature_content(text,text,text,bigint,text,uuid,uuid,uuid,text,text,int) from public,anon,authenticated,service_role;
drop function if exists public.generate_delivery_pod_v2(uuid,text,text,text,uuid);
drop function if exists public.attach_custody_pod_signature(uuid,uuid,text,text,text,text);
drop function if exists public.attest_custody_pod_signature_content(text,text,text,bigint,text,uuid,uuid,uuid,text,text,int);

drop trigger if exists trg_custody_delivery_pods_immutable on public.delivery_pods;
drop trigger if exists trg_custody_delivery_pods_no_truncate on public.delivery_pods;
drop trigger if exists trg_custody_shipment_composition_frozen on public.packing_units;
drop trigger if exists trg_custody_shipment_delivery_boundary on public.shipments;
drop function if exists public.guard_custody_delivery_pod_immutable();
drop function if exists public.guard_custody_shipment_composition();
drop function if exists public.lock_custody_shipment_delivery_boundary();

drop function if exists public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz);
drop function if exists public.register_custody_event(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz);

alter function public.attach_custody_evidence_pre_0263(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz)
  rename to attach_custody_evidence;
alter function public.register_custody_event_pre_0263(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz)
  rename to register_custody_event;
alter function public.generate_delivery_pod_pre_0263(uuid,text,text,text,uuid,text,timestamptz)
  rename to generate_delivery_pod;

revoke all on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz) from public,anon;
grant execute on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz) to authenticated,service_role;
revoke all on function public.register_custody_event(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz) from public,anon;
grant execute on function public.register_custody_event(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz) to authenticated,service_role;
revoke all on function public.generate_delivery_pod(uuid,text,text,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.generate_delivery_pod(uuid,text,text,text,uuid,text,timestamptz) to authenticated,service_role;

-- Los ledgers con filas nunca se destruyen. Si están vacíos se retira sólo la
-- tabla de operaciones de recepción; la tabla de firmas queda privada para
-- preservar cualquier evidencia histórica y sus FK.
do $$ begin
  if not exists(select 1 from public.wms_reception_ingress_attachments) then
    drop table public.wms_reception_ingress_attachments;
  end if;
  if not exists(select 1 from public.wms_reception_operations) then
    drop table public.wms_reception_operations;
  end if;
end $$;

revoke all on public.custody_pod_signature_authorizations from public,anon,authenticated,service_role;

do $$ begin
  if not exists(select 1 from public.custody_pod_signature_authorizations) then
    execute 'drop trigger if exists trg_custody_pod_signature_authorizations_immutable on public.custody_pod_signature_authorizations';
    execute 'drop trigger if exists trg_custody_pod_signature_authorizations_no_truncate on public.custody_pod_signature_authorizations';
    execute 'drop table public.custody_pod_signature_authorizations';
    execute 'drop function public.guard_custody_pod_signature_authorization()';
  end if;
end $$;
drop function if exists public.custody_lock_shipment_physical_chains(uuid);
drop function if exists public.custody_shipment_release_snapshot(uuid);
drop function if exists public.custody_pod_receiver_hash(text,text);
drop function if exists public.assert_custody_explicit_access(text);

do $$ begin
  if exists(
    select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
     where p.slug='wms.custody.pod'
  ) then raise exception 'ROLLBACK_0263_REFUSED_PERMISSION_ASSIGNED'; end if;
  delete from public.permissions where slug='wms.custody.pod' and module='wms' and action='sign';
end $$;

notify pgrst,'reload schema';
commit;

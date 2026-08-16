-- =========================================================================
-- ROLLBACK LÓGICO · 0250 / 0250a · CUSTODIA VISIÓN PRODUCTIVA 001
--
-- No borra identidades, eventos, evidencias, intentos, decisiones, certificados
-- ni auditoría. Desactiva la política y retira las superficies/gates nuevos.
-- Los valores de enum se conservan: PostgreSQL no permite retirarlos de modo
-- aditivo y eliminarlos rompería filas históricas.
-- =========================================================================

with target as (
  select a.policy_id,a.enabled
    from public.custody_integrity_policies p
    join lateral (
      select x.policy_id,x.enabled
        from public.custody_integrity_policy_activations x
       where x.policy_id=p.id
       order by x.activated_at desc,x.id desc
       limit 1
    ) a on true
   where p.version='custody-similarity/v1'
)
insert into public.custody_integrity_policy_activations(policy_id,enabled,reason)
select policy_id,false,'Rollback lógico de CUSTODIA VISIÓN PRODUCTIVA 001'
  from target
 where enabled;

revoke execute on function public.attest_custody_physical_content(
  text,text,text,bigint,text,uuid,uuid,uuid,custody_stage_t,custody_event_type_t,int
) from authenticated,service_role;

revoke execute on function public.attach_custody_physical_evidence(
  uuid,custody_stage_t,custody_event_type_t,text,uuid,text,timestamptz,jsonb,text
) from authenticated,service_role;
revoke execute on function public.verify_custody_chain_v2(text,uuid) from authenticated,service_role;
revoke execute on function public.begin_custody_integrity_evaluation_v2(uuid,int) from authenticated;
revoke execute on function public.complete_custody_integrity_evaluation_v2(
  uuid,uuid,int,text,text,jsonb,numeric,text,boolean,boolean,boolean,text,text,text,text,text,jsonb
) from service_role;
revoke execute on function public.fail_custody_integrity_evaluation_v2(uuid,uuid,int,text,text,text)
  from service_role;
revoke execute on function public.decide_custody_integrity_v2(uuid,int,text,text,text,uuid[])
  from authenticated;
revoke execute on function public.custody_inspection_candidates_v2(uuid)
  from authenticated;
revoke execute on function public.get_custody_physical_timeline(uuid)
  from authenticated,service_role;
revoke execute on function public.get_custody_physical_token(uuid)
  from authenticated,service_role;
revoke execute on function public.get_custody_physical_by_token(uuid)
  from authenticated,service_role;

drop trigger if exists trg_stock_allocations_custody_release on public.stock_allocations;
drop trigger if exists trg_packing_units_custody_release on public.packing_units;
drop trigger if exists trg_shipments_custody_release on public.shipments;
drop trigger if exists trg_delivery_pods_custody_release on public.delivery_pods;
drop trigger if exists trg_shipments_custody_final_state on public.shipments;
drop trigger if exists trg_packing_unit_items_custody_freeze on public.packing_unit_items;
drop trigger if exists trg_custody_bind_stock_allocation on public.stock_allocations;
drop trigger if exists trg_custody_materialize_reception_item on public.reception_items;
-- El candado de identidad se retira con los demás. Si quedara armado, el
-- rollback dejaría TODO el histórico de recepciones —el backfill materializa
-- una unidad por cada ítem recibido— permanentemente incorregible e imborrable
-- en sus campos de identidad, sin ningún código vivo que lo explicara. Las
-- unidades físicas se conservan: lo que se retira es el gate, no la evidencia.
drop trigger if exists trg_custody_lock_reception_identity on public.reception_items;

-- Restablece únicamente los GRANTs del baseline previo. Los datos nuevos
-- siguen siendo inmutables y auditables.
grant execute on function public.begin_custody_integrity_evaluation(uuid,int) to authenticated;
grant execute on function public.complete_custody_integrity_evaluation(
  uuid,uuid,int,text,text,text,text,text,text,numeric,text
) to service_role;
grant execute on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[])
  to authenticated;

notify pgrst,'reload schema';

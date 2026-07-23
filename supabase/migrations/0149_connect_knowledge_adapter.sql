-- 0149_connect_knowledge_adapter.sql — Nexus Link RC1.0 · integración Connect → Knowledge.
-- ENTREGADA, NO APLICADA (G3).
-- ─────────────────────────────────────────────────────────────────────────
-- Connect actúa como FUENTE de knowledge_events (igual que recon/po/treasury,
-- migs 0135-0139). UNIDIRECCIONAL (SoR→SoK): Connect EMITE; Knowledge NUNCA
-- escribe en Connect. 100% ADITIVA; emisor/worker/E1/E2 intactos.
-- Evento alto-valor / bajo-ruido (D-RC1-1): "una conversación quedó vinculada a
-- una entidad ERP" → aparece en el Entity360 de esa entidad. NO emite por-mensaje.
-- visibility_key HEREDADA de la entidad vinculada (D-RC1-2; reusa knowledge_visibility_for).
-- payload incluye context_id (D-RC1-6) = referencia estable de la conversación.
-- Patrón AuditLogAdapter (molde 0135): mapeo STABLE + trigger defensivo + backfill
-- DRY + seed en Source Registry + hardening H-E1-1.
-- DEPENDE de: 0143 (connect_conversation_links, connect_conversations) +
--   Knowledge en prod (knowledge_event_canonical, knowledge_emit_event,
--   knowledge_visibility_for, knowledge_sources — migs 0125-0140 aplicadas).
-- Incidentes = adapter propio en RC1.8.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Mapeo connect_conversation_links -> knowledge_event_canonical (STABLE, DRY).
create or replace function public.knowledge_connect_links_to_canonical(p public.connect_conversation_links)
returns public.knowledge_event_canonical
language sql stable set search_path = public, pg_temp
as $$
  -- entity_type ALMACENADO = forma de Connect (= nombre de tabla = lo que la app escribe en audit_log.entity);
  -- así el evento CO-LOCA con los eventos audit-sourced de la misma entidad en Entity360 (que usan plural).
  -- La visibility_key (D-RC1-2) se computa NORMALIZANDO al singular que espera knowledge_visibility_for (0127):
  -- sin esto crm_leads/crm_opportunities/crm_contracts caerían a 'staff' en vez de 'perm:comercial.view'
  -- (sobre-exposición interna). La normalización se usa SOLO para la visibility, NO para el entity_type
  -- almacenado (normalizar el entity_type rompería la co-locación con los eventos audit-sourced plurales).
  -- FLAG-RC1-ENTITY360-VOCAB: la co-locación con entidades de adaptador dedicado (p.ej. purchase_orders ↔
  -- 'purchase_order' del 0136) se valida/reconcilia en RC1.3 con linking cableado y datos reales en
  -- v_knowledge_entity_360 (el vocabulario de entidades es mixto plural/singular en prod).
  with n as (
    select case p.entity_type
      when 'clients'               then 'client'
      when 'orders'                then 'order'
      when 'purchase_orders'       then 'purchase_order'
      when 'customer_invoices'     then 'customer_invoice'
      when 'supplier_invoices'     then 'supplier_invoice'
      when 'fleet_vehicles'        then 'fleet_vehicle'
      when 'warehouses'            then 'warehouse'
      when 'crm_leads'             then 'crm_lead'
      when 'crm_opportunities'     then 'crm_opportunity'
      when 'crm_contracts'         then 'crm_contract'
      when 'contracts'             then 'contract'
      when 'prospeccion_prospects' then 'prospect'
      when 'vendors'               then 'vendor'
      when 'compliance_items'      then 'compliance_item'
      else p.entity_type
    end as vis_entity,
    coalesce(p.entity_id::text, p.entity_id_text) as eid
  )
  select row(
    'connect.conversation_linked',                                  -- event_type
    p.created_at,                                                   -- occurred_at
    case when p.linked_by is not null then 'user' else 'system' end, -- actor_kind
    p.linked_by,                                                    -- actor_id
    null,                                                           -- actor_label
    p.entity_type,                                                  -- entity_type (forma Connect → co-loca en Entity360)
    n.eid,                                                          -- entity_id (uuid o text/compliance)
    'Conversación vinculada (' || p.entity_type || ')',            -- summary
    jsonb_build_object(
      'conversation_id', p.conversation_id,
      'context_id', (select cc.context_id from public.connect_conversations cc where cc.id = p.conversation_id),
      'link_id', p.id
    ),                                                              -- payload (SIN contenido de mensajes)
    public.knowledge_visibility_for(n.vis_entity, n.eid),          -- visibility_key HEREDADA (D-RC1-2); entity normalizado SOLO aquí
    'connect_conversation_links',                                   -- source_table
    p.id::text,                                                     -- source_pk
    null                                                            -- correlation_id (GUC)
  )::public.knowledge_event_canonical
  from n
$$;

-- 2) Trigger fn defensiva (SECDEF, gate enabled, jamás aborta la tx de Connect).
create or replace function public.project_connect_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='connect_conversation_links'), false) then
      perform public.knowledge_emit_event(public.knowledge_connect_links_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component','project_connect_links','source_pk',NEW.id::text,'error',sqlerrm);
  end;
  return null;
end;
$$;

-- 3) Trigger AFTER INSERT (guard to_regclass).
do $$ begin
  if to_regclass('public.connect_conversation_links') is not null then
    drop trigger if exists tg_project_connect_links on public.connect_conversation_links;
    create trigger tg_project_connect_links
      after insert on public.connect_conversation_links
      for each row execute function public.project_connect_links();
  end if;
end $$;

-- 4) Backfill (DRY, defensivo, EOL).
create or replace function public.knowledge_backfill_connect_links(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.connect_conversation_links; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.connect_conversation_links') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='connect_conversation_links'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.connect_conversation_links order by id limit p_limit loop
    begin
      v_id := public.knowledge_emit_event(public.knowledge_connect_links_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component','knowledge_backfill_connect_links','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='connect_conversation_links';
  raise log 'KnowledgeBackfillConnectLinks %', json_build_object('materialized',v_count,'failed',v_fail);
  return v_count;
end;
$$;

-- 5) Seed en el Source Registry (enabled=true; el vínculo no expone PII — la visibility se hereda de la entidad).
insert into public.knowledge_sources (source_table, enabled, notes)
values ('connect_conversation_links', true, 'Fuente RC1.0 — Connect (conversaciones vinculadas a entidades ERP)')
on conflict (source_table) do nothing;

-- 6) Hardening (H-E1-1): revoke all from public + revoke execute from anon, authenticated.
revoke all     on function public.knowledge_backfill_connect_links(int) from public;
revoke execute on function public.knowledge_backfill_connect_links(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_connect_links(int) to service_role;
revoke all     on function public.project_connect_links() from public;
revoke execute on function public.project_connect_links() from anon, authenticated;
revoke all     on function public.knowledge_connect_links_to_canonical(public.connect_conversation_links) from public;
revoke execute on function public.knowledge_connect_links_to_canonical(public.connect_conversation_links) from anon, authenticated;

select pg_notify('pgrst', 'reload schema');

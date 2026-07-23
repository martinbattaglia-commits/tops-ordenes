-- 0152_connect_get_or_create_entity_conversation.sql — Nexus Link RC1.3.
-- ENTREGADA, NO APLICADA (G3). Parte del bloque RC1. NO toca 0142-0151 (RC1.0-1.2 congeladas).
-- ─────────────────────────────────────────────────────────────────────────
-- Conversación CONTEXTUAL: devuelve la conversación 'erp' PRINCIPAL de una entidad del ERP, o la
-- crea + vincula atómicamente si no existe (D-RC1.3-1: 1 entidad : 0..1 conversación principal).
-- Dispara el adapter Knowledge 0149 (al insertar el link) → aparece en Entity360.
-- Guard fail-closed (P-1): solo con connect.create. entity_type validado contra el vocabulario.
-- Determinismo de "principal": la más antigua (created_at asc) — el get-or-create nunca crea una 2ª.
-- DEPENDE de 0143 (tablas/enums), 0146 (connect.create), 0149 (adapter, vía el insert del link).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.connect_get_or_create_entity_conversation(
  p_entity_type    text,
  p_entity_id      uuid,
  p_entity_id_text text
) returns table (conversation_id uuid, context_id text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_conv uuid;
begin
  -- Guard fail-closed (P-1): permiso explícito.
  if not public.has_permission('connect.create') then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;

  -- Vocabulario de entidades (mismo CHECK que connect_conversation_links).
  if p_entity_type not in (
    'clients','orders','purchase_orders','customer_invoices','supplier_invoices',
    'fleet_vehicles','warehouses','crm_leads','crm_opportunities','crm_contracts',
    'contracts','prospeccion_prospects','vendors','compliance_items'
  ) then
    raise exception 'entity_type invalido: %', p_entity_type using errcode = 'check_violation';
  end if;

  -- Coherencia de PK (compliance_items usa text; el resto uuid).
  if p_entity_type = 'compliance_items' then
    if p_entity_id_text is null then
      raise exception 'compliance_items requiere entity_id_text' using errcode = 'check_violation';
    end if;
  else
    if p_entity_id is null then
      raise exception 'entidad % requiere entity_id uuid', p_entity_type using errcode = 'check_violation';
    end if;
  end if;

  -- GET: conversación 'erp' principal ya vinculada a la entidad (la más antigua = principal).
  select l.conversation_id into v_conv
    from public.connect_conversation_links l
    join public.connect_conversations c on c.id = l.conversation_id and c.kind = 'erp'
   where l.entity_type = p_entity_type
     and l.entity_id is not distinct from p_entity_id
     and l.entity_id_text is not distinct from p_entity_id_text
   order by c.created_at asc, c.id asc
   limit 1;

  -- CREATE (si no existe): conversación 'erp' + creador owner + vínculo (atómico → dispara 0149).
  if v_conv is null then
    insert into public.connect_conversations (kind, created_by)
    values ('erp', auth.uid())
    returning id into v_conv;

    insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
    values (v_conv, 'staff', auth.uid(), 'owner')
    on conflict (conversation_id, profile_id) do nothing;

    if p_entity_type = 'compliance_items' then
      insert into public.connect_conversation_links (conversation_id, entity_type, entity_id_text, linked_by)
      values (v_conv, p_entity_type, p_entity_id_text, auth.uid())
      on conflict do nothing;
    else
      insert into public.connect_conversation_links (conversation_id, entity_type, entity_id, linked_by)
      values (v_conv, p_entity_type, p_entity_id, auth.uid())
      on conflict do nothing;
    end if;

    insert into public.audit_log (user_id, entity, entity_id, action, payload)
    values (auth.uid(), 'connect_conversation', v_conv, 'connect.entity_conversation.create',
            jsonb_build_object('entity_type', p_entity_type));
  end if;

  return query
    select c.id, c.context_id from public.connect_conversations c where c.id = v_conv;
end;
$$;
revoke all on function public.connect_get_or_create_entity_conversation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.connect_get_or_create_entity_conversation(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';

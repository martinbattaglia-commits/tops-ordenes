-- CRM360 · E1/E2 — Ingesta deal-centric: Clientify Deal → crm_opportunities.
-- Fuente de verdad: el Deal. Upsert IDEMPOTENTE por clientify_deal_id (UNIQUE).
-- Reutilizada por backfill (E1), webhook (E2) y polling (E4). Sin write-back → sin loops.
-- Requiere 0052 (columnas espejo). NO aplicado a producción desde la sesión.

create or replace function public.crm_ingest_deal(p_deal jsonb, p_event text default 'pull')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id    text := nullif(p_deal->>'id','');
  v_amount     numeric(14,2);
  v_currency   text := coalesce(nullif(p_deal->>'currency',''), 'ARS');
  v_prob       int  := least(100, greatest(0, coalesce(nullif(p_deal->>'probability','')::int, 0)));
  v_pipeline   text := nullif(p_deal->>'pipeline_desc','');
  v_stagedesc  text := lower(coalesce(p_deal->>'pipeline_stage_desc',''));
  v_statusdesc text := lower(coalesce(p_deal->>'status_desc',''));
  v_name       text := coalesce(nullif(p_deal->>'name',''),'');
  v_svc        public.crm_service_t;
  v_estado     public.crm_stage_t;
  v_exp        date;
  v_mod        timestamptz;
  v_inserted   boolean;
  v_id         uuid;
begin
  if v_deal_id is null then
    return jsonb_build_object('action','skipped','reason','sin id');
  end if;

  -- amount (string "10000.00")
  begin v_amount := nullif(p_deal->>'amount','')::numeric(14,2); exception when others then v_amount := null; end;
  -- expected close (puede venir como fecha o datetime ISO)
  begin v_exp := nullif(p_deal->>'expected_closed_date','')::date; exception when others then v_exp := null; end;
  begin v_mod := nullif(p_deal->>'modified','')::timestamptz; exception when others then v_mod := null; end;

  -- service_type (NOT NULL): por pipeline/nombre → anmat | oficinas | general
  v_svc := case
    when (v_pipeline ilike '%anmat%' or v_name ilike '%anmat%') then 'anmat'
    when (v_pipeline ilike '%oficina%' or v_name ilike '%oficina%') then 'oficinas'
    else 'general' end::public.crm_service_t;

  -- estado: primero por status_desc (won/lost), luego por etapa del pipeline
  v_estado := case
    when (v_statusdesc like '%gan%' or v_statusdesc like '%won%') then 'ganado'
    when (v_statusdesc like '%perd%' or v_statusdesc like '%lost%' or v_statusdesc like '%expir%' or v_statusdesc like '%vencid%') then 'perdido'
    when v_stagedesc like '%negocia%' then 'negociacion'
    when v_stagedesc like '%propuesta%' then 'propuesta'
    when v_stagedesc like '%visita%' then 'visita'
    when v_stagedesc like '%calific%' then 'calificado'
    when v_stagedesc like '%contact%' then 'contactado'
    else 'nuevo_lead' end::public.crm_stage_t;

  insert into public.crm_opportunities
    (clientify_deal_id, service_type, estado, probabilidad, monto, currency,
     contacto, email, telefono, expected_close, clientify_pipeline,
     company_name, clientify_contact_id, owner_name, clientify_modified)
  values
    (v_deal_id, v_svc, v_estado, v_prob, v_amount, v_currency,
     nullif(p_deal->>'contact_name',''), nullif(p_deal->>'contact_email',''), nullif(p_deal->>'contact_phone',''),
     v_exp, v_pipeline,
     nullif(p_deal->>'company',''), nullif(p_deal->>'contact',''), nullif(p_deal->>'owner_name',''), v_mod)
  on conflict (clientify_deal_id) do update set
     service_type        = excluded.service_type,
     estado              = excluded.estado,
     probabilidad        = excluded.probabilidad,
     monto               = excluded.monto,
     currency            = excluded.currency,
     contacto            = excluded.contacto,
     email               = excluded.email,
     telefono            = excluded.telefono,
     expected_close      = excluded.expected_close,
     clientify_pipeline  = excluded.clientify_pipeline,
     company_name        = excluded.company_name,
     clientify_contact_id= excluded.clientify_contact_id,
     owner_name          = excluded.owner_name,
     clientify_modified  = excluded.clientify_modified,
     updated_at          = now()
  returning (xmax = 0), id into v_inserted, v_id;

  insert into public.clientify_sync_log (direction, entity, clientify_id, nexus_id, event, status, payload)
  values ('inbound', 'deal', v_deal_id, v_id, p_event, 'ok',
          jsonb_build_object('action', case when v_inserted then 'inserted' else 'updated' end));

  return jsonb_build_object(
    'action', case when v_inserted then 'inserted' else 'updated' end,
    'opportunity_id', v_id,
    'clientify_deal_id', v_deal_id);
exception when others then
  insert into public.clientify_sync_log (direction, entity, clientify_id, event, status, error, payload)
  values ('inbound', 'deal', v_deal_id, p_event, 'error', sqlerrm, p_deal);
  return jsonb_build_object('action','error','clientify_deal_id', v_deal_id, 'error', sqlerrm);
end;
$$;

revoke all on function public.crm_ingest_deal(jsonb, text) from public;
grant execute on function public.crm_ingest_deal(jsonb, text) to service_role;

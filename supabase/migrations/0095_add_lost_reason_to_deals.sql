-- Agrega lost_reason a clientify_deals_cache.
-- El campo solo viene del endpoint individual /deals/{id}/ de Clientify (no del de lista).
-- El sync enriquece deals perdidos (status=4) con un fetch adicional.

ALTER TABLE public.clientify_deals_cache
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- Actualiza la RPC para incluir lost_reason en el INSERT.
CREATE OR REPLACE FUNCTION public.clientify_replace_deals_cache(p_rows jsonb, p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_count int;
begin
  delete from public.clientify_deals_cache where true;
  insert into public.clientify_deals_cache
    (deal_id, title, contact_name, company_name, amount, currency, stage, stage_id,
     pipeline, pipeline_id, probability, status, status_label, owner_name,
     expected_close, actual_close, created_src, modified_src, href, sync_run_id,
     deal_source, lost_reason)
  select (r->>'deal_id')::bigint,
         coalesce(r->>'title',''),
         nullif(r->>'contact_name',''),
         nullif(r->>'company_name',''),
         coalesce((r->>'amount')::numeric, 0),
         coalesce(nullif(r->>'currency',''), 'ARS'),
         nullif(r->>'stage',''),
         nullif(r->>'stage_id','')::bigint,
         nullif(r->>'pipeline',''),
         nullif(r->>'pipeline_id','')::bigint,
         coalesce((r->>'probability')::int, 0),
         coalesce(nullif(r->>'status','')::public.clientify_deal_status_t, 'other'),
         nullif(r->>'status_label',''),
         nullif(r->>'owner_name',''),
         nullif(r->>'expected_close','')::date,
         nullif(r->>'actual_close','')::date,
         nullif(r->>'created_src','')::timestamptz,
         nullif(r->>'modified_src','')::timestamptz,
         nullif(r->>'href',''),
         p_run_id,
         nullif(r->>'deal_source',''),
         nullif(r->>'lost_reason','')
  from jsonb_array_elements(p_rows) as r;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;

-- Refresca la vista para exponer lost_reason.
CREATE OR REPLACE VIEW public.v_clientify_deals_enriched AS
SELECT
  c.deal_id,
  c.title,
  c.contact_name,
  c.company_name,
  c.amount,
  c.currency,
  c.stage,
  c.stage_id,
  c.pipeline,
  c.pipeline_id,
  c.probability,
  c.status,
  c.status_label,
  c.owner_name,
  c.expected_close,
  c.actual_close,
  c.created_src,
  c.modified_src,
  c.href,
  c.sync_run_id,
  c.synced_at,
  o.horizonte          AS overlay_horizonte,
  o.observaciones      AS overlay_observaciones,
  o.updated_at         AS overlay_updated_at,
  c.probability        AS effective_probability,
  c.deal_source,
  c.lost_reason
FROM clientify_deals_cache c
LEFT JOIN crm_deal_overlay o ON o.clientify_deal_id = c.deal_id;

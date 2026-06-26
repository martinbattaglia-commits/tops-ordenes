-- Update clientify_replace_deals_cache to include deal_source (added in 0092).
-- The column list in the INSERT was explicit and did not include deal_source,
-- so every sync silently dropped the field. This patch adds it.
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
     deal_source)
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
         nullif(r->>'deal_source','')
  from jsonb_array_elements(p_rows) as r;
  get diagnostics v_count = row_count;
  return v_count;
end $function$

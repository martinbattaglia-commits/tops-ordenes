-- Refresh v_clientify_deals_enriched to expose deal_source (added in 0092).
-- PostgreSQL CREATE OR REPLACE VIEW requires new columns at the end only.
CREATE OR REPLACE VIEW v_clientify_deals_enriched AS
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
  c.deal_source
FROM clientify_deals_cache c
LEFT JOIN crm_deal_overlay o ON o.clientify_deal_id = c.deal_id;

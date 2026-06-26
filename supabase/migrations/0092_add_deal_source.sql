-- Add deal_source column to clientify_deals_cache
ALTER TABLE clientify_deals_cache ADD COLUMN IF NOT EXISTS deal_source text;

-- v_clientify_deals_enriched already uses SELECT c.* so no change needed

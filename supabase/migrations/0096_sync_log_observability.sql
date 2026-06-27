-- Migración 0096: Observabilidad del sincronizador CRM-Clientify
-- Añade columnas para métricas de enriquecimiento incremental de lost_reason
-- y versión del sincronizador. Compatibilidad total con filas previas (DEFAULT 0 / NULL).

ALTER TABLE public.clientify_dashboard_sync_log
  ADD COLUMN IF NOT EXISTS lost_reason_enriched  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_reason_skipped   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_version          TEXT;

COMMENT ON COLUMN public.clientify_dashboard_sync_log.lost_reason_enriched IS
  'Deals perdidos a los que se les consultó GET /deals/{id}/ para obtener lost_reason en esta ejecución.';
COMMENT ON COLUMN public.clientify_dashboard_sync_log.lost_reason_skipped IS
  'Deals perdidos omitidos porque ya tenían lost_reason almacenado (optimización incremental).';
COMMENT ON COLUMN public.clientify_dashboard_sync_log.sync_version IS
  'Versión semántica del sincronizador (constante SYNC_VERSION en route.ts).';

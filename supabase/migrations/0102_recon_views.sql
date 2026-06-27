-- supabase/migrations/0099_recon_views.sql

CREATE OR REPLACE VIEW v_recon_status
WITH (security_invoker = true)
AS
SELECT
  r.id                          AS recon_id,
  r.purchase_order_id,
  r.supplier_invoice_id,
  po.public_id                  AS po_public_id,
  inv.public_id                 AS invoice_public_id,
  r.status                      AS recon_status,
  r.score,
  r.initiated_at,
  r.resolved_at,
  COUNT(d.id)                   AS n_diffs,
  COUNT(d.id) FILTER (WHERE d.severity IN ('warning','error') AND NOT d.accepted)
                                AS n_pending_diffs,
  -- listo_para_pago: conciliada o con_diferencias
  r.status IN ('conciliada','con_diferencias') AS listo_para_pago
FROM po_reconciliations r
JOIN purchase_orders    po  ON po.id  = r.purchase_order_id
JOIN supplier_invoices  inv ON inv.id = r.supplier_invoice_id
LEFT JOIN po_reconciliation_diffs d ON d.reconciliation_id = r.id
GROUP BY r.id, po.public_id, inv.public_id;

-- Comentario: supplier_ap_status (0059) ya usa approval_status de supplier_invoices.
-- El bloqueo de pago adicional se refuerza en la UI consultando listo_para_pago.
-- No modificamos 0059 para no crear dependencia circular.

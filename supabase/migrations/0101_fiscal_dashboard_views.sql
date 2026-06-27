-- ============================================================
-- Migración 0101 — Vistas e índices para Dashboard Fiscal
--
-- Prepara el modelo de datos para el tablero de retenciones:
--  · Retenciones por período, proveedor y concepto
--  · Retenciones evitadas por certificados de exclusión
--  · Ranking y evolución mensual
-- ============================================================

-- ─── Índices de performance ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ganancias_ret_fecha_pago
  ON public.ganancias_retenciones (fecha_pago);

CREATE INDEX IF NOT EXISTS idx_ganancias_ret_concepto
  ON public.ganancias_retenciones (concepto);

CREATE INDEX IF NOT EXISTS idx_ganancias_ret_corresponde
  ON public.ganancias_retenciones (corresponde);

CREATE INDEX IF NOT EXISTS idx_ganancias_ret_invoice
  ON public.ganancias_retenciones (supplier_invoice_id);

-- ─── Vista principal del dashboard ───────────────────────────

CREATE OR REPLACE VIEW v_fiscal_dashboard_ganancias AS
SELECT
  gr.id,
  gr.fecha_pago,
  date_trunc('month', gr.fecha_pago)::date           AS periodo,
  to_char(gr.fecha_pago, 'YYYY-MM')                  AS periodo_txt,
  si.vendor_id,
  v.razon                                             AS proveedor,
  v.cuit,
  gr.concepto,
  gr.tipo_comprobante,
  gr.neto_gravado,
  gr.acumulado_total,
  gr.minimo_no_sujeto,
  gr.base_imponible,
  gr.alicuota,
  gr.retencion,
  gr.neto_a_pagar,
  gr.corresponde,
  gr.motivo,
  gr.metodo,
  gr.normativa_version,
  gr.created_at,
  -- Bandera: retención evitada por cert de exclusión
  CASE
    WHEN NOT gr.corresponde
     AND v.cert_exclusion_hasta IS NOT NULL
     AND v.cert_exclusion_hasta >= gr.fecha_pago
    THEN true ELSE false
  END AS evitada_por_certificado
FROM public.ganancias_retenciones gr
JOIN public.supplier_invoices     si ON si.id = gr.supplier_invoice_id
JOIN public.vendors                v ON v.id  = si.vendor_id;

COMMENT ON VIEW v_fiscal_dashboard_ganancias IS
  'Vista base para el tablero de retenciones de Ganancias. '
  'Incluye datos del proveedor y flag de retención evitada por certificado de exclusión.';

-- ─── Resumen por período ──────────────────────────────────────

CREATE OR REPLACE VIEW v_fiscal_resumen_mensual AS
SELECT
  periodo,
  periodo_txt,
  COUNT(*)                                          AS operaciones,
  COUNT(*) FILTER (WHERE corresponde)               AS con_retencion,
  COUNT(*) FILTER (WHERE NOT corresponde)           AS sin_retencion,
  COUNT(*) FILTER (WHERE evitada_por_certificado)   AS evitadas_por_cert,
  SUM(neto_gravado)                                 AS total_neto_gravado,
  SUM(retencion)                                    AS total_retenido,
  AVG(alicuota) FILTER (WHERE corresponde)          AS alicuota_promedio,
  COUNT(DISTINCT vendor_id)                         AS proveedores_distintos
FROM v_fiscal_dashboard_ganancias
GROUP BY periodo, periodo_txt
ORDER BY periodo DESC;

COMMENT ON VIEW v_fiscal_resumen_mensual IS
  'Evolución mensual de retenciones practicadas, evitadas y proveedores alcanzados.';

-- ─── Ranking de proveedores ───────────────────────────────────

CREATE OR REPLACE VIEW v_fiscal_ranking_proveedores AS
SELECT
  vendor_id,
  proveedor,
  cuit,
  COUNT(*)                                          AS operaciones,
  COUNT(*) FILTER (WHERE corresponde)               AS con_retencion,
  SUM(neto_gravado)                                 AS total_neto_gravado,
  SUM(retencion)                                    AS total_retenido,
  MAX(fecha_pago)                                   AS ultima_operacion,
  ARRAY_AGG(DISTINCT concepto)                      AS conceptos
FROM v_fiscal_dashboard_ganancias
GROUP BY vendor_id, proveedor, cuit
ORDER BY total_retenido DESC NULLS LAST;

COMMENT ON VIEW v_fiscal_ranking_proveedores IS
  'Ranking de proveedores por importe total retenido de Ganancias.';

-- ─── Resumen por concepto ─────────────────────────────────────

CREATE OR REPLACE VIEW v_fiscal_resumen_concepto AS
SELECT
  concepto,
  COUNT(*)                                          AS operaciones,
  COUNT(*) FILTER (WHERE corresponde)               AS con_retencion,
  SUM(neto_gravado)                                 AS total_neto_gravado,
  SUM(retencion)                                    AS total_retenido,
  AVG(alicuota) FILTER (WHERE corresponde)          AS alicuota_promedio,
  SUM(retencion) FILTER (WHERE evitada_por_certificado) AS evitado_por_cert
FROM v_fiscal_dashboard_ganancias
GROUP BY concepto
ORDER BY total_retenido DESC NULLS LAST;

COMMENT ON VIEW v_fiscal_resumen_concepto IS
  'Retenciones por tipo de concepto (honorarios, servicios, mercaderías, alquileres).';

-- ─── RPC: dashboard KPIs para el tablero ──────────────────────

CREATE OR REPLACE FUNCTION ap_fiscal_dashboard_kpis(
  p_desde date DEFAULT date_trunc('year', CURRENT_DATE)::date,
  p_hasta date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_total_retenido   numeric;
  v_operaciones      bigint;
  v_con_retencion    bigint;
  v_proveedores      bigint;
  v_evitadas_cert    bigint;
  v_por_mes          jsonb;
  v_top_prov         jsonb;
  v_por_concepto     jsonb;
BEGIN
  SELECT
    COALESCE(SUM(retencion), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE corresponde),
    COUNT(DISTINCT vendor_id),
    COUNT(*) FILTER (WHERE evitada_por_certificado)
  INTO v_total_retenido, v_operaciones, v_con_retencion, v_proveedores, v_evitadas_cert
  FROM v_fiscal_dashboard_ganancias
  WHERE fecha_pago BETWEEN p_desde AND p_hasta;

  SELECT jsonb_agg(jsonb_build_object(
    'periodo',       periodo_txt,
    'total_retenido', SUM(retencion),
    'operaciones',   COUNT(*)
  ) ORDER BY periodo_txt)
  INTO v_por_mes
  FROM v_fiscal_dashboard_ganancias
  WHERE fecha_pago BETWEEN p_desde AND p_hasta
  GROUP BY periodo, periodo_txt;

  SELECT jsonb_agg(jsonb_build_object(
    'proveedor',      proveedor,
    'cuit',          cuit,
    'total_retenido', SUM(retencion),
    'operaciones',   COUNT(*)
  ) ORDER BY SUM(retencion) DESC NULLS LAST)
  INTO v_top_prov
  FROM v_fiscal_dashboard_ganancias
  WHERE fecha_pago BETWEEN p_desde AND p_hasta AND corresponde
  GROUP BY vendor_id, proveedor, cuit
  LIMIT 10;

  SELECT jsonb_agg(jsonb_build_object(
    'concepto',      concepto,
    'total_retenido', SUM(retencion),
    'operaciones',   COUNT(*) FILTER (WHERE corresponde)
  ) ORDER BY SUM(retencion) DESC NULLS LAST)
  INTO v_por_concepto
  FROM v_fiscal_dashboard_ganancias
  WHERE fecha_pago BETWEEN p_desde AND p_hasta
  GROUP BY concepto;

  RETURN jsonb_build_object(
    'total_retenido',   v_total_retenido,
    'operaciones',      v_operaciones,
    'con_retencion',    v_con_retencion,
    'proveedores',      v_proveedores,
    'evitadas_por_cert', v_evitadas_cert,
    'por_mes',          COALESCE(v_por_mes,       '[]'::jsonb),
    'top_proveedores',  COALESCE(v_top_prov,      '[]'::jsonb),
    'por_concepto',     COALESCE(v_por_concepto,  '[]'::jsonb)
  );
END;
$$;

GRANT SELECT ON v_fiscal_dashboard_ganancias    TO authenticated;
GRANT SELECT ON v_fiscal_resumen_mensual        TO authenticated;
GRANT SELECT ON v_fiscal_ranking_proveedores    TO authenticated;
GRANT SELECT ON v_fiscal_resumen_concepto       TO authenticated;

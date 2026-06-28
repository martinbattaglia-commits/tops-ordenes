-- ============================================================
-- Módulo: Retención de Impuesto a las Ganancias
-- Migración 0099
-- ============================================================

-- ─── Parámetros configurables (1 fila por concepto/param) ───
CREATE TABLE IF NOT EXISTS ganancias_retention_params (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto      text NOT NULL,           -- 'honorarios' | 'mercaderias' | 'servicios' | 'alquileres'
  param_key     text NOT NULL,           -- 'min_no_sujeto' | 'alicuota'
  valor         numeric(12,4) NOT NULL,
  vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id),
  UNIQUE (concepto, param_key, vigente_desde)
);

-- Valores por defecto (según correcciones Contadora)
INSERT INTO ganancias_retention_params (concepto, param_key, valor) VALUES
  ('honorarios',   'min_no_sujeto', 160000),
  ('mercaderias',  'min_no_sujeto', 224000),
  ('mercaderias',  'alicuota',      2),
  ('servicios',    'min_no_sujeto', 67170),
  ('servicios',    'alicuota',      2),
  ('alquileres',   'min_no_sujeto', 11200),
  ('alquileres',   'alicuota',      6)
ON CONFLICT (concepto, param_key, vigente_desde) DO NOTHING;

-- ─── Escala progresiva de Honorarios ────────────────────────
CREATE TABLE IF NOT EXISTS ganancias_escala_honorarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  desde         numeric(14,2) NOT NULL,
  hasta         numeric(14,2),            -- NULL = sin límite
  fijo          numeric(14,2) NOT NULL,
  pct           numeric(6,3) NOT NULL,
  vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (desde, vigente_desde)
);

INSERT INTO ganancias_escala_honorarios (desde, hasta, fijo, pct) VALUES
  (0,       71000,   0,      5),
  (71000,   142000,  3550,   9),
  (142000,  213000,  9940,   12),
  (213000,  284000,  18460,  15),
  (284000,  426000,  29110,  19),
  (426000,  568000,  56090,  23),
  (568000,  852000,  88750,  27),
  (852000,  NULL,    165430, 31)
ON CONFLICT (desde, vigente_desde) DO NOTHING;

-- ─── Registros de retención (1 por factura proveedor) ───────
CREATE TABLE IF NOT EXISTS ganancias_retenciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  concepto            text NOT NULL,
  tipo_comprobante    text NOT NULL,           -- 'FACTURA_A' | 'FACTURA_C' | etc.
  fecha_pago          date NOT NULL,

  -- Importes de la factura
  neto_gravado        numeric(14,2) NOT NULL,
  total_factura       numeric(14,2),

  -- Cálculo
  acumulado_previo    numeric(14,2) NOT NULL DEFAULT 0,
  acumulado_total     numeric(14,2) NOT NULL,
  minimo_no_sujeto    numeric(14,2) NOT NULL DEFAULT 0,
  base_imponible      numeric(14,2) NOT NULL DEFAULT 0,
  excedente           numeric(14,2) NOT NULL DEFAULT 0,
  alicuota            numeric(6,3) NOT NULL DEFAULT 0,
  fijo_escala         numeric(14,2) NOT NULL DEFAULT 0,
  retencion           numeric(14,2) NOT NULL DEFAULT 0,
  neto_a_pagar        numeric(14,2) NOT NULL,

  -- Estado
  corresponde         boolean NOT NULL DEFAULT false,
  motivo              text,
  tramo_txt           text,                    -- solo honorarios
  metodo              text NOT NULL DEFAULT 'lineal',  -- 'lineal' | 'escala' | 'excluido'

  -- Auditoría
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  observaciones       text,

  UNIQUE (supplier_invoice_id)
);

-- ─── Certificados de retención ───────────────────────────────
CREATE TABLE IF NOT EXISTS ganancias_certificados (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retencion_id        uuid NOT NULL REFERENCES ganancias_retenciones(id) ON DELETE CASCADE,
  numero_cert         text NOT NULL,           -- correlativo interno
  importe_retenido    numeric(14,2) NOT NULL,
  fecha_emision       date NOT NULL DEFAULT CURRENT_DATE,
  emitido_por         uuid REFERENCES auth.users(id),
  anulado             boolean NOT NULL DEFAULT false,
  anulado_at          timestamptz,
  anulado_por         uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (numero_cert)
);

-- Secuencia para número de certificado
CREATE SEQUENCE IF NOT EXISTS ganancias_cert_seq START 1;

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE ganancias_retention_params   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ganancias_escala_honorarios  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ganancias_retenciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ganancias_certificados       ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado
CREATE POLICY "ganancias_params_read"   ON ganancias_retention_params   FOR SELECT TO authenticated USING (true);
CREATE POLICY "ganancias_escala_read"   ON ganancias_escala_honorarios   FOR SELECT TO authenticated USING (true);
CREATE POLICY "ganancias_ret_read"      ON ganancias_retenciones         FOR SELECT TO authenticated USING (true);
CREATE POLICY "ganancias_cert_read"     ON ganancias_certificados        FOR SELECT TO authenticated USING (true);

-- Escritura: solo service role (server actions)
CREATE POLICY "ganancias_params_write"  ON ganancias_retention_params   FOR ALL TO service_role USING (true);
CREATE POLICY "ganancias_escala_write"  ON ganancias_escala_honorarios   FOR ALL TO service_role USING (true);
CREATE POLICY "ganancias_ret_write"     ON ganancias_retenciones         FOR ALL TO service_role USING (true);
CREATE POLICY "ganancias_cert_write"    ON ganancias_certificados        FOR ALL TO service_role USING (true);

-- ─── RPC: guardar/actualizar retención ───────────────────────
CREATE OR REPLACE FUNCTION ap_upsert_retencion_ganancias(
  p_supplier_invoice_id   uuid,
  p_concepto              text,
  p_tipo_comprobante      text,
  p_fecha_pago            date,
  p_neto_gravado          numeric,
  p_total_factura         numeric,
  p_acumulado_previo      numeric,
  p_acumulado_total       numeric,
  p_minimo_no_sujeto      numeric,
  p_base_imponible        numeric,
  p_excedente             numeric,
  p_alicuota              numeric,
  p_fijo_escala           numeric,
  p_retencion             numeric,
  p_neto_a_pagar          numeric,
  p_corresponde           boolean,
  p_motivo                text,
  p_tramo_txt             text,
  p_metodo                text,
  p_observaciones         text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO ganancias_retenciones (
    supplier_invoice_id, concepto, tipo_comprobante, fecha_pago,
    neto_gravado, total_factura, acumulado_previo, acumulado_total,
    minimo_no_sujeto, base_imponible, excedente, alicuota, fijo_escala,
    retencion, neto_a_pagar, corresponde, motivo, tramo_txt, metodo,
    observaciones, created_by, updated_at
  ) VALUES (
    p_supplier_invoice_id, p_concepto, p_tipo_comprobante, p_fecha_pago,
    p_neto_gravado, p_total_factura, p_acumulado_previo, p_acumulado_total,
    p_minimo_no_sujeto, p_base_imponible, p_excedente, p_alicuota, p_fijo_escala,
    p_retencion, p_neto_a_pagar, p_corresponde, p_motivo, p_tramo_txt, p_metodo,
    p_observaciones, auth.uid(), now()
  )
  ON CONFLICT (supplier_invoice_id) DO UPDATE SET
    concepto          = EXCLUDED.concepto,
    tipo_comprobante  = EXCLUDED.tipo_comprobante,
    fecha_pago        = EXCLUDED.fecha_pago,
    neto_gravado      = EXCLUDED.neto_gravado,
    total_factura     = EXCLUDED.total_factura,
    acumulado_previo  = EXCLUDED.acumulado_previo,
    acumulado_total   = EXCLUDED.acumulado_total,
    minimo_no_sujeto  = EXCLUDED.minimo_no_sujeto,
    base_imponible    = EXCLUDED.base_imponible,
    excedente         = EXCLUDED.excedente,
    alicuota          = EXCLUDED.alicuota,
    fijo_escala       = EXCLUDED.fijo_escala,
    retencion         = EXCLUDED.retencion,
    neto_a_pagar      = EXCLUDED.neto_a_pagar,
    corresponde       = EXCLUDED.corresponde,
    motivo            = EXCLUDED.motivo,
    tramo_txt         = EXCLUDED.tramo_txt,
    metodo            = EXCLUDED.metodo,
    observaciones     = EXCLUDED.observaciones,
    updated_at        = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─── RPC: emitir certificado ─────────────────────────────────
CREATE OR REPLACE FUNCTION ap_emitir_certificado_ganancias(
  p_retencion_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cert_id   uuid;
  v_numero    text;
  v_importe   numeric;
BEGIN
  SELECT retencion INTO v_importe FROM ganancias_retenciones WHERE id = p_retencion_id;
  IF v_importe IS NULL THEN
    RAISE EXCEPTION 'Retención no encontrada';
  END IF;

  v_numero := 'RG-' || LPAD(nextval('ganancias_cert_seq')::text, 6, '0');

  INSERT INTO ganancias_certificados (retencion_id, numero_cert, importe_retenido, emitido_por)
  VALUES (p_retencion_id, v_numero, v_importe, auth.uid())
  RETURNING id INTO v_cert_id;

  RETURN jsonb_build_object('id', v_cert_id, 'numero', v_numero, 'importe', v_importe);
END;
$$;

-- ─── RPC: acumulado mensual de un proveedor ──────────────────
CREATE OR REPLACE FUNCTION ap_acumulado_mensual_proveedor(
  p_vendor_id uuid,
  p_mes       date   -- cualquier día del mes de referencia
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(gr.neto_gravado), 0)
  FROM   ganancias_retenciones gr
  JOIN   supplier_invoices      si ON si.id = gr.supplier_invoice_id
  WHERE  si.vendor_id   = p_vendor_id
  AND    date_trunc('month', gr.fecha_pago) = date_trunc('month', p_mes);
$$;

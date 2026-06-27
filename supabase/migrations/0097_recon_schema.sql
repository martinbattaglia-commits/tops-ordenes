-- supabase/migrations/0097_recon_schema.sql
-- ============================================================
-- Módulo de Conciliación de Órdenes de Compra
-- ============================================================

-- 1. Enum de estado de conciliación
CREATE TYPE recon_status_t AS ENUM (
  'pendiente',         -- iniciada, sin revisión
  'en_revision',       -- enviada para aprobación
  'conciliada',        -- aprobada sin diferencias
  'con_diferencias',   -- aprobada con difs aceptadas
  'rechazada'          -- rechazada; requiere nueva factura o NC
);

-- 2. Enum de campos comparables
CREATE TYPE recon_diff_field_t AS ENUM (
  'proveedor',
  'cuit',
  'moneda',
  'cond_pago',
  'fecha_emision',
  'neto',
  'iva',
  'percepciones',
  'tributos',
  'total',
  'cantidad_items',
  'precio_unitario',
  'tipo_comprobante',
  'punto_venta',
  'numero',
  'cae',
  'otros'
);

-- 3. Tabla header de conciliación
CREATE TABLE po_reconciliations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE RESTRICT,
  status              recon_status_t NOT NULL DEFAULT 'pendiente',
  score               smallint NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  -- quién inició y quién resolvió
  initiated_by        uuid NOT NULL REFERENCES auth.users(id),
  initiated_at        timestamptz NOT NULL DEFAULT now(),
  resolved_by         uuid REFERENCES auth.users(id),
  resolved_at         timestamptz,
  -- nota de resolución
  resolution_note     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Una OC sólo puede tener una conciliación activa a la vez
  CONSTRAINT uq_recon_po_active UNIQUE (purchase_order_id)
);

-- 4. Tabla de diferencias campo por campo
CREATE TABLE po_reconciliation_diffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES po_reconciliations(id) ON DELETE CASCADE,
  field           recon_diff_field_t NOT NULL,
  val_oc          text,          -- valor en la OC (serializado como text)
  val_factura     text,          -- valor en la factura
  delta_num       numeric(14,2), -- diferencia numérica si aplica
  severity        text NOT NULL CHECK (severity IN ('info','warning','error')),
  accepted        boolean NOT NULL DEFAULT false,
  accepted_by     uuid REFERENCES auth.users(id),
  accepted_at     timestamptz,
  accept_note     text
);

-- 5. Tabla de eventos de conciliación (append-only)
CREATE TABLE recon_events (
  id              bigserial PRIMARY KEY,
  reconciliation_id uuid NOT NULL REFERENCES po_reconciliations(id) ON DELETE RESTRICT,
  ts              timestamptz NOT NULL DEFAULT now(),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  action          text NOT NULL,  -- iniciar, enviar_revision, aprobar, rechazar, aceptar_dif, nota
  from_status     recon_status_t,
  to_status       recon_status_t,
  note            text,
  meta            jsonb
);

-- 6. Trigger append-only en recon_events
CREATE OR REPLACE FUNCTION tg_forbid_delete_recon_events()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los eventos de conciliación son inmutables (append-only)';
END;
$$;

CREATE TRIGGER tg_recon_events_no_delete
  BEFORE DELETE ON recon_events
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete_recon_events();

-- 7. Índices
CREATE INDEX idx_recon_po     ON po_reconciliations (purchase_order_id);
CREATE INDEX idx_recon_inv    ON po_reconciliations (supplier_invoice_id);
CREATE INDEX idx_recon_status ON po_reconciliations (status);
CREATE INDEX idx_recon_diffs  ON po_reconciliation_diffs (reconciliation_id);
CREATE INDEX idx_recon_events ON recon_events (reconciliation_id, ts DESC);

-- 8. RLS
ALTER TABLE po_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_reconciliation_diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_events ENABLE ROW LEVEL SECURITY;

-- Lectura: roles internos
CREATE POLICY "recon_read" ON po_reconciliations
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin','operaciones','supervisor'));

CREATE POLICY "recon_diffs_read" ON po_reconciliation_diffs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM po_reconciliations r
    WHERE r.id = reconciliation_id
      AND auth.jwt() ->> 'role' IN ('admin','operaciones','supervisor')
  ));

CREATE POLICY "recon_events_read" ON recon_events
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin','operaciones','supervisor'));

-- Escritura: sólo via RPC (no direct insert desde cliente)
-- (Las RPCs se definen en 0098)

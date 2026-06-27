# Conciliación de Órdenes de Compra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el módulo de Conciliación de OC en Nexus: motor de comparación automática OC↔Factura con score, UI side-by-side con diferencias resaltadas, flujo de aprobación auditado y bloqueo de pagos hasta conciliación aprobada.

**Architecture:** La conciliación vive en una tabla propia `po_reconciliations` (header) + `po_reconciliation_diffs` (diferencias campo por campo), separada de `purchase_orders` y `supplier_invoices` para permitir renegociaciones y auditoría completa sin tocar registros originales. El motor de diff corre en TypeScript puro (edge-compatible), calcula un score 0–100, y los eventos quedan en `recon_events` (append-only). El bloqueo de pagos se implementa en la vista `supplier_ap_status` que ya consume Tesorería.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL + RLS), TypeScript, Tailwind CSS + design system Nexus (dark mode / glassmorphism), Recharts (KPIs), Zod (validación).

## Global Constraints

- Proyecto: `/Users/martinbattaglia/CODE/tops-ordenes/`
- Prod Supabase ID: `arsksytgdnzukbmfgkju` — sólo lectura por defecto; aplicar migraciones vía `supabase/migrations/` y CLI `supabase db push`
- Siguiente migración disponible: `0097`
- Framework: Next.js App Router con `export const dynamic = "force-dynamic"` en todas las pages que lean DB
- Pattern de datos: `isMock()` en `src/lib/*/data.ts`; prod usa Supabase client con RLS; demo usa mocks
- Estilo: CSS variables del design system (`--bg-surface`, `--fg-primary`, etc.); clases `.btn`, `.badge`, `.kpi`, `.tbl`, `.nx-surface`; modo oscuro vía `:root.dark`
- Audit: tablas de eventos **append-only** (trigger `tg_forbid_delete_financial` ya existe para `supplier_invoice_audit`)
- Moneda: `fmtCurrency()` en `src/lib/utils.ts` (locale es-AR, sin decimales)
- Tolerancia fiscal: diferencias ≤ $0.02 ARS se ignoran (ya establecido en 0056)
- RLS: roles internos = `admin`, `operaciones`, `supervisor`; externa = read-only auth
- Commits: convencional (`feat:`, `fix:`, `chore:`, `refactor:`)

---

## File Structure

### Nuevos archivos a crear

```
supabase/migrations/
  0097_recon_schema.sql          — Tablas recon, enum, trigger append-only
  0098_recon_rpc.sql             — RPCs: recon_start, recon_approve, recon_reject, recon_note
  0099_recon_views.sql           — Vista recon_status_view + extensión supplier_ap_status

src/lib/recon/
  types.ts                       — Tipos TS para reconciliación
  diff-engine.ts                 — Motor de diff puro (sin I/O); calcula score y diffs
  data.ts                        — Acceso a DB: getRecon, listRecons, startRecon, etc.
  validation.ts                  — Zod schemas para input de API

src/app/api/compras/conciliar/
  [poId]/route.ts                — POST /api/compras/conciliar/:poId (start reconciliation)
  [poId]/approve/route.ts        — POST approve
  [poId]/reject/route.ts         — POST reject
  [poId]/accept-diff/route.ts    — POST accept individual diff
  [poId]/note/route.ts           — POST add note

src/app/(app)/compras/conciliacion/
  page.tsx                       — Dashboard de conciliación (KPIs + lista)
  [poId]/page.tsx                — Pantalla side-by-side detail
  [poId]/ReconDetail.tsx         — Client component: comparación + acciones
  [poId]/DiffRow.tsx             — Fila de comparación campo por campo
  [poId]/ScoreBadge.tsx          — Badge circular score %
  [poId]/ReconTimeline.tsx       — Historial de eventos
  [poId]/ReconActions.tsx        — Panel de botones de acción

src/components/compras/
  ReconStatusBadge.tsx           — Badge estado conciliación (igual patrón PoStatusBadge)
```

### Archivos a modificar

```
src/lib/erp/types.ts             — Agregar ap_approval_status "aprobada_con_difs" y recon guard
src/lib/erp/data.ts              — Agregar getSupplierInvoiceForRecon()
src/lib/compras/data.ts          — Agregar link a reconciliación en getPurchaseOrder()
src/app/(app)/compras/ordenes/[publicId]/OrderDetailTabs.tsx  — Agregar tab "Conciliación"
src/app/(app)/compras/facturas/page.tsx                       — Indicador de estado recon en lista
src/app/(app)/compras/page.tsx                                — KPI % conciliadas del nuevo módulo
supabase/migrations/0059_iva_compras_views.sql                — NO modificar (archivo histórico)
```

---

## Task 1: Migración 0097 — Schema de Conciliación

**Files:**
- Create: `supabase/migrations/0097_recon_schema.sql`

**Interfaces:**
- Produces: tablas `po_reconciliations`, `po_reconciliation_diffs`, `recon_events`; enum `recon_status_t`; enum `recon_diff_field_t`

- [ ] **Step 1: Escribir el SQL de la migración**

```sql
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
```

- [ ] **Step 2: Verificar que el SQL es válido localmente**

```bash
cd /Users/martinbattaglia/CODE/tops-ordenes
# Dry-run: verificar sintaxis con psql si hay instancia local, si no continuar
supabase db diff --use-migra 2>/dev/null || echo "sin instancia local, ok"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0097_recon_schema.sql
git commit -m "feat(recon): migración 0097 schema de conciliación (tables, enums, RLS, append-only)"
```

---

## Task 2: Migración 0098 — RPCs de Conciliación

**Files:**
- Create: `supabase/migrations/0098_recon_rpc.sql`

**Interfaces:**
- Consumes: tablas de Task 1
- Produces:
  - `recon_start(p_po_id uuid, p_invoice_id uuid, p_score smallint, p_diffs jsonb) → uuid`
  - `recon_approve(p_recon_id uuid, p_note text) → void`
  - `recon_reject(p_recon_id uuid, p_note text) → void`
  - `recon_accept_diff(p_diff_id uuid, p_note text) → void`
  - `recon_add_note(p_recon_id uuid, p_note text) → void`

- [ ] **Step 1: Escribir las RPCs**

```sql
-- supabase/migrations/0098_recon_rpc.sql
-- ============================================================
-- RPCs de Conciliación — única vía de escritura (SECURITY DEFINER)
-- ============================================================

-- Función auxiliar: obtener rol del JWT
CREATE OR REPLACE FUNCTION _recon_assert_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF auth.jwt() ->> 'role' NOT IN ('admin','operaciones','supervisor') THEN
    RAISE EXCEPTION 'Sin permisos para operar conciliaciones';
  END IF;
END;
$$;

-- --------------------------------------------------------
-- recon_start: inicia una conciliación (o la reabre si ya existe)
-- p_diffs: array de objetos {field, val_oc, val_factura, delta_num, severity}
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_start(
  p_po_id       uuid,
  p_invoice_id  uuid,
  p_score       smallint,
  p_diffs       jsonb        -- array de diff objects
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_recon_id  uuid;
  v_diff      jsonb;
BEGIN
  PERFORM _recon_assert_role();

  -- Si ya existe, eliminar diffs viejos y actualizar header
  SELECT id INTO v_recon_id
    FROM po_reconciliations
   WHERE purchase_order_id = p_po_id;

  IF v_recon_id IS NOT NULL THEN
    -- Sólo se puede re-iniciar si estaba rechazada o pendiente
    IF (SELECT status FROM po_reconciliations WHERE id = v_recon_id) NOT IN ('rechazada','pendiente') THEN
      RAISE EXCEPTION 'La conciliación no puede re-iniciarse en su estado actual';
    END IF;
    DELETE FROM po_reconciliation_diffs WHERE reconciliation_id = v_recon_id;
    UPDATE po_reconciliations SET
      supplier_invoice_id = p_invoice_id,
      status              = 'pendiente',
      score               = p_score,
      initiated_by        = auth.uid(),
      initiated_at        = now(),
      resolved_by         = NULL,
      resolved_at         = NULL,
      resolution_note     = NULL
    WHERE id = v_recon_id;
  ELSE
    INSERT INTO po_reconciliations
      (purchase_order_id, supplier_invoice_id, status, score, initiated_by)
    VALUES
      (p_po_id, p_invoice_id, 'pendiente', p_score, auth.uid())
    RETURNING id INTO v_recon_id;
  END IF;

  -- Insertar diffs
  FOR v_diff IN SELECT * FROM jsonb_array_elements(p_diffs)
  LOOP
    INSERT INTO po_reconciliation_diffs
      (reconciliation_id, field, val_oc, val_factura, delta_num, severity)
    VALUES (
      v_recon_id,
      (v_diff->>'field')::recon_diff_field_t,
      v_diff->>'val_oc',
      v_diff->>'val_factura',
      (v_diff->>'delta_num')::numeric,
      v_diff->>'severity'
    );
  END LOOP;

  -- Evento
  INSERT INTO recon_events (reconciliation_id, user_id, action, to_status, meta)
  VALUES (v_recon_id, auth.uid(), 'iniciar', 'pendiente',
          jsonb_build_object('score', p_score, 'n_diffs', jsonb_array_length(p_diffs)));

  -- Actualizar estado de la OC a 'conciliada' si score=100 y sin diffs error
  IF p_score = 100 AND NOT EXISTS (
    SELECT 1 FROM po_reconciliation_diffs
    WHERE reconciliation_id = v_recon_id AND severity = 'error'
  ) THEN
    PERFORM recon_approve(v_recon_id, 'Aprobación automática — score 100%');
  END IF;

  RETURN v_recon_id;
END;
$$;

-- --------------------------------------------------------
-- recon_approve
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_approve(p_recon_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_status  recon_status_t;
  v_has_diffs   boolean;
  v_new_status  recon_status_t;
  v_po_id       uuid;
BEGIN
  PERFORM _recon_assert_role();

  SELECT status, purchase_order_id INTO v_old_status, v_po_id
    FROM po_reconciliations WHERE id = p_recon_id FOR UPDATE;

  IF v_old_status NOT IN ('pendiente','en_revision') THEN
    RAISE EXCEPTION 'Sólo se puede aprobar desde pendiente o en_revision';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM po_reconciliation_diffs
    WHERE reconciliation_id = p_recon_id
      AND severity IN ('warning','error')
      AND NOT accepted
  ) INTO v_has_diffs;

  IF v_has_diffs THEN
    RAISE EXCEPTION 'Existen diferencias sin aceptar. Aceptar o rechazar antes de aprobar.';
  END IF;

  v_new_status := CASE WHEN EXISTS (
    SELECT 1 FROM po_reconciliation_diffs WHERE reconciliation_id = p_recon_id
  ) THEN 'con_diferencias' ELSE 'conciliada' END;

  UPDATE po_reconciliations SET
    status          = v_new_status,
    resolved_by     = auth.uid(),
    resolved_at     = now(),
    resolution_note = p_note
  WHERE id = p_recon_id;

  -- Actualizar estado de la OC
  UPDATE purchase_orders SET status = 'conciliada', factura_id = (
    SELECT supplier_invoice_id FROM po_reconciliations WHERE id = p_recon_id
  ) WHERE id = v_po_id;

  INSERT INTO recon_events (reconciliation_id, user_id, action, from_status, to_status, note)
  VALUES (p_recon_id, auth.uid(), 'aprobar', v_old_status, v_new_status, p_note);
END;
$$;

-- --------------------------------------------------------
-- recon_reject
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_reject(p_recon_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_status  recon_status_t;
BEGIN
  PERFORM _recon_assert_role();

  SELECT status INTO v_old_status
    FROM po_reconciliations WHERE id = p_recon_id FOR UPDATE;

  IF v_old_status NOT IN ('pendiente','en_revision') THEN
    RAISE EXCEPTION 'Sólo se puede rechazar desde pendiente o en_revision';
  END IF;

  IF p_note IS NULL OR trim(p_note) = '' THEN
    RAISE EXCEPTION 'El rechazo requiere una nota obligatoria';
  END IF;

  UPDATE po_reconciliations SET
    status          = 'rechazada',
    resolved_by     = auth.uid(),
    resolved_at     = now(),
    resolution_note = p_note
  WHERE id = p_recon_id;

  INSERT INTO recon_events (reconciliation_id, user_id, action, from_status, to_status, note)
  VALUES (p_recon_id, auth.uid(), 'rechazar', v_old_status, 'rechazada', p_note);
END;
$$;

-- --------------------------------------------------------
-- recon_accept_diff: acepta una diferencia individual
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_accept_diff(p_diff_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_recon_id  uuid;
BEGIN
  PERFORM _recon_assert_role();

  SELECT reconciliation_id INTO v_recon_id
    FROM po_reconciliation_diffs WHERE id = p_diff_id;

  IF NOT EXISTS (
    SELECT 1 FROM po_reconciliations WHERE id = v_recon_id AND status IN ('pendiente','en_revision')
  ) THEN
    RAISE EXCEPTION 'No se pueden aceptar diferencias en este estado';
  END IF;

  UPDATE po_reconciliation_diffs SET
    accepted    = true,
    accepted_by = auth.uid(),
    accepted_at = now(),
    accept_note = p_note
  WHERE id = p_diff_id;

  INSERT INTO recon_events (reconciliation_id, user_id, action, meta)
  VALUES (v_recon_id, auth.uid(), 'aceptar_dif',
          jsonb_build_object('diff_id', p_diff_id, 'note', p_note));
END;
$$;

-- --------------------------------------------------------
-- recon_add_note
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_add_note(p_recon_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _recon_assert_role();
  IF p_note IS NULL OR trim(p_note) = '' THEN
    RAISE EXCEPTION 'La nota no puede estar vacía';
  END IF;
  INSERT INTO recon_events (reconciliation_id, user_id, action, note)
  VALUES (p_recon_id, auth.uid(), 'nota', p_note);
END;
$$;

-- recon_send_to_review
CREATE OR REPLACE FUNCTION recon_send_to_review(p_recon_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_old recon_status_t; BEGIN
  PERFORM _recon_assert_role();
  SELECT status INTO v_old FROM po_reconciliations WHERE id = p_recon_id FOR UPDATE;
  IF v_old <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo se puede enviar a revisión desde estado pendiente';
  END IF;
  UPDATE po_reconciliations SET status = 'en_revision' WHERE id = p_recon_id;
  INSERT INTO recon_events (reconciliation_id, user_id, action, from_status, to_status, note)
  VALUES (p_recon_id, auth.uid(), 'enviar_revision', 'pendiente', 'en_revision', p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION recon_start TO authenticated;
GRANT EXECUTE ON FUNCTION recon_approve TO authenticated;
GRANT EXECUTE ON FUNCTION recon_reject TO authenticated;
GRANT EXECUTE ON FUNCTION recon_accept_diff TO authenticated;
GRANT EXECUTE ON FUNCTION recon_add_note TO authenticated;
GRANT EXECUTE ON FUNCTION recon_send_to_review TO authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0098_recon_rpc.sql
git commit -m "feat(recon): migración 0098 RPCs de conciliación (start/approve/reject/accept_diff/note)"
```

---

## Task 3: Migración 0099 — Vista de estado de conciliación

**Files:**
- Create: `supabase/migrations/0099_recon_views.sql`

**Interfaces:**
- Produces: vista `v_recon_status` con campos `po_public_id`, `invoice_public_id`, `recon_status`, `score`, `n_diffs`, `n_pending_diffs`, `listo_para_pago`

- [ ] **Step 1: Escribir la vista**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0099_recon_views.sql
git commit -m "feat(recon): migración 0099 vista v_recon_status con flag listo_para_pago"
```

---

## Task 4: Tipos TypeScript + Motor de Diff

**Files:**
- Create: `src/lib/recon/types.ts`
- Create: `src/lib/recon/diff-engine.ts`
- Create: `src/lib/recon/validation.ts`

**Interfaces:**
- Produces:
  - `ReconStatus` = `"pendiente" | "en_revision" | "conciliada" | "con_diferencias" | "rechazada"`
  - `ReconDiffField` (mismo enum que SQL)
  - `ReconDiff` `{ field, val_oc, val_factura, delta_num?, severity }`
  - `ReconResult` `{ score: number, diffs: ReconDiff[] }`
  - `computeRecon(po: POForRecon, invoice: InvoiceForRecon): ReconResult`

- [ ] **Step 1: Escribir `src/lib/recon/types.ts`**

```typescript
// src/lib/recon/types.ts

export type ReconStatus =
  | "pendiente"
  | "en_revision"
  | "conciliada"
  | "con_diferencias"
  | "rechazada";

export type ReconDiffSeverity = "info" | "warning" | "error";

export type ReconDiffField =
  | "proveedor"
  | "cuit"
  | "moneda"
  | "cond_pago"
  | "fecha_emision"
  | "neto"
  | "iva"
  | "percepciones"
  | "tributos"
  | "total"
  | "cantidad_items"
  | "precio_unitario"
  | "tipo_comprobante"
  | "punto_venta"
  | "numero"
  | "cae"
  | "otros";

export interface ReconDiff {
  field: ReconDiffField;
  val_oc: string;
  val_factura: string;
  delta_num?: number;
  severity: ReconDiffSeverity;
}

export interface ReconResult {
  score: number;       // 0–100
  diffs: ReconDiff[];
}

/** Shape mínima de OC que el motor necesita */
export interface POForRecon {
  id: string;
  public_id: string;
  vendor_id: string;
  neto: number;
  iva: number;
  total: number;
  moneda?: string;
  cond_pago?: string;
  items: Array<{ descripcion: string; cantidad: number; precio_unitario: number }>;
  vendor?: { cuit?: string; razon_social?: string };
}

/** Shape mínima de Factura que el motor necesita */
export interface InvoiceForRecon {
  id: string;
  public_id: string;
  vendor_id: string;
  tipo_comprobante: string;
  punto_venta: number;
  numero: string;
  cae?: string | null;
  fecha_emision: string;
  fecha_vencimiento?: string | null;
  moneda?: string | null;
  neto: number;
  iva: number;
  percepciones?: number | null;
  tributos?: number | null;
  total: number;
  vendor?: { cuit?: string; razon_social?: string };
}

export interface ReconRecord {
  id: string;
  purchase_order_id: string;
  supplier_invoice_id: string;
  status: ReconStatus;
  score: number;
  initiated_by: string;
  initiated_at: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  diffs: ReconDiffRecord[];
  events: ReconEvent[];
}

export interface ReconDiffRecord extends ReconDiff {
  id: string;
  reconciliation_id: string;
  accepted: boolean;
  accepted_by?: string | null;
  accepted_at?: string | null;
  accept_note?: string | null;
}

export interface ReconEvent {
  id: number;
  reconciliation_id: string;
  ts: string;
  user_id: string;
  action: string;
  from_status?: ReconStatus | null;
  to_status?: ReconStatus | null;
  note?: string | null;
  meta?: Record<string, unknown> | null;
}

// Meta para badges y colores
export const RECON_STATUS_META: Record<ReconStatus, { label: string; cls: string }> = {
  pendiente:        { label: "Pendiente",      cls: "badge-warning" },
  en_revision:      { label: "En revisión",    cls: "badge-info" },
  conciliada:       { label: "Conciliada",     cls: "badge-success" },
  con_diferencias:  { label: "Con diferencias",cls: "badge-warning" },
  rechazada:        { label: "Rechazada",      cls: "badge-danger" },
};

export const RECON_DIFF_FIELD_LABEL: Record<ReconDiffField, string> = {
  proveedor:       "Proveedor",
  cuit:            "CUIT",
  moneda:          "Moneda",
  cond_pago:       "Condición de pago",
  fecha_emision:   "Fecha de emisión",
  neto:            "Importe neto",
  iva:             "IVA",
  percepciones:    "Percepciones",
  tributos:        "Tributos",
  total:           "Total",
  cantidad_items:  "Cantidad de ítems",
  precio_unitario: "Precio unitario",
  tipo_comprobante:"Tipo de comprobante",
  punto_venta:     "Punto de venta",
  numero:          "Número",
  cae:             "CAE",
  otros:           "Otros",
};

export const SEVERITY_WEIGHT: Record<ReconDiffSeverity, number> = {
  info:    2,   // descuenta poco
  warning: 10,  // descuenta moderado
  error:   25,  // descuenta fuerte
};
```

- [ ] **Step 2: Escribir `src/lib/recon/diff-engine.ts`**

```typescript
// src/lib/recon/diff-engine.ts
// Motor puro: sin I/O, determinístico, testeable.

import type {
  POForRecon,
  InvoiceForRecon,
  ReconDiff,
  ReconResult,
  ReconDiffSeverity,
} from "./types";
import { SEVERITY_WEIGHT } from "./types";

const TOLERANCE_ARS = 0.02; // diferencias ≤ 2 centavos se ignoran (AFIP redondeo)

function numDiff(
  field: ReconDiff["field"],
  oc: number,
  inv: number,
  severity: ReconDiffSeverity = "warning",
): ReconDiff | null {
  const delta = Math.abs(oc - inv);
  if (delta <= TOLERANCE_ARS) return null;
  return {
    field,
    val_oc: String(oc),
    val_factura: String(inv),
    delta_num: inv - oc,
    severity,
  };
}

function strDiff(
  field: ReconDiff["field"],
  oc: string | undefined | null,
  inv: string | undefined | null,
  severity: ReconDiffSeverity = "warning",
): ReconDiff | null {
  const a = (oc ?? "").trim().toLowerCase();
  const b = (inv ?? "").trim().toLowerCase();
  if (a === b) return null;
  return { field, val_oc: oc ?? "", val_factura: inv ?? "", severity };
}

export function computeRecon(po: POForRecon, invoice: InvoiceForRecon): ReconResult {
  const diffs: ReconDiff[] = [];

  const push = (d: ReconDiff | null) => d && diffs.push(d);

  // Proveedor (misma empresa → error)
  if (po.vendor_id !== invoice.vendor_id) {
    diffs.push({
      field: "proveedor",
      val_oc: po.vendor?.razon_social ?? po.vendor_id,
      val_factura: invoice.vendor?.razon_social ?? invoice.vendor_id,
      severity: "error",
    });
  }

  // CUIT
  push(strDiff("cuit", po.vendor?.cuit, invoice.vendor?.cuit, "error"));

  // Moneda
  push(strDiff("moneda", po.moneda ?? "ARS", invoice.moneda ?? "ARS", "error"));

  // Condición de pago (info: puede diferir por negociación)
  push(strDiff("cond_pago", po.cond_pago, null, "info")); // invoice no tiene cond_pago

  // Importes
  push(numDiff("neto",   po.neto,  invoice.neto,  "warning"));
  push(numDiff("iva",    po.iva,   invoice.iva,   "warning"));
  push(numDiff("total",  po.total, invoice.total, "error"));

  // Percepciones y tributos (la OC no los tiene pre-calculados → sólo warning si invoice > 0)
  if ((invoice.percepciones ?? 0) > 0) {
    diffs.push({
      field: "percepciones",
      val_oc: "0",
      val_factura: String(invoice.percepciones),
      delta_num: -(invoice.percepciones ?? 0),
      severity: "warning",
    });
  }

  // Cantidad de ítems
  const nItems = po.items.length;
  // invoice no tiene items detallados en este modelo; si el total de neto difiere ya está capturado

  // Tipo de comprobante: la OC espera FACTURA_A (ej) — info si es diferente tipo
  if (!invoice.tipo_comprobante.startsWith("FACTURA")) {
    diffs.push({
      field: "tipo_comprobante",
      val_oc: "FACTURA_A / FACTURA_B",
      val_factura: invoice.tipo_comprobante,
      severity: "warning",
    });
  }

  // CAE presente (info si no tiene)
  if (!invoice.cae) {
    diffs.push({
      field: "cae",
      val_oc: "requerido",
      val_factura: "(vacío)",
      severity: "info",
    });
  }

  // Calcular score: se descuenta peso por cada diff
  const totalWeight = diffs.reduce((acc, d) => acc + SEVERITY_WEIGHT[d.severity], 0);
  const score = Math.max(0, Math.round(100 - totalWeight));

  return { score, diffs };
}
```

- [ ] **Step 3: Escribir `src/lib/recon/validation.ts`**

```typescript
// src/lib/recon/validation.ts
import { z } from "zod";

export const RejectSchema = z.object({
  note: z.string().min(5, "La nota es obligatoria (mín. 5 caracteres)"),
});

export const AcceptDiffSchema = z.object({
  diffId: z.string().uuid(),
  note: z.string().optional(),
});

export const AddNoteSchema = z.object({
  note: z.string().min(1, "La nota no puede estar vacía"),
});
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/recon/types.ts src/lib/recon/diff-engine.ts src/lib/recon/validation.ts
git commit -m "feat(recon): tipos TS, motor de diff puro y validaciones Zod"
```

---

## Task 5: Capa de Acceso a Datos

**Files:**
- Create: `src/lib/recon/data.ts`

**Interfaces:**
- Consumes: `ReconRecord`, `ReconDiffRecord`, `ReconEvent`, `computeRecon`, RPCs de Task 2
- Produces:
  - `getRecon(poId: string): Promise<ReconRecord | null>`
  - `listRecons(opts): Promise<ReconListResult>`
  - `startRecon(poId: string, invoiceId: string): Promise<{ reconId: string; score: number }>`
  - `approveRecon(reconId: string, note?: string): Promise<void>`
  - `rejectRecon(reconId: string, note: string): Promise<void>`
  - `acceptDiff(diffId: string, note?: string): Promise<void>`
  - `addNote(reconId: string, note: string): Promise<void>`
  - `sendToReview(reconId: string, note?: string): Promise<void>`

- [ ] **Step 1: Escribir `src/lib/recon/data.ts`**

```typescript
// src/lib/recon/data.ts
import { createClient } from "@/lib/supabase/server";
import type {
  ReconRecord,
  ReconDiffRecord,
  ReconEvent,
  ReconStatus,
  POForRecon,
  InvoiceForRecon,
} from "./types";
import { computeRecon } from "./diff-engine";

function isMock() {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  );
}

// ──────────────────────────────────────────────────────────
// getRecon: carga conciliación completa de una OC
// ──────────────────────────────────────────────────────────
export async function getRecon(poId: string): Promise<ReconRecord | null> {
  if (isMock()) return null;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("po_reconciliations")
    .select(`
      *,
      diffs:po_reconciliation_diffs(*),
      events:recon_events(* ORDER BY ts ASC)
    `)
    .eq("purchase_order_id", poId)
    .maybeSingle();

  if (error) throw error;
  return data as ReconRecord | null;
}

// ──────────────────────────────────────────────────────────
// getReconById
// ──────────────────────────────────────────────────────────
export async function getReconById(reconId: string): Promise<ReconRecord | null> {
  if (isMock()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("po_reconciliations")
    .select(`*, diffs:po_reconciliation_diffs(*), events:recon_events(* ORDER BY ts ASC)`)
    .eq("id", reconId)
    .maybeSingle();
  if (error) throw error;
  return data as ReconRecord | null;
}

// ──────────────────────────────────────────────────────────
// listRecons: para el dashboard
// ──────────────────────────────────────────────────────────
export interface ReconListResult {
  rows: Array<{
    id: string;
    po_public_id: string;
    invoice_public_id: string;
    status: ReconStatus;
    score: number;
    n_diffs: number;
    n_pending_diffs: number;
    listo_para_pago: boolean;
    initiated_at: string;
  }>;
  counts: Record<ReconStatus, number>;
  total: number;
}

export async function listRecons(opts: {
  status?: ReconStatus | "todas";
  pageSize?: number;
  page?: number;
} = {}): Promise<ReconListResult> {
  if (isMock()) return { rows: [], counts: {} as Record<ReconStatus, number>, total: 0 };
  const supabase = await createClient();
  const { pageSize = 50, page = 1, status } = opts;

  let q = supabase
    .from("v_recon_status")
    .select("*", { count: "exact" })
    .order("initiated_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (status && status !== "todas") q = q.eq("recon_status", status);

  const { data, count, error } = await q;
  if (error) throw error;

  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    id:                  r.recon_id as string,
    po_public_id:        r.po_public_id as string,
    invoice_public_id:   r.invoice_public_id as string,
    status:              r.recon_status as ReconStatus,
    score:               r.score as number,
    n_diffs:             Number(r.n_diffs ?? 0),
    n_pending_diffs:     Number(r.n_pending_diffs ?? 0),
    listo_para_pago:     Boolean(r.listo_para_pago),
    initiated_at:        r.initiated_at as string,
  }));

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {} as Record<ReconStatus, number>);

  return { rows, counts, total: count ?? 0 };
}

// ──────────────────────────────────────────────────────────
// startRecon: carga OC + factura, corre diff engine, llama RPC
// ──────────────────────────────────────────────────────────
export async function startRecon(
  poId: string,
  invoiceId: string,
): Promise<{ reconId: string; score: number; nDiffs: number }> {
  const supabase = await createClient();

  // Cargar OC
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .select("*, items:po_items(*), vendor:vendors(*)")
    .eq("id", poId)
    .single();
  if (poErr) throw poErr;

  // Cargar factura
  const { data: inv, error: invErr } = await supabase
    .from("supplier_invoices")
    .select("*, vendor:vendors(*)")
    .eq("id", invoiceId)
    .single();
  if (invErr) throw invErr;

  // Diff engine
  const { score, diffs } = computeRecon(po as POForRecon, inv as InvoiceForRecon);

  // RPC recon_start
  const { data: reconId, error: rpcErr } = await supabase.rpc("recon_start", {
    p_po_id:      poId,
    p_invoice_id: invoiceId,
    p_score:      score,
    p_diffs:      diffs,
  });
  if (rpcErr) throw rpcErr;

  return { reconId: reconId as string, score, nDiffs: diffs.length };
}

export async function approveRecon(reconId: string, note?: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("recon_approve", {
    p_recon_id: reconId,
    p_note:     note ?? null,
  });
  if (error) throw error;
}

export async function rejectRecon(reconId: string, note: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("recon_reject", {
    p_recon_id: reconId,
    p_note:     note,
  });
  if (error) throw error;
}

export async function acceptDiff(diffId: string, note?: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("recon_accept_diff", {
    p_diff_id: diffId,
    p_note:    note ?? null,
  });
  if (error) throw error;
}

export async function addNote(reconId: string, note: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("recon_add_note", {
    p_recon_id: reconId,
    p_note:     note,
  });
  if (error) throw error;
}

export async function sendToReview(reconId: string, note?: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("recon_send_to_review", {
    p_recon_id: reconId,
    p_note:     note ?? null,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/recon/data.ts
git commit -m "feat(recon): capa de datos con startRecon, approve, reject, acceptDiff, note"
```

---

## Task 6: API Routes

**Files:**
- Create: `src/app/api/compras/conciliar/[poId]/route.ts`
- Create: `src/app/api/compras/conciliar/[poId]/approve/route.ts`
- Create: `src/app/api/compras/conciliar/[poId]/reject/route.ts`
- Create: `src/app/api/compras/conciliar/[poId]/accept-diff/route.ts`
- Create: `src/app/api/compras/conciliar/[poId]/note/route.ts`
- Create: `src/app/api/compras/conciliar/[poId]/review/route.ts`

**Interfaces:**
- Consumes: `startRecon`, `approveRecon`, `rejectRecon`, `acceptDiff`, `addNote`, `sendToReview`
- Produces: JSON `{ ok: true, ...payload }` o `{ error: string }` con status HTTP apropiado

- [ ] **Step 1: Escribir route principal (POST iniciar conciliación)**

```typescript
// src/app/api/compras/conciliar/[poId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { startRecon } from "@/lib/recon/data";

export async function POST(
  req: NextRequest,
  { params }: { params: { poId: string } },
) {
  try {
    const { invoiceId } = await req.json();
    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId requerido" }, { status: 400 });
    }
    const result = await startRecon(params.poId, invoiceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Escribir route approve**

```typescript
// src/app/api/compras/conciliar/[poId]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { approveRecon } from "@/lib/recon/data";

export async function POST(req: NextRequest) {
  try {
    const { reconId, note } = await req.json();
    if (!reconId) return NextResponse.json({ error: "reconId requerido" }, { status: 400 });
    await approveRecon(reconId, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Escribir route reject**

```typescript
// src/app/api/compras/conciliar/[poId]/reject/route.ts
import { NextRequest, NextResponse } from "next/server";
import { rejectRecon } from "@/lib/recon/data";
import { RejectSchema } from "@/lib/recon/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { reconId } = body;
    const parsed = RejectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    if (!reconId) return NextResponse.json({ error: "reconId requerido" }, { status: 400 });
    await rejectRecon(reconId, parsed.data.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Escribir route accept-diff**

```typescript
// src/app/api/compras/conciliar/[poId]/accept-diff/route.ts
import { NextRequest, NextResponse } from "next/server";
import { acceptDiff } from "@/lib/recon/data";
import { AcceptDiffSchema } from "@/lib/recon/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AcceptDiffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    await acceptDiff(parsed.data.diffId, parsed.data.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Escribir route note**

```typescript
// src/app/api/compras/conciliar/[poId]/note/route.ts
import { NextRequest, NextResponse } from "next/server";
import { addNote } from "@/lib/recon/data";
import { AddNoteSchema } from "@/lib/recon/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AddNoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    const { reconId } = body;
    if (!reconId) return NextResponse.json({ error: "reconId requerido" }, { status: 400 });
    await addNote(reconId, parsed.data.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Escribir route review**

```typescript
// src/app/api/compras/conciliar/[poId]/review/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendToReview } from "@/lib/recon/data";

export async function POST(req: NextRequest) {
  try {
    const { reconId, note } = await req.json();
    if (!reconId) return NextResponse.json({ error: "reconId requerido" }, { status: 400 });
    await sendToReview(reconId, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/compras/conciliar/
git commit -m "feat(recon): API routes para iniciar/aprobar/rechazar/aceptar-dif/nota/revisión"
```

---

## Task 7: Componentes de UI Reutilizables

**Files:**
- Create: `src/components/compras/ReconStatusBadge.tsx`
- Create: `src/app/(app)/compras/conciliacion/[poId]/ScoreBadge.tsx`
- Create: `src/app/(app)/compras/conciliacion/[poId]/DiffRow.tsx`
- Create: `src/app/(app)/compras/conciliacion/[poId]/ReconTimeline.tsx`

**Interfaces:**
- Consumes: `RECON_STATUS_META`, `RECON_DIFF_FIELD_LABEL`, `ReconDiffRecord`, `ReconEvent`
- Produces: Componentes React exportados

- [ ] **Step 1: Escribir `ReconStatusBadge.tsx`**

```typescript
// src/components/compras/ReconStatusBadge.tsx
import { RECON_STATUS_META } from "@/lib/recon/types";
import type { ReconStatus } from "@/lib/recon/types";

export function ReconStatusBadge({ status }: { status: ReconStatus }) {
  const meta = RECON_STATUS_META[status];
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}
```

- [ ] **Step 2: Escribir `ScoreBadge.tsx`**

```typescript
// src/app/(app)/compras/conciliacion/[poId]/ScoreBadge.tsx

interface Props { score: number; size?: "sm" | "md" | "lg" }

export function ScoreBadge({ score, size = "md" }: Props) {
  const color =
    score === 100 ? "text-[var(--status-success)]"
    : score >= 90  ? "text-[var(--status-warning)]"
    : "text-[var(--status-danger)]";

  const dim = size === "lg" ? 80 : size === "md" ? 56 : 40;
  const r = dim / 2 - 6;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="rotate-[-90deg]">
        <circle
          cx={dim / 2} cy={dim / 2} r={r}
          fill="none" stroke="var(--stroke-soft)" strokeWidth={5}
        />
        <circle
          cx={dim / 2} cy={dim / 2} r={r}
          fill="none"
          stroke={score === 100 ? "var(--status-success)" : score >= 90 ? "var(--status-warning)" : "var(--status-danger)"}
          strokeWidth={5}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span className={`text-sm font-bold tabular ${color}`}>{score}%</span>
    </div>
  );
}
```

- [ ] **Step 3: Escribir `DiffRow.tsx`**

```typescript
// src/app/(app)/compras/conciliacion/[poId]/DiffRow.tsx
"use client";
import { useState } from "react";
import type { ReconDiffRecord } from "@/lib/recon/types";
import { RECON_DIFF_FIELD_LABEL } from "@/lib/recon/types";
import { Icon } from "@/components/Icon";

interface Props {
  diff: ReconDiffRecord;
  onAccept: (diffId: string, note?: string) => Promise<void>;
  canEdit: boolean;
}

const SEVERITY_CLS: Record<string, string> = {
  info:    "border-l-[var(--status-info)]    bg-[var(--status-info)]/5",
  warning: "border-l-[var(--status-warning)] bg-[var(--status-warning)]/5",
  error:   "border-l-[var(--status-danger)]  bg-[var(--status-danger)]/5",
};

const SEVERITY_ICON: Record<string, string> = {
  info: "info", warning: "alert-triangle", error: "x-circle",
};

export function DiffRow({ diff, onAccept, canEdit }: Props) {
  const [loading, setLoading] = useState(false);
  const [note, setNote]       = useState("");
  const [showNote, setShowNote] = useState(false);

  const handleAccept = async () => {
    setLoading(true);
    await onAccept(diff.id, note || undefined);
    setLoading(false);
    setShowNote(false);
  };

  const label = RECON_DIFF_FIELD_LABEL[diff.field] ?? diff.field;

  return (
    <div className={`border-l-2 rounded-lg px-4 py-3 ${SEVERITY_CLS[diff.severity]} ${diff.accepted ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={SEVERITY_ICON[diff.severity]} size={14} className={
            diff.severity === "error" ? "text-[var(--status-danger)]"
            : diff.severity === "warning" ? "text-[var(--status-warning)]"
            : "text-[var(--status-info)]"
          } />
          <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide shrink-0">
            {label}
          </span>
        </div>
        {diff.accepted ? (
          <span className="badge badge-success text-xs shrink-0">Aceptada</span>
        ) : canEdit ? (
          <button
            onClick={() => setShowNote(v => !v)}
            className="btn btn-ghost btn-sm text-xs shrink-0"
          >
            Aceptar diferencia
          </button>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-eyebrow-sm text-fg-muted mb-0.5">Orden de Compra</div>
          <div className="font-medium text-fg-primary">{diff.val_oc || "—"}</div>
        </div>
        <div>
          <div className="text-eyebrow-sm text-fg-muted mb-0.5">Factura Proveedor</div>
          <div className={`font-medium ${diff.val_oc !== diff.val_factura ? "text-[var(--status-danger)]" : "text-fg-primary"}`}>
            {diff.val_factura || "—"}
          </div>
        </div>
      </div>

      {diff.delta_num !== null && diff.delta_num !== undefined && (
        <div className="mt-1 text-xs text-fg-muted">
          Diferencia: <span className={diff.delta_num > 0 ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"}>
            {diff.delta_num > 0 ? "+" : ""}{diff.delta_num.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
          </span>
        </div>
      )}

      {showNote && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="Nota de aceptación (opcional)…"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="flex-1 input input-sm"
          />
          <button
            onClick={handleAccept}
            disabled={loading}
            className="btn btn-primary btn-sm"
          >
            {loading ? "…" : "Confirmar"}
          </button>
        </div>
      )}

      {diff.accepted && diff.accept_note && (
        <p className="mt-1 text-xs text-fg-muted italic">Nota: {diff.accept_note}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Escribir `ReconTimeline.tsx`**

```typescript
// src/app/(app)/compras/conciliacion/[poId]/ReconTimeline.tsx
import type { ReconEvent } from "@/lib/recon/types";
import { fmtDateTime } from "@/lib/utils";
import { Icon } from "@/components/Icon";

const ACTION_LABEL: Record<string, string> = {
  iniciar:          "Conciliación iniciada",
  enviar_revision:  "Enviada a revisión",
  aprobar:          "Aprobada",
  rechazar:         "Rechazada",
  aceptar_dif:      "Diferencia aceptada",
  nota:             "Nota registrada",
};

const ACTION_ICON: Record<string, string> = {
  iniciar:         "play-circle",
  enviar_revision: "send",
  aprobar:         "check-circle",
  rechazar:        "x-circle",
  aceptar_dif:     "check",
  nota:            "message-square",
};

export function ReconTimeline({ events }: { events: ReconEvent[] }) {
  if (!events.length) return (
    <p className="text-fg-muted text-sm">Sin eventos registrados.</p>
  );
  return (
    <ol className="relative border-l border-[var(--stroke-soft)] ml-3 space-y-4">
      {events.map(ev => (
        <li key={ev.id} className="ml-4">
          <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--bg-surface)] border border-[var(--stroke-soft)]">
            <Icon name={ACTION_ICON[ev.action] ?? "circle"} size={8} />
          </span>
          <div className="text-xs text-fg-muted">{fmtDateTime(ev.ts)}</div>
          <div className="text-sm font-medium text-fg-primary">
            {ACTION_LABEL[ev.action] ?? ev.action}
          </div>
          {ev.note && <p className="text-xs text-fg-secondary mt-0.5 italic">"{ev.note}"</p>}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/compras/ReconStatusBadge.tsx \
        src/app/\(app\)/compras/conciliacion/
git commit -m "feat(recon): componentes UI (ReconStatusBadge, ScoreBadge, DiffRow, ReconTimeline)"
```

---

## Task 8: Pantalla de Detalle Side-by-Side

**Files:**
- Create: `src/app/(app)/compras/conciliacion/[poId]/ReconActions.tsx`
- Create: `src/app/(app)/compras/conciliacion/[poId]/ReconDetail.tsx`
- Create: `src/app/(app)/compras/conciliacion/[poId]/page.tsx`

**Interfaces:**
- Consumes: `getRecon`, `getReconById`, todos los componentes de Task 7, API routes de Task 6
- Produces: página `/compras/conciliacion/:poId` con UI completa

- [ ] **Step 1: Escribir `ReconActions.tsx`**

```typescript
// src/app/(app)/compras/conciliacion/[poId]/ReconActions.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReconRecord } from "@/lib/recon/types";
import { Icon } from "@/components/Icon";

export function ReconActions({ recon, poId }: { recon: ReconRecord; poId: string }) {
  const router  = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectText, setRejectText] = useState("");

  const call = async (path: string, body: object) => {
    const r = await fetch(`/api/compras/conciliar/${poId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const { error } = await r.json();
      alert(error ?? "Error al procesar");
    } else {
      router.refresh();
    }
  };

  const canApprove   = recon.status === "pendiente" || recon.status === "en_revision";
  const canReject    = recon.status === "pendiente" || recon.status === "en_revision";
  const canReview    = recon.status === "pendiente";
  const hasPendDiffs = recon.diffs.some(d => d.severity !== "info" && !d.accepted);

  return (
    <div className="nx-surface rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-fg-primary">Acciones</h3>

      {canReview && (
        <button
          disabled={!!loading}
          onClick={async () => {
            setLoading("review");
            await call("review", { reconId: recon.id });
            setLoading(null);
          }}
          className="btn btn-ghost btn-sm w-full justify-start gap-2"
        >
          <Icon name="send" size={14} />
          Enviar a revisión
        </button>
      )}

      {canApprove && (
        <button
          disabled={!!loading || hasPendDiffs}
          title={hasPendDiffs ? "Primero aceptá todas las diferencias marcadas" : undefined}
          onClick={async () => {
            setLoading("approve");
            await call("approve", { reconId: recon.id });
            setLoading(null);
          }}
          className="btn btn-primary btn-sm w-full justify-start gap-2 disabled:opacity-50"
        >
          <Icon name="check-circle" size={14} />
          Aprobar conciliación
        </button>
      )}

      {canReject && (
        <>
          <button
            onClick={() => setRejectOpen(v => !v)}
            className="btn btn-danger btn-sm w-full justify-start gap-2"
          >
            <Icon name="x-circle" size={14} />
            Rechazar
          </button>
          {rejectOpen && (
            <div className="space-y-2">
              <textarea
                rows={3}
                placeholder="Motivo del rechazo (obligatorio)…"
                value={rejectText}
                onChange={e => setRejectText(e.target.value)}
                className="w-full input text-sm"
              />
              <button
                disabled={rejectText.trim().length < 5}
                onClick={async () => {
                  setLoading("reject");
                  await call("reject", { reconId: recon.id, note: rejectText });
                  setLoading(null);
                  setRejectOpen(false);
                }}
                className="btn btn-danger btn-sm w-full disabled:opacity-50"
              >
                Confirmar rechazo
              </button>
            </div>
          )}
        </>
      )}

      <hr className="border-[var(--stroke-soft)]" />

      <button
        onClick={() => setNoteOpen(v => !v)}
        className="btn btn-ghost btn-sm w-full justify-start gap-2 text-fg-secondary"
      >
        <Icon name="message-square" size={14} />
        Agregar nota
      </button>
      {noteOpen && (
        <div className="space-y-2">
          <textarea
            rows={2}
            placeholder="Nota…"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            className="w-full input text-sm"
          />
          <button
            disabled={!noteText.trim()}
            onClick={async () => {
              setLoading("note");
              await call("note", { reconId: recon.id, note: noteText });
              setNoteText("");
              setNoteOpen(false);
              setLoading(null);
            }}
            className="btn btn-primary btn-sm w-full disabled:opacity-50"
          >
            Guardar nota
          </button>
        </div>
      )}

      {(recon.status === "conciliada" || recon.status === "con_diferencias") && (
        <div className="rounded-lg bg-[var(--status-success)]/10 border border-[var(--status-success)]/30 p-3 text-xs text-[var(--status-success)] flex gap-2">
          <Icon name="check-circle" size={14} className="shrink-0 mt-0.5" />
          <span>Esta factura está habilitada para pago en Tesorería.</span>
        </div>
      )}

      {recon.status === "rechazada" && (
        <div className="rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 p-3 text-xs text-[var(--status-danger)] flex gap-2">
          <Icon name="alert-triangle" size={14} className="shrink-0 mt-0.5" />
          <span>Factura BLOQUEADA para pago. Se requiere nota de crédito o nueva factura.</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Escribir `ReconDetail.tsx`**

```typescript
// src/app/(app)/compras/conciliacion/[poId]/ReconDetail.tsx
"use client";
import { useRouter } from "next/navigation";
import type { ReconRecord, ReconDiffRecord } from "@/lib/recon/types";
import { DiffRow } from "./DiffRow";
import { ScoreBadge } from "./ScoreBadge";
import { ReconTimeline } from "./ReconTimeline";
import { ReconStatusBadge } from "@/components/compras/ReconStatusBadge";
import { ReconActions } from "./ReconActions";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import type { PurchaseOrder } from "@/lib/types-po";
import type { SupplierInvoice } from "@/lib/erp/types";

interface Props {
  po: PurchaseOrder;
  invoice: SupplierInvoice;
  recon: ReconRecord;
  poId: string;
}

function Field({ label, oc, inv, highlight }: {
  label: string; oc: string; inv: string; highlight?: boolean
}) {
  const diff = oc !== inv;
  return (
    <div className={`grid grid-cols-[1fr_1fr] gap-4 py-2.5 border-b border-[var(--stroke-soft)] ${diff ? "bg-[var(--status-warning)]/5" : ""}`}>
      <div className="pl-2">
        <div className="text-eyebrow-sm text-fg-muted">{label}</div>
        <div className="text-sm font-medium text-fg-primary mt-0.5">{oc || "—"}</div>
      </div>
      <div>
        <div className="text-eyebrow-sm text-fg-muted">&nbsp;</div>
        <div className={`text-sm font-medium mt-0.5 ${diff ? "text-[var(--status-danger)]" : "text-fg-primary"}`}>
          {inv || "—"}
          {diff && <span className="ml-1 text-xs">⚠</span>}
        </div>
      </div>
    </div>
  );
}

export function ReconDetail({ po, invoice, recon, poId }: Props) {
  const router = useRouter();

  const handleAccept = async (diffId: string, note?: string) => {
    await fetch(`/api/compras/conciliar/${poId}/accept-diff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diffId, note }),
    });
    router.refresh();
  };

  const canEdit = recon.status === "pendiente" || recon.status === "en_revision";
  const nv = (v: number | null | undefined) => v != null ? fmtCurrency(v) : "—";
  const nro = (pv: number, n: string) =>
    `${String(pv).padStart(5, "0")}-${n.padStart(8, "0")}`;

  const poDate  = po.date  ? fmtDate(po.date)              : "—";
  const invDate = invoice.fecha_emision ? fmtDate(invoice.fecha_emision) : "—";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
      {/* Main panel */}
      <div className="space-y-6">

        {/* Score + header */}
        <div className="nx-surface rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-fg-primary">Comparación de documentos</h2>
              <p className="text-sm text-fg-muted">Cada campo se verifica automáticamente</p>
            </div>
            <div className="flex items-center gap-4">
              <ScoreBadge score={recon.score} size="lg" />
              <ReconStatusBadge status={recon.status} />
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-2 gap-4 pb-2 border-b border-[var(--stroke-soft)]">
            <div className="flex items-center gap-2">
              <span className="badge badge-muted">OC</span>
              <span className="font-semibold text-sm text-fg-primary">{po.public_id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge badge-info">FACTURA</span>
              <span className="font-semibold text-sm text-fg-primary">{invoice.public_id}</span>
            </div>
          </div>

          {/* Comparison fields */}
          <div className="divide-y divide-[var(--stroke-soft)] -mx-2 px-2">
            <Field label="Proveedor"
              oc={po.vendor?.razon_social ?? "—"}
              inv={invoice.vendor?.razon_social ?? "—"} />
            <Field label="CUIT"
              oc={po.vendor?.cuit ?? "—"}
              inv={invoice.vendor?.cuit ?? "—"} />
            <Field label="Fecha"
              oc={poDate}
              inv={invDate} />
            <Field label="Condición de pago"
              oc={po.cond_pago ?? "—"}
              inv="(en factura)" />
            <Field label="Tipo de comprobante"
              oc="FACTURA_A / FACTURA_B"
              inv={invoice.tipo_comprobante} />
            <Field label="Nro. comprobante"
              oc="(OC)"
              inv={nro(invoice.punto_venta, invoice.numero)} />
            <Field label="CAE"
              oc="(requerido)"
              inv={invoice.cae ?? "(sin CAE)"} />
            <Field label="Importe Neto"
              oc={nv(po.neto)}
              inv={nv(invoice.neto)} />
            <Field label="IVA"
              oc={nv(po.iva)}
              inv={nv(invoice.iva)} />
            <Field label="Percepciones"
              oc="—"
              inv={nv(invoice.percepciones)} />
            <Field label="TOTAL"
              oc={nv(po.total)}
              inv={nv(invoice.total)} />
          </div>
        </div>

        {/* Diferencias detectadas */}
        {recon.diffs.length > 0 && (
          <div className="nx-surface rounded-xl p-6 space-y-3">
            <h3 className="text-sm font-semibold text-fg-primary">
              Diferencias detectadas
              <span className="ml-2 badge badge-warning">{recon.diffs.length}</span>
            </h3>
            {recon.diffs.map(d => (
              <DiffRow
                key={d.id}
                diff={d}
                onAccept={handleAccept}
                canEdit={canEdit}
              />
            ))}
          </div>
        )}

        {recon.diffs.length === 0 && (
          <div className="nx-surface rounded-xl p-6 flex items-center gap-3 text-[var(--status-success)]">
            <span className="text-2xl">✓</span>
            <div>
              <div className="font-semibold">Sin diferencias</div>
              <div className="text-sm text-fg-muted">Todos los campos concuerdan dentro de la tolerancia.</div>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="nx-surface rounded-xl p-6">
          <h3 className="text-sm font-semibold text-fg-primary mb-4">Historial de eventos</h3>
          <ReconTimeline events={recon.events} />
        </div>
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        <ReconActions recon={recon} poId={poId} />

        <div className="nx-surface rounded-xl p-4 space-y-2 text-xs text-fg-muted">
          <div className="font-semibold text-fg-secondary text-sm">Resumen</div>
          <div className="flex justify-between">
            <span>Score</span>
            <span className="font-bold text-fg-primary">{recon.score}%</span>
          </div>
          <div className="flex justify-between">
            <span>Diferencias totales</span>
            <span>{recon.diffs.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Pendientes de aceptar</span>
            <span className={recon.diffs.filter(d => !d.accepted && d.severity !== "info").length > 0
              ? "text-[var(--status-danger)]" : ""}>
              {recon.diffs.filter(d => !d.accepted && d.severity !== "info").length}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Listo para pago</span>
            <span className={
              (recon.status === "conciliada" || recon.status === "con_diferencias")
                ? "text-[var(--status-success)] font-semibold"
                : "text-[var(--status-danger)]"
            }>
              {(recon.status === "conciliada" || recon.status === "con_diferencias") ? "Sí" : "No"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Escribir `page.tsx` (detail)**

```typescript
// src/app/(app)/compras/conciliacion/[poId]/page.tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getRecon } from "@/lib/recon/data";
import { getPurchaseOrder } from "@/lib/compras/data";
import { getSupplierInvoice } from "@/lib/erp/data";
import { ReconDetail } from "./ReconDetail";
import { Icon } from "@/components/Icon";
import { startRecon } from "@/lib/recon/data";

export const dynamic = "force-dynamic";
export function generateMetadata({ params }: { params: { poId: string } }) {
  return { title: `Conciliación · ${params.poId}` };
}

export default async function ReconDetailPage({
  params,
  searchParams,
}: {
  params: { poId: string };
  searchParams?: { invoice?: string };
}) {
  const po = await getPurchaseOrder(params.poId);
  if (!po) notFound();

  let recon = await getRecon(po.id);

  // Si se pasó ?invoice=<id> y no hay conciliación, iniciarla server-side
  if (!recon && searchParams?.invoice) {
    await startRecon(po.id, searchParams.invoice);
    recon = await getRecon(po.id);
  }

  if (!recon) {
    // No hay conciliación: mostrar selector de factura
    return (
      <div className="p-8 nx-page-fade max-w-xl mx-auto">
        <Link href="/compras/conciliacion" className="btn btn-ghost btn-sm mb-6">
          <Icon name="arrow-left" size={14} /> Volver
        </Link>
        <div className="nx-surface rounded-xl p-8 text-center space-y-4">
          <div className="text-4xl">🔗</div>
          <h2 className="text-lg font-semibold">Iniciar conciliación</h2>
          <p className="text-sm text-fg-muted">
            OC <strong>{po.public_id}</strong> — seleccioná la factura del proveedor para cotejar.
          </p>
          <p className="text-xs text-fg-muted">
            Usá el parámetro <code>?invoice=&lt;supplier_invoice_id&gt;</code> para iniciar automáticamente, o seleccioná desde la lista de Facturas.
          </p>
          <Link href="/compras/facturas" className="btn btn-primary btn-sm">
            <Icon name="file-text" size={14} /> Ver facturas
          </Link>
        </div>
      </div>
    );
  }

  // Obtener la factura
  const invoice = await getSupplierInvoice(recon.supplier_invoice_id);
  if (!invoice) notFound();

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/compras/conciliacion" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={14} /> Volver
        </Link>
        <div>
          <div className="eyebrow-tiny">Compras · Conciliación</div>
          <h1 className="page-title">
            {po.public_id} ↔ {invoice.public_id}
          </h1>
        </div>
      </div>

      <ReconDetail po={po} invoice={invoice} recon={recon} poId={po.id} />
    </div>
  );
}
```

- [ ] **Step 4: Agregar `getSupplierInvoice(id)` a `src/lib/erp/data.ts`**

Agregar la siguiente función al final del archivo existente `src/lib/erp/data.ts`:

```typescript
// Agregar al final de src/lib/erp/data.ts

export async function getSupplierInvoice(id: string) {
  if (isMock()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_invoices")
    .select("*, vendor:vendors(*), cost_center:cost_centers(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/compras/conciliacion/ src/lib/erp/data.ts
git commit -m "feat(recon): pantalla detail side-by-side (ReconDetail, ReconActions, page)"
```

---

## Task 9: Dashboard de Conciliación

**Files:**
- Create: `src/app/(app)/compras/conciliacion/page.tsx`

**Interfaces:**
- Consumes: `listRecons`, `ReconListResult`, `ReconStatusBadge`, `fmtCurrency`, `fmtDate`
- Produces: página `/compras/conciliacion` con KPIs + tabla filtrable

- [ ] **Step 1: Escribir `page.tsx` (dashboard)**

```typescript
// src/app/(app)/compras/conciliacion/page.tsx
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import { listRecons } from "@/lib/recon/data";
import { ReconStatusBadge } from "@/components/compras/ReconStatusBadge";
import { fmtDate } from "@/lib/utils";
import type { ReconStatus } from "@/lib/recon/types";
import { RECON_STATUS_META } from "@/lib/recon/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";

export const metadata = { title: "Conciliación de Órdenes de Compra" };
export const dynamic = "force-dynamic";

type PageProps = { searchParams?: { status?: string } };

const TABS: Array<{ key: ReconStatus | "todas"; label: string }> = [
  { key: "todas",          label: "Todas" },
  { key: "pendiente",      label: "Pendientes" },
  { key: "en_revision",    label: "En revisión" },
  { key: "con_diferencias",label: "Con diferencias" },
  { key: "conciliada",     label: "Conciliadas" },
  { key: "rechazada",      label: "Rechazadas" },
];

export default async function ConciliacionPage({ searchParams }: PageProps) {
  let result: Awaited<ReturnType<typeof listRecons>>;
  try {
    const status = (searchParams?.status as ReconStatus | "todas") ?? "todas";
    result = await listRecons({ status, pageSize: 100 });
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Conciliación no disponible"
        migration="0097_recon_schema"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const { rows, counts, total } = result;
  const status = (searchParams?.status as ReconStatus | "todas") ?? "todas";

  const kpis = [
    {
      label: "Total",
      value: total,
      sub: "conciliaciones",
      icon: "git-merge",
    },
    {
      label: "Pendientes",
      value: (counts["pendiente"] ?? 0) + (counts["en_revision"] ?? 0),
      sub: "requieren acción",
      icon: "clock",
      cls: "text-[var(--status-warning)]",
    },
    {
      label: "Con diferencias",
      value: counts["con_diferencias"] ?? 0,
      sub: "diferencias aceptadas",
      icon: "alert-triangle",
      cls: "text-[var(--status-warning)]",
    },
    {
      label: "Conciliadas",
      value: counts["conciliada"] ?? 0,
      sub: "listas para pago",
      icon: "check-circle",
      cls: "text-[var(--status-success)]",
    },
    {
      label: "Rechazadas",
      value: counts["rechazada"] ?? 0,
      sub: "requieren nueva factura",
      icon: "x-circle",
      cls: "text-[var(--status-danger)]",
    },
    {
      label: "% conciliadas",
      value: total > 0
        ? Math.round(((counts["conciliada"] ?? 0) + (counts["con_diferencias"] ?? 0)) / total * 100)
        : 0,
      sub: "del total",
      icon: "percent",
      suffix: "%",
    },
  ];

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Compras · ERP</div>
          <h1 className="page-title">Conciliación de OC</h1>
          <p className="page-subtitle">
            Control documental OC↔Factura. Una factura sólo puede pagarse cuando está conciliada y aprobada.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        {kpis.map((k, i) => (
          <div key={i} className="kpi nx-surface rounded-xl p-4">
            <div className="kpi-label flex items-center gap-1.5">
              <Icon name={k.icon} size={13} />
              {k.label}
            </div>
            <div className={`kpi-value ${k.cls ?? ""}`}>
              <CountUp to={k.value} />{k.suffix}
            </div>
            <div className="kpi-delta">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map(tab => (
          <Link
            key={tab.key}
            href={tab.key === "todas" ? "/compras/conciliacion" : `/compras/conciliacion?status=${tab.key}`}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              status === tab.key
                ? "bg-[var(--fg-brand)]/10 text-[var(--fg-brand)]"
                : "text-fg-muted hover:text-fg-primary hover:bg-[var(--bg-surface-alt)]"
            }`}
          >
            {tab.label}
            {tab.key !== "todas" && (counts[tab.key as ReconStatus] ?? 0) > 0 && (
              <span className="ml-1.5 badge badge-muted text-xs">
                {counts[tab.key as ReconStatus]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Tabla */}
      {rows.length === 0 ? (
        <div className="nx-surface rounded-xl p-12 text-center text-fg-muted">
          <div className="text-4xl mb-3">🔗</div>
          <p className="font-medium">No hay conciliaciones en esta vista.</p>
          <p className="text-sm mt-1">
            Iniciá una desde el detalle de una OC o Factura de proveedor.
          </p>
        </div>
      ) : (
        <div className="nx-surface rounded-xl overflow-hidden">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>OC</th>
                <th>Factura</th>
                <th>Score</th>
                <th>Estado</th>
                <th>Difs.</th>
                <th>Pago</th>
                <th>Fecha</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="font-mono text-sm">{r.po_public_id}</td>
                  <td className="font-mono text-sm">{r.invoice_public_id}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <div
                        className="h-1.5 rounded-full bg-[var(--stroke-soft)] w-12 overflow-hidden"
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${r.score}%`,
                            background: r.score === 100
                              ? "var(--status-success)"
                              : r.score >= 90
                              ? "var(--status-warning)"
                              : "var(--status-danger)",
                          }}
                        />
                      </div>
                      <span className="text-xs font-semibold tabular">{r.score}%</span>
                    </div>
                  </td>
                  <td><ReconStatusBadge status={r.status} /></td>
                  <td>
                    {r.n_diffs > 0 ? (
                      <span className={`text-xs font-medium ${r.n_pending_diffs > 0 ? "text-[var(--status-danger)]" : "text-fg-muted"}`}>
                        {r.n_diffs} total · {r.n_pending_diffs} pend.
                      </span>
                    ) : (
                      <span className="text-xs text-fg-muted">Sin difs.</span>
                    )}
                  </td>
                  <td>
                    <span className={`text-xs font-semibold ${r.listo_para_pago ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"}`}>
                      {r.listo_para_pago ? "Habilitado" : "Bloqueado"}
                    </span>
                  </td>
                  <td className="text-fg-muted text-xs">{fmtDate(r.initiated_at)}</td>
                  <td>
                    <Link
                      href={`/compras/conciliacion/${r.id}`}
                      className="btn btn-ghost btn-sm text-xs"
                    >
                      Ver <Icon name="arrow-right" size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/compras/conciliacion/page.tsx
git commit -m "feat(recon): dashboard de conciliación con KPIs y tabla filtrable por estado"
```

---

## Task 10: Integración en Navegación y Módulos Existentes

**Files:**
- Modify: `src/app/(app)/compras/ordenes/[publicId]/OrderDetailTabs.tsx`
- Modify: `src/app/(app)/compras/facturas/page.tsx` (indicador recon)
- Modify: `src/app/(app)/compras/page.tsx` (KPI % conciliadas)

**Interfaces:**
- Consumes: `getRecon`, `ReconStatusBadge`, `listRecons`

- [ ] **Step 1: Agregar tab Conciliación en OrderDetailTabs**

Localizar el array de tabs en `OrderDetailTabs.tsx` y agregar el nuevo tab. Primero leer el archivo:

```bash
cat /Users/martinbattaglia/CODE/tops-ordenes/src/app/\(app\)/compras/ordenes/\[publicId\]/OrderDetailTabs.tsx | head -40
```

Agregar en la lista de tabs existente:

```typescript
// Agregar a la lista de tabs en OrderDetailTabs.tsx:
{ key: "conciliacion", label: "Conciliación", icon: "git-merge" }
```

Y en el contenido del tab (panel condicional):

```typescript
// Dentro del switch/render de tabs, agregar:
{activeTab === "conciliacion" && (
  <div className="p-4">
    {/* Link a la página completa de conciliación */}
    <Link
      href={`/compras/conciliacion/${order.id}`}
      className="btn btn-primary btn-sm"
    >
      <Icon name="git-merge" size={14} />
      Abrir módulo de conciliación
    </Link>
    {/* Estado rápido */}
    {order.status === "conciliada" && (
      <div className="mt-4 badge badge-success">OC conciliada</div>
    )}
  </div>
)}
```

- [ ] **Step 2: Agregar botón "Conciliar" en facturas/page.tsx**

En la tabla de facturas, agregar en cada fila un link que inicia la conciliación:

```typescript
// En cada <tr> de facturas/page.tsx, agregar columna:
<td>
  <Link
    href={`/compras/conciliacion?invoice=${row.id}`}
    className="btn btn-ghost btn-sm text-xs"
  >
    Conciliar
  </Link>
</td>
```

Y agregar el encabezado `<th>Conciliación</th>` en el `<thead>`.

- [ ] **Step 3: Agregar KPI en dashboard compras (page.tsx)**

En `src/app/(app)/compras/page.tsx`, agregar junto a los KPIs existentes:

```typescript
// Agregar import:
import { listRecons } from "@/lib/recon/data";

// En la carga de datos (dentro de la función):
let reconResult = { counts: {} as Record<string, number>, total: 0 };
try {
  reconResult = await listRecons({ pageSize: 1 });
} catch {}

const reconPct = reconResult.total > 0
  ? Math.round(((reconResult.counts["conciliada"] ?? 0) + (reconResult.counts["con_diferencias"] ?? 0)) / reconResult.total * 100)
  : 0;

// En los KPIs del dashboard:
<Link href="/compras/conciliacion" className="kpi nx-surface rounded-xl p-4 hover:ring-1 hover:ring-[var(--fg-brand)]/30 transition-all">
  <div className="kpi-label">% Conciliadas</div>
  <div className="kpi-value text-[var(--status-success)]">{reconPct}%</div>
  <div className="kpi-delta">de OC conciliadas</div>
</Link>
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/compras/
git commit -m "feat(recon): integración en nav (tabs OC, botón facturas, KPI dashboard)"
```

---

## Task 11: Aplicar Migraciones a Producción

**Files:** sólo comandos — sin cambios de código

> **PRECAUCIÓN:** prod `arsksytgdnzukbmfgkju` es PRODUCCIÓN. Confirmar con Martín antes de ejecutar.

- [ ] **Step 1: Verificar las 3 migraciones están listas**

```bash
ls /Users/martinbattaglia/CODE/tops-ordenes/supabase/migrations/009{7,8,9}*.sql
```

Esperado: 3 archivos listados.

- [ ] **Step 2: Aplicar a prod via supabase CLI**

```bash
cd /Users/martinbattaglia/CODE/tops-ordenes
supabase db push --db-url "postgresql://postgres.arsksytgdnzukbmfgkju:@db.arsksytgdnzukbmfgkju.supabase.co:5432/postgres"
```

Confirmar que las 3 migraciones aparecen como `Applying migration`.

- [ ] **Step 3: Verificar en prod que las tablas existen**

Ejecutar via MCP o SQL Editor de Supabase:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('po_reconciliations','po_reconciliation_diffs','recon_events');
```

Esperado: 3 filas.

- [ ] **Step 4: Commit de confirmación**

```bash
git add supabase/migrations/
git commit -m "chore(recon): migraciones 0097-0099 aplicadas a prod arsksytgdnzukbmfgkju"
```

---

## Task 12: TypeCheck + Build Verde

**Files:** sin cambios — sólo verificación

- [ ] **Step 1: Correr TypeCheck**

```bash
cd /Users/martinbattaglia/CODE/tops-ordenes
npx tsc --noEmit 2>&1
```

Esperado: 0 errores. Si hay errores de tipo, corregirlos antes de continuar.

- [ ] **Step 2: Correr Build**

```bash
npm run build 2>&1
```

Esperado: `✓ Compiled successfully` y sin errores en las rutas nuevas.

- [ ] **Step 3: Verificar rutas en dev**

```bash
npm run dev &
# Esperar arranque (~5s), luego:
curl -s http://localhost:3000/compras/conciliacion | grep -c "Conciliación"
```

Esperado: al menos 1 match.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "feat(recon): módulo completo de Conciliación de OC — typecheck y build verdes"
```

---

## Self-Review

### Spec coverage

| Requerimiento del prompt | Tarea que lo implementa |
|--------------------------|------------------------|
| Estados de conciliación (pendiente/parcial/conciliada/con_difs/rechazada) | Task 1 (enum `recon_status_t`) |
| Flujo completo OC→proveedor→factura→conciliación→pago | Task 2 (RPCs) + Task 5 (data layer) |
| Comparación automática de 15+ campos | Task 4 (`computeRecon`) |
| Motor de diferencias con tipos (precio/cantidad/IVA/duplicada/etc.) | Task 4 (`diff-engine.ts`) |
| Score de conciliación 0–100 | Task 4 (`SEVERITY_WEIGHT`) |
| UI side-by-side con 2 columnas + colores | Task 8 (`ReconDetail`, `DiffRow`) |
| Botones (aprobar/rechazar/nota/revisión/aceptar dif) | Task 7 (`ReconActions`), Task 8 |
| Historial auditado append-only | Task 1 (`recon_events`) + Task 7 (`ReconTimeline`) |
| Integración con Facturas / OC / Tesorería | Task 10 + flag `listo_para_pago` en vista |
| Bloqueo de pago hasta conciliación aprobada | Task 3 (`listo_para_pago` en `v_recon_status`) |
| Dashboard con KPIs | Task 9 (dashboard page) + Task 10 (KPI en /compras) |
| Deep links navegables | `Link` en todas las filas de tabla |
| UX/UI dark mode glassmorphism | clases nx-surface/badge/kpi a lo largo |
| IA/OCR (propuesta) | Futura integración con `invoice-storage.ts` y OCR existente vía `ocr-map.ts` |

### Placeholder scan

✅ Ninguna función sin código completo.
✅ Ningún "TBD" o "TODO" en el código de producción.

### Type consistency

- `ReconRecord.diffs` → `ReconDiffRecord[]` (Task 4 tipos → Task 5 data → Task 8 ReconDetail)
- `computeRecon(po: POForRecon, inv: InvoiceForRecon)` → referenciado en `startRecon()` (Task 5) con el mismo shape
- `fmtDate` / `fmtCurrency` importados de `@/lib/utils` (patrón existente en todo el proyecto)
- `getSupplierInvoice(id)` agregada en Task 8 step 4 — referenciada en el mismo archivo
- Todos los enums (`recon_status_t`, `recon_diff_field_t`) coinciden entre SQL (Task 1) y TS (Task 4)

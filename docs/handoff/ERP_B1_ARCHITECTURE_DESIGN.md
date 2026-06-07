# ERP_B1_ARCHITECTURE_DESIGN

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fase:** ERP-B1 · Fundación de Datos AP (Cuentas a Pagar / IVA Compras)
**Fecha:** 2026-06-07
**Naturaleza:** DISEÑO TÉCNICO ÚNICAMENTE. No se escribió migración, ni código, ni se modificó producción, ni se tocó ERP-A.
**Insumos:** `docs/handoff/ERP_B_AUDIT_REPORT.md` (auditoría aprobada) + lectura directa de `0011_arca_billing.sql`, `0053_treasury_core.sql`, `0054_treasury_functions.sql` (convenciones reales del proyecto) + producción `arsksytgdnzukbmfgkju`.

**Principios heredados (NO se inventan — se reutilizan de ERP-A):**
- **RPC-First**: toda escritura financiera pasa por funciones `security definer` con `has_permission(...)` + `set_config('treasury.via_rpc'/'ap.via_rpc','on')` (`0054:166-169`).
- **Append-only**: prohibido DELETE en registros financieros (`tg_forbid_delete_financial`, `0053:77-83`); transiciones solo confirmadas con lock `FOR UPDATE`.
- **Saldos derivados (D1/D5)**: los saldos y cuentas corrientes son **vistas `security_invoker`**, nunca tablas (`0054:380-419`).
- **Precisión fiscal**: `numeric(15,2)` en el lado fiscal (`0011:168-174`, `0053` C8).
- **AFIP alícuota id**: `alic_iva_id smallint` → 3=0%, 4=10.5%, 5=21%, 6=27%, 8=5%, 9=2.5% (`0011:220-221`).
- **`public_id`** por trigger (`FP-YYYY-NNNN`, `0014:82-97`).
- **RLS ≤ RBAC**: lectura roles internos, escritura fina vía `has_permission` en RPC (`0053` C5/C6).

---

## 1 · MODELO DE DATOS

### 1.1 Decisión central (resuelve P0-2, P0-3, P1)

> **El detalle fiscal por alícuota es la FUENTE DE VERDAD. La cabecera `supplier_invoices` pasa a ser una caché reconciliada de totales, NO la fuente del IVA.**

Esto elimina la ambigüedad: Neto Gravado, IVA y Total siempre se derivan agrupando el detalle. El Libro IVA Compras y el crédito fiscal salen directos del detalle, sin recálculo dudoso.

### 1.2 Tablas nuevas (todas aditivas, no tocan ERP-A)

**(a) `supplier_invoice_vat_lines`** — subtotales de IVA por alícuota *(CANÓNICA para crédito fiscal)*
| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid PK | |
| `supplier_invoice_id` | uuid FK → supplier_invoices(id) **on delete cascade** | |
| `alic_iva_id` | smallint NOT NULL | AFIP 3/4/5/6/8/9 |
| `alicuota_iva` | numeric(5,2) NOT NULL | 0/2.5/5/10.5/21/27 — debe corresponder a `alic_iva_id` (CHECK) |
| `base_neto` | numeric(15,2) NOT NULL | neto gravado a esa alícuota |
| `importe_iva` | numeric(15,2) NOT NULL | `≈ base_neto * alicuota/100` (CHECK tolerancia ±0.02) |
| **UNIQUE** | (supplier_invoice_id, alic_iva_id) | una fila por alícuota presente |

**(b) `supplier_invoice_other_taxes`** — percepciones / IIBB / IVA percepción / impuestos internos *(CANÓNICA para columnas de percepción)*
| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid PK | |
| `supplier_invoice_id` | uuid FK → supplier_invoices(id) **on delete cascade** | |
| `tax_kind` | `ap_other_tax_t` (enum nuevo) | ver §5 |
| `jurisdiction` | text NULL | obligatorio si `tax_kind='PERCEPCION_IIBB'` (provincia) |
| `base` | numeric(15,2) NOT NULL default 0 | |
| `alicuota` | numeric(7,4) NULL | opcional |
| `importe` | numeric(15,2) NOT NULL | monto del tributo |

**(c) `supplier_invoice_items`** — renglones descriptivos *(OPCIONAL, best-effort de OCR; no fiscal)*
| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | espejo de `invoice_items` (`0011:212-226`) |
| `supplier_invoice_id` | uuid FK on delete cascade | |
| `descripcion` | text NOT NULL | |
| `cantidad` | numeric(12,2) | |
| `precio_unitario` | numeric(15,2) | |
| `alic_iva_id` | smallint | enlaza el renglón a su alícuota |
| `importe_neto` / `importe_iva` / `importe_total` | numeric(15,2) | |
| `orden` | int | |

> Los renglones (c) son descriptivos; la verdad fiscal vive en (a)+(b). Si OCR no logra renglones limpios, (c) queda vacía sin romper nada.

### 1.3 Cambios a `supplier_invoices` (cabecera — caché reconciliada)

Aditivos (widening de `numeric` es seguro; columnas nuevas con default):
- Ampliar a desglose fiscal completo (hoy faltan): `importe_no_gravado numeric(15,2) default 0`, `importe_exento numeric(15,2) default 0`, `tributos numeric(15,2) default 0` (impuestos internos), y renombrar conceptualmente `neto`→**neto gravado**.
- Alinear precisión a `numeric(15,2)` (hoy `14,2`, `0014:64-67`) — widening seguro.
- `periodo text` (YYYY-MM) para Libro IVA (derivable de `fecha_emision`, pero materializarlo facilita el cierre de período).
- **Identidad canónica (CHECK / reconciliada por RPC):**
  ```
  total = neto_gravado + importe_no_gravado + importe_exento + iva + percepciones + tributos
  neto_gravado = Σ vat_lines.base_neto
  iva          = Σ vat_lines.importe_iva
  percepciones + tributos = Σ other_taxes.importe (segmentado por tax_kind)
  ```

### 1.4 Estado: separación de dimensiones (resuelve P1 — sin tocar ERP-A)

> **Dos dimensiones independientes, nunca mezcladas:**
> 1. **`status` (aprobación)** — PERSISTIDA, transicionada por RPCs de workflow AP. Dimensión documental.
> 2. **`estado_pago` (pago)** — DERIVADA en la vista `supplier_open_items` (ya existe en ERP-A, `0054:385-390`). Dimensión financiera.

El "double truth" desaparece por **semántica**: `status` deja de significar "pagada". El pago se lee SIEMPRE de la vista. **No se modifica `supplier_open_items` ni la RPC de tesorería** (ERP-A intacto): la vista ya computa `estado_pago` desde `payment_allocations` confirmadas usando `si.total` (que sigue siendo la caché canónica).

---

## 2 · ERD

```
                         ┌──────────────────────────┐
                         │ vendors (existe)         │
                         └────────────┬─────────────┘
                                      │ 1
                                      │ N
        ┌─────────────────────────────────────────────────────┐
        │ supplier_invoices  (CABECERA = caché reconciliada)   │
        │  id, public_id(FP-YYYY-NNNN), vendor_id,             │
        │  cost_center_id, purchase_order_id,                  │
        │  tipo_comprobante, punto_venta, numero, cae,         │
        │  fecha_emision, fecha_vencimiento, periodo, moneda,  │
        │  neto_gravado, no_gravado, exento, iva,              │
        │  percepciones, tributos, total,                      │
        │  status (APROBACIÓN), observ, pdf_url, created_*     │
        └───┬───────────────┬───────────────┬─────────────────┘
            │1              │1              │1
            │N              │N              │N
   ┌────────▼───────┐ ┌─────▼──────────┐ ┌─▼────────────────────┐
   │ vat_lines      │ │ other_taxes    │ │ items (opcional)     │
   │ alic_iva_id    │ │ tax_kind       │ │ descripcion          │
   │ alicuota_iva   │ │ jurisdiction   │ │ alic_iva_id          │
   │ base_neto      │ │ base, alicuota │ │ importe_neto/iva/tot │
   │ importe_iva    │ │ importe        │ └──────────────────────┘
   │ UQ(inv,alic)   │ └────────────────┘
   └────────────────┘   (CANÓNICAS: Neto/IVA/Percepciones)

   ── Integración Tesorería (ERP-A, SIN CAMBIOS) ──
   supplier_invoices.id ──1───N── payment_allocations.supplier_invoice_id
   payment_allocations.payment_id ──N───1── supplier_payments
   VIEW supplier_open_items   = si.total − Σ allocations(confirmado) → estado_pago
   VIEW supplier_current_account, treasury_cashflow_projection (derivadas)

   ── Derivado nuevo (B4, additive) ──
   VIEW libro_iva_compras = vat_lines ⋈ supplier_invoices  GROUP BY periodo, alic_iva_id
   VIEW supplier_ap_status = supplier_invoices ⋈ supplier_open_items (status × estado_pago)
```

---

## 3 · WORKFLOW AP (definitivo — "alternativa superior")

La fase ERP-B pedía estados `cargada / revisión / aprobada / pendiente_pago / pagada / anulada`. **`pendiente_pago` y `pagada` NO son estados de aprobación: son combinaciones de (aprobación × pago).** Modelarlos como `status` recrearía el double-truth. Diseño superior:

### 3.1 `status` (enum de APROBACIÓN, persistido)
```
cargada      -- alta confirmada (OCR + humano). Estado inicial.
en_revision  -- enviada a validación contable
aprobada     -- aprobada para pago
anulada      -- baja lógica (append-only; no DELETE)
```
Transiciones (RPCs append-only con lock `FOR UPDATE` + `has_permission`):
```
cargada ──ap_submit_for_review──▶ en_revision ──ap_approve──▶ aprobada
   │                                  │                          │
   └──────────── ap_void ────────────┴──────────────────────────┘ ▶ anulada
(reabrir: aprobada ──ap_reopen──▶ en_revision, solo admin, auditado)
```

### 3.2 `estado_pago` (DERIVADO en vista, NO persistido) — ya existe en ERP-A
```
pendiente · parcial · pagada · vencida   (0054:385-390)
```

### 3.3 Los 6 estados pedidos, derivados sin ambigüedad (vista `supplier_ap_status`)
| Estado operativo pedido | Derivación |
|---|---|
| cargada | `status='cargada'` |
| revisión | `status='en_revision'` |
| aprobada | `status='aprobada'` AND `estado_pago='pendiente'` |
| **pendiente_pago** | `status='aprobada'` AND `estado_pago IN ('pendiente','parcial')` |
| **pagada** | `estado_pago='pagada'` (independiente de aprobación) |
| anulada | `status='anulada'` |

> Ventaja: nunca hay que "sincronizar" dos columnas. El pago manda en la vista; la aprobación manda en `status`. Imposible que se contradigan.

### 3.4 Compatibilidad con datos existentes
4 facturas en prod tienen `status='pendiente'` (enum viejo `pendiente|conciliada|aprobada|pagada|anulada`). Plan: el enum nuevo agrega `cargada`/`en_revision`; `pendiente`→`cargada` (migración de datos), y `conciliada`/`pagada` quedan **deprecadas** en el flujo (Postgres no elimina valores de enum fácilmente; se documentan como no usadas). Sin pérdida de datos.

---

## 4 · MULTI-ALÍCUOTA

- **Modelo:** una fila en `supplier_invoice_vat_lines` por cada alícuota presente en el comprobante (UNIQUE por `(invoice, alic_iva_id)`).
- **Derivaciones inmediatas:**
  - Neto Gravado total = `Σ base_neto`.
  - IVA Pagado total = `Σ importe_iva`.
  - Crédito fiscal por alícuota = `GROUP BY alic_iva_id`.
- **CHECK por fila:** `abs(importe_iva − base_neto*alicuota/100) ≤ 0.02` (tolerancia de redondeo AFIP).
- **CHECK de reconciliación** (en RPC de alta): `supplier_invoices.neto_gravado = Σ vat_lines.base_neto` y `supplier_invoices.iva = Σ vat_lines.importe_iva`.
- **Catálogo de alícuotas** (`alic_iva_id`): tabla de referencia opcional o CHECK enumerado `(3,4,5,6,8,9)` ↔ `(0,10.5,21,27,5,2.5)` — espejo de `0011:220-221`.

---

## 5 · PERCEPCIONES

Enum nuevo `ap_other_tax_t`:
```
PERCEPCION_IVA        -- percepción de IVA (RG 2408 etc.)
PERCEPCION_IIBB       -- ingresos brutos (requiere jurisdiction = provincia)
PERCEPCION_GANANCIAS  -- retención/percepción de ganancias
IMPUESTO_INTERNO      -- impuestos internos
OTRO
```
- Cada percepción = una fila en `supplier_invoice_other_taxes` con `tax_kind`, `jurisdiction?`, `base`, `alicuota?`, `importe`.
- **Mapeo a cabecera (caché):**
  - `percepciones` = `Σ importe WHERE tax_kind LIKE 'PERCEPCION_%'`
  - `tributos` = `Σ importe WHERE tax_kind IN ('IMPUESTO_INTERNO','OTRO')`
- **IIBB multi-jurisdicción:** soportado vía múltiples filas con distinta `jurisdiction`.
- Resuelve el gap P1-2 (hoy las percepciones son un único campo *lump*, `ocr-map.ts:229-230`).

---

## 6 · INTEGRACIÓN TESORERÍA

> **Regla: ERP-B1 NO modifica ERP-A.** La integración ya funciona y está probada en prod (pago $100 → `FP-2026-0002` → `estado_pago=parcial`).

- `payment_allocations.supplier_invoice_id` y `supplier_payments` **no cambian** — referencian `supplier_invoices.id` y operan sobre `si.total`.
- `tesoreria_register_payment` (`0054:144-229`) **no cambia**: valida saldo = `si.total − Σ allocations(confirmado)`, con lock `FOR UPDATE` (`0054:192-209`). Como `total` sigue siendo la caché canónica reconciliada con el detalle, el cálculo de saldo permanece correcto.
- `supplier_open_items` (`0054:380-395`) y `supplier_current_account` (`0054:410-419`) **no cambian**.
- **Único punto de contacto nuevo (aditivo):** una guarda de negocio recomendada — permitir pagos solo si `status IN ('aprobada')`. Se implementa **dentro del flujo AP/UI**, no en la RPC de tesorería, para no tocar ERP-A (o como validación opcional futura previa acuerdo). Por defecto, B1 NO añade esa restricción a la RPC existente.
- **Invariante de no-pago-sobre-detalle-inconsistente:** la RPC de alta AP garantiza que `total` ya está reconciliado antes de que exista cualquier allocation.

---

## 7 · IMPACTO SOBRE OCR

- **Contrato de extracción ampliado** (lo implementa B3; B1 define la forma): el OCR debe poblar `vat_lines[]` (array de `{alic_iva_id, alicuota, base_neto, importe_iva}`) y `other_taxes[]` (`{tax_kind, jurisdiction?, base, importe}`), además de la cabecera.
- **Camino de alta RPC-First nuevo:** `ap_create_supplier_invoice(p_header jsonb, p_vat_lines jsonb, p_other_taxes jsonb, p_items jsonb)` — inserta cabecera + detalle atómicamente, reconcilia totales y **valida la identidad financiera (bloqueante)**. Reemplaza el `insert` suelto de `actions.ts:47-68` por una RPC (alinea con ERP-A).
- **Degradación elegante:** si OCR detecta una sola alícuota, genera 1 `vat_line`; si no detecta percepciones, `other_taxes` vacío. El humano confirma/edita antes de persistir (se mantiene el modo "IA llena, humano confirma", `0015` cabecera).
- **Validación dura** (resuelve P1-3): la RPC rechaza el alta si `total ≠ neto_gravado+no_gravado+exento+iva+percepciones+tributos` o si `Σ vat_lines` no reconcilia. Hoy es solo un badge de confianza (`ocr-map.ts:240-250`).

---

## 8 · IMPACTO SOBRE IVA COMPRAS

- **Vista nueva `libro_iva_compras`** (B4, aditiva, `security_invoker`):
  ```sql
  -- DERIVACIÓN sin ambigüedad: agrupa el detalle canónico
  select si.periodo, vl.alic_iva_id, vl.alicuota_iva,
         sum(vl.base_neto)   as neto_gravado,
         sum(vl.importe_iva) as iva_credito_fiscal,
         sum(vl.base_neto + vl.importe_iva) as total_gravado
  from supplier_invoices si
  join supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.status <> 'anulada'
  group by si.periodo, vl.alic_iva_id, vl.alicuota_iva;
  ```
- **Crédito fiscal** = `Σ importe_iva` del período (por alícuota, derivado).
- **Percepciones del libro** = join a `supplier_invoice_other_taxes` agrupado por `tax_kind`/jurisdicción.
- **Regla financiera obligatoria cumplida**: todo reporte deriva Neto Gravado, IVA Pagado y Total del MISMO detalle canónico, sin recálculos paralelos. Habilita el **export al contador** (B5) y cierre de período.

---

## 9 · RIESGOS

### P0 — Bloqueantes si se ignoran en el diseño
| # | Riesgo | Mitigación en diseño |
|---|---|---|
| P0-1 | Romper ERP-A al alterar `supplier_invoices` (FK de allocations, vista `supplier_open_items`, RPC de pago) | Todo cambio es **aditivo** (columnas nuevas con default, widening de numeric); `total` se mantiene como caché canónica; vistas/RPC de ERP-A intactas. |
| P0-2 | Doble verdad de IVA si cabecera y detalle divergen | Detalle = fuente de verdad; cabecera reconciliada por RPC + CHECK; reportes derivan del detalle. |
| P0-3 | Migración de enum `status` (Postgres no borra valores) | Agregar `cargada`/`en_revision`; migrar datos `pendiente→cargada`; deprecar `conciliada`/`pagada` documentado. |

### P1 — Operación/compliance
| # | Riesgo | Mitigación |
|---|---|---|
| P1-1 | Redondeo IVA (alícuota·base ≠ importe) | CHECK con tolerancia ±0.02 por línea; reconciliación de cabecera. |
| P1-2 | Pago sobre factura no aprobada | Guarda de negocio en flujo AP/UI (no en RPC de tesorería para no tocar ERP-A). |
| P1-3 | IIBB multi-jurisdicción mal modelado | `jurisdiction` obligatorio en `PERCEPCION_IIBB`; múltiples filas. |

### P2 — Robustez
| # | Riesgo | Mitigación |
|---|---|---|
| P2-1 | Falta RBAC fino de AP | Módulo de permisos nuevo `compras_ap`: `facturas.create/review/approve/void/export` (B2). |
| P2-2 | Edición de factura ya con pagos imputados | Bloquear edición de importes si existen allocations confirmadas (lock + CHECK en RPC). |
| P2-3 | Sin tests | Suite de RPC (alta, reconciliación, workflow, libro IVA) en B6. |

### P3 — Incremental
| # | Riesgo | Mitigación |
|---|---|---|
| P3-1 | OCR no llena multi-alícuota desde el día 1 | Degradación a 1 alícuota; humano completa; mejora iterativa (B3). |
| P3-2 | Precisión `14,2` vs `15,2` heterogénea | Widening a `15,2` en B1 (seguro). |

---

## 10 · VEREDICTO

# ✅ READY FOR ERP-B1 IMPLEMENTATION

**Fundamentos:**
1. El diseño es **100% aditivo sobre ERP-A** y producción: nuevas tablas de detalle, widening seguro de cabecera, y **cero cambios** a `payment_allocations`, `supplier_payments`, `tesoreria_register_payment`, `supplier_open_items` (integración de tesorería ya probada en prod, intacta).
2. Resuelve los 3 P0 de la auditoría: multi-alícuota (vat_lines), Libro IVA Compras (vista derivada del detalle), y workflow AP (enum de aprobación + RPCs append-only).
3. Resuelve el P1 de double-truth por **separación de dimensiones** (aprobación persistida vs pago derivado), sin sincronización frágil y sin tocar la vista de ERP-A.
4. Cumple la regla financiera obligatoria: Neto Gravado, IVA Pagado y Total se derivan del MISMO detalle canónico, sin cálculos ambiguos.
5. Respeta todas las convenciones del proyecto (RPC-First, append-only, D1/D5 derivado, numeric fiscal, AFIP alic_iva_id, public_id, RLS≤RBAC).

**Secuencia de implementación sugerida (cuando se autorice):**
`0056` detalle AP (vat_lines + other_taxes + items + cabecera ampliada + enums) → `0057` permisos `compras_ap` → `0058` RPCs (`ap_create_supplier_invoice` + workflow) → `0059` vistas `libro_iva_compras` + `supplier_ap_status` → backend/UI → B3 OCR multi-alícuota → B5 export contador → B6 tests.

> Restricción cumplida: solo diseño técnico. No se escribió migración, ni código, ni se modificó producción, ni se tocó ERP-A.

# ERP_B_AUDIT_REPORT

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-07
**Alcance:** Auditoría diagnóstica de ERP-B (OCR + Facturas de proveedor + Cuentas a pagar + IVA compras + Workflow de aprobación + Integración Tesorería).
**Naturaleza:** SOLO DIAGNÓSTICO. No se escribió código, ni migraciones, ni se modificó producción, ni se tocó ERP-A.
**Fuentes de evidencia:**
1. **Producción `arsksytgdnzukbmfgkju`** (única fuente de verdad) — consultada vía REST/PostgREST con service-role (read-only): schema OpenAPI, columnas, enums, conteos de filas y datos reales.
2. **Migraciones** en `supabase/migrations/` (leídas directamente).
3. **Código** de la rama `main` @ `798e158` (3 exploraciones independientes con cita `archivo:línea`).

> Regla metodológica: cada afirmación está respaldada por evidencia. Donde algo no existe, se declara **NO EXISTE** explícitamente.

---

## 1 · MAPA ACTUAL

### 1.1 Estado del repositorio
- `main` = `origin/main` = `798e158` (ERP-A Tesorería). **No hay trabajo ERP-B reciente**: los últimos 60 commits no contienen OCR/factura/IVA más allá de ERP-A. El núcleo de ERP-B (tabla AP + OCR) es **anterior** a ERP-A.

### 1.2 Migraciones relevantes a ERP-B
| Migración | Contenido | Estado en prod |
|---|---|---|
| `0008_purchase_orders.sql` | Órdenes de compra (OC) | Aplicada |
| `0011_arca_billing.sql` | Facturación de **ventas** ARCA (`customer_invoices`, `invoice_items`) | Aplicada |
| `0013_invoices_storage_isolation.sql` | Aislamiento de storage de facturas | Aplicada |
| `0014_supplier_invoices.sql` | **Facturas de proveedor (AP)** + centros de costo | **Aplicada** (tabla presente en prod) |
| `0015_supplier_invoice_attachments.sql` | **Solo** bucket `supplier-invoices` + policies (NO crea tabla) | Bucket **presente** en prod (aplicado manualmente) |

> No existe migración `0012`. No existe migración de Libro IVA / GL (en `docs/erp-arquitectura-objetivo.md:393` se la proyecta como `0016`, inexistente; la última migración real es `0055`).

### 1.3 Datos reales en producción (conteos exactos)
| Tabla / Vista | Filas | Observación |
|---|---|---|
| `supplier_invoices` | **4** | Las 4 en estado `pendiente` |
| `invoice_items` | 10 | **Pertenecen a VENTAS** (FK → `customer_invoices`, `0011_arca_billing.sql:214`). **NO hay renglones de facturas de proveedor.** |
| `invoice_audit` | 4 | Auditoría de emisión ARCA (lado ventas) |
| `supplier_payments` | **1** | `PAG-2026-000005`, $100, `confirmado` |
| `payment_allocations` | **1** | $100 → factura `FP-2026-0002` |
| `bank_accounts` | 3 | CAJA, Santander, Galicia (ERP-A) |
| `customer_invoices` | 2 | Ventas ARCA |
| `vendors` | 13 | Proveedores |
| `purchase_orders` | 8 | OC |
| `supplier-invoices` (bucket) | — | Presente, privado |

### 1.4 Circuito objetivo vs. realidad
```
Factura proveedor → OCR → Validación → Aprobación → Pendiente de pago → Tesorería → Pagada → IVA Compras → Reporte Contable
     [OK]          [OK]    [PARCIAL]   [NO EXISTE]    [DERIVADO]        [OK]      [DERIV]  [NO EXISTE]  [NO EXISTE]
```

---

## 2 · OCR

**Motor:** LLM hospedado — **OpenAI Chat Completions, modelo `gpt-4o-mini`** (override por `OPENAI_OCR_MODEL`), vía `fetch` a `https://api.openai.com/v1/chat/completions` (`src/lib/ocr/openai.ts:28,43-45,111`). PDFs con capa de texto → scrape local con `pdf-parse`/`pdfjs-dist` (`openai.ts:155-159`); PDFs escaneados/imágenes → **GPT-4o Vision** (`openai.ts:166,235-257`). Env `OPENAI_API_KEY` y `OPENAI_OCR_MODEL` configurados.

**Transporte:** `POST /api/documental/ocr` con auth + rate-limit; **no persiste nada** (`src/app/api/documental/ocr/route.ts:18-20`).

**Modelo de extracción → mapeo:** `src/lib/erp/ocr-map.ts` mapea a cabecera de factura: `tipo_comprobante` (`:102`), `punto_venta`/`numero` (`:159`), `cae` (`:200`), `fecha` (`:343`), `vendor` por CUIT mod-11 + razón social (`:269-309`), `neto`/`iva`/`percepciones` (`:220`).

**Limitaciones críticas (evidencia):**
- **Solo cabecera.** No mapea renglones; `doc.lineItems` se ignora en `mapOcrToInvoice` (`ocr-map.ts:220-267`).
- **Múltiples alícuotas: NO.** No produce desglose por alícuota; no hay `alic_iva_id` en el flujo de compras.
- **Percepciones: lump.** = suma de todos los `amounts.kind === "otro"` en un único número (`ocr-map.ts:229-230`); sin desglose por tipo (IVA/IIBB/Ganancias).
- **Validación pre-commit: blanda.** Chequeo `|neto+iva+percep − total| ≤ max(1, total·1%)` usado **solo para colorear un badge de confianza**, no bloquea (`ocr-map.ts:240-250`). Modo "IA llena, humano confirma": nada se guarda hasta confirmación manual (`NuevaFacturaForm.tsx:357`).
- **Tests OCR: NO EXISTEN** (sin runner ni archivos `*.test/*.spec`).

---

## 3 · FACTURAS DE PROVEEDOR

**Tabla `supplier_invoices`** (`0014_supplier_invoices.sql:50-75`, confirmada en prod): cabecera plana con `neto, iva, percepciones, total` (numeric 14,2), `tipo_comprobante` (enum 11 valores), `punto_venta`, `numero`, `cae`, `vendor_id`, `cost_center_id`, `purchase_order_id`, `status`, `pdf_url`. Unicidad `(vendor, tipo, pv, numero)` (`:74`). **Sin tabla de renglones.** **Sin CHECK de totales.**

**Path de alta (funciona):** `createSupplierInvoiceAction` (`src/app/(app)/compras/facturas/nueva/actions.ts:23`) inserta cabecera (`:47-68`), con `total` **calculado server-side** = `neto+iva+percepciones` (`:31-32`). Adjunto best-effort del original a `pdf_url` (`ocr-actions.ts:38-92`).

**UI:**
- `/compras/facturas` — listado "Cuentas por pagar", **solo lectura** (sin botones aprobar/editar/eliminar); muestra **solo `Total`** (`compras/facturas/page.tsx:87,119-121`).
- `/compras/facturas/nueva` — alta con OCR drag-drop (`NuevaFacturaForm.tsx`).

**Validación financiera real:** Zod `CreateSupplierInvoiceSchema` valida tipos y `≥0` (`src/lib/erp/validation.ts:4-25`) pero **no** refina `Total = Neto+IVA+Perc` (el total se deriva, así que el mismatch es imposible por este path, pero **no hay invariante asegurada ni CHECK en DB**).

**Validación de datos reales en prod (las 4 facturas):**
| public_id | tipo | status | neto | iva | perc | total | N+I+P |
|---|---|---|---|---|---|---|---|
| FP-2024-0001 | FACTURA_A | pendiente | 880860.39 | 184980.68 | 0 | 1065841.07 | ✅ OK |
| FP-2026-0002 | FACTURA_A | pendiente | 69941.86 | 2998.26 | **32582.38** | 105522.50 | ✅ OK |
| FP-2026-0003 | FACTURA_B | pendiente | 100000 | 10000 | 0 | 110000 | ✅ OK |
| FP-2026-0004 | FACTURA_A | pendiente | 50000 | 10000 | 0 | 60000 | ✅ OK |

> Solo 2 de las 4 facturas tienen renglones (en ventas); las de proveedor **no tienen renglones**. Las 2 con datos usan **una sola alícuota (21%)** → el modelo multi-alícuota nunca fue ejercido.

---

## 4 · WORKFLOW DE APROBACIÓN

**Enum en prod (`supplier_invoice_status_t`):** `pendiente | conciliada | aprobada | pagada | anulada` (`0014:14-21`).

**Estados solicitados vs. enum real:**
| Solicitado | En enum |
|---|---|
| cargada | ❌ (equivale a `pendiente`) |
| revisión | ❌ NO EXISTE |
| aprobada | ✅ |
| pendiente_pago | ❌ NO EXISTE |
| pagada | ✅ (pero ver §7) |
| anulada | ✅ |

**Hallazgo crítico — NO HAY WORKFLOW:**
- **Ningún código transiciona `supplier_invoices.status`.** Búsqueda exhaustiva en `src/**` y `supabase/migrations/**`: el único `update` sobre la tabla es de `pdf_url` (`ocr-actions.ts:80-83`). Las filas nacen `pendiente` (default DB) y **quedan así para siempre** vía la app.
- **No existe acción `aprobar`/`approve`**, ni máquina de estados, ni guardas por transición.
- Único control: RLS coarse (`update` permitido a `admin|operaciones|supervisor`, `0014:126-130`) — sin granularidad por transición y **no usado por la app**.
- Los estados `conciliada`/`aprobada` que aparecen en mocks son hardcode de display (`src/lib/erp/data.ts:39,49,59`), no producidos por flujo real.

---

## 5 · CUENTAS A PAGAR

**Funciona a nivel de vistas derivadas (ERP-A):**
- `supplier_open_items` (`0054_treasury_functions.sql:380-395`): por factura → `total, pagado, saldo, estado_pago` (computado: `pagada|parcial|vencida|pendiente`).
- `supplier_current_account`: por proveedor → `facturas_abiertas, total_facturado, total_pagado, saldo_cuenta, proxima_vencimiento`.

**Evidencia real en prod** (pago $100 → FP-2026-0002):
```
FP-2026-0002  total=105522.50  pagado=100.00  saldo=105422.50  estado_pago=parcial   ✅
FP-2024-0001  total=1065841.07 pagado=0       saldo=1065841.07 estado_pago=vencida
FP-2026-0003  total=110000     pagado=0       saldo=110000     estado_pago=vencida
FP-2026-0004  total=60000      pagado=0       saldo=60000      estado_pago=pendiente
```

**Disociación de estado (P0):** la vista calcula `estado_pago=parcial`, pero `supplier_invoices.status` de esa misma factura sigue `pendiente`. **Hay dos verdades de "estado"**: (a) `status` (workflow, nunca transiciona) y (b) `estado_pago` (pago, derivado en vista). El campo persistido no refleja el pago.

**UI de AP:** no muestra desglose; `/compras/facturas` solo `Total`; `/tesoreria/pagos` muestra Total/Saldo (sin Neto ni IVA). **El triple Neto/IVA/Total junto NO se muestra en ningún listado de facturas de proveedor.**

---

## 6 · IVA COMPRAS

- **Libro IVA Compras: NO EXISTE.** Cero código, cero vista DB, cero RPC. Búsqueda de `libro_iva|iva_compras|credito_fiscal` en `src/**` y migraciones = 0 resultados. Aparece solo como roadmap futuro (`docs/ERP-ROADMAP-12-MESES.md:77`, `docs/ERP-MODULE-MAP.md:93` "❌ no existe", `docs/erp-arquitectura-objetivo.md:245`).
- **Cómputo de crédito fiscal por alícuota: IMPOSIBLE hoy.** Razón estructural: `supplier_invoices` guarda IVA solo a nivel cabecera (un único campo `iva`), **sin renglones por alícuota** para compras. La tabla `invoice_items` (con `alicuota_iva`) es exclusiva de **ventas** (`0011:212-224`, FK a `customer_invoices`).
- **Export al contador: NO EXISTE** en formato contable/IVA/AFIP. El único export de compras es un CSV de **OC** (`src/app/api/compras/export/route.ts:8-24`), no de facturas ni libro IVA.

---

## 7 · INTEGRACIÓN TESORERÍA

**Funcional (RPC-First), evidencia de código y de datos reales:**
- RPC `tesoreria_register_payment` (`0054_treasury_functions.sql:144-229`, re-emitida segura en `0055`): guard `treasury.via_rpc` + `has_permission('tesoreria.create')`; valida `sum(allocations)=p_amount`; **lock `FOR UPDATE`** sobre `supplier_invoices` (`:192`); valida factura existe/pertenece al vendor/no anulada/saldo suficiente (`:194-209`); inserta `supplier_payments` (`:211-215`) + `payment_allocations` (`:217-219`) + `treasury_movements` (`type='pago_proveedor'`, `:221-225`).
- Adaptador delgado: `src/lib/tesoreria/actions.ts:54-74`.
- Pantalla `/tesoreria/pagos` consume `listSupplierOpenItems` + `PagoForm` (`tesoreria/pagos/page.tsx:5,12-16,61`). `/tesoreria/flujo-fondos` incluye pagos a proveedor en la proyección.

**Confirmados en prod:** `supplier_payments` ✅, `payment_allocations` (con `supplier_invoice_id`) ✅, `treasury_movements` ✅, `bank_accounts` ✅.

**Brecha (P0/P1):** la RPC **nunca hace `UPDATE supplier_invoices`** — el estado "pagada" se computa en la vista, no se persiste. Un tercero leyendo `supplier_invoices.status` ve `pendiente` aunque esté pagada.

---

## 8 · MATRIZ DE GAPS

### P0 — Bloquea operación real / entregable central ERP-B faltante
| # | Gap | Evidencia |
|---|---|---|
| P0-1 | **Workflow de aprobación inexistente** — `status` nunca transiciona; circuito cargada→revisión→aprobada→pendiente_pago no operativo; estados `revisión`/`pendiente_pago` ni siquiera en el enum | §4; ningún `update status` en código |
| P0-2 | **Modelo multi-alícuota en compras inexistente** — `supplier_invoices` es solo cabecera, sin renglones por alícuota → crédito fiscal por tasa imposible | §3, §6; `0014:50-75` |
| P0-3 | **Libro IVA Compras inexistente** — entregable núcleo de ERP-B; sin código ni vista | §6 |

### P1 — Operación degradada / compliance fiscal
| # | Gap | Evidencia |
|---|---|---|
| P1-1 | **Estado de pago no persistido** — `supplier_invoices.status` desincronizado de tesorería (doble verdad) | §5, §7 |
| P1-2 | **Percepciones sin desglose por tipo** — un único campo `percepciones` (lump), sin IVA/IIBB/Ganancias | §2, §3 |
| P1-3 | **Sin enforcement de integridad financiera** — no hay CHECK en DB ni refine Zod de `Total=Neto+IVA+Perc` | `0014:64-74`; `validation.ts:4-25` |
| P1-4 | **Export al contador inexistente** | §6 |

### P2 — Robustez / control
| # | Gap | Evidencia |
|---|---|---|
| P2-1 | **Sin RBAC específico de facturas/aprobación** — depende de RLS coarse por rol | §3; `rbac/data.ts:39-44` (solo OC) |
| P2-2 | **Sin edición/anulación en app** — solo `insert`; no hay acción update/delete de facturas | §3 |
| P2-3 | **Sin tests** en todo el dominio (OCR, AP, tesorería-IVA) | repo sin runner de tests |

### P3 — Mejora incremental
| # | Gap | Evidencia |
|---|---|---|
| P3-1 | **OCR no extrae multi-alícuota ni percepciones por tipo** (depende de P0-2) | §2 |
| P3-2 | **UI no muestra el triple Neto/IVA/Total** en listados de facturas | §5 |

---

## 9 · ROADMAP ERP-B (FASES)

> Las fases respetan dependencias: el modelo de datos habilita todo lo demás.

- **Fase B1 — Fundación de datos AP** *(prerequisito de todo)*
  Migración: tabla `supplier_invoice_items` (renglones con `alicuota_iva`, `importe_neto`, `importe_iva`), tabla/campos de `percepciones` por tipo, CHECK `total = neto+iva+percepciones`, y **sincronización de `status` con pagos** (trigger o reescritura de la RPC de tesorería para persistir `pagada`/`parcial`). Resuelve P0-2, P1-1, P1-2, P1-3.

- **Fase B2 — Workflow de aprobación**
  RPCs de transición (`cargar→revisión→aprobar→pendiente_pago→pagada→anular`) append-only con auditoría; módulo de permisos `facturas`/`ap` (RBAC) y guards por transición. Resuelve P0-1, P2-1, P2-2.

- **Fase B3 — OCR avanzado**
  Extracción multi-alícuota + percepciones por tipo → renglones (`supplier_invoice_items`); validación dura `Total=Neto+IVA+Perc` pre-commit. Resuelve P3-1.

- **Fase B4 — IVA Compras**
  Vista/reporte **Libro IVA Compras** (agrupado por alícuota, crédito fiscal), con triple Neto Gravado/IVA/Total en toda tabla y reporte. Resuelve P0-3, P3-2.

- **Fase B5 — Export contador**
  Export CSV/AFIP del Libro IVA Compras y de facturas. Resuelve P1-4.

- **Fase B6 — Cierre de integración + QA**
  Conciliación factura↔OC, UI completa de cuentas a pagar, suite de tests del circuito. Resuelve P2-3.

---

## 10 · RECOMENDACIÓN EJECUTIVA

**¿Cuál es el siguiente paso con mayor retorno para ERP-B?**

> **Fase B1 — Fundación de datos AP (renglones por alícuota + percepciones por tipo + CHECK de integridad + sincronización de estado de pago).**

**Por qué es el de mayor retorno (basado en evidencia, no en supuestos):**
1. **Lo que ya funciona** no necesita rehacerse: el OCR llena la cabecera y el humano confirma (§2), el alta inserta correctamente (§3), y la **integración con Tesorería ya registra pagos con lock, validación de saldo y allocations** — probado con datos reales en prod (pago $100 → saldo correcto, §5/§7). Las 4 facturas reales cumplen `Total=Neto+IVA+Perc` (§3).
2. **El cuello de botella raíz es el modelo de datos.** Tres de los entregables centrales de ERP-B — **multi-alícuota (P0-2), Libro IVA Compras (P0-3) y crédito fiscal correcto** — son **imposibles** mientras `supplier_invoices` sea solo cabecera con un único campo `iva`. B1 desbloquea simultáneamente IVA, OCR avanzado y export contable.
3. **Corrige la falla de integridad más peligrosa en operación real**: hoy una factura pagada figura `pendiente` en su `status` (doble verdad, §5/§7). Persistir el estado en B1 elimina ese riesgo contable antes de escalar volumen.
4. **Mínimo desperdicio:** B1 es aditivo sobre la base ERP-A ya desplegada y validada; no reabre Tesorería ni rehace el OCR base.

**Quick win recomendado dentro de B1 (primer valor visible al equipo contable):** una vez existan los renglones por alícuota, exponer la **vista Libro IVA Compras** (Fase B4 anticipada como lectura) entrega de inmediato el reporte mensual que hoy se hace fuera del sistema.

---

## VEREDICTO DE READINESS

ERP-B **NO está listo para operación real**. Existe una base sólida (OCR cabecera + alta + integración de pagos funcional y probada en prod), pero faltan los tres pilares P0: **workflow de aprobación, modelo multi-alícuota y Libro IVA Compras**. El siguiente paso de mayor retorno es **Fase B1 (fundación de datos AP)**.

> Restricción cumplida: diagnóstico únicamente. No se escribió código, ni migraciones, ni se modificó producción, ni se tocó ERP-A.

# VAT-SALES-DOMAIN-DESIGN — IVA Ventas · Diseño de dominio fiscal

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** VAT-SALES-DOMAIN-DESIGN.md (entregable 6 de la serie de auditoría fiscal ERP-B → ERP-C)
**Fecha:** 2026-06-12
**Naturaleza:** DISEÑO TÉCNICO ÚNICAMENTE — no se escribió código, ni migraciones, ni se modificó producción.
**Base:** main `d1df6c1` · auditoría multi-agente sobre el código real del repo
**Fuente de verdad:** Supabase productivo `arsksytgdnzukbmfgkju` · docs previos: ERP_B_AUDIT_REPORT, ERP_B1_ARCHITECTURE_DESIGN, ERP_B3_UI_ARCHITECTURE, ERP_A_TREASURY_DESIGN

> **Objetivo:** diseñar la sección **CONTABILIDAD → IVA VENTAS** como espejo del Libro IVA Compras, con una única fuente de verdad fiscal que consuma automáticamente toda factura, NC y ND emitida desde cualquier módulo, sin crear un módulo aislado.

---

## §0 — Resumen ejecutivo · hallazgo central

**La asimetría que señala Presidencia es real y es más profunda que la falta de una pantalla.**

| Dimensión | COMPRAS (crédito fiscal) | VENTAS (débito fiscal) — HOY |
|---|---|---|
| Detalle IVA por alícuota | ✅ `supplier_invoice_vat_lines` canónica (CHECK par AFIP, tolerancia ±0,02) | ⚠️ solo por renglón en `invoice_items`, **sin CHECK de alícuota**, sin tabla canónica |
| Percepciones | ✅ `supplier_invoice_other_taxes` tipadas (IVA / IIBB+jurisdicción / Ganancias) | ❌ columna `percepciones` existe pero es **vía muerta** (Zod la stripea; ARCA la rechazaría) |
| Libro IVA | ✅ vista `libro_iva_compras` + página `/compras/libro-iva` + export | ❌ **NO EXISTE** vista ni página |
| NC/ND | ⚠️ cargables pero **suman** crédito en vez de restar (vistas 0059 sin signo) | ⚠️ tipos completos pero **funcionalmente rotas** (sin CbtesAsoc → ARCA real las rechaza) |
| Retenciones | ❌ practicadas: ausentes (`supplier_payments` sin campo) | ⚠️ sufridas: `customer_receipts.retention_amount` agregado único, sin desglose por impuesto |
| Posición IVA | ❌ **NO EXISTE** en ninguna parte del sistema | — |

La buena noticia: **la fundación ventas ya existe y es sólida** — `customer_invoices` (migración `0011_arca_billing.sql`) modela los 10 tipos de comprobante (A/B/C/E + NC/ND A/B/C), CAE, QR fiscal RG 4892, snapshot del receptor, inmutabilidad post-CAE por trigger, y auditoría append-only en `invoice_audit`. El IVA multi-alícuota se persiste por renglón (`invoice_items.alic_iva_id` con el mismo mapa AFIP del lado AP: 3=0%, 4=10,5%, 5=21%, 6=27%, 8=5%, 9=2,5%).

**Decisión de diseño central (espejo de ERP-B1):** el detalle fiscal por alícuota es la fuente de verdad; la cabecera es caché reconciliada. Todo reporte (libro, posición, ganancias) deriva del MISMO detalle canónico por SQL. El frontend no recalcula impuestos.

---

## §1 — Estado actual con evidencia (auditado, no asumido)

### 1.1 Fuentes de facturación de ventas (writers de `customer_invoices`)

Grep exhaustivo: **el único INSERT en todo el repo es `persistInvoice()`** (`src/lib/invoicing/emit.ts:372-377`). Esto es una ventaja estructural: ya existe una única puerta de emisión.

| Fuente | Trigger | Estado |
|---|---|---|
| **Facturación por OS** | `/billing` → `EmitInvoiceButton` → `emitFromClientOrdersAction` (`billing/actions.ts:107-167`) | ✅ ÚNICA UI activa. Consolida OS `FIRMADA` por cliente → 1 renglón por OS → Factura A |
| **Facturación directa** | `emitInvoiceAction` (`billing/actions.ts`) | ⚠️ puerta programática **sin UI y sin gate RBAC** |
| **Futuras fuentes** (ERP-C ARCA productiva, portal, marketplaces) | — | deben pasar por `emitInvoice()` — misma puerta |

### 1.2 Gaps duros confirmados (cada uno con evidencia)

| # | Gap | Evidencia |
|---|---|---|
| G1 | `importe_no_gravado` / `importe_exento` **hardcodeados en 0** — no se puede registrar exento ni no gravado (alícuota 0% ≠ exento) | `calc.ts:115-116` |
| G2 | Sin desglose IVA por alícuota en cabecera; reconstruible solo desde `invoice_items` | `0011:212-227` |
| G3 | **Sin fecha de emisión fiscal propia**: `CbteFch` solo sobrevive dentro de `request_arca` jsonb; los reportes usan `created_at` → períodos mal imputados en cortes de mes | `emit.ts` |
| G4 | Percepciones ventas: vía muerta — `EmitSchema` las stripea y el request ARCA no las representa (`ImpTrib` = solo tributos; array `Tributos` nunca se envía) → rechazo por identidad de importes | `actions.ts:44-79`, `emit.ts:162`, `wsfev1.ts:109-121` |
| G5 | **NC/ND funcionalmente rotas**: `comprobante_asociado_id` stripeado por Zod; `emit.ts` nunca envía `CbtesAsoc` (RG 4540 lo exige) → ARCA real las rechaza; el mock SANDBOX las aprueba dando falsa confianza | `arca/types.ts:129`, `wsfev1.ts:125-131` |
| G6 | Sin acción de anulación: estado `ANULADO` y flag `anulada` **no tienen ningún escritor** | grep verificado |
| G7 | `alicuotaToId` defaultea **silenciosamente a 21%** cualquier alícuota desconocida; `invoice_items` sin CHECK de alícuota (AP sí lo tiene) | `arca/types.ts:59-74`, `0011:220` |
| G8 | OS→FACTURADA es update best-effort post-CAE: si falla, las OS quedan FIRMADA y el botón permite **doble facturación con CAE válido** | `actions.ts:152-156` |
| G9 | Letra hardcodeada: siempre Factura A + receptor RI + 21% — ignora `clients.condicion_iva` (un monotributista recibiría A en vez de B) | `actions.ts:107-167` |
| G10 | Registros con validez fiscal heterogénea conviven: SANDBOX/mock (CAE falso) + RECHAZADO/ERROR en la misma tabla; consumidores deben filtrar `estado_arca + ambiente` (hoy `command-center.ts` no filtra) | `0011`, `command-center.ts:49-69` |
| G11 | Lado compras: las **NC de proveedor SUMAN crédito fiscal** en `libro_iva_compras` (vistas 0059 sin signo; CHECK >= 0 impide negativos) | `0059:16-69`, `0014:26` |
| G12 | Retenciones: sufridas solo como `retention_amount` agregado (sin impuesto/jurisdicción/certificado, "D4 CONGELADAS" en `0053:29`); practicadas **ausentes** | `0053:317-340, 407-426` |

---

## §2 — Principios de diseño (heredados y obligatorios)

1. **Única fuente de verdad fiscal:** Supabase productivo. El detalle por alícuota es la verdad; la cabecera, caché reconciliada (decisión ERP-B1 §1.1, ahora extendida a ventas).
2. **Una sola puerta de emisión:** todo comprobante de venta — de cualquier módulo presente o futuro — entra por `emitInvoice()`. No se crean caminos paralelos.
3. **RPC-First + append-only:** correcciones por documento rectificativo (NC/ND), nunca UPDATE/DELETE financiero.
4. **Saldos y libros SIEMPRE vistas derivadas** (`security_invoker`), nunca tablas que se "actualizan".
5. **El frontend no recalcula impuestos** (regla ERP-B3): la matemática fiscal vive en la DB.
6. **Validez fiscal explícita:** todo reporte filtra `estado_arca='AUTORIZADO_ARCA' AND anulada=false AND ambiente` según corte (G10).
7. **RLS ≤ RBAC, export gated** (patrón `cuentas_pagar.export`).

---

## §3 — Modelo de dominio propuesto (migración `0071_vat_sales_fiscal_detail.sql`)

> Numeración verificada: última migración `0070_rbac_gerencia_finanzas.sql`; existen duplicados históricos por ramas paralelas → confirmar contra main antes de mergear.

### 3.1 `customer_invoice_vat_lines` — detalle canónico del débito fiscal

Espejo exacto de `supplier_invoice_vat_lines` (0056):

| Columna | Tipo | Regla |
|---|---|---|
| id | uuid PK | |
| invoice_id | uuid FK `customer_invoices` on delete restrict | |
| alic_iva_id | smallint NOT NULL | CHECK par AFIP: (3,0)(4,10.5)(5,21)(6,27)(8,5)(9,2.5) |
| alicuota_iva | numeric(5,2) NOT NULL | parte del CHECK compuesto |
| neto_gravado | numeric(15,2) NOT NULL CHECK >= 0 | |
| iva_importe | numeric(15,2) NOT NULL CHECK >= 0 | coherencia: `abs(iva - neto*alic/100) <= 0.02` |
| UNIQUE (invoice_id, alic_iva_id) | | una fila por alícuota por comprobante |

- **Población:** `persistInvoice()` inserta cabecera + items + **vat_lines en la misma transacción** (agrupando los renglones por `alic_iva_id`, cálculo que `computeInvoiceTotals` ya hace en memoria — `calc.ts`).
- **Backfill:** una pasada SQL desde `invoice_items` para el stock histórico (verificable: Σ vat_lines = `customer_invoices.iva` ± 0,02).
- **Signo:** los importes se guardan SIEMPRE positivos; el signo lo aporta el tipo de comprobante en las vistas (§4). Mismo criterio a aplicar como fix en compras (G11).

### 3.2 `customer_invoice_other_taxes` — percepciones emitidas

Espejo de `supplier_invoice_other_taxes` con el mismo enum tipado: `PERCEPCION_IVA` · `PERCEPCION_IIBB` (jurisdicción obligatoria) · `PERCEPCION_GANANCIAS` · `OTRO`. Requisito de activación: completar el envío del array `Tributos` en WSFEv1 (`wsfev1.ts` ya lo soporta; `emit.ts` no lo puebla — G4). Hasta entonces la tabla existe pero la UI de emisión no la ofrece.

### 3.3 Cabecera `customer_invoices` — columnas a agregar

| Columna | Tipo | Para qué |
|---|---|---|
| fecha_emision date NOT NULL default current_date | fecha fiscal real (`CbteFch`) — cierra G3; backfill desde `request_arca->>'CbteFch'` con fallback `created_at::date` |
| (sin más cambios) | | `importe_no_gravado`/`importe_exento` ya existen; dejan de hardcodearse en 0 cuando la UI los capture (G1, fase V3) |

### 3.4 Retenciones — desglose real (cierra G12)

**Sufridas (al cobrar):** `customer_receipt_retentions` — hija de `customer_receipts`:
`id · receipt_id FK · tax_kind enum ('RET_IVA','RET_GANANCIAS','RET_IIBB') · jurisdiccion text (oblig. si IIBB) · certificado_nro text · fecha date · importe numeric(15,2) CHECK > 0`.
Regla de coherencia: Σ retentions = `customer_receipts.retention_amount` (la columna agregada pasa a ser caché reconciliada — mismo patrón cabecera/detalle).

**Practicadas (al pagar proveedores):** `supplier_payment_retentions` — espejo sobre `supplier_payments`, mismo enum + `regimen text`. Descongelar D4 requiere gate de Tesorería (ERP-A intacto: las RPCs de pago suman la retención como aplicación al saldo).

**Percepciones sufridas (compras):** ya cubiertas por `supplier_invoice_other_taxes` (incluye aduana vía `OTRO`/ampliación de enum `PERCEPCION_ADUANA` — decisión a confirmar).

### 3.5 Navegación y RBAC

- Nueva sección de Sidebar **«Contabilidad»** con: **IVA Ventas** (`/contabilidad/iva-ventas`), **Posición IVA** (`/contabilidad/posicion-iva`, fase V4), **Retenciones y Percepciones** (`/contabilidad/retenciones`, fase V3). Libro IVA Compras permanece en `/compras/libro-iva` (sin breaking change) y se enlaza desde Contabilidad.
- RBAC: nuevos slugs `contabilidad.view` y `contabilidad.export` en el catálogo (mismo patrón `cuentas_pagar.*`); page guard `canAccess` + export re-verificado server-side en el route handler. Estrategia B intacta.

### 3.6 Correcciones obligatorias asociadas (no son "features")

| Fix | Gap | Fase |
|---|---|---|
| `CbtesAsoc` en `FeDetReq` + `comprobante_asociado_id` en `EmitSchema` | G5 | V1 (bloquea NC/ND reales) |
| Signo NC/ND en vistas de compras (`0059`) y ventas | G11 | V2 |
| CHECK de alícuota en `invoice_items` + eliminar default silencioso a 21% (rechazar alícuota desconocida) | G7 | V1 |
| Idempotencia OS→factura (marcar FACTURADA en la misma transacción o guard de re-emisión) | G8 | V1 |
| Letra por `clients.condicion_iva` (`comprobanteParaReceptor()` ya existe) | G9 | V2 |
| Gate RBAC a `emitInvoiceAction` | — | V1 |
| Filtro de validez fiscal en `command-center.ts` (KPI Facturación del mes) | G10 | V2 |

---

## §4 — Vistas derivadas (la "única fuente de verdad" en acción)

Todas `security_invoker=true`, sin recálculo en frontend. Definiciones detalladas en VAT-SALES-REPORTING-PLAN.md (entregable 7).

1. **`customer_invoice_fiscal`** — espejo de `supplier_invoice_fiscal`: una fila por comprobante autorizado con neto por alícuota, exento, no gravado, IVA, percepciones, total derivado vs cabecera, período `YYYY-MM` (sobre `fecha_emision`), **signo ±1 por tipo** (`NC → -1`).
2. **`libro_iva_ventas`** — GROUP BY período + alícuota sobre `customer_invoice_vat_lines` con signo: comprobantes, neto gravado, **IVA débito fiscal**, total.
3. **`posicion_iva_mensual`** — `libro_iva_ventas` (débito) ⋈ `libro_iva_compras` (crédito) por período → **saldo técnico**; + retenciones/percepciones de IVA como pagos a cuenta → saldo a pagar / a favor.
4. **`retenciones_percepciones_periodo`** — consolidado por impuesto, jurisdicción y sentido (sufridas/practicadas/emitidas).

---

## §5 — Integración: qué NO se toca

- **Tesorería (ERP-A):** intacta. `customer_open_items`, recibos y aplicaciones no cambian; las retenciones detalladas son hijas del recibo existente.
- **AP (ERP-B):** intacto salvo el fix de signo NC (G11) y `supplier_payment_retentions` (V3, gate propio).
- **Emisores:** `emitFromClientOrdersAction` conserva su contrato; solo gana corrección de letra (G9) e idempotencia (G8). Las futuras fuentes (portal, ML, ERP-C) entran por la misma puerta `emitInvoice()`.
- **OS (`public.orders`):** sin cambios de esquema.
- **RBAC:** Estrategia B y `RBAC_ENFORCE` sin tocar; solo se agregan slugs al catálogo.

---

## §6 — Riesgos

| Nivel | Riesgo | Mitigación |
|---|---|---|
| 🔴 P0 | Libros con datos sin validez fiscal (SANDBOX/mock mezclado, G10) | filtro obligatorio `estado_arca + ambiente` en TODAS las vistas; corte por `fiscal_config.ambiente` |
| 🔴 P0 | NC/ND inutilizables en ARCA real (G5) → libros incorregibles | fix CbtesAsoc en V1, ANTES de ARCA productiva (ERP-C) |
| 🟠 P1 | Backfill de `vat_lines` con histórico inconsistente | backfill verificado por identidad Σ=cabecera ±0,02; excepciones a tabla de cuarentena con reporte |
| 🟠 P1 | Colisión de numeración de migraciones (duplicados históricos) | verificar 0071 contra main en el gate de merge |
| 🟡 P2 | Doble verdad si alguien reporta desde `invoice_items` en paralelo | regla: reportes fiscales SOLO desde vat_lines/vistas; lint de revisión en PRs |
| 🟡 P2 | Percepciones activadas sin completar `Tributos` WSFEv1 (G4) | la UI no expone percepciones hasta cerrar el envío ARCA (gate V3) |
| ⚪ P3 | Carga operativa de retenciones con certificados | UI de carga en recibo (V3) + import CSV posterior |

---

## §7 — Roadmap por fases con gates presidenciales

| Fase | Entregable | Alcance | Gate |
|---|---|---|---|
| **V1 — Fundación** | migración 0071 + persistencia transaccional vat_lines + backfill + fixes G5/G7/G8 + gate RBAC | sin UI nueva | aprobación de este diseño |
| **V2 — Libro IVA Ventas** | vistas §4.1-4.2 + página `/contabilidad/iva-ventas` + export CSV/XLSX/PDF + fix signo NC (ambos lados) + letra por condición IVA (G9) | primera pantalla CONTABILIDAD | V1 verificada en preview |
| **V3 — Retenciones y Percepciones** | tablas §3.4 + UI en recibo/pago + `/contabilidad/retenciones` + activación percepciones (cierre G4) | descongela D4 con gate de Tesorería | V2 en producción |
| **V4 — Posición IVA + Ganancias** | `posicion_iva_mensual` + `/contabilidad/posicion-iva` + paquete de cierre mensual (base ganancias) | reporting integral | V3 |
| **V5 — Conciliación ARCA** | análisis→implementación: import "Mis Comprobantes"/WSFE `FECompConsultar`, matching (PV, tipo, número), reporte de diferencias | requiere ARCA productiva (ERP-C) | decisión presidencial |

---

## §8 — Veredicto

### ✅ READY FOR APPROVAL — diseño completo, fundación existente sólida, asimetría cerrable sin refactor destructivo

1. La única puerta de emisión ya existe (`emitInvoice()`); convertirla en fuente de verdad fiscal es aditivo, no disruptivo.
2. El patrón canónico ya está probado en producción del lado compras (ERP-B1/B3): se replica, no se inventa.
3. Los 12 gaps están identificados con evidencia y asignados a fases con gates.
4. Cero cambios a Tesorería, OS y RBAC enforcement; Estrategia B intacta.

> Restricción cumplida: solo diseño y diagnóstico — no se escribió código, ni migraciones, ni se modificó producción.

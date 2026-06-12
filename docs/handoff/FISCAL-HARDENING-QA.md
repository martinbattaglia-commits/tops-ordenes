# FISCAL-HARDENING-QA — Evidencia de validación

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** FISCAL-HARDENING-QA.md (entregable 2/3 de la fase)
**Fecha:** 2026-06-12 · **Rama:** `feature/fiscal-hardening`

---

## §1 — Validaciones técnicas obligatorias

| Validación | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 (0 errores) |
| `next lint` (src/app, src/components, src/lib) | ✅ EXIT 0 (0 errores; solo warnings preexistentes de custody PDF, no relacionados) |
| `next build` (producción) | ✅ EXIT 0 — compila completo, `/billing` y `/ejecutivo` incluidos |

## §2 — QA unitaria reproducible: `scripts/qa/fiscal-hardening-test.ts`

Suite ejecutable (`npx tsx scripts/qa/fiscal-hardening-test.ts`) sobre `emitInvoice()` real en modo mock SANDBOX. **Resultado: 15/15 PASS.**

| # | Caso | Frente | Resultado |
|---|---|---|---|
| C0/C0b | Factura A $1.210.000 (neto $1.000.000 + IVA 21%) autorizada | base | ✅ |
| C1 | **NC sin comprobante asociado → RECHAZADA** (RG 4540; antes el mock la aprobaba) | H1 | ✅ |
| C2/C2b | NC parcial $121.000 autorizada y el request ARCA **incluye `CbtesAsoc`** | H1 | ✅ |
| C3 | NC excedente ($1.210.000 sobre restante $1.089.000) **bloqueada por tope** | H1 | ✅ |
| C4 | NC letra B sobre Factura A → rechazada (letra debe coincidir) | H1 | ✅ |
| C5 | NC con receptor distinto → rechazada | H1 | ✅ |
| C6 | NC sobre NC → rechazada | H1 | ✅ |
| C7 | NC por el resto exacto ($1.089.000) → autorizada (tope acumulado correcto) | H1 | ✅ |
| C8 | NC adicional sobre saldo $0 → bloqueada | H1 | ✅ |
| C9 | Factura con 2 OS vinculadas (order_id) autorizada | H4 | ✅ |
| C10 | **Guard detecta las 2 OS ya facturadas** y no marca una tercera nunca facturada | H4 | ✅ |
| C11 | Factura anulada **libera** sus OS ante el guard | H4 | ✅ |
| C12 | Las NC no cuentan como facturación de una OS | H4 | ✅ |

## §3 — QA funcional en navegador (dev local, modo demo)

- ✅ `/billing` renderiza con los cambios (badges, botón Anular condicionado, tabla con columna de acciones).
- ✅ Emisión de Factura A para cliente mock: autorizada (mock SANDBOX), PDF on-demand abierto en pestaña nueva.
- ⚠️ **Limitación PREEXISTENTE del modo demo detectada y documentada**: en `next dev`, la página (RSC), las server actions y los route handlers compilan en grafos de módulos separados → el mock-store en memoria **no se comparte** entre ellos (la página muestra "Aún no se emitieron comprobantes" aunque la action emitió). Esto afecta SOLO al modo demo/dev sin Supabase; no afecta producción ni el Deploy Preview (persistencia en DB real). El flujo E2E de H1/H4 contra base real se valida en el preview (ver FISCAL-HARDENING-PREVIEW.md). La lógica quedó cubierta unitariamente (C9–C12) moviendo el guard a la capa de datos (`findBilledOrderConflicts`).

## §4 — Revisión SQL de la migración 0071 (no aplicada)

| Check | Resultado |
|---|---|
| Numeración: última migración en main = `0070_rbac_gerencia_finanzas.sql` | ✅ 0071 libre (re-verificar contra main en el gate de merge — hay duplicados históricos) |
| Nombres de tipos/columnas usados (`arca_ambiente_t`, `comprobante_tipo_t`, `customer_invoices.ambiente/anulada`, `supplier_invoices.status/approval_status/tipo_comprobante`) | ✅ verificados contra 0011/0014/0054/0057/0059 |
| Vistas recreadas con **columnas idénticas** (nombres y semántica de consumidores) | ✅ `customer_open_items`, `supplier_open_items`, `supplier_invoice_fiscal`, `libro_iva_compras` — consumidores (`tesoreria/data.ts`, `/compras/libro-iva`) leen solo columnas existentes |
| Vistas derivadas que heredan sin recrearse | ✅ `customer_current_account`, `supplier_current_account`, `supplier_ap_status`, `treasury_cashflow_projection` |
| `fiscal_ambiente()` security definer acotada (expone solo el escalar `ambiente`; `set search_path = public`; revoke public + grant authenticated) | ✅ |
| Cero `DROP`, cero `DELETE`, cero `ALTER TABLE`, cero cambios de datos | ✅ (solo `create or replace view/function` + grants + `notify pgrst`) |
| Caso de control H3 (en comentario de la migración): $121.000 + NC $12.100 → crédito $18.900 | ✅ verificable post-aplicación con la query del PREVIEW doc |

## §5 — Matriz gap → cobertura

| Gap (REVIEW-SESSION) | Cobertura | Evidencia |
|---|---|---|
| G5 — NC/ND sin CbtesAsoc | Cerrado en código + mock honesto | C1, C2b |
| G6 — sin acción de anulación | `anularInvoiceAction` + botón + audit `anular` | §1 EXECUTION |
| G10 — SANDBOX mezclado | `isFiscallyValid` + vista con `fiscal_ambiente()` + KPI + badges | §2 EXECUTION; efecto SQL post-migración |
| G11 — NC compras suma crédito | vistas 0071 con signo | §4 + caso de control |
| G8 — doble facturación | guard pre-emisión + retry + alerta auditable | C9–C12 |
| Gate puerta programática | `assertBillingRole` (espejo RLS admin/operaciones) | §1 EXECUTION |

Fuera de alcance (intacto, según directiva): G1 exento/no gravado, G4 percepciones, G7 CHECK alícuota, G9 letra por condición IVA, UI IVA Ventas, Facturación Directa.

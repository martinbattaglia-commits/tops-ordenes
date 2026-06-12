# IVA-VENTAS-V1-IMPLEMENTATION — Fundación canónica del débito fiscal

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.) · **Presidente:** Martín Battaglia
**Fecha:** 2026-06-12 · **Rama:** `feature/iva-ventas-v1` · **PR:** #17 · **Base:** main `675ac9e`
**Autorización:** IVA VENTAS V1 (2026-06-12) — sin UI, sin reportes, solo fundación de datos.

> **Estado: IMPLEMENTACIÓN COMPLETA.** tsc 0 · lint 0 · build 0 · QA 10/10 + regresión 15/15. Migración 0072 ESCRITA, NO aplicada. Detenido antes de merge, conforme a protocolo.

## §1 — Mandatos → implementación

### 1. Dominio canónico — `customer_invoice_vat_lines` (migración `0072_vat_sales_fiscal_detail.sql`)
Espejo del patrón AP probado (0056), precisión ventas `numeric(15,2)`:
`id · invoice_id FK (on delete restrict) · alic_iva_id · alicuota_iva · neto_gravado · iva_importe · created_at` — CHECK de **par AFIP** (3,0)(4,10.5)(5,21)(6,27)(8,5)(9,2.5) · CHECK ≥ 0 · `UNIQUE (invoice_id, alic_iva_id)` · índices · **guard `ventas.via_rpc`** (el detalle solo nace vía RPC, espejo de `ap.via_rpc`) · RLS: lectura internos, escritura admin/operaciones.

### 2. Persistencia transaccional obligatoria
- **RPC `ventas_persist_invoice(p_invoice, p_items, p_vat_lines, p_audit)`** — security definer, gate de rol admin/operaciones (el mismo del RLS de escritura), `set_config('ventas.via_rpc')`: cabecera + renglones + líneas IVA + 2 entradas de auditoría en **una sola transacción** (antes eran 3 inserts separados no atómicos).
- **`trg_ci_vat_identity`** — constraint trigger **DIFERIDO al commit** sobre `customer_invoices`: todo comprobante nuevo debe tener **≥1 línea IVA** y cumplir la identidad. Es imposible, a nivel de base, emitir un comprobante sin detalle canónico.
- `persistInvoice()` (`emit.ts`) ahora computa las líneas desde `totals.alicuotas` — **lo mismo que se declara a ARCA** en el array `Iva[]` — y llama a la RPC. Identidad Σ líneas = cabecera **por construcción** (tolerancia efectiva: $0,00).

### 3. Backfill histórico
Dentro de 0072 (§6): `INSERT ... SELECT invoice_id, alic_iva_id, alicuota_iva, Σ importe_neto, Σ importe_iva FROM invoice_items GROUP BY ...` — **idempotente** (`ON CONFLICT DO NOTHING`), cubre todo el histórico (autorizados, rechazados y errores: el dominio canónico es uniforme).

### 4. Verificación matemática ±0,02
Dos capas: (a) el trigger diferido la exige para siempre en cada comprobante nuevo; (b) la migración trae verificación **fail-fast** del backfill (§7): si algún comprobante con renglones queda sin líneas o fuera de ±0,02, la migración **falla y reporta** los comprobantes afectados (id, número, Δneto, Δiva). Reporte de diferencias: IVA-VENTAS-V1-BACKFILL-REPORT.md.

### 5. Fix G7 — fin del default silencioso a 21%
- `alicuotaToId()` (arca/types.ts): alícuota desconocida → **error explícito** (antes: 21% silencioso, el comprobante declaraba mal el débito).
- `EmitItemInput.alicuota_iva` ahora **obligatoria** (se eliminó el `?? 21` de `emit.ts`); el único emisor activo ya la pasaba explícita (21).
- `ItemSchema` (Zod) valida el set AFIP `0 / 2.5 / 5 / 10.5 / 21 / 27`.
- **En base:** CHECK de par AFIP agregado también a `invoice_items` (`ii_alic_pair_chk`) — ninguna alícuota inválida puede persistirse, venga de donde venga.

## §2 — Archivos (6)
| Archivo | Cambio |
|---|---|
| `supabase/migrations/0072_vat_sales_fiscal_detail.sql` | NUEVA — tabla canónica + guard + RLS + trigger identidad + RPC + G7 + backfill + verificación |
| `src/lib/arca/types.ts` | `alicuotaToId` estricto · `alicuotaFromId` · `ALICUOTAS_VALIDAS` |
| `src/lib/invoicing/emit.ts` | alícuota obligatoria · vat_lines canónicas · persistencia vía RPC |
| `src/lib/invoicing/types.ts` | `CustomerInvoiceVatLine` + `CustomerInvoice.vat_lines?` |
| `src/app/(app)/billing/actions.ts` | `ItemSchema.alicuota_iva` obligatoria + set válido |
| `scripts/qa/iva-ventas-v1-test.ts` | NUEVA — suite QA reproducible (10 casos) |

## §3 — Restricciones respetadas
UI ✅ sin cambios · Dashboard ✅ · Tesorería ✅ · Cobranzas ✅ · Facturación visual ✅ (mismos botones/pantallas) · TOPS Connect ✅ · ARCA Producción ✅ (ambiente sigue SANDBOX). V2 NO iniciada.

## §4 — Nota operativa (para el gate)
El código nuevo emite **solo** vía RPC: en cualquier entorno con DB donde 0072 no esté aplicada, la emisión falla en forma controlada (fail-closed) — coherente con "no permitir comprobantes sin líneas IVA". Por eso el runbook post-aprobación aplica 0072 **inmediatamente después del deploy** (ver IVA-VENTAS-V1-GATE.md).

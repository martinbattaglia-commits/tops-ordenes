# IVA-VENTAS-V1-CLOSURE — Cierre formal de fase

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.) · **Presidente:** Martín Battaglia
**Fecha:** 2026-06-12 · **Estado:** ✅ **V1 CERRADA** — runbook completo con aprobación presidencial en cada gate.

---

## §1 — Las 7 evidencias requeridas

| # | Evidencia | Resultado |
|---|---|---|
| 1 | **Dry-run del backfill** (solo lectura, pre-aplicación) | ✅ 2 comprobantes; backfill ≡ cabecera exacto (#1: neto 3.654.800/IVA 767.508 · #2: 73.800/15.498) — **delta $0,00** |
| 2 | **Registros backfilleados** | ✅ **2 líneas** (1 por comprobante histórico, 21%) · 0 comprobantes sin detalle |
| 3 | **Diferencia máxima** | ✅ **MAX \|Δneto\| = 0,00 · MAX \|Δiva\| = 0,00** (tolerancia ±0,02 jamás usada) |
| 4 | **Emisión correcta** | ✅ **Factura A 00002-00000003 · Verotin SA · $854.260 · CAE 73866436956328 · SANDBOX** — emitida manualmente por Presidencia (12/06/2026); línea IVA creada AUTOMÁTICAMENTE por la RPC: 21% → neto $706.000 · IVA $148.260; renglón + 2 entradas de auditoría (emitir, autorizado) en la MISMA transacción |
| 5 | **Rechazo de INSERT directo** | ✅ `ERROR 23514: VENTAS_DETAIL_VIA_RPC_ONLY` (guard `ventas.via_rpc`) |
| 6 | **Rechazo de alícuota inválida** | ✅ DB: `viola check constraint "ii_alic_pair_chk"` (19% rechazado) · código: `alicuotaToId(19)` lanza error (QA V1/V2) |
| 7 | **Estado final del dominio** | ✅ `customer_invoice_vat_lines`: **3 líneas / 3 comprobantes con detalle / 0 sin detalle / MAX \|Δiva\| global 0,00** · tabla + RLS + guard + trigger de identidad + RPC operativos |

## §2 — Incidencias durante el cierre (diagnóstico y resolución, con autorización en cada paso)

1. **Bug de cast en la RPC** (intentos 1 y 3 de emisión): `invoice_audit.estado` es enum y la RPC pasaba text → `ERROR 42804` → transacción revertida completa (fail-closed correcto). Fix: `(r->>'estado')::invoice_arca_status_t`. Lección operativa documentada: el SQL Editor corre el script entero en una transacción — el primer intento de fix quedó revertido por el `rollback` del propio test; se reaplicó separando fix y test, verificando contra `pg_proc` ("FIX PERSISTIDO ✓" post-rollback).
2. **Bug latente de numeración SANDBOX** (intento 2): el mock ARCA numera en memoria por proceso; una instancia serverless nueva proponía números ya usados → `duplicate key (punto_venta, cbte_tipo, numero)`. Latente desde mayo, expuesto por esta emisión. Fix: `próximo = max(mock, máximo persistido del ambiente) + 1` — solo SANDBOX; en HOMOLOGACION/PRODUCCION la numeración la manda ARCA. QA V8.

Ambos fixes commiteados y mergeados a `main` (`91ca4d3`, `f25e1fa`) y desplegados; los archivos reflejan exactamente lo aplicado en producción. **En los 3 intentos fallidos: cero registros residuales** — la atomicidad y el trigger diferido funcionaron exactamente como se diseñaron.

## §3 — Criterios de éxito (autorización original)

`customer_invoice_vat_lines` creada ✅ · persistencia automática funcionando ✅ (probada con emisión real) · histórico migrado ✅ (backfill 2/2, Δ $0,00) · diferencias ≤ ±0,02 ✅ (= 0,00) · G7 corregido ✅ (código + DB) · build verde ✅ · deploy preview verde ✅ · sin regresiones ✅ (hardening 15/15; UI/Tesorería/Cobranzas/TOPS Connect/ARCA Producción intactos).

## §4 — Estado del repositorio y producción

- `main`: `f25e1fa` (V1 + fixes) · deploy Published · migración **0072 APLICADA** en `arsksytgdnzukbmfgkju`.
- QA reproducible: `scripts/qa/iva-ventas-v1-test.ts` (11/11) · `scripts/qa/fiscal-hardening-test.ts` (15/15).
- Entregables de fase: IVA-VENTAS-V1-{IMPLEMENTATION, BACKFILL-REPORT, QA, GATE, CLOSURE}.md.

## §5 — Declaración

> **IVA VENTAS V1 — CERRADA.** El débito fiscal de TOPS NEXUS tiene desde hoy su dominio canónico con garantías de base: ningún comprobante puede nacer sin detalle de IVA, la identidad Σ líneas = cabecera está exigida por trigger, las alícuotas inválidas son imposibles y el detalle solo nace por la vía transaccional. **V2 (libro_iva_ventas + sección CONTABILIDAD) NO iniciada** — queda a la espera de su propio gate presidencial, conforme a la directiva.

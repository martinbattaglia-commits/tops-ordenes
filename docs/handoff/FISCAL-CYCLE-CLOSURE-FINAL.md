# FISCAL-CYCLE-CLOSURE-FINAL — Cierre definitivo del ciclo fiscal V1–V2

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.) · **Presidente:** Martín Battaglia
**Fecha:** 2026-06-12 · **Estado:** 🟢 **CICLO FISCAL V1–V2 CERRADO** — runbook final ejecutado completo con autorización presidencial.

## §1 — Runbook final ejecutado

| Paso | Resultado |
|---|---|
| 1. Merge `--no-ff` PR #18 → main | ✅ `c3b33a2` (numeración 0073 verificada libre) |
| 2. Deploy productivo | ✅ Published (Netlify, main `c3b33a2`) |
| 3. Aplicación de `0073_libro_iva_ventas.sql` | ✅ aplicada en Supabase prod — "Success" (2 vistas + grants; cero tablas, cero datos) |
| 4. Verificación post-aplicación | ✅ las 6 (abajo) |

## §2 — Verificación post-aplicación (contra las vistas reales en producción)

| Check | Resultado |
|---|---|
| `customer_invoice_fiscal` operativo | ✅ 3 comprobantes con IVA pivoteado (2-1, 2-2 mayo · 2-3 junio) |
| `libro_iva_ventas` operativo | ✅ 2026-05: 2 comp · neto $3.728.600 · IVA $783.006 / 2026-06: 1 comp · $706.000 · $148.260 |
| Control triple IVA | ✅ **931.266,00 / 931.266,00 / 931.266,00** (libro ≡ vat_lines ≡ cabecera) |
| Control triple neto | ✅ **4.434.600,00 ×3 idéntico** |
| Query de diferencias | ✅ **0 filas** |
| MAX \|Δ\| | ✅ **0,00 / 0,00** (≤ ±0,02) |

## §3 — Lo que queda en producción al cierre del ciclo

**Migraciones aplicadas:** 0071 (hardening) · 0072 (dominio canónico) · 0073 (Libro IVA Ventas). `main` = `c3b33a2`, desplegado.

**Capacidades fiscales operativas desde hoy:**
- Dominio canónico del débito fiscal con garantías de base (sin comprobantes sin detalle; identidad por trigger; alícuotas inválidas imposibles; detalle solo por RPC transaccional).
- NC/ND reales (RG 4540) con tope, anulación por NC y mock honesto.
- Anti doble facturación de OS con guard independiente del estado.
- Corte SANDBOX/PRODUCCIÓN único (`fiscal_ambiente()`) en KPIs, tesorería y AMBOS libros.
- **Libro IVA Compras y Libro IVA Ventas** con signo, espejados, leyendo cada uno su detalle canónico.
- 6 queries de control documentadas para la Contadora (LIBRO-IVA-VENTAS-CONTROL.md).

**Serie documental del ciclo (docs/handoff/):** VAT-SALES-DOMAIN-DESIGN (6) · VAT-SALES-REPORTING-PLAN (7) · FISCAL-HARDENING-{PLAN, REVIEW-SESSION, EXECUTION-REPORT, QA, PREVIEW, CLOSURE} · IVA-VENTAS-V1-{IMPLEMENTATION, BACKFILL-REPORT, QA, GATE, CLOSURE} · IVA-VENTAS-V2-{IMPLEMENTATION, QA} · LIBRO-IVA-VENTAS-CONTROL · FISCAL-CYCLE-CLOSURE · NEXT-STEPS-ARCA-PRODUCCION · este documento.

## §4 — Restricciones respetadas al cierre
ARCA Producción ✗ no iniciado (hoja de ruta lista en NEXT-STEPS-ARCA-PRODUCCION.md) · Contabilidad completa ✗ · Asientos automáticos ✗ · V3 ✗ · TOPS Connect / mobile / UX-UI: intactos.

## §5 — Declaración formal

> **CICLO FISCAL V1–V2 — 🟢 CERRADO** (2026-06-12).
> TOPS NEXUS queda **fiscalmente preparado para ARCA PRODUCCIÓN**: el switch es de configuración (certificado + homologación + ambiente), no de arquitectura. Ninguna fase posterior se inicia sin autorización presidencial.

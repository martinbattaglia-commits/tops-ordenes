# FISCAL-HARDENING-PREVIEW — Guía de validación del Deploy Preview

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** FISCAL-HARDENING-PREVIEW.md (entregable 3/3 de la fase)
**Fecha:** 2026-06-12 · **PR:** #16 · **Preview:** https://deploy-preview-16--tops-ordenes.netlify.app
**Regla vigente:** NO merge a main · NO deploy productivo · esperar revisión explícita de este preview.

---

## §0 — Qué es observable en el preview (y qué no)

El preview corre el **código nuevo contra la base productiva** (`arsksytgdnzukbmfgkju`), donde la migración 0071 **NO está aplicada**. Por eso:

| Comportamiento | ¿Observable en preview? |
|---|---|
| H1 — NC/ND, anulación, tope, validaciones | ✅ SÍ (es código; el ambiente es SANDBOX → mock ARCA con regla CbtesAsoc) |
| H2 — KPI Cockpit con regla de corte + badges /billing | ✅ SÍ (código) |
| H2 — corte de ambiente en Tesorería (`customer_open_items`) | ⏳ NO hasta aplicar 0071 (vista vieja en DB) |
| H3 — signo NC en Libro IVA Compras / saldos proveedor | ⏳ NO hasta aplicar 0071 |
| H4 — guard anti doble facturación | ✅ SÍ (consulta la DB real) |

**Importante:** `fiscal_config.ambiente` en producción es `SANDBOX` → la regla de corte considera válidos los comprobantes SANDBOX (coherencia de la etapa de prueba). Las 2 facturas mock existentes (#1 $4.422.308 · #2 $89.298) **siguen contando** en KPI y tesorería hasta que el ambiente pase a PRODUCCION (ERP-C); lo que cambia ya es que RECHAZADAS/ERROR/anuladas y ambientes distintos al vigente quedan fuera.

## §1 — Checklist visual (sin efectos transaccionales)

1. `/billing`: las 2 facturas existentes muestran **badge SANDBOX** junto al estado; aparece el botón **Anular** en comprobantes autorizados del ambiente vigente.
2. `/ejecutivo`: KPI "Facturación del mes" — junio sin emisiones válidas → "$ 0"/dato del mes (las 2 mock son de mayo; ya no suman RECHAZADAS si las hubiera).
3. `/compras/libro-iva`: sin cambios visibles (H3 requiere 0071) — verificar que NO se rompió.
4. `/tesoreria` y `/tesoreria/cobranzas`: sin cambios (vista vieja) — verificar que NO se rompió.

## §2 — Checklist transaccional (opcional — CON efectos en datos reales)

> ⚠️ Emitir desde el preview escribe filas REALES en `customer_invoices` (ambiente SANDBOX, CAE mock) y **marca las OS reales como FACTURADA**. Recomendación: usar una **OS de prueba nueva** (crear → firmar) en lugar de las 7 OS operativas pendientes ($3.051.000). Residuales esperados: comprobantes SANDBOX adicionales (append-only, no se borran; salen del corte al pasar a PRODUCCION).

1. **Emisión**: `/billing` → Emitir Factura A para el cliente de prueba → AUTORIZADO + badge SANDBOX.
2. **H4 — replay**: volver a emitir para el mismo cliente → debe bloquear: *"Doble facturación bloqueada: … OS ya facturadas en un comprobante vigente"*.
3. **H1 — anulación**: botón Anular sobre la factura de prueba → confirma → aparece la **NC** en la lista y el original queda **ANULADA** (fila atenuada).
4. **H4 — liberación**: las OS de la factura anulada quedan FACTURADA apuntando al original (correcto: el guard libera pero el estado operativo de la OS es decisión manual).
5. **No anular** todavía las facturas mock #1/#2 (tienen cobranzas reales imputadas): su depuración es parte del runbook de pase a PRODUCCION (ERP-C), no de esta fase.

## §3 — Runbook post-aprobación (en orden, tras el OK presidencial)

1. Merge `--no-ff` de PR #16 a `main` + push (lo ejecuta esta mesa con autorización explícita).
2. Deploy Netlify automático → smoke: `/billing`, `/compras/libro-iva`, `/tesoreria`, `/ejecutivo`.
3. **Aplicar `0071_fiscal_hardening.sql`** en el SQL Editor de Supabase prod (verificando antes que ningún otro branch haya tomado el número 0071). La migración es idempotente (`create or replace`).
4. Verificaciones post-migración (queries de control):
   - `select * from customer_open_items;` → solo comprobantes del ambiente vigente.
   - Caso H3: cargar (o simular en staging) NC de proveedor → `libro_iva_compras` resta (control $121.000/$12.100 → $18.900).
   - `/tesoreria/cobranzas` y `/compras/libro-iva` operativos sin errores.
5. Cierre de fase: FISCAL-HARDENING-CLOSURE en docs/handoff + actualización de memoria → habilita el arranque de **V1 de IVA Ventas** (vat_lines → libro_iva_ventas → posición → retenciones → percepciones).

## §4 — Estado de los entregables

| Entregable | Estado |
|---|---|
| FISCAL-HARDENING-EXECUTION-REPORT.md | ✅ en la rama |
| FISCAL-HARDENING-QA.md | ✅ en la rama (tsc/lint/build 0 · 15/15 PASS) |
| FISCAL-HARDENING-PREVIEW.md | ✅ este documento |
| Migración 0071 | ✅ escrita · ⏸ NO aplicada |
| Merge / deploy productivo | ⏸ BLOQUEADO hasta revisión explícita del preview |

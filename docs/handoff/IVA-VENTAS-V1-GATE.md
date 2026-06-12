# IVA-VENTAS-V1-GATE — Criterios de éxito y gate de aprobación

**Fecha:** 2026-06-12 · **PR:** #17 · **Rama:** `feature/iva-ventas-v1` · main **intacto**

## §1 — Criterios de éxito (de la autorización presidencial)

| Criterio | Estado |
|---|---|
| `customer_invoice_vat_lines` creada | ✅ migración 0072 escrita (aplicación en runbook post-aprobación) |
| Persistencia automática funcionando | ✅ RPC transaccional + trigger diferido (imposible comprobante sin líneas) — QA V3/V4 |
| Histórico migrado correctamente | ✅ backfill idempotente + equivalencia probada (V6); aplicación efectiva con 0072 |
| Diferencias ≤ ±0,02 | ✅ identidad $0,00 por construcción (V4/V5) + fail-fast en la migración + dry-run listo |
| G7 corregido | ✅ error explícito + alícuota obligatoria + CHECK en base — V1/V2/V7 |
| Build verde | ✅ tsc 0 · lint 0 · build 0 |
| Deploy preview verde | ✅ deploy-preview-17 (build Netlify success) |
| Sin regresiones funcionales | ✅ regresión hardening 15/15 · sin cambios de UI/vistas/Tesorería |

## §2 — Cumplimiento de protocolo
Rama específica ✅ · migración 0072 ✅ · tsc ✅ · lint ✅ · build ✅ · pruebas de backfill ✅ (unit + equivalencia; dry-run prod diferido a la revisión por directiva) · Deploy Preview ✅ · presentación de resultados ✅ · **detenido antes de merge** ✅ · V2 NO iniciada ✅.

## §3 — Qué se solicita aprobar
1. **Merge `--no-ff`** de PR #17 a `main`.
2. **Deploy** productivo.
3. **Aplicación de `0072_vat_sales_fiscal_detail.sql`** inmediatamente después del deploy (la emisión queda fail-closed en el intervalo deploy→migración; hoy no hay emisión operativa activa). Antes de aplicar: correr el dry-run §4 del BACKFILL-REPORT (solo lectura). La migración se auto-verifica (±0,02 fail-fast).
4. Verificaciones post-migración: `select * from customer_invoice_vat_lines` (2 líneas esperadas, 21%); emisión de prueba SANDBOX → nueva línea automática; intento de INSERT directo a vat_lines → rechazado por guard; smoke `/billing`.
5. Cierre V1 (IVA-VENTAS-V1-CLOSURE) → habilita **V2: `libro_iva_ventas` + página CONTABILIDAD** (primer lector del dominio canónico), con su propio gate.

## §4 — Riesgos del gate
| Nivel | Riesgo | Mitigación |
|---|---|---|
| 🟠 P1 | Ventana deploy→0072 con emisión fail-closed | aplicar 0072 inmediatamente después del Published; sin emisión activa hoy |
| 🟡 P2 | Datos históricos con alícuota inválida romperían `ii_alic_pair_chk` | universo real = 2 comprobantes al 21% (verificado); fail-fast reporta si no |
| ⚪ P3 | Colisión de numeración 0072 | re-verificar contra main en el merge |

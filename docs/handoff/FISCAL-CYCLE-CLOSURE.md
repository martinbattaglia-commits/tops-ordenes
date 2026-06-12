# FISCAL-CYCLE-CLOSURE — Cierre del ciclo fiscal 2026-06-12

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.) · **Presidente:** Martín Battaglia
**Ciclo:** Auditoría fiscal → Diseño IVA Ventas → FISCAL-HARDENING → IVA VENTAS V1 → IVA VENTAS V2 (Libro IVA Ventas)

## §1 — Resumen ejecutivo del ciclo (un solo día: 2026-06-12)

| Fase | Estado | Evidencia |
|---|---|---|
| Diseño (entregables 6–7) | 🟢 aprobado | VAT-SALES-DOMAIN-DESIGN / VAT-SALES-REPORTING-PLAN |
| FISCAL-HARDENING (H1–H4, migración 0071) | 🟢 cerrado y EN PRODUCCIÓN | FISCAL-HARDENING-CLOSURE |
| IVA VENTAS V1 (dominio canónico, 0072) | 🟢 cerrado y EN PRODUCCIÓN | IVA-VENTAS-V1-CLOSURE (7 evidencias; emisión real 00002-00000003) |
| IVA VENTAS V2 (Libro IVA Ventas, 0073) | 🟡 **implementado y validado — EN GATE** (migración escrita NO aplicada; sin merge) | IVA-VENTAS-V2-{IMPLEMENTATION, QA} |
| Queries de control (FASE 2) | 🟢 documentadas | LIBRO-IVA-VENTAS-CONTROL |
| Hoja de ruta ARCA Producción | 🟢 documentada — NO iniciada | NEXT-STEPS-ARCA-PRODUCCION |

## §2 — Criterio de éxito del ciclo (contra el mandato)

| Criterio | Estado |
|---|---|
| IVA Ventas V1 formalmente cerrado | ✅ |
| Libro IVA Ventas existe | ✅ (vistas en 0073 — aplicación pendiente del gate) |
| Lee `customer_invoice_vat_lines` | ✅ JOIN canónico; ni items ni cabecera como fuente fiscal |
| Facturas/NC/ND impactan correctamente | ✅ signo verificado (real + sintético + suites) |
| SANDBOX/PRODUCCIÓN respetado | ✅ `fiscal_ambiente()` en todas las vistas |
| Diferencias ≤ ±0,02 | ✅ diferencia real 0,00 (control triple ×3 fuentes) |
| Reportes de control documentados | ✅ 6 queries |
| Sin regresiones (Facturación/Tesorería/Cobranzas/Libro Compras) | ✅ suites 11/11 + 15/15; V2 sin código de app |

## §3 — Estado de producción al cierre
- `main` `17e5e35` desplegado · migraciones **0071 y 0072 APLICADAS** · 0073 escrita en rama `feature/iva-ventas-v2`.
- Dominio canónico: 3 comprobantes / 3 líneas IVA / 0 sin detalle / MAX |Δ| 0,00.
- Débito fiscal vigente (SANDBOX): $931.266 (mayo $783.006 + junio $148.260) — sin validez fiscal hasta ARCA Producción, correctamente marcado.
- Residuales conocidos y documentados: cobranzas reales sobre mocks (plan de depuración en NEXT-STEPS §1.6), OS-201613 FACTURADA por comprobante de prueba.

## §4 — Para terminar el ciclo (única acción pendiente, requiere autorización)
1. Merge `--no-ff` de `feature/iva-ventas-v2` a main (migración 0073 + 5 documentos — cero código de app).
2. Aplicar 0073 en Supabase prod (idempotente, solo vistas).
3. Verificación: `libro_iva_ventas` = dry-run (2026-05: 2 comp · 2026-06: 1 comp); query de diferencias = 0 filas.

> Con eso, TOPS NEXUS queda **fiscalmente preparado para ARCA PRODUCCIÓN** — sin haberlo iniciado, conforme a la directiva.

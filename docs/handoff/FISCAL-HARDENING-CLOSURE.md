# FISCAL-HARDENING-CLOSURE — Cierre de fase

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Fecha:** 2026-06-12
**Estado:** ✅ **FASE CERRADA** — runbook completo ejecutado con aprobación presidencial.

---

## §1 — Runbook ejecutado

| Paso | Resultado |
|---|---|
| 1. Merge `--no-ff` PR #16 → main | ✅ `8f7289f` (numeración 0071 verificada libre en main) |
| 2. Deploy Netlify producción | ✅ Published 2026-06-12 16:09 UTC · secret scan limpio |
| 3. Aplicación de `0071_fiscal_hardening.sql` | ✅ aplicada en Supabase prod (`arsksytgdnzukbmfgkju`) vía SQL Editor — "Success. No rows returned". **Ajuste durante la aplicación:** `create or replace view` exige tipos idénticos → casts explícitos a `numeric(15,2)`/`numeric(14,2)` en 4 columnas (`customer_open_items.total`, `supplier_open_items.total`, `supplier_invoice_fiscal.importe_no_gravado/importe_exento/total_cabecera`); el archivo de migración del repo refleja EXACTAMENTE lo aplicado |
| 4. Verificaciones post-migración | ✅ `fiscal_ambiente()` = SANDBOX · `customer_open_items` 2 filas / saldo $2.322.308,80 (coherente: el corte respeta el ambiente vigente) · `libro_iva_compras` 0 filas (sin vat_lines aún) · `supplier_open_items` 4 · `supplier_invoice_fiscal` 4 |
| 5. Smoke producción | ✅ `/billing` (badges SANDBOX + botón Anular visibles) · `/tesoreria/cobranzas` (sin cambios, sin roturas) · `/compras/libro-iva` (operativo) |

## §2 — Estado fiscal resultante

- **NC/ND**: emisión real posible (CbtesAsoc RG 4540), con tope y anulación por NC total. El mock sandbox replica el rechazo de producción.
- **Corte de validez fiscal**: activo en código (KPI Cockpit) y en base (`customer_open_items`). Con `fiscal_config.ambiente='SANDBOX'`, los 2 comprobantes mock siguen siendo "válidos" para la etapa de prueba; al pasar a `PRODUCCION` (ERP-C) saldrán del corte automáticamente, sin borrar nada.
- **Libro IVA Compras**: con signo de NC — la primera NC real restará crédito (ventana aprovechada con impacto $0).
- **Doble facturación**: imposible re-facturar OS vigentes; fallas del vínculo OS→factura quedan auditadas y visibles.

## §3 — Residuales conocidos (decisiones futuras, fuera de esta fase)

1. Facturas mock #1/#2 con cobranzas reales imputadas: depuración en el runbook de pase a PRODUCCION (ERP-C).
2. Limitación demo/dev: mock-store no compartido entre bundles de Next (no afecta producción).
3. Gaps diferidos por diseño: G1 exento/no gravado (V3), G4 percepciones (V3), G7 CHECK alícuota (V1), G9 letra por condición IVA (V2).

## §4 — Habilitación formal

> **V1 de IVA Ventas queda FORMALMENTE HABILITADA** (decisión presidencial 2026-06-12), según VAT-SALES-DOMAIN-DESIGN.md: `customer_invoice_vat_lines` (migración 0072) + persistencia transaccional + backfill verificado + fix G7 — sin UI nueva. Luego, en orden: `libro_iva_ventas` → `posicion_iva_mensual` → retenciones → percepciones, cada una con su gate.

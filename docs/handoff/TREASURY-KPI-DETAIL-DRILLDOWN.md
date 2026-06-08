# TREASURY-KPI-DETAIL-DRILLDOWN

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo trazabilidad/drill-down. **No se modificó lógica contable ni cálculos** (saldos/totales se leen de las vistas, intactos).

---

## Diseño implementado

1. **KPIs del dashboard ahora navegables.** En `/tesoreria`, las tarjetas **"Cobranzas pendientes"** y **"Pagos pendientes"** se envolvieron en `<Link>` (cursor pointer + hover ring) → drill-down:
   - Cobranzas pendientes → `/tesoreria/cobranzas`
   - Pagos pendientes → `/tesoreria/pagos`
2. **Detalle de cobranzas pendientes** (`/tesoreria/cobranzas`): tabla con **Cliente · Factura · Fecha emisión · Fecha vencimiento · Estado · Saldo pendiente**, ordenada por **vencimiento ascendente**, con **Total** = KPI, y **nombre de cliente clickeable**.
3. **Detalle de pagos pendientes** (`/tesoreria/pagos`): idem con **Proveedor · Factura · Emisión · Vencimiento · Estado · Saldo**, total = KPI, **nombre de proveedor clickeable**.
   (Se conservan los formularios de cobro/pago existentes debajo del detalle.)

---

## Consultas utilizadas

Dos funciones nuevas en `lib/tesoreria/data.ts` que **enriquecen** los open items (sin recalcular saldos):

- **`listCobranzasDetail()`**: `customer_open_items` (saldo/total/vto/estado/factura — orden por `fch_vto_pago` asc) + join por `invoice_id` a `customer_invoices` (`razon_social` = cliente, `created_at` = emisión, `client_id` = deep link).
- **`listPagosDetail()`**: `supplier_open_items` (orden por `fecha_vencimiento` asc) + join a `supplier_invoices` (`vendor_id`, `fecha_emision`) + join a `vendors` (`razon` = proveedor).

> `saldo` y `total` provienen **tal cual** de las vistas `*_open_items` (D1/D5: ningún cálculo en TS). El total mostrado es el **KPI** (`Σ saldo_cuenta` de la cuenta corriente), no un recálculo.

---

## Coincidencia con el KPI (evidencia real, API)

```
COBRANZAS  KPI (cuenta corriente) = 4.411.606,00   |  Σ open_items = 4.411.606,00   ✅
PAGOS      KPI (cuenta corriente) = 1.341.263,57   |  Σ open_items = 1.341.263,57   ✅
```
El detalle suma **exactamente** el KPI del dashboard ($4.411.606 / $1.341.264). Sin discrepancias.

---

## Deep link cliente / proveedor

- Cliente → `/clients` · Proveedor → `/compras/proveedores` (módulos maestros), con cursor/hover (`text-fg-link`).
- ⚠️ **Limitación honesta:** no existe una **ruta de ficha por id** (`/clients/{id}`) ni filtro `?q=` en esas listas (verificado). El deep link lleva al **módulo maestro** correspondiente (lo mejor disponible). Recomendación futura: crear ruta de ficha por id (o filtro en la lista) y apuntar el link al registro exacto — no se asumió un patrón inexistente.

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/lib/tesoreria/data.ts` | + `CobranzaDetailRow`/`PagoDetailRow` + `listCobranzasDetail()`/`listPagosDetail()` (enriquecen open items con nombre + emisión; sin recalcular saldos) |
| `src/app/(app)/tesoreria/page.tsx` | KPIs "Cobranzas/Pagos pendientes" envueltos en `<Link>` (drill-down + hover/cursor) |
| `src/app/(app)/tesoreria/cobranzas/page.tsx` | tabla "Detalle de cobranzas pendientes" (Cliente deep-link, Factura, Emisión, Vto, Estado, Saldo) + total = KPI; conserva `CobranzaForm` |
| `src/app/(app)/tesoreria/pagos/page.tsx` | tabla "Detalle de pagos pendientes" (Proveedor deep-link, …) + total = KPI; conserva `PagoForm` |

Sin cambios en vistas/SQL, cálculos de saldo, ni RLS.

---

## Validaciones realizadas

| Validación | Resultado |
|---|---|
| Total cobranzas = KPI | ✅ 4.411.606,00 = 4.411.606,00 |
| Total pagos = KPI | ✅ 1.341.263,57 = 1.341.263,57 |
| Coincidencia con KPI dashboard | ✅ (mismo `Σ saldo_cuenta` mostrado como total) |
| Orden cronológico (vto asc) | ✅ heredado de `list*OpenItems` (`order ... ascending:true`) |
| Deep links cliente/proveedor | ✅ clickeables (a módulo maestro; ver limitación) |
| Navegación KPI → detalle | ✅ `<Link>` en dashboard |
| Dark mode / Nexus / responsive | ✅ componentes `Kpi`/`StatusPill`/`card`/`text-fg-link`; tabla `overflow-x-auto` |
| `tsc --noEmit` | ✅ EXIT 0 |
| Recompila | ✅ `/tesoreria`, `/tesoreria/cobranzas`, `/tesoreria/pagos` → 307 (login; sin 500) |

---

## Evidencia funcional
```
KPI dashboard clickeable → /tesoreria/cobranzas y /tesoreria/pagos
detalle cobranzas: customer_open_items ⨝ customer_invoices (razon_social, created_at) · orden fch_vto_pago asc
detalle pagos: supplier_open_items ⨝ supplier_invoices (fecha_emision) ⨝ vendors (razon) · orden fecha_vencimiento asc
Σ detalle = KPI (4.411.606 / 1.341.263,57) verificado contra la API
tsc EXIT 0 · rutas 307
```
> La comprobación visual logueada la confirmás vos; los totales y la procedencia de datos ya están validados contra la base. Sin commit/push.

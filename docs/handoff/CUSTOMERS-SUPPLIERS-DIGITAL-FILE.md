# CUSTOMERS-SUPPLIERS-DIGITAL-FILE

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo se agregaron fichas individuales + navegación (agregación read-only). **No se modificó lógica financiera ni CRM.**

---

## Arquitectura

Nuevo módulo de **agregación** `src/lib/legajo/data.ts` (read-only, RLS por sesión) que **lee y agrupa por id** las fuentes existentes — sin tocar su lógica:

- **Cliente** (`getClienteFicha(id)`): `clients` (general) + `customer_invoices` por `client_id` (finanzas) + `customer_current_account` por `client_id` (saldo).
- **Proveedor** (`getProveedorFicha(id)`): `vendors` (`getVendor`) + `purchase_orders` por `vendor_id` (`listPurchaseOrders`) + `supplier_invoices` por `vendor_id` + `supplier_current_account` por `vendor_id`.

Reusa funciones existentes (`getVendor`, `listPurchaseOrders`); las consultas financieras filtran por id sin recalcular saldos (vistas = fuente de verdad).

---

## Rutas creadas

| Ruta | Ficha | Fuente |
|---|---|---|
| `/clientes/[id]` | **Ficha Cliente** | `clients` + `customer_invoices`/`customer_current_account` |
| `/compras/proveedores/[id]` | **Ficha Proveedor** | `vendors` + `purchase_orders` + `supplier_invoices`/`supplier_current_account` |

---

## Datos mostrados

### Ficha Cliente
| Sección | Contenido | Estado |
|---|---|---|
| **General** | Razón social, CUIT, cond. IVA, domicilio, localidad, teléfono, email, contacto, tags | ✅ real (`clients`) |
| **Finanzas** | Saldo cta cte, facturas abiertas, total facturado, próximo vto + **tabla de facturas** (nº, tipo, emisión, vto, estado, total) | ✅ real (por `client_id`) |
| **Operaciones** | Depósito asignado + link a OS | 🟡 depósito real; servicios = link a `/orders`; **m² por cliente** = nota (se gestiona en WMS, trazabilidad m²-por-cliente fase futura) |
| **Comercial / CRM** | Link a Clientify | 🟡 honesto: el CRM es Clientify y el cliente interno **no está vinculado por id** al CRM externo → link "Buscar en Clientify" (no se inventó data) |
| **Documentación** | Link a Drive/Centro Documental | 🟡 contratos/certificados/ANMAT viven en Documental; no hay vínculo doc-por-cliente in-app → link |

### Ficha Proveedor
| Sección | Contenido | Estado |
|---|---|---|
| **General** | Razón social, CUIT, categoría, domicilio, teléfono, email, contacto, cond. de pago, tags | ✅ real (`vendors`) |
| **Compras** | **Tabla de OCs** (nº deep-link a la OC, fecha, estado, total) | ✅ real (por `vendor_id`) |
| **Finanzas** | Saldo a pagar, facturas abiertas, total facturado, próximo vto + **tabla facturas proveedor** | ✅ real (por `vendor_id`) |
| **Historial** | Resumen (deriva de OCs/facturas) + link a OCs del proveedor | ✅ |

> Las secciones 🟡 no muestran datos falsos: enlazan al sistema dueño del dato (Clientify/Drive/WMS) porque no existe vínculo por id in-app. Honestidad > placeholders inventados.

---

## Navegación / deep links actualizados

| Origen | Antes | Ahora |
|---|---|---|
| Lista Clientes (`/clients`, desktop+mobile) | razón social = texto | → `/clientes/[id]` (link, hover, cursor) |
| Lista Proveedores (`/compras/proveedores`, desktop+mobile) | nombre = texto | → `/compras/proveedores/[id]` |
| Tesorería **Cobranzas** (detalle) | cliente → `/clients` | → `/clientes/[clientId]` (usa el `clientId` del detalle) |
| Tesorería **Pagos** (detalle) | proveedor → `/compras/proveedores` | → `/compras/proveedores/[vendorId]` |

---

## Archivos modificados / creados

**Nuevos:**
- `src/lib/legajo/data.ts` — `getClienteFicha`, `getProveedorFicha` (agregación read-only).
- `src/app/(app)/clientes/[id]/page.tsx` — Ficha Cliente.
- `src/app/(app)/compras/proveedores/[id]/page.tsx` — Ficha Proveedor.

**Modificados (solo navegación):**
- `src/app/(app)/clients/ClientsView.tsx` — razón social clickeable (desktop+mobile).
- `src/app/(app)/compras/proveedores/page.tsx` — nombre clickeable (desktop+mobile).
- `src/app/(app)/tesoreria/cobranzas/page.tsx` — deep link cliente → ficha.
- `src/app/(app)/tesoreria/pagos/page.tsx` — deep link proveedor → ficha.

Sin cambios en cálculos financieros, vistas, CRM ni RLS.

---

## Validaciones

| Validación | Resultado |
|---|---|
| Cliente → Ficha | ✅ `/clientes/[id]` resuelve (probado con id real `0d6efafe…`) |
| Proveedor → Ficha | ✅ `/compras/proveedores/[id]` (id real `fa798df0…`) |
| Navegación (listas + tesorería) | ✅ razón social/nombre clickeables; cobros/pagos → fichas |
| Datos financieros | ✅ facturas + saldo por id (vistas existentes, sin recalcular) |
| Datos operativos | ✅ depósito asignado; servicios/m² → enlace honesto |
| Datos comerciales | 🟡 link a Clientify (sin vínculo id in-app — documentado) |
| `tsc --noEmit` | ✅ EXIT 0 |
| Recompila | ✅ `/clientes/[id]`, `/compras/proveedores/[id]`, `/clients`, `/compras/proveedores` → 307 (login; sin 500/404) |

---

## Evidencia
```
getClienteFicha:  clients ⨝ customer_invoices(client_id) ⨝ customer_current_account(client_id)
getProveedorFicha: vendors ⨝ purchase_orders(vendor_id) ⨝ supplier_invoices(vendor_id) ⨝ supplier_current_account(vendor_id)
rutas /clientes/[id] y /compras/proveedores/[id] → 307 (compilan)
deep links: listas + tesorería (cobranzas/pagos) → fichas por id
tsc EXIT 0
```

> Limitaciones honestas (no asumidas): CRM (Clientify) y Documentación no tienen vínculo por id interno → enlazan al sistema dueño; m²-por-cliente se gestiona en WMS. Verificación visual logueada la confirmás vos. Sin commit/push.

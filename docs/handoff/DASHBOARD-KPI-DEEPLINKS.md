# DASHBOARD-KPI-DEEPLINKS

**Fecha:** 2026-06-08 · **`tsc --noEmit` EXIT 0** · rutas → **307** (gate de auth, operativas).
**Alcance:** Dashboard Compras (`/compras`) y Dashboard Servicios (`/dashboard`). KPIs superiores → Deep Links **solo cuando existe fuente de detalle real**. **No se modificó lógica ni cálculos.**

## Principio aplicado
Se convirtió en Deep Link únicamente el KPI que tiene un **listado/detalle real** detrás. Los filtros usados **existen** en las rutas destino (verificado en el código). Ningún KPI sin fuente concreta fue linkeado.

## Dashboard Compras (`src/app/(app)/compras/page.tsx`)
Componente `Kpi` extendido con prop opcional `href` (sin `href` → KPI plano, retrocompatible).

| KPI | Deep link | Fuente real |
|---|---|---|
| OC emitidas mes | `/compras/ordenes` | Listado de OC |
| Monto comprometido | `/compras/ordenes` | Listado de OC que componen el monto |
| % conciliadas | `/compras/ordenes?status=conciliada` | Tab "Conciliadas" (existe en `TABS`) |
| % firmadas en el día | `/compras/ordenes?status=firmada` | Tab "Firmadas" (existe en `TABS`) |

Los 4 tienen fuente real → los 4 navegables.

## Dashboard Servicios (`src/app/(app)/dashboard/page.tsx`)
Mismo patrón `href` opcional.

| KPI | Deep link | Fuente real |
|---|---|---|
| Órdenes del mes | `/orders` | Listado de órdenes de servicio |
| Horas operativas | **— (no navegable)** | No existe "detalle de horas por servicio" (`/reports` solo muestra total agregado, breakdown está "Próximamente"). Por el principio, **no se linkea**. |
| Facturación proyectada | `/orders` | Órdenes que generan la proyección |
| Firma digital | `/orders?status=FIRMADA` | Tab "Firmadas" (existe en `STATUS_TABS`) |

3 de 4 navegables; **Horas operativas queda como KPI informativo** hasta que exista el detalle por servicio.

## Hover / interacción (reutilizado)
Cada KPI navegable se envuelve en:
```
<Link className="nx-interactive block rounded-lg cursor-pointer
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
```
- **`.nx-interactive`** = mismo token de Cockpit, Tesorería, Digital Twin, Tracking, CCTV, RRHH Dashboard → **elevación + glow azul + shadow + cursor pointer + transition corporativa**. No se creó CSS nuevo.
- **Focus visible** por teclado (`focus-visible:ring`).
- Se agregó `h-full` al card interno para que el wrapper `block` no altere la altura en el grid.

## Lo que NO se tocó
- `getDashboardKpis()` (compras y servicios): sin cambios.
- Valores, deltas, sparklines, charts: sin cambios.
- KPIs sin fuente real: no se linkearon (Horas operativas).

## Validaciones
| | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 |
| `/compras`, `/dashboard` | ✅ 307 (gate de auth → operativas) |
| `/compras/ordenes?status=conciliada` | ✅ 307 (filtro real) |
| `/orders?status=FIRMADA` | ✅ 307 (filtro real) |
| Compras KPIs navegables | ✅ 4/4 (fuente real) |
| Servicios KPIs navegables | ✅ 3/4 (Horas operativas excluido por diseño) |
| Hover | ✅ `.nx-interactive` (glow azul, lift, pointer) |
| Focus | ✅ `focus-visible:ring` |
| Sin deep-link falso | ✅ ningún KPI sin detalle real fue linkeado |

> Verificación visual real (hover, navegación con datos productivos) la confirmás vos. Sin commit/push.

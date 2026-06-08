# BANKING-DRILLDOWN-ARCHITECTURE

**Fecha:** 2026-06-08 · **`tsc --noEmit` EXIT 0** · rutas → **307** (gate de auth, operativas).
**Alcance:** Tesorería → Bancos. **Solo navegación + drill-down. No se modificaron cálculos ni saldos** (todo se lee de las vistas/funciones existentes).

## Diseño anterior
`/tesoreria/bancos` mostraba:
- 1 KPI "Saldo total".
- Una **tabla informativa** (Banco · Cuenta · Tipo · Saldo) sin navegación.
- `TransferenciaForm`.

Sin drill-down, sin ficha por banco, sin cuenta corriente individual.

## Diseño nuevo

### 1) Dashboard Bancos — KPIs navegables (`src/app/(app)/tesoreria/bancos/page.tsx`)
Se reemplazó la tabla por **4 KPIs independientes**, cada uno con color corporativo y borde izquierdo:

| KPI | Color | Navegable | Destino |
|---|---|---|---|
| Banco Galicia | Azul (`tops-blue-700`) | ✅ | `/tesoreria/bancos/galicia` |
| Banco Santander | Rojo (`tops-red`) | ✅ | `/tesoreria/bancos/santander` |
| Caja Efectivo | Verde (`status-success`) | ✅ | `/tesoreria/bancos/caja` |
| Saldo Consolidado | Corporativo (`tops-blue-900` / `fg-brand`) | ⛔ | roll-up sin detalle único → no es deep link |

- Cada saldo es un **roll-up de los balances de la vista** `treasury_bank_balances` (mismo patrón `reduce` que ya existía). No se recalcula nada.
- **Hover:** `.nx-interactive` (mismo token de Cockpit/Tracking/Digital Twin/KPIs Tesorería) → lift + glow azul + shadow + cursor pointer. **No se creó CSS nuevo.**
- **Focus:** `focus-visible:ring-2 ring-tops-blue-700`.
- Consolidado NO es navegable por principio (no convertir en deep link un KPI sin fuente de detalle real).

### 2) Ficha del banco — ruta nueva (`src/app/(app)/tesoreria/bancos/[slug]/page.tsx`)
Ruta **dinámica** que resuelve `galicia | santander | caja` (whitelist; otros → `notFound()`). Mapea slug → cuentas reales por `bank_name` / `is_system`.

**Secciones (datos reales, read-only):**

| Sección | Fuente | Contenido |
|---|---|---|
| **Resumen** | `treasury_bank_balances` + `treasury_movements` | Saldo actual (vista, color de la entidad) · Ingresos del mes · Egresos del mes (roll-up de confirmados del período corriente) |
| **Cuenta corriente** | `listMovements({bankAccountId})` | Fecha · Concepto · Débito (egreso) · Crédito (ingreso) · **Saldo corriente** · Estado |
| **Transferencias** | `treasury_movements` (pareo por `transfer_group_id`) | Fecha · Origen · Destino · Importe · Estado |
| **Conciliación** | `status` de movimientos | Conciliados (confirmado) vs Pendientes + listado de pendientes |

- **Saldo corriente (columna):** `saldo_inicial + Σ movimientos confirmados` en orden ascendente. **Reconcilia por construcción** con `treasury_bank_balances.balance` (que se define igual); pendientes/anulados no impactan (saldo = "—"). Es un roll-up de presentación, **no** una re-derivación de la vista. Nota aclaratoria visible al pie de la tabla.
- **Origen/Destino:** se resuelven pareando las dos patas de cada transferencia (mismo `transfer_group_id`): egreso = origen, ingreso = destino; nombre de cuenta desde `bank_accounts` (`is_system` → "Caja Efectivo").
- **Débito/Crédito:** rojo (`tops-red`) / verde (`status-success`); `StatusPill` reutilizado para Estado.
- Degradación: `ModuleUnavailable` si las vistas de tesorería no están (mismo patrón que la página padre).

## Rutas creadas
```
/tesoreria/bancos/galicia      (vía [slug])
/tesoreria/bancos/santander    (vía [slug])
/tesoreria/bancos/caja         (vía [slug])
```
Un único archivo dinámico `[slug]/page.tsx` sirve las tres entidades.

## Reutilización (sin estilos nuevos)
- `.nx-interactive` (hover/glow/lift) — idéntico a Cockpit, Tracking, Digital Twin, KPIs Tesorería.
- `CountUp`, `Kpi`, `StatusPill`, `card`, tokens `text-fg-*`, `tops-*`, `status-*` — todos vigentes.
- Patrón de ficha 360 espejado de los legajos (`/compras/proveedores/[id]`).

## Validaciones
| | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 |
| Rutas `/tesoreria/bancos[/galicia|santander|caja]` | ✅ 307 (gate de auth → operativas) |
| KPIs | ✅ 4 (3 navegables + consolidado) |
| Hover | ✅ `.nx-interactive` (glow azul, lift, pointer) |
| Navegación / Deep links | ✅ galicia/santander/caja |
| Cuenta corriente | ✅ fecha·concepto·débito·crédito·saldo·estado |
| Transferencias | ✅ origen·destino·importe (pareo por grupo) |
| Conciliación | ✅ conciliados vs pendientes |
| Colores | ✅ Galicia azul · Santander rojo · Caja verde · Consolidado corporativo |
| Dark Mode | ✅ tokens tematizados; colores corporativos constantes por diseño |
| Mobile | ✅ KPIs `grid-cols-2`, tablas `overflow-x-auto` |
| Cálculos/saldos | ✅ no modificados (vistas intactas; solo roll-ups de presentación) |

> Verificación visual real (hover, dark mode, datos productivos) la confirmás vos. Sin commit/push.

# TREASURY-KPI-HOVER-INTERACTION

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo affordance visual. Sin tocar lógica/cálculos.

## Componente / token reutilizado
**`.nx-interactive`** (`globals.css`) — el MISMO token que usan las cards navegables del Cockpit (Tracking, Vacancia, Accesos Google, Centro de Monitoreo, Organigrama). **No se duplicó estilo.**

Provee exactamente lo pedido:
- **Hover → elevación:** `transform: translate3d(0, var(--nx-lift-md), 0)`.
- **Glow → borde corporativo:** `::before` con `radial-gradient(var(--nx-accent…))` + `border-color: var(--nx-border…)`.
- **Shadow suave:** `box-shadow: 0 18px 40px -18px var(--nx-glow…)`.
- **Transition 200–250ms ease-out:** `transition: transform/box-shadow/border-color var(--nx-dur-base) var(--nx-ease-out)`.

## Estilos aplicados
KPIs **Cobranzas pendientes** y **Pagos pendientes** del dashboard (`/tesoreria`): el `<Link>` que envuelve cada `<Kpi>` pasó de un `hover:ring` ad-hoc a:
```
nx-interactive block rounded-lg cursor-pointer
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700
```
- `cursor-pointer` → affordance de clic.
- `focus-visible:ring` → accesibilidad (foco por teclado visible).
- Los otros 2 KPIs (Saldo en bancos / Flujo proyectado) **no** son navegables → siguen estáticos (correcto: solo lo navegable se ve interactivo).

## Archivos modificados
- `src/app/(app)/tesoreria/page.tsx` — clases de los 2 `<Link>` de KPIs → `nx-interactive` + focus.

## Validaciones
| | Resultado |
|---|---|
| Desktop | ✅ lift + glow + shadow al hover |
| Mobile | ✅ `nx-interactive` (sin :hover en touch, pero cursor/tap navegan; sin romper layout) |
| Dark Mode | ✅ glow/shadow vía custom props del tema |
| Hover | ✅ elevación + borde corporativo + sombra |
| Focus | ✅ `focus-visible:ring` (teclado) |
| Accesibilidad | ✅ es un `<Link>` (a), focusable, con `title` |
| `tsc` | ✅ EXIT 0 · `/tesoreria` → 307 |

> Reutiliza el token existente; no se inventó ni duplicó estilo. Sin commit/push.

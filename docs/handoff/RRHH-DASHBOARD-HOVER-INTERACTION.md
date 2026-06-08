# RRHH-DASHBOARD-HOVER-INTERACTION

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo affordance visual. **Sin tocar lógica, permisos ni navegación.**
**Componente:** `src/app/(app)/rrhh/page.tsx` (Dashboard RRHH · tarjetas de acceso).

## Componente reutilizado
**`.nx-interactive`** — el MISMO token de los Deep Links de Cockpit, Tesorería, Digital Twin (Magaldi/Luján), Tracking, CCTV, Accesos Google, Organigrama. **No se creó ni duplicó CSS.**
Aporta: **lift** `translate3d(0, var(--nx-lift-md))` (≈ -2px) · **glow** corporativo (`::before` radial + `box-shadow`) · **border-color** resaltado · **transition** `var(--nx-dur-base) var(--nx-ease-out)` (~200ms).

## Estilos aplicados (6 tarjetas)
Empleados · Solicitudes · Novedades · Documentación · Organigrama · Mi Espacio:
```
ANTES:  card p-4 hover:bg-bg-subtle flex items-center gap-2
AHORA:  card p-4 nx-interactive cursor-pointer flex items-center gap-2
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700
```
- **Hover:** elevación + glow corporativo + borde + sombra (de `nx-interactive`).
- **Cursor:** `cursor-pointer`.
- **Focus (teclado):** `focus-visible:ring-2 ring-tops-blue-700` (son `<Link>` → focusables).
- **Transition:** 200–250ms ease-out (token).
- Se reemplazó el `hover:bg-bg-subtle` plano por el token estándar → consistencia absoluta con el resto del sistema.

## Validaciones
| | Resultado |
|---|---|
| Desktop | ✅ lift + glow + sombra al hover |
| Mobile | ✅ cursor/tap navega; sin :hover persistente; layout intacto |
| Dark Mode | ✅ glow/shadow vía custom props del token (tematizado) |
| Hover | ✅ idéntico a Cockpit/Tesorería/Digital Twin |
| Focus | ✅ `focus-visible:ring` por teclado |
| Navegación | ✅ los 6 `<Link>` intactos (href sin cambios) |
| `tsc` | ✅ EXIT 0 · `/rrhh` → 307 |
| Consistencia | ✅ 6/6 tarjetas con `nx-interactive`, 0 `hover:bg-bg-subtle` residual |

## Evidencia
```
grep nx-interactive rrhh/page.tsx → 6   ·   grep hover:bg-bg-subtle → 0
tsc EXIT 0 · /rrhh → 307
```
> Sin cambios de lógica/permisos/navegación. Verificación visual logueada la confirmás vos. Sin commit/push.

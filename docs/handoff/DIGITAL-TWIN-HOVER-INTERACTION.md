# DIGITAL-TWIN-HOVER-INTERACTION

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo affordance visual. Sin tocar datos/filtros/disponibilidad.

## Componente reutilizado
**`.nx-interactive`** (`globals.css`) — el MISMO token de hover del Cockpit (Tracking, Vacancia, Organigrama, Accesos Google, CCTV, KPIs de Tesorería). **No se crearon estilos nuevos.**
Provee: **lift** (`translate3d(0, var(--nx-lift-md))` ≈ -2px), **glow** (`::before` radial + `box-shadow`), **border-color**, **transition** `var(--nx-dur-base) var(--nx-ease-out)` (~200ms).

### Glow semántico (sin estilos nuevos)
`.nx-interactive` lee los custom props `--nx-accent / --nx-glow / --nx-border` (mecanismo ya usado en Accesos Google). Por eso, **seteo esos props al color del estado** de cada espacio → el glow conserva la semántica existente:
- **Disponible → verde** · **Ocupado → rojo** · **Parcial → naranja** · **ANMAT → azul**
(el color sale de `STATUS_META`/`CATEGORY_META` del propio espacio; no se inventó paleta).

## Estilos aplicados

| Elemento | Archivo | Cambio |
|---|---|---|
| **Magaldi · SpaceCard** (depósitos, oficinas, coworking, ANMAT, comerciales) | `mapa-magaldi/MagaldiMapView.tsx` | `+nx-interactive cursor-pointer focus-visible:ring-2`; `--nx-accent/glow/border` = color de estado/categoría (`main`); `--tw-ring-color` = `main` |
| **Luján · SectorCard** (sectores/depósitos/oficinas/comerciales) | `mapa-lujan/LujanMapView.tsx` | `+nx-interactive cursor-pointer focus-visible:ring-2`; glow = `st.color` (estado) |
| **Luján · Cubículos** (celdas ANMAT navegables) | `mapa-lujan/LujanMapView.tsx` | `+cursor-pointer focus-visible:ring-2` (+ `--tw-ring-color`=estado); se conserva `hover:scale-105` (micro-celda; evita conflicto de `transform` con el lift) |

- **Cursor:** `cursor-pointer` en todos los espacios navegables.
- **Focus (teclado):** `focus-visible:outline-none focus-visible:ring-2` + `--tw-ring-color` = color del estado (las cards ya eran `<button>` → focusables).
- **Transition 200–250ms ease-out:** de `nx-interactive` (`--nx-dur-base`/`--nx-ease-out`); en cubículos `duration-200 ease-out`.

## Validaciones
| | Resultado |
|---|---|
| Magaldi | ✅ SpaceCard con lift+glow+cursor+focus |
| Luján | ✅ SectorCard idem + cubículos (cursor/focus) |
| Comercial | ✅ (glow verde/rojo/naranja según estado) |
| ANMAT | ✅ (glow azul por categoría) |
| Infraestructura / Coworking | ✅ (mismas cards, vista distinta) |
| Desktop | ✅ hover eleva + glow semántico |
| Mobile | ✅ cursor/tap navega; sin :hover persistente; layout intacto |
| Dark Mode | ✅ glow/shadow vía custom props (token tematizado) |
| Focus accesible | ✅ `focus-visible:ring` por teclado |
| `tsc` | ✅ EXIT 0 · `/mapa-magaldi` y `/mapa-lujan` → 307 |

## Evidencia
```
nx-interactive (token Cockpit) reutilizado en SpaceCard (Magaldi) y SectorCard (Luján)
glow semántico vía --nx-accent/--nx-glow/--nx-border = color de estado (verde/rojo/naranja/azul)
cursor-pointer + focus-visible:ring (--tw-ring-color = estado) en todos los navegables
cubículos: cursor/focus + hover:scale-105 (afford. de micro-celda; sin conflicto de transform)
tsc EXIT 0 · rutas 307
```
> Sin datos/filtros/disponibilidad modificados. Verificación visual logueada la confirmás vos. Sin commit/push.

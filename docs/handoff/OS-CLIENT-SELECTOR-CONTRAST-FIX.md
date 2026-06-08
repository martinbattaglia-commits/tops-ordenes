# OS-CLIENT-SELECTOR-CONTRAST-FIX

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo experiencia visual/contraste. **No se modificó la lógica de búsqueda ni la carga de clientes.**
**Componente:** `src/app/(app)/orders/new/NewOrderWizard.tsx` (Paso 1 — Cliente · dropdown de búsqueda).

---

## Causa
El dropdown (clientes recientes + resultados de búsqueda) usaba **`bg-white` hardcodeado** + `hover:bg-neutral-50`, y los tags azules `text-tops-blue-700` (#214576, constante). En dark mode → fondo claro con texto que invierte a claro = **baja legibilidad**.

## Estilos anteriores → nuevos

| Elemento | Antes | Después |
|---|---|---|
| Contenedor dropdown | `bg-white ... shadow-md` | `bg-bg-surface ... shadow-lg` (oscuro Nexus en dark) |
| Header ("Recientes/Coincidencias") | `bg-neutral-50` | `bg-bg-surface-alt` |
| Fila — normal | inherit (texto sin color explícito) | razón `text-fg-primary` (blanco en dark) · CUIT `text-fg-secondary` (gris claro, **mejor contraste** que `fg-muted`) |
| Fila — **hover** | `hover:bg-neutral-50` | `hover:bg-bg-surface-alt` + **glow azul** `hover:ring-1 hover:ring-inset hover:ring-tops-blue-700/40` + `cursor-pointer` + `transition-colors` |
| Fila — **seleccionado** | (sin estado) | `bg-tops-blue-700/15` + **borde azul** `ring-1 ring-inset ring-tops-blue-700` + ✓ `check-circle` |
| Fila — **focus** | — | `focus-visible:ring-2 ring-inset ring-tops-blue-700` (teclado) |
| Tag ANMAT | `bg-tops-red/10 text-tops-red` | `bg-tops-red/15 text-tops-red` (más contraste) |
| Tag otros | `bg-tops-blue-700/10 text-tops-blue-700` (navy, ilegible en dark) | `bg-tops-blue-700/15 text-fg-link` (azul que **invierte** → legible en dark) |

> "Seleccionado" se detecta por `c.cuit === data.cuit` (el cliente ya elegido en el form) → resalta cuál está seleccionado **sin tocar la lógica** de `pick()`/búsqueda/carga.

## CUIT
Mantiene visibilidad y mejora contraste: `text-fg-muted` → **`text-fg-secondary`** (gris más fuerte, AA en dark).

## TAGS
Se mantiene la lógica intacta (ANMAT + futuros). Solo se ajustó el color del tag genérico a `text-fg-link` (theme-aware) para legibilidad en dark; ANMAT sigue en rojo corporativo.

---

## Resultado (las 3 percepciones pedidas)
- **Qué cliente está viendo:** razón en blanco + CUIT gris legible, sobre fondo oscuro Nexus.
- **Qué cliente está seleccionado:** borde + fondo azul Nexus + ✓.
- **Qué cliente está por seleccionar:** hover con glow azul + elevación de ring + cursor pointer.

## Validaciones
| | Resultado |
|---|---|
| Desktop | ✅ dropdown oscuro, hover glow, seleccionado resaltado |
| Mobile | ✅ mismas clases (sin :hover persistente en touch; tap selecciona) |
| Dark Mode | ✅ `bg-surface`/`fg-primary`/`fg-link` tematizados (fin del `bg-white`) |
| Búsqueda | ✅ sin cambios de lógica (`filtered` intacto) |
| Selección | ✅ `pick()` intacto; fila seleccionada resaltada |
| Hover | ✅ glow azul + cursor |
| Focus | ✅ `focus-visible:ring` por teclado |
| `tsc` | ✅ EXIT 0 · `/orders/new` → 307 |

> Sin cambios en búsqueda/carga de clientes. Verificación visual logueada la confirmás vos. Sin commit/push.

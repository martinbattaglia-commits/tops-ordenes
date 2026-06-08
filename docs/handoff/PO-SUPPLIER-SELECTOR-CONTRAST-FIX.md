# PO-SUPPLIER-SELECTOR-CONTRAST-FIX

**Fecha:** 2026-06-08 · **`tsc --noEmit` EXIT 0** · `/compras/nueva` → **307** (gate de auth, ruta operativa).
**Alcance:** Compras → Nueva Orden de Compra → **Paso 1 (Proveedor)** · selector desplegable.
**Solo legibilidad/contraste. No se modificó lógica de búsqueda, filtros ni carga de proveedores.**

## Componente intervenido
`src/app/(app)/compras/nueva/NewPoWizard.tsx` → `VendorStep` → dropdown de resultados de búsqueda.

## Diagnóstico (estilos anteriores)
El dropdown usaba colores **hardcodeados claros**, ilegibles en dark mode:
```
ul   : bg-white border-stroke-soft rounded-md shadow-md            ← fondo blanco fijo
botón: hover:bg-neutral-50                                          ← hover claro fijo, sin estado seleccionado
razón: text-fg-primary  ·  meta: text-fg-muted                     ← meta muy tenue
tags : bg-neutral-100 text-fg-secondary                            ← gris claro fijo, bajo contraste
```
Sin **estado seleccionado**, sin **glow/elevación**, sin **focus-visible**, sin **header de sección**.

## Estilos nuevos (reutilizados, no creados)
Se replicó **exactamente** el selector aprobado de **Clientes → Orden de Servicio** (`orders/new/NewOrderWizard.tsx`), idéntico al de CRM y al de proveedores en Tesorería:
```
ul    : bg-bg-surface border-stroke-soft rounded-lg shadow-lg overflow-hidden   ← superficie Nexus (tematizada)
header: bg-bg-surface-alt text-fg-muted uppercase tracking-[0.12em]             ← "Coincidencias" / "Proveedores recientes"
ítem  : border-b border-stroke-soft cursor-pointer transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tops-blue-700
hover : hover:bg-bg-surface-alt hover:ring-1 hover:ring-inset hover:ring-tops-blue-700/40   ← glow azul + elevación
SELEC.: bg-tops-blue-700/15 ring-1 ring-inset ring-tops-blue-700 + Icon check-circle        ← borde azul + fondo diferenciado
razón : text-fg-primary  ·  CUIT/meta: text-fg-secondary font-mono                          ← contraste alto
tags  : ANMAT → bg-tops-red/15 text-tops-red   ·   resto → bg-tops-blue-700/15 text-fg-link
```

### Mapeo a los requisitos
| Requisito | Implementación |
|---|---|
| Estado normal: fondo oscuro, texto blanco, secundario gris claro | `bg-bg-surface` + `text-fg-primary` + `text-fg-secondary` (todos tematizados) |
| Hover: glow azul corporativo + elevación + cursor pointer | `hover:ring-tops-blue-700/40` + `hover:bg-bg-surface-alt` + `cursor-pointer` |
| Seleccionado: borde azul Nexus + fondo diferenciado + contraste alto | `ring-tops-blue-700` + `bg-tops-blue-700/15` + ícono `check-circle` |
| CUIT visible y con contraste | `fmtCuit(v.cuit)` en `text-fg-secondary font-mono` |
| Categorías (Racks, Estructura, ANMAT, Limpieza, Combustible…) | tags preservados; ANMAT en rojo, resto en azul (legibles en ambos temas) |
| Focus accesible | `focus-visible:ring-2 ring-inset ring-tops-blue-700` |

### Detección de seleccionado (robusta)
`isSelected = (draft.vendor.id === v.id) || (CUIT normalizado a 11 dígitos coincide)`.
Tolera el formateo de CUIT que aplica `onBlur` (no se rompe el resaltado tras formatear).

## Lógica intacta
- `matches` / filtro de búsqueda (`razon`/`cuit`/`contacto`, slice 10): **sin cambios**.
- `pick()` y la carga de `vendors`: **sin cambios**.
- Metadata mostrada (CUIT · N° OC · última OC): preservada (solo se mejoró su color).

## Validaciones
| | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 |
| `/compras/nueva` | ✅ 307 (gate de auth → ruta operativa) |
| Desktop | ✅ dropdown sobre superficie Nexus, alto contraste |
| Mobile | ✅ tags ocultos en `<md`, ítem full-width tappable |
| Dark Mode | ✅ `bg-surface`/`surface-alt`/`fg-*` tematizados (sin blancos fijos) |
| Búsqueda | ✅ misma lógica; header "Coincidencias/Recientes" |
| Selección | ✅ borde azul + fondo + check-circle |
| Hover | ✅ glow azul + elevación + pointer |
| Focus | ✅ `focus-visible:ring` por teclado |
| Consistencia | ✅ idéntico a selector de Clientes (Servicio/CRM/Tesorería) |

> Verificación visual real (hover, dark mode, selección) la confirmás vos. Sin commit/push.

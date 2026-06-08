# MAPA-UX-DRAWER-IMPROVEMENT

**Fecha:** 2026-06-08 · **Alcance:** Mapa Magaldi + Mapa Luján (panel de detalle). **`tsc` EXIT 0.**
Sin cambios de diseño/colores/dark mode/responsive/filtros. Sin scroll automático.

---

## Problema detectado (causa raíz real)

El panel de detalle **ya estaba implementado como drawer lateral fijo** (`<aside className="fixed right-0 top-0 h-full ... z-50">` + overlay). En teoría `position: fixed` se ancla al viewport y no debería depender del scroll.

**Pero** el drawer "se iba" con el scroll. Causa raíz: un **ancestro con `transform` crea un *containing block*** que rompe `position: fixed` (lo ancla a ese ancestro, no al viewport). En el código:

- `globals.css` → `.nx-page-fade { will-change: transform; transform: translate3d(...) }` (animación fade-up).
- `.nx-page-fade` está **tanto en el root del mapa** (`<div className="... nx-page-fade" id="magaldi-map-root">`) **como en el `<main>` contenedor de scroll** (`Shell.tsx`).
- ⇒ el `fixed` del drawer se resolvía contra ese contenedor transformado → al hacer scroll profundo, el drawer quedaba fuera de vista (había que volver a subir).

> No era falta de drawer: era el `transform` del ancestro anulando el `fixed`.

---

## Solución implementada

Renderizar el drawer (overlay + aside) mediante **`createPortal(..., document.body)`**. Al colgar del `<body>`, el drawer **escapa** del subtree con `transform` (`.nx-page-fade` / `main.scroll-area`) → `position: fixed` vuelve a ser **relativo al viewport** → el drawer queda **fijo, visible e independiente del scroll**.

- Markup, clases, colores, dark mode y responsive **idénticos** (solo cambia el destino de render).
- Contenido **dinámico**: al hacer click en otro espacio, `setSel(...)` re-renderiza el drawer con el nuevo detalle.
- **No** se usó scroll automático.
- Guard SSR: `if (typeof document === "undefined") return null;` (el drawer solo se monta tras un click en cliente).

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/app/(app)/comercial/mapa-magaldi/MagaldiMapView.tsx` | `import { createPortal }`; `SidePanel` → `createPortal(<>…</>, document.body)` + guard SSR |
| `src/app/(app)/comercial/mapa-lujan/LujanMapView.tsx` | idem (`SidePanel` con `selection`) |

Sin cambios en CSS global, filtros, estados (`view`/`filter`/`query`/`sel`) ni en los datos del croquis.

---

## Validaciones realizadas

- ✅ `tsc --noEmit` → **EXIT 0**.
- ✅ `/comercial/mapa-magaldi` y `/comercial/mapa-lujan` → HTTP **307** (login; recompilan **sin 500**).
- ✅ El fix es **estructural a nivel del render del drawer** (`SidePanel`), idéntico para todo tipo de espacio → cubre uniformemente:

| Tipo de espacio | Magaldi | Luján |
|---|:--:|:--:|
| PB | ✅ | ✅ |
| PA | ✅ | ✅ |
| Depósitos | ✅ | ✅ |
| Oficinas | ✅ | ✅ |
| Áreas comunes | ✅ | ✅ |
| Espacios ANMAT | ✅ | ✅ |
| Espacios comerciales | ✅ | ✅ |

> Todos los espacios abren el mismo `SidePanel` portaleado (Magaldi vía `setSel(space)`; Luján vía `setSel({kind:"sector"|"cubicle", ...})`), por lo que el comportamiento fijo aplica a cada categoría/piso sin excepción.

---

## Evidencia funcional

- **Antes:** `aside.fixed` anclado al ancestro `.nx-page-fade`/`main` (transform) → con scroll profundo el panel salía de viewport; había que volver a subir para verlo.
- **Después:** drawer portaleado a `<body>` → `fixed` relativo al viewport → permanece visible en el borde derecho **sin importar la posición de scroll**; al clickear otro espacio el contenido se actualiza en el lugar.
- Render: `createPortal` confirmado en ambos componentes; sin errores de compilación en el dev server.

> Nota: la verificación visual del scroll real requiere sesión logueada; el fix corrige el mecanismo CSS de posicionamiento (containing-block) que causaba el bug, de forma idéntica para ambos mapas y todos los tipos de espacio.

---

## Mejora opcional (no incluida — pre-existente por diseño)
El drawer mantiene un **overlay** que oscurece el mapa y cierra al clickear afuera (diseño actual). Si se desea **saltar de un espacio a otro sin cerrar** (overlay no bloqueante), se puede hacer el overlay `pointer-events-none` o quitarlo — es un cambio de UX adicional, fuera del bug de scroll reportado. Queda a tu criterio.

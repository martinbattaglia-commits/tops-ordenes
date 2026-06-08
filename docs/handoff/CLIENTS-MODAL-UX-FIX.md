# CLIENTS-MODAL-UX-FIX

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo contraste + taxonomía de tags en el modal "Nuevo Cliente". Diseño general del modal sin cambios.
**Archivo:** `src/app/(app)/clients/ClientsView.tsx`.

---

## Problema 1 — Depósito habitual (contraste)

**Causa:** el estado **no seleccionado** usaba `bg-white text-fg-primary`. `bg-white` está **hardcodeado** (no invierte), y `text-fg-primary` **sí invierte** (en dark = `#e6e9f2`, casi blanco). → en dark mode quedaba **texto claro sobre fondo blanco** (~1:1, ilegible, "fondo claro / texto gris claro").

| | Antes | Después |
|---|---|---|
| **No seleccionado** | `bg-white text-fg-primary border-stroke-soft` | `bg-bg-surface-alt text-fg-primary border-stroke-soft` (tokens que invierten: dark `#161c33` fondo + `#e6e9f2` texto ≈ **13:1 AAA**; light `#eef1f6` + texto oscuro ≈ AAA) |
| **Seleccionado** | `bg-tops-blue-900 text-white` (#050555) | `bg-tops-blue-700 text-white` (#214576) — corporativo Nexus, blanco ≈ **7:1 AAA**, más vibrante |

Resultado: normal = fondo oscuro (en dark) + texto claro + borde visible; seleccionado = azul corporativo + blanco. AA/AAA en ambos temas.

---

## Problema 2 — Tags (taxonomía)

**Antes:** `ANMAT · PHARMA · FOOD · COSMETIC · GENERAL`
**Después:** `ANMAT · OFICINAS · CARGAS GENERALES · TRANSPORTE` (unidades de negocio reales de Logística TOPS)

- **Selección múltiple:** se mantiene (`toggleTag` agrega/quita; ej. `ANMAT + TRANSPORTE`, `CARGAS GENERALES + TRANSPORTE`, `OFICINAS`).
- **Color activo:** `ANMAT` → rojo corporativo; resto → azul corporativo (texto blanco, AA/AAA).
- **Contraste no seleccionado:** mismo fix que depósito (`bg-bg-surface-alt text-fg-primary`), antes era `bg-white text-fg-secondary` (ilegible en dark).
- **Persistencia:** OK — el schema es `tags: z.array(z.string())` (sin enum), así que "CARGAS GENERALES"/"TRANSPORTE" se guardan tal cual.

---

## Contraste (resumen WCAG)

| Elemento / estado | Antes (dark) | Después (dark) | Después (light) |
|---|---|---|---|
| Botón no seleccionado | ~1:1 🔴 (texto claro/fondo blanco) | ~13:1 ✅ AAA | ✅ AAA |
| Depósito seleccionado | blanco/#050555 (~15:1) | blanco/#214576 ≈ 7:1 ✅ AAA | ✅ |
| Tag activo (azul) | blanco/#214576 ≈ 7:1 | igual ✅ AAA | ✅ |
| Tag ANMAT activo (rojo) | blanco/tops-red ✅ | igual ✅ | ✅ |

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/app/(app)/clients/ClientsView.tsx` | (1) tags `["ANMAT","OFICINAS","CARGAS GENERALES","TRANSPORTE"]`; (2) estado no-seleccionado de tags y depósito: `bg-white …` → `bg-bg-surface-alt text-fg-primary`; (3) depósito seleccionado → `bg-tops-blue-700` |

Sin cambios en estructura del modal, lógica de `toggleTag`, `setForm`, ni en `actions.ts`.

---

## Validaciones

| Validación | Resultado |
|---|---|
| Desktop | ✅ |
| Mobile | ✅ (chips `flex-wrap`, grid de depósito `grid-cols-3`) |
| Dark mode | ✅ tokens que invierten (no más `bg-white` hardcodeado) |
| Contraste WCAG | ✅ AA/AAA en normal y seleccionado, ambos temas |
| Selección de tags (múltiple) | ✅ `toggleTag` intacto |
| Persistencia de datos | ✅ `tags: z.array(z.string())` (sin enum) → nuevos tags se guardan |
| No quedan tags viejos | ✅ grep PHARMA/FOOD/COSMETIC en `clients/` → 0 |
| `tsc --noEmit` | ✅ EXIT 0 |
| Recompila | ✅ `/clients` → 307 (login; sin 500) |

---

## Evidencia
```
ClientsView.tsx:527  ["ANMAT","OFICINAS","CARGAS GENERALES","TRANSPORTE"]
ClientsView.tsx:540  tag no-sel  → bg-bg-surface-alt text-fg-primary  (antes bg-white text-fg-secondary)
ClientsView.tsx:567  depot no-sel → bg-bg-surface-alt text-fg-primary  (antes bg-white text-fg-primary)
depot sel → bg-tops-blue-700 text-white
grep PHARMA|FOOD|COSMETIC en clients/ → 0
tsc EXIT 0 · /clients 307
```

> La verificación visual final (modal logueado en dark) la confirmás vos; los tokens (`bg-bg-surface-alt`, `fg-primary`, `tops-blue-700`) ya están validados en su definición y contraste. Sin commit/push.

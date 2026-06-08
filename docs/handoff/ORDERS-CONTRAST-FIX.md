# ORDERS-CONTRAST-FIX

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Cambio de **1 regla CSS** (token de color). Sin tocar lógica/datos/diseño general.

---

## Problema (causa raíz)

Los IDs `OC-xxxx` / `OS-xxxx` usan la clase `.order-num`, que aplicaba **`text-tops-blue-900`**:

```css
/* ANTES */
.tbl .order-num { @apply font-mono font-bold text-tops-blue-900; }
```

`--tops-blue-900: #050555` es un **token constante** (NO se invierte en dark mode — solo `--fg-brand`/`--fg-link` lo hacen). Sobre el fondo dark `--bg-surface: #11162a`, el navy `#050555` queda **casi igual al fondo** → ilegible, "parece deshabilitado".

Además, la regla estaba **scoped a `.tbl`**, así que en las **cards mobile** (`.order-num` suelto) ni siquiera tomaba color de marca.

---

## Solución

```css
/* DESPUÉS */
.order-num,
.tbl .order-num {
  @apply font-mono font-bold text-fg-link transition-colors;
  cursor: pointer;
}
.order-num:hover,
.tbl .order-num:hover { @apply underline; }
```

- Usa **`--fg-link`**, el token corporativo de enlace que **SÍ invierte** según el tema → siempre legible.
- Cubre **tabla desktop** (`.tbl`) **y cards mobile** (`.order-num` suelto).
- **Interactivo:** `cursor: pointer` + `hover:underline`. Los IDs ya son `<Link>` al detalle (`/compras/ordenes/{id}`, `/orders/{id}`), así que el hover/cursor es coherente con la navegación existente.

---

## Color anterior vs nuevo + contraste

| | Token | Light | Dark | Contraste dark (sobre `#11162a`) |
|---|---|---|---|---|
| **Anterior** | `--tops-blue-900` (constante) | `#050555` | `#050555` | **≈1.1:1** 🔴 (falla — casi invisible) |
| **Nuevo** | `--fg-link` (invierte) | `#214576` | `#6da3e6` | **≈6.9:1** ✅ (AA, cerca de AAA) |

- **Dark** (`#6da3e6` sobre `#11162a`): **6.9:1 → AA** (umbral 4.5).
- **Light** (`#214576` sobre `#ffffff`): **9.6:1 → AAA**.
- Antes en dark: `#050555` sobre `#11162a` ≈ **1.1:1** (reprobado).

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/app/globals.css` | `.order-num` (desktop + mobile): `text-tops-blue-900` → `text-fg-link` + `cursor-pointer` + `hover:underline` |

No se tocaron las páginas (`compras/ordenes/page.tsx`, `orders/page.tsx`) — ya usaban `className="order-num"` y `<Link>`. Sin cambios de datos/lógica.

---

## Validaciones

| Validación | Resultado |
|---|---|
| Órdenes de Compra (`/compras/ordenes`) | ✅ IDs OC-xxxx en `--fg-link` (desktop tabla + mobile card) |
| Órdenes de Servicio (`/orders`) | ✅ IDs OS-xxxx idem |
| Desktop | ✅ regla `.tbl .order-num` |
| Mobile | ✅ regla general `.order-num` (antes no aplicaba) |
| Dark mode | ✅ `#6da3e6` (AA 6.9:1) |
| Light mode | ✅ `#214576` (AAA 9.6:1) |
| Hover / cursor | ✅ `underline` + `cursor-pointer` (navegan al detalle) |
| `tsc --noEmit` | ✅ EXIT 0 |
| Recompila | ✅ `/compras/ordenes` y `/orders` → 307 (login; sin 500) |

---

## Evidencia

```
globals.css .order-num: text-tops-blue-900 (#050555, constante)  →  text-fg-link (#6da3e6 dark / #214576 light)
contraste dark: 1.1:1 (FAIL)  →  6.9:1 (AA)
contraste light: ~16:1  →  9.6:1 (AAA)   [ambos legibles; el problema era solo dark]
rutas /compras/ordenes y /orders → 307 (recompilan sin 500)
```

> Los números de orden ahora se leen claramente, se destacan (azul de enlace, no navy apagado), son consistentes con el token corporativo de Nexus y son interactivos. La comprobación visual final (ver el color en pantalla logueado) la confirmás vos; el token `--fg-link` ya está validado en su definición y contraste. Sin commit/push.

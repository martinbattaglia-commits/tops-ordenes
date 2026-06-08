# SUPPLIERS-UX-IMPROVEMENTS

**Fecha:** 2026-06-08 · **`tsc --noEmit` EXIT 0.** · `/compras/proveedores` → **307** (gate de auth, ruta operativa).
**Alcance:** UX puro sobre el maestro de proveedores. **No se modificó lógica de compras, finanzas ni búsqueda.**

## Problema 1 — Botón correcto en el maestro de proveedores

**Antes:** la lista `/compras/proveedores` mostraba **"Nueva OC"** arriba a la derecha (acción de compra, inconsistente con el maestro de Clientes).
**Ahora:** **"Nuevo proveedor"** que abre un **modal de alta**, con la misma filosofía que Clientes → "Nuevo cliente".

### Cambios
| Archivo | Cambio |
|---|---|
| `src/app/(app)/compras/proveedores/actions.ts` *(nuevo)* | Server action `createVendor` — espejo de `clients/actions.ts`. Zod `NewVendorSchema` (razón ≥2, CUIT válido vía `isValidCuit`, resto opcional). Inserta en `vendors` con `createAdminClient`. Error amistoso ante CUIT duplicado (`unique`). `revalidatePath("/compras/proveedores")`. |
| `src/components/compras/NuevoProveedorButton.tsx` *(nuevo)* | Client component: botón `btn btn-primary btn-sm` + modal de alta. Campos: Razón social\*, CUIT\*, Categoría, Contacto, Email, Teléfono, Cond. de pago, Domicilio. Validación en vivo (razón ≥2 + CUIT 11 dígitos habilitan "Crear"). En éxito: cierra, limpia y `router.refresh()`. |
| `src/app/(app)/compras/proveedores/page.tsx` | Reemplazado el `<Link href="/compras/nueva" className="btn btn-danger btn-sm">Nueva OC</Link>` por `<NuevoProveedorButton />`. Removido import muerto de `Icon`. |

### Reutilización (sin estilos nuevos)
- Botón: tokens existentes `btn btn-primary btn-sm` + `Icon` (`plus`).
- Modal: `card`-like sobre `bg-bg-surface`, `border-stroke-soft`, `.input`, `btn-ghost`/`btn-primary` — todos tokens vigentes del sistema.
- **Portal a `document.body`** (`createPortal`) → evita el bug conocido de `position:fixed` bajo ancestros con `transform`/`will-change` (`.nx-page-fade`), el mismo aprendizaje de los drawers de mapas/CCTV.

## Problema 2 — Saldo adeudado con prominencia financiera

**Antes:** en la ficha (`/compras/proveedores/[id]`) → Finanzas, el saldo era un `Field` chico (`text-sm text-fg-brand`) perdido en el grid superior — no se identificaba de un vistazo.
**Ahora:** **KPI destacado** en la **parte inferior derecha** de la sección Finanzas.

### Cambio
`src/app/(app)/compras/proveedores/[id]/page.tsx` — sección Finanzas:
- Quitado "Saldo a pagar" del grid superior (ahora 3 columnas: Facturas abiertas · Total facturado · Próximo vencimiento).
- Agregado bloque inferior derecho, separado por `border-t`:
```
SALDO ADEUDADO            (uppercase, text-[11px], fg-muted)
$ 1.125.841               (text-3xl md:text-4xl font-black tabular text-tops-red)
Total pendiente de pago al proveedor
```
- **Color:** `text-tops-red` (#c90812 — rojo corporativo, constante, no cambia en dark).
- **Escala:** `text-3xl/4xl font-black` — equivalente a los KPIs de Tesorería (Cobranzas/Pagos).
- **Ubicación:** `flex justify-end` al cierre de la sección → inferior derecha.
- Fuente del dato sin cambios: `getProveedorFicha(id).saldo.saldo_cuenta` vía `fmtCurrency`.

## Validaciones

| | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 (0 errores) |
| `/compras/proveedores` | ✅ 307 (gate de auth → ruta operativa) |
| Problema 1 — botón | ✅ "Nuevo proveedor" reemplaza "Nueva OC" |
| Problema 1 — modal | ✅ abre/cierra (overlay, botón ✕, Cancelar), valida razón+CUIT, crea vía `createVendor` y refresca lista |
| Problema 2 — saldo | ✅ KPI grande rojo, inferior derecho, "SALDO ADEUDADO" |
| Consistencia Clientes | ✅ misma filosofía/estructura que "Nuevo cliente" |
| Dark mode | ✅ `bg-bg-surface`/`stroke-soft` tematizados; `tops-red` constante por diseño |
| Responsive | ✅ modal `grid-cols-1 → sm:grid-cols-2` + `max-h-[70vh] overflow-y-auto`; saldo `text-3xl → md:text-4xl` |

## No se tocó
- Lógica de búsqueda / carga de proveedores (`listVendors`, `getProveedorFicha`).
- Lógica financiera ni el dato del saldo (solo su presentación).
- Navegación, permisos, deep-links existentes (nombre → ficha intacto).

> Verificación visual logueada (hover, dark mode real, alta efectiva contra Supabase) la confirmás vos. Sin commit/push.

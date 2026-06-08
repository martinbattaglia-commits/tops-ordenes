# CCTV-CAMERA-EXPANDED-VIEW

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo UI (client component). **No se tocó Hikvision/API/snapshots/NVR.**

---

## Problema

Las miniaturas del Centro de Monitoreo eran chicas y, aunque el tile tenía `cursor-pointer`/hover, **no tenía `onClick`** → al hacer click no pasaba nada.

## Solución implementada

**Modal fullscreen** al hacer click en cualquier cámara (D4, 501, etc.):
- Se agregó `onClick` (+ accesible con teclado: `Enter`/`Espacio`, `role="button"`, `tabIndex`) en cada tile.
- El modal se renderiza vía **`createPortal(document.body)`** → `fixed inset-0` real (fullscreen sobre toda la app, no afectado por contenedores con transform).
- **Contenido del modal:** snapshot **ampliado** (`object-contain`, hasta `max-w-5xl` / aspect-video), **nombre** de cámara, **canal** (`D{channelNumber}`), **estado** (Online/Offline/Conectando), **timestamp** del snapshot, + resolución y codec.
- **Refresco:** el snapshot del modal se actualiza cada 10s (mismo proxy `/api/cctv/snapshot/{id}`, sin tocar la integración).
- **Cierre:** botón ✕, click en el backdrop, y tecla **Esc**.
- **UX:** dark mode + diseño Nexus (clases `bg-tops-blue-900`, `border-white/10`, `status-*`, etc.), responsive (desktop/mobile), `cursor-pointer` + hover (lupa de "ampliar" al pasar el mouse).

### Lógica compartida sin duplicar
Se extrajo un hook `useSnapshot(camId, active)` reutilizado por el tile y el modal (mismo fetch HEAD → set `src`/`status`/`error`/`stamp`). El tile mantiene su `IntersectionObserver` (refresca solo si visible); el modal refresca siempre mientras está abierto.

### "Ver en vivo" (opcional) — N/A
No existe URL de streaming expuesta: el módulo solo tiene el **proxy de snapshot** (`/api/cctv/snapshot/{id}`), no un endpoint de stream/RTSP web. Por eso **no se agregó** el botón "Ver en vivo" (el requisito era condicional a que existiera la URL). El snapshot ampliado se auto-refresca cada 10s como "casi-vivo".

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/app/(app)/cctv/CctvGrid.tsx` | `onClick`→abre modal; `CameraModal` (portal, snapshot ampliado + metadata + Esc/backdrop); hook `useSnapshot` compartido; hint de lupa en hover |

**No tocado:** `lib/cctv/hikvision.ts`, `/api/cctv/*`, snapshots, NVR, `cctv/page.tsx` (server).

---

## Validaciones

| Validación | Resultado |
|---|---|
| Apertura del modal (click en cámara) | ✅ `onClick`/Enter/Espacio en cada tile |
| Cierre del modal | ✅ botón ✕ · click backdrop · tecla **Esc** |
| Múltiples cámaras | ✅ cada grid maneja su `selected`; abre la cámara clickeada (D4, 501, etc.) |
| Responsive desktop | ✅ `max-w-5xl` centrado, aspect-video |
| Responsive mobile | ✅ `p-4` + `grid place-items-center`; metadata con wrap (`flex-wrap`) |
| Dark mode / Nexus | ✅ paleta `tops-blue-900` / `status-*`, sin estilos nuevos |
| `tsc --noEmit` | ✅ EXIT 0 |
| Recompila | ✅ `/cctv` → HTTP 307 (login; sin 500) |

---

## Evidencia funcional

- Click en tile → modal portaleado a `document.body`, `fixed inset-0 z-[60]` (fullscreen real, sobre topbar/sidebar).
- Snapshot ampliado del mismo proxy real (sin cambiar Hikvision): `/api/cctv/snapshot/{cam.id}?t=<ts>` (HEAD para validar, luego `<img>`).
- Metadata mostrada: `D{channelNumber}`, nombre, estado (color por status), resolución `W×H`, codec, **timestamp** del snapshot (`toLocaleString es-AR`).
- Cierre por Esc/backdrop/✕ verificado en código (listener `keydown` + `onClick` backdrop con `stopPropagation` en el contenido).

> Nota: la verificación visual final (ver la imagen ampliada de una cámara real) requiere sesión logueada + NVR alcanzable; la lógica usa el mismo proxy que las miniaturas (que ya funcionan), por lo que el modal muestra exactamente el mismo feed, ampliado. Sin commit/push.

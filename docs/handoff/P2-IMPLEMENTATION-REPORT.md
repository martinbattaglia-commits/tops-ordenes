# P2-IMPLEMENTATION-REPORT

**Fecha:** 2026-06-08 · P2 — "Reserva directa desde el mapa". Estado: **implementado, tsc PASS, build PASS, dev sirviendo**.

## Alcance entregado
Mapa → click unidad → SidePanel → "Reservar unidad" (solo si `disponible`) → deep link → CRM360 → pestaña **Capacidad** con la unidad **preseleccionada** → confirmar reserva (`crm_reserve_units`) → el mapa cambia de color. Cualquier unidad disponible es convertible en oportunidad con un único click.

## Cambios por archivo
| Archivo | Cambio |
|---|---|
| `mapa-magaldi/MagaldiMapView.tsx` | `import Link`; SidePanel emite botón "Reservar unidad" (verde `#16a34a`, `.nx-interactive`) con deep link cuando `state==='disponible'`; si no, `"<label> · sin acción"`. |
| `mapa-lujan/LujanMapView.tsx` | idem en `SectorDetail` y `CubicleDetail`; clave de unidad sector=`code`, cubículo=`"<block>-<cubicle>"`. |
| `oportunidades/OpportunitiesView.tsx` | `useSearchParams`; banner **"Reserva desde el mapa"** (unidad·sede·cat·m²); propaga `?resSite&resUnit&resCat&resM2` a los **3** links de ficha (empresa, "Ficha 360°", tarjeta Kanban). |
| `oportunidades/[id]/page.tsx` | acepta `searchParams`; construye `prefill` (valida site+unit); lo pasa a `Opportunity360View`. |
| `oportunidades/[id]/Opportunity360View.tsx` | nueva interfaz `CapacityPrefill`; prop `prefill`; tab inicial = `capacidad` si hay prefill válido; `CapacidadTab` recibe `prefill`, fija `initialSite`, preselecciona la unidad si sigue disponible, y muestra banner de precarga. |

## Verificación técnica
- `npx tsc --noEmit` → **EXIT 0** (sin errores de tipo).
- `NODE_OPTIONS=--max-old-space-size=4096 next build` → **EXIT 0**. Rutas `/comercial/oportunidades` y `/comercial/oportunidades/[id]` compilan como **`ƒ (Dynamic)`** (server-rendered on demand) → `useSearchParams` no dispara bailout de prerender ni requiere Suspense. Sin warnings.
- Build corrido con dev detenido y `.next` movido aparte (procedimiento estándar); dev reiniciado en `:3030` (`Ready in ~1.2s`), CSS OK.
- Smoke: `GET /comercial/oportunidades?resSite=MAGALDI_1765&resUnit=OF-PA1&resCat=oficinas&resM2=45` → `307` (redirect a login, esperado sin sesión); **sin 500**.

## Validaciones funcionales pendientes (acción del usuario, sesión real)
El asistente **no** ejecuta escrituras en prod; la reserva real la confirma el usuario logueado.

- **Caso 1 — disponible → CRM360 prefilled:** abrir `/comercial/mapa-magaldi`, click en **OF-PA1** (verde) → "Reservar unidad" → cae en Oportunidades con banner; abrir una oportunidad → pestaña Capacidad abierta con **OF-PA1 preseleccionada**. ✅ esperado.
- **Caso 2 — reservar → OK → mapa cambia color:** en Capacidad, confirmar "Reservar unidad" → `crm_reserve_units` OK → volver a `/comercial/mapa-magaldi` (refresh) → OF-PA1 pasa a **amarillo** (reservada). ✅ esperado.
- **Caso 3 — segundo intento → UNIT_ALREADY_RESERVED:** intentar reservar la misma unidad desde otra oportunidad → mensaje **"Unidad ya reservada."** (mapea `UNIT_ALREADY_RESERVED`). ✅ esperado.

> En Magaldi, **PB30** ya está `reservada` (OPP-2026-0003, de la prueba real de E2): sirve como evidencia de Caso 3 — en el mapa figura amarillo y el SidePanel muestra "Reservada · sin acción" (sin botón).

## Garantías de diseño
- El mapa **nunca** reserva: solo enlaza. La escritura es siempre la acción confirmada en CRM360 vía `crm_reserve_units` (único camino, atómico).
- Precarga defensiva: solo preselecciona si la unidad **sigue** `disponible` en `crm_units`; si no, avisa y obliga a reelegir (no promete una reserva que el RPC rechazaría).
- UX reutiliza tokens Nexus existentes (`.nx-interactive`, colores `UNIT_STATE_COLOR`); sin estilos nuevos.

## Entregables P2
1. `MAP-TO-CRM-DEEPLINK.md` — contrato del deep link. ✅
2. `CRM360-PREFILL-ARCHITECTURE.md` — cadena de precarga server→client. ✅
3. `DIGITAL-TWIN-COMMERCIAL-FLOW.md` — flujo comercial end-to-end. ✅
4. `P2-IMPLEMENTATION-REPORT.md` — este documento. ✅

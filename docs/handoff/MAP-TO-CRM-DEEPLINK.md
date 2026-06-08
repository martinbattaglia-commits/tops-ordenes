# MAP-TO-CRM-DEEPLINK

**Fecha:** 2026-06-08 · P2 — "Reserva directa desde el mapa". Contrato del deep link Mapa → CRM360.

## Objetivo
Convertir cualquier unidad **disponible** del Digital Twin en una oportunidad comercial **con un solo click**, sin que el comercial vuelva a buscar la unidad en CRM360.

## Flujo
```
Mapa (Magaldi / Luján)
  → click en unidad
  → SidePanel: Estado · Categoría · m² · Cliente actual (si existe)
  → botón "Reservar unidad"  (solo si state = disponible)
  → deep link
  → /comercial/oportunidades?resSite&resUnit&resCat&resM2
  → (elegir / abrir oportunidad)
  → Ficha 360° pestaña Capacidad con la unidad YA seleccionada
  → "Reservar unidad" (crm_reserve_units) → el mapa cambia de color
```

## Contrato del query string
| Param | Origen Magaldi | Origen Luján | Significado |
|---|---|---|---|
| `resSite` | `"MAGALDI_1765"` | `"PEDRO_LUJAN_3159"` | sede (check de `crm_units.site`) |
| `resUnit` | `space.id` (OF-PA1, PB1…) | sector `sector.code` · cubículo `"<block.code>-<cubicle.code>"` | **clave de join** = `crm_units.unit_code` |
| `resCat` | `space.category` | sector `sector.category` · cubículo `anmat` | categoría (`crm_service_t`) — informativo |
| `resM2` | `space.m2` | sector `sector.surfaceM2` · cubículo `cubicle.surfaceM2` | superficie — informativo |

`resUnit` se emite con `encodeURIComponent(...)` (los cubículos contienen `+` y `-`).
`resM2` solo se agrega si hay valor (`m2 != null`).

## Visibilidad del botón (regla única)
- `state === "disponible"` → botón **"Reservar unidad"** (verde `#16a34a`, `.nx-interactive`, `cursor-pointer`, focus-ring).
- cualquier otro estado (`reservada` / `ocupada` / `bloqueada` / `no_comercializable`) → texto `"<label> · sin acción"`, **sin** botón. No se puede iniciar una reserva sobre una unidad no disponible desde el mapa.

## SidePanel — datos mostrados
Estado (color + label de `UNIT_STATE_LABEL`/`UNIT_STATE_COLOR`), Categoría, m² (geometría estática), y **Cliente actual** si la unidad tiene `ocupado_por`/oportunidad asociada. El estado/color sale de `crm_units` (fuente única, E4); la geometría/m² del modelo estático.

## Archivos
- `src/app/(app)/comercial/mapa-magaldi/MagaldiMapView.tsx` — SidePanel emite el deep link.
- `src/app/(app)/comercial/mapa-lujan/LujanMapView.tsx` — SectorDetail + CubicleDetail emiten el deep link.
- `src/app/(app)/comercial/oportunidades/OpportunitiesView.tsx` — lee los params, muestra banner "Reserva desde el mapa" y **propaga** el query string a los 3 links de ficha (empresa, "Ficha 360°", tarjeta Kanban).

## Por qué query string y no estado de servidor
El deep link es idempotente, compartible y sobrevive al login (se preserva en el redirect 307 → login → vuelta). No escribe nada: la reserva real recién ocurre cuando el comercial confirma en la pestaña Capacidad (`crm_reserve_units`, atómico). El mapa nunca reserva por sí solo.

# CRM360-CAPACITY-UX-PLAN (E3 · UX de la pestaña Capacidad)

**Fecha:** 2026-06-08 · Diseño de la Capacity Tab leyendo `crm_units`. No implementado.

## Encabezado — contadores por los 5 estados (del sitio)
```
[ Disponible N ] [ Reservada N ] [ Ocupada N ] [ Bloqueada N ] [ No comercializable N ]
```
Colores (consistentes con el sistema):
- Disponible → verde (status-success)
- Reservada → ámbar (status-warning)
- Ocupada → rojo (tops-red)
- Bloqueada → gris (fg-muted)
- No comercializable → gris tenue / rayado

Fuente: `getUnitCounts(site)`.

## Selector de reserva — sólo unidades DISPONIBLES reales
- Lista de `getAvailableUnits(site, category)` → cada unidad: `unit_code · tipo · m2 · floor`.
- Multiselección (checkbox). Reemplaza el input de texto libre actual.
- Botón "Reservar" → `reserveCapacity(oppId, { site, units: <unit_codes seleccionados> })` → `crm_reserve_units` (atómico).
- Si una unidad fue tomada por otra oportunidad entre el render y el submit → el backend responde `UNIT_ALREADY_RESERVED` → toast **"Unidad ya reservada"** + refrescar lista.

## Unidades de ESTA oportunidad
- `getOpportunityUnits(oppId)` → chips con `unit_code` + estado (reservada/ocupada). Reemplaza el texto plano de `assigned_units`.
- Acción futura (E4+): liberar unidad (volver a disponible) — fuera de E3.

## Casos de validación (los 4 pedidos)
| Caso | Estado en crm_units | En CRM360 (Capacity Tab) |
|---|---|---|
| 1 · disponible | `disponible` | ✅ aparece en el selector "Disponibles" |
| 2 · reservada | `reservada` | ❌ NO aparece como disponible · cuenta en "Reservada" |
| 3 · ocupada | `ocupada` | ❌ NO disponible · cuenta en "Ocupada" |
| 4 · bloqueada | `bloqueada` | ❌ NO disponible · cuenta en "Bloqueada" |
| (5) · no_comercializable | `no_comercializable` | ❌ NO disponible · cuenta aparte |

Regla UX: **el selector de reserva sólo muestra `state='disponible'`.** El resto se ve en los contadores/listado pero nunca como reservable.

## m² (rol informativo)
- Mostrar `o.m2` como **demanda** de la oportunidad ("Superficie solicitada") + suma de m² de las unidades seleccionadas ("Superficie a reservar") para ayudar al comercial. Ya **no** se muestra "300 m² libres teóricos" como disponibilidad.

## Estados vacíos / dark / mobile
- Si no hay unidades disponibles en el sitio → "Sin unidades disponibles en este sitio".
- Tokens Nexus (card, badges, fg-*), legible en dark; responsive (contadores wrap, selector scrolleable).

## No incluye (E4)
- Mapas Magaldi/Luján leyendo `crm_units`.
- Deep link Mapa → Reservar.
- Liberar/cambiar estado de unidad desde la UI.

## Resultado
La Capacity Tab deja de mostrar disponibilidad en m² teóricos y pasa a mostrar **unidades reales por estado**, con reserva sobre unidades concretas y rechazo garantizado de doble reserva (E2).

# DIGITAL-TWIN-CRMUNITS-DATAFLOW (E4 · dataflow, mapeo y validación)

**Fecha:** 2026-06-08 · Cómo los mapas pasan a leer `crm_units`. Diseño (no implementado).

## Dataflow objetivo
```
crm_units (fuente única)                          ← E1/E2/E3
   │  getUnitStateMap(site) → Record<unit_code, CrmUnitState>   (nuevo accessor read-only)
   ▼
mapa-{lujan|magaldi}/page.tsx  (server, force-dynamic)
   │  fetch del state map del sitio + pasa como prop
   ▼
{Lujan|Magaldi}MapView (client)
   · geometría / m² / nombres / layout  ← modelo estático (sin cambios)
   · COLOR de cada unidad               ← unitStates[code] (crm_units.state)   ◄── cambia
```
- El modelo estático (`lujan3159-map.ts` / `magaldi1765-map.ts`) **se conserva** para geometría/superficies/nombres.
- El **estado/color** deja de salir de `occupancy.status`/`space.status` y pasa a `crm_units.state`.

## Accessor nuevo (read-only)
`units-data.ts` → `getUnitStateMap(site): Record<string, CrmUnitState>` (a partir de `getUnitsBySite`). Resiliente: tabla ausente → `{}` → la vista cae al estado estático (no rompe).

## Clave de join (ya alineada en el seed E1)
| Mapa | Unidad | unit_code en crm_units |
|---|---|---|
| Luján | sector | `code` (PB1…PA2) |
| Luján | cubículo | `"<block.code>-<cubicle.code>"` (ej. `PA3+PA7-C01`) |
| Magaldi | espacio | `id` (OF-PA1, CWP, PB1…PB32, OF-PB1…) |

## Mapeo estado → color (los 5 estados)
| crm_units.state | Color | Hex (UNIT_STATE_COLOR) |
|---|---|---|
| disponible | Verde | `#16a34a` |
| reservada | Amarillo | `#d97706` |
| ocupada | Rojo | `#dc2626` |
| bloqueada | Gris | `#64748b` |
| no_comercializable | Gris oscuro | `#475569` |

Reutiliza `UNIT_STATE_LABEL` / `UNIT_STATE_COLOR` ya definidos en `crm-types.ts` (E3) → consistencia CRM360 ↔ mapas.

## Validaciones (las 5 pedidas)
| Caso | crm_units.state | Mapa |
|---|---|---|
| 1 | disponible | **verde** |
| 2 | reservada | **amarillo** |
| 3 | ocupada | **rojo** |
| 4 | bloqueada | **gris** |
| 5 | no_comercializable | **gris oscuro** |

Prueba E2E: reservar una unidad en CRM360 (Capacity Tab) → la misma unidad pasa a **amarillo** en el mapa correspondiente (force-dynamic + revalidate). Cero divergencia CRM360 ↔ Digital Twin.

## Cambios de comportamiento a confirmar (no asumir)
- Luján sectores `parcial` (PB1/PB3/PB6): en `crm_units` quedaron `disponible` → se verán **verdes** (el modelo unidad no tiene "parcial"). Si se quiere conservar "parcial", es una decisión aparte (futuro).
- Magaldi `interno` → **gris** (bloqueada); `na` → **gris oscuro** (no_comercializable). Los filtros del mapa se ajustan a los 5 estados.

## Compatibilidad (garantizada)
- **No se toca:** CRM360 (E3), reservas existentes, `crm_reserve_units`, Clientify, RRHH, Compliance.
- Sólo cambia la **fuente del color** en las 2 vistas + el accessor read-only + las páginas (server) que inyectan el state map.
- Si `crm_units` no estuviera disponible → fallback al estado estático (degradación, no error).

## Fuera de alcance (P2)
Deep link Mapa → click unidad → CRM360 con capacidad precargada. **Después** de validar E4.

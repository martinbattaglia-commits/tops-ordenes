# CRM-UNITS-INTEGRATION-AUDIT (E3 · auditoría previa)

**Fecha:** 2026-06-08 · Read-only. Qué consume hoy la disponibilidad y qué cálculos por m² siguen activos.

## Estado tras E1+E2
- `crm_units` = **fuente de verdad** (92 unidades, 5 estados, `unique(site,unit_code)`).
- `crm_reserve_units` (E2) **escribe** `crm_units` atómicamente (disponible→reservada).
- **PERO ningún consumidor LEE `crm_units` para mostrar disponibilidad.** La lectura sigue en m².

## Consumidores actuales (qué consume cada uno)
| Consumidor | Qué consume hoy | Tabla / fuente |
|---|---|---|
| **reserveCapacity** (`stage-actions.ts`) | ✅ ya escribe `crm_units` (vía `crm_reserve_units`) | `crm_units` + `crm_opportunities` |
| **findAvailability** (`wms/corporate-capacity.ts`) | m² agregado: capacidad − ocupado − snapshot comprometido | modelo estático (map data) + `getCommittedSnapshot` |
| **getCommittedSnapshot** (`committed-capacity.ts`) | `committed_state` de `crm_opportunities`, agrega **m² por sitio+categoría** | `crm_opportunities` (m², NO unidades) |
| **CapacidadTab** (`Opportunity360View.tsx`) | `findAvailability({category, m2})` → muestra **opciones en m²** (`opt.availableM2`). Reserva con `units: string[]` **de texto libre** | findAvailability (m²) |
| **Opportunity360 · Resumen** | `o.assignedUnits?.join(" · ")` (texto) + `o.m2` | `crm_opportunities.assigned_units` (jsonb texto) |
| **dashboard-vacancia** | `findAvailability` + snapshot (m²) | m² agregado |

## Cálculos por m² que siguen activos
1. `CapacidadTab` línea ~101: `findAvailability({category: SERVICE_TO_CATEGORY[serviceType], m2: o.m2})` → la "disponibilidad" que ve el comercial es **m²**, no unidades.
2. `findAvailability` (todo el motor) → m² = capacidad estática − ocupado − comprometido.
3. `getCommittedSnapshot` → agrega m² por `committed_state`.
4. `dashboard-vacancia` → vacancia en m².

## La brecha exacta (por qué E3 es necesario)
- La reserva ya marca la unidad en `crm_units` (E2), pero la **Capacity Tab no muestra `crm_units`**: muestra m² del motor. → una unidad `reservada` en `crm_units` **no desaparece** de lo que la tab considera "disponible" (la tab no mira unidades).
- El selector de reserva acepta **texto libre** (`units: string[]`), no unidades reales de `crm_units` → se puede tipear cualquier cosa.
- `assigned_units` se muestra como texto, no como unidades reales con estado.

## Qué NO se toca en E3 (es E4)
- `findAvailability` / motor m² puede seguir vivo para el **dashboard-vacancia corporativo** (vacancia en m² es una métrica legítima a nivel ejecutivo). E3 cambia **la disponibilidad COMERCIAL por unidad** en la ficha/Capacity Tab, no la vacancia agregada.
- Mapas Magaldi/Luján → **E4**.

## Conclusión
E3 = introducir **lectura de `crm_units`** en la Capacity Tab y en la disponibilidad comercial: listar/contar unidades por estado, reservar seleccionando unidades reales, y mostrar `assigned_units` como unidades reales. El m² queda como métrica derivada/secundaria, no como fuente de disponibilidad.

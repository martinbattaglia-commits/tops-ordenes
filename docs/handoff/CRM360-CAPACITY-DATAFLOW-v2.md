# CRM360-CAPACITY-DATAFLOW-v2 (E3 · dataflow objetivo)

**Fecha:** 2026-06-08 · `crm_units` como única fuente de disponibilidad comercial.

## Antes (m² agregado) vs Después (unidades)
```
ANTES                                  DESPUÉS (E3)
Magaldi 1000 m²                        crm_units (site=MAGALDI_1765)
 − 700 ocupados                          PB30 disponible
 = 300 m² "libres"   ← teórico           PB31 ocupada
                                         PB32 ocupada
findAvailability(m²) → Capacity Tab      → disponibilidad REAL por unidad
```

## Dataflow objetivo
```
crm_units  (fuente única · estado por unidad)
   │
   ├── getUnitsBySite(site)              → lista de unidades + estado
   ├── getUnitAvailability(site,categoria) → unidades disponibles (state='disponible')
   ├── getUnitCounts(site)              → {disponible, reservada, ocupada, bloqueada, no_comercializable}
   └── getOpportunityUnits(oppId)       → unidades reales de la oportunidad (opportunity_id=oppId)
        │
        ▼
   CRM360 · Capacity Tab
     · contadores por los 5 estados
     · selector de unidades DISPONIBLES reales (no texto libre)
     · "Reservar" → crm_reserve_units (E2, atómico)
     · unidades reservadas de la oportunidad (con su código real)
```

## Disponibilidad comercial (definición v2)
"Disponible para reservar" = `crm_units.state = 'disponible'` para el `site` (+ filtro por `category` si aplica).
Quedan **fuera** de disponibilidad: `reservada`, `ocupada`, `bloqueada`, `no_comercializable`.

## Reserva (sin cambios — E2)
`reserveCapacity` → `crm_reserve_units(p_opp, p_site, p_unit_codes)` → marca unidades `reservada` + `opportunity_id` + actualiza `crm_opportunities` (committed_state, assigned_units). Atómico, con `UNIT_ALREADY_RESERVED`.

## `assigned_units` (compat)
Se mantiene en `crm_opportunities` (jsonb) por compatibilidad y como denormalización rápida, pero la **verdad** es `crm_units.opportunity_id`. La ficha mostrará las unidades resolviendo `crm_units` (estado real), no sólo el texto de `assigned_units`.

## m² (rol degradado)
- `o.m2` sigue existiendo como **dato de la oportunidad** (demanda).
- `findAvailability` (motor m²) **deja de ser** la fuente de disponibilidad comercial en la ficha. Puede seguir alimentando el **dashboard-vacancia** (métrica ejecutiva en m²) hasta una etapa posterior — no se rompe.

## Compatibilidad garantizada
- 172 oportunidades, Clientify, sync, webhooks → **no se tocan** (E3 es lectura de disponibilidad + UX).
- `assigned_units` jsonb intacto.
- `crm_reserve_units` ya operativo (E2).

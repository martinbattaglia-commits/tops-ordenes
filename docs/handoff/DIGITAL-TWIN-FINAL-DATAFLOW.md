# DIGITAL-TWIN-FINAL-DATAFLOW

**Fecha:** 2026-06-08 · Estado final tras E1–E4. Una sola fuente de verdad de disponibilidad.

## Fuente única: `crm_units`
```
                         ┌──────────────────────────┐
                         │        crm_units          │  ← FUENTE ÚNICA
                         │  92 unidades · 5 estados   │
                         │  unique(site, unit_code)   │
                         └──────────┬────────────────┘
        ┌───────────────────────────┼───────────────────────────┐
        ▼                            ▼                            ▼
  CRM360 · Capacidad          Mapa Magaldi                 Mapa Luján
  (E3)                        (E4)                          (E4)
  getAvailableUnits           getUnitStateMap               getUnitStateMap
  getUnitCounts               → color por space.id          → color por sector.code
  getOpportunityUnits                                          y "<block>-<cubicle>"
        │
        ▼
  crm_reserve_units (E2)  ── escribe estado ──►  crm_units  ──►  los 3 consumidores reflejan el cambio
  (atómico · UNIT_ALREADY_RESERVED)
```

## Escritura (única vía)
`crm_reserve_units(p_opp, p_site, p_unit_codes)` (E2) — atómico, `unique(site,unit_code)`, rechazo `UNIT_ALREADY_RESERVED`. Es el **único** camino que cambia `crm_units.state` desde el producto. Sin write-back a Clientify → sin loops.

## Lectura (3 consumidores, misma verdad)
| Consumidor | Accessor | Qué deriva |
|---|---|---|
| CRM360 · Capacity Tab | `getUnitCounts` / `getAvailableUnits` / `getOpportunityUnits` | contadores + selector de disponibles + unidades de la oportunidad |
| Mapa Magaldi | `getUnitStateMap("MAGALDI_1765")` | color de cada espacio (por `id`) |
| Mapa Luján | `getUnitStateMap("PEDRO_LUJAN_3159")` | color de sectores (`code`) y cubículos (`<block>-<cubicle>`) |

## Mapeo de estado → color (idéntico en los 3)
`UNIT_STATE_COLOR` (crm-types): disponible verde · reservada amarillo · ocupada rojo · bloqueada gris · no_comercializable gris oscuro.

## Geometría vs estado
- **Geometría/m²/nombres/layout/cubículos/racks:** modelos estáticos (`lujan3159-map.ts`, `magaldi1765-map.ts`).
- **Estado/disponibilidad/color:** `crm_units` (vía accessors). Force-dynamic → cambios se reflejan al refrescar.

## Resultado
Una reserva en CRM360 → `crm_units.state='reservada'` → **CRM360, Mapa Magaldi y Mapa Luján** muestran la misma unidad como reservada (amarillo). **Cero divergencia** entre CRM360 y Digital Twin. La doble reserva queda impedida por `crm_reserve_units` (E2) + `unique(site,unit_code)` (E1).

## Pendiente
- **P2:** deep link Mapa → click unidad → CRM360 con capacidad precargada.
- Fallback estático activo si `crm_units` no responde (no rompe los mapas).
- Vacancia en m² del dashboard ejecutivo: sigue con el motor m² (métrica agregada legítima); unificación opcional futura.

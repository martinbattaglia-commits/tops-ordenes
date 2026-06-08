# MAPA-LUJAN-MIGRATION-PLAN (E4 · plan)

**Fecha:** 2026-06-08 · `LujanMapView` debe colorear desde `crm_units`. No implementado.

## Estado actual
- `mapa-lujan/page.tsx` (server) → `<LujanMapView />` sin props.
- `LujanMapView.tsx` (client) → importa `LUJAN_3159` estático · color por `occupancy.status` (sectores: ocupado/parcial/disponible) y `cubicle.status` (ocupado/disponible).
- 37 unidades en `crm_units` (site `PEDRO_LUJAN_3159`): 13 sectores + 24 cubículos.

## Pasos
### L1 — Accessor
`getUnitStateMap("PEDRO_LUJAN_3159")` → `Record<unit_code, CrmUnitState>`.

### L2 — Página inyecta el estado
`mapa-lujan/page.tsx` → `export const dynamic = "force-dynamic"`; fetch del state map y pasar `<LujanMapView unitStates={…} />`.

### L3 — Vista usa crm_units para el color
- Firma: `LujanMapView({ unitStates }: { unitStates?: Record<string, CrmUnitState> })`.
- **Sector:** clave = `sector.code` → `st = unitStates?.[sector.code] ?? legacySector(sector.occupancy.status)`.
- **Cubículo:** clave = `"<block.code>-<cubicle.code>"` → `st = unitStates?.[key] ?? legacyCubicle(cubicle.status)`.
- Pintar sectores y cubículos con `UNIT_STATE_COLOR[st]` / `UNIT_STATE_LABEL[st]` (5 estados). Reemplaza el `STATUS_META` de 3 valores.
- Filtros: reemplazar {disponible/ocupado/parcial} por los 5 estados de `crm_units`.
- Totales/leyenda: derivar de `unitStates` (conteo por estado).

### L4 — Mapeo de legado (fallback)
`legacySector`: `ocupado→ocupada · parcial→disponible · disponible→disponible`.
`legacyCubicle`: `ocupado→ocupada · disponible→disponible`.
Sólo si falta la unidad en `crm_units` (no debería: seed cubre las 37).

## Nota de comportamiento (no asumir)
- Sectores `parcial` del modelo estático (PB1/PB3/PB6) → en `crm_units` están como `disponible` → pasarán a **verde** (el modelo unidad no tiene "parcial"). Si se requiere conservar el matiz "parcial", es decisión aparte (futuro: estado o atributo de ocupación parcial).

## Validación (visual)
- PB2/PB8 `disponible` → verde · PB4/PB5/PB7 `ocupada` → rojo · cubículos 2º piso (PA4-PA5-C01…C12) `disponible` → verde · cubículos 1º piso ocupados (C01–C05, C12) → rojo.
- Reservar un cubículo en CRM360 → pasa a **amarillo** en el mapa.
- Conteo: Disponible 23 · Ocupada 14 (estado actual de `crm_units` Luján).

## Compatibilidad
- `lujan3159-map.ts` se conserva (geometría/m²/racks/nombres). Sólo el **color/estado** cambia de fuente.
- No toca CRM360, reservas, Clientify, RRHH, Compliance.
- Sin `crm_units` → fallback estático (no rompe).

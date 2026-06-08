# MAPA-MAGALDI-MIGRATION-PLAN (E4 · plan)

**Fecha:** 2026-06-08 · `MagaldiMapView` debe colorear desde `crm_units`. No implementado.

## Estado actual
- `mapa-magaldi/page.tsx` (server) → `<MagaldiMapView />` sin props.
- `MagaldiMapView.tsx` (client) → importa `MAGALDI_1765` estático · color por `space.status` ∈ {disponible, ocupado, interno, na}.
- 55 unidades en `crm_units` (site `MAGALDI_1765`), `unit_code` = `space.id`.

## Pasos
### M1 — Accessor
`getUnitStateMap("MAGALDI_1765")` (en `units-data.ts`) → `Record<unit_code, CrmUnitState>`.

### M2 — Página inyecta el estado
`mapa-magaldi/page.tsx` → `export const dynamic = "force-dynamic"`; fetch `getUnitStateMap("MAGALDI_1765")` y pasar `unitStates` como prop a `<MagaldiMapView unitStates={…} />`.

### M3 — Vista usa crm_units para el color
- Firma: `MagaldiMapView({ unitStates }: { unitStates?: Record<string, CrmUnitState> })`.
- Estado efectivo por espacio: `const st = unitStates?.[space.id] ?? legacyFromStatus(space.status)` (fallback al estático si falta).
- `STATUS_META`/`SpaceCard`: pintar con `UNIT_STATE_COLOR[st]` + `UNIT_STATE_LABEL[st]` (5 estados). Reemplaza el `STATUS_META` de 4 valores.
- Filtros superiores: reemplazar {disponible/ocupado/interno/na} por los 5 estados de `crm_units` (o agrupar: disponible / reservada / ocupada / no-comercial[bloqueada+no_comercializable]).
- KPIs/contadores de la cabecera: derivar de `unitStates` (conteo por estado) en vez de sumar m² estáticos para "disponible".

### M4 — Mapeo de legado (fallback)
`legacyFromStatus`: `disponible→disponible · ocupado→ocupada · interno→bloqueada · na→no_comercializable`. Sólo se usa si `crm_units` no tiene la unidad (no debería pasar: seed cubre las 55).

## Validación (visual)
- PB30 `disponible` → verde · PB31/PB32 `ocupada` → rojo · OF-PA1..4/CWP `disponible` → verde · CEO/GER/… `bloqueada` → gris · PLAYA/PLAYON `no_comercializable` → gris oscuro.
- Reservar una unidad Magaldi en CRM360 → pasa a **amarillo** en el mapa.
- Conteo cabecera: Disponible 5 · Reservada 1 · Ocupada 35 · Bloqueada 7 · No comercializable 7 (estado actual de `crm_units`).

## Compatibilidad
- `magaldi1765-map.ts` se conserva (geometría/m²/nombres/coworking). Sólo el **color/estado** cambia de fuente.
- No toca CRM360, reservas, Clientify, RRHH, Compliance.
- Sin `crm_units` → fallback estático (no rompe).

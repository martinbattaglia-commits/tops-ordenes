# E4-IMPLEMENTATION-REPORT

**Fecha:** 2026-06-08 · **tsc PASS · build PASS.** Mapas Magaldi y Luján leen `crm_units` como fuente única de estado.
**No se tocó:** CRM360 (E3), reservas, `crm_reserve_units`, Clientify, RRHH, Compliance, deep links (P2).

## Cambios

### E4.1 — Accessor
`src/lib/comercial/units-data.ts` → **`getUnitStateMap(site): Record<unit_code, CrmUnitState>`** (read-only, RLS, resiliente → `{}` si la tabla no está).

### E4.2 — Mapa Magaldi
- `mapa-magaldi/page.tsx`: `force-dynamic` + `getUnitStateMap("MAGALDI_1765")` → prop `unitStates`.
- `MagaldiMapView`: `stateOf(space) = unitStates?.[space.id] ?? legacyMagaldi(space.status)`. Color/label de `SpaceCard`, `SidePanel`, leyenda y filtros (disponible/ocupado/no-vendible/vacancia/corporativa) ahora salen de `crm_units` (5 estados). `STATUS_META` estático eliminado.
- **Geometría/m²/nombres/coworking** del modelo estático: intactos.

### E4.3 — Mapa Luján
- `mapa-lujan/page.tsx`: `force-dynamic` + `getUnitStateMap("PEDRO_LUJAN_3159")` → prop `unitStates`.
- `LujanMapView`: `sectorState(s)=unitStates?.[s.code] ?? legacy` y `cubicleState(b,c)=unitStates?.["<b.code>-<c.code>"] ?? legacy`. Color/label de `SectorCard`, `CubicleBlockCard`, `Legend`, `SectorDetail`, `CubicleDetail` y filtros desde `crm_units`. `STATUS_META` estático eliminado.
- **Geometría/cubículos/racks/layout** del modelo estático: intactos.

## Mapeo estado → color (reutiliza `UNIT_STATE_COLOR` de E3)
disponible **#16a34a** (verde) · reservada **#d97706** (amarillo) · ocupada **#dc2626** (rojo) · bloqueada **#64748b** (gris) · no_comercializable **#475569** (gris oscuro).

## Fallback (no romper)
Si `crm_units` no responde → `unitStates = {}` → cada vista usa `legacy*(status estático)`. El mapa no se rompe.

## Mapeo de legado (cuando falta la unidad en crm_units)
- Magaldi: `disponible→disponible · ocupado→ocupada · interno→bloqueada · na→no_comercializable`.
- Luján sector: `ocupado→ocupada · parcial→disponible · disponible→disponible`. Cubículo: `ocupado→ocupada · disponible→disponible`.
- Nota: los 92 ya están seedeados → el fallback no debería activarse.

## Validación
| | |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 |
| `next build` | ✅ Compiled · 0 errores · `/comercial/mapa-lujan` 5.79 kB · `/comercial/mapa-magaldi` 5.23 kB (ambos `ƒ` dinámicos) |
| STATUS_META residual | ✅ 0 |

Detalle por sede en `MAGALDI-CRMUNITS-VALIDATION.md` y `LUJAN-CRMUNITS-VALIDATION.md`. Sin escritura a prod (solo lectura de `crm_units`).

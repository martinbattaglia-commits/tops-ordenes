# DIGITAL-TWIN-CRMUNITS-AUDIT (E4 · auditoría)

**Fecha:** 2026-06-08 · Read-only. Qué alimenta hoy los mapas comerciales y cómo se calcula el color.

## 1) Archivos que alimentan los mapas
| Mapa | Página (server) | Vista (client) | Fuente de datos |
|---|---|---|---|
| Luján | `app/(app)/comercial/mapa-lujan/page.tsx` (no pasa props) | `LujanMapView.tsx` | **import estático** `src/lib/wms/lujan3159-map.ts` (`LUJAN_3159`) |
| Magaldi | `app/(app)/comercial/mapa-magaldi/page.tsx` (no pasa props) | `MagaldiMapView.tsx` | **import estático** `src/lib/wms/magaldi1765-map.ts` (`MAGALDI_1765`) |

Las páginas dicen textualmente: *"Fuente: data model LOCAL … (no Supabase)"*. **Cero lectura de `crm_units`.**

## 2) Estructura de datos
### Luján (`lujan3159-map.ts`)
- `sectors[]`: `{ code, name, category('general'|'anmat'), floor, surfaceM2, occupancy:{ status, client, … }, rack? }`
- `cubicleBlocks[]`: `{ code, floor, category, cubicles:[{ code, surfaceM2, status, client }] }`
- **Clave de unidad** ↔ `crm_units.unit_code`: sector → `code` (PB1…PA2); cubículo → `"<block.code>-<cubicle.code>"` (ej. `PA3+PA7-C01`). **Coincide con el seed E1.**

### Magaldi (`magaldi1765-map.ts`)
- `spaces[]`: `{ id, name, category('oficina'|'coworking'|'general'|'anmat'|'publica'|'servicio'|'maniobra'), status, floor, m2, rackPositions? }`
- `coworkingPremium`: islas/puestos.
- **Clave de unidad** ↔ `crm_units.unit_code`: space → `id` (OF-PA1, CWP, PB1…PB32, OF-PB1…). **Coincide con el seed E1.**

## 3) Estados que renderiza hoy (hardcodeados, NO `crm_units`)
- **Luján** `STATUS_META`: `ocupado`(rojo) · `parcial`(naranja) · `disponible`(verde). Cubículos: `ocupado|disponible`.
- **Magaldi** `STATUS_META`: `disponible` · `ocupado` · `interno` · `na`.
- El color sale de `occupancy.status` (Luján) / `space.status` (Magaldi) — **valores fijos en el archivo**.

## 4) Cálculo visual actual
`LujanMapView`/`MagaldiMapView` (client) leen el modelo estático importado, filtran por piso/categoría/estado y pintan cada sector/cubículo/espacio con `STATUS_META[status].color`. **No hay fetch ni estado dinámico.** Cambiar `crm_units` no afecta nada.

## 5) Brecha (por qué E4)
- Los mapas tienen su **propia verdad estática** (≠ `crm_units`). Una unidad `reservada` en `crm_units` sigue verde en el mapa.
- Los estados no coinciden: el mapa usa 3–4 estados; `crm_units` usa 5 (`disponible/reservada/ocupada/bloqueada/no_comercializable`). Falta el visual de **reservada** (amarillo).
- Nuance: sectores Luján `parcial` (PB1/PB3/PB6) → en `crm_units` quedaron `disponible` (el modelo unidad no tiene "parcial"). Tras E4 se verán verdes (se documenta).
- Magaldi `interno` → `crm_units` `bloqueada`; `na` → `no_comercializable`.

## 6) Conclusión
E4 = inyectar el `state` de `crm_units` (por `unit_code`) en las vistas, reemplazando `occupancy.status`/`space.status` como **fuente del color**. El modelo estático queda para **geometría, m², nombres y layout**; el **estado** pasa a ser de `crm_units`. Sin tocar CRM360, reservas, Clientify, RRHH ni Compliance.

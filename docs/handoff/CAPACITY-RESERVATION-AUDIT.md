# CAPACITY-RESERVATION-AUDIT (P1 · evidencia, sin fix)

**Fecha:** 2026-06-08 · Auditoría read-only. **No se modificó nada.** Evidencia, no hipótesis.

## Pregunta 1 — ¿Dónde se guarda la reserva?
En la fila de la propia oportunidad: **`public.crm_opportunities`**. No hay tabla de inventario de unidades.
Columnas que escribe la reserva: `assigned_site` (text), `assigned_units` (**jsonb**, array de etiquetas), `committed_state` (`crm_committed_state_t`).

## Pregunta 2 — ¿Qué tabla registra la reserva?
`crm_opportunities` (vía RPC `crm_reserve_capacity`, migración **0047**). **No existe** `crm_units` / `warehouse_units` / tabla de unidades reservables. La unidad reservada vive como **string dentro de un array jsonb** en la oportunidad.

## Pregunta 3 — ¿Qué alimenta cada vista?
| Vista | Fuente real | Evidencia |
|---|---|---|
| **CRM360 · Capacidad** (tab) | motor `findAvailability` (`src/lib/wms/corporate-capacity.ts`) que lee un **snapshot en m²** de `crm_opportunities` (`committed-capacity.ts`) | agrega `reservedM2`/`committedM2` por **sitio+categoría**, no por unidad |
| **Mapa Luján** | **archivo LOCAL estático** `src/lib/wms/lujan3159-map.ts` | `mapa-lujan/page.tsx`: *"Fuente: data model LOCAL …(no Supabase)"* · `occupancy.status` hardcodeado (20 disponible / 14 ocupado / 3 parcial) |
| **Mapa Magaldi** | **archivo LOCAL estático** `src/lib/wms/magaldi1765-map.ts` | ídem |
| Dashboard vacancia | mismo motor de capacidad (m²) | — |

→ **Los mapas NO leen `crm_opportunities`.** Grep: ningún archivo de los mapas referencia `assigned_units`/`crm_opportunities` (solo `corporate-capacity.ts` lo hace, y los mapas no usan ese motor para pintar unidades).

## Pregunta 4 — ¿Por qué la reserva no impacta disponibilidad?
Dos motivos independientes (ver ROOT-CAUSE):
1. La reserva sólo descuenta **m² agregados**; `crm_reserve_capacity` **no chequea si la unidad ya está reservada** por otra oportunidad (no hay constraint de unicidad por unidad).
2. Los mapas son **catálogos estáticos**; no consultan el estado de reserva.

## Evidencia código — qué valida/escribe `crm_reserve_capacity` (0047)
```
- valida OPP existe / no perdida / sitio conocido
- valida p_units es array jsonb no vacío
- valida PRESUPUESTO m²:  if v_opp.m2 > p_available_m2 → INSUFFICIENT_CAPACITY
- UPDATE crm_opportunities SET assigned_site, assigned_units = p_units, committed_state='reservado'
- (NO existe) chequeo de "unidad ya tomada por otra oportunidad"
```
`p_available_m2` lo calcula `reserveCapacity` (server action) con `findAvailability` sobre el snapshot **en m²**. Nunca se compara la unidad pedida contra unidades ya asignadas.

## Estado ANTES / DESPUÉS (evidencia)
| Momento | `crm_opportunities` | CRM `findAvailability` | Mapa (lujan3159-map.ts) |
|---|---|---|---|
| Antes (Cliente A) | `committed_state=none`, `assigned_units=null` | m² disp = capacidad − ocupado − reservadoM² | unidad `status` estático (p.ej. `disponible`) |
| Después de reservar A "Unidad 12" | `committed_state=reservado`, `assigned_units=["Unidad 12"]`, `reservedM2 += m2` | m² disp **baja por m²** (no marca la unidad) | unidad **SIN CAMBIO** (estático) |
| Cliente B reserva "Unidad 12" | **se permite** (otra fila con la misma etiqueta) | si queda m² → la considera disponible → **permite** | sin cambio |

## Evidencia en PRODUCCIÓN (read-only hoy)
- Oportunidades con `assigned_site`: **3** → `committed_state` = **{reservado: 2, ocupado: 1}**.
- Los mapas siguen mostrando su ocupación estática → **no reflejan esas 3 reservas**.
- `assigned_units` guarda etiquetas libres (p.ej. "Cubículos 2º piso (PA4-PA5)") que **no coinciden** con los `code` de unidad del mapa → ni siquiera hay identificador común.

## Conclusión de la auditoría
La "reserva" hoy es un **descuento de m² a nivel oportunidad**, no una **toma de una unidad física**. No hay inventario de unidades ni unicidad, y los mapas son estáticos. Por eso una unidad puede reservarse dos veces y nunca cambia en el Digital Twin. Causa raíz y fix en los documentos siguientes.

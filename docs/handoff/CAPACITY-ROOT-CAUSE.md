# CAPACITY-ROOT-CAUSE (P1 · causa raíz demostrada)

**Fecha:** 2026-06-08 · Conclusión de la auditoría. Causas demostradas con código y datos.

## Causa raíz primaria
**El modelo de capacidad es agregado en m² por sitio+categoría, NO un inventario de unidades.**
- `corporate-capacity.ts` y el snapshot de `committed-capacity.ts` trabajan con `capacityM2 / occupiedM2 / reservedM2 / committedM2`. No existe el concepto "unidad reservable".
- `crm_reserve_capacity` (0047) guarda la unidad como **etiqueta de texto en `assigned_units` (jsonb)** y sólo valida **presupuesto en m²** (`INSUFFICIENT_CAPACITY`).
- **No hay constraint de unicidad por unidad.** Nada impide que dos oportunidades tengan la misma etiqueta en `assigned_units`.

→ Mientras quede m² en el sitio, **cualquier unidad puede reservarse de nuevo**. La "Unidad 12" no es una entidad con estado; es un string.

## Causa raíz secundaria
**Los mapas (Digital Twin) son catálogos estáticos desconectados del CRM.**
- `lujan3159-map.ts` / `magaldi1765-map.ts` tienen el `status` de cada unidad **hardcodeado**.
- Los mapas **no leen `crm_opportunities`** → ninguna reserva los altera. La "inconsistencia CRM360 ↔ Digital Twin" es estructural: son dos fuentes que nunca se reconcilian.

## Causa raíz terciaria (habilitante)
**No hay identificador de unidad compartido ni fuente de verdad única.**
- CRM usa texto libre en `assigned_units`; los mapas usan `code`. No hay join.
- No existe una tabla de unidades que CRM y mapas consulten. Cada vista tiene su propia "verdad".

## Demostración (estado antes/después)
1. Cliente A reserva "Unidad 12" → `crm_opportunities`: `committed_state='reservado'`, `assigned_units=["Unidad 12"]`, `reservedM² += m2`. Mapa: **sin cambio** (estático).
2. Cliente B pide "Unidad 12" → `findAvailability` ve m² libre (el descuento fue sólo por m², el resto del sitio sigue con saldo) → **permite** → segunda fila con `assigned_units=["Unidad 12"]`.
3. Resultado: **misma unidad reservada 2 veces**; ningún mapa lo muestra.
- En PROD ya conviven 2 `reservado` + 1 `ocupado` sin reflejo en los mapas (evidencia AUDIT).

## Por qué NO es un bug de UI
La UI hace lo correcto con lo que el backend le da: el backend **no modela la unidad** ni su unicidad, y los mapas son estáticos. Es un **problema de modelo de datos**, no de pantalla. Por eso el fix es de arquitectura (ver FIX-PLAN), no un parche visual.

## Regla violada (la que pide Presidencia)
> Una unidad NO puede estar simultáneamente Disponible y Reservada.
Hoy esa invariante **no existe en ninguna parte** (ni constraint, ni estado por unidad, ni fuente única). Por eso se viola.

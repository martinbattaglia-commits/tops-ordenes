# LUJAN-CRMUNITS-VALIDATION

**Fecha:** 2026-06-08 · Evidencia read-only de prod. Los colores del mapa Luján salen de `crm_units`.

## Caso pedido — unidades reales
| Unidad | crm_units.state | Mapa |
|---|---|---|
| **PB2** (sector) | disponible | 🟩 verde |
| **PB1** (sector) | disponible | 🟩 verde |
| **PB4** (sector) | ocupada | 🟥 rojo |
| **PB5** (sector) | ocupada | 🟥 rojo |
| **PA4-PA5-C01** (cubículo 2ºP) | disponible | 🟩 verde |
| **PA3+PA7-C01** (cubículo 1ºP) | ocupada | 🟥 rojo |

## Claves de join (sector vs cubículo)
- **Sector:** `unit_code = sector.code` → `sectorState(s)`.
- **Cubículo:** `unit_code = "<block.code>-<cubicle.code>"` (ej. `PA4-PA5-C01`) → `cubicleState(b, c)`.

## Distribución actual Luján (37 unidades)
Disponible 23 · Ocupada 14 (sin reservada/bloqueada/no_comercializable hoy).

## Nota de comportamiento (documentada)
Sectores que el modelo estático marcaba **`parcial`** (PB1/PB3/PB6) están como **`disponible`** en `crm_units` → se ven **verdes** (el modelo unidad no tiene "parcial"; conserva capacidad comercializable). El filtro "Parcial" del mapa sigue operando sobre el flag estático de relevamiento (geometría), no sobre el color.

## Validaciones (los 5 estados)
- disponible → verde (PB2, cubículos 2º piso).
- reservada → amarillo (ninguna hoy en Luján; al reservar un cubículo en CRM360 pasará a amarillo).
- ocupada → rojo (PB4/PB5, cubículos 1º piso C01–C05/C12).
- bloqueada → gris · no_comercializable → gris oscuro (ninguna hoy en Luján; soportadas por el mapeo).

## Cómo verificarlo visualmente
`/comercial/mapa-lujan` (logueado) → el color de sectores y cubículos refleja `crm_units.state`. Reservar un cubículo disponible en CRM360 → en el mapa pasa de verde a **amarillo** (reservada) al refrescar.

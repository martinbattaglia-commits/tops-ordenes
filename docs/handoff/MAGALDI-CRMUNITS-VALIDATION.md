# MAGALDI-CRMUNITS-VALIDATION

**Fecha:** 2026-06-08 · Evidencia read-only de prod (los colores del mapa salen de estos estados).

## Los 5 estados → 5 colores (unidad representativa real)
| Estado | Color | Unidad real (Magaldi) |
|---|---|---|
| disponible | 🟩 verde `#16a34a` | **OF-PA1** |
| reservada | 🟨 amarillo `#d97706` | **PB30** |
| ocupada | 🟥 rojo `#dc2626` | **PB1** |
| bloqueada | ⬜ gris `#64748b` | **CEO** |
| no_comercializable | ◾ gris oscuro `#475569` | **CCOW** |

## Caso pedido — PB30
```
crm_units: { unit_code: "PB30", state: "reservada", opportunity_id: "3dbf23e6-…" (OPP-2026-0003) }
```
→ En el mapa Magaldi, **PB30 = AMARILLO** (reservada). Es el caso ideal: una reserva real del flujo CRM360/E2 ya se refleja en el Digital Twin. (Antes de E4, PB30 figuraba verde/disponible en el mapa estático pese a estar reservada → esa divergencia queda **eliminada**.)

## Distribución actual Magaldi (55 unidades)
Disponible 5 · Reservada 1 (PB30) · Ocupada 35 · Bloqueada 7 · No comercializable 7.

## Validaciones (las 5)
| Caso | Unidad | crm_units.state | Mapa |
|---|---|---|---|
| 1 | OF-PA1 | disponible | 🟩 verde |
| 2 | PB30 | reservada | 🟨 amarillo |
| 3 | PB1 | ocupada | 🟥 rojo |
| 4 | CEO | bloqueada | ⬜ gris |
| 5 | CCOW | no_comercializable | ◾ gris oscuro |

## Cómo verificarlo visualmente
`/comercial/mapa-magaldi` (logueado) · vista **Comercial** o **Vacancia** → el color de cada espacio refleja `crm_units.state`. Reservar otra unidad Magaldi en CRM360 (Capacidad) → esa unidad pasa a amarillo en el mapa al refrescar (force-dynamic).

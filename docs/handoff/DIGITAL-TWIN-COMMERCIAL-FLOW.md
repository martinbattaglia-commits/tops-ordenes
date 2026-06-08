# DIGITAL-TWIN-COMMERCIAL-FLOW

**Fecha:** 2026-06-08 · P2 — el Digital Twin como punto de entrada comercial. Flujo extremo a extremo.

## El mapa ahora vende
Antes: el mapa era una vista de consulta (E4 le dio color real desde `crm_units`). Ahora (P2) es el **punto de entrada comercial**: cada unidad disponible es un click de distancia de convertirse en oportunidad.

## Flujo end-to-end
```
┌──────────────┐  click   ┌───────────────┐  "Reservar"  ┌──────────────────────┐
│  Mapa (E4)   │ ───────► │   SidePanel   │ ───────────► │  Deep link query      │
│  color real  │          │ Estado·Cat·m² │  (si dispon.) │ ?resSite&resUnit&…    │
│  crm_units   │          │ Cliente actual│              └──────────┬───────────┘
└──────────────┘          └───────────────┘                         │
                                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ /comercial/oportunidades — banner "Reserva desde el mapa" + links propagan ?q │
└──────────────────────────────────────┬────────────────────────────────────── ┘
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Ficha 360° → pestaña Capacidad (abierta) → unidad PRESELECCIONADA              │
│   → "Reservar unidad" → crm_reserve_units (atómico, E2)                        │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
                         crm_units.state = 'reservada'
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                          ▼
       CRM360 Capacidad           Mapa Magaldi               Mapa Luján
       (amarillo)                 (la unidad → amarillo)     (la unidad → amarillo)
```

## Una sola verdad, un solo camino de escritura
- **Lectura:** los 3 consumidores (CRM360 Capacidad, Mapa Magaldi, Mapa Luján) leen `crm_units` (E3/E4). Ver `DIGITAL-TWIN-FINAL-DATAFLOW.md`.
- **Escritura:** `crm_reserve_units` (E2) es el **único** camino que cambia `crm_units.state`. El mapa **no** escribe; solo enlaza. La reserva es siempre una acción confirmada por el comercial en CRM360.
- **Atomicidad:** dos intentos sobre la misma unidad → el segundo recibe `UNIT_ALREADY_RESERVED` (UPDATE condicional `where state='disponible'` + `unique(site,unit_code)`).

## Estados y acción desde el mapa
| `crm_units.state` | Color | Acción en SidePanel |
|---|---|---|
| disponible | 🟩 verde | **Reservar unidad** (deep link) |
| reservada | 🟨 amarillo | "Reservada · sin acción" |
| ocupada | 🟥 rojo | "Ocupada · sin acción" |
| bloqueada | ⬜ gris | "Bloqueada · sin acción" |
| no_comercializable | ◾ gris oscuro | "No comercializable · sin acción" |

## Cierre del loop comercial
1. Comercial ve una unidad verde en el mapa → la entiende como oportunidad.
2. Un click la lleva a CRM360 con la unidad precargada (cero re-búsqueda).
3. Reserva → la unidad se pinta de amarillo en **los tres** consumidores al refrescar (force-dynamic).
4. Si otro comercial intentaba la misma unidad → rechazo atómico, sin doble reserva.

Resultado: el Digital Twin deja de ser solo un visor y se vuelve el **embudo de entrada** del CRM, con la disponibilidad garantizada por `crm_units` + `crm_reserve_units`.

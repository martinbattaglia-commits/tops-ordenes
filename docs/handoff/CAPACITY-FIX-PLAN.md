# CAPACITY-FIX-PLAN (P1 · plan, NO implementado)

**Fecha:** 2026-06-08 · Propuesta de fix de arquitectura. **No se implementó nada.** Requiere tu aprobación.

## Principio
Crear una **única fuente de verdad de unidades reservables** con **estado por unidad** y **unicidad garantizada por la base**. CRM360 y los mapas (Digital Twin) deben **leer y escribir la MISMA tabla**. Sin esto, cualquier parche es cosmético.

## Estados válidos (enum nuevo `crm_unit_state_t`)
`disponible · reservada · ocupada · bloqueada · no_comercializable`
(reemplaza la mezcla actual: `committed_state` en oportunidad + `CommercialStatus` estático del mapa.)

## E1 — Registro de unidades (fuente de verdad)
Migración nueva `crm_units` (o `warehouse_units`):
```
crm_units(
  id uuid pk,
  site text not null check (site in ('MAGALDI_1765','PEDRO_LUJAN_3159')),
  unit_code text not null,          -- alineado al `code` del mapa (D1–D8, PA4, …)
  tipo text,                        -- sector | cubiculo | rack | oficina
  category crm_service_t,           -- anmat | general | oficinas
  m2 numeric,
  state crm_unit_state_t not null default 'disponible',
  opportunity_id uuid references crm_opportunities(id),  -- quién la tiene
  unique (site, unit_code)
);
-- INVARIANTE CLAVE: una unidad activa por (site, unit_code).
create unique index crm_units_active_uq on crm_units(site, unit_code);
```
Seed inicial: cargar las unidades desde `lujan3159-map.ts` / `magaldi1765-map.ts` (los `code` ya existen) → el mapa deja de ser la verdad y pasa a ser una **vista** de esta tabla.

## E2 — Reserva atómica con bloqueo de doble reserva
Reescribir `crm_reserve_capacity` (o nueva `crm_reserve_units`) para que, dentro de la transacción:
```
for each unit in p_units:
   update crm_units
      set state='reservada', opportunity_id=p_opp
    where site=p_site and unit_code=unit and state='disponible'
   if NOT FOUND → raise 'UNIT_ALREADY_RESERVED: unidad % no disponible'  (errcode check_violation)
```
- `FOR UPDATE` / update condicional `where state='disponible'` → **imposible doble reserva** (la unidad sale de `disponible` atómicamente).
- Mantener el chequeo de m² como validación adicional, pero la **unidad** es la autoridad.
- Mensaje a UI: **"Unidad ya reservada"** (mapear `UNIT_ALREADY_RESERVED`).

## E3 — Disponibilidad por unidad
- `findAvailability` / tab Capacidad: listar unidades `state='disponible'` del sitio+categoría (consulta `crm_units`), no sólo m².
- La oportunidad referencia unidades reales (`crm_units.id`), no texto libre.

## E4 — Mapas como vista de la verdad
- `mapa-lujan` / `mapa-magaldi`: la `occupancy.status` de cada unidad se **deriva de `crm_units.state`** (overlay sobre el catálogo físico estático que aporta geometría/m²). Reserva → mapa cambia **inmediatamente** (force-dynamic + revalidate, igual que el dashboard de vacancia).
- Mapeo de estado: `disponible→disponible`, `reservada→reservada`, `ocupada→ocupado`, `bloqueada/no_comercializable→bloqueado`.

## E5 — Migración de datos existentes
- Backfill: las 3 oportunidades actuales con `assigned_site` (2 reservado / 1 ocupado) → resolver sus unidades y marcar `crm_units.state` en consecuencia (o flag de revisión si la etiqueta no matchea un `unit_code`).

## Casos de validación (obligatorios)
| Caso | Esperado |
|---|---|
| 1 · Unidad disponible → Reservar | OK · `crm_units.state=reservada` · oportunidad enlazada |
| 2 · Reservar la misma unidad otra vez | **RECHAZO** · "Unidad ya reservada" (`UNIT_ALREADY_RESERVED`) |
| 3 · Mapa comercial | refleja el cambio **inmediatamente** (unidad sale de disponible) |
| 4 · Liberar/perder oportunidad | unidad vuelve a `disponible` (transición controlada) |

## Orden de implementación (cuando autorices)
`E1 (tabla+seed) → E2 (reserva atómica) → E3 (disponibilidad por unidad) → E4 (mapas como vista) → E5 (backfill)`, cada etapa con typecheck/build PASS, verificación read-only y **validación visual** antes de la siguiente — mismo criterio conservador que venimos usando. Sin escritura a prod hasta tu OK por etapa.

## Lo que NO recomiendo (parches rápidos rechazados)
- "Marcar el mapa a mano" → no resuelve el doble-booking del CRM.
- "Chequear `assigned_units` por texto" → frágil (texto libre, sin clave) y sin atomicidad → condición de carrera persiste.
- Sólo la **unicidad a nivel base + estado por unidad + fuente única** elimina la doble reserva de forma garantizada.

> P2 (deep link Mapa → Reservar → CRM con capacidad precargada) queda para **después** de P1, como pediste.

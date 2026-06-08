# CAPACITY-DATAFLOW (P1 · flujo real, evidencia)

**Fecha:** 2026-06-08 · Mapa de datos de reserva y disponibilidad. Read-only.

## Ruta A — Reserva (CRM360)
```
Ficha 360° · tab Capacidad · "Reservar"
  → reserveCapacity(oppId, {site, units, m2})           [src/lib/comercial/stage-actions.ts]
      → getCommittedSnapshot()                           [committed-capacity.ts]  (lee crm_opportunities, agrega m² por sitio+categoría)
      → findAvailability({category, m2, site, basis})    [wms/corporate-capacity.ts]  (modelo en m², SIN unidades)
      → pAvailable = options[0].availableM2
      → RPC crm_reserve_capacity(p_opp, p_site, p_units, p_available_m2)   [0047]
          · valida m²:  m2 > pAvailable → INSUFFICIENT_CAPACITY
          · UPDATE crm_opportunities SET assigned_units=p_units, committed_state='reservado'
  → revalidatePath(/comercial/oportunidades, /dashboard-vacancia, /pipeline)
```
**Persistencia:** `crm_opportunities` (1 fila por oportunidad). Unidad = string en `assigned_units` jsonb.
**Lo que NO ocurre:** ningún registro por-unidad; ningún chequeo de unidad ya tomada.

## Ruta B — Disponibilidad que ve el comercial (CRM)
```
findAvailability(req, snapshot)
  capacidad/ocupado por sitio+categoría  ← MODELO ESTÁTICO (corporate-capacity + map data m²)
  reservadoM²/comprometidoM²             ← snapshot de crm_opportunities (committed_state)
  disponibleComercialM² = físico − comprometido
```
Trabaja **100% en m²**. La unidad pedida nunca se compara contra unidades asignadas.

## Ruta C — Mapas (Digital Twin)
```
/comercial/mapa-lujan   → LujanMapView   ← src/lib/wms/lujan3159-map.ts   (ESTÁTICO, no Supabase)
/comercial/mapa-magaldi → MagaldiMapView ← src/lib/wms/magaldi1765-map.ts (ESTÁTICO, no Supabase)
   sector.occupancy.status ∈ {disponible|parcial|ocupado}   ← hardcodeado en el archivo
   cubicle.status          ∈ {disponible|ocupado}            ← hardcodeado en el archivo
```
**No hay lectura de `crm_opportunities`.** Cambiar una reserva no toca estos archivos.

## El problema en una imagen
```
                 ┌──────────────── crm_opportunities (m² + assigned_units jsonb) ──────────────┐
   Reservar ────►│ committed_state='reservado'   reservedM² += m2   assigned_units=["Unidad12"] │
                 └───────────────▲───────────────────────────────────────────────┬────────────┘
                                 │ (snapshot m²)                                   │ (no lo lee nadie por-unidad)
                  CRM findAvailability (m²)                                Mapas Luján/Magaldi
                  → ve m² libre → permite reservar                         → ESTÁTICOS → nunca cambian
                    "Unidad 12" otra vez                                     (siguen mostrando disponible)
```

## Identificadores (otro quiebre)
- Mapa: unidades con `code` (sectores D1–D8 / cubículos PA4-PA5, etc.).
- CRM: `assigned_units` = **texto libre** ("Cubículos 2º piso (PA4-PA5)").
- **No comparten clave** → aunque se quisiera cruzar, no hay join confiable unidad↔mapa.

## Tablas involucradas
| Rol | Tabla / archivo |
|---|---|
| Origen de la reserva (escritura) | `crm_opportunities` |
| Auditoría de etapa | `crm_stage_history` |
| Disponibilidad CRM (cálculo) | `corporate-capacity.ts` (m²) + snapshot de `crm_opportunities` |
| Mapa Luján | `lujan3159-map.ts` (estático) |
| Mapa Magaldi | `magaldi1765-map.ts` (estático) |
| Inventario de unidades reservables | **NO EXISTE** |

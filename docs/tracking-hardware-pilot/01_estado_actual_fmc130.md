# 01 — Estado actual del módulo tracking (auditoría read-only)

Auditoría del código real de Nexus antes de integrar los FMC130.

## Qué YA existe

| Área | Detalle | Archivo |
|------|---------|---------|
| Ingesta iPhone | Endpoint OsmAnd/Traccar Client | `src/app/api/tracking/ingest/route.ts` |
| Provider layer | Traduce payload crudo → `NormalizedPosition` | `src/lib/tracking/provider/` |
| Engine (hexagonal) | Resuelve device→vehículo, persiste, (futuro) eventos | `src/lib/tracking/engine/` |
| Persistence port | `resolveVehicleByDevice` / `insertPosition` / `touchVehicle` (service_role) | `src/lib/tracking/persistence/supabase.ts` |
| Tablas | `fleet_vehicles`, `fleet_positions`, `fleet_events`, `geofences` (existen en prod) | migraciones 0016–0019 |
| Identificación | Vehículo por **`fleet_vehicles.device_identifier`** (único) | 0016 |
| UI | Mapa + tabla + panel (última posición por vehículo) | `src/app/(app)/operaciones/tracking/` |
| Realtime | CDC de `fleet_positions` → UI sin polling | `src/lib/tracking/realtime/` |
| Registro de providers | Enum `ProviderId = traccar\|teltonika\|queclink\|ruptela` (conceptual) | `src/lib/tracking/provider/types.ts` |

**Soporte conceptual de providers:** el enum ya contempla `teltonika`/`queclink`,
pero **no hay parser implementado** para esos protocolos binarios (van por TCP a
un Traccar Server, no por HTTP). El piloto integra Teltonika **vía forward de
Traccar Server**, no como parser binario dentro de Nexus.

## Qué FALTA (lo que agrega este piloto)

| Falta | Solución del piloto | Estado |
|-------|---------------------|--------|
| Endpoint para recibir forward de Traccar | `POST /api/tracking/traccar-forward` | ✅ implementado (branch) |
| Parser del forward JSON de Traccar | `src/lib/tracking/provider/traccar-forward.ts` | ✅ implementado (branch) |
| Mapping IMEI → `device_identifier` | `src/lib/tracking/device-map.ts` + env `TRACCAR_DEVICE_MAP` | ✅ implementado (branch) |
| Secreto del forward | env `TRACKING_FORWARD_SECRET` (Bearer) | ✅ leído en `env.ts`; valor **NO** en repo |
| Ruta pública en middleware | allowlist de `/api/tracking/traccar-forward` | ✅ implementado (branch) |
| Filas `fleet_vehicles` para los FMC130 | INSERT (`FMC130-MB-01/02`) | ⛔ **pendiente aprobación** (no se ejecuta) |
| Traccar Server operativo | VPS/cloud con protocolo Teltonika + forward | ⛔ pendiente (ver `03`) |
| Columna `provider` en `fleet_positions` | requiere migración | ⛔ **no existe**; se difiere (ver `05`/`06`) |
| Tests del adaptador | unit del parser + del endpoint | ⛔ pendiente (no había tests de tracking previos) |

## Hallazgos críticos

1. **`fleet_positions` NO tiene columna `provider`.** Columnas reales: `id,
   vehicle_id, latitude, longitude, geom, speed, battery, heading, accuracy,
   recorded_at, created_at`. La diferenciación hardware/iPhone se hace por
   `device_identifier` (prefijo `FMC130-`). Agregar `provider` = migración
   (fuera de alcance sin aprobación).
2. **No hay filas FMC130 en `fleet_vehicles`** (solo `IPHONE-MB-01/02`). Hasta
   crearlas, el endpoint responde 404 (mapeado pero sin vehículo). No se inventan.
3. **`fleet_events` no se escribe** hoy (el motor de geocercas es fase posterior);
   el adaptador tampoco emite eventos (no hay tipo de evento "posición recibida").
4. **Campos ricos del FMC130** (ignition, motion, power/voltaje externo, odómetro)
   **no tienen columna** en `fleet_positions` → no se persisten en el piloto.

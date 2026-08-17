# 05 — Contrato del endpoint `/api/tracking/traccar-forward`

Adaptador que recibe el forward de Traccar Server y persiste en `fleet_positions`
reusando el pipeline existente. Implementado en la rama (branch), **sin deploy**.

Archivos:
- `src/app/api/tracking/traccar-forward/route.ts` — endpoint.
- `src/lib/tracking/provider/traccar-forward.ts` — parser del JSON de Traccar.
- `src/lib/tracking/device-map.ts` — mapping IMEI → `device_identifier`.
- `src/lib/env.ts` — `tracking.forwardSecret` / `forwardConfigured` / `deviceMapRaw`.
- `src/lib/supabase/middleware.ts` — ruta pública (server-to-server).

## Request

```
POST https://nexus.logisticatops.com/api/tracking/traccar-forward
Authorization: Bearer <TRACKING_FORWARD_SECRET>
Content-Type: application/json

{
  "position": {
    "latitude": -34.60, "longitude": -58.38,
    "speed": 12.5,            // NUDOS (Traccar) → el adaptador convierte a km/h (×1.852)
    "course": 270,
    "fixTime": "2026-06-15T01:00:00.000+00:00",
    "accuracy": 8,
    "attributes": { "batteryLevel": 90, "ignition": true, "motion": true, "power": 12.4 }
  },
  "device": { "uniqueId": "<IMEI>", "name": "CAMION_01", "status": "online" }
}
```

- **IMEI** se toma de `device.uniqueId` (o `uniqueId` en raíz/position).
- **lat/lng** de `position.*` o raíz. Sin IMEI/lat/lng → **400**.

## Respuestas (HTTP)

| Código | Cuándo |
|--------|--------|
| **200** `{ok:true, positionId}` | Posición aceptada y persistida |
| **200** `{ok:true, duplicate:true}` | Reenvío ya visto (dedupe best-effort) — no re-inserta |
| **401** | Bearer ausente/incorrecto (comparación constant-time) |
| **400** | JSON inválido o faltan IMEI/lat/lng |
| **422** | IMEI **no está** en `TRACCAR_DEVICE_MAP` |
| **404** | IMEI mapeado pero **no existe** el `device_identifier` en `fleet_vehicles` |
| **503** | `TRACKING_FORWARD_SECRET` o service_role no configurados |
| **500** | Error de persistencia (logueado; sin filtrar detalle al cliente) |

> 422/404 hacen que Traccar **reintente** (buffer). Es deseable: al completar el
> mapping + alta del vehículo, las posiciones buffereadas entran solas.

## Normalización (lo que se persiste)

| Campo Traccar | Columna `fleet_positions` | Transformación |
|---------------|---------------------------|----------------|
| `position.latitude/longitude` | `latitude/longitude` | directo (+ `geom` generada en DB) |
| `position.speed` (nudos) | `speed` | ×1.852 → km/h; `<0` → null |
| `position.course` | `heading` | directo |
| `position.accuracy` | `accuracy` | `<=0` → null |
| `attributes.batteryLevel` | `battery` | clamp 0..100 (smallint) |
| `position.fixTime` (o deviceTime) | `recorded_at` | ISO-8601 |
| (recepción en servidor) | `created_at` | `now()` (default DB) |

**NO se persisten** (no hay columna): `ignition`, `motion`, `power`/voltaje,
odómetro. Requerirían migración (fuera de alcance). Ver `06`/`07`.

## Identidad y seguridad

- **Mapping** IMEI → `device_identifier` por env `TRACCAR_DEVICE_MAP` (JSON).
  Reversible, sin tabla ni migración. El `device_identifier` (`FMC130-*`) debe
  existir en `fleet_vehicles`.
- **Secreto** `TRACKING_FORWARD_SECRET`: Bearer, comparación constant-time
  (`timingSafeEqual`). Solo en Netlify env, nunca en repo.
- **Logs**: solo se registran los **últimos 4 dígitos** del IMEI; nunca el
  secreto ni el IMEI completo.

## Dedupe: alcance real (hallazgo de revisión)

El endpoint hace un dedupe **best-effort** por `(vehicle_id, recorded_at)`
(chequeo previo a insertar). **No es idempotencia garantizada**: `fleet_positions`
no tiene unique constraint sobre esas columnas, así que dos reenvíos concurrentes
podrían insertar ambos. Robustez futura (requiere **migración aprobada**):

```sql
create unique index if not exists fleet_positions_vehicle_recorded_uidx
  on public.fleet_positions (vehicle_id, recorded_at);
-- + insert ... on conflict do nothing en el adaptador
```
Para un piloto de 2 equipos a cadencia de segundos, el riesgo de duplicado es bajo.

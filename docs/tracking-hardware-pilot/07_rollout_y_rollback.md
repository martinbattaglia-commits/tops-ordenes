# 07 — Rollout, rollback, riesgos y qué NO se hizo

## Secuencia de activación (cuando Dirección apruebe)

1. **Relevar** IMEI/SIM/APN de ambos equipos → completar `02_datos_a_relevar.md`.
2. **Levantar Traccar Server** (VPS/cloud) con protocolo Teltonika :5027 y forward
   (`03`). Generar `TRACKING_FORWARD_SECRET` (`openssl rand -hex 32`).
3. **Configurar** cada FMC130 (host/puerto/APN/GNSS) y validar en Traccar (`04`,
   Prueba 1).
4. **Crear los vehículos en Nexus** (requiere aprobación — INSERT, no incluido):
   ```sql
   insert into public.fleet_vehicles (name, plate, type, status, device_identifier)
   values
     ('<nombre camión 1>', '<patente 1>', 'Camión', 'active', 'FMC130-MB-01'),
     ('<nombre camión 2>', '<patente 2>', 'Camión', 'active', 'FMC130-MB-02')
   on conflict (device_identifier) do nothing;
   ```
5. **Setear env en Netlify** (Nexus): `TRACKING_FORWARD_SECRET` (=mismo que Traccar)
   y `TRACCAR_DEVICE_MAP` (IMEIs reales → `FMC130-MB-01/02`). **Redeploy** para
   tomar las envs.
6. **Merge/deploy** de la rama `feature/tracking-fmc130-pilot` (endpoint + middleware).
7. **Validar** E2E (Pruebas 2–4 de `06`) y correr el SQL read-only.
8. **Observar 7 días** contra los criterios de éxito.

> El orden importa: crear vehículo + env map **antes** de que Traccar forwardee,
> o el endpoint responde 422/404 (Traccar reintenta y entra al normalizarse).

## Rollback (seguro y reversible)

| Escenario | Acción |
|-----------|--------|
| El forward causa problemas | En Traccar: `forward.enable=false`. Nexus deja de recibir hardware; el iPhone sigue |
| Endpoint con bug | Revertir el deploy de la rama; el endpoint desaparece; `ingest` (iPhone) intacto |
| Mapping equivocado | Corregir `TRACCAR_DEVICE_MAP` en Netlify + redeploy (sin tocar DB) |
| Cortar un equipo | Quitar su IMEI de `TRACCAR_DEVICE_MAP` → sus forwards dan 422 (no escriben) |

El adaptador **no borra ni modifica** datos existentes: solo inserta posiciones.
El iPhone (`/api/tracking/ingest`) queda **como provider secundario** hasta cerrar
el piloto. No se toca nada del path iPhone.

## Riesgos detectados

| Riesgo | Mitigación |
|--------|------------|
| **Sin columna `provider`** → no se distingue fuente en la fila | Prefijo `device_identifier` `FMC130-*`; migración futura para columna `provider` (aprobación) |
| **Dedupe best-effort** (sin unique index) → posible duplicado bajo reintentos concurrentes | Bajo a 2 equipos; migración futura `fleet_positions_vehicle_recorded_uidx` + `on conflict` |
| **Rama 163 commits detrás de `origin/main`** | **Rebasar sobre `main` actual y re-verificar** antes de merge/deploy |
| **Traccar Server = nueva pieza de infra** a mantener (uptime, SIM, puerto) | VPS gestionado o Traccar Cloud; monitoreo del `age` (SQL) |
| **Unidad de velocidad** (nudos vs km/h) | Convertida ×1.852; **verificar en Prueba 3** con un valor conocido |
| **Ignition/power/odómetro no persistidos** | Fuera de alcance; migración futura si se necesitan |
| **Secreto/IMEI sensibles** | Solo en Netlify env; nunca en repo; logs con IMEI parcial (últimos 4) |

## Qué NO se hizo (por seguridad / fuera de alcance)

- ❌ **No se creó** ninguna fila en `fleet_vehicles` (INSERT pendiente de aprobación).
- ❌ **No se ejecutó** ninguna migración (la columna `provider` y el unique index quedan propuestos).
- ❌ **No se levantó** Traccar Server (infra externa; requiere VPS/cloud + SIMs).
- ❌ **No se seteó** ningún secreto real ni `TRACCAR_DEVICE_MAP` (sin IMEIs reales).
- ❌ **No hubo** deploy, push, ni merge a `main`.
- ❌ **No se tocó** el path iPhone ni datos productivos de Supabase.
- ✅ Solo: código en la rama `feature/tracking-fmc130-pilot` + estos docs + SQL read-only.

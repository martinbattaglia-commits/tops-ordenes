# Piloto Tracking Hardware — Teltonika FMC130 → Nexus

Reemplazar el iPhone (Traccar Client, best-effort por límites de iOS) por **GPS
dedicado FMC130** como fuente **primaria y confiable** de tracking de flota, sin
reingeniería del backend de Nexus.

> Estado: **DISEÑO + PREPARACIÓN CONTROLADA** en la rama `feature/tracking-fmc130-pilot`.
> Nada desplegado. Producción intacta. Ver `07_rollout_y_rollback.md`.

## Arquitectura del piloto

```
[FMC130]  --Teltonika/TCP :5027-->  [Traccar Server]  --forward JSON-->  [Nexus]
 hardware      (codec 8/8E)          (decodifica +           POST /api/tracking/traccar-forward
 en camión                            reenvía)               Bearer TRACKING_FORWARD_SECRET
                                                                    │
                                                                    ▼
                                          IMEI → device_identifier (TRACCAR_DEVICE_MAP)
                                                                    │
                                                                    ▼
                                          Engine/Persistence existentes → fleet_positions
                                                                    │
                                                                    ▼
                                          Realtime CDC → UI de Tracking de flota
```

- El iPhone (`/api/tracking/ingest`, protocolo OsmAnd) **sigue funcionando** como
  provider secundario. El adaptador de hardware es una ruta **nueva y separada**.
- Diferenciación hardware vs iPhone: por **`device_identifier`** (`FMC130-*` vs
  `IPHONE-*`). `fleet_positions` **no tiene columna `provider`** (ver `05`/`06`).

## Índice

| Doc | Contenido |
|-----|-----------|
| `01_estado_actual_fmc130.md` | Auditoría: qué existe hoy en el código y qué falta |
| `02_datos_a_relevar.md` | Checklist de datos físicos por equipo (Paso A) |
| `03_traccar_server_config.md` | Config de Traccar Server + alta de dispositivos (Pasos C, D) |
| `04_fmc130_config_checklist.md` | Config de cada FMC130 + validación física (Pasos E, B) |
| `05_adapter_contract.md` | Contrato del endpoint `/api/tracking/traccar-forward` |
| `06_validation_plan.md` | Plan E2E + SQL read-only + criterios de éxito (7 días) |
| `07_rollout_y_rollback.md` | Puesta en marcha, rollback, riesgos, qué NO se hizo |

## Restricciones del piloto (vigentes)

- ❌ Sin deploy · sin push sin confirmación · sin merge a `main`.
- ❌ Sin migraciones en Supabase productiva · sin modificar datos de Supabase.
- ❌ Sin secretos hardcodeados · sin commitear datos sensibles (IMEI/ICCID/secreto).
- ✅ iPhone se mantiene como provider secundario hasta cerrar el piloto.

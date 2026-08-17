# 04 — Configuración de cada FMC130 + validación física (Pasos E, B)

Configurar vía **Teltonika Configurator** (USB) o **FOTA Web** (remoto). **No se
incluyen comandos SMS exactos** (varían por firmware; no se inventan — verificar
en la doc del equipo si se necesitan).

## Paso E — Parámetros mínimos (Teltonika Configurator)

```txt
GPRS / Mobile:
  APN:            <según operador — ver tabla>
  APN user/pass:  <normalmente vacío en M2M>

Server (Data Acquisition → Server):
  Domain / Host:  <IP o dominio público del Traccar Server>
  Port:           5027
  Protocol:       TCP
  Codec:          8 / 8E (default FMB/FMC)

Data acquisition:
  On Moving:      30–60 s      # o por distancia (p.ej. 50 m) / ángulo
  On Stop:        180–300 s    # heartbeat en reposo (3–5 min)
  Min saved records: 1

GNSS:
  GNSS Source:    enabled (GPS+GLONASS)

Features:
  Ignition source: según instalación (Power Voltage / Digital Input / Accelerometer)
  Records buffering / Offline buffer: enabled   # guarda si no hay red y reenvía
  Time sync:      GPS / NTP (backend en UTC)
```

- **Timezone/backend en UTC:** el FMC130 reporta en UTC; Nexus almacena UTC y la
  UI convierte a ART. No configurar offsets locales en el equipo.
- **Ignition source** define "en movimiento vs detenido" a nivel hardware —
  clave para cadencia y para no drenar la batería del camión con el motor apagado.

## Tabla de referencia de APN (Argentina — verificar con el operador)

| Operador | APN (típico M2M/datos) | Usuario | Password |
|----------|------------------------|---------|----------|
| Movistar | `internet.movistar.com.ar` o APN M2M dedicado | (vacío) | (vacío) |
| Claro | `igprs.claro.com.ar` o APN M2M | (vacío) | (vacío) |
| Personal | `datos.personal.com` o APN M2M | (vacío) | (vacío) |

> ⚠️ Si la SIM es **M2M corporativa**, el APN suele ser uno dedicado provisto por
> el operador — **usar ese**, no el APN de consumo. Confirmar antes de configurar.

## Paso B — Validación física/técnica por equipo

```txt
☐ SIM con datos activa (probar navegación / consultar saldo M2M)
☐ APN correcto cargado
☐ Equipo con alimentación (LED de power / voltaje 10–30V OK)
☐ Señal celular (Configurator → Status → GSM: operador + señal > mínima)
☐ Señal GNSS/GPS (Status → GNSS: fix válido, sats > 4)
☐ Equipo NO encerrado en zona sin cielo (antena con visibilidad)
☐ Host/puerto correcto (Traccar host + 5027 TCP)
☐ Equipo visible en logs de Traccar (conexión TCP entrante desde la SIM)
☐ IMEI recibido correctamente (Traccar muestra el device por su Identifier)
☐ Primera posición válida recibida (lat/lng plausibles, fixTime fresco)
```

Recién cuando **ambos** equipos pasan esta checklist en Traccar (Prueba 1 de
`06`), tiene sentido activar el forward hacia Nexus.

# 02 — Datos físicos a relevar (Paso A)

Completar por cada equipo. **Lo que falte se marca `PENDIENTE OPERATIVO` — NO se
inventa.** Estos datos NO se commitean (IMEI/ICCID/secreto son sensibles): viven
en Netlify env (`TRACCAR_DEVICE_MAP`) y en la config del Traccar Server / hardware.

```txt
FMC130_01:
  IMEI:                    PENDIENTE OPERATIVO   # etiqueta del equipo / Teltonika Configurator (Status > GSM)
  ICCID/SIM:               PENDIENTE OPERATIVO   # impreso en el chip / factura del operador
  Número de línea:         PENDIENTE OPERATIVO
  Operador:                PENDIENTE OPERATIVO   # Movistar / Claro / Personal ...
  APN:                     PENDIENTE OPERATIVO   # según operador (ver 04)
  Usuario APN:             PENDIENTE OPERATIVO   # muchas M2M van vacío
  Password APN:            PENDIENTE OPERATIVO   # muchas M2M van vacío
  Vehículo asignado:       PENDIENTE OPERATIVO   # camión físico donde se instaló
  Patente:                 PENDIENTE OPERATIVO
  Nombre interno en Nexus: FMC130-MB-01          # device_identifier propuesto (alias estable)
  vehicle_code:            CAMION_01              # código operativo propuesto
  Observaciones instalación: PENDIENTE OPERATIVO # cableado ignición/12V, ubicación antena, etc.

FMC130_02:
  IMEI:                    PENDIENTE OPERATIVO
  ICCID/SIM:               PENDIENTE OPERATIVO
  Número de línea:         PENDIENTE OPERATIVO
  Operador:                PENDIENTE OPERATIVO
  APN:                     PENDIENTE OPERATIVO
  Usuario APN:             PENDIENTE OPERATIVO
  Password APN:            PENDIENTE OPERATIVO
  Vehículo asignado:       PENDIENTE OPERATIVO
  Patente:                 PENDIENTE OPERATIVO
  Nombre interno en Nexus: FMC130-MB-02          # device_identifier propuesto
  vehicle_code:            CAMION_02              # código operativo propuesto
  Observaciones instalación: PENDIENTE OPERATIVO
```

## Cómo obtener cada dato (sin inventar)

| Dato | Dónde |
|------|-------|
| **IMEI** | Etiqueta del FMC130 · o Teltonika Configurator → *Status → GSM → IMEI* · o FOTA Web |
| **ICCID / número / operador** | Chip físico, factura del operador o portal M2M |
| **APN / usuario / pass** | Documentación del operador de la SIM (ver tabla de referencia en `04`) |
| **Vehículo / patente** | Registro físico de instalación en cada camión |
| **device_identifier / vehicle_code** | Los proponemos acá (`FMC130-MB-01/02`, `CAMION_01/02`); confirmar con Dirección |

> ⚠️ Sin IMEI real **no se puede** armar `TRACCAR_DEVICE_MAP` ni dar de alta el
> dispositivo en Traccar. Es el primer bloqueante operativo.

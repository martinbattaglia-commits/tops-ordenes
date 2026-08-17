# 03 — Traccar Server: configuración y alta de dispositivos (Pasos C, D)

**No existe** hoy un Traccar Server definido en el proyecto ni en la
documentación de Nexus. El piloto requiere levantar uno (self-hosted en VPS, o
Traccar Cloud). Traccar es open-source (Java), protocol-agnostic, decodifica
Teltonika y reenvía posiciones por HTTP.

## Paso C — Configuración piloto mínima (`traccar.xml` / `conf`)

```xml
<!-- Puerto del protocolo Teltonika (codec 8/8E de los FMB/FMC) -->
<entry key='teltonika.port'>5027</entry>

<!-- Forward de cada posición hacia Nexus (JSON) -->
<entry key='forward.enable'>true</entry>
<entry key='forward.url'>https://nexus.logisticatops.com/api/tracking/traccar-forward</entry>
<entry key='forward.type'>json</entry>
<entry key='forward.header'>Authorization: Bearer ${TRACKING_FORWARD_SECRET}</entry>

<!-- Reintentos: buffer si Nexus no responde 2xx -->
<entry key='forward.retry.enable'>true</entry>
<entry key='forward.retry.count'>10</entry>
<entry key='forward.retry.limit'>1000</entry>

<!-- Logs para diagnóstico del piloto -->
<entry key='logger.level'>info</entry>
```

Notas:
- **URL canónica: `nexus.logisticatops.com`** (no usar `tops-ordenes.netlify.app`,
  que es el origin interno de Netlify).
- **`${TRACKING_FORWARD_SECRET}`**: reemplazar por el secreto real (generar con
  `openssl rand -hex 32`). El **mismo valor** va en Netlify env de Nexus. **Nunca
  en el repo.**
- El forward debe incluir el objeto `device` (con `uniqueId` = IMEI). El adaptador
  también acepta `uniqueId` en la raíz (ver `05`).
- El endpoint responde **422 si el IMEI no está mapeado** y **404 si está mapeado
  pero el vehículo no existe** → Traccar reintenta (buffer). Esto es deseable: al
  completar mapping + alta de vehículo, las posiciones buffereadas entran solas.

## Infraestructura sugerida (piloto)

| Item | Recomendación |
|------|---------------|
| Host | VPS chico (1 vCPU / 1–2 GB) con IP pública fija, o Traccar Cloud |
| Puertos entrantes | `5027/tcp` (Teltonika) abierto hacia las SIMs; `8082` admin sólo restringido |
| Salida | HTTPS 443 hacia `nexus.logisticatops.com` |
| Persistencia | Traccar mantiene su propia DB (H2/MySQL) — es la fuente de decodificación; Nexus es el destino de negocio |

## Paso D — Alta de cada equipo en Traccar

En la UI de Traccar (o API), crear un device por FMC130:

```txt
FMC130_01
  Name:       CAMION_01  (o patente / nombre operativo)
  Identifier: <IMEI real del FMC130_01>     # DEBE coincidir con el uniqueId que reporta el equipo
  (protocolo Teltonika :5027 se detecta solo al conectar)

FMC130_02
  Name:       CAMION_02
  Identifier: <IMEI real del FMC130_02>
```

- El **`Identifier` de Traccar = IMEI** que el FMC130 envía en el codec Teltonika.
- Ese mismo IMEI es la **clave** de `TRACCAR_DEVICE_MAP` en Nexus (ver `05`).
- Verificar en Traccar que el device pasa a **online** y muestra última posición
  (Prueba 1 de `06`) antes de tocar Nexus.

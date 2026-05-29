# TOPS NEXUS — Módulo CCTV y Monitoreo Operativo

> **Estado:** módulo nativo (incorporación oficial) · **Fecha:** 2026-05-29
> Documento de incorporación del módulo **CCTV y Monitoreo Operativo** como
> ciudadano de primera clase de TOPS Nexus (no integración satélite). Define
> alcance, arquitectura técnica real, modelo de datos, RBAC, puntos de
> integración con el ERP y roadmap de 5 fases.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md). Relacionado:
> [ERP-ARQUITECTURA-MAESTRA.md](./ERP-ARQUITECTURA-MAESTRA.md),
> [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md).

---

## 0. Decisión: CCTV es módulo nativo, no integración satélite

Hasta ahora CCTV figuraba bajo "Integraciones" (Fase 7 del rector) y como
"satélite desacoplado" en el grafo de dependencias. **Se eleva oficialmente a
Módulo Core #10** porque:

1. La evidencia visual es **parte del registro auditable** de operaciones, OC,
   recepciones, despachos, picking, incidentes y reclamos (no-negociable de
   auditoría total del rector).
2. El cumplimiento **ANMAT** exige evidencia visual de cadena de frío, accesos a
   sectores regulados y auditorías → CCTV es insumo de compliance, no un extra.
3. El RBAC ya lo trata como dominio propio: existen permisos `cctv.view` /
   `cctv.admin` y el rol `seguridad` (ver [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) §2–3).

> **Nota de paridad:** el código vive en `wip/erp-consolidation`, no en `main`.
> Su promoción sigue las reglas de
> [ERP-CONSOLIDACION-DEFINITIVA.md](./ERP-CONSOLIDACION-DEFINITIVA.md) §2 (con tests).

---

## 1. Alcance del módulo

Integrar el monitoreo operativo de toda la infraestructura física:

- CCTV depósitos (cargas generales)
- CCTV ANMAT (sectores regulados, cadena de frío)
- CCTV accesos (recepción, muelles)
- CCTV oficinas y coworking

**Objetivo de negocio:** que toda operación crítica tenga **evidencia visual
trazable y asociable** a su documento ERP, y que el estado de salud del sistema
de videovigilancia sea observable desde el cockpit.

---

## 2. Arquitectura técnica (estado real, verificado en código)

### 2.1 Hardware

- **NVR:** Hikvision **ERI-K216-P16** — 16 canales, sede **Magaldi**.
- **Streams:** `0`/`1` = main (HD) / sub (SD). Channel ID = patrón `{N}0{S}`
  (ej.: cámara D3 HD → `301`, SD → `302`).

### 2.2 Integración — Hikvision ISAPI v2.0+

Cliente en `src/lib/cctv/hikvision.ts` con **digest auth** (`src/lib/cctv/digest.ts`).
Configuración vía `env.hikvision` (`HIKVISION_HOST/USER/PASSWORD/PORTS`, flag
`useHttps`). Si no está configurado → `HikvisionError(503)`.

| Endpoint ISAPI | Uso | Estado |
|----------------|-----|:------:|
| `GET /ISAPI/System/deviceInfo` | datos del NVR (modelo, firmware, serial) | ✅ implementado |
| `GET /ISAPI/Streaming/channels` | listado de canales | ✅ implementado |
| `GET /ISAPI/Streaming/channels/{ch}/picture` | snapshot JPEG | ✅ implementado |
| (RTSP/ONVIF streaming en vivo) | video en vivo | 🔵 Fase 2 |
| (`/ISAPI/Event/notification/alertStream`) | eventos/alarmas | 🔵 Fase 4 |

> El NVR responde **XML** (no JSON); hoy se parsea con regex mínima
> (`pickXmlTag`). **Deuda técnica anotada:** para uso intensivo migrar a un XML
> parser robusto.

### 2.3 Capas de código

```
env.hikvision ──► lib/cctv/digest.ts (digest auth fetch)
                       ▲
lib/cctv/hikvision.ts ─┤ (cliente ISAPI: deviceInfo, channels, picture)
lib/cctv/data.ts ──────┤ (modelo Camera/CctvEvent — hoy mock, sectores reales)
lib/cctv/digest.ts ────┘
        │
        ▼
api/cctv/ping/route.ts                 → healthcheck del NVR
api/cctv/snapshot/[channelId]/route.ts → proxy de snapshot JPEG
        │
        ▼
app/(app)/cctv/page.tsx + CctvGrid.tsx → dashboard de cámaras
```

---

## 3. Modelo de datos (hoy mock, objetivo persistente)

`src/lib/cctv/data.ts` define el shape canónico (mock con sectores reales de
Magaldi, incluido **sector ANMAT pasillo A/B**):

```ts
type CameraStatus = "online" | "offline" | "alert";
type CameraType   = "domo-4k" | "fixed-fhd" | "ptz-4k" | "thermal";

interface Camera   { id; name; location; sector; type; status;
                     resolution; fps; recording; lastEventTs?; lastEventKind? }
interface CctvEvent{ ts; cameraId; cameraName;
                     kind: "motion"|"access"|"alarm"|"temp";
                     detail; severity: "info"|"warn"|"danger" }
```

**Tablas futuras (NO crear en esta fase — propuesta para fase de implementación):**

| Tabla propuesta | Propósito | Fase |
|-----------------|-----------|:----:|
| `cctv_devices` | NVRs/cámaras registradas (sede, sector, canal, tipo, estado) | Fase 3 |
| `cctv_events` | eventos (motion/access/alarm/temp) con severidad y timestamp | Fase 4 |
| `cctv_evidence` | vínculo polimórfico cámara/snapshot/clip ↔ documento ERP | Fase 3 |

> La evidencia (snapshots/clips) se almacenaría en un **bucket privado** Supabase
> con scoping y signed URLs de corta vida (mismo patrón que se exigirá al bucket
> fiscal `invoices` — ver [erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) §7 R4).

---

## 4. RBAC del módulo (ya existente)

| Permiso | Roles que lo tienen (Sistema B) |
|---------|---------------------------------|
| `cctv.view` | `director_ops`, `admin`, `operaciones`, `compliance`, `seguridad` |
| `cctv.admin` | `director_ops`, `admin`, `seguridad` |

El rol **`seguridad`** (Seguridad / CCTV) es el dueño funcional del módulo. El
acceso queda auditado vía `audit_log`. (Detalle en
[RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) §2–3.)

---

## 5. Puntos de integración con el ERP (evidencia operativa)

La razón de ser de elevar CCTV a Core: **asociar evidencia visual a documentos**.

| Documento ERP | Evidencia CCTV asociable | Fase |
|---------------|--------------------------|:----:|
| Órdenes de Servicio (OS) | snapshot/clip de recepción, picking, despacho | 3 |
| Órdenes de Compra (OC) | recepción de mercadería en muelle | 3 |
| Recepciones / Despachos | foto/video del movimiento físico | 3 |
| Incidentes / Reclamos | evidencia del evento | 3 |
| **ANMAT — auditorías / desvíos** | cadena de frío, accesos a sector regulado | 3–4 |
| Cadena de frío (alertas temp) | evento `temp` con severidad + snapshot | 4–5 |

Visión objetivo (búsqueda semántica, Fase 5/IA): *"mostrar todos los movimientos
del cliente X en abril"* → devuelve OS + firma + PDF + **fotos + video** + usuario
+ fecha, como **evidencia completa unificada**.

---

## 6. Roadmap del módulo (5 fases — alineado al rector)

| Fase | Alcance | Estado |
|:----:|---------|:------:|
| **1. Snapshots** | ISAPI deviceInfo/channels/picture, dashboard de cámaras, healthcheck | ✅ **implementado** (en branch) |
| **2. Video en vivo** | RTSP/ONVIF o streaming HLS proxy; salud por canal en tiempo real | 🔵 |
| **3. Asociación con órdenes** | `cctv_evidence` + UI para adjuntar evidencia a OS/OC/recepciones/ANMAT | 🔵 |
| **4. Eventos automáticos** | suscripción a `alertStream` (motion/access/alarm/temp) + alertas | 🔵 |
| **5. IA sobre video** | clasificación/búsqueda semántica de evidencia (ver OCR/IA del rector) | 🔵 |

---

## 7. Riesgos y deuda técnica del módulo

| # | Riesgo | Severidad | Mitigación propuesta |
|:-:|--------|:---------:|----------------------|
| CCTV-1 | Parseo XML por regex (`pickXmlTag`) frágil ante cambios de firmware | Media | XML parser real antes de Fase 4 |
| CCTV-2 | Credenciales NVR (`HIKVISION_*`) en `.env.local` host-only | Baja (correcto) | mantener fuera de repo; rotar |
| CCTV-3 | Snapshots como proxy directo sin caché ni rate-limit | Media | caché corta + rate-limit (patrón `lib/rate-limit`) |
| CCTV-4 | Modelo `Camera` aún mock; un solo NVR (Magaldi) | Baja | `cctv_devices` multi-sede en Fase 3 |
| CCTV-5 | Evidencia futura en bucket sin scoping podría exponer video | **Alta** (si se implementa mal) | bucket privado + signed URLs + RLS por sede/rol |

---

## 8. Conclusión

CCTV queda **oficialmente incorporado como Módulo Core #10** de TOPS Nexus, con
su Fase 1 (snapshots) ya implementada en `wip/erp-consolidation`. No se crea
ninguna tabla ni se promueve código en esta fase: este documento fija su lugar en
la arquitectura, su RBAC (ya existente), sus puntos de integración con el registro
auditable del ERP y su roadmap de 5 fases.

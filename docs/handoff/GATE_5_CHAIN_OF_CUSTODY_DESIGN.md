# GATE 5 — Cadena de Custodia Digital · Documento de diseño arquitectónico

> 🟢 **ESTADO: READY TO CODE (Rev. 2 · 2026-06-03).** Incorpora los **7 cambios obligatorios** de
> `GATE_5_ARCHITECTURE_REVIEW.md` y resuelve **D1–D11 definitivamente** (ninguna abierta). Apto para
> auditorías externas. Justificación del estado al final (§17). **Aún NO implementado** (sin SQL/TS/React/migraciones/UI).
>
> Requerimiento origen: **Mercado Libre** (trazabilidad por unidad + evidencia visual + POD) — reservado
> desde Gate 4A (§3) y Gate 4B (`packing_units` = entidad física canónica). Gate 4C agregó `shipments`
> como ancla de despacho/entrega.
> Migraciones objetivo: **`0036+`** (aditivas). No reabre Gates 1–4C.
> Arquitecto Principal + Security + Compliance (rol). Repo `~/CODE/tops-ordenes` @ `0a3c289` (Gate 4C CERRADO).
>
> **Changelog Rev. 2 (cambios obligatorios aplicados):** (1) eliminado polimorfismo `scope/scope_id` → doble
> FK nullable + CHECK · (2) hash-chain obligatoria (`prev_hash`/`row_hash`) · (3) multi-bucket privado por
> sensibilidad · (4) auditoría de **lectura** de PII · (5) PostGIS oficial (`geom` generado) · (6) retención
> tiered + redacción de PII (erasure) · (7) vocabulario controlado de `event_type`.

---

## 1. Objetivo funcional

Dar **trazabilidad probatoria de extremo a extremo** de cada unidad logística y cada despacho: quién la
manipuló, cuándo, dónde, y con qué evidencia (fotos, firma del receptor), generando un **Proof of Delivery
(POD)** completo y una **línea de tiempo inmutable** de la cadena de custodia:

```
Packing → Despacho → Transporte → Entrega → POD
```

Gate 5 **NO mueve stock ni ledger** (eso terminó en Gate 4C). Es una **capa de evidencia y auditoría
visual additive** sobre las entidades físicas ya existentes (`packing_units`, `shipments`). Su no-negociable
es el de todo el sistema: **auditoría e inmutabilidad** — aquí, además, **tamper-evidence** de los archivos.

---

## 2. Hallazgos de la auditoría (qué ya existe y se reutiliza)

| Activo existente | Uso en Gate 5 |
|---|---|
| `packing_units` (`BLT-`, 0033) | **Portador canónico** de QR + evidencia a nivel **unidad/bulto** (packing, carga). |
| `shipments` (`DSP-`, 0035) | **Ancla** de QR + evidencia a nivel **despacho/entrega** + POD + firma del receptor. |
| `packing_units.shipment_id` (0035) | Une bulto→despacho: la evidencia de unidad se asocia al despacho sin rediseño. |
| `audit_log` (0001, append-only) | Registro de acciones (quién/cuándo/qué) — se complementa con `custody_events`. |
| `inventory_movements` (inmutable por trigger, 0026) | **Patrón de inmutabilidad** a replicar para `custody_events`/`custody_evidence`. |
| Supabase Storage (`0003_storage`, `0010_documents`) | **Almacenamiento de binarios** (fotos, firmas, PDF de POD) en bucket privado con RLS. |
| Tracking de flota (Traccar/Mapbox, 0016-0019, PostGIS) | Fuente opcional de **posición del vehículo** para el "dónde" del transporte/entrega. |
| Hikvision CCTV (integración existente) | Fuente futura de fotos de dársena/carga (no en alcance inicial). |
| `received_by_name`, `delivered_at/by` (shipments, 0035) | Base del POD; Gate 5 lo **extiende** (documento, observaciones, firma). |

**Conclusión:** Gate 5 es **additive y de baja fricción sobre el modelo**: una **capa de evidencia**
(eventos + archivos + tokens QR) colgada de `packing_units`/`shipments`, con Storage para binarios y triggers
de inmutabilidad para la cadena. No requiere tocar stock, ledger ni los flujos de 1–4C.

---

## 3. Principios de diseño (heredados + nuevos)

- **Additive only:** Gate 5 no altera tablas/RPC de Gates 1–4C (salvo 2 columnas aditivas de token QR).
- **Append-only + inmutable:** `custody_events` y `custody_evidence` se bloquean a UPDATE/DELETE por trigger
  (mismo patrón que `inventory_movements`). La cadena de custodia no se reescribe.
- **Tamper-evidence con HASH-CHAIN (obligatorio):** cada archivo guarda su **`sha256`**; además cada
  `custody_event` encadena al anterior (`row_hash = SHA256(prev_hash ‖ campos ‖ sha256_evidencia)`) → cualquier
  alteración de la secuencia rompe la cadena. Anclaje **Merkle diario** externo opcional para legal-grade.
- **Integridad referencial real:** los eventos cuelgan de `packing_unit_id` **o** `shipment_id` (doble FK
  nullable + CHECK de exclusividad). **No** hay polimorfismo `scope_id` sin FK.
- **Escritura solo vía RPC SECURITY DEFINER** (RLS lockdown), como todo el WMS. La UI nunca escribe directo.
- **Storage privado MULTI-BUCKET por sensibilidad + RLS:** binarios no públicos; acceso por signed URLs de TTL
  corto vía función SECURITY DEFINER (patrón 0010). **Prohibido** reusar el bucket público `signatures` (0003).
- **PII auditada en LECTURA:** toda emisión de signed URL sobre el bucket PII registra en `audit_log`.
- **Retención + erasure:** retención tiered por bucket; supresión de PII por **redacción** (borra binario,
  conserva la fila inmutable con su hash) → erasure sin romper la cadena.
- **Geo PostGIS:** lat/lng + columna **generada** `geom extensions.geometry(Point,4326)` (patrón Tracking 0016);
  capturado del dispositivo y/o derivado del vehículo (Traccar). Configurable (default opcional) + consentimiento.
- **QR opaco:** el QR codifica un **token aleatorio**, no el `public_id` (no adivinable / no enumerable).

---

## 4. Modelo de datos propuesto

### 4.1 Enums nuevos
- **`custody_stage_t`** = `('packing', 'despacho', 'transporte', 'entrega', 'pod')` — etapa de la cadena.
- **`custody_event_type_t`** = `('foto_packing', 'cargado', 'en_transito', 'foto_entrega', 'firmado', 'pod')`
  — **vocabulario controlado** (cambio #7; reemplaza el `event_type text` libre). Validado contra `stage`.
- **`evidence_kind_t`** = `('foto', 'firma', 'documento')` — tipo de archivo de evidencia.
  > **Eliminado `custody_scope_t`** (cambio #1): el "scope" ya no existe; se usa doble FK (4.3).

### 4.2 Columnas aditivas (única alteración a tablas existentes)
- `packing_units.custody_token uuid unique default gen_random_uuid()` — payload del QR del bulto.
- `shipments.custody_token uuid unique default gen_random_uuid()` — payload del QR del despacho.
  > Tokens **opacos** (no `public_id`). El QR los codifica; el escaneo resuelve a la entidad vía RPC de lectura.

### 4.3 Tablas nuevas

```
custody_events            -- LÍNEA DE TIEMPO append-only + HASH-CHAIN de la cadena de custodia
  id              uuid pk
  public_id       text unique            -- 'CUST-2026-0001' (trigger)
  -- DOBLE FK NULLABLE + CHECK de exclusividad (cambio #1/#2): integridad referencial real.
  packing_unit_id uuid fk packing_units(id) on delete restrict   -- evento de UNIDAD
  shipment_id     uuid fk shipments(id)     on delete restrict   -- evento de DESPACHO
  -- CHECK (num_nonnulls(packing_unit_id, shipment_id) = 1)  → exactamente uno
  stage           custody_stage_t          -- packing | despacho | transporte | entrega | pod
  event_type      custody_event_type_t     -- vocabulario controlado (cambio #7)
  actor_id        uuid fk auth.users       -- QUIÉN
  occurred_at     timestamptz              -- CUÁNDO (momento real del evento)
  geo_lat         double precision         -- DÓNDE (entrada; opcional/configurable)
  geo_lng         double precision
  geo_accuracy_m  numeric                  -- precisión (m), si el dispositivo la reporta
  geo_source      text                     -- 'device' | 'traccar' | null
  geom            extensions.geometry(Point,4326)   -- GENERADA de lng/lat (PostGIS, patrón 0016 · cambio #6)
  device_ref      text
  notes           text
  -- HASH-CHAIN (cambio #3):
  prev_hash       text                     -- row_hash del evento anterior de la misma entidad
  row_hash        text not null            -- SHA256(prev_hash ‖ campos_canónicos ‖ sha256_evidencia)
  created_at      timestamptz default now()
  -- INMUTABLE por trigger (no UPDATE/DELETE/TRUNCATE). RLS: lectura auth, escritura solo RPC.

custody_evidence          -- ARCHIVOS de evidencia (en Storage) ligados a un evento  [PARTICIONADA POR MES]
  id              uuid pk
  event_id        uuid fk custody_events(id) on delete restrict
  kind            evidence_kind_t          -- foto | firma | documento
  storage_bucket  text not null            -- custody-evidence | custody-pii | custody-pod (multi-bucket · cambio #4)
  storage_path    text not null            -- custody-{class}/{entidad}/{id}/{stage}/{uuid}.{ext}
  file_name       text
  mime_type       text
  size_bytes      bigint
  sha256          text not null            -- HASH obligatorio (tamper-evidence)
  captured_at     timestamptz              -- timestamp del archivo (EXIF/cámara)
  exif            jsonb                    -- metadatos complementarios (NO autoritativo para geo)
  redacted        boolean not null default false   -- erasure de PII: binario borrado, fila+hash persisten (cambio #6)
  redacted_at     timestamptz
  created_by      uuid fk auth.users
  created_at      timestamptz default now()
  -- INMUTABLE por trigger (salvo el flip controlado redacted=true vía RPC de erasure). Binario solo por signed URL.

delivery_pods             -- Proof Of Delivery (1 por shipment entregado) · receptor CANÓNICO
  id                 uuid pk
  public_id          text unique          -- 'POD-2026-0001' (trigger)
  shipment_id        uuid fk shipments(id) on delete restrict unique
  receiver_name      text not null        -- nombre aclarado (FUENTE DE VERDAD; shipments.received_by_name = espejo)
  receiver_document  text                 -- DNI/documento del receptor (PII sensible → acceso restringido)
  observations       text
  signature_evidence_id uuid fk custody_evidence(id)  -- firma (kind='firma', bucket custody-pii)
  pod_storage_path   text                 -- PDF generado del POD (bucket custody-pod)
  signed_at          timestamptz
  created_by         uuid fk auth.users
  created_at         timestamptz default now()
  -- RLS: lectura auth (documento del receptor con gating de rol más estricto), escritura solo RPC.
```

### 4.4 Índices
- `custody_events (packing_unit_id)`, `(shipment_id)`, `(stage)`, `(event_type)`, `(occurred_at)`; **GIST** `(geom)`.
- `custody_evidence (event_id)`, `(kind)`, `(sha256)`, `(created_at)` (barridos de retención).
- `delivery_pods (shipment_id)` (unique), `(signed_at)`; `packing_units (custody_token)` / `shipments (custody_token)` (unique).

### 4.5 Storage — MULTI-BUCKET privado por sensibilidad (cambio #4)
- **`custody-evidence`** (privado) — fotos no-PII (packing, carga, entrega).
- **`custody-pii`** (privado, **RLS más estricta** + retención mínima) — firmas + documentos del receptor.
- **`custody-pod`** (privado, **retención máxima**) — PDFs de POD generados.
- Convención: `custody-{class}/{entidad}/{id}/{stage}/{uuid}.{ext}`. Acceso **solo por signed URL de TTL corto**
  vía función SECURITY DEFINER (patrón 0010). **Prohibido** reusar el bucket público `signatures` (0003).
- **Backup de Storage SEPARADO y obligatorio:** el backup de la DB / PITR (off) **no** cubre binarios.

---

## 5. QR

- **Granularidad doble (D7 = ESTÁNDAR OFICIAL: ambos):**
  - **Por `packing_unit`** — QR impreso en la etiqueta del bulto (junto al `BLT-`). Codifica `custody_token`.
    Capa **granular MELI** (foto/escaneo en packing y carga).
  - **Por `shipment`** — QR del remito/manifiesto de despacho. Codifica `custody_token` del shipment.
    Capa de **entrega/POD**.
- **Payload (D1 = opaco, definitivo):** el QR codifica una URL de resolución +
  `custody_token` (uuid aleatorio), p.ej. `https://nexus.logisticatops.com/c/{token}`. **No** codifica el
  `public_id` (evita enumeración/adivinación). La resolución (`get_custody_by_token`) valida el token y
  devuelve la entidad + su timeline.
- **Imprimible:** se genera del lado servidor/UI (SVG/PNG) a partir del token; entra en la etiqueta del bulto
  (Packing) y en el remito (Despacho). No requiere tabla nueva (el token vive en la columna aditiva).
- **Escaneable móvil:** la app/portal abre la URL del token → pantalla de captura de evidencia
  (foto/firma) contextualizada por etapa. El escaneo en sí **no** es un evento; el evento se registra al
  adjuntar evidencia o confirmar una etapa.

---

## 6. Evidencia fotográfica

- **Momentos de captura (etapas):**
  - **Packing** — foto del bulto cerrado (`packing_unit_id`, `stage=packing`, `event_type=foto_packing`). **Obligatoria** (perfil MELI).
  - **Carga** — foto al cargar al vehículo (`shipment_id`, `stage=despacho`, `event_type=cargado`). Opcional/configurable.
  - **Entrega** — foto en el punto de entrega (`shipment_id`, `stage=entrega`, `event_type=foto_entrega`). **Obligatoria** (perfil MELI).
- **Cantidad mínima:** ≥ 1 foto por etapa obligatoria (packing, entrega).
- **Metadatos + timestamp:** cada foto es un `custody_evidence` (kind=`foto`) con `captured_at` (cámara),
  `exif` (jsonb, **complementario, NO autoritativo** para geo — los clientes pueden strippearlo),
  geo **autoritativa heredada del evento**, `sha256` (obligatorio), `size_bytes`, `mime_type`. Binario en Storage.
- **Obligatoriedad (D8 = CONFIGURABLE POR CLIENTE):** default opcional; perfil **MELI = obligatoria**; se enforce
  en la RPC contra una **política por cliente/`business_unit`** (no hardcode).
- **Comparación ingreso↔egreso (requisito MELI):** modelo preparado; la captura en recepción es extensión
  additive **futura de Gate 1** (D10, fuera del core de Gate 5).

---

## 7. Firma digital + POD

- **Firma del receptor (D3 = canvas → PNG, definitivo):** capturada en el dispositivo (canvas → PNG) y subida
  como `custody_evidence` (kind=`firma`, `stage=entrega`, `event_type=firmado`) al bucket **`custody-pii`**,
  ligada al shipment. Se guarda `sha256` + timestamp + geo + se **embebe en el POD-PDF**. SVG descartado.
  - **Límite legal documentado:** es **firma electrónica simple** (trazo + nombre + documento + timestamp + geo
    + hash = prueba de recepción), **no** firma cualificada/certificada. Si se requiere validez reforzada → e-sign
    certificado (fuera de alcance).
- **POD (`delivery_pods`):** 1 por shipment entregado, **fuente de verdad del receptor**. Reúne `receiver_name`,
  `receiver_document` (PII), `observations`, `signature_evidence_id`, y **PDF generado** (`pod_storage_path`,
  bucket `custody-pod`) con remito + fotos + firma + timeline + hash. `signed_at` sella el momento.
  - **Formato (D4):** **PDF canónico** (server-side, route/Edge Function — D11) + **HTML** como vista derivada.
- **Relación con Gate 4C (D9 = DESACOPLADO, definitivo):** `confirm_delivery` (0035) **NO se modifica** — sigue
  siendo la transición de estado del shipment. El POD es paso **additive posterior**. Para clientes **MELI**, la
  regla "POD antes de dar por completada la entrega" se enforce a **nivel app/política por cliente**, sin acoplar
  la RPC de 4C.

---

## 8. Timeline (cadena de custodia cronológica)

- La línea de tiempo es la secuencia de `custody_events` de una unidad/despacho ordenada por `occurred_at`:
  ```
  packing (foto)  →  despacho (cargado/foto)  →  transporte (en_transito, geo)  →  entrega (foto+firma)  →  pod
  ```
- **Derivada, no persistida como estado:** el "estado de custodia" se deriva del último evento (coherente con
  el principio de roll-ups derivados del resto del WMS). No hay flags de etapa sueltos.
- **Transporte:** los eventos `en_transito` pueden poblarse manualmente o desde Tracking (Traccar) con la
  posición del vehículo asociada al `vehicle_ref` del shipment (D6).
- **Vista unificada:** por `shipment` se agregan sus propios eventos + los de sus `packing_units`
  (vía `packing_units.shipment_id`) para un timeline completo del despacho.

---

## 9. Auditoría (quién / cuándo / dónde / evidencia)

| Dimensión | Origen en el modelo |
|---|---|
| **Quién** | `custody_events.actor_id` + `custody_evidence.created_by` (+ `audit_log.user_id`). |
| **Cuándo** | `custody_events.occurred_at` (evento) + `custody_evidence.captured_at` (archivo). |
| **Dónde** | `custody_events.geo_lat/lng` + `geom` (PostGIS) · `geo_source`/`geo_accuracy_m`; fallback Traccar. |
| **Evidencia** | `custody_evidence` (fotos/firma/doc) con `sha256` + `storage_bucket`/`storage_path` + `exif`. |

- **Inmutabilidad dura + hash-chain:** `custody_events` (con `prev_hash`/`row_hash` encadenado) y
  `custody_evidence` con trigger anti UPDATE/DELETE/TRUNCATE (réplica de `inventory_movements`). Toda alta queda
  en `audit_log` (`custody.*`).
- **Auditoría de LECTURA de PII (cambio #5):** cada emisión de **signed URL** sobre el bucket `custody-pii`
  (firma/documento) registra en `audit_log` (`custody.access`: quién/cuándo/qué evidencia). Las escrituras y las
  lecturas de PII quedan auditadas.
- **Tamper-evidence:** verificación periódica de la **cadena** (recalcular `row_hash` encadenado) + re-hash del
  binario en Storage vs `sha256` en DB. **Anclaje Merkle diario** externo opcional (legal-grade).

### 9.1 Retención y erasure de PII (cambio #6)
- **Retención tiered por bucket:** `custody-pii` = la **menor** retención legal; `custody-evidence` = según SLA del
  cliente; `custody-pod` = la **mayor** (prueba). Ventana objetivo de POD/entrega: **≥ 5 años** (confirmar marco AR/MELI).
- **Estrategia:** los **metadatos + hash** (filas inmutables) se retienen el plazo completo; los **binarios** se
  archivan a almacenamiento frío tras N meses para bajar costo.
- **Derecho de supresión (PII) vs inmutabilidad:** se resuelve por **redacción** — la RPC de erasure borra el
  **binario** en Storage y marca `custody_evidence.redacted=true` (+ `redacted_at`), **conservando la fila y su
  `sha256`/posición en la cadena**. El dato personal se elimina; la cadena de custodia **no se rompe**.

---

## 10. RPC propuestas (SECURITY DEFINER · authz WMS · solo diseño)

> Firmas con **doble FK** (`p_packing_unit_id` / `p_shipment_id`, exactamente uno) — sin `scope`. Cada alta
> computa el `row_hash` encadenado (lee el `row_hash` del último evento de la misma entidad como `prev_hash`).

| RPC | Responsabilidad |
|---|---|
| `attach_custody_evidence(p_packing_unit_id, p_shipment_id, p_stage, p_event_type, p_kind, p_bucket, p_storage_path, p_sha256, p_geo, p_meta jsonb)` | Inserta `custody_events` (hash-chain) + `custody_evidence`. Valida exclusividad de FK + política de obligatoriedad por cliente. Append-only. Audit `custody.attach`. |
| `register_custody_event(p_packing_unit_id, p_shipment_id, p_stage, p_event_type, p_geo, p_notes)` | Evento sin archivo (`cargado`, `en_transito`); hash-chain. |
| `generate_pod(p_shipment_id, p_receiver_name, p_receiver_document, p_observations, p_signature_evidence_id)` | Crea `delivery_pods` (1 por shipment); valida shipment `despachado`/`entregado`. Setea espejo `shipments.received_by_name`. |
| `emit_custody_signed_url(p_evidence_id)` → text | **Lectura de binario:** emite signed URL de TTL corto; **si el bucket es `custody-pii` registra `audit_log` (`custody.access`)** (cambio #5). |
| `redact_custody_evidence(p_evidence_id, p_reason)` | **Erasure de PII (cambio #6):** borra el binario + `redacted=true`; conserva fila/hash/cadena. Audit `custody.redact`. Authz reforzada. |
| `get_custody_by_token(p_token uuid)` → json | **Lectura**: resuelve un QR (token) a la entidad + timeline + evidencias (vía signed URLs). |
| `get_custody_timeline(p_packing_unit_id, p_shipment_id)` → json | **Lectura**: timeline consolidado de una unidad/despacho. |
| `verify_custody_chain(p_shipment_id)` → json | **Auditoría:** recalcula la hash-chain + compara `sha256` de binarios; reporta integridad. |

> Generación de QR (imagen) y render del **PDF de POD** son **server-side app** (route/Edge Function), no RPC de
> DB. Las signed URLs se emiten **solo** vía `emit_custody_signed_url` (para auditar la lectura de PII).

---

## 11. Integración con Gates 4B / 4C (sin reabrirlos)

- **Packing (4B):** al `close_packing_unit` se habilita la captura de **foto de packing** (additive; no se
  modifica la RPC — la foto se adjunta por `attach_custody_evidence`, no por el flujo de packing).
- **Despacho (4C):** al `confirm_dispatch` se habilita la captura de **foto de carga**; el `shipment` ya
  trae `custody_token`. **No** se modifica `confirm_dispatch`.
- **Entrega (4C):** `confirm_delivery` marca el estado; Gate 5 cuelga **foto de entrega + firma + POD** como
  paso **additive posterior** (D9 desacoplado: `confirm_delivery` no se modifica). La obligatoriedad MELI
  (POD antes de completar) es política app/cliente.
- **Reversión (4C):** si un despacho se revierte (`revert_dispatch`), su evidencia de custodia **permanece**
  (append-only); el timeline registra la reversión. La evidencia no se borra (es histórico probatorio).

---

## 12. Riesgos (matriz · post-cambios obligatorios)

| Riesgo | Impacto | Prob. | Mitigación |
|---|---|---|---|
| **Storage NO cubierto por backup** (PITR off; backup de DB no incluye binarios) | 🔴 Alto | Alta | **Backup/replicación de Storage SEPARADO y obligatorio** antes de operar Gate 5. |
| **PII expuesta** (firma/documento del receptor) | 🔴 Alto | Media | Bucket `custody-pii` privado + RLS estricta + signed URLs cortas + **auditoría de lectura** + retención mínima + erasure por redacción. |
| **Integridad insuficiente para auditoría externa** (solo hash por fila) | 🔴 Alto | Media | **Hash-chain `prev_hash`/`row_hash`** + `verify_custody_chain` + anclaje Merkle diario opcional. |
| **Volumen/costo de Storage** (~55 GB/año estimado) | 🟠 Medio | Alta | Compresión/resolución máx., thumbnails, archivado frío, medición de cuota, retención tiered. |
| **Datos huérfanos** (polimorfismo sin FK) | 🟠 Medio | — | **Resuelto:** doble FK nullable + CHECK de exclusividad. |
| **Captura offline** (móvil en tránsito sin señal) | 🟠 Medio | Media | Cola local + sync diferido; `occurred_at`/`captured_at` del momento real, no del upload. |
| **Geo: privacidad laboral / cobertura / precisión** | 🟠 Medio | Media | Configurable + consentimiento; fallback Traccar; `geo_accuracy_m`/`geo_source`; marcar ausencia. |
| **DEV/PROD misma DB** (altas inmutables en prod) | 🟠 Medio | Alta | Additive (no toca stock/ledger); backup manual previo a `0036`; kits 0-footprint. |
| **`event_type` inconsistente** | 🟡 Bajo | — | **Resuelto:** enum `custody_event_type_t` (vocabulario controlado). |
| **Firma sin validez cualificada** (si se exige a futuro) | 🟡 Bajo | Baja | Documentado (firma electrónica simple); e-sign certificado si el marco lo exige (fuera de alcance). |
| **QR adivinable/enumerable** | 🟡 Bajo | Baja | Token opaco aleatorio; resolución validada por RPC. |
| **Tensión erasure (PII) vs inmutabilidad** | 🟡 Bajo | Media | Redacción del binario + fila inmutable `redacted` con hash original. |

---

## 13. Decisiones — RESUELTAS DEFINITIVAMENTE (D1–D11, ninguna abierta)

| # | Decisión | **Resolución final** |
|---|---|---|
| **D1** | Payload del QR | **Token opaco** (`custody_token` uuid aleatorio). No `public_id`. |
| **D2** | Almacenamiento | **Supabase Storage · MÚLTIPLES buckets privados por sensibilidad** (`custody-evidence`/`custody-pii`/`custody-pod`) + signed URLs SECURITY DEFINER (patrón 0010). **Prohibido** el bucket público `signatures` (0003). |
| **D3** | Firma | **Canvas → PNG** en `custody-pii` + embebida en POD-PDF. SVG descartado. Firma electrónica **simple** (límite legal documentado). |
| **D4** | Formato POD | **PDF canónico** (server-side) + **HTML** vista derivada. |
| **D5** | Inmutabilidad | **Append-only + trigger + `sha256` por archivo + HASH-CHAIN (`prev_hash`/`row_hash`)**; anclaje Merkle diario opcional para legal-grade. |
| **D6** | Geolocalización | **Configurable, default opcional** + consentimiento; device-first + fallback Traccar; **PostGIS `geom`** (0016) + `accuracy`/`source`. |
| **D7** | Granularidad QR | **Doble QR (Opción C) = estándar oficial** (unidad granular MELI + despacho entrega/POD). |
| **D8** | Obligatoriedad de evidencia | **Configurable por cliente/`business_unit`**; default opcional; perfil MELI obligatorio; enforce en RPC. |
| **D9** | POD en la entrega | **Desacoplado en DB** (`confirm_delivery` 0035 sin cambios); POD = paso additive posterior; obligatoriedad MELI a nivel app/política. |
| **D10** | Foto de recepción | **Fuera del core**; extensión additive futura de **Gate 1**. |
| **D11** | Generación del PDF de POD | **Server-side** (route/Edge Function), no RPC de DB. |

> **Cambios al modelo respecto de la Rev. 1 (todos incorporados arriba):** doble FK + CHECK (§4.3) · enum
> `custody_event_type_t` (§4.1) · `geom` PostGIS + `geo_accuracy_m`/`geo_source` (§4.3) · `prev_hash`/`row_hash`
> (§4.3) · multi-bucket (§4.5) · `redacted`/`redacted_at` + RPC `redact_custody_evidence` (§4.3/§10) ·
> auditoría de lectura `emit_custody_signed_url`/`custody.access` (§9/§10) · `custody_evidence` particionada por mes.

---

## 14. Plan de implementación futuro (referencia — NO ejecutar)

**Fase 0 — Resguardo:** backup manual (PITR off); rama `feat/gate-5-custody`.

**Fase 1 — Migración `0036_custody_core.sql` (additive):** enums (`custody_stage_t`, **`custody_event_type_t`**,
`evidence_kind_t`); tablas `custody_events` (**doble FK + CHECK + `prev_hash`/`row_hash` + `geom` PostGIS**),
`custody_evidence` (**particionada por mes, `sha256` not null, `redacted`**), `delivery_pods` + triggers
`public_id` + **triggers de inmutabilidad** (append-only) + **trigger de hash-chain**; columnas `custody_token`
en `packing_units`/`shipments`; RLS lockdown. Sin tocar Gates 1–4C.

**Fase 2 — Storage:** **3 buckets privados** (`custody-evidence`/`custody-pii`/`custody-pod`) + policies RLS +
**backup de Storage separado**.

**Fase 3 — RPC `0037_custody_functions.sql`:** `attach_custody_evidence`, `register_custody_event`,
`generate_pod`, `emit_custody_signed_url` (**audita lectura PII**), `redact_custody_evidence` (**erasure**),
`verify_custody_chain`, lecturas `get_custody_by_token` / `get_custody_timeline`. Grants. Kit 0-footprint
(altas inmutables, **hash-chain**, tamper, **erasure**, token, POD, política de obligatoriedad).

**Fase 4 — Capa TS:** `src/lib/custody/*` (wrappers RPC + signed URLs auditadas + generación de QR).

**Fase 5 — UI:** captura móvil (foto/firma) por QR; pantalla de timeline/POD; impresión de etiqueta con QR
en Packing y remito en Despacho. Server Actions + `revalidatePath()`.

**Fase 6 — POD-PDF:** route/Edge Function que arma el PDF (firma embebida) y lo sube a `custody-pod`.

**Fase 7 — Validación:** kit SQL + E2E (packing→carga→entrega→firma→POD; verificar inmutabilidad, hash-chain,
tamper, erasure de PII, auditoría de lectura). Commit aislado. Sin push hasta OK.

---

## 15. Fuera de alcance (NO en Gate 5)

- **Gate 6** y posteriores: no se diseñan acá.
- Integración profunda con **Hikvision CCTV** para fotos automáticas de dársena (futuro additive).
- **Liquidación/facturación** del POD, e-sign con proveedor externo certificado, biometría.
- Cualquier cambio a stock/ledger/flujos de Gates 1–4C (Gate 5 es solo evidencia/auditoría).

---

## 16. Resumen para aprobación

- **Hallazgos:** el modelo actual (`packing_units` + `shipments` + `packing_units.shipment_id` + Storage +
  patrón de inmutabilidad del ledger + PostGIS) **ya soporta** Gate 5 como capa additive de evidencia.
- **Modelo de datos (Rev. 2):** 3 enums (`custody_stage_t`, `custody_event_type_t`, `evidence_kind_t`) + 3 tablas
  (`custody_events` con doble FK + hash-chain + PostGIS; `custody_evidence` particionada + `redacted`;
  `delivery_pods`) + 2 columnas `custody_token` + **3 buckets privados**. Append-only, inmutable y **encadenado**.
- **Decisiones:** **D1–D11 RESUELTAS** (§13).
- **Riesgos principales:** Storage sin backup (mitigado), PII (mitigado: bucket PII + auditoría de lectura +
  erasure), integridad externa (mitigado: hash-chain), volumen Storage, captura offline.
- **Plan futuro:** `0036`/`0037` additivas → Storage multi-bucket → TS → UI → POD-PDF → validación. **No iniciar aún.**

---

## 17. Estado y justificación

### 🟢 READY TO CODE

**Justificación:**
- Los **7 cambios obligatorios** de `GATE_5_ARCHITECTURE_REVIEW.md` están **incorporados** al diseño
  (doble FK + CHECK · hash-chain · multi-bucket privado · auditoría de lectura de PII · PostGIS · retención +
  redacción de PII · vocabulario controlado).
- Las **11 decisiones (D1–D11) quedan resueltas** — ninguna abierta.
- El modelo es **apto para auditorías externas** (append-only + hash-chain + verificación; anclaje Merkle
  opcional para legal-grade) y cumple los no-negociables del proyecto (auditoría, inmutabilidad) más
  **compliance/PII**.
- Es **estrictamente additive** sobre Gates 1–4C (cerrados): no reabre stock/ledger/flujos; solo agrega
  2 columnas `custody_token` y tablas/buckets nuevos.

**Prerrequisitos operativos antes de codear (no bloquean el diseño, sí la aplicación):**
1. **Backup de Storage separado** definido (PITR off; el backup de DB no cubre binarios).
2. **Marco legal/retención** confirmado (ventana de retención de POD/PII; base legal de geo y de datos del receptor).
3. **Backup manual previo** a aplicar `0036` (DB compartida DEV/PROD).

Con el diseño en este estado, la implementación puede comenzar por el plan de §14 cuando se autorice.

> **FIN — Diseño arquitectónico de Gate 5 (Rev. 2). Estado: READY TO CODE.** Sin código, sin migraciones, sin TS/UI/SQL.
> **NO iniciar implementación. NO iniciar Gate 6.** Detenido.

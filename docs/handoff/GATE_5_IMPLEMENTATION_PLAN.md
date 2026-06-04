# GATE 5 — Cadena de Custodia Digital · PLAN TÉCNICO DE IMPLEMENTACIÓN

> Estado: **plan técnico definitivo. READ ONLY. NO implementado.** Sin SQL/TS/React/migraciones/commits.
> No modifica documentación existente. Fuente: `GATE_5_CHAIN_OF_CUSTODY_DESIGN.md` (Rev. 2, READY TO CODE) +
> `GATE_5_ARCHITECTURE_REVIEW.md` (7 cambios obligatorios incorporados, D1–D11 resueltas).
> Roles: Principal Architect + Staff Engineer + Security + Compliance. Repo `~/CODE/tops-ordenes` @ `0a3c289`
> (Gates 1–4C CERRADOS; última migración `0035`). Esperar aprobación explícita antes de implementar.

---

## 1. Resumen ejecutivo

**Objetivo:** dar **trazabilidad probatoria de extremo a extremo** (quién/cuándo/dónde + evidencia) de cada
unidad logística (`packing_unit`) y cada despacho (`shipment`), con **QR**, **evidencia fotográfica**,
**firma del receptor**, **POD** y una **línea de tiempo inmutable y encadenada** (hash-chain), apta para
**auditorías externas** y compliance de **PII**.

**Alcance (Gate 5):**
- Tablas de custodia (`custody_events`, `custody_evidence`, `delivery_pods`) + tokens QR en
  `packing_units`/`shipments` (columnas aditivas).
- 3 buckets privados de Storage + emisión de signed URLs auditada.
- RPC de captura/evento/POD/erasure/verificación + lecturas (token, timeline).
- Capa TS + UI (captura móvil, timeline, POD, etiquetas con QR) + generación de POD-PDF server-side.

**No alcance:**
- Cambios a stock/ledger/flujos de Gates 1–4C (additive estricto; `confirm_delivery` **no** se modifica).
- Foto de recepción antes/después (extensión futura de Gate 1 — D10).
- e-sign **certificado**, biometría, integración profunda con Hikvision CCTV, facturación del POD.
- Gate 6 y posteriores.

---

## 2. Estrategia de implementación — fases y numeración

> El ejemplo del pedido (`0036` Core / `0037` Evidence+Storage / `0038` POD+Signature / `0039` QR+Timeline) es
> **ilustrativo**. La numeración **correcta** se determina por dependencias reales: **Storage debe existir antes
> de las RPC de evidencia**; **QR** son columnas (en Core) + app-side (no migración); **firma/POD** son RPC +
> server-side; **timeline** es una RPC de lectura.

| Migración | Nombre | Contenido | Depende de |
|---|---|---|---|
| **`0036`** | **Custody Core** | 3 enums; tablas `custody_events`/`custody_evidence`/`delivery_pods`; triggers `public_id`, inmutabilidad, **hash-chain**; columnas `custody_token` en `packing_units`/`shipments`; RLS lockdown. **Sin RPC.** | 0033/0035 |
| **`0037`** | **Storage + Read-Audit** | 3 buckets privados (`custody-evidence`/`custody-pii`/`custody-pod`) con `file_size_limit`+`allowed_mime_types`; policies de `storage.objects`; **`emit_custody_signed_url`** (SECURITY DEFINER, audita lectura PII — patrón `log_document_event` de 0010). | 0036 |
| **`0038`** | **Custody RPC — Evidence + Chain** | `attach_custody_evidence`, `register_custody_event`, `redact_custody_evidence` (erasure), `verify_custody_chain`; helper de **política de obligatoriedad por cliente**. | 0036/0037 |
| **`0039`** | **Custody RPC — POD + Reads** | `generate_pod`; lecturas `get_custody_by_token`, `get_custody_timeline`. | 0036/0038 |

**No-migraciones (capas de app, posteriores a `0039`):**
- **TS** `src/lib/custody/*` · **UI** captura/timeline/POD/etiquetas · **POD-PDF** route/Edge Function · **QR** generación de imagen (app-side).

**Gaps de numeración:** `0012`/`0028` siguen ausentes (intencionales). `0036`–`0039` son consecutivas.

---

## 3. Modelo de datos (detalle por tabla)

### 3.1 Enums (`0036`)
- `custody_stage_t` = `('packing','despacho','transporte','entrega','pod')`.
- `custody_event_type_t` = `('foto_packing','cargado','en_transito','foto_entrega','firmado','pod')` (vocabulario controlado).
- `evidence_kind_t` = `('foto','firma','documento')`.

### 3.2 `custody_events` (append-only · hash-chain · alto-medio volumen)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `public_id` | text unique | `CUST-2026-0001` (trigger) |
| `packing_unit_id` | uuid **fk** packing_units(id) on delete restrict | NULL si es de shipment |
| `shipment_id` | uuid **fk** shipments(id) on delete restrict | NULL si es de unidad |
| `stage` | custody_stage_t | |
| `event_type` | custody_event_type_t | |
| `actor_id` | uuid fk auth.users | QUIÉN |
| `occurred_at` | timestamptz | CUÁNDO |
| `geo_lat`/`geo_lng` | double precision | entrada (opcional) |
| `geo_accuracy_m` | numeric | precisión reportada |
| `geo_source` | text | `device`/`traccar`/null |
| `geom` | `extensions.geometry(Point,4326)` **GENERADA** | de lng/lat (patrón 0016) |
| `device_ref` | text | |
| `notes` | text | |
| `prev_hash` | text | `row_hash` del evento anterior de la misma entidad |
| `row_hash` | text not null | `SHA256(prev_hash ‖ campos_canónicos ‖ sha256_evidencia)` |
| `created_at` | timestamptz default now() | |

- **Constraints:** `CHECK (num_nonnulls(packing_unit_id, shipment_id) = 1)` (exclusividad); `event_type` válido por `stage` (CHECK).
- **Índices:** `(packing_unit_id)`, `(shipment_id)`, `(stage)`, `(event_type)`, `(occurred_at)`, **GIST** `(geom)`.
- **Triggers:** `public_id`; **inmutabilidad** (anti UPDATE/DELETE/TRUNCATE, réplica de `inventory_movements`); **hash-chain** (lee prev `row_hash`, computa el propio).
- **RLS:** lectura `authenticated`; escritura **solo RPC**.

### 3.3 `custody_evidence` (archivos · **particionada por mes** · ALTO volumen)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `event_id` | uuid fk custody_events(id) on delete restrict | |
| `kind` | evidence_kind_t | |
| `storage_bucket` | text not null | `custody-evidence`/`custody-pii`/`custody-pod` (CHECK) |
| `storage_path` | text not null | `custody-{class}/{entidad}/{id}/{stage}/{uuid}.{ext}` |
| `file_name` / `mime_type` | text | |
| `size_bytes` | bigint | |
| `sha256` | text **not null** | tamper-evidence |
| `captured_at` | timestamptz | EXIF/cámara |
| `exif` | jsonb | complementario (no autoritativo para geo) |
| `redacted` | boolean not null default false | erasure de PII |
| `redacted_at` | timestamptz | |
| `created_by` | uuid fk auth.users | |
| `created_at` | timestamptz default now() | clave de partición |

- **Constraints:** `unique(storage_bucket, storage_path)` (como 0010); `sha256 not null`.
- **Partición:** `PARTITION BY RANGE (created_at)` con particiones **mensuales** + partición `default`; job de
  mantenimiento crea la del mes siguiente. Índices por partición: `(event_id)`, `(kind)`, `(sha256)`, `(created_at)`.
- **Triggers:** inmutabilidad (excepto el flip controlado `redacted=true` vía RPC de erasure).
- **RLS:** lectura `authenticated`; escritura solo RPC; el **binario** solo por signed URL.

### 3.4 `delivery_pods` (POD · 1 por shipment · bajo volumen)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `public_id` | text unique | `POD-2026-0001` (trigger) |
| `shipment_id` | uuid fk shipments(id) on delete restrict **unique** | 1:1 |
| `receiver_name` | text not null | **fuente de verdad** (espejo en `shipments.received_by_name`) |
| `receiver_document` | text | PII sensible (gating de rol más estricto) |
| `observations` | text | |
| `signature_evidence_id` | uuid fk custody_evidence(id) | firma (bucket `custody-pii`) |
| `pod_storage_path` | text | PDF (bucket `custody-pod`) |
| `signed_at` | timestamptz | |
| `created_by` | uuid fk auth.users | |
| `created_at` | timestamptz default now() | |

- **Índices:** `(shipment_id)` unique, `(signed_at)`.
- **RLS:** lectura `authenticated` (documento con gating reforzado); escritura solo RPC.

### 3.5 Columnas aditivas (`0036`)
- `packing_units.custody_token uuid unique default gen_random_uuid()` + `(custody_token)` index.
- `shipments.custody_token uuid unique default gen_random_uuid()` + `(custody_token)` index.

### 3.6 Volumen esperado (supuestos explícitos)
- 200 bultos/día · 2 fotos/bulto + 60 despachos/día · (1 foto carga + 1 foto entrega + 1 firma).
- **Filas DB:** `custody_events`/`custody_evidence` ≈ **~520/día ≈ ~190K/año** (filas chicas; particionado mensual).
- **Storage:** ~520 archivos/día · ~300 KB ≈ **~155 MB/día ≈ ~55 GB/año** (recalcular con volúmenes reales TOPS).
- `delivery_pods` ≈ 60/día ≈ ~22K/año (+ 1 PDF c/u).

---

## 4. Estrategia QR (flujo operativo completo)

- **QR Packing Unit** — codifica `packing_units.custody_token`; capa **granular MELI**. Se imprime en la
  etiqueta del bulto al `close_packing_unit` (Packing).
- **QR Shipment** — codifica `shipments.custody_token`; capa **entrega/POD**. Se imprime en el remito al
  `confirm_dispatch` (Despacho).
- **Doble QR = estándar oficial (D7).** Payload **opaco** (token, no `public_id`): URL `…/c/{token}`.

**Flujo:**
1. **Generación:** el token nace con la fila (default `gen_random_uuid()`); la **imagen QR** se genera app-side
   (SVG/PNG) a partir del token. No requiere tabla nueva.
2. **Impresión:** etiqueta del bulto (Packing) y remito (Despacho). Reimprimible cuantas veces se quiera (el
   token no cambia).
3. **Escaneo:** abre `…/c/{token}` → `get_custody_by_token` resuelve a la entidad + timeline + pantalla de
   captura contextual por etapa.
4. **Reemplazo/Reemisión:** si un token se compromete o una etiqueta se pierde, una RPC `rotate_custody_token`
   (additive, opcional) genera un **token nuevo** e **invalida el anterior**; el evento de rotación queda en el
   timeline (auditoría). El `public_id` (`BLT-`/`DSP-`) **no** cambia. *(Decisión menor: incluir rotación en `0038`
   o diferir a 4C.1 de custodia — recomendado incluirla por seguridad.)*

---

## 5. Storage (3 buckets privados · `0037`)

| Bucket | Contenido | Sensibilidad | Lifecycle / retención | MIME / límite |
|---|---|---|---|---|
| `custody-evidence` | fotos packing/carga/entrega | media | SLA cliente; archivado frío tras N meses | image/jpeg,png,webp · límite p.ej. 8 MB |
| `custody-pii` | firmas + documentos del receptor | **alta (PII)** | **mínima legal**; erasure por redacción | image/png · límite p.ej. 2 MB |
| `custody-pod` | PDFs de POD generados | prueba | **máxima** (≥5 años, confirmar) | application/pdf · límite p.ej. 10 MB |

- **Naming:** `custody-{class}/{entidad}/{id}/{stage}/{uuid}.{ext}` (p.ej. `custody-pii/shipment/<id>/entrega/<uuid>.png`).
- **Acceso:** **solo signed URL de TTL corto** vía `emit_custody_signed_url` (SECURITY DEFINER); RLS de
  `storage.objects` restringe a roles WMS. **`custody-pii` con gating de rol más estricto.** Nada público.
- **Backup:** **estrategia SEPARADA y obligatoria** (PITR off + el backup de DB no cubre binarios): export/replica
  periódica del Storage. Sin esto, la evidencia no es recuperable.
- **Costos:** lineal con la operación (~55 GB/año + crecimiento). Mitigación: compresión/resolución máx.,
  thumbnails para listados, archivado frío, medición de cuota.

---

## 6. Evidencia (packing / carga / entrega)

| Etapa | Entidad | event_type | Obligatoriedad (perfil MELI) | Mínimo | Recomendado |
|---|---|---|---|---|---|
| Packing | packing_unit | `foto_packing` | **Obligatoria** | 1 | 1–2 (frente + contenido) |
| Carga | shipment | `cargado` | Configurable | 0 | 1 (carga al vehículo) |
| Entrega | shipment | `foto_entrega` | **Obligatoria** | 1 | 1–2 (mercadería + lugar) |

- **Metadatos:** `captured_at` (cámara), `geo` autoritativa del evento (no EXIF), `exif` (complementario),
  `sha256` (obligatorio), `size_bytes`, `mime_type`.
- **Hash:** el `sha256` del archivo entra en el `row_hash` del evento (hash-chain).
- **Obligatoriedad (D8):** **configurable por cliente/`business_unit`**; enforce en `attach_custody_evidence`
  contra una política (helper). Default opcional; MELI obligatorio.

---

## 7. Firma digital

- **Formato (D3):** **Canvas → PNG**. SVG descartado.
- **Almacenamiento:** bucket **`custody-pii`** como `custody_evidence` (kind=`firma`, `stage=entrega`,
  `event_type=firmado`), con `sha256` + geo + timestamp.
- **Visualización:** solo vía signed URL auditada (`emit_custody_signed_url` → `custody.access`).
- **Exportación PDF:** **embebida** en el POD-PDF (server-side).
- **Implicancia legal (documentada):** firma electrónica **simple** (prueba de recepción), no cualificada.

---

## 8. POD

- **Generación (D4/D11):** `generate_pod` (RPC) crea `delivery_pods` (metadatos + refs); un **render server-side**
  (route/Edge Function) arma el **PDF** (remito + fotos + firma embebida + timeline + hash) y lo sube a
  `custody-pod`, actualizando `pod_storage_path`.
- **Persistencia:** fila `delivery_pods` (1:1 shipment) + PDF en Storage.
- **Consulta:** por shipment o por `get_custody_by_token` (token del shipment) → POD + timeline + evidencias.
- **Exportación:** PDF descargable vía signed URL; **HTML** como vista derivada en la UI.
- **Desacople de 4C (D9):** `confirm_delivery` **no** se modifica; el POD es additive posterior. La regla
  "POD antes de completar" (MELI) es política app/cliente.

---

## 9. Timeline (cadena cronológica)

```
packing (foto)  →  despacho (cargado/foto)  →  transporte (en_transito, geo)  →  entrega (foto+firma)  →  pod
```
- **Derivado** de `custody_events` ordenados por `occurred_at`; estado de custodia = último evento (sin flags).
- **Vista unificada por shipment:** sus eventos + los de sus `packing_units` (vía `packing_units.shipment_id`).
- **Transporte:** eventos `en_transito` manuales o desde Tracking (Traccar) con la posición del `vehicle_ref`.
- **RPC:** `get_custody_timeline(p_packing_unit_id, p_shipment_id)` → json consolidado.

---

## 10. Seguridad

- **Acceso:** buckets privados; binarios solo por **signed URL TTL corto**; `custody-pii` con gating de rol reforzado.
- **RLS:** lectura `authenticated` en tablas; **escritura solo RPC** (lockdown, patrón WMS); sin policies de escritura directa.
- **Signed URLs:** **únicamente** vía `emit_custody_signed_url` (SECURITY DEFINER) — para poder **auditar la lectura**.
- **Auditoría:** escrituras (`custody.attach`/`custody.event`/`custody.redact`/`custody.pod`) **y lecturas de PII**
  (`custody.access`) en `audit_log`. (Cierra el gap del diseño Rev.1.)
- **Retención:** tiered por bucket (PII mínima, POD máxima); metadatos+hash retenidos el plazo completo; binarios
  archivados a frío tras N meses. **Erasure** de PII por redacción (`redact_custody_evidence`): borra binario,
  conserva fila+hash+posición en cadena.

---

## 11. Integridad

- **`sha256` por archivo:** tamper-evidence del binario (re-hash vs DB).
- **Hash-chain de eventos:** `row_hash = SHA256(prev_hash ‖ campos_canónicos ‖ sha256_evidencia)`; cada evento
  encadena al anterior de la misma entidad → alterar la secuencia rompe la cadena. Implementado por **trigger**
  (lee el `row_hash` previo) y/o computado en `attach_custody_evidence` (que recibe `p_sha256`).
- **Verificación:** `verify_custody_chain(p_shipment_id)` recalcula la cadena + compara `sha256` → reporte de integridad.
- **Auditoría externa:** append-only + hash-chain + `verify_*` = **apto para auditoría externa**. Para **legal-grade**:
  **anclaje Merkle diario** (export del root a destino inmutable/timestamping) — opcional, recomendado para MELI.

---

## 12. TS — mapa (sin código)

**`src/lib/custody/`**
- `types.ts` — `CustodyStage`, `CustodyEventType`, `EvidenceKind`, `CustodyEvent`, `CustodyEvidence`,
  `DeliveryPod`, `CustodyTimeline`, `CustodyTokenRef` (reusa `PhysicalLocation` donde aplique).
- `custody.ts` — wrappers RPC: `attachCustodyEvidence`, `registerCustodyEvent`, `generatePod`,
  `redactCustodyEvidence`, `verifyCustodyChain`, `getCustodyByToken`, `getCustodyTimeline`.
- `signed-url.ts` — `emitCustodySignedUrl(evidenceId)` (envuelve la RPC auditada).
- `qr.ts` — generación de imagen QR a partir del token (SVG/PNG) + helpers de URL `…/c/{token}`.
- `pod.ts` — orquestación de generación del POD-PDF (llama a la route/Edge Function).

**Server Actions** (en las rutas correspondientes): `attachEvidenceAction`, `registerEventAction`,
`generatePodAction`, `redactEvidenceAction` — todas con `revalidatePath()` de las vistas de custodia y, donde
corresponda, de packing/despachos. **Sin `router.refresh()`.**

**Patrón:** `isMock()` + `createClient()`; mutaciones **solo** vía RPC; lecturas por accessors.

---

## 13. UI — mapa (sin código)

| Vista / componente | Ruta / ubicación | Rol |
|---|---|---|
| Resolver de QR | `/c/[token]` (público autenticado) | Escaneo móvil → entidad + timeline + captura contextual |
| Captura en Packing | integrado en `/wms/packing/[id]` | Foto del bulto al cerrar (QR de unidad) |
| Captura en Despacho | integrado en `/wms/despachos/[id]` | Foto de carga; al entregar: foto + firma + POD |
| Timeline de custodia | `/wms/despachos/[id]` (panel) o `/wms/custodia/[id]` | Línea de tiempo packing→…→pod + evidencias |
| Vista/descarga POD | `/wms/despachos/[id]` | POD (HTML) + descarga PDF (signed URL) |
| Etiqueta con QR | impresión en Packing | QR de unidad en la etiqueta del bulto |
| Remito con QR | impresión en Despacho | QR de shipment en el remito |

**Componentes cliente:** `PhotoCapture` (cámara), `SignaturePad` (canvas), `CustodyTimeline`, `PodView`,
`QrLabel`, `EvidenceGallery` (thumbnails + signed URL on-demand). Estética `nx-*`. Mobile-first para captura.

---

## 14. QA

- **Validación SQL (kit 0-footprint, `BEGIN/ROLLBACK` + sentinel):**
  - C1 alta de evento + evidencia (hash-chain: `row_hash` encadenado correcto).
  - C2 doble FK CHECK (exclusividad packing_unit/shipment) — rechaza ambos/ninguno.
  - C3 inmutabilidad (UPDATE/DELETE sobre `custody_events`/`custody_evidence` → rechazados).
  - C4 hash-chain tamper (alterar un evento rompe `verify_custody_chain`).
  - C5 erasure (`redact_custody_evidence`): binario marcado redacted, fila+hash persisten, cadena intacta.
  - C6 política de obligatoriedad por cliente (MELI exige foto; rechaza alta sin evidencia obligatoria).
  - C7 POD (`generate_pod` 1×; segundo → rechaza por unique).
  - C8 resolución de token (`get_custody_by_token`), timeline consolidado.
  - C9 authz (sin rol → rechazo) + auditoría de lectura (`custody.access` registrado).
- **Smoke test:** un evento+evidencia sobre `Test-*` → verificar fila + hash-chain + audit; revert por rollback.
- **E2E navegador:** packing(foto)→despacho(foto carga)→entrega(foto+firma)→POD; verificar timeline,
  signed URLs auditadas, PDF generado, restaurar fixture.
- **Validación Storage:** subida a cada bucket; acceso **solo** por signed URL; bucket público `signatures` (0003)
  **no** usado; backup de Storage verificado.
- **Validación QR:** generación + impresión + escaneo `…/c/{token}` resuelve a la entidad; token rotado invalida el anterior.
- **Validación POD:** PDF contiene remito + fotos + firma + timeline + hash; descarga por signed URL.

---

## 15. Riesgos

| Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|
| **Storage sin backup** (PITR off; backup DB no cubre binarios) | 🔴 Alto | Alta | Backup/replicación de Storage **separado y obligatorio** antes de operar. |
| **PII expuesta** (firma/documento) | 🔴 Alto | Media | Bucket `custody-pii` + RLS estricta + signed URLs cortas + auditoría de lectura + retención mínima + erasure. |
| **Integridad insuficiente para auditoría externa** | 🔴 Alto | Media | Hash-chain + `verify_custody_chain` + anclaje Merkle diario opcional. |
| **Volumen/costo de Storage** (~55 GB/año) | 🟠 Medio | Alta | Compresión/resolución, thumbnails, archivado frío, medición de cuota, retención tiered. |
| **Partición/maintenance de `custody_evidence`** | 🟠 Medio | Media | Particionado mensual + job que crea la partición siguiente + partición default de respaldo. |
| **Captura offline** (móvil sin señal) | 🟠 Medio | Media | Cola local + sync diferido; `occurred_at`/`captured_at` del momento real. |
| **Geo: privacidad / cobertura / precisión** | 🟠 Medio | Media | Configurable + consentimiento; fallback Traccar; `geo_accuracy_m`/`geo_source`. |
| **DEV/PROD misma DB** (altas inmutables en prod) | 🟠 Medio | Alta | Additive; backup manual previo a `0036`; kits 0-footprint. |
| **Hash-chain mal computado** (orden/concurrencia) | 🟠 Medio | Media | `FOR UPDATE` del último evento de la entidad al encadenar; serializar en la RPC; test C4. |
| **Firma sin validez cualificada** | 🟡 Bajo | Baja | Documentado (firma simple); e-sign certificado si el marco lo exige (fuera de alcance). |
| **QR adivinable / etiqueta perdida** | 🟡 Bajo | Baja | Token opaco + `rotate_custody_token` con auditoría. |

---

## 16. Checklist de ejecución (paso a paso)

> Migraciones las aplica Martín a mano (el asistente no ejecuta WRITES). **Ningún paso sin OK explícito.**

**Fase 0 — Resguardo y prerrequisitos (obligatorio):**
- [ ] Confirmar **backup de Storage** definido (no cubierto por DB/PITR).
- [ ] Confirmar **marco legal/retención** (ventana POD/PII; base legal de geo y datos del receptor).
- [ ] Backup manual de Supabase (DB compartida, PITR off). Rama `feat/gate-5-custody`.

**Fase 1 — `0036` Custody Core:**
- [ ] Escribir `0036_custody_core.sql` (enums + 3 tablas + doble FK/CHECK + hash-chain + PostGIS `geom` + partición + triggers + tokens + RLS). Aplicar. Verificar.

**Fase 2 — `0037` Storage + Read-Audit:**
- [ ] Crear 3 buckets privados + policies + `emit_custody_signed_url` (auditada). Aplicar. Verificar acceso solo por signed URL.

**Fase 3 — `0038` Evidence + Chain RPC:**
- [ ] `attach_custody_evidence`/`register_custody_event`/`redact_custody_evidence`/`verify_custody_chain` + política de obligatoriedad. Aplicar.

**Fase 4 — `0039` POD + Reads:**
- [ ] `generate_pod`/`get_custody_by_token`/`get_custody_timeline`. Aplicar.

**Fase 5 — Validación SQL:**
- [ ] Correr `gate5_custody_validation_report.sql` (C1–C9, 0 footprint). Todo `OK`. **No avanzar si la hash-chain/erasure/authz fallan.**

**Fase 6 — Capa TS:** `src/lib/custody/*` (wrappers + signed URLs + QR + pod). `tsc`/`eslint` verdes.

**Fase 7 — UI:** resolver `/c/[token]`, captura en packing/despachos, timeline, POD, etiquetas/remito con QR. Server Actions + `revalidatePath()`.

**Fase 8 — POD-PDF:** route/Edge Function que arma y sube el PDF a `custody-pod`.

**Fase 9 — E2E + Storage/QR/POD:** flujo completo (§14); evidencia + backup de Storage verificados.

**Fase 10 — Cierre:** actualizar handoffs (Gate 5 cerrado); commit aislado por fase/módulo; **sin push** hasta OK.

---

## 17. Definition of Done

- [ ] `0036`–`0039` aplicadas; 3 enums + 3 tablas (con doble FK/CHECK, hash-chain, PostGIS, partición) + tokens QR + RLS lockdown.
- [ ] 3 buckets privados + signed URLs **solo** vía `emit_custody_signed_url` (auditada); bucket público `signatures` **no** usado; **backup de Storage** operativo.
- [ ] Captura de evidencia (packing/carga/entrega) con `sha256` + geo + metadata; **obligatoriedad configurable por cliente** (MELI obligatorio).
- [ ] Firma (canvas PNG) en `custody-pii`; **POD** (fila + PDF server-side con firma embebida + timeline + hash).
- [ ] **Hash-chain** correcta + `verify_custody_chain` OK; inmutabilidad (UPDATE/DELETE rechazados); **erasure** por redacción funciona sin romper la cadena.
- [ ] **Auditoría** de escritura **y de lectura de PII** en `audit_log`.
- [ ] QR doble (unidad + shipment), opaco, imprimible/escaneable; resolución por token; rotación auditada.
- [ ] Timeline consolidado (packing→…→pod) por unidad y por shipment.
- [ ] Kit SQL (C1–C9) **0 footprint, todo OK** + smoke + E2E + validación Storage/QR/POD.
- [ ] `tsc`/`eslint` verdes; UI mobile-first; sin `router.refresh()`; **additive** (Gates 1–4C intactos).
- [ ] Handoffs actualizados (Gate 5 cerrado); commits aislados; **sin push** hasta OK.
- [ ] **Compliance:** retención tiered aplicada; base legal de PII/geo documentada; (recomendado) anclaje Merkle para legal-grade.

---

> **FIN — Plan técnico de implementación de Gate 5. READ ONLY.** Sin SQL/migraciones/TS/React/commits.
> Numeración determinada: **`0036` Core · `0037` Storage+Read-Audit · `0038` Evidence+Chain · `0039` POD+Reads** + capas app.
> **NO iniciar implementación. NO iniciar `0036`. NO iniciar Gate 6.** Esperar aprobación explícita. Detenido.

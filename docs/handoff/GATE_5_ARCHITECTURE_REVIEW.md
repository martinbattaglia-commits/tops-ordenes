# GATE 5 — Cadena de Custodia · REVISIÓN ARQUITECTÓNICA (PRE-IMPLEMENTACIÓN)

> Revisión crítica del diseño `GATE_5_CHAIN_OF_CUSTODY_DESIGN.md`. **READ ONLY. Sin código/migraciones/SQL/TS/UI/commits.**
> Roles: Principal Architect + Security Architect + Compliance Architect.
> Repo `~/CODE/tops-ordenes` @ `0a3c289` (Gates 1–4C CERRADOS). Verificado contra esquema real `0024`–`0035`
> + patrones de Storage (`0003`/`0010`) y PostGIS (`0016`).
> **Resultado: APROBADO CON CAMBIOS OBLIGATORIOS.** D1–D11 resueltas (ninguna abierta). No iniciar implementación.

---

## 0. Veredicto ejecutivo

El diseño de Gate 5 es **sólido y correctamente additive** (cuelga de `packing_units`/`shipments`, no toca
stock/ledger/flujos 1–4C). Sin embargo, una revisión crítica de **modelo de datos, seguridad y compliance**
exige **cambios obligatorios antes de implementar**:

1. **Reemplazar el polimorfismo `scope/scope_id`** por **dos FK nullable + CHECK de exclusividad** (integridad referencial real).
2. **Multi-bucket por sensibilidad** (PII separada), **nunca** reusar el bucket público `signatures` (0003).
3. **Hash-chaining** (`prev_hash`) sobre `custody_events` para auditoría **legal-grade** (no solo hash por fila).
4. **Auditar la LECTURA** de evidencia PII (emisión de signed URL), no solo la escritura.
5. **Vocabulario controlado** para `event_type` (enum/CHECK), no texto libre.
6. **Geo con PostGIS** (`extensions.geometry(Point,4326)` generado) siguiendo el patrón de Tracking (0016).
7. **Política de retención + erasure** de PII conciliada con la inmutabilidad (redacción de binario, fila inmutable persiste).

Con estos 7 cambios, el modelo queda apto para auditorías externas. Detalle abajo.

---

## 1. Modelo de datos — auditoría crítica

### 1.1 `custody_events`
| Hallazgo | Severidad | Recomendación |
|---|---|---|
| **Polimorfismo `scope`+`scope_id` sin FK** → pierde integridad referencial; un `scope_id` puede quedar huérfano. | 🟠 Alta | **Reemplazar por `packing_unit_id uuid null fk` + `shipment_id uuid null fk` + CHECK `num_nonnulls(packing_unit_id, shipment_id) = 1`.** Da FK real, `on delete`, y consultas más simples. Elimina `scope`/`scope_id`. |
| `event_type text` libre vs `stage` enum → riesgo de valores inconsistentes. | 🟠 Media | **Vocabulario controlado:** enum `custody_event_type_t` o CHECK contra lista por `stage`. |
| `geo_lat/lng numeric` plano → no aprovecha PostGIS ya instalado (0016). | 🟡 Media | Agregar columna **generada** `geom extensions.geometry(Point,4326)` (patrón 0016) para consultas espaciales; mantener lat/lng como entrada. |
| Falta encadenamiento de integridad (`prev_hash`). | 🟠 Alta (compliance) | **Agregar `prev_hash` + `row_hash`** (hash-chain) — ver §8. |
| `occurred_at` vs `custody_evidence.captured_at` | 🟢 OK | No es redundancia: evento (acción) vs archivo (captura). Documentar. |

### 1.2 `custody_evidence`
| Hallazgo | Severidad | Recomendación |
|---|---|---|
| `storage_bucket` + `storage_path` correctos; `sha256` para tamper-evidence. | 🟢 OK | Mantener. **`sha256 not null`** (obligatorio). |
| **Tabla de alto volumen** (fotos) → millones de filas/año. | 🟠 Media | **Particionar por `created_at` (mensual)** desde el diseño; o al menos índice por `created_at` para barridos de retención. |
| Dependencia de **EXIF** para geo poco confiable (clientes que lo strippean). | 🟡 Media | Geo autoritativa = evento; EXIF = complemento. No depender de EXIF. |
| `kind='documento'` (documento del receptor) mezcla PII con fotos no-PII en la misma tabla/bucket. | 🟠 Alta (PII) | Separar el **almacenamiento** por sensibilidad (multi-bucket §3); la fila puede convivir pero el binario va a bucket PII. |

### 1.3 `delivery_pods`
| Hallazgo | Severidad | Recomendación |
|---|---|---|
| `receiver_name` **duplica** `shipments.received_by_name` (0035). | 🟡 Media | **POD = fuente de verdad** del receptor; `shipments.received_by_name` queda como espejo de conveniencia (lo setea `generate_pod`) o se deja de usar. Documentar la canonicidad. |
| 1:1 con shipment (`unique(shipment_id)`) | 🟢 OK | Correcto. |
| `receiver_document` es **PII sensible** en texto plano. | 🟠 Alta (PII) | Acceso restringido (RLS + rol); evaluar cifrado a nivel columna si el marco legal lo exige; nunca en signed URL/log en claro. |

### 1.4 Normalización / escalabilidad / índices / retención
- **Normalización:** con las dos-FK (1.1), el modelo queda en 3FN sin polimorfismo. `delivery_pods` separada de
  `shipments` es correcta (artefacto con ciclo propio).
- **Escalabilidad:** el cuello no es la DB (filas chicas) sino **Storage** (binarios) — ver §3. Particionar
  `custody_evidence` por mes asegura barridos de retención y performance a años.
- **Índices necesarios (consolidado):**
  - `custody_events (packing_unit_id)`, `(shipment_id)`, `(occurred_at)`, `(stage)`, `(event_type)`.
  - `custody_evidence (event_id)`, `(kind)`, `(sha256)`, `(created_at)` (retención).
  - `delivery_pods (shipment_id)` unique, `(signed_at)`.
  - `packing_units (custody_token)` / `shipments (custody_token)` unique.
- **Retención histórica:** definir **ventana legal** (recomendado: **≥ 5 años** para prueba de entrega; confirmar
  con marco AR/MELI). Estrategia **tiered**: metadatos+hash (fila inmutable) se retienen el plazo completo;
  binarios pueden archivarse/comprimirse a almacenamiento frío tras N meses. PII con la **menor** retención legal.

---

## 2. Estrategia QR — A vs B vs C

| Opción | Seguridad | UX / velocidad | Trazabilidad | Impresión |
|---|---|---|---|---|
| **A** QR por `packing_unit` | Token opaco OK | 1 scan por bulto (lento en cargas grandes) | **Máxima** (por unidad — req. MELI) | En etiqueta `BLT-` (ya se imprime en Packing) |
| **B** QR por `shipment` | Token opaco OK | 1 scan por despacho (rápido) | Nivel despacho/entrega | En remito `DSP-` |
| **C** Doble QR | Token opaco OK | Flexible (granular + rápido) | **Completa** (unidad + despacho) | Ambos |

**ESTÁNDAR OFICIAL: Opción C (doble QR).** Justificación: MELI exige trazabilidad **por unidad** (→ QR por
`packing_unit`, capa granular en packing/carga), y la **entrega/POD** opera a nivel **despacho** (→ QR por
`shipment`, capa de entrega). Ambos codifican **token opaco** (no `public_id`), resuelto por RPC de lectura.
- **Rol de cada QR:** unidad = evidencia granular y antifraude por bulto; despacho = entrega, firma y POD.
- **Operativa:** el QR por unidad se imprime con la etiqueta del bulto al `close_packing_unit`; el de despacho
  en el remito al `confirm_dispatch`. Escaneo móvil abre la pantalla de captura contextual por etapa.

---

## 3. Storage — arquitectura recomendada

**Hallazgo (patrones existentes):** `0003_storage` creó buckets `signatures`/`pdfs` **PÚBLICOS** (lectura
abierta) y `attachments` privado; `0010_documents` estableció el patrón seguro: **bucket privado + signed URLs
vía función SECURITY DEFINER**. → Gate 5 debe seguir 0010, **NO** reusar el bucket público `signatures`.

| Decisión | Recomendación |
|---|---|
| Bucket único vs múltiples | **Múltiples buckets por sensibilidad** (separa PII para compliance): `custody-evidence` (fotos, no-PII), `custody-pii` (firmas + documentos del receptor — RLS estricta + retención mínima), `custody-pod` (PDFs generados — retención máxima). Todos **privados**. |
| Naming convention | `custody-{class}/{entidad}/{id}/{stage}/{uuid}.{ext}` (p.ej. `custody-pii/shipment/<id>/entrega/<uuid>.png`). |
| Acceso | **Signed URLs de TTL corto** emitidas por función SECURITY DEFINER (patrón 0010). Sin lectura pública. |
| Lifecycle / retención | Por bucket: `custody-pii` la **menor** retención legal; `custody-evidence` según SLA del cliente; `custody-pod` la **mayor** (prueba). Archivado frío del binario conservando la fila+hash. |
| Backup | **Storage NO está cubierto por el backup de la DB** (ni por PITR, que además está off). **Estrategia separada:** backup/replicación de Storage (export periódico o réplica externa). Riesgo crítico si se omite. |

**Volumen anual estimado (orden de magnitud, supuestos explícitos):**
- Supuesto: 200 bultos/día · 2 fotos/bulto (packing+carga) + 1 foto entrega/despacho + 1 firma/despacho.
- ~ (200×2) + (despachos≈60×2) ≈ **~520 archivos/día** · ~300 KB promedio ≈ **~155 MB/día** ≈ **~55 GB/año**.
- Con thumbnails y compresión, manejable; pero **crece lineal con la operación** → medir cuota Supabase Storage,
  definir compresión/resolución máxima y archivado. (Recalcular con volúmenes reales de TOPS.)

---

## 4. Evidencia fotográfica

- **Cantidad mínima / etapas obligatorias (perfil MELI):** **packing** (1 foto del bulto cerrado) y **entrega**
  (1 foto + firma) **obligatorias**; **carga** opcional/configurable. Mínimo **1 foto por etapa obligatoria**.
- **Metadata / hash / EXIF:** `captured_at` + `geo` (del evento, autoritativa) + `exif` (jsonb, complementario)
  + **`sha256` obligatorio**. No depender de EXIF para geo ni para integridad.
- **Obligatoria / opcional / configurable → CONFIGURABLE POR CLIENTE (D8).** Default **opcional**; perfil MELI
  = **obligatoria**. Se enforce en la RPC contra una **política por cliente/`business_unit`** (no hardcode).

---

## 5. Firma digital — canvas PNG vs SVG vs PDF embebido

| Opción | Complejidad | Pros | Contras |
|---|---|---|---|
| **Canvas → PNG** | Baja | Universal, simple, raster fiel del trazo | No vectorial (tamaño mayor) |
| SVG | Media | Vectorial, liviano | Trazo como paths; menos "evidencia fotográfica"; sin ventaja probatoria |
| PDF embebido | — | Es **rendering**, no formato de almacenamiento | No es alternativa de captura |

**DECISIÓN (D3): Canvas → PNG**, almacenado como `custody_evidence` (kind=`firma`) en bucket **`custody-pii`**,
**y embebido** en el POD-PDF al generarlo. SVG se descarta (complejidad sin beneficio probatorio).
- **Implicancia legal:** es **firma electrónica simple** (trazo + nombre + documento + timestamp + geo + hash) —
  **prueba de recepción** válida en la operación, **no** firma electrónica *avanzada/cualificada* (no usa
  certificado). Si en el futuro se requiere validez legal reforzada, integrar **proveedor de e-sign certificado**
  (fuera de alcance Gate 5). Documentar este límite en el POD.

---

## 6. POD — arquitectura recomendada

| Aspecto | Decisión |
|---|---|
| Formato canónico | **PDF generado server-side** (route/Edge Function) → bucket `custody-pod`. Es portable, archivable y presentable ante terceros. |
| HTML | **Vista derivada** para pantalla (no es el artefacto probatorio). |
| Contenido | Remito (`DSP-`) + receptor (nombre/documento) + observaciones + **fotos** (thumbnails/links) + **firma** embebida + **timeline** + **hash del POD**. |
| Almacenamiento | `delivery_pods.pod_storage_path` (PDF) + referencias a `custody_evidence`. |
| Firma | Embebida (PNG) + referencia `signature_evidence_id`. |
| Adjuntos | Las `custody_evidence` del despacho/unidades, enlazadas. |
| Generación (D11) | **Server-side** (route/Edge Function), **no** RPC de DB. `generate_pod` (RPC) crea la fila; el job renderiza el PDF y actualiza `pod_storage_path`. |

---

## 7. Geolocalización

- **DECISIÓN (D6): CONFIGURABLE, default OPCIONAL.** Obligatoria solo donde el cliente (MELI) lo exija **y con
  política de consentimiento del trabajador** (privacidad laboral).
- **Fuente:** GPS del dispositivo al capturar (primario) → fallback a **posición del vehículo (Traccar)** con
  campo de **precisión/origen**. Persistir lat/lng + `geom` generado (PostGIS `extensions`, SRID 4326, patrón 0016).
- **Riesgos:** privacidad (datos de ubicación del personal → base legal + consentimiento); cobertura
  (rural/indoor → geo ausente, marcar como tal); precisión (variabilidad GPS → guardar accuracy si está disponible).

---

## 8. Seguridad e Integridad

### 8.1 Seguridad (PII / firmas / documentos / fotos)
- **Clasificación:** firma + nombre + documento del receptor = **PII**; fotos pueden contener personas/patentes.
- **Estrategia de acceso:** buckets **privados** + **signed URLs de TTL corto** vía función SECURITY DEFINER
  (patrón 0010); RLS en tablas (lectura solo roles WMS); bucket `custody-pii` con **gating de rol más estricto**.
- **Estrategia de auditoría:** **auditar la LECTURA de PII** — cada emisión de signed URL sobre `custody-pii`
  registra en `audit_log` (`custody.access`) quién/cuándo/qué. (El diseño solo auditaba escrituras → **gap cerrado**.)
- **Estrategia de retención / erasure:** ventanas por bucket (§3). **Derecho de supresión (PII)** en tensión con
  la inmutabilidad → **resolver redactando el binario** (borrado del archivo) y **conservando la fila inmutable
  marcada `redacted`** (con su hash original) → la cadena de custodia no se rompe, el dato personal se elimina.

### 8.2 Integridad — ¿suficiente para auditorías externas?
- El diseño propone **append-only + trigger + hash por archivo** → **suficiente para auditoría interna/operativa**,
  pero **insuficiente para auditoría legal-grade externa**: un hash por fila no impide reescribir una secuencia si
  se compromete la DB; falta **encadenamiento** y **anclaje temporal**.
- **RECOMENDACIÓN OBLIGATORIA (D5 reforzada):**
  1. **Hash-chain:** `custody_events.row_hash = SHA256(prev_hash || campos_del_evento || sha256_evidencia)`. Cada
     evento encadena al anterior → cualquier alteración rompe la cadena.
  2. **Anclaje externo (opcional, recomendado para MELI/legal):** exportar un **Merkle root diario** a un destino
     externo (timestamping authority / almacenamiento inmutable) → prueba de no-manipulación verificable por terceros.
- Con (1) el modelo es **apto para auditoría externa**; con (1)+(2) es **legal-grade**.

---

## 9. Decisiones obligatorias — RESOLUCIÓN FINAL (D1–D11, ninguna abierta)

| # | Decisión | **Resolución final** |
|---|---|---|
| **D1** | Payload del QR | **Token opaco** (`custody_token` uuid aleatorio). No `public_id`. |
| **D2** | Almacenamiento | **Supabase Storage, MÚLTIPLES buckets privados por sensibilidad** (`custody-evidence` / `custody-pii` / `custody-pod`) + signed URLs SECURITY DEFINER (patrón 0010). **Prohibido** reusar el bucket público `signatures` (0003). |
| **D3** | Firma | **Canvas → PNG** en `custody-pii` + embebida en POD-PDF. SVG descartado. Es firma electrónica **simple** (límite legal documentado). |
| **D4** | Formato POD | **PDF canónico** (server-side) + **HTML** como vista derivada. |
| **D5** | Inmutabilidad | **Append-only + trigger + `sha256` por archivo + HASH-CHAIN (`prev_hash`/`row_hash`)**; anclaje Merkle diario opcional para legal-grade. |
| **D6** | Geolocalización | **Configurable, default opcional** + consentimiento; device-first + fallback Traccar; PostGIS `geom` (0016) + accuracy/origen. |
| **D7** | Granularidad QR | **Doble QR (Opción C) = estándar oficial** (unidad granular MELI + despacho entrega/POD). |
| **D8** | Obligatoriedad de evidencia | **Configurable por cliente/`business_unit`**; default opcional; perfil MELI obligatorio; enforce en RPC vía política. |
| **D9** | POD en la entrega | **Desacoplado en DB** (no se modifica `confirm_delivery` de 0035). POD = paso additive **posterior**. Para clientes MELI, la **obligatoriedad POD-antes-de-completar** se enforce a **nivel app/política por cliente**, no acoplando 4C. |
| **D10** | Foto de recepción (antes/después) | **Fuera del core de Gate 5**; extensión additive **futura de Gate 1** (opcional). |
| **D11** | Generación del PDF de POD | **Server-side** (route/Edge Function), **no** RPC de DB. |

**Cambios al modelo de datos respecto del diseño (obligatorios):** (a) reemplazar `scope/scope_id` por
`packing_unit_id`/`shipment_id` + CHECK; (b) `event_type` con vocabulario controlado; (c) `geom` PostGIS;
(d) `prev_hash`/`row_hash`; (e) multi-bucket; (f) `custody_evidence` particionada por mes; (g) campo `redacted`
para erasure de PII.

---

## 10. Matriz de riesgos (Impacto · Probabilidad · Mitigación)

| Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|
| **Storage NO cubierto por backup** (PITR off + backup de DB no incluye binarios) | 🔴 Alto | Alta | Estrategia de backup/replicación de Storage **separada** y obligatoria antes de operar Gate 5. |
| **PII expuesta** (firma/documento del receptor) | 🔴 Alto | Media | Bucket `custody-pii` privado, RLS estricta, signed URLs cortas, **auditoría de lectura**, retención mínima, erasure por redacción. |
| **Integridad insuficiente para auditoría externa** (solo hash por fila) | 🔴 Alto | Media | **Hash-chain** (`prev_hash`) + anclaje Merkle diario opcional. |
| **Volumen/costo de Storage creciente** | 🟠 Medio | Alta | Compresión/resolución máx., thumbnails, archivado frío, medición de cuota, retención tiered. |
| **Polimorfismo sin FK → datos huérfanos** | 🟠 Medio | Media | Dos FK nullable + CHECK de exclusividad. |
| **Captura offline en tránsito** (sin señal) | 🟠 Medio | Media | Cola local + sync diferido; `occurred_at`/`captured_at` del momento real, no del upload. |
| **Geo: privacidad laboral / cobertura / precisión** | 🟠 Medio | Media | Configurable + consentimiento; fallback Traccar; marcar accuracy/ausencia. |
| **DEV/PROD misma DB** (altas inmutables de custodia en prod) | 🟠 Medio | Alta | Additive (no toca stock/ledger); backup manual previo a `0036`; kits 0-footprint. |
| **`event_type` libre → inconsistencia** | 🟡 Bajo | Media | Vocabulario controlado (enum/CHECK). |
| **Firma sin validez legal cualificada** (si se requiere a futuro) | 🟡 Bajo | Baja | Documentar límite; integrar e-sign certificado si el marco lo exige (fuera de alcance). |
| **QR adivinable** | 🟡 Bajo | Baja | Token opaco aleatorio + resolución validada por RPC. |
| **Tensión erasure (PII) vs inmutabilidad** | 🟡 Bajo | Media | Redacción del binario + fila inmutable `redacted` con hash original. |

---

## 11. Recomendaciones y arquitectura recomendada (síntesis)

1. **Modelo:** `custody_events` (con `packing_unit_id`/`shipment_id`+CHECK, `event_type` controlado, `geom`
   PostGIS, `prev_hash`/`row_hash`), `custody_evidence` (particionada mensual, `sha256` not null, `redacted`),
   `delivery_pods` (POD canónico del receptor). 3 enums + 2 columnas `custody_token`.
2. **QR:** doble (unidad + despacho), token opaco, impreso en etiqueta de bulto y en remito.
3. **Storage:** 3 buckets privados por sensibilidad + signed URLs SECURITY DEFINER (patrón 0010) + **backup de
   Storage separado**.
4. **Evidencia:** mínimo 1 foto por etapa obligatoria (packing, entrega), configurable por cliente (MELI obligatorio).
5. **Firma:** canvas PNG (PII bucket) embebida en POD; firma electrónica simple (límite documentado).
6. **POD:** PDF server-side canónico + HTML derivado.
7. **Geo:** configurable/opcional + consentimiento, PostGIS, fallback Traccar.
8. **Seguridad/Integridad:** PII separada, auditoría de **lectura**, hash-chain (+ anclaje opcional), erasure por redacción.

**Plan futuro (sin cambios de fase respecto del diseño, con los 7 cambios incorporados):** `0036` custody core
(con dos-FK + hash-chain) → Storage multi-bucket → `0037` RPC (incl. auditoría de lectura + política de
obligatoriedad) → TS → UI captura/QR/timeline → POD-PDF server-side → validación (kit 0-footprint:
inmutabilidad, hash-chain, tamper, erasure, token, POD). **No iniciar aún.**

---

## 12. Conclusión

**Gate 5 APROBADO CON CAMBIOS OBLIGATORIOS** (los 7 del §0). Con ellos, el modelo es **apto para auditorías
externas** y cumple los no-negociables del proyecto (auditoría, inmutabilidad) más las exigencias de
**compliance/PII** propias de capturar datos del receptor. Las 11 decisiones quedan **resueltas y cerradas**.

> **FIN — Revisión arquitectónica de Gate 5. Entregable único.**
> Sin código, sin migraciones, sin SQL/TS/UI, sin git, sin Supabase. **NO iniciar Gate 5. NO iniciar Gate 6.** Detenido.

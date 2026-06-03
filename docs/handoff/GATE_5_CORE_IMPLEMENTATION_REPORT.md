# GATE 5 — Custody Core (`0036`) · REPORTE DE IMPLEMENTACIÓN

> Estado: **implementado (código). Migración `0036` PENDIENTE de aplicar a Supabase** (la aplica Martín en el
> SQL Editor). Alcance: **solo `0036` Custody Core** — NO `0037`/`0038`/`0039`. Sin Storage/RPC/PDF/UI/signed URLs.
> Sin push. Fecha: 2026-06-03. Roles: Principal Architect + Staff Engineer + Security + Compliance.
> Implementa exactamente `GATE_5_IMPLEMENTATION_PLAN.md` §3 (modelo) + integridad/seguridad aprobadas.

---

## 1. Resumen

`0036_custody_core.sql` crea el **núcleo de datos** de la Cadena de Custodia: 3 enums, 3 tablas
(`custody_events`, `custody_evidence`, `delivery_pods`), integridad (doble FK + CHECK de exclusividad +
**hash-chain** + **append-only**), tokens QR (modelo) y **PostGIS** (`geom` generado). Es **additive** sobre
Gates 1–4C (no toca stock/ledger/flujos). **No** incluye Storage, RPC, signed URLs, PDF ni UI (fases 0037–0039
y capas app).

---

## 2. Migración `0036_custody_core.sql`

| Objeto | Detalle |
|---|---|
| Enums | `custody_stage_t` (req. por la tabla), `custody_event_type_t`, `evidence_kind_t` |
| Tabla `custody_events` | append-only + **hash-chain**; doble FK `packing_unit_id`/`shipment_id` + CHECK exclusividad; CHECK `stage`/`event_type`; `geom` PostGIS generado; `prev_hash`/`row_hash`; `public_id 'CUST-'` |
| Tabla `custody_evidence` | `sha256 not null`; multi-bucket CHECK; `unique(storage_bucket, storage_path)`; append-only **salvo flip de redacción** (`redacted`) |
| Tabla `delivery_pods` | 1 por shipment (`unique(shipment_id)`); receptor canónico; `public_id 'POD-'` |
| Columnas QR | `packing_units.custody_token` + `shipments.custody_token` (uuid unique default; modelo, sin imagen QR) |
| Triggers | `public_id` (CUST-/POD-); **hash-chain** (BEFORE INSERT); **inmutabilidad** (UPDATE/DELETE/TRUNCATE) en events y evidence |
| RLS | lectura `authenticated`; **sin policies de escritura** (lockdown; escritura solo vía RPC de 0038/0039) |

### 2.1 Integridad — hash-chain
- `row_hash = SHA256(prev_hash ‖ campos_canónicos ‖ evidence_sha256)`, computado por **trigger BEFORE INSERT**.
- Usa el **`sha256()` BUILT-IN de PostgreSQL** (pg_catalog) → **sin dependencia de pgcrypto ni de schema**
  (evita la ambigüedad `extensions.digest` vs `public.digest`).
- Serialización por entidad con **`pg_advisory_xact_lock`** → sin fork de cadena bajo concurrencia.
- `prev_hash` = `row_hash` del último evento de la **misma** entidad (orden por `chain_seq`).

### 2.2 Append-only (patrón ledger 0026)
- `custody_events`: bloquea **UPDATE/DELETE/TRUNCATE** para todos los roles (incluido owner).
- `custody_evidence`: bloquea DELETE/TRUNCATE; **UPDATE solo permite el flip `redacted=false→true`** (+ `redacted_at`)
  con el resto de columnas inmutable → habilita la erasure de PII de 0038 **sin** romper la cadena ni el hash.

### 2.3 PostGIS (patrón Tracking 0016)
- `geo_lat`/`geo_lng double precision` + `geom extensions.geometry(Point,4326) generated always as
  (extensions.ST_SetSRID(extensions.ST_MakePoint(geo_lng, geo_lat), 4326)) stored` + índice **GIST**.

---

## 3. Decisiones de implementación (notas honestas)

1. **`custody_stage_t` incluido:** la autorización listó explícitamente `custody_event_type_t` + `evidence_kind_t`,
   pero `custody_events.stage` **requiere** `custody_stage_t` (diseño aprobado §4.1). Se incluyó por necesidad.
2. **`sha256()` built-in en vez de `digest()` de pgcrypto:** decisión de robustez — evita depender del schema
   donde viva pgcrypto. Mismo resultado (SHA-256 hex).
3. **`custody_evidence` NO particionada (desviación documentada vs plan §3.3):** el plan proponía particionado
   mensual; se implementó como **tabla normal (PK `id`)** para preservar **FK limpias**
   (`delivery_pods.signature_evidence_id → custody_evidence(id)`). El particionado declarativo forzaría
   `created_at` en PK/unique/FK y rompería esa FK por `id` solo. A ~190K filas/año es innecesario; el
   particionado queda como **optimización operativa diferible** (migración futura dedicada cuando el volumen lo exija).
   Índice `(created_at)` ya presente para barridos de retención. **Decisión a ratificar.**
4. **`custody_token` en ambas tablas** (no `shipment_token`): el diseño §4.2 nombra la columna `custody_token`
   en `packing_units` **y** en `shipments`. Se respetó ese nombre en ambas (la "shipment_token" del pedido es la
   `shipments.custody_token`).
5. **`evidence_sha256` en `custody_events`:** columna nullable que pliega el hash de la evidencia primaria en la
   cadena (la fórmula del diseño incluye `‖ sha256_evidencia`). La poblará `attach_custody_evidence` (0038).

---

## 4. Validación

> ⚠️ **`0036` no fue aplicada** (la aplica Martín) → el kit aún no se corrió.

- **Kit `gate5_core_validation_report.sql` (10 casos, 0 footprint):**
  C1 alta evento (CUST- · row_hash) · C2 hash-chain enlaza · C3 doble FK CHECK (exclusividad) · C4 inmutabilidad
  evento · C5 CHECK stage/event_type · C6 evidence (sha256 obligatorio · redacción flip · UPDATE/DELETE) ·
  C7 POD (POD- · unique shipment) · C8 custody_token autogenerado · C9 PostGIS geom · C10 hash-chain
  determinístico (recompute coincide).
- **Mecánica:** el SQL Editor corre como owner → bypassa el lockdown RLS para armar el fixture e insertar
  eventos; los **triggers de integridad/inmutabilidad SÍ aplican a todos**. Todo bajo `BEGIN/ROLLBACK` + sentinel.
- **Esperado:** todas las filas `OK`.
- **A confirmar al aplicar (no verificable sin la base):** que `extensions.ST_*`/`extensions.geometry` resuelvan
  (PostGIS en `extensions`, patrón 0016) y que `sha256()`/`convert_to()`/`encode()` (built-ins) estén disponibles
  (PG11+; Supabase PG15+). Si algún caso da `FALLO`, pasar el `SELECT` final para ajustar.

---

## 5. Alcance NO incluido (fases siguientes — NO implementadas)

- **`0037` Storage + Read-Audit:** buckets `custody-evidence`/`custody-pii`/`custody-pod` + signed URLs.
- **`0038` Evidence + Chain RPC:** `attach_custody_evidence`/`register_custody_event`/`redact_custody_evidence`/`verify_custody_chain`.
- **`0039` POD + Reads:** `generate_pod`/`get_custody_by_token`/`get_custody_timeline`.
- **Capas app:** TS (`src/lib/custody/*`), UI (captura/timeline/POD/QR), POD-PDF server-side.

---

## 6. Checklist de cierre

| # | Paso | Estado |
|---|---|---|
| 1 | Migración `0036` completa | ✅ `supabase/migrations/0036_custody_core.sql` |
| 2 | Validación SQL | ✅ kit generado · ⏳ correr tras aplicar `0036` |
| 3 | Reporte de implementación | ✅ este documento |
| 4 | Diff generado | ✅ (en la respuesta) |
| 5 | Commit local | ✅ (sin push) |

---

## 7. Próximos pasos (requieren acción de Martín / OK)

1. **Backup manual** de Supabase (PITR off) + (recomendado) definir backup de Storage antes de `0037`.
2. Aplicar `0036_custody_core.sql` en el SQL Editor.
3. Correr `gate5_core_validation_report.sql` → esperar todo `OK`.
4. **Con OK explícito:** continuar con `0037` (Storage). **NO iniciado.**

---

> **FIN — Gate 5 Custody Core (`0036`) implementado (código). Migración pendiente de aplicar. Sin push.**
> **NO iniciado: `0037` Storage · `0038` Evidence · `0039` POD.** Esperar aprobación explícita. Detenido.

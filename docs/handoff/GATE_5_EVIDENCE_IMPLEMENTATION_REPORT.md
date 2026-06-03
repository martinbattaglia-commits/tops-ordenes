# GATE 5.2 — Custody Evidence Layer (`0038`) · REPORTE DE IMPLEMENTACIÓN

> Estado: **implementado (código). Migración `0038` PENDIENTE de aplicar a Supabase** (la aplica Martín).
> Alcance: **solo `0038` Evidence Layer** (4 RPC) — NO POD/Timeline/`0039`/PDF/TS/React/Server Actions/
> captura-cámara/upload-frontend/escaneo-QR. **NO reabre `0036`/`0037`.** Sin push. Fecha: 2026-06-03.
> Roles: Principal Architect + Security + Compliance + Staff Engineer.

---

## 1. Resumen

`0038_custody_evidence.sql` agrega las **4 RPC** de captura/verificación/erasure de la Cadena de Custodia,
sobre `0036` (Core) + `0037` (Storage). Todas `SECURITY DEFINER`; **las mutaciones van exclusivamente por
RPC** (RLS lockdown de 0036). Una única columna aditiva (`redacted_by`) que **no reabre** 0036.

---

## 2. RPC implementadas

| RPC | Responsabilidad | Audit |
|---|---|---|
| `attach_custody_evidence(...)` → jsonb | Crea **evento (con `evidence_sha256`) + evidencia** (atómico) | `custody.attach` |
| `register_custody_event(...)` → uuid | Crea evento **sin archivo** (cargado/en_transito/etc.) | `custody.event` |
| `verify_custody_chain(pu, sh)` → jsonb | Recorre la cadena, recomputa prev/row_hash, reporta continuidad | `custody.chain_verify` |
| `redact_custody_evidence(id, reason)` | Erasure de PII: `redacted=true`+`redacted_at`+`redacted_by` (NO borra fila) | `custody.redact` |

### 2.1 `attach_custody_evidence`
- **Decisión clave (diseño 0036):** la hash-chain **pliega `evidence_sha256`** (columna del evento, computada
  en el INSERT por el trigger). Para que la cadena **ligue el archivo**, el evento debe insertarse con
  `evidence_sha256 = sha256` del archivo → por eso `attach` crea **evento + evidencia juntos** (atómico).
  Devuelve `{event_id, event_public_id, evidence_id}`.
- **Validaciones (mapeo de lo autorizado):** FK válidas (`packing_unit_id` **XOR** `shipment_id`, ambos
  verificados existentes) · `stage`/`event_type` permitido y consistente · **bucket válido** (3 buckets) ·
  **sha256 presente** · **(bucket,path) no tomado** → si pertenece a una evidencia **REDACTADA** rechaza
  ("evidencia NO redactada") y si existe rechaza por duplicado · "evidence_id existente" se satisface al
  devolver el `evidence_id` creado.
- Setea **retención** (modelo de 0037): `retention_class` por bucket + `retention_until` (deadlines
  **TENTATIVOS**: pii 1a · evidence 2a · pod 10a → **confirmar marco legal**).

### 2.2 `register_custody_event`
- Evento **sin archivo**. Valida XOR (FK existentes) + `event_type`/`stage` permitido. La **hash-chain
  intacta** la garantiza el trigger de 0036 al insertar. Devuelve `event_id`.

### 2.3 `verify_custody_chain`
- Recorre los eventos de la entidad por `chain_seq`, **recomputa** `row_hash` con la **fórmula canónica
  idéntica** a `custody_event_hashchain` (0036, `sha256()` built-in), y valida **continuidad** (`prev_hash`
  encadena) + **integridad** (`row_hash` coincide). Devuelve `{valid, events_checked, first_error}` y audita.

### 2.4 `redact_custody_evidence`
- **NO borra la fila.** Gating **estricto** (admin/supervisor). Setea `redacted/redacted_at/redacted_by`.
  **Preserva** `sha256`, la auditoría y la cadena (el flip lo permite el trigger de 0036; `redacted_by` no
  está en su lista de columnas inmutables). El **borrado físico del binario** en Storage es **APP-SIDE**
  (admin · Supabase SDK), fuera del alcance de la RPC.

---

## 3. Columna aditiva (no reabre 0036)

`custody_evidence.redacted_by uuid references auth.users(id) on delete set null` — provenance del erasure.
El trigger de inmutabilidad de 0036 **permite** el flip de redacción y **no lista** `redacted_by` entre sus
columnas inmutables → el UPDATE de redacción puede setearla sin violar el append-only.

---

## 4. Seguridad

- **Todas `SECURITY DEFINER`** · `set search_path = public` · authz `current_role()`.
- attach/register/verify: `admin/operaciones/supervisor`. **redact: `admin/supervisor`** (erasure de PII).
- `revoke all from public, anon` + `grant execute to authenticated, service_role`.
- Escritura de custody **solo** vía estas RPC (RLS lockdown 0036). **Sin SQL directo desde UI.**

---

## 5. Validación

> ⚠️ **`0038` no fue aplicada** (la aplica Martín) → el kit aún no se corrió.

`gate5_evidence_validation_report.sql` (**10 casos, 0 footprint**):
C1 register (CUST-+audit) · C2 register XOR · C3 attach (evento+evidencia, `evidence_sha256` ligado,
retención, audit) · C4 attach validaciones (bucket/sha256) · C5 attach path duplicado/redactado ·
C6 verify cadena válida (3 eventos) · C7 verify XOR + entidad vacía · C8 redact (flip + `redacted_by` +
sha256 preservado + audit + doble-redact rechazado; **adaptativo**: rol operaciones → redact rechazado) ·
C9 redact preserva la cadena (verify sigue válido) · C10 authz (register/attach sin rol rechazados).

- Fixtures directos (owner bypassa RLS); triggers de 0036 + RPC aplican. Todo bajo `BEGIN/ROLLBACK`.
- **A confirmar al aplicar:** que el recompute de `verify` coincida con el `row_hash` del trigger (mismo
  resultado que el Caso 10 del kit de Core); el rol del usuario de prueba determina C8.

---

## 6. Alcance NO incluido (fase `0039` + app)

- **`0039` POD + Reads:** `generate_pod`, `get_custody_by_token`, `get_custody_timeline`.
- **App:** TS, UI/React, Server Actions, POD-PDF, captura de fotos/firma, upload frontend, escaneo QR.

---

## 7. Checklist de cierre

| # | Paso | Estado |
|---|---|---|
| 1 | Migración `0038` | ✅ `supabase/migrations/0038_custody_evidence.sql` |
| 2 | Kit SQL de validación | ✅ `gate5_evidence_validation_report.sql` · ⏳ correr tras aplicar |
| 3 | Reporte de implementación | ✅ este documento |
| 4 | Commit local | ✅ (sin push) |

---

## 8. Próximos pasos (acción de Martín / OK)

1. Backup manual de Supabase (PITR off). Aplicar `0038_custody_evidence.sql`.
2. Correr `gate5_evidence_validation_report.sql` → esperar **todo OK**.
3. **Con OK explícito:** continuar con `0039` (POD + Reads). **NO iniciado.**

---

> **FIN — Gate 5.2 Custody Evidence (`0038`) implementado (código). Migración pendiente de aplicar. Sin push.**
> **NO iniciado: `0039` POD/Reads · Gate 6.** Esperar aprobación explícita. Detenido.

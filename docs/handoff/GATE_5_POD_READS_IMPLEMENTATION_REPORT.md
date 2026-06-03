# GATE 5.3 — Custody POD + Reads (`0039`) · REPORTE DE IMPLEMENTACIÓN

> Estado: **implementado (código). Migración `0039` PENDIENTE de aplicar a Supabase** (la aplica Martín).
> Alcance: **solo `0039` POD + Reads** (4 RPC) — NO React/TS/Server Actions/QR-frontend/cámara/firma-UI/
> PDF-server/etiquetas (capa de aplicación posterior). **NO reabre `0036`/`0037`/`0038`.** Sin push. 2026-06-03.
> Con `0039`, la familia SQL de Gate 5 (`0036`–`0039`) queda **completa a nivel código** (pendiente de aplicar/validar).

---

## 1. Resumen

`0039_custody_pod_reads.sql` agrega la **generación del POD** y las **lecturas** (timeline, resolución de QR,
resumen ejecutivo). Cierra el back-end de la Cadena de Custodia. Todas las RPC `SECURITY DEFINER`; solo
`generate_delivery_pod` muta. Additive sobre `0036`–`0038`.

---

## 2. RPC implementadas

| RPC | Tipo | Responsabilidad | Audit |
|---|---|---|---|
| `generate_delivery_pod(...)` → jsonb | **Mutación** | Crea `delivery_pods` (1 por shipment) | `custody.pod_generate` |
| `get_custody_timeline(pu, sh)` → jsonb | Lectura | Eventos + evidencias + POD, orden cronológico asc | — |
| `get_custody_by_token(token)` → jsonb | Lectura | Resuelve QR (packing_unit o shipment). **SIN PII** | `custody.token_resolve` |
| `get_shipment_custody_summary(sh)` → jsonb | Lectura | Resumen ejecutivo del shipment | (via verify: `custody.chain_verify`) |

### 2.1 `generate_delivery_pod`
- **Valida:** shipment existente · estado **despachado/entregado** · **POD inexistente** para el shipment ·
  `receiver_name` obligatorio · **firma válida cuando corresponde** (si se pasa `signature_evidence_id`:
  `kind='firma'`, no redactada, y perteneciente al **mismo shipment**).
- **Genera** `delivery_pods` (`public_id 'POD-'`, `signed_at`, `created_by`) + `audit_log` `custody.pod_generate`.
- **Decisión:** crea **solo** `delivery_pods` + audit (lo autorizado). **NO** inserta un `custody_event 'pod'`
  (no extiende la hash-chain) — el POD se **deriva en el timeline** desde `delivery_pods`. La cadena de eventos
  queda gobernada solo por `0036`/`0038`.

### 2.2 `get_custody_timeline`
- XOR (uno de pu/sh). Para **shipment** incluye sus eventos **+ los de sus `packing_units`** (vista unificada,
  vía `packing_units.shipment_id`). Cada nodo evento trae sus **evidencias** (metadatos: `evidence_id/kind/
  bucket/sha256/redacted`). El **POD** se agrega como nodo (derivado de `delivery_pods`). Orden por fecha asc.
- **Solo metadatos:** el binario se accede por `emit_custody_signed_url` (0037, auditado), no por el timeline.

### 2.3 `get_custody_by_token`
- Resuelve el `custody_token` de **packing_unit** o **shipment** (token opaco de 0036). Devuelve **scope,
  `public_id` (BLT-/DSP-), status, pod_present, eventos resumidos** (stage/event_type/fecha).
- **NO expone PII:** sin `receiver_name`/`receiver_document`, sin paths de binarios. Audita `custody.token_resolve`
  **sin registrar el token en claro**.

### 2.4 `get_shipment_custody_summary`
- Devuelve: **shipment**, **cantidad de eventos**, **cantidad de evidencias**, **POD presente/no**,
  **cadena válida/inválida** (reusa `verify_custody_chain` de 0038), **última actividad** (máx. evento o firma POD).

---

## 3. Seguridad

- **Todas `SECURITY DEFINER`** · authz `current_role() in (admin,operaciones,supervisor)` · `set search_path=public`.
- **Solo lectura salvo `generate_delivery_pod`.** Auditoría donde corresponde: `custody.pod_generate`,
  `custody.token_resolve`, y `custody.chain_verify` (vía el summary). Timeline (metadatos internos) no audita.
- `revoke all from public, anon` + `grant execute to authenticated, service_role`.

---

## 4. Validación

> ⚠️ **`0039` no fue aplicada** (la aplica Martín) → el kit aún no se corrió.

`gate5_pod_reads_validation_report.sql` (**12 casos, 0 footprint**):
1 POD generado · 2 POD duplicado/estado inválido rechazado · 3 timeline correcto (2 eventos + POD) ·
4 timeline vacío · 5 token packing (BLT-) · 6 token shipment (DSP-, pod_present) · 7 resumen shipment ·
8 **PII no expuesta** (by_token sin nombre/documento) · 9 seguridad de lectura (sin rol rechazado) ·
10 auditoría (pod_generate + token_resolve) · 11 integridad timeline (chain_valid=true) · 12 **rollback limpio**.

---

## 5. Estado de Gate 5 (familia SQL completa a nivel código)

| Migración | Capa | Estado |
|---|---|---|
| `0036` | Custody Core | ✅ validado/cerrado |
| `0037` | Storage Layer | ✅ validado/cerrado |
| `0038` | Evidence Layer | ✅ implementado (pendiente aplicar/validar) |
| `0039` | POD + Reads | ✅ **implementado (este)** (pendiente aplicar/validar) |

**Pendiente de Gate 5 (NO en esta tanda):** capa de aplicación — TS (`src/lib/custody/*`), UI/React
(captura, timeline, POD, QR, etiquetas), Server Actions, POD-PDF server-side. **Bloqueante operativo:**
estrategia de **backup de Storage** (no cubierto por DB/PITR) antes de captura real.

---

## 6. Checklist de cierre

| # | Paso | Estado |
|---|---|---|
| 1 | Migración `0039` | ✅ `supabase/migrations/0039_custody_pod_reads.sql` |
| 2 | Kit SQL de validación | ✅ `gate5_pod_reads_validation_report.sql` · ⏳ correr tras aplicar |
| 3 | Reporte de implementación | ✅ este documento |
| 4 | Commit local | ✅ (sin push) |

---

## 7. Próximos pasos (acción de Martín / OK)

1. Backup manual de Supabase (PITR off). Aplicar `0038` (si no está) y `0039`.
2. Correr `gate5_evidence_validation_report.sql` (0038) y `gate5_pod_reads_validation_report.sql` (0039) → todo OK.
3. **Con OK explícito:** capa de aplicación de Custody (TS/UI) o Gate 6. **NO iniciado.**

---

> **FIN — Gate 5.3 Custody POD + Reads (`0039`) implementado (código). Migración pendiente de aplicar. Sin push.**
> **NO iniciado: TS/UI Custody · Gate 6.** Esperar aprobación explícita. Detenido.

# GATE 5 — CADENA DE CUSTODIA · REPORTE FINAL DE CIERRE

> **STATUS: ✅ VALIDATED + CLOSED**
> Fecha: 2026-06-03 · Rol: Principal Architect · Repo `~/CODE/tops-ordenes` · Branch `main`.
> Modo: cierre formal (sin nuevas funcionalidades, sin migraciones, sin deploy, sin Gate 6).
> Reemplaza el veredicto provisional de `GATE_5_CLOSURE_REPORT.md` (que declaró NOT CLOSED por bloqueantes
> hoy resueltos). Documento canónico de cierre de Gate 5.

---

## 1. Resumen ejecutivo

Gate 5 dota a TOPS Nexus de **trazabilidad probatoria de extremo a extremo** (quién / cuándo / dónde +
evidencia) de cada `packing_unit` y cada `shipment`, con **QR opaco**, **evidencia fotográfica**, **firma del
receptor**, **POD** (con PDF server-side) y una **línea de tiempo inmutable y encadenada** (hash-chain), apta
para **auditoría externa** y compliance de **PII** (requerimiento Mercado Libre).

A la fecha de este reporte:

- **Back-end (DB `0036`–`0039`):** aplicado en **Supabase Production** y commiteado. 3 tablas custody +
  tokens QR + 3 buckets privados + 9 RPC + hash-chain + auditoría de lectura.
- **QA:** `0036`=**10/10** · `0037`=**9/9** · `0038`=**10/10** · `0039`=**12/12** — **0 FAIL · 0 SKIP**.
- **App Layer:** completa (TS, Server Actions, QR, Timeline, Dashboard, Shipment Integration, Evidence Viewer,
  POD Surface) + **POD-PDF server-side** (cierra el bloqueante B4).
- **Calidad:** `tsc --noEmit` = **0 errores** · `eslint` = **limpio**.

**Bloqueantes de cierre de ingeniería: 0.** Los únicos pendientes son **operativos/compliance** (B3 backup de
Storage, B6 política legal de retención), reubicados como *Operational / Compliance Follow-Up* (§7); no
bloquean el cierre técnico.

**Veredicto: GATE 5 = VALIDATED + CLOSED.**

---

## 2. Arquitectura final

```
Packing ──► Despacho ──► Transporte ──► Entrega ──► POD
 (foto)     (cargado)    (en_transito)  (foto+firma) (PDF server-side)
   │            │             │              │            │
   └────────────┴─────────────┴──────────────┴────────────┘
                 custody_events (append-only · hash-chain)
                 custody_evidence (Storage · sha256 · retención)
                 delivery_pods (1×shipment · pod_storage_path)
```

- **Datos:** `custody_events` (timeline append-only + hash-chain `prev_hash`/`row_hash`, doble FK nullable
  `packing_unit_id` XOR `shipment_id`, `geom` PostGIS, `public_id 'CUST-'`, inmutable por trigger);
  `custody_evidence` (archivos en Storage, `sha256 not null`, multi-bucket CHECK, `unique(bucket,path)`,
  `retention_class/until`, `redacted/_at/_by`); `delivery_pods` (POD 1×shipment, `public_id 'POD-'`, receptor
  canónico + `signature_evidence_id` + `pod_storage_path`).
- **QR:** columnas opacas `packing_units.custody_token` / `shipments.custody_token`; resolución pública
  autenticada en `/c/[token]` (sin PII).
- **Storage (3 buckets privados):** `custody-evidence` (fotos) · `custody-pii` (firmas/documentos, gating
  reforzado) · `custody-pod` (PDFs del POD). Acceso **solo** por signed URL TTL corto vía
  `emit_custody_signed_url` (auditado).
- **Seguridad:** RLS lockdown (lectura `authenticated`, escritura **solo** RPC `SECURITY DEFINER`); auditoría
  de escritura **y de lectura de PII** (`custody.access`) en `audit_log`.
- **Integridad:** `sha256` por archivo + hash-chain por entidad; `verify_custody_chain` recomputa y compara;
  erasure (`redact_custody_evidence`) borra binario y conserva fila + hash + posición en cadena.
- **App Layer:** Next.js App Router — `src/lib/custody/*` (wrappers RPC + QR + POD-PDF), Server Actions
  (`attach/register/generatePod/redact/signedUrl/regeneratePodPdf/podPdfSignedUrl`), UI (dashboard
  `/wms/custody`, resolver `/c/[token]`, `CustodyTimeline`, `EvidenceViewer`, POD Surface
  `/wms/custody/pod/[id]`, integración en `/wms/despachos/[id]`). Mutaciones = Server Actions +
  `revalidatePath()`; binarios solo por signed URL auditado.

---

## 3. Migraciones implementadas

| Migración | Contenido | Estado DB | Commit |
|---|---|---|---|
| `0036_custody_core.sql` | 3 enums; tablas `custody_events`/`custody_evidence`/`delivery_pods`; triggers `public_id` + inmutabilidad + hash-chain; columnas `custody_token`; RLS lockdown | ✅ aplicada (Production) | `7196b86` |
| `0037_custody_storage.sql` | 3 buckets privados + storage RLS; `emit_custody_signed_url` (auditada); modelo de retención (columnas) | ✅ aplicada (Production) | `468d893` |
| `0038_custody_evidence.sql` | `attach_custody_evidence`, `register_custody_event`, `verify_custody_chain`, `redact_custody_evidence` + política de obligatoriedad/retención | ✅ aplicada (Production) | `d301e8e` |
| `0039_custody_pod_reads.sql` | `generate_delivery_pod`, `get_custody_timeline`, `get_custody_by_token`, `get_shipment_custody_summary` | ✅ aplicada (Production) | `681d810` |

> **9 RPC totales:** `emit_custody_signed_url` (0037) + `attach`/`register`/`verify`/`redact` (0038) +
> `generate_delivery_pod`/`get_custody_timeline`/`get_custody_by_token`/`get_shipment_custody_summary` (0039).
> Numeración consecutiva `0036`–`0039` (gaps históricos `0012`/`0028` intencionales).

---

## 4. QA ejecutados

| Kit | Migración | Casos | Resultado |
|---|---|---|---|
| `gate5_core_validation_report.sql` | 0036 | 10 | **10/10 OK** |
| `gate5_storage_validation_report.sql` | 0037 | 9 | **9/9 OK** |
| `gate5_evidence_validation_report.sql` | 0038 | 10 | **10/10 OK** |
| `gate5_pod_reads_validation_report.sql` | 0039 | 12 | **12/12 OK** |
| **Total** | | **41** | **41/41 OK · 0 FAIL · 0 SKIP** |

**Cobertura clave:** alta de evento + evidencia con hash-chain encadenada; doble-FK XOR; inmutabilidad
(UPDATE/DELETE rechazados); tamper de hash-chain detectado; erasure preserva cadena; obligatoriedad/retención;
POD 1×shipment (duplicado rechazado, estado de shipment validado); resolución de token (BLT-/DSP-) **sin PII**;
timeline consolidado y ordenado; resumen ejecutivo (chain_valid); authz sin rol → rechazo; auditoría de
escritura y de lectura; **0 footprint** (todos los kits corren bajo `BEGIN/ROLLBACK` + sentinel).

> **Calidad de código:** `tsc --noEmit` = 0 errores · `eslint` = limpio (los únicos warnings son
> `jsx-a11y/alt-text` sobre `<Image>` de `@react-pdf/renderer`, idénticos al patrón ya existente en
> `PoPdfDocument`/`OrderPdfDocument`; 0 errores).

> **Nota de metodología:** las migraciones y los kits QA los aplica/ejecuta el owner (Martín) en el SQL Editor
> de Supabase — el asistente no ejecuta WRITES en producción. Los resultados QA (10/10·9/9·10/10·12/12)
> corresponden a esa ejecución, confirmada como contexto validado de este cierre.

---

## 5. Estado de App Layer

| Componente | Ubicación | Estado |
|---|---|---|
| TS Layer (tipos + wrappers RPC) | `src/lib/custody/{types,custody,qr}.ts` | ✅ |
| POD-PDF server-side | `src/lib/custody/{PodPdfDocument.tsx,pod-pdf.ts}` | ✅ (B4) |
| Server Actions | `src/app/(app)/wms/custody/actions.ts` | ✅ |
| Dashboard | `/wms/custody` | ✅ |
| QR Resolver (público autenticado) | `/c/[token]` | ✅ |
| Timeline | `CustodyTimeline` | ✅ |
| Evidence Viewer (signed URL auditado) | `EvidenceViewer` | ✅ |
| POD Surface + descarga PDF | `/wms/custody/pod/[id]` + `PodDownloadButton` | ✅ |
| Shipment Integration | `/wms/despachos/[id]` (`CustodyShipmentSection`) | ✅ |

**POD-PDF server-side (cierre B4):** reutiliza el patrón de Compras/Pedidos (`@react-pdf/renderer` +
`renderToBuffer` + upload a Storage). Flujo: `generate_delivery_pod` → render del PDF (shipment, receptor,
fecha, firma, timeline, resumen hash-chain, evidencias, QR) → **upload a `custody-pod`** → registro como
evidencia `documento` 'pod' (sha256 en la hash-chain + audit) → **actualización de
`delivery_pods.pod_storage_path`**. Descarga por `emit_custody_signed_url` (auditada). `window.print()` queda
solo como respaldo de impresión local. Detalle en `GATE_5_POD_PDF_IMPLEMENTATION_REPORT.md`.

**Commits App Layer:** `b55916e` (TS/Actions/QR/Timeline/Dashboard/POD surface) + `61e69e4` (POD-PDF
server-side).

---

## 6. Riesgos remanentes

| Riesgo | Severidad | Mitigación / estado |
|---|---|---|
| **DEV/PROD misma DB** (`arsksytgdnzukbmfgkju`) · PITR off | 🟠 Medio | Kits 0-footprint; backup manual previo; no impacta el cierre. |
| **Backup de Storage** no definido (B3) | 🟠 Operativo | Reubicado a *Operational / Compliance Follow-Up* (§7). El binario no es recuperable hasta definirlo. |
| **Retención legal** con deadlines tentativos (B6) | 🟡 Compliance | Reubicado a §7. Columnas y default presentes; falta confirmación legal. |
| Anclaje **Merkle** legal-grade no implementado | 🟡 Bajo | Opcional en el diseño; deuda residual para auditoría externa reforzada. |
| Particionado de `custody_evidence` diferido | 🟡 Bajo | Ratificar antes de alto volumen (decisión documentada en `0036`). |
| El POD-PDF agrega un evento `pod` a la hash-chain | 🟢 Info | Decisión deliberada/additive: ancla el `sha256` del PDF en la cadena (refuerza integridad). |

---

## 7. Pendientes operativos — Operational / Compliance Follow-Up

> Fuera del alcance de **ingeniería** de Gate 5. **No bloquean el cierre técnico.** Se resuelven en operación
> antes del uso productivo con evidencia real (MELI).

| # | Ítem | Tipo | Acción |
|---|---|---|---|
| **B3** | **Backup de Storage** de `custody-evidence`/`custody-pii`/`custody-pod` (no cubierto por backup de DB ni PITR) | Operativo | Definir y activar export/replicación periódica. Ver `SUPABASE_BACKUP_CHECKLIST.md`. |
| **B6** | **Política legal de retención** por bucket (hoy tentativa: pii 1a / evidence 2a / pod 10a) + base legal de PII/geo · (opcional) **Merkle** diario | Compliance | Confirmar marco legal con Dirección/Legales; ajustar deadlines si corresponde; evaluar Merkle. |

---

## 8. Veredicto final

> ## GATE 5 — CADENA DE CUSTODIA: ✅ **VALIDATED + CLOSED**
>
> Back-end (`0036`–`0039`) aplicado en Production y commiteado · QA **41/41 OK (0 FAIL/SKIP)** · App Layer
> completa + **POD-PDF server-side** · `tsc`=0 · `eslint` limpio. **0 bloqueantes de ingeniería.** Pendientes
> exclusivamente **operativos/compliance** (B3, B6) gestionados como follow-up.

**Próximo:** Gate 6 **NO iniciado** (fuera de alcance). Sin push, sin deploy.

---

> **FIN — Reporte final de cierre de Gate 5.** Documento canónico. Sin nuevas funcionalidades, sin migraciones,
> sin deploy, sin Gate 6.

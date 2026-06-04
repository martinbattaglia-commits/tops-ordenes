# GATE 5.3 — POD-PDF SERVER-SIDE · REPORTE DE IMPLEMENTACIÓN (cierra B4)

> Alcance EXCLUSIVO: el bloqueante **B4** de la auditoría (POD-PDF server-side).
> Repo `~/CODE/tops-ordenes` @ `b55916e` (+ cambios sin commitear). Fecha: 2026-06-03.
> **NO se tocó:** `0036`/`0037`/`0038`/`0039`, QR, Timeline, Custody Dashboard, Dispatch, Gates 1–4C.
> Sin migraciones nuevas. Sin push. Sin deploy. Sin Gate 6.

---

## 1. Hallazgo que se cierra

La auditoría verificó que la POD Surface usaba `window.print()` (PDF del navegador):
**no** generaba PDF server-side, **no** poblaba el bucket `custody-pod`, **no** completaba
`delivery_pods.pod_storage_path`. → **B4 abierto.**

Este cambio implementa la generación **server-side** reutilizando **exclusivamente** el patrón
de PDF ya existente en el proyecto (`@react-pdf/renderer` + `renderToBuffer` + upload a Storage),
idéntico al de **Compras (OC)**, **Pedidos** y **Facturas**. No se inventó arquitectura nueva.

---

## 2. Archivos

### Creados
| Archivo | Rol |
|---|---|
| `src/lib/custody/PodPdfDocument.tsx` (243) | Documento `@react-pdf/renderer` del POD (espeja `PoPdfDocument.tsx`). Embebe shipment, receptor, fecha, firma, timeline, resumen de hash-chain, evidencias y QR. |
| `src/lib/custody/pod-pdf.ts` (246) | Orquestación server-side: lee POD/timeline/resumen → embebe firma+fotos → render a Buffer → sube a `custody-pod` → registra como evidencia `pod` (sha256+audit+chain) → actualiza `pod_storage_path`. Más `getPodPdfEvidenceId()` para la descarga auditada. |
| `src/app/(app)/wms/custody/_components/PodDownloadButton.tsx` (58) | Cliente: **Descargar PDF** (vía `emit_custody_signed_url`, auditado) / **Generar PDF** / **Regenerar**. |

### Modificados
| Archivo | Cambio |
|---|---|
| `src/app/(app)/wms/custody/actions.ts` | `generatePodAction` ahora genera el PDF tras crear el POD (best-effort + `pdf_warning`). Nuevas: `regeneratePodPdfAction`, `podPdfSignedUrlAction`. |
| `src/app/(app)/wms/custody/pod/[id]/page.tsx` | Reemplaza la dependencia exclusiva de `PrintButton` por `PodDownloadButton` (descarga auditada del PDF server-side). `PrintButton` queda como respaldo de impresión. Filtra el propio POD-PDF de la galería de evidencias. |

**No modificados** (confirmado): las 4 migraciones `0036`–`0039`, `qr.ts`, `CustodyTimeline`, dashboard, despacho, Gates 1–4C.

---

## 3. Flujo del PDF (server-side)

```
generatePodAction(input)
  └─ generate_delivery_pod (RPC 0039)            → crea delivery_pods (1×shipment)
  └─ generateAndStorePodPdf(shipmentId, force)
       1. getDeliveryPodByShipment + getCustodyTimeline + getShipmentCustodySummary + getShipmentToken
       2. firma (custody-pii) + hasta 6 fotos (custody-evidence): descarga service-role → data URL
          · solo image/png|jpeg se embeben; redactadas se omiten
       3. QR del shipment (custodyQrDataUrl, base = env.app.url)
       4. renderToBuffer(PodPdfDocument(data))   → Buffer PDF (A4)
       5. sha256(buf) = hash canónico (tamper-evidence)
       6. upload a custody-pod: shipment/{shipmentId}/pod/{uuid}.pdf  (service-role)
       7. attach_custody_evidence(stage=pod, event_type=pod, kind=documento, bucket=custody-pod,
          path, sha256)  → evidencia + sha256 EN LA HASH-CHAIN + audit 'custody.attach'
          · si falla → se borra el binario huérfano y se propaga el error
       8. UPDATE delivery_pods.pod_storage_path = path  (service-role)
```

**Descarga (auditada):**
```
PodDownloadButton → podPdfSignedUrlAction(shipmentId)
  └─ getPodPdfEvidenceId  → evidencia documento de custody-pod con path = pod_storage_path
  └─ getEvidenceSignedUrl → emit_custody_signed_url (audita 'custody.access') + signed URL TTL 300s
```

---

## 4. Integración con Storage e integridad

- **Bucket `custody-pod`** queda **poblado** con el PDF (antes vacío).
- **`delivery_pods.pod_storage_path`** queda **completo** (apunta al binario).
- **`emit_custody_signed_url`** sirve el PDF (la evidencia `documento` se resuelve por path) →
  **auditoría de lectura** mantenida (`custody.access`).
- **Hash-chain:** el PDF entra como evidencia `pod` con su `sha256` → queda anclado en la cadena
  (verificable con `verify_custody_chain`). Refuerza la integridad.

### Decisiones (additive, sin tocar SQL)
1. **El PDF se registra como evidencia `pod`** (vía `attach_custody_evidence`): es el único camino
   auditado para servir un binario por `emit_custody_signed_url` y para anclar su `sha256` en la
   cadena. `generate_delivery_pod` (0039 §16) **sigue sin** insertar el evento `pod`; el evento lo
   crea esta capa de aplicación al adjuntar el PDF. Enum/CHECK de 0036 ya contemplan `pod/pod`.
2. **`pod_storage_path` se actualiza por service-role** (no hay trigger de inmutabilidad en
   `delivery_pods`; sí lo hay en `custody_events`/`custody_evidence`).
3. **Embebido de binarios por service-role** durante la generación (no por `emit`): evita el gate de
   rol PII al construir el documento. La **descarga** del usuario sí pasa por `emit` (auditada).
4. **Regeneración** (`regeneratePodPdfAction`, `force`): crea un PDF nuevo (path nuevo) y reapunta
   `pod_storage_path`; las versiones previas quedan retenidas (evidencia append-only).
5. **Best-effort en `generatePodAction`:** si el PDF falla, el POD queda creado y se puede regenerar
   (`pdf_warning`), sin pérdida de datos ni POD a medias.

---

## 5. Validaciones

| Check | Resultado |
|---|---|
| `tsc --noEmit` | ✅ **0 errores** |
| `eslint` (custody) | ✅ **0 errores** (3 warnings `jsx-a11y/alt-text` en `<Image>` de react-pdf, **idénticos** a los de `PoPdfDocument.tsx`/`OrderPdfDocument.tsx` existentes; no suprimidos, por consistencia con el código base) |

> Nota: la verificación E2E real (subida efectiva a `custody-pod` + `pod_storage_path`) depende de
> **0037/0038/0039 aplicadas en Supabase (B2)** y del bucket creado. En modo demo/sin DB, la
> generación se omite con gracia (`isMock()`), sin romper la UI.

---

## 6. Criterio de éxito (B4)

| Criterio | Estado |
|---|---|
| POD PDF server-side generado (`@react-pdf/renderer`) | ✅ |
| `custody-pod` poblado | ✅ (vía upload service-role) |
| `delivery_pods.pod_storage_path` actualizado | ✅ |
| Descarga vía `emit_custody_signed_url()` | ✅ (`podPdfSignedUrlAction`) |
| Auditoría de lectura mantenida (`custody.access`) | ✅ |
| `tsc` limpio | ✅ |
| `eslint` limpio (0 errores) | ✅ |

**B4 = CERRADO** a nivel de código/aplicación (pendiente validación operativa en Supabase, ligada a B2).

---

## 7. Bloqueantes que permanecen (fuera de alcance de esta tarea)

- **B2** — aplicar+validar `0038`/`0039` en Supabase (el PDF real requiere el bucket + RPC aplicados).
- **B3** — backup de Storage.
- **B6** — marco legal de retención (+ Merkle opcional).

> Esta tarea cerró **B4**. **Actualización (2026-06-03):** B2 quedó validado (`0038`=10/10, `0039`=12/12) →
> **GATE 5 = VALIDATED + CLOSED** (ver `GATE_5_FINAL_CLOSURE_REPORT.md`). B3/B6 son *Operational / Compliance
> Follow-Up* (no bloqueantes del cierre de ingeniería).

---

> **FIN — Implementación POD-PDF server-side (B4).** Sin push. Sin deploy. Sin Gate 6.

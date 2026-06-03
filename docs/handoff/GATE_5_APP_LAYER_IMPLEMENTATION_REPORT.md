# GATE 5 — App Layer · REPORTE DE IMPLEMENTACIÓN (cierra bloqueante B1)

> Estado: **implementado. `tsc --noEmit` 0 errores · `eslint` limpio.** Sin tocar DB/migraciones/Supabase.
> Sin push/deploy. Fecha: 2026-06-03. Capa de aplicación de la Cadena de Custodia (FASES 1–8).
> Cierra el **bloqueante B1** del `GATE_5_CLOSURE_REPORT.md` (capa de aplicación inexistente).

---

## 1. Resumen

Se construyó la **capa de aplicación completa** de Custody sobre el back-end SQL `0036`–`0039` (sin tocarlo):
TS Layer + Server Actions + QR + Timeline + Dashboard + integración en Shipment Detail + Evidence Viewer +
POD Surface. **Todas las mutaciones van por RPC SECURITY DEFINER**; los binarios **solo** por
`emit_custody_signed_url` (auditado). Sin SQL inline para mutaciones; lecturas de lista vía PostgREST (RLS).

---

## 2. Archivos creados (14)

**FASE 1 — TS Layer** (`src/lib/custody/`)
- `types.ts` — tipos de dominio + META (stage/event/kind) espejando 0036–0039.
- `custody.ts` — wrappers tipados de las **9 RPC** (`attach`/`register`/`verify`/`redact`/`generate_pod`/
  `timeline`/`by_token`/`summary`/`emit_signed_url`) + lecturas de lista + `getEvidenceSignedUrl` (emit + firma) + `getShipmentToken`. Mocks demo.
- `qr.ts` — `custodyTokenUrl` + `custodyQrDataUrl` (QR local con `qrcode`, **sin** enviar el token a terceros).

**FASE 2 — Server Actions** (`src/app/(app)/wms/custody/actions.ts`)
- `attachEvidenceAction` (sube archivo a Storage con service-role + sha256 + `attach`), `registerEventAction`,
  `generatePodAction`, `redactEvidenceAction`, `evidenceSignedUrlAction`. `revalidatePath()` · sin `router.refresh()`.

**FASES 3–8 — UI** (`src/app/(app)/wms/custody/` + `src/app/(app)/c/`)
- `page.tsx` — **Dashboard** (KPIs, eventos recientes, PODs, filtro por etapa, resolución de token).
- `_components/TokenSearch.tsx` — resolver QR → `/c/{token}` (client).
- `_components/CustodyTimeline.tsx` — **Timeline** visual (usa `get_custody_timeline`).
- `_components/EvidenceViewer.tsx` — **Evidence Viewer** (signed URL auditado + redacción) (client).
- `_components/QrCard.tsx` — **QR** imprimible (client).
- `_components/CustodyShipmentActions.tsx` — captura: eventos/evidencia/POD (client).
- `_components/CustodyShipmentSection.tsx` — sección integrable (server, **resiliente**).
- `_components/PrintButton.tsx` — print-to-PDF (client).
- `pod/[id]/page.tsx` — **POD Surface** (receptor/fecha/firma/evidencias/shipment + PDF por impresión).
- `c/[token]/page.tsx` — **resolución pública de QR** (sin IDs internos ni PII).

## 3. Archivos modificados (2)

- `src/app/(app)/wms/despachos/[id]/page.tsx` — **FASE 6**: agrega `<CustodyShipmentSection>` cuando hay
  shipment (resiliente: si 0036–0039 no están aplicadas, falla en silencio y **no rompe Dispatch**).
- `src/components/shell/Sidebar.tsx` — entrada de nav **"Custodia"** (`/wms/custody`, icon `shield`).

> **No se tocó** ningún otro archivo de Gates 1–4C, inventario, picking, packing, dispatch, ledger ni FEFO.

---

## 4. Arquitectura

```
UI (server pages) ── data layer (src/lib/custody) ── RPC SECURITY DEFINER (0036–0039)
   │                         │
   ├─ Server Actions ────────┘ (mutaciones: attach/register/pod/redact)
   ├─ EvidenceViewer ── evidenceSignedUrlAction ── emit_custody_signed_url (AUDITADO) ── Storage (signed URL TTL corto)
   ├─ QrCard ── qrcode (local) ── /c/{token} ── get_custody_by_token (SIN PII)
   └─ CustodyTimeline ── get_custody_timeline
```

- **Único camino al binario:** `getEvidenceSignedUrl` = `emit_custody_signed_url` (auditoría `custody.access`)
  + `storage.createSignedUrl` (service-role). **Nunca** acceso directo a Storage desde la UI.
- **QR:** generado **server-side** con `qrcode` (ya en deps); el token opaco no se expone a terceros.
- **Resiliencia:** la sección de custodia en Dispatch y los reads del dashboard degradan a `ModuleUnavailable`/
  nota si las migraciones no están aplicadas → **no rompen** pantallas existentes.

---

## 5. Validaciones

| QA | Resultado |
|---|---|
| `tsc --noEmit` | ✅ **0 errores** |
| `eslint` (capa custody + archivos tocados) | ✅ **limpio** |
| Mutaciones solo vía RPC | ✅ (Server Actions → wrappers → RPC) |
| Binarios solo vía signed URL auditado | ✅ (`emit_custody_signed_url`) |
| Sin `router.refresh()` | ✅ (`revalidatePath()`) |
| Gates 1–4C intactos | ✅ (solo se agregó sección + nav) |

---

## 6. Criterio de éxito

| | Componente | Estado |
|---|---|---|
| ✅ | TS Layer | `src/lib/custody/{types,custody,qr}.ts` |
| ✅ | Server Actions | `wms/custody/actions.ts` (5 actions) |
| ✅ | QR Layer | `qr.ts` + `QrCard` + `/c/[token]` resolver |
| ✅ | Timeline Layer | `CustodyTimeline` (get_custody_timeline) |
| ✅ | Custody Dashboard | `/wms/custody` |
| ✅ | Shipment Integration | `/wms/despachos/[id]` (sección custody) |
| ✅ | Evidence Viewer | `EvidenceViewer` (signed URL auditado) |
| ✅ | POD Surface | `/wms/custody/pod/[id]` (+ print-to-PDF) |

---

## 7. Riesgos / pendientes

| Ítem | Nota |
|---|---|
| **`0036`–`0039` sin aplicar** | La UI real requiere las migraciones aplicadas (hoy degradan a "no disponible"). |
| **Backup de Storage** | Sigue **indefinido** (B3 del closure report) — bloqueante operativo antes de captura real. |
| **POD-PDF server-side** | Se resolvió con **print-to-PDF del navegador** (sin nueva arquitectura). Un render server-side (route/Edge Function que suba a `custody-pod`) queda como mejora futura. |
| **`/c/[token]` autenticado** | El resolver vive en `(app)` (requiere sesión WMS, como exige `get_custody_by_token`). Un acceso público para terceros sería un alcance posterior. |
| **`NEXT_PUBLIC_SITE_URL`** | El QR usa esta env para URLs absolutas escaneables; configurar en deploy. |
| **Geo/firma UI avanzada** | Captura básica por upload de archivo; firma por canvas y geo del dispositivo son mejoras incrementales. |

---

## 8. Estado de Gate 5 tras esta tarea

- **Back-end DB (0036–0039):** ✅ implementado/commiteado (0036/0037 validados; 0038/0039 pendientes de correr kits).
- **Capa de aplicación (B1):** ✅ **IMPLEMENTADA** (esta tarea).
- **Para `GATE 5 = VALIDATED + CLOSED`:** falta (a) aplicar+validar `0038`/`0039`, (b) **backup de Storage**,
  (c) marco legal de retención. Recién entonces el gate completo puede declararse cerrado.

---

> **FIN — Capa de aplicación de Custody implementada (B1 cerrado).** Sin tocar DB/migraciones, sin push.
> **NO se inició Gate 6.** Esperar aprobación. Para cierre total de Gate 5 restan B2/B3/B6 (operativos/legales).

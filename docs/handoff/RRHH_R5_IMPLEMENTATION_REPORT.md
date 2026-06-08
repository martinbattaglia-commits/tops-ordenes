# TOPS NEXUS — RRHH · R5 IMPLEMENTATION REPORT
## R5 — DOCUMENTS & STORAGE · `0060_rrhh_documents_storage`

> **Autorización:** Dirección — plan APPROVED + D1 (sin recibos) / D2 (supervisor acotado) / D3
> (requiere_doc diferido). **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

## 1. Resumen
Implementado el artefacto de R5: **`0060_rrhh_documents_storage.sql`** (buckets privados + metadatos +
auditoría de acceso + RPC de signed URL). Verificado en alcance y **committeado aislado** (`9f02403`).
**Estado:** **CODE COMPLETE + COMMITEADO + VERIFICADO localmente**; **aplicación a producción
PENDIENTE** (paso manual — sin link/credenciales en este entorno, igual que R1–R4).

## 2. Preflight
| Check | Resultado |
|-------|-----------|
| `0060` libre | ✅ |
| Rama | ✅ `claude/gracious-pasteur-6efdde` |
| Precondición `0056`–`0059` (lado repo) | ✅ (prod = atestación Dirección; reconfirmar al aplicar) |
| Plan aprobado + D1/D2/D3 | ✅ |

## 3. Artefacto (`0060_rrhh_documents_storage.sql`)
- **Buckets privados (2):** `rrhh-legajo`, `rrhh-health` (`public=false`, mime+size limit). **D1:** sin `rrhh-receipts`.
- **Enums:** `rrhh_doc_class_t`, `rrhh_doc_audit_action_t`.
- **Tablas:** `rrhh_documents` (legajo + adjuntos de solicitud; `sha256`, `expires_at`, `retention_*`,
  `redacted`, soft-delete, versionado) · `rrhh_document_audit` (append-only).
- **RPC `emit_rrhh_signed_url`:** único acceso al binario; `security definer`, fail-closed
  `coalesce(has_permission)`, audita la lectura; **sin `current_role()`**.
- **RLS:** `has_permission`+propiedad+jerarquía; salud (`rrhh-health`) solo `rrhh.admin`+dueño;
  **D2** supervisor solo `doc_class IN ('adjunto_solicitud','capacitacion')` de su equipo.
- **Storage:** **ninguna** policy de lectura `authenticated` en buckets `rrhh-*` → acceso solo por RPC.
- **Append-only:** forbid delete (documents/audit) + forbid update (audit).

## 4. Adherencia al alcance (R5 + D1/D2/D3)
| Restricción | Cumplimiento |
|-------------|--------------|
| Solo buckets rrhh-legajo/rrhh-health (D1) | ✅ (sin rrhh-receipts) |
| Tablas rrhh_documents + rrhh_document_audit | ✅ |
| RPC emit_rrhh_signed_url | ✅ |
| has_permission + ownership + fail-closed; **sin current_role()** | ✅ (solo comentarios) |
| Lectura directa de storage prohibida | ✅ (sin policy storage.objects rrhh-*) |
| Supervisor acotado (D2) | ✅ (adjunto_solicitud/capacitacion) |
| NO recibos/payroll/firma/OCR/UI | ✅ (verificado) |
| NO tocar R1–R4 / ERP / WMS / Login | ✅ |

**Commit aislado:** `9f02403`. Docs `RRHH_*` fuera del commit.

## 5. Aplicación a producción (manual — PENDIENTE)
Operador: preflight (backup + `0056`–`0059` aplicadas + `0060` libre + ventana + operador único) →
aplicar `0060` → verificar (`RRHH_R5_AUDIT_REPORT.md §3`).

## 6. Resultado
- Implementación del artefacto: ✅ COMPLETA (`9f02403`).
- Aplicación a producción: ⏳ PENDIENTE (manual).
- Desviaciones de alcance: ninguna.

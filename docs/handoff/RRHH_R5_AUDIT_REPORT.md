# TOPS NEXUS — RRHH · R5 AUDIT REPORT
## Auditoría del artefacto `0060_rrhh_documents_storage` (DOCUMENTS & STORAGE)

> **Tipo:** auditoría de gate R5, adversarial, solo lectura. Énfasis en PII/storage (aislamiento,
> acceso RPC-only, sin current_role, append-only). **Fecha:** 2026-06-07.

## 1. Resumen
`0060` (commit `9f02403`) implementa el almacén documental conforme al plan aprobado y a D1/D2/D3.
**0 críticos · 0 mayores.** Aplicación/verificación en prod = paso manual (§3).

## 2. Controles
| # | Control | Resultado | Evidencia |
|---|---------|-----------|-----------|
| C1 | Buckets privados rrhh-legajo/rrhh-health; D1 sin rrhh-receipts | **PASS** | `public=false`; no `rrhh-receipts` |
| C2 | PII salud aislada (FD-1): rrhh-health solo admin+dueño | **PASS** | RLS + RPC ramifican por `storage_bucket='rrhh-health'` |
| C3 | Lectura directa de storage **prohibida** | **PASS** | sin policy de `storage.objects` para rrhh-* → acceso solo por RPC |
| C4 | RPC-only + auditado | **PASS** | `emit_rrhh_signed_url` inserta en `rrhh_document_audit` antes del grant |
| C5 | Fail-closed (FD-4); **sin current_role()** (FD-5) | **PASS** | 7× `coalesce(has_permission)`; 0 `current_role()` en código |
| C6 | Ownership: empleado solo lo suyo | **PASS** | `empleado.profile_id = auth.uid()` en RLS y RPC |
| C7 | D2 supervisor acotado | **PASS** | `doc_class in ('adjunto_solicitud','capacitacion')` + jerarquía; NUNCA dni/cuil/contrato/salud |
| C8 | Operaciones/otros sin acceso | **PASS** | sin `rrhh.*` ni propiedad ⇒ RLS/RPC niegan |
| C9 | Append-only (FD-10) | **PASS** | forbid delete (documents/audit) + forbid update (audit) |
| C10 | Supresión/retención (Ley 25.326) | **PASS** | `redacted` (RPC niega), soft-delete, `retention_*` |
| C11 | No reutiliza `documents`/Centro Documental ni policies legacy | **PASS** | almacén dedicado; sin referencias |
| C12 | Sin recibos/payroll/firma/OCR/UI; sin tocar R1–R4 | **PASS** | verificado |
| C13 | Idempotencia | **PASS** | `on conflict do update` (buckets), `do$$ exception`, `if not exists`, `drop policy/trigger if exists`, `create or replace` |
| C14 | Commit aislado | **PASS** | `9f02403` |

## 3. Verificación post-aplicación (operador, read-only)
```
☐ Buckets rrhh-legajo, rrhh-health existen y public=false
☐ Tablas rrhh_documents, rrhh_document_audit creadas; RLS=on
☐ RPC emit_rrhh_signed_url existe (execute a authenticated)
☐ NO existe policy de SELECT en storage.objects para bucket_id like 'rrhh-%'
☐ Empleado (dueño) obtiene grant de su doc; doc ajeno → ACCESS_DENIED
☐ Supervisor: grant de adjunto_solicitud/capacitacion de su equipo; DNI/contrato/salud → ACCESS_DENIED
☐ Salud (rrhh-health): manager (sin admin) → ACCESS_DENIED; admin/dueño → grant
☐ Operaciones (sin rrhh.*) → ACCESS_DENIED y 0 filas en rrhh_documents
☐ Cada emit_rrhh_signed_url deja fila en rrhh_document_audit
☐ DELETE en rrhh_documents/rrhh_document_audit y UPDATE en audit → ERROR (append-only)
```
> La verificación funcional puede correrse con el patrón de `BEGIN…ROLLBACK` + `set_config('request.jwt.claims',…)`
> usado en R4 (zero-persistence), simulando empleado/supervisor/rrhh/operaciones.

## 4. Hallazgos
- 🔴 Críticos: **0** · 🟠 Mayores: **0**
- 🟡 Menores (no bloquean):
  - **m1** — la relación `doc_class` ↔ `storage_bucket` no está forzada por constraint (un `estudio`
    podría cargarse en `rrhh-legajo`). La sensibilidad se gobierna por **bucket** (salud=rrhh-health),
    así que el control de acceso es correcto; recomendable, en gate de hardening, un check que obligue
    los `doc_class` de salud al bucket `rrhh-health`.
  - **m2** — el `upload` del binario se hace con `service_role` (bypassa RLS); el control de carga por
    `rrhh.create`/`rrhh.admin` se ejercerá en la capa de app/RPC de subida (gate de UI/backend).
  - (Heredado D3) — enforce de `requiere_doc` en `aprobar_l2` queda como Cross-Gate Hardening.

## 5. Veredicto
> ## R5 ARTEFACTO — `PASS`
Almacén documental correcto y **PII-first**: salud aislada, acceso **solo por RPC auditado**, sin
`current_role()`, fail-closed, append-only, supervisor acotado (D2). 0 críticos/0 mayores. Habilita el
cierre de R5 una vez aplicado y verificado en producción.

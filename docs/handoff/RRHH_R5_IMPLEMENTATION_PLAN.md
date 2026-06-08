# TOPS NEXUS — RRHH · R5 IMPLEMENTATION PLAN
## R5 — DOCUMENTS & STORAGE · `0060_rrhh_storage`

> **Estado:** PLAN — **pendiente de aprobación de Dirección**. **No** se implementa, **no** se migra,
> **no** se crean buckets/SQL/RPCs. (No escribir `0060`.)
> **Autorización:** Dirección — apertura R5 (gestión documental RRHH), diseño-primero.
> **Modelo congelado:** `RRHH_MASTER_ARCHITECTURE_v2_0.md` §2/§5 + `RRHH_ARCHITECTURE_ADDENDUM_V1_2.md`
> (almacén dedicado) + `_V1_2_1.md` (guards fail-closed) + `RRHH_R2_ARCHITECTURE_AMENDMENT.md` (permisos gruesos).
> **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

---

## 0. Auditoría inicial (verificado contra el repo)
| Ítem | Hallazgo | Implicancia para R5 |
|------|----------|---------------------|
| Próxima migración libre | `0060` | R5 = `0060_rrhh_storage` |
| Buckets existentes | `documents`, `custody-evidence/pii/pod`, `treasury`, `invoices`, `signatures`, `pdfs`, `po-*`, `supplier-invoices`, `attachments` | `rrhh-*` **libres** |
| Patrón de bucket | `insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) … on conflict do update` (custody `0037`) | Reutilizable (mismo patrón) |
| Storage policies custody | usan **`current_role()`** (legacy) + lectura directa para roles internos | ❌ **NO copiar authz** (FD-5); RRHH cierra lectura directa |
| RPC de acceso | `emit_custody_signed_url` (estructura: definer → autoriza → audita → grant) | ✅ Reutilizar **estructura**; ❌ no su `current_role()` |
| Tabla `documents` (Centro Documental) | gobernada por `current_role()` (lectura amplia a operaciones/supervisor) | ❌ **NO** almacenar PII RRHH ahí (FD-2; causa de la fuga histórica) |
| Helpers de storage | `fileHashSha256`/`buildDocPath`/`getSignedUrl` (`src/lib/documental/storage.ts`) | ✅ Reutilizar **código** parametrizando bucket |
| Retención | patrón custody `retention_class`/`retention_until` (`0037/0038`) | ✅ Reutilizar para retención documental |

**Conclusión:** RRHH crea **almacén documental dedicado** (buckets `rrhh-*` + tablas `rrhh_*`),
reutiliza **estructura/código** de Custody/Documental pero **no** sus capas de seguridad legacy.

---

## 1. Objetivo y alcance
Incorporar la **gestión documental de RRHH**: documentos de legajo y adjuntos de solicitudes, con
PII aislada, acceso por RPC auditado y ownership. **Sin** UI; sin tocar R1–R4, ERP, WMS ni Login.

**Incluye:** buckets dedicados + tablas de metadatos + auditoría de acceso + RPC de signed URL + RLS.
**NO incluye:** UI/portal (gate posterior), liquidación, firma digital, modificar las RPCs de R4.

---

## 2. Diseño de almacenamiento (buckets dedicados, privados)

| Bucket | Contenido | Sensibilidad | MIME / límite (tentativo) |
|--------|-----------|--------------|----------------------------|
| `rrhh-legajo` | DNI, CUIL, CV, contrato, alta AFIP, certificados, capacitación, otros; adjuntos laborales de solicitudes | Alta (PII personal) | pdf/jpeg/png · 10 MiB |
| `rrhh-health` | Estudios médicos, certificados médicos, ART | **Categoría especial salud** (Ley 25.326) | pdf/jpeg/png · 10 MiB |
| `rrhh-receipts` *(si se incluye)* | Recibos de sueldo | Alta (CUIL/CBU/haberes) | pdf · 10 MiB |

Todos `public=false`. **Salud segregado** en su propio bucket (FD-1) con gating más estricto.
> **Decisión a confirmar:** ¿`rrhh-receipts` entra en R5 o se difiere a un gate de recibos? El alcance
> que enumeró Dirección es legajo + adjuntos de solicitudes; recibos usan la **misma** arquitectura.

---

## 3. Modelo de datos (diseño; SQL en `0060` tras aprobación)

### 3.1 Enums
- `rrhh_doc_class_t` = `dni` · `cuil` · `cv` · `contrato` · `alta_afip` · `certificado` · `estudio` ·
  `capacitacion` · `adjunto_solicitud` · `otro`.
- `rrhh_doc_audit_action_t` = `create` · `view` · `download` · `soft_delete` · `restore`.

### 3.2 `rrhh_documents` (metadatos; binario en bucket)
`id`/`document_group_id`/`version`/`is_current` · `empleado_id` FK → rrhh_empleados ·
`solicitud_id` FK → rrhh_solicitudes (nullable; para adjuntos) · `doc_class rrhh_doc_class_t` ·
`storage_bucket` (check ∈ `rrhh-legajo`,`rrhh-health`,`rrhh-receipts`) · `storage_path` ·
`sha256` (obligatorio, tamper-evidence) · `mime_type` · `file_size` · `titulo` · `expires_at` ·
`retention_class`/`retention_until` · `redacted` (derecho de supresión, Ley 25.326) · soft-delete
(`deleted_at`/`deleted_by`) · audit cols. **Health** ⇒ `storage_bucket='rrhh-health'`.

### 3.3 `rrhh_document_audit` (append-only — acceso a PII)
`id` bigserial · `document_id` FK · `actor_id` · `action rrhh_doc_audit_action_t` · `ts` ·
`ip`/`user_agent`/`detail` jsonb. Read gated por RBAC (`rrhh.audit`/admin), **no** `current_role()`.
Inmutable (`tg_forbid_delete_rrhh` + `tg_forbid_update_rrhh`).

> Recibos (si se incluyen): `rrhh_receipts` (period/tipo/nro/fecha_pago + storage_path) — o usar
> `rrhh_documents` con `doc_class` propio. A decidir en la aprobación.

---

## 4. Seguridad (FD-1/FD-4/FD-5/FD-10 — sin excepciones)

### 4.1 RLS de tablas (has_permission + propiedad; sin current_role)
| Recurso | Lectura | Escritura |
|---------|---------|-----------|
| `rrhh_documents` (legajo) | `coalesce(has_permission('rrhh.view'),false)` **o** dueño (`empleado.profile_id=auth.uid()`) **o** supervisor directo (adjuntos laborales) | `coalesce(has_permission('rrhh.admin'),false)` (carga por RPC/service_role) |
| `rrhh_documents` **salud** (`rrhh-health`) 🔒 | `coalesce(has_permission('rrhh.admin'),false)` **o** dueño | `rrhh.admin` |
| `rrhh_document_audit` | `coalesce(has_permission('rrhh.view'),false)` | solo RPC |

### 4.2 Storage (cierre del bypass — más estricto que custody)
- Buckets `rrhh-*` **SIN** policy de lectura `authenticated` (a diferencia de custody, que abre a
  roles internos por `current_role()`). **El binario solo se obtiene por RPC.**
- Escritura/objeto: `service_role` (carga administrativa) y/o `rrhh.admin`; **sin** `current_role()`.

### 4.3 RPC `emit_rrhh_signed_url(p_document_id, p_reason)` (estructura custody; authz RRHH)
`security definer`, fail-closed: (1) resuelve doc + dueño + bucket; (2) si `redacted` → deniega;
(3) autoriza: `coalesce(has_permission('rrhh.admin'),false)` para salud/receipts, o
`coalesce(has_permission('rrhh.view'),false)`/propiedad/supervisor para legajo; (4) **audita** la
lectura en `rrhh_document_audit`; (5) devuelve *grant* `{bucket,path}` (la app firma con el SDK).
**Guard canónico** `coalesce(public.has_permission('rrhh.<x>'), false)` (FD-4); **sin `current_role()`**
(FD-5).

### 4.4 Matriz de acceso (resultado)
| Actor | Legajo | Salud 🔒 | Adjuntos solicitud |
|-------|--------|----------|--------------------|
| Empleado | propios | propios | propios |
| `rrhh_manager` | todos | — (salvo grant) | todos |
| `rrhh_admin` | todos | todos | todos |
| Supervisor (jerárquico) | adjuntos laborales de su equipo | — | de su equipo |
| Operaciones / otros | sin acceso | sin acceso | sin acceso |
| Compliance | — | excepción reglada + auditada | — |

---

## 5. Reutilización (código sí, seguridad no)
- ✅ **Código:** `fileHashSha256`, `buildDocPath`, patrón `getSignedUrl`/upload (parametrizando bucket),
  patrón de retención y de auditoría append-only.
- ❌ **No reutilizar:** tabla/bucket `documents`, policies `current_role()` de custody/documental,
  Centro Documental (UI/listado), `documents_audit`.

---

## 6. Migración propuesta `0060_rrhh_storage`
Buckets `rrhh-legajo`/`rrhh-health`(/`rrhh-receipts`) + enums + `rrhh_documents` + `rrhh_document_audit`
+ índices + RLS (has_permission+propiedad) + append-only + RPC `emit_rrhh_signed_url` + retención.
Idempotente. **Sin** UI; **sin** tocar R1–R4.

---

## 7. Riesgos
| Tipo | Riesgo | Sev. | Mitigación |
|------|--------|------|-----------|
| PII | Fuga por reutilizar `documents`/policies legacy | Alta | Almacén dedicado; buckets sin lectura directa; RPC-only auditado (FD-2/FD-3) |
| PII salud | Exposición de salud | Alta | Bucket `rrhh-health` aislado + `rrhh.admin` (FD-1) |
| Seguridad | Bypass del RPC (acceso directo al bucket) | Alta | Buckets `rrhh-*` sin policy de lectura authenticated |
| Cumplimiento | Derecho de supresión (Ley 25.326) | Media | `redacted` + soft-delete + retención |
| Cross-gate | Enforce de `requiere_doc` en `aprobar_l2` toca R4 | Media | **Fuera de R5** (NO tocar R1–R4); se planifica como update controlado posterior |
| Producción | Aplicar sin backup | Alta (si se omite) | Preflight: backup + orden 0056→…→0060 + ventana + operador |

## 8. Rollback
Objetos **nuevos** (buckets/tablas/RPC) → "rollback" = `drop` en orden inverso + remover buckets
vacíos. Append-only impide pérdida de evidencia ya cargada. (Detalle en el paquete de despliegue.)

## 9. Criterios de aceptación
- Buckets `rrhh-*` privados creados; **sin** lectura directa authenticated.
- `rrhh_documents` + `rrhh_document_audit` con RLS has_permission+propiedad (sin `current_role()`),
  append-only; salud en `rrhh-health` (solo admin+dueño).
- `emit_rrhh_signed_url` fail-closed + audita cada lectura.
- Operaciones/otros sin acceso; empleado solo lo propio; supervisor solo adjuntos laborales de su equipo.
- 0 objetos fuera de alcance (sin UI; sin tocar R1–R4/ERP/WMS/Login).
- Auditoría R5 PASS (0 críticos / 0 mayores).

## 10. Entregables del gate
`RRHH_R5_IMPLEMENTATION_PLAN.md` (este) → aprobación → `0060_rrhh_storage.sql` →
`RRHH_R5_IMPLEMENTATION_REPORT.md` · `RRHH_R5_AUDIT_REPORT.md` · `RRHH_R5_CLOSURE_REPORT.md`.

## 11. Decisiones a confirmar por Dirección
1. **¿`rrhh-receipts` entra en R5** o se difiere a un gate de recibos? (misma arquitectura).
2. **Acceso del supervisor:** ¿a qué `doc_class` exactamente? (propuesto: solo adjuntos laborales de
   solicitudes de su equipo; **no** DNI/CUIL/contrato/salud).
3. **Enforce de `requiere_doc`** (R4 `aprobar_l2`): queda **fuera de R5** (no tocar R1–R4); ¿se agenda
   como gate de hardening cross-R4/R5?

---
```text
R5 PLAN COMPLETE
AWAITING APPROVAL
(no SQL, no 0060, no buckets, no producción)
```

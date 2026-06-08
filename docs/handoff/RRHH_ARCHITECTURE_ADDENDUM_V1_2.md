# TOPS NEXUS — RRHH · ADDENDUM DE ARQUITECTURA v1.2

## Remediación de PII crítica (re-corrección de M1)

> **Propósito:** eliminar la fuga de PII detectada en la auditoría de cierre
> (`RRHH_CLOSURE_AUDIT_REPORT.md`, hallazgos H-C1 y H-M1), corrigiendo definitivamente la
> integración documental que el Addendum v1.1 resolvió mal.
> **Naturaleza:** addendum documental. **No** implementa, no crea migraciones, no toca producción,
> sin commit, sin tocar ERP-A/ERP-B.
> **Supersesión:** este addendum **reemplaza la sección M1** del Addendum v1.1. El resto de v1.1
> (M2–M6) sigue vigente. Donde haya conflicto, **v1.2 prevalece**.
> **Principio rector:** la reutilización es deseable; la confidencialidad es obligatoria. **Si
> entran en conflicto, gana la confidencialidad.**
> **Fuente de verdad:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07. **Versión:** 1.2.

---

## 0. Resumen ejecutivo

El Addendum v1.1 sobre-corrigió M1: para evitar duplicación reutilizó la tabla y el bucket
`documents`. Pero `documents` se gobierna por una RLS legacy basada en `current_role()`
(`user_role_t`), que concede **lectura total a `operaciones` y `supervisor`**. Almacenar recibos
ahí los expone (CUIL, CBU, remuneraciones) y los hace listables desde el Centro Documental.

v1.2 aplica el patrón **ya probado en producción por el módulo Custody (GATE 5)**: cuando hay PII,
Nexus **no reutiliza** los almacenes genéricos — crea **buckets privados dedicados con RLS más
estricta** y sirve el acceso por una **RPC que autoriza y audita** (`emit_custody_signed_url`,
`0037_custody_storage.sql`). RRHH hace lo mismo:

- **Almacén RRHH dedicado** (tablas `rrhh_documents` / `rrhh_receipts`, buckets `rrhh-*` privados).
- **Seguridad expresada solo en RBAC** (`has_permission`) **+ propiedad** (`empleado.profile_id =
  auth.uid()`). **Nunca `current_role()`.**
- **Sin política de lectura directa** sobre los buckets RRHH: el acceso se mintea por RPC
  `security definer` que verifica permiso/propiedad y registra la lectura.
- Se **reutiliza solo código puro** (hash SHA-256, construcción de path, patrones de versionado y
  auditoría), **no** las capas de seguridad de `documents`.

Resultado: `operaciones` y `supervisor` **sin acceso por defecto**; empleado solo lo suyo; RRHH
total; Dirección controlada. Cierra H-C1 y H-M1.

---

## 1. Análisis de la arquitectura documental actual (por qué NO sirve para recibos)

| Componente | Definición real | Por qué es incompatible con recibos |
|------------|-----------------|-------------------------------------|
| Tabla `documents` | `0010_documents.sql` | Multi-tenant por `client_id`; **no** modela propiedad de empleado |
| RLS read `documents` | `0010:313-323` — `using (… current_role() in ('admin','operaciones','supervisor') or client_id = …)` | `operaciones`/`supervisor` leen **todas** las filas; un recibo (client_id NULL) queda visible a roles operativos |
| RLS write `documents` | `0010:325-335` — `current_role() in ('admin','operaciones','supervisor')` | No reconoce roles RBAC de RRHH; el gate `has_permission` es inaplicable aquí |
| Storage `documents` (bucket) | `0010:382-390` — misma cláusula `current_role()` | El PDF del recibo es descargable directo del bucket, **eludiendo** cualquier RPC RRHH |
| `documents_audit` | `0010:349-352` — read `current_role() in ('admin','supervisor')` | La auditoría de acceso sería legible por `supervisor`; no gated por RBAC RRHH |
| Centro Documental | `src/lib/documental/data.ts` → `listDocs()` | `select … from documents … limit 500` **sin filtro de tipo** → recibos aparecerían en la UI |
| `current_role()` | `0001_init.sql:180`, `0005:23` — `select role from profiles` (devuelve `user_role_t`) | **No conoce** los roles RBAC de RRHH; toda RLS basada en él ignora el modelo RRHH |
| `has_permission()` | `0009_rbac.sql:164-174` — join `user_roles → role_permissions → permissions` | Sistema **distinto** al que gobierna `documents` → ambos no componen |

**Conclusión:** `documents`/`documents_audit`/bucket `documents`/Centro Documental están construidos
sobre el sistema **legacy** `current_role()`/`user_role_t`, con lectura amplia para roles
operativos. Son adecuados para **documentos operativos** (facturas, remitos, OC), **no** para
**documentos laborales privados** del empleado. Reutilizarlos para recibos es, por diseño, una
fuga de PII.

> **Precedente Nexus:** Custody (GATE 5) enfrentó lo mismo y resolvió **no reutilizando**:
> `0037_custody_storage.sql:9-10` — *"3 buckets PRIVADOS nuevos … NO reutiliza signatures/pdfs/
> attachments"*. v1.2 sigue ese precedente.

---

## 2. Almacenamiento RRHH dedicado (diseño, no implementación)

### 2.1 Buckets privados dedicados (mirroring Custody)

| Bucket | Contenido | Sensibilidad | Retención (tentativa, confirmar legal) |
|--------|-----------|--------------|----------------------------------------|
| `rrhh-receipts` | Recibos de sueldo (PDF) | Alta (CUIL/CBU/haberes) | Larga (documento laboral legal) |
| `rrhh-legajo` | DNI, contrato, CV, certificados, datos bancarios escaneados | Alta (PII personal) | Vida laboral + plazo legal |
| `rrhh-health` | Certificados médicos, ART, diagnósticos | **Categoría especial** (salud, Ley 25.326) | Mínima necesaria; gating MÁS estricto |

> Alternativa: un único `rrhh-private` con columna `doc_class`. **Recomendado:** separar al menos
> `rrhh-health` del resto (categoría especial de salud exige aislamiento y gating propio, como
> `custody-pii` se separa de `custody-evidence`). Todos `public=false`.

### 2.2 Tablas dedicadas (prefijo `rrhh_`)

**`rrhh_documents`** (documentación de legajo — reemplaza el vínculo a `documents` de v1.1)
| Campo | Tipo | Nota |
|-------|------|------|
| `id` / `document_group_id` / `version` / `is_current` | uuid/int/bool | versionado (patrón `documents`) |
| `empleado_id` | uuid FK → rrhh_empleados | **propiedad** |
| `doc_class` | enum (`dni`/`contrato`/`cv`/`certificado`/`bancario`/`otro`) | |
| `storage_bucket` | text check (in `rrhh-legajo`,`rrhh-health`) | |
| `storage_path` | text | |
| `sha256` | text not null | tamper-evidence (obligatorio, como custody) |
| `mime_type` / `file_size` | text/bigint | |
| `expires_at` | date | vencimiento (resuelve alerta "doc. vencida") |
| `retention_class` / `retention_until` | enum/date | patrón custody (`0037`) |
| `redacted` | bool | derecho de supresión/erasure (Ley 25.326) |
| `uploaded_by` / `uploaded_at` / `deleted_at` / `deleted_by` | audit/soft-delete | |

**`rrhh_receipts`** (recibos — reemplaza `rrhh_recibos` y el uso de `documents`)
`id` · `empleado_id` 🔒 · `periodo` (YYYY-MM) · `tipo` (mensual/SAC/final/ajuste) · `nro_recibo` ·
`fecha_pago` · `storage_bucket` (check = `rrhh-receipts`) · `storage_path` · `sha256` ·
`retention_until` · `uploaded_by` · `uploaded_at` · soft-delete. **Sin** detalle de conceptos.

**`rrhh_document_audit`** (append-only — reemplaza el uso de `documents_audit`)
`id` · `target` (document/receipt) · `target_id` · `actor_id` · `action` (`view`/`download`/
`create`/`delete`) · `ts` · `ip`/`user_agent`/`detail`. **Read gated por RBAC** (`rrhh:audit.read`
/ compliance), **no** por `current_role()`. Inmutable (`tg_forbid_delete_rrhh`, sin update).

---

## 3. Reutilización permitida (código) vs prohibida (capas de seguridad)

### ✅ SÍ se reutiliza (patrones/código puro, agnósticos de seguridad)

| Elemento | Origen | Cómo |
|----------|--------|------|
| `fileHashSha256()` | `documental/storage.ts:16` | Tal cual (función pura) |
| `buildDocPath()` | `documental/storage.ts:33` | Tal cual; `clientId` se sustituye por `empleado_id`/grupo |
| `newDocumentGroupId()` | `documental/storage.ts:21` | Tal cual |
| **Patrón** de upload | `uploadDocument()` | Replicar la **lógica**, parametrizando el bucket (la fn actual hardcodea `.from("documents")` — no se usa as-is) |
| **Patrón** de signed URL | `getSignedUrl()` | Replicar; la fn actual hardcodea `.from("documents")` — RRHH usa su bucket vía RPC |
| **Patrón** de versionado | `documents` (`document_group_id`/`version`/`is_current`) | Mismo esquema en `rrhh_documents` |
| **Patrón** de auditoría append-only + retención | `documents_audit`, custody `0037/0038` | Replicado en `rrhh_document_audit` con read RBAC |
| **Patrón** RPC de acceso | `emit_custody_signed_url` (`0037_custody_storage.sql:12-14`) | Modelo para `emit_rrhh_signed_url` |

### ❌ NO se reutiliza (incompatibles por seguridad)

| Elemento | Motivo |
|----------|--------|
| RLS de `documents` | Basada en `current_role()`; lectura amplia a operaciones/supervisor |
| Bucket `documents` | Storage RLS legacy con lectura amplia (`0010:382-390`) |
| Policies de `documents` (read/write/storage) | No reconocen RBAC RRHH; gating insuficiente para PII |
| `documents_audit` (como almacén de auditoría RRHH) | Read por `current_role() in (admin,supervisor)` |
| Centro Documental (`listDocs`, UI) | Lista `documents` sin filtro de tipo → expondría recibos |
| `uploadDocument()`/`getSignedUrl()` **as-is** | Hardcodean el bucket `documents` |

> Regla: se reutiliza **código que no decide acceso**; **no** se reutiliza **ninguna capa que
> decida quién ve qué**. Esa capa, en RRHH, es 100% RBAC + propiedad.

---

## 4. Modelo de seguridad RRHH

### 4.1 Principio
Toda autorización de documentos RRHH se expresa con **`has_permission()` (RBAC) + propiedad**
(`empleado.profile_id = auth.uid()`). **Prohibido** usar `current_role()` o cualquier valor de
`user_role_t` en la RLS de tablas/buckets RRHH.

### 4.2 RLS de tablas (conceptual)

```sql
-- LECTURA legajo: dueño o permiso RRHH (NUNCA current_role)
using (
  exists (select 1 from public.rrhh_empleados e
          where e.id = rrhh_documents.empleado_id and e.profile_id = auth.uid())
  or public.has_permission('rrhh:documento.read.all')
);

-- LECTURA recibos: dueño o permiso recibos
using (
  exists (select 1 from public.rrhh_empleados e
          where e.id = rrhh_receipts.empleado_id and e.profile_id = auth.uid())
  or public.has_permission('rrhh:recibo.read.all')
);

-- LECTURA salud (rrhh-health): permiso de salud o dueño; gating MÁS estricto
using (
  (owner) or public.has_permission('rrhh:licencia.salud.read')
);

-- ESCRITURA: solo permiso RRHH (NUNCA current_role)
with check ( public.has_permission('rrhh:documento.write' | 'rrhh:recibo.upload') );
```

### 4.3 Storage (cierre del bypass)
- Buckets `rrhh-*` **sin** policy de lectura para `authenticated` (a diferencia de `documents`).
- **Único camino de acceso:** RPC `emit_rrhh_signed_url(p_target, p_id)` `security definer` que:
  1. verifica `has_permission` **o** propiedad;
  2. registra la lectura en `rrhh_document_audit` (`view`/`download`);
  3. devuelve el *grant* `{bucket, path}` para que la app mintee el signed URL (modelo
     `emit_custody_signed_url`, `0037:12-14`).
- Sin URL persistente; expiración corta. El acceso directo a tabla/bucket queda cerrado.

### 4.4 Quién ve qué (resultado)

| Actor | Legajo | Recibos | Salud | Mecanismo |
|-------|--------|---------|-------|-----------|
| **Empleado** (`employee_self_service`) | solo lo suyo | solo los suyos | solo lo suyo | propiedad (`profile_id`) |
| **RRHH** (`rrhh_admin`) | total | total | total | `has_permission` |
| **RRHH** (`rrhh_manager`) | total | upload + lectura operativa | — (salvo grant) | `has_permission` |
| **Dirección** (`director_ops`/`rrhh_viewer`) | agregados/controlado | **no** individual | no | sin `rrhh:*.read.all` de PII |
| **Operaciones** | **sin acceso** | **sin acceso** | **sin acceso** | no tiene permisos `rrhh:*` |
| **Supervisor (jerárquico)** | datos laborales de su equipo (no PII) | **no** | no | `supervisor_id`, no doc PII |
| **Compliance** | — | — | excepción reglada + auditada | `rrhh:licencia.salud.read` temporal |

> `operaciones` y `supervisor` **no aparecen** en ninguna cláusula de las RLS RRHH → acceso nulo
> por defecto. Esto es lo opuesto a `documents`, donde están explícitamente habilitados.

---

## 5. Separación de dominios (explícita)

| Separación | Cómo queda garantizada |
|------------|------------------------|
| **Compliance ≠ RRHH** | Compliance audita (lee logs vía `rrhh:audit.read`); **no** accede a PII salvo excepción de salud reglada, temporal y auditada (§4.4). No comparten tablas de datos. |
| **Centro Documental ≠ Portal del Empleado** | Centro Documental opera sobre `documents` (operativo, roles legacy). Portal del Empleado opera sobre `rrhh_documents`/`rrhh_receipts` (RBAC+propiedad). Tablas, buckets y UIs **separados**; los recibos **no** son consultables desde el Centro Documental. |
| **Documentos Operativos ≠ Documentos Laborales** | Operativos (factura/remito/OC) → `documents`/bucket `documents`. Laborales (recibo/legajo/salud) → tablas/buckets `rrhh-*`. Sin solapamiento de almacén ni de policy. |

---

## 6. Impacto sobre v1.0 y v1.1

| Documento | Estado | Detalle |
|-----------|--------|---------|
| **v1.0** (`RRHH_ARCHITECTURE_DESIGN.md`) | **Parcialmente revalidado** | Su instinto de **bucket dedicado con RLS dueño-o-RRHH** era correcto; v1.2 lo retoma y lo endurece (RBAC, RPC de acceso, salud aislada). El resto de v1.0 sigue sujeto a v1.1 (M2–M6). |
| **v1.1** (`RRHH_ARCHITECTURE_ADDENDUM_V1_1.md`) | **M1 reemplazado · M2–M6 vigentes** | Se anula la reutilización de `documents`/bucket/`documents_audit`/`rrhh_empleado_documentos`. M2 (roles RBAC), M3 (roadmap), M4 (horas extra), M5 (ausentismo), M6 (workflow) **siguen vigentes**. |
| **v1.2** (este) | **Nuevo · vigente** | Define el almacén RRHH dedicado y el modelo de seguridad RBAC+propiedad. Prevalece sobre M1 de v1.1. |

### 6.1 Qué reemplaza v1.2 (puntual)
- ❌ Elimina: `rrhh_empleado_documentos` (vínculo a `documents`), uso de bucket `documents`, uso de
  `documents_audit`, recibos en `documents`, extensión de `document_type_t`.
- ✅ Introduce: `rrhh_documents`, `rrhh_receipts`, `rrhh_document_audit`, buckets `rrhh-receipts`/
  `rrhh-legajo`/`rrhh-health`, RPC `emit_rrhh_signed_url`, RLS RBAC+propiedad.

### 6.2 Roadmap — ajuste de la migración de storage
La migración `0061` (v1.1: "storage integration sobre `documents`") se redefine:
```
0061_rrhh_storage   -- buckets privados rrhh-receipts/rrhh-legajo/rrhh-health;
                    -- tablas rrhh_documents/rrhh_receipts/rrhh_document_audit;
                    -- RLS RBAC+propiedad; RPC emit_rrhh_signed_url; retención.
```
Sigue siendo monotónico (`0056`→`0061`); ya **no** requiere `ALTER TYPE document_type_t`
(usa `doc_class` propio). El gate R8 pasa a usar el almacén dedicado.

---

## 7. Preparación para la auditoría final (checklist verificable)

La próxima auditoría debe poder responder con evidencia objetiva:

| Pregunta | Respuesta esperada | Cómo verificar |
|----------|--------------------|----------------|
| ¿Existe fuga de PII? | **No** | Ninguna RLS RRHH menciona `current_role()`/`operaciones`/`supervisor`; recibos no están en `documents` |
| ¿Existe bypass de RLS? | **No** | Buckets `rrhh-*` sin policy de lectura `authenticated`; acceso solo vía `emit_rrhh_signed_url` (audita) |
| ¿Existe colisión RBAC? | **No** | Roles RRHH son filas en `roles` (no `user_role_t`); permisos `rrhh:*`; sin rol `supervisor` |
| ¿Exposición desde Centro Documental? | **No** | `listDocs()` consulta `documents`; recibos/legajo viven en tablas `rrhh_*` separadas |
| ¿Acceso indebido de Operaciones? | **No** | `operaciones` no tiene permisos `rrhh:*` ni aparece en RLS RRHH → acceso nulo |
| ¿Auditoría de acceso a PII? | **Sí** | Toda lectura pasa por RPC que inserta en `rrhh_document_audit` (append-only) |
| ¿Dato de salud aislado? | **Sí** | Bucket `rrhh-health` + permiso `rrhh:licencia.salud.read` + gating estricto |
| ¿Derecho de supresión (Ley 25.326)? | **Sí (modelo)** | Flag `redacted` + soft-delete + retención (`retention_until`) |

---

## 8. Veredicto del addendum

> ## `READY FOR FINAL RE-AUDIT`

v1.2 elimina la causa raíz de H-C1 y H-M1: los documentos laborales privados dejan de vivir en la
infraestructura legacy de lectura amplia y pasan a un almacén dedicado gobernado **solo** por RBAC
+ propiedad, con acceso por RPC auditada. Mantiene la reutilización **útil** (código puro,
patrones) sin reutilizar **capas de seguridad incompatibles**.

Este addendum **no** se auto-otorga `ARCHITECTURE READY`: ese sello lo emite la auditoría final
verificando el checklist del §7 contra el diseño consolidado. Restan cerrar los **menores** de la
auditoría de cierre (approve_l1 a jefes de línea, turnos rotativos en `rrhh_jornada`, etiqueta de
dependencia R3, semántica `cantidad_dias` en horas extra, estado de entrada de OT por supervisor),
ninguno bloqueante.

---

*Fin del addendum v1.2. Documental — no se implementó, no se migró, no se tocó producción, sin commit.*
*Próximo paso sugerido: auditoría final contra el checklist §7 (requiere ejecución explícita).*

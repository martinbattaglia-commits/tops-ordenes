# TOPS NEXUS — DOCUMENTS ENTERPRISE · VALIDATION REPORT (Fase 3)

> **Estado:** ✅ **DOCUMENTS ENTERPRISE VALIDADO EN STAGING AISLADO** · **Fecha:** 2026-05-29
> Valida el subsistema documental (`0010`): documentos, auditoría, buckets, storage, permisos,
> trazabilidad y modelo de signed URLs sobre `tops-nexus-staging` (`vrxosunxlhohmqymxots`).
> **Producción intacta.** Evidencia verificada con `psql`, no asumida.

---

## 0. Alcance

Subsistema `0010_documents_enterprise`: tablas `documents` + `documents_audit`, 5 triggers,
bucket privado `documents` con scoping por path, 5 permisos documentales y RLS multi-tenant.

---

## 1. Modelo de datos `documents` (verificado)

- **Campos obligatorios** (NOT NULL sin default): `title`, `storage_path`, `mime_type`.
- **Defaults clave:** `document_group_id=gen_random_uuid()`, `version=1`, `is_current=true`,
  `type='otro'`, `storage_bucket='documents'`, `file_size=0`, `source='upload'`, `tags='{}'`.
- **Soft-delete:** `deleted_at`, `deleted_by`.
- **Versionado:** `document_group_id` + `version` + `is_current` + `supersedes_id`.
- **IA/búsqueda:** `raw_text`, `extract`, `summary`, `ai_model`, `ai_tokens_used`, GIN fts/extract/tags.
- **16 índices** presentes (pkey, únicos de versionado/hash, btree por client/group/type/vendor/depot/docdate/expires, GIN, BRIN uploaded).

---

## 2. Triggers de negocio (5 — verificado)

| Trigger | Timing / Evento | Función | Garantía |
|---------|-----------------|---------|----------|
| `trg_documents_audit` | AFTER INSERT/UPDATE/DELETE | escribe en `documents_audit` | **Trazabilidad append-only** |
| `trg_documents_guard` | BEFORE UPDATE | bloquea mutación de contenido | **Inmutabilidad de contenido** |
| `trg_documents_version` | BEFORE INSERT | gestiona `is_current`/versión | **Integridad de versionado** |

> Validados funcionalmente en Fase 2: T4 (audit create), T7 (guard de contenido → "Documento inmutable: el contenido no se modifica. Subí una nueva versión."), T6 (versionado, único `is_current` por grupo, `unique_violation 23505`).

---

## 3. Auditoría y trazabilidad (`documents_audit`)

**Columnas (trazabilidad completa):**
`id, document_id, document_group_id, client_id, ts, user_id, action, ip, user_agent, detail`

→ Registra **quién** (`user_id`), **qué** (`action`, `detail`), **cuándo** (`ts`), **sobre qué** (`document_id`/`group`/`client_id`) y **desde dónde** (`ip`, `user_agent`).

**Estado tras batería + perf (verificado):**

| Acción | Filas | Origen |
|--------|------:|--------|
| `create` | 5005 | inserciones (fixtures + 5000 perf) — **una entrada por alta, generada por trigger** |
| `delete` | 1 | soft-delete de T5 (transición `deleted_at` null→not-null) |

**Append-only probado (T3):** INSERT directo en `documents_audit` como `authenticated` → **denegado por RLS**
("new row violates row-level security policy"). La auditoría **sólo** la escribe el trigger `SECURITY DEFINER`. No forjable.

---

## 4. Buckets y storage (verificado)

| Bucket | `public` | Rol |
|--------|:--------:|-----|
| `documents` | **false** (privado) | documentos del ERP — acceso sólo vía RLS / signed URL |
| `invoices` | **false** (privado) | PDFs fiscales |
| `attachments`, `po-signatures` | false | adjuntos / firmas |
| `pdfs`, `po-pdfs`, `signatures` | true | activos públicos (no sensibles) |

**16 policies en `storage.objects`.** Las 4 del bucket `documents`: read scoped (SELECT), write/update/delete internal.

### 4.1 Scoping por path del bucket `documents` (gold standard) — verificado

Policy `documents read scoped` (SELECT), expresión real:
```sql
bucket_id = 'documents' AND (
  current_role() = ANY (ARRAY['admin','operaciones','supervisor']::user_role_t[])
  OR split_part(name, '/', 1) = (SELECT client_id::text FROM profiles WHERE id = auth.uid())
)
```
→ **Interno** (admin/operaciones/supervisor) lee todo; **cliente B2B** sólo lee objetos cuyo **primer
segmento de path = su `client_id`**. Aislamiento multi-tenant a nivel de **objeto de storage**, no sólo de fila.

---

## 5. Signed URLs (modelo de seguridad)

> Las signed URLs se generan server-side (service role) en la capa de app; no se emiten por SQL. La **garantía a nivel de plataforma** validada aquí es:

1. **Bucket privado** (`public=false`) → **no hay acceso anónimo**; un objeto sólo se alcanza con request autenticado (sujeto a RLS) o con signed URL firmada por el backend.
2. **RLS de storage con scoping por path** (§4.1) → incluso autenticado, un cliente sólo puede listar/leer su propio prefijo.
3. **Patrón de path** `<client_id>/<año>/<mes>/<group>/<vN>.pdf` (verificado en fixtures) → habilita el `split_part(name,'/',1)=client_id`.

**Conclusión signed URLs:** el aislamiento no depende de la opacidad de la URL sino de **bucket privado + RLS + path tenant**. Modelo correcto para `documents`. ⚠️ El bucket `invoices` **no** replica este patrón (ver R4, §7).

---

## 6. Permisos documentales (módulo `documental`)

Módulo `documental` con **5 permisos** (verificado en `public.permissions`):
`documental.view`, `documental.create`, `documental.delete`, `documental.export`, `documental.admin`.

> Pertenecen al RBAC **granular** (`0009`), hoy **dormido** (`user_roles=0`). El enforcement documental
> efectivo HOY es el **modelo SIMPLE** (`profiles.role` + `current_role()`), que es exactamente lo que
> validan T1/T2/T5 y la policy de §4.1. (Detalle del estado RBAC en Fase 5.)

---

## 7. Hallazgos

| ID | Hallazgo | Severidad | Estado |
|----|----------|-----------|--------|
| **R4** | Bucket `invoices` SIN scoping por path (`auth.role()='authenticated'`), a diferencia de `documents` | 🟠 alto | Confirmado en Fase 2 §4. Corregir con patrón `documents` antes de exponer PDFs fiscales |
| **P-1** | Listado documental por `Seq Scan` a 5 k filas (~60 ms) | 🟡 medio | Índice parcial `(is_current,deleted_at,uploaded_at DESC)` en `0012+` |

> **Documents Enterprise (núcleo, bucket `documents`) NO presenta hallazgos bloqueantes.** R4 es del bucket fiscal `invoices` (0011), no del documental.

---

## 8. Veredicto Fase 3

> **✅ DOCUMENTS ENTERPRISE VALIDADO.** Tablas, versionado, auditoría append-only no forjable,
> inmutabilidad de contenido, soft-delete con visibilidad diferenciada, bucket privado con scoping
> por path y trazabilidad completa (quién/qué/cuándo/dónde) están **enforced en base de datos**.
> El gold-standard documental es **sólido y listo para producción** (pendiente sólo la aplicación
> autorizada de `0010` en prod). El bucket fiscal `invoices` debe alinearse a este patrón (R4).

---

## 9. ¿Acerca a reemplazar Neuralsoft?

**SÍ.** La gestión documental enterprise (versionado, auditoría inmutable, multi-tenant por storage) es
una capacidad que Neuralsoft no cubre con este rigor. Validada con evidencia y sin riesgo. El patrón de
`documents` es además la **plantilla** para cerrar R4 en `invoices` y endurecer `invoice_audit` (0012+).

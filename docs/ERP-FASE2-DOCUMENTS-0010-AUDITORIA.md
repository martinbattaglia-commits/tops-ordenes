# NEXUS ERP — FASE 2 · Módulo DOCUMENTS (0010) · Auditoría de Arquitectura

> **Modo:** ANÁLISIS · ARQUITECTURA · RIESGOS · PLANIFICACIÓN. **NO implementación.**
> **Sujeto:** `supabase/migrations/0010_documents.sql` (versionada, presente, **NO aplicada**).
> **Estado confirmado en DB:** `documents` NO existe · `document_type_t` NO existe ·
> bucket `documents` NO existe · Storage NO implementado.
> **Autor:** CTO / Principal Architect (modo gobernanza "NO ASUMIR. VERIFICAR.").
> **Fecha:** 2026-05-29.
> **Veredicto (adelantado):** ⛔ **0010 NO es apta para producción tal como está.
> Requiere modificaciones antes de aplicarse.** Detalle y plan abajo.

---

## 0. Resumen ejecutivo

`0010_documents.sql` es una migración **funcionalmente correcta para un MVP** (crea
enum, tabla, índices ricos incluyendo FTS en español, RLS básica, bucket y policy,
y `notify pgrst`). La app (`/documental`) ya está escrita contra ella y compila.

Pero **viola dos no-negociables del charter** y arrastra deuda de arquitectura que,
si se aplica tal cual, queda **soldada a producción** (un bucket público no se puede
"volver privado" sin romper las URLs ya emitidas; una tabla sin auditoría no se puede
auditar retroactivamente). Los dos bloqueantes:

1. **🔴 CRÍTICO — Bucket `documents` es PÚBLICO** (`public => true`) y aloja
   contratos, habilitaciones ANMAT, facturas y constancias AFIP. Cualquiera con la
   URL (no autenticado) lee el archivo. Contradice el patrón ya establecido en el
   propio repo: `attachments` (0003) y `invoices` (0011) son **privados**.
2. **🔴 CRÍTICO — RLS sin scoping multi-tenant.** `docs read auth` permite a
   **cualquier usuario autenticado** leer **todos** los documentos, incluidos los de
   otros clientes. Rompe el aislamiento por cliente que sí respetan `orders` y
   `customer_invoices` (`client_id = (select client_id from profiles where id=auth.uid())`).

Ambos son problemas de **confidencialidad de datos sensibles** (fiscales, sanitarios,
contractuales). Sumado a la **ausencia total de auditoría/inmutabilidad** (el charter
exige trazabilidad append-only para módulos documentales/fiscales), el módulo **no
puede ir a producción sin rediseño de seguridad y gobernanza**.

**Idempotencia:** ✅ correcta (ver §7, corrige un claim previo erróneo).

---

## 1. Diagnóstico técnico (qué crea 0010, verificado línea por línea)

### 1.1 Enum
- `document_type_t` (guard idempotente `do $ … exception when duplicate_object`):
  `factura, remito, contrato, habilitacion, certificado, auditoria, presupuesto,
  orden_compra, orden_servicio, constancia_afip, otro`.

### 1.2 Tabla `public.documents`
Columnas: `id uuid PK`, `type document_type_t not null default 'otro'`, `title text
not null`, `summary text`, `doc_date date`, `expires_at date`, `vendor_id → vendors
on delete set null`, `client_id → clients on delete set null`, `storage_bucket text
not null default 'attachments'`, `storage_path text not null`, `mime_type text not
null`, `file_size bigint default 0`, `file_hash text`, `extract jsonb`, `raw_text
text`, `tags text[] default '{}'`, `source text default 'upload'`, `uploaded_at
timestamptz default now()`, `uploaded_by → auth.users on delete set null`,
`ai_tokens_used int default 0`, `ai_model text`. **`UNIQUE(storage_bucket,
storage_path)`**.

### 1.3 Índices
`type`, `doc_date desc`, `vendor_id`, `client_id`, `expires_at` (partial `where
expires_at is not null`), `tags` (GIN), y **FTS GIN** sobre
`to_tsvector('spanish', coalesce(title,'')||' '||coalesce(summary,'')||' '||coalesce(raw_text,''))`.
→ Buena base de búsqueda.

### 1.4 RLS (4 policies)
- `docs read auth` — **SELECT: `auth.role() = 'authenticated'`** (sin scoping).
- `docs insert auth` — INSERT: authenticated.
- `docs update internal` — `current_role() in (admin, operaciones, supervisor)`.
- `docs delete admin` — `current_role() = 'admin'`.

### 1.5 Storage
- `insert into storage.buckets (id,name,public) values ('documents','documents',true)`
  → **público, sin `file_size_limit`, sin `allowed_mime_types`**.
- Policy `documents bucket internal write` = `for all` con `bucket_id='documents' and
  auth.role()='authenticated'` → cualquier autenticado puede **escribir y borrar**
  objetos del bucket (DELETE no restringido a admin a nivel storage).

### 1.6 App acoplada (verificado en código)
- `src/lib/documental/storage.ts`: sube a `.from("documents")` con `upsert:true` y
  devuelve **`getPublicUrl(path)`**. Calcula `fileHashSha256`.
- `src/app/(app)/documental/actions.ts`: inserta en `documents` con
  `storage_bucket = uploaded.bucket` (= `'documents'`, **≠** default `'attachments'`),
  guarda `file_hash` **pero nunca lo consulta** (no hay dedup real), devuelve
  `publicUrl` al cliente. OCR vía OpenAI; si OCR falla guarda igual como `'otro'`.

---

## 2. Problemas detectados (clasificados)

| # | Severidad | Problema | Evidencia |
|---|-----------|----------|-----------|
| P1 | 🔴 CRÍTICO | Bucket `documents` **público** con datos sensibles | `public => true`; contraste con `attachments`/`invoices` privados |
| P2 | 🔴 CRÍTICO | RLS SELECT sin scoping por cliente (fuga multi-tenant) | `docs read auth` = `auth.role()='authenticated'` |
| P3 | 🔴 CRÍTICO | **Sin auditoría / inmutabilidad / soft-delete / versionado** | no hay `documents_audit`, no hay trigger, DELETE físico | 
| P4 | 🟠 ALTO | Storage policy `for all` → cualquier autenticado **borra** objetos | policy única sin separar SELECT/INSERT/DELETE |
| P5 | 🟠 ALTO | RBAC granular ignorado: 0009 sembró `documental.view/create/delete` pero 0010 usa el enum legacy `current_role()` | `has_permission()` existe, no se usa |
| P6 | 🟠 ALTO | Sin `file_size_limit` ni `allowed_mime_types` en el bucket | 0003/0011 sí los definen |
| P7 | 🟡 MEDIO | `file_hash` sin índice ni unique → dedup imposible (y la app no lo consulta) | columna suelta |
| P8 | 🟡 MEDIO | `default storage_bucket='attachments'` ≠ bucket real `'documents'` | inconsistencia tabla↔código |
| P9 | 🟡 MEDIO | Sin columna de **sede/depósito** (multi-sede del charter) | no hay `depot_id`/`sede` |
| P10 | 🟢 BAJO | `source`, `mime_type`, `storage_bucket` texto libre sin CHECK/enum | data quality |
| P11 | 🟢 BAJO | `raw_text` completo en fila (la app trunca a 50k, la DB no obliga) | sin límite en DDL |

---

## 3. Riesgos

- **RP-DOC-PUBLIC (Confidencialidad, crítico):** una habilitación ANMAT o contrato
  con CUIT/datos personales queda accesible por URL sin auth. Riesgo legal (datos
  personales/fiscales) y reputacional. **Irreversible una vez emitidas URLs públicas.**
- **RP-DOC-TENANT (Aislamiento, crítico):** un usuario `cliente` autenticado podría
  leer documentos de otro cliente vía PostgREST. Rompe el modelo de portal B2B.
- **RP-DOC-AUDIT (Cumplimiento, crítico):** sin append-only ni inmutabilidad, no hay
  trazabilidad de quién vio/borró un documento fiscal/sanitario → incompatible con el
  no-negociable de auditoría y con una futura inspección ANMAT/AFIP.
- **RP-DOC-DELETE (Integridad, alto):** DELETE físico + storage `for all` permite que
  un operador elimine evidencia sin rastro.
- **RP-DOC-LOCKIN (Arquitectura, alto):** aplicar el bucket público hoy obliga a
  migración de datos + reemisión de URLs mañana. El costo de corregir crece con el uso.

---

## 4. Dependencias

- **Presentes y OK:** `vendors`, `clients`, `profiles.client_id`, `auth.users`,
  `current_role()` (0001/0005), `has_permission()` + módulo `documental` sembrado
  (0009), extensión FTS español (nativa). Storage schema (Supabase nativo).
- **Faltantes para hacerlo enterprise:** tabla de auditoría documental; (opcional)
  tabla `depots/sedes` si se quiere FK fuerte para multi-sede.
- **Orden:** 0010 depende de 0009 (RBAC granular) si se decide adoptar `has_permission`.
  No depende de 0011.

---

## 5. Impacto sobre módulos existentes

| Módulo | Impacto |
|--------|---------|
| **Órdenes (`orders`)** | Ninguno directo; futura relación documento↔orden vía `tags`/`extract` (no hay FK). Oportunidad: `order_id` opcional. |
| **Compras (`vendors`/PO)** | `vendor_id` FK ya previsto. Documentos de proveedor (facturas/remitos) encajan. |
| **Drive / Firmas (0003 signatures, 0008 po-signatures)** | 0010 NO reutiliza buckets de firmas; crea uno nuevo. Riesgo de fragmentación de storage. |
| **ANMAT** | Habilitaciones/certificados con `expires_at` → base para alertas de vencimiento (el índice parcial ya lo soporta). **Pero requieren confidencialidad → choca con bucket público.** |
| **CCTV** | Sin relación. |
| **Facturación futura (0011 ARCA)** | `customer_invoices` ya tiene su propio PDF privado. Documentos AFIP entrantes (`constancia_afip`) encajan en 0010 → **deben ser privados igual que invoices**. |
| **Multi-tenant (portal cliente)** | 0010 **rompe** el aislamiento que 0011/orders respetan. |

---

## 6. Recomendaciones de arquitectura (rediseño propuesto, NO aplicado)

### 6.1 Bloqueantes (obligatorios antes de producción)
1. **Bucket privado.** `public => false`. Servir con **signed URLs** (como invoices).
   Ajustar `storage.ts` para `createSignedUrl` en vez de `getPublicUrl`.
2. **RLS con scoping multi-tenant.** Reescribir `docs read auth`:
   - interno (admin/operaciones/supervisor): ve todo;
   - `cliente`: `client_id = (select client_id from profiles where id = auth.uid())`.
3. **Auditoría append-only + inmutabilidad.** Crear `documents_audit` (bigserial,
   document_id, ts, user_id, action, ip, detail jsonb) + soft-delete (`deleted_at`,
   `deleted_by`) en lugar de DELETE físico. Trigger que registre INSERT/UPDATE/DELETE.
4. **Storage policy granular.** Separar SELECT/INSERT de DELETE; DELETE solo admin.
5. **`file_size_limit` + `allowed_mime_types`** en el bucket (PDF + imágenes).

### 6.2 Recomendadas (deuda a corto plazo)
6. **Adoptar RBAC granular**: usar `has_permission('documental.view/create/delete')`
   en vez del enum legacy, para alinear con 0009 y permitir permisos finos.
7. **Índice/unique en `file_hash`** (o `unique(client_id, file_hash)`) + consulta de
   dedup en la app.
8. **Corregir default** `storage_bucket` a `'documents'` (o quitar default y forzar).
9. **Columna `depot_id`/`sede`** (nullable) para multi-sede y futura FK.
10. **Versionado de documentos** (`supersedes_id` / `version int`) para reemplazos de
    habilitaciones renovadas sin perder histórico.

### 6.3 Mejoras sugeridas (largo plazo / escala 10 años)
- Particionado por rango (`uploaded_at`) o por `client_id` cuando se acerque a millones
  de filas; `raw_text` a tabla satélite para no inflar el heap de `documents`.
- Política de retención/archivado (storage class) para documentos vencidos.
- `extract jsonb` con `jsonb_path_ops` GIN si se consulta por campos del extract.

---

## 7. Corrección de un hallazgo previo (honestidad de auditoría)

Documentos de FASE 0/1.5 afirmaban un riesgo **RP-IDEMP**: que 0008/0009/0010/0011
crean enums "sin guard" y que re-ejecutar rompería con *type already exists*.
**Verificado: ese claim es FALSO.** Las cuatro migraciones envuelven cada `create
type` en `do $ begin … exception when duplicate_object then null; end $;`. **0010 es
idempotente.** Se deja constancia y debe corregirse en los docs que lo afirmaban
(acción de seguimiento, no parte del PROHIBIDO de FASE 2).

---

## 8. Estrategia de implementación (cuando se autorice FASE 2 build)

**No modificar 0010 in-place si se prefiere trazabilidad de migraciones.** Dos caminos:

- **Opción A (recomendada) — reescribir 0010 antes de aplicar** (sigue sin estar en
  prod, así que no rompe historial): incorporar §6.1 (1–5) + §6.2 (6–8). Es la
  oportunidad de aplicarla "bien la primera vez".
- **Opción B — 0010 mínima + 0012 de endurecimiento:** aplicar 0010 corregida solo en
  lo crítico y dejar mejoras para una 0012. Mayor riesgo de ventana insegura.

Pasos (Opción A): editar SQL → revisar en staging/SQL Editor sobre rama → aplicar en
prod **solo con GATE explícito** → ajustar `storage.ts` a signed URLs → smoke test
`/documental` (upload, OCR, listado con scoping por rol) → merge `docs`/feature→main.

**Pre-requisito de código:** cambiar `getPublicUrl` → `createSignedUrl` y la lectura
del listado para pasar por signed URL. Sin esto, bucket privado rompe la UI.

---

## 9. Estrategia de rollback

- **Antes de aplicar:** trivial — la migración no está en prod; basta no aplicarla.
- **Si se aplicó y hay que revertir (sin datos productivos):** `drop table public.documents
  cascade; drop type document_type_t; delete from storage.buckets where id='documents';`
  + revertir `schema_migrations`. Restaurar `storage.ts` a estado previo.
- **Si ya hay documentos cargados:** NO hacer drop. Migrar objetos a bucket privado,
  reemitir URLs firmadas, backfill de `documents_audit`, luego endurecer RLS. Por eso
  **conviene aplicarla endurecida desde el día 1** (evita este rollback caro).
- **Restore point Supabase** obligatorio antes de cualquier `apply`.

---

## 10. Veredicto OBLIGATORIO

⛔ **0010 NO puede aplicarse tal como está.** **Requiere modificaciones antes de
producción.**

**Motivo:** viola dos no-negociables (confidencialidad multi-tenant y auditoría/
inmutabilidad) y crea un bucket público de documentos sensibles cuyo error es
**irreversible una vez en uso**. Los cambios bloqueantes son acotados (§6.1, 5 ítems)
y la migración aún no está aplicada, por lo que corregirla ahora tiene **costo bajo y
beneficio alto**. Recomendación: **Opción A — reescribir 0010 endurecida** y recién
entonces solicitar GATE de aplicación.

**Idempotencia y estructura base: correctas.** El problema es de **seguridad y
gobernanza de datos**, no de sintaxis.

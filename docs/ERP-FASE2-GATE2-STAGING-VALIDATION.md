# NEXUS ERP LOGÍSTICA TOPS — FASE 2 · MÓDULO DOCUMENTS

## GATE 2 — STAGING VALIDATION

> **Estado del entregable:** 🟡 **BLOQUEADO POR ENTORNO — VALIDACIÓN EN VIVO PENDIENTE DE EJECUCIÓN.**
> Este documento contiene (a) el diagnóstico del entorno, (b) un **desk-check estático** riguroso del SQL endurecido `0010_documents.sql` (lógica, dependencias, orden, RLS, triggers, storage), y (c) un **playbook llave-en-mano** para ejecutar la batería completa en cuanto exista un Staging aislado.
> **NO contiene resultados de ejecución en vivo, métricas reales ni evidencia capturada**, porque el entorno actual NO permite ejecutarlos de forma fiel ni segura (ver §0). Conforme a la regla del propio GATE — *"Ante cualquier hallazgo crítico: DETENERSE. DOCUMENTAR. NO CONTINUAR SIN APROBACIÓN EXPLÍCITA"* — se detuvo la ejecución y se documentó el bloqueante.

- **Fecha:** 2026-05-29
- **Rama:** `feature/documents-enterprise-ready` · HEAD `5cf6a44`
- **Migración bajo prueba:** `supabase/migrations/0010_documents.sql` (ENTERPRISE HARDENED, remediado en GATE 1C)
- **Roles del revisor:** CTO · Enterprise ERP Architect · Principal DBA · Principal Security Architect · Principal Software Architect · Principal DevOps · Principal QA · Principal AppSec

---

## 0. Diagnóstico — por qué la ejecución en vivo está bloqueada

GATE 2 exige un **entorno Staging aislado** donde aplicar `0010`, crear el bucket y correr la batería funcional/seguridad/performance. El entorno de trabajo actual **no puede satisfacer eso de forma fiel ni segura**:

| Componente | Estado verificado | Implicancia para GATE 2 |
|---|---|---|
| Supabase CLI | `2.101.0` ✅ instalado | Puede crear proyectos / aplicar migraciones |
| **Docker** | ❌ `command not found` | **No hay stack local** (`supabase start` imposible) |
| **psql** | ❌ `command not found` | **No se puede correr SQL** contra ninguna DB (ni el test `0010_..._versioning_test.sql`) |
| CLI link actual | 🔴 `arsksytgdnzukbmfgkju` = **`tops-ordenes-prod` (PRODUCCIÓN)** | Cualquier `db push`/`db execute` impactaría **PRODUCCIÓN**. PROHIBIDO por el gate. |
| `supabase/config.toml` | ❌ inexistente | No hay configuración de stack local declarada |
| `SUPABASE_ACCESS_TOKEN` | presente en entorno | Permitiría `projects create`, pero **provisiona infraestructura facturable** → requiere autorización explícita |

### Conclusión del diagnóstico
No es posible **aplicar `0010`**, **crear el bucket**, **correr el versioning test**, **simular multi-tenant con 3 clientes**, **medir performance a 100/500/1000/5000 docs** ni **probar rollback** sin uno de estos tres habilitadores:

- **(A)** un proyecto Supabase **Staging** aislado (facturable) → decisión de negocio, **requiere aprobación explícita** (org/región/budget),
- **(B)** un `DATABASE_URL`/connection-string de un Staging **ya existente y separado de producción**, o
- **(C)** **Docker instalado localmente** para levantar un stack `supabase start` efímero y gratuito.

El revisor **NO** provisiona infraestructura facturable de forma unilateral, **NO** ejecuta comandos mutantes contra el CLI apuntado a producción, y **NO** fabrica resultados de validación. Por eso, la batería en vivo queda **PENDIENTE** y este documento entrega el desk-check estático + el playbook exacto.

---

## 1. Hallazgo crítico de proceso — "Aplicar únicamente 0010" no es literal

GATE 2 autoriza *"Aplicar únicamente 0010_documents.sql"*. El desk-check de dependencias demuestra que **`0010` NO es auto-contenido**: depende de objetos creados en migraciones previas. Aplicarlo sobre una base vacía **fallaría**.

| Objeto que `0010` referencia | Definido en | Tipo de dependencia |
|---|---|---|
| `public.clients(id)` | `0001_init.sql:38` | FK `documents.client_id` |
| `public.vendors(id)` | `0008_purchase_orders.sql:39` | FK `documents.vendor_id` |
| `depot_t` (enum) | `0001_init.sql:9` | columna `documents.depot` |
| `public.current_role()` | `0001` + endurecida en `0005_fix_rls_recursion.sql:23` | usada en TODAS las RLS + en `log_document_event` |
| `public.profiles(id, client_id, role)` | `0001_init.sql:26` | scoping multi-tenant en RLS y funciones |
| `public.permissions / roles / role_permissions` | `0009_rbac.sql:42/54/82` | seeds RBAC §9 |
| `auth.users`, `storage.buckets`, `storage.objects`, `pg_publication` | Supabase nativo | FKs, bucket, policies, realtime |

**Interpretación operativa correcta para el playbook:** sembrar **baseline `0001`→`0009`** (prerequisitos) y luego aplicar **`0010` como unidad bajo prueba**, **excluyendo `0011` (ARCA), `0012` (Proveedores)** y futuras. Esto respeta el espíritu del gate ("nada más allá de 0010") sin violar las dependencias reales. Documentado aquí porque ejecutar "solo 0010" sin baseline produce un falso negativo.

---

## 2. Evidencia — desk-check estático del SQL endurecido

> Verificación de **corrección lógica, orden y dependencias** del código fuente (no es prueba en vivo). Numeración según secciones de `0010_documents.sql`.

### 2.1 Versionado (P5) — núcleo del fix C-1
- `tg_documents_version()` es **BEFORE INSERT** (líneas 177-207). ✅ Correcto: el índice parcial `documents_current_uq` (línea 127, `unique(document_group_id) where is_current`) es *immediate/non-deferrable*; un AFTER INSERT chocaría `23505` antes de poder degradar la versión previa. BEFORE INSERT degrada **antes** de escribir.
- Hereda `document_group_id` del predecesor (`select … where id = new.supersedes_id for update`, líneas 184-191). ✅ Cierra B-1: las versiones nunca cruzan de grupo.
- `new.version := coalesce(max(version),0)+1` sobre el grupo (líneas 193-194). ✅ Monotónico, sin huecos por carrera.
- `for update` sobre la fila predecesora (línea 187). ✅ Serializa inserciones concurrentes del mismo grupo → no quedan dos `is_current`.
- Degradación: `update … set is_current=false where document_group_id=v_group and is_current` (líneas 197-199). ✅ Ejecuta **dentro de la misma transacción, antes** del INSERT de la nueva fila.
- **Riesgo residual a probar en vivo:** carrera de dos `INSERT` simultáneos con el **mismo `supersedes_id`**. El `for update` sobre el predecesor debería serializarlos; **requiere prueba de concurrencia real** (no demostrable en estático).

### 2.2 Auditoría (P3) — append-only
- `documents_audit` sin policy de INSERT/UPDATE/DELETE (la permisiva `"documents_audit insert auth"` fue **eliminada**, líneas 348-355). ✅ A-2 cerrado.
- Escritura **exclusiva** por funciones `SECURITY DEFINER`: `tg_documents_audit()` (persistencia, líneas 265-304) y `log_document_event()` (acceso, líneas 213-254). ✅
- `tg_documents_audit()` es **AFTER INSERT/UPDATE/DELETE** y distingue `create` / `delete` (hard) / soft-`delete` / `restore` / `update` por transición de `deleted_at` (líneas 269-298). ✅ Coherente con el ciclo de vida.
- `log_document_event()` **valida acceso del llamante** antes de registrar (líneas 237-245): `current_role()` + `profiles.client_id`, rechaza si rol nulo o si cliente externo no coincide. ✅ A-2 cerrado (no se puede contaminar bitácora ajena).
- `documents_audit.document_group_id` y `client_id` son snapshots (líneas 136-137) → la bitácora **sobrevive** al borrado físico de la fila. ✅
- **A probar en vivo:** que `auth.uid()` se resuelva correctamente dentro del trigger SECURITY DEFINER bajo sesión de usuario real (en service-role será `null`, esperado).

### 2.3 Soft-delete (P4)
- `documents update internal` permite a internos setear `deleted_at/deleted_by`; el trigger `tg_documents_guard()` bloquea cambios de **contenido** (path/hash/size/bucket, líneas 152-163) pero **permite** metadata. ✅
- Lectura oculta soft-deleted salvo admin: `(deleted_at is null or current_role()='admin')` (línea 317). ✅
- **A probar en vivo:** restore (`deleted_at` → null) re-aparece para no-admin y emite audit `restore`.

### 2.4 Signed URLs (P1) — capa app
- Bucket `public=false` (línea 362), `file_size_limit=26214400` (25 MiB), `allowed_mime_types` = pdf/png/jpeg/webp/tiff (línea 363). ✅
- `getSignedUrl()` (`storage.ts`) usa `createSignedUrl`, TTL 300 s; no hay URLs públicas. ✅
- **A probar en vivo:** (a) URL firmada abre el objeto; (b) expira a los 300 s; (c) acceso directo al objeto **sin** firma es denegado por las policies de `storage.objects`.

### 2.5 MIME validation
- **Doble barrera:** check constraint en `documents.mime_type` (líneas 76-79) **y** `allowed_mime_types` del bucket (línea 363) **y** `ALLOWED_MIME` en `actions.ts` (capa app). ✅ SVG/GIF/HEIC deben fallar en las tres.
- **A probar en vivo:** subir SVG/GIF/HEIC → rechazo (idealmente en la capa app, con mensaje claro; el bucket y el constraint son la red de seguridad).

### 2.6 Multi-tenant (P2)
- Tabla: `client_id = (select client_id from profiles where id=auth.uid())` para clientes; internos ven todo (líneas 316-322). ✅
- **Storage (A-3):** `split_part(name,'/',1) = profiles.client_id::text` (líneas 382-390). ✅ Aislamiento al nivel del objeto, no solo de la fila. Coherente con `buildDocPath()` = `{client_id|_global}/yyyy/mm/group/v…`.
- **A probar en vivo:** Cliente A no ve filas **ni objetos** de B/C, y viceversa (matriz A↔B↔C).

### 2.7 Storage policies
- SELECT scoped (líneas 382-390), INSERT/UPDATE solo internos (líneas 395-409), DELETE solo admin (líneas 413-415). El `for all` peligroso del 0010 original quedó **separado** por operación. ✅
- Upload de la app vía **service-role** (`createAdminClient`) → bypassa RLS, no rompe el alta. ✅

### 2.8 RBAC (P7)
- Seeds `documental.export` + `documental.admin` a `compliance` y `admin` (líneas 422-437), `on conflict do nothing`. ✅ Reconciliado con `permission_action_t`. RBAC granular dormido (user_roles=0) → no altera el acceso actual basado en `role`.

### 2.9 Idempotencia / re-ejecución
- Enums con guard `duplicate_object` (§1), `create table if not exists`, `create index if not exists`, `create or replace function`, `drop policy if exists` antes de cada `create policy`, bucket `on conflict do update`. ✅ La migración es **re-aplicable** sin error.

---

## 3. Hallazgos

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| P-1 | 🔴 Crítico (proceso) | El entorno actual no permite ejecutar la validación en vivo (sin Docker, sin psql, CLI→producción). | **BLOQUEANTE — requiere decisión de entorno** |
| P-2 | 🟠 Alto (proceso) | "Aplicar únicamente 0010" es inviable: depende de 0001–0009. El playbook siembra baseline + 0010, excluye 0011/0012. | Documentado; mitigado en playbook |
| D-1 | 🟡 Medio | Carrera de versiones con mismo `supersedes_id` confía en `for update`; **no demostrable en estático**. | Requiere test de concurrencia (incluido en playbook §5.1) |
| D-2 | 🟢 Bajo | `auth.uid()` dentro de triggers SECURITY DEFINER será `null` bajo service-role (esperado); validar bajo sesión de usuario. | A confirmar en vivo |
| — | ✅ | Críticos/Altos de **código** (C-1, A-1, A-2, A-3) ya cerrados en GATE 1C y verificados en desk-check. | OK |

> **No se reportan hallazgos críticos/altos de *código*** en el desk-check estático. El único crítico es **de proceso/entorno** (P-1).

---

## 4. Performance — PENDIENTE (no ejecutable en estático)

No hay métricas reales. El playbook (§5.5) carga 100/500/1000/5000 docs y mide:
- Búsqueda FTS (`documents_fts_gin`) — `explain analyze` sobre `to_tsvector('spanish', …)`.
- Filtro por tenant + estado (`documents_client_idx`, `documents_current_uq`).
- Rango temporal (`documents_uploaded_brin`) a 5000+ filas.
- Dedup hash (`documents_hash_uq`).
**Criterio de aceptación:** consultas de listado p95 < 200 ms a 5000 docs con índices presentes; ningún `Seq Scan` en los caminos indexados.

---

## 5. Playbook llave-en-mano (ejecutar en Staging aislado)

> Pre-requisito: resolver la decisión de entorno (§7). Todos los comandos asumen `SUPABASE_DB_URL` apuntando a **STAGING**, NUNCA a producción.

### 5.0 Provisión + baseline
```bash
# Opción A (cloud staging): crear proyecto aislado (requiere aprobación)
#   supabase projects create tops-nexus-staging --org <ORG> --region sa-east-1 --db-password <PWD>
# Opción B: exportar el connection-string del staging existente
#   export SUPABASE_DB_URL="postgresql://...staging..."
# Opción C (local): requiere Docker
#   supabase start   # luego usar la DB_URL local que imprime

# Baseline 0001..0009 (prerequisitos de 0010), excluyendo 0011/0012:
for f in 0001 0002 0003 0004 0005 0006 0007 0008 0009; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/${f}_*.sql
done
# Unidad bajo prueba:
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0010_documents.sql
```

### 5.1 Versionado (incluye test ya escrito + concurrencia)
```bash
# Test transaccional ya versionado (v1→v2→v3, una sola is_current):
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0010_documents_versioning_test.sql
# Concurrencia (D-1): dos sesiones insertando con el MISMO supersedes_id deben serializarse.
#   Abrir 2 psql, BEGIN en ambas, insertar v2 con supersedes_id=<v1> → la 2da espera el FOR UPDATE.
#   Verificar al final: count(*) where is_current = 1.
```

### 5.2 Auditoría
- INSERT/UPDATE(soft-delete)/UPDATE(restore)/DELETE → verificar filas `documents_audit` con `action` create/delete/restore/delete(hard).
- `select log_document_event(<doc>, 'download')` bajo sesión de **cliente ajeno** → debe **RAISE 'Acceso denegado'**.
- Intentar `insert into documents_audit …` como `authenticated` → debe fallar (sin policy de insert).

### 5.3 Soft-delete + signed URLs
- Soft-delete y verificar invisibilidad para no-admin; restore y reaparición.
- `createSignedUrl` (TTL 300) abre; tras expirar, 400/403; acceso directo sin firma → denegado.

### 5.4 Multi-tenant + storage (clientes A/B/C)
- Crear 3 clients + 3 profiles `role='cliente'`. Subir 2 docs por tenant a `{client_id}/…`.
- Bajo cada sesión cliente: `select` solo ve lo propio (tabla **y** `storage.objects` vía `split_part`).
- Intento cross-tenant (cliente A pide objeto de B) → 0 filas / denegado.

### 5.5 Performance (100/500/1000/5000)
```sql
-- generar N docs y medir
explain analyze select * from documents where client_id=$1 and is_current order by uploaded_at desc limit 50;
explain analyze select * from documents where to_tsvector('spanish', coalesce(title,'')||' '||coalesce(raw_text,'')) @@ plainto_tsquery('spanish','factura');
explain analyze select * from documents where uploaded_at >= now()-interval '7 days';
```

### 5.6 RBAC (admin/operaciones/supervisor/cliente)
- Matriz: insert (solo internos), update/soft-delete (internos), delete físico (solo admin), lectura audit (admin/supervisor).

### 5.7 Seguridad (atacante)
- Forzar lectura cross-tenant por tabla y por storage path predecible.
- Forjar entrada de auditoría (debe fallar).
- Editar contenido (path/hash) vía UPDATE → `tg_documents_guard` debe RAISE.
- Saltar versionado insertando `is_current=true` manual a un grupo existente → segundo current debe chocar `documents_current_uq` (23505).

### 5.8 Rollback
```sql
-- Rollback de 0010 (orden inverso): triggers→functions→policies→tablas→bucket→enums.
drop trigger if exists trg_documents_audit on public.documents;
drop trigger if exists trg_documents_version on public.documents;
drop trigger if exists trg_documents_guard on public.documents;
drop function if exists public.tg_documents_audit(), public.tg_documents_version(),
  public.tg_documents_guard(), public.log_document_event(uuid,document_audit_action_t,text,text,jsonb);
-- (policies de documents/documents_audit/storage.objects)…
drop table if exists public.documents_audit;
drop table if exists public.documents;
delete from storage.buckets where id='documents';
drop type if exists document_source_t; drop type if exists document_audit_action_t; drop type if exists document_type_t;
```
**Criterio:** rollback deja la DB en estado pre-0010 sin objetos huérfanos; el bucket y sus objetos se eliminan; baseline 0001–0009 intacto.

---

## 6. Resumen por sección requerida

| Sección del gate | Estado | Nota |
|---|---|---|
| Diagnóstico | ✅ | §0 — entorno bloqueante caracterizado |
| Evidencia | ⚠️ Estática | §2 — desk-check de código; **sin ejecución en vivo** |
| Riesgos | ✅ | P-1/P-2/D-1/D-2 |
| Hallazgos | ✅ | §3 — sin críticos/altos de *código* |
| Performance | ⛔ Pendiente | §4 — no ejecutable sin DB |
| Seguridad | ⚠️ Estática | §2.2/2.6/2.7 OK en diseño; ataques reales pendientes (§5.7) |
| Multi-Tenant | ⚠️ Estática | §2.6 OK en diseño; matriz A/B/C pendiente (§5.4) |
| Auditoría | ⚠️ Estática | §2.2 OK en diseño; ciclo real pendiente (§5.2) |
| Rollback | ✅ Definido | §5.8 — procedimiento listo, ejecución pendiente |
| Recomendación | ✅ | §7 |

---

## 7. Recomendación profesional

1. **El código (`0010` + capa app) supera el desk-check estático**: los críticos/altos de GATE 1B/1C (C-1, A-1, A-2, A-3) están cerrados y verificados sobre el fuente. No hay hallazgos críticos/altos **de código**.
2. **GATE 2 NO puede cerrarse con esta evidencia.** Su criterio de éxito exige *ejecución real* de multi-tenant, auditoría, versionado, signed URLs, performance y rollback. Eso está **bloqueado por entorno** (P-1) y no se fabrica.
3. **Decisión requerida (entorno de Staging)** — una de:
   - **(A)** Autorizar provisión de proyecto Supabase **Staging facturable** (definir org/región/budget). El revisor lo crea, siembra baseline 0001–0009 + 0010 y corre el playbook.
   - **(B)** Proveer un **`DATABASE_URL` de Staging** ya existente y aislado de producción.
   - **(C)** **Instalar Docker** para `supabase start` local (gratuito, efímero) y correr el playbook ahí.
4. Hasta entonces, este artefacto queda como **constancia del bloqueo + plan de ejecución exacto**. Producción **no** debe habilitarse.

---

## VEREDICTO FINAL

**¿Documents Enterprise Ready puede pasar a Producción? → NO (todavía).**

**Fundamento técnico:** el módulo está **correcto en diseño y código** (desk-check estático sin hallazgos críticos/altos; remediación GATE 1C verificada), **pero el criterio de aprobación de GATE 2 exige validación ejecutada en Staging** (multi-tenant, auditoría, versionado, signed URLs, performance, rollback), y esa ejecución está **bloqueada por el entorno** (sin Docker, sin psql, CLI apuntado a producción). No se certifica Producción sobre evidencia estática ni se fabrican resultados. **El veredicto pasará a "SÍ / SÍ CON CONDICIONES" únicamente tras correr el playbook (§5) en un Staging aislado.** Se requiere **aprobación explícita** de la opción de entorno (A/B/C) para continuar.

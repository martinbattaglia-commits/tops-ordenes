# TOPS NEXUS — GATE 2 · EVIDENCE REPORT (Fase 2)

> **Estado:** ✅ **GATE 2 EJECUTADO EN STAGING AISLADO — TODA LA BATERÍA EN VERDE** · **Fecha:** 2026-05-29
> Ejecución de `GATE-2-EXECUTION-PLAN.md` sobre `tops-nexus-staging` (`vrxosunxlhohmqymxots`).
> **Producción (`arsksytgdnzukbmfgkju`) intacta — no se ejecutó ningún comando mutante contra prod.**
> Evidencia registrada por paso, no asumida. Cliente: `psql 18.4` (libpq) vía pooler session mode (5432).

---

## 0. Guard de aislamiento (antes de CADA comando mutante)

```
REF="$(cat supabase/.temp/project-ref)"   # → vrxosunxlhohmqymxots
test "$REF" != "arsksytgdnzukbmfgkju"      # PROD ref — aborta si coincide
```
Verificado en cada corrida: `GUARD OK ref=vrxosunxlhohmqymxots`. Ningún comando tocó prod.

---

## 1. Aplicación de migraciones (baseline → 0010 → 0011)

| Paso | Acción | Resultado | Evidencia |
|------|--------|-----------|-----------|
| Baseline | Aplicar `0001`→`0009` en orden sobre DB vacía | ✅ rc=0 | 23 tablas base tras baseline |
| 0010 | Aplicar `0010_documents_enterprise.sql` | ✅ rc=0 | tablas `documents`+`documents_audit`, 3 triggers de negocio, bucket `documents` privado, 5 permisos documentales |
| 0011 | Aplicar `0011_arca_billing.sql` | ✅ rc=0 | `fiscal_config`, `puntos_venta`, `customer_invoices`, `invoice_items`, `invoice_audit`, trigger `customer_invoices_lock`, bucket `invoices` privado |
| Test versionado | `0010_documents_versioning_test.sql` | ✅ PASS | "PASÓ C-1: v1->v2->v3 con una ÚNICA versión actual (v3, version=3)" |

> **Nota de método:** en staging fresco se aplicó vía `psql -f` (no por tracking de `supabase_migrations`), apropiado para validación aislada. El **orden y la idempotencia** del plan se respetaron sin improvisar.

### Estado final del esquema (verificado)

| Métrica | Valor |
|---------|-------|
| Tablas base en `public` | **27** |
| Triggers en `documents` | **5** (audit, guard de contenido, versionado, +utilitarios) |
| Policies RLS en `documents` (tabla) | **4** (insert internal, read scoped, update internal, delete admin) |
| Trigger de bloqueo en `customer_invoices` | **1** (`customer_invoices_lock`) |
| Policies en `storage.objects` | **16** |
| Buckets | 7 — `documents`, `invoices`, `attachments`, `po-signatures` **privados**; `pdfs`, `po-pdfs`, `signatures` públicos |
| Filas en `documents_audit` (post-batería+perf) | **5006** (auditoría poblada por trigger) |

---

## 2. Batería funcional T1–T8 (RLS, auditoría, versionado, inmutabilidad)

Simulación de usuarios con `set local role authenticated; select set_config('request.jwt.claim.sub', '<uuid>', true)` dentro de transacciones con `rollback`. Fixtures: 5 usuarios (A/B/C cliente, ops, admin), 3 clientes, 4 docs.

| Test | Qué valida | Resultado | Evidencia (NOTICE) |
|------|-----------|-----------|---------------------|
| **T1.A** | Cliente A ve SOLO sus 2 docs | ✅ PASS | "cliente A ve 2 docs (solo propios)" |
| **T1.B** | Cliente B ve SOLO 1 doc | ✅ PASS | "cliente B ve 1 doc" |
| **T1.OPS** | Interno (operaciones) ve los 4 | ✅ PASS | "interno ve 4 docs (todos)" |
| **T2** | Ataque cross-tenant: A pide doc de B por id | ✅ PASS | "cliente A NO ve doc de B (0 filas)" |
| **T3** | Forjar auditoría: INSERT directo en `documents_audit` como authenticated | ✅ PASS (denegado) | "new row violates row-level security policy for table documents_audit" |
| **T4** | Auditoría se genera por trigger al crear doc | ✅ PASS | "trigger generó auditoría create (1 fila)" |
| **T5.A** | Soft-deleted invisible para cliente | ✅ PASS | "cliente NO ve soft-deleted" |
| **T5.ADMIN** | Soft-deleted visible para admin | ✅ PASS | "admin SÍ ve soft-deleted" |
| **T6** | Bypass de versionado: 2º `is_current` en el grupo | ✅ PASS (bloqueado) | "segundo is_current bloqueado por unique (23505)" |
| **T7** | Guard de contenido: mutar `storage_path` | ✅ PASS (bloqueado) | "Documento inmutable: el contenido no se modifica. Subí una nueva versión." |
| **T8** | Inmutabilidad fiscal: mutar `total` de factura `AUTORIZADO_ARCA` | ✅ PASS (bloqueado) | "Comprobante AUTORIZADO por ARCA: no se pueden modificar datos fiscales. Emití una Nota de Crédito/Débito." |
| **T8.b** | Anulación lógica de factura autorizada SÍ permitida | ✅ PASS | "anulación lógica permitida (ANULADO)" |

> **Conclusión:** las cuatro garantías no-negociables del charter — **aislamiento multi-tenant, auditoría append-only, inmutabilidad documental e inmutabilidad fiscal** — están **enforced a nivel de base de datos** (RLS + triggers `SECURITY DEFINER`), no sólo en la capa de aplicación.

---

## 3. Performance (escala 5.005 documentos)

Seed: 5.000 docs adicionales para cliente A (un `is_current` por grupo) → total **5.005**. `analyze` ejecutado.

| Prueba | Query | Plan | Tiempo |
|--------|-------|------|--------|
| **P2** | Listado scoped cliente A (`is_current AND deleted_at IS NULL ORDER BY uploaded_at DESC LIMIT 50`) como authenticated | Seq Scan + top-N heapsort; RLS InitPlan sobre `profiles` (5 filas) | **63.4 ms** |
| **P3** | Conteo interno (operaciones) de docs vigentes | Seq Scan + Aggregate | **61.1 ms** |
| **P4** | Búsqueda por `document_group_id` (versionado) | **Index Scan Backward** (`documents_document_group_id_version_key`) | **0.071 ms** |

**16 índices presentes** en `documents` (pkey, 2 únicos de versionado/hash, btree por client/group/type/vendor/depot/docdate/expires, GIN fts/extract/tags, BRIN uploaded).

**Hallazgo de performance (no bloqueante):** el listado por defecto (`is_current`+`deleted_at`+orden por `uploaded_at`) resuelve con **Seq Scan** (~60 ms a 5 k filas). Aceptable a la escala actual; **a futuro** conviene un índice parcial/btree `(is_current, deleted_at, uploaded_at DESC) WHERE deleted_at IS NULL` para sostener latencia baja a decenas/cientos de miles de documentos. El acceso por grupo de versión ya es óptimo (índice). → **Recomendación P-1 para `0012+`, no condiciona GATE 2.**

---

## 4. Storage — scoping por path (S1–S3)

| ID | Bucket | Policy | ¿`split_part` (scoping por cliente)? | Veredicto |
|----|--------|--------|:------------------------------------:|-----------|
| **S1/S2** | `documents` | `documents read scoped` (SELECT) | ✅ **SÍ** (`split_part(name,'/',1)=client_id`) | **Multi-tenant correcto** — cliente sólo lee su prefijo de path |
| S1/S2 | `documents` | write/update/delete internal | n/a (restricción `is_staff`) | Escritura sólo interno (diseño) |
| **S3** | `invoices` | `invoices bucket internal` (ALL) | ❌ **NO** — `bucket_id='invoices' AND auth.role()='authenticated'` | 🟠 **R4 CONFIRMADO** |

> **R4 (confirmado con evidencia):** el bucket `invoices` **no** tiene scoping por cliente — cualquier usuario autenticado podría leer cualquier PDF fiscal. El bucket `documents` **sí** lo tiene (`split_part`). **Debe corregirse el bucket `invoices` con el patrón de `documents` antes de exponer PDFs fiscales a clientes B2B.** No bloquea el schema de GATE 2; bloquea ARCA productivo multi-tenant.

---

## 5. Mapeo a criterios GO del plan (§4 A1–A10)

| Criterio | Descripción | Resultado |
|----------|-------------|-----------|
| A1 | Baseline `0001`→`0009` aplica limpio | ✅ |
| A2 | `0010` aplica limpio (tablas/triggers/bucket/permisos) | ✅ |
| A3 | `0011` aplica limpio (tablas/trigger lock/bucket) | ✅ |
| A4 | RLS multi-tenant: cliente ve sólo lo suyo; interno ve todo | ✅ T1, T2 |
| A5 | Auditoría append-only (no forjable; generada por trigger) | ✅ T3, T4 |
| A6 | Soft-delete con visibilidad diferenciada | ✅ T5 |
| A7 | Versionado: único `is_current` por grupo | ✅ T6 + test C-1 |
| A8 | Guard de inmutabilidad de contenido documental | ✅ T7 |
| A9 | Inmutabilidad fiscal de comprobante autorizado + anulación lógica | ✅ T8, T8.b |
| A10 | Performance aceptable a escala de prueba | ✅ (60 ms @ 5 k; recomendación P-1 a futuro) |

**Ningún criterio de rechazo R1–R9 se disparó.** No hubo errores de aplicación, ni fugas cross-tenant, ni auditoría forjable, ni mutación fiscal/documental indebida.

---

## 6. Hallazgos abiertos (heredados, confirmados en staging)

| ID | Hallazgo | Severidad | ¿Bloquea schema GATE 2? | Cierre |
|----|----------|-----------|:-----------------------:|--------|
| **R4** | Bucket `invoices` sin scoping por cliente | 🟠 alto | No | Aplicar patrón `documents` (split_part) antes de exponer PDFs fiscales |
| **P-1** | Listado documental resuelve por Seq Scan | 🟡 medio | No | Índice parcial `(is_current,deleted_at,uploaded_at DESC)` en `0012+` |
| **ARCA-STUB** | `ProductionArcaService` = `NOT_READY` | 🔴 crítico (productivo) | No (fuera de scope schema) | Implementar WSAA/WSFEv1 + X.509 (post-GATE 2) |
| **C1** | En prod `isMock=false` consulta tablas `0011`/`0010` ausentes | 🔴 crítico (productivo) | No (GATE 2 valida justamente aplicarlas) | Aplicar `0010`/`0011` en prod con autorización ejecutiva |

---

## 7. Veredicto Fase 2

> **GATE 2 (schema/RLS/triggers/storage) = ✅ VERDE en staging aislado.**
> Las migraciones `0010` y `0011` aplican limpio, y **todas** las garantías estructurales
> (multi-tenant, auditoría append-only, versionado, inmutabilidad documental y fiscal) se
> verificaron enforced en base de datos. Quedan **R4** (scoping bucket `invoices`) y **P-1**
> (índice de listado) como mejoras, y **C1/ARCA-STUB** como bloqueos *productivos* (no de schema).

---

## 8. ¿Acerca a reemplazar Neuralsoft?

**SÍ, decisivamente.** GATE 2 verde **certifica con evidencia real** que la base documental y fiscal del ERP
es estructuralmente sólida y segura, sin haber tocado producción. Habilita —con autorización ejecutiva por
paso— aplicar `0010`/`0011` en prod (cierra C1), corregir R4 e implementar ARCA real. Próximas validaciones:
Documents Enterprise (Fase 3), ARCA Sandbox (Fase 4), RBAC (Fase 5), y veredicto final (Fase 6).

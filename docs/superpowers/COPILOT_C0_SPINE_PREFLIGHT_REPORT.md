# Nexus Copilot · C0 Spine Documental — Preflight Report (READ-ONLY)

> **Naturaleza:** verificación read-only contra **Supabase PROD** (`arsksytgdnzukbmfgkju`). **Nada aplicado, nada escrito, backfill NO ejecutado, reprojection NO ejecutada.** Solo `SELECT`/catálogo + `list_migrations` + advisors.
> **Fecha:** 2026-07-07 · **Rama:** `fix/f5-2-copilot-context-retrieval` @ `b8b7c33`.
> **Motivo:** resolver la contradicción histórica ("F5.1/0178 aplicado" vs plan "0176-0179 nunca aplicadas") **con evidencia de prod**, antes de aplicar nada.

---

## 1. Resumen ejecutivo — VEREDICTO

**🟢 C0 ("encender el spine documental") YA ESTÁ HECHO en producción. No hay nada que aplicar.**

La premisa del plan Slice C (§1, finding #1: *"spine dormido / índice vacío"*) era **FALSA**. Provenía de comentarios desactualizados del repo (`0174_ai_core.sql:136-138` "searchable_items vacía", y los headers "ENTREGADA NO APLICADA" de 0176-0179). La verificación de prod muestra lo contrario:

- **0176, 0177, 0178, 0179 están APLICADAS** en prod (registradas el 2026-07-03).
- **El backfill YA se corrió:** `searchable_items` = **800 filas** (569 compliance + 231 contratos), **100% con FTS (`tsv`)**, **cero duplicados**, y **perfectamente en sync** con la vista de proyección (800 = 800).
- **`ai_search_knowledge` y `ai_docs_browse` están VIVOS** en prod — la búsqueda documental full-text de Capa 1 ya funciona.

**La contradicción se resuelve a favor de la historia (0178 aplicado), no del plan.** El preflight cumplió su función: evitó que "apliquemos" algo que ya estaba aplicado.

**Consecuencia para el roadmap:** se **elimina C0** (no se ejecuta; queda como health-check / auditoría). Slice C **NO arranca C1 todavía**: antes hay que **reconciliar la deriva de trazabilidad 0180-0184** (§2.1 — objetos existen sin registrar; 3 faltan). Queda además una **deuda de hardening pre-existente** (WARN, no bloqueante) en funciones auxiliares del spine (§6).

---

## 2. Estado real de migraciones (Fase A)

| Migración | Registrada en prod | Timestamp | Estado |
|-----------|:---:|-----------|--------|
| `0176_knowledge_docs_projection` | ✅ SÍ | 20260703133648 | **APLICADA** |
| `0177_knowledge_view_pilot_grant` | ✅ SÍ | 20260703133723 | **APLICADA** |
| `0178_docs_retrieval_improvements` | ✅ SÍ | 20260703165239 | **APLICADA** |
| `0179_docs_browse_fts` | ✅ SÍ | 20260703223653 | **APLICADA** |
| `0180-0184` (ai budget/finance/analytics/revenue) | ❌ NO (registro) | — | **objetos MIXTOS — ver §2.1** |

- **Contradicción resuelta:** las 4 migraciones documentales figuran aplicadas; los objetos existen y están poblados (§3). No hubo "aplicación manual fuera de tabla" — están en la tabla de migraciones oficial.
- **✅ Proyecto auditado = proyecto de la app (confirmado, NO asumido):** la app (`.env.local` → `NEXT_PUBLIC_SUPABASE_URL`, una sola URL Supabase) apunta a **`arsksytgdnzukbmfgkju`** — el MISMO proyecto que audité. **El mismatch 0180-0184 NO se debe a mirar el proyecto equivocado.** El 2º proyecto `tops-ordenes-integracion-use1` (`bmrtlojmqmkuirhuzhyt`, us-east-1, integración, creado 2026-06-30) **NO** está en el runtime de la app.
- **La última migración REGISTRADA en prod es `0179`**; `0180-0184` no figuran en la tabla — pero eso **no** implica que sus objetos no existan (§2.1).

### 2.1 Verificación de 0180-0184 POR OBJETO (la tabla de migrations NO es fuente única)

Verificado por `pg_proc` / `pg_class` (no solo `list_migrations`):

| Objeto (concepto) | Mig | ¿Existe en prod? | Seguridad / grant | Clasificación |
|-------------------|:---:|:---:|-------------------|---------------|
| `ai_customer_invoices_overview` | (previa) | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_supplier_invoices_overview` | (previa) | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_purchase_orders_overview` | (previa) | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_suppliers_overview` | (previa) | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_billing_summary` | (previa) | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_bank_balances_overview` | (previa) | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_supplier_spend_overview` | (previa) | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_customer_revenue_overview` | 0183 | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_revenue_by_category` | 0184 | ✅ | INVOKER · authenticated | **no registrada, objeto existe** |
| `ai_budget_overrides` (tabla) | 0180 | ❌ | — | **NO existe → pendiente real** |
| `ai_finance_overview` | 0181 | ❌ | — | **NO existe → pendiente real** |
| `ai_analytics_overview` | 0182 | ❌ | — | **NO existe → pendiente real** |

**Conclusión (corrige la afirmación previa "0180-0184 no están en prod"):**
- **Las 9 funciones de overview que usa el Copilot EXISTEN, son SECURITY INVOKER, tienen grant a `authenticated` y funcionan** — probado además por el smoke real (Santander / facturación / contratos devolvieron datos). **Tu preocupación era válida: las dependencias del Copilot están satisfechas en prod.**
- **PERO 3 objetos del band NO existen:** `ai_budget_overrides` (0180), `ai_finance_overview` (0181), `ai_analytics_overview` (0182). Son **pendientes reales** (probablemente override de budget + dashboards ejecutivos, **no** retrieval del Copilot).
- **Toda la banda 0180-0184 está SIN registrar** en `migrations`, aunque varios objetos existen → **deriva de trazabilidad**: se aplicaron objetos (create-or-replace) sin quedar registrados, o bajo otra migración. **No rompe el runtime**, pero hay que **reconciliar `migrations` ↔ objetos reales ANTES de cualquier deploy o de numerar migraciones nuevas** (los objetos de 0183/0184 ya existen → riesgo de choque de numeración si C1 reusa 0180+).
- **Procedencia exacta no determinable** desde el catálogo (qué migración creó cada función) — solo consta que los objetos están vivos y grant-eados.

---

## 3. Estado real del spine documental (Fase B)

**Objetos: todos existen en prod, RLS habilitada donde corresponde.**

| Objeto | Tipo | RLS | Filas |
|--------|------|:---:|------:|
| `searchable_items` | tabla | ✅ | **800** |
| `ai_docs_projection` | **vista** | n/a (view) | 800 (proyectaría) |
| `knowledge_documents` | tabla | ✅ | 0 (scaffold) |
| `knowledge_chunks` | tabla | ✅ | 0 (scaffold) |
| `knowledge_events` | tabla | ✅ | — |
| `compliance_documents` | tabla | ✅ | 569 |
| `contract_documents` | tabla | ✅ | 231 |
| `contracts` | tabla | ✅ | 57 |
| `ai_sources` | tabla | ✅ | 998 (auditoría chat, no docs) |

**Respuestas a las 10 preguntas de la Fase B:**
1. **¿Qué tablas existen?** Todas las del spine (arriba). ✅
2. **¿Cuántas filas?** `searchable_items` = **800**; fuentes 569+231+57.
3. **¿Qué entity_types?** En el índice: `compliance_documento` (569) + `contrato` (231).
4. **¿Qué fuentes están proyectadas?** compliance_documents + contract_documents (vía `contracts`).
5. **¿Qué fuentes faltan?** Institucional (Capa 2), research/NotebookLM (Capa 3), actualidad (Capa 4). **Ninguna proyectada** — esa es la brecha real de Slice C.
6. **¿Índice vacío o parcial?** **Ni vacío ni parcial: COMPLETO y en sync** (800 índice = 800 vista).
7. **¿Duplicados?** **No** (800 pares `(entity_type, entity_id)` distintos = 800 totales).
8. **¿Metadata suficiente para links a Drive?** Sí — `compliance_documents.url` / `contract_documents.url` / `contracts.drive_folder_id` existen; el link real se re-joinea en la capa de app (`tools.ts` `enrich`), no en el índice.
9. **¿Texto completo o solo metadata?** **Solo metadata** (título + cuerpo enriquecido con vocabulario de dominio por 0178). La proyección **excluye** `extracted_text`/`drive_file_id`/`url`/hashes (redacción `ai_docs_redact`). **No hay texto completo indexado.**
10. **¿FTS, trigram, metadata o embeddings?** **FTS (`tsvector` español) + `pg_trgm`/ILIKE + metadata.** **CERO pgvector/embeddings** (confirmado: `knowledge_chunks` sin columna vector, 0 filas).

---

## 4. Volúmenes

- Índice activo: **800 chunks citables** (569 compliance + 231 contrato).
- Fuentes: 569 documentos compliance, 231 documentos de contrato, 57 contratos.
- Scaffold RAG (`knowledge_documents`/`knowledge_chunks`): **0** (no usado; reservado para C3 si se hiciera pgvector).
- Crecimiento de un futuro backfill institucional/research (C1/C2): **desconocido** hasta armar las carpetas Drive (estimación pendiente de inventario real).

---

## 5. Riesgos

| Riesgo | Nivel | Detalle |
|--------|:---:|---------|
| Aplicar C0 "de nuevo" | ⚠️→✅ | **Eliminado**: ya está aplicado; re-correr backfill sería **no-op** (índice ya en sync, idempotente por upsert + unique key) |
| Deuda de hardening en funciones del spine | 🟡 WARN | Pre-existente desde 2026-07-03 (§6). No bloquea; recomendable remediar |
| Vista `ai_docs_projection` = SECURITY DEFINER (owner `postgres`) | 🟢 bajo | **NO** figura en advisors → no está expuesta a anon/authenticated (grant restrictivo de 0177); solo la usa el backfill (DEFINER/service_role) |
| Deriva de trazabilidad 0180-0184 (objetos existen sin registrar; 3 faltan — §2.1) | 🟡 | Reconciliar `migrations`↔objetos antes de deploy y de numerar C1; runtime NO afectado |
| Segundo entorno `integracion` sin auditar | 🟢 info | Registrar; no tocar |
| Metadata-only (sin texto completo) | 🟢 esperado | Q&A profundo sobre prosa requeriría C3 (pgvector); hoy alcanza para búsqueda por título/keywords |

---

## 6. Seguridad / RLS / Permisos (Fase D)

**✅ Postura de runtime correcta:**
- RPCs de retrieval del Copilot son **SECURITY INVOKER** (respetan RLS con la sesión del usuario): `ai_search_knowledge`, `ai_docs_browse`, `ai_contracts_overview`. Backfill/reproject son **DEFINER** (correcto, solo escritura controlada).
- `searchable_items` tiene RLS `SELECT`: `has_permission('knowledge.view') AND (visibility_key='public_auth' | staff+is_staff() | client:… | perm:… | is_admin())`. **Doble gate**: `knowledge.view` + el permiso por entidad (`perm:compliance.view` / `perm:comercial.view`). Escrituras solo por DEFINER (no hay policy INSERT/UPDATE).
- `compliance_documents`: read `true` (staff autenticado), write rol admin/supervisor/operaciones. `contract_documents`/`contracts`: read **y** write rol admin/supervisor/operaciones (más estricto).
- **El Copilot NO usa service_role en runtime** (verificado antes en `data.ts`; test estructural lo vigila).
- **Links Drive:** `url` = `webViewLink` de Google Drive = **privados** (requieren permiso Drive para abrir); no públicos. Se re-joinean app-side.

**🟡 Advisors — deuda de hardening PRE-EXISTENTE (WARN, no bloqueante):**
Los objetos exactos del spine (`searchable_items`, `ai_search_knowledge`, `ai_docs_browse`, `ai_docs_projection`, etc.) **NO tienen findings** (limpios). Pero funciones **auxiliares** del mismo spine sí, ya vivas desde 2026-07-03:
- `function_search_path_mutable` (WARN) en: `ai_docs_redact`, `ai_docs_visibility_key`, `tg_knowledge_forbid_delete`, `tg_contracts_set_public_id`, `set_crm_contract_public_id`. → falta `SET search_path`.
- `anon/authenticated_security_definer_function_executable` (WARN) en los **triggers de proyección incremental** `tg_ai_docs_compliance()`, `tg_ai_docs_contract()`, `tg_ai_docs_contract_parent()` → son SECURITY DEFINER **invocables vía `/rest/v1/rpc/`** por anon/authenticated. Son funciones-trigger, no deberían ser llamables directo. → `REVOKE EXECUTE FROM anon, authenticated`.
- `knowledge_kpi_*` (5 funciones de reporte): authenticated-executable definer.

> **Recomendación:** una migración chica de hardening (`SET search_path` + `REVOKE EXECUTE` sobre las trigger fns) — y **bakear ese patrón en toda función nueva de C1+**. No bloquea C0 (ya aplicado); es limpieza de seguridad de bajo riesgo.

---

## 7. Backfill — dry-run / estimación (Fase C)

**No se ejecutó `ai_docs_backfill_apply()`, `ai_docs_reproject()` ni `ai_docs_backfill_dryrun()`.** La estimación se hizo por `SELECT` sobre la vista (read-only):

- **Registros que proyectaría:** 800 (= lo que ya está en el índice → **no agregaría nada**, ya está en sync).
- **Fuentes hoy:** contratos (231) + compliance (569). **Faltantes (futuro C1/C2):** documentos Drive institucionales, carpetas institucionales, exports NotebookLM → volumen a estimar con el inventario real.
- **Tiempo:** trivial (~800 filas ya proyectadas; deltas incrementales por triggers).
- **Riesgo de locks:** bajo (batches por `p_limit`/`p_offset`; volumen chico).
- **Riesgo de duplicación:** **nulo** — unique `(entity_type, entity_id)` + upsert; verificado 800 distinct = 800 total.
- **¿Idempotente?** **Sí** (upsert `ON CONFLICT`), probado por los datos (índice ya en sync).
- **¿Por batches?** Sí (`p_limit`, `p_offset`).
- **¿Rollback lógico?** Sí (existen `ROLLBACK_0176_0177…`, `…0178…`, `…0179…`).

---

## 8. Plan de ejecución C0 (Fase E) — clasificado

### ✅ Seguro / ya hecho (NADA que aplicar)
- **C0 spine documental:** aplicado y en sync. **No requiere acción.** La búsqueda documental (`search_knowledge`, `docs_browse`) ya está viva en prod.

### 🟡 Requiere corrección previa (opcional, no bloqueante, requiere OK + migración)
- **Hardening de funciones del spine:** migración chica (`SET search_path` en `ai_docs_redact`/`ai_docs_visibility_key`/triggers; `REVOKE EXECUTE FROM anon,authenticated` en `tg_ai_docs_*`). Bajo riesgo; cierra WARNs pre-existentes.
- **Corregir premisa del plan Slice C** (§1 finding #1 "dormido" → "encendido") y la fila de cobertura desactualizada. *(Doc, sin código.)*

### 🔴 No aplicar todavía (futuro, requiere tu OK explícito)
- **C1 institucional / C2 research / C4 actualidad / C3 pgvector / C5 mixtos** — todo el Slice C real. Ninguno toca lo ya aplicado.
- **Reconciliar deriva 0180-0184** (§2.1: objetos existen sin registrar; 3 faltan) **antes** de deploy y **antes** de numerar migraciones de C1.

**Si igual se quisiera "refrescar" el índice** (no necesario): correr `ai_docs_backfill_apply()` sería no-op idempotente — pero **no se ejecuta sin tu OK** y **no hace falta**.

---

## 9. Rollback

- **C0:** N/A — no hay nada que aplicar, entonces no hay nada que revertir.
- Si en el futuro se tocara el spine: existen `ROLLBACK_0176_0177_knowledge_docs_projection.md`, `ROLLBACK_0178_docs_retrieval_improvements.md`, `ROLLBACK_0179_docs_browse_fts.md`.
- Hardening (si se hace): reversible (quitar `SET search_path` / re-`GRANT EXECUTE`), pero no habría motivo.

---

## 10. Decisión requerida

1. **C0:** **ninguna acción** — confirmado hecho. Actualizar el plan Slice C para eliminar C0 y arrancar en C1.
2. **Hardening (opcional):** ¿scopeo la migración chica de `SET search_path` + `REVOKE EXECUTE`? (cierra WARNs pre-existentes; no urgente).
3. **Deriva de trazabilidad 0180-0184 (verificada por objeto, §2.1):** objetos 0183/0184 existen sin registrar; 0180/0181/0182 faltan. **Reconciliar `migrations` ↔ objetos reales antes de C1** — decidir: ¿registrar los objetos existentes? ¿aplicar los 3 faltantes si alguna feature los necesita? Requiere tu decisión.
4. **Siguiente Slice real (NO antes de cerrar §2.1):** C1 institucional — la **numeración de migración queda a definir tras la reconciliación** (0183/0184 ya ocupan objetos; hay que confirmar cuál es la próxima libre "segura"). **No arranco C1 sin tu OK.**

---

### Confirmación de reglas
Cero migraciones aplicadas · cero backfill · cero reprojection · cero Supabase writes (solo SELECT/catálogo) · sin deploy/push/merge · sin NotebookLM · sin crawler · sin grounding. Verificación 100% read-only contra prod.

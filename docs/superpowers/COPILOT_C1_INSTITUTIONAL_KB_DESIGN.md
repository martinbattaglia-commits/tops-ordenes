# Nexus Copilot · C1 — Capa 2 Institucional (Knowledge Base de Logística TOPS)

> **Estado:** implementado LOCALMENTE (código + tests verdes) · migración `0185` **entregada NO aplicada** · **sin ingesta real** todavía.
> **Fecha:** 2026-07-07 · **Rama:** `fix/f5-2-copilot-context-retrieval` (local, sin commit).
> **Principio rector:** *NotebookLM investiga · Drive conserva · Nexus indexa · Copilot responde.*

---

## 1. Arquitectura C1

Capa 2 = conocimiento institucional de Logística TOPS. Modelo de tres eslabones:

```
Drive "Nexus Knowledge Base — Institucional"   ← biblioteca canónica / staging (humano cura)
        │  (ingesta curada; C1 = diseño, la ingesta real es un paso posterior)
        ▼
public.company_knowledge_documents  (mig 0185)  ← índice consultable (FTS español + trigram)
        │  ai_company_knowledge_search (SECURITY INVOKER → RLS del usuario)
        ▼
tool company_knowledge_search  →  engine (intent company_institutional)  ← capa de respuesta
        ▼
Copilot responde citando el documento/URL institucional REAL — o declara la brecha si no hay ingesta.
```

**Decisión clave:** tabla **separada** del spine operativo (`searchable_items`, que tiene compliance/contratos). No se mezcla conocimiento institucional con datos vivos (requisito explícito de Dirección). Reusa el patrón (FTS `tsvector` español + `pg_trgm`), no la tabla.

**Ruteo (engine):** para `company_institutional` el engine intenta `company_knowledge_search`; si devuelve filas → responde desde la KB; si devuelve `[]` (migración 0185 sin aplicar, o sin documentos) → **brecha específica** (coverage), nunca `search_knowledge` genérico ni "no encontré en Nexus".

**Degradación segura:** `data.ts` absorbe el error de RPC inexistente devolviendo `[]` → el engine cae a la brecha. Por eso el código se puede tener en prod **antes** de aplicar 0185 sin romper nada (Capa 2 sigue como brecha declarada).

---

## 2. Estructura Drive esperada (para la ingesta futura)

```
NEXUS_COPILOT_KNOWLEDGE_BASE/
  01_INSTITUCIONAL_LOGISTICA_TOPS/
    SITE_COMPLETO/        → logisticatops.com (export curado)
    LANDING/              → Cargas Generales, Regulados/ANMAT
    DOSSIER/              → dossier comercial
    PROPUESTA_MODELO/     → propuestas / propuesta de valor
    ARGUMENTARIO/         → argumentarios de venta
    FAQ/
    CODIGO_ETICA/
    IDENTIDAD_CORPORATIVA/
    (CAPACITACION / INVESTIGACION → Capa 3, misma tabla vía capa='research')
```

---

## 3. Metadata (columnas de `company_knowledge_documents`)

| Campo | Tipo | Rol |
|-------|------|-----|
| `title` | text NOT NULL | título |
| `source_type` | text CHECK | SITE_COMPLETO · LANDING · DOSSIER · PROPUESTA_MODELO · ARGUMENTARIO · FAQ · CODIGO_ETICA · IDENTIDAD_CORPORATIVA · CAPACITACION · INVESTIGACION |
| `business_unit` | text CHECK | ANMAT · CARGAS_GENERALES · CORPORATIVO · REGULADOS · NEXUS · OTRO |
| `capa` | text CHECK | institucional (C1) · research (forward-compat C2) |
| `url` | text | link REAL (Drive webViewLink / web) — se cita, nunca se inventa |
| `drive_file_id` / `source_ref` | text | origen en Drive (único parcial) / id-ruta original |
| `summary` / `content` | text | cuerpo curado (FTS + cita) / texto completo (C3) |
| `estado` | text CHECK | **VIGENTE · HISTORICO · BORRADOR · NO_INGESTAR · REEMPLAZADO** |
| `confianza` | smallint 0-100 | confiabilidad de la fuente |
| `confidencialidad` | text CHECK | PUBLICO · INTERNO · CONFIDENCIAL |
| `fecha_captura` | date | cuándo se capturó |
| `responsable` | text | curador |
| `ingestable` | boolean | "puede ingerirse" (gate duro) |
| `tsv` | tsvector GENERATED | FTS español (title+summary+content) |

**Regla de estados (la RPC la aplica en SQL, el `demoFilter` la espeja en tests):** solo `estado='VIGENTE' AND ingestable` es consultable. `NO_INGESTAR`/`HISTORICO`/`BORRADOR`/`REEMPLAZADO` **nunca** salen.

---

## 4. SQL 0185 (entregado NO aplicado)

`supabase/migrations/0185_company_knowledge_base.sql` (+ `ROLLBACK_0185…md`):
- Tabla `company_knowledge_documents` (idempotente `create table if not exists`, 6 CHECK de dominio nombrados `_ck`, FK `on delete set null`, `tsv` GENERATED).
- Índices: GIN(`tsv`), GIN trigram(`title`), parcial `(capa, business_unit) where estado='VIGENTE' and ingestable`, único parcial `drive_file_id`.
- Trigger `updated_at` (fn con `set search_path = public, pg_temp`).
- RLS: lectura `has_permission('knowledge.view')`; escritura `current_role() ∈ (admin, supervisor)`.
- RPC `ai_company_knowledge_search(p_query, p_unidad, p_capa, p_limit)` **SECURITY INVOKER**, `stable`, `search_path` fijo; FTS + trigram, ranking `ts_rank`, `ai_docs_redact` sobre texto libre; grants a `authenticated`.
- **Sin inserts, sin backfill.** Kit de validación read-only comentado al final.
- **Numeración: 0185** (0180-0184 ocupan archivos; ver `COPILOT_C0_5_MIGRATION_RECONCILIATION_REPORT.md`).

---

## 5. Código (implementado local)

| Archivo | Cambio |
|---------|--------|
| `src/lib/ai/types.ts` | `+ "company_knowledge_search"` en `TOOL_NAMES` |
| `src/lib/ai/tools.ts` | ToolSpec `company_knowledge_search` (rpc, schema zod, `demoFilter` de estados, `rowToChunk` → entityType `institucional`, url real) + JSON schema |
| `src/lib/ai/engine.ts` | branch `company_institutional`: intenta KB → si vacío, brecha específica |
| `src/lib/ai/coverage-source.ts` | brecha institucional reformulada ("diseñada, sin documentos ingestados") |
| `src/lib/ai/company-knowledge.test.ts` | 10 tests (RED→GREEN) |

---

## 6. Tests (Fase F, RED→GREEN)

`company-knowledge.test.ts` — **10/10 verdes**, cubre:
1. tool en catálogo (RPC INVOKER). 4/7. `demoFilter`: query VIGENTE, prioridad VIGENTE. 5. NO_INGESTAR fuera. 6. HISTORICO fuera. `rowToChunk` cita con URL real. Engine: CON docs → responde desde `company_knowledge_search` (no `search_knowledge`); SIN docs → brecha específica, no "no encontré en Nexus". Regresión: Nexus (Capa 1), general (Capa 4), management brief intactos.

---

## 7. Plan de ingesta (diseño; NO ejecutado)

1. Curar contenido institucional en la carpeta Drive KB (humano).
2. Aplicar `0185` (requiere OK).
3. Ingesta: leer Drive → mapear metadata → `insert` en `company_knowledge_documents` (estado inicial `BORRADOR`, promover a `VIGENTE` al validar). *Script dry-run/local, nunca prod sin OK.*
4. Validación: `ai_company_knowledge_search('servicios')` devuelve solo VIGENTE.
5. Refresh: re-sync incremental desde Drive (como compliance/contratos).

**NO_INGESTAR** se respeta en dos niveles: el curador marca el estado y la RPC lo excluye.

---

## 8. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Curaduría de calidad (copy comercial vs institucional) | estado + `confianza` + responsable por documento |
| Datos ANMAT sensibles al copy | validados: cubículos 22/16 m² (26 total), Luján 3159 / Magaldi 1765, RNE del cliente |
| Ingesta accidental de borradores | gate doble: `estado`/`ingestable` + RPC filtra |
| pgvector (Q&A profundo) | diferido a C3, solo si el FTS no alcanza |
| Migración aplicada sin datos | degradación segura → brecha (no rompe) |

---

## 9. Smoke esperado (cuando haya ingesta + Gemini real)

- "¿Qué servicios ofrece Logística TOPS?" → responde desde KB citando el documento/URL.
- "¿Qué ofrece para ANMAT/regulados?" → doc de unidad REGULADOS/ANMAT.
- "¿Qué es TOPS Nexus/Connect?" → doc institucional NEXUS.
- Sin ingesta → brecha específica ("diseñada, sin documentos ingestados").

---

## 10. Decisiones pendientes (requieren OK)

1. **Aplicar 0185** en prod (SQL Editor, G3).
2. Armar la **carpeta Drive KB institucional** + curar los primeros documentos.
3. **Script de ingesta** (diseñar; dry-run local antes de prod).
4. Confirmar URLs institucionales dudosas (Nexus landing, microsites).

---

## 11. Qué NO se hizo (explícito)

Migración **no aplicada** · sin Supabase writes · sin ingesta · sin backfill/reprojection · sin crawler · sin deploy/push/merge · no se tocó 0180 ni la tabla `migrations` · sin NotebookLM · sin grounding. Solo código local + tests + SQL entregado.

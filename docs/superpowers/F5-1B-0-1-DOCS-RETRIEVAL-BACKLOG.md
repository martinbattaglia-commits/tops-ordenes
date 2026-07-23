# F5.1-b.0.1 — Backlog de mejoras de retrieval documental

> **Estado: BACKLOG (no implementado). Mejoras ADITIVAS sobre F5.1-b.0 (cerrada, en prod).**
> Origen: diagnóstico del smoke conversacional vivo (ver `F5-1B-0-CLOSURE-REPORT.md` §6–§7).
> **Ninguna es hotfix bloqueante** — b.0 funciona (encuentra documentos por metadata, RLS-safe,
> PII-clean, sin fuga de contenido). Estas mejoras elevan la **calidad de recuperación y ruteo**.
> Gobernanza G1–G11. Requiere GO explícito de Dirección para implementar (paquete propio).

---

## Contexto

El backfill de metadata (797 fichas) funciona: el Copilot respondió en vivo "estado de compliance de
MAGALDI" con fuentes/citas. Pero el smoke reveló límites de **recuperación** y **ruteo**, no de datos:

- Búsquedas genéricas ("documentos de compliance") rankean pobre porque el `body` de la ficha no
  contiene la palabra de dominio; el FTS matchea términos específicos (MAGALDI, póliza), no genéricos.
- "Por vencer" no funciona bien: `ai_search_knowledge` es FTS puro (`ts_rank`) **sin filtro por fecha**.
- El planner a veces rutea preguntas de contratos a la tool equivocada (`compliance_pending`).
- La ficha de contrato no proyecta `fecha_firma` → "el último contrato firmado" no es respondible.

---

## Mejoras (6)

### B0.1-1 · Tool / filtro date-aware
Poder responder por fecha, no solo por texto:
- contratos/documentos **próximos a vencer** (`entity_date` entre hoy y hoy+N días);
- **vencidos** (`entity_date < hoy`);
- ordenamiento por `entity_date`.
**Opciones:** (a) nueva tool `docs_por_vencer(p_dias, p_tipos)` sobre `searchable_items`; o
(b) extender `ai_search_knowledge` con `p_venc_desde`/`p_venc_hasta`. Preferible (a) (tool explícita,
ruteo más claro para el planner). Respeta RLS (SECURITY INVOKER o filtro dentro de la policy).

### B0.1-2 · Proyectar `fecha_firma` en la metadata contractual
Agregar `fecha_firma` de `contracts` a la ficha de contrato (body/`entity_date` alterno o campo):
- habilita "cuándo se firmó el contrato X";
- habilita "el último contrato firmado" (orden por firma).
Cambio en la vista `ai_docs_projection` (rama contrato) — aditivo, re-backfill idempotente.

### B0.1-3 · Enriquecer el `body` con palabras de dominio
Prefijar/incluir en el `body` términos de dominio para mejorar búsquedas genéricas:
`compliance`, `contrato`, `documento`, `vencimiento` (según el tipo). Así "buscame documentos de
compliance" matchea. Cambio en la vista + re-backfill. Cuidar no reintroducir ruido de ranking.

### B0.1-4 · Mejorar el ruteo del planner
Afinar descripciones de tools / system prompt para que:
- preguntas de **contratos** vayan a `search_knowledge` (o a la tool date-aware B0.1-1);
- se evite el ruteo incorrecto a `compliance_pending` para contratos.
Cambio de prompt/descripciones (bump `PROMPT_VERSION`). Requiere corrida del eval set (B0.1-5).

### B0.1-5 · Eval set de consultas documentales
Set versionado de consultas + expectativa, corrido en cada cambio de prompt/tool:
1. estado de compliance de MAGALDI → ANSWERED con fuentes;
2. contratos existentes / buscame contratos → ANSWERED con fichas;
3. contratos próximos a vencer → ANSWERED (tras B0.1-1);
4. último contrato firmado → ANSWERED (tras B0.1-2);
5. documentos vencidos → ANSWERED;
6. **"resumime el contenido del contrato X" → NO_EVIDENCE** (guard metadata-vs-contenido).

### B0.1-6 · Criterio GO / NO GO para b.0.1
- **GO** cuando: cambios aditivos (vista/tool/prompt) + re-backfill idempotente + eval set verde +
  gates typecheck/lint/tests/build + revisión adversarial + dry-run aprobado por Dirección.
- **NO GO**: cualquier cambio que toque texto de PDF (eso es b.1), embeddings (b.2), Drive, cron,
  `RBAC_ENFORCE`, o que degrade el guard fail-closed o la redacción PII.

---

## Fuera de alcance de b.0.1

- **F5.1-b.1** (extracción de texto de PDF): NO-GO, plan propio.
- **F5.1-b.2** (embeddings/pgvector): NO-GO/diferir hasta medir recall del FTS.

---

# Diseño técnico F5.1-b.0.1

> Estado: **IMPLEMENTADO LOCAL, NO APLICADO / NO DEPLOYADO / NO PUSHEADO** (2026-07-03).
> Rama `feat/f5-1b-0-1-docs-retrieval` (worktree, off `feat/f5-1b-0-docs-projection` @ `70cdd68`).
> Diagnóstico read-only en vivo (prod `arsksytgdnzukbmfgkju`, solo SELECT/introspección).

## 1. Root cause confirmado (en vivo)

- **F-1 "contratos próximos a vencer" → NO_EVIDENCE**: el planner ruteó a `compliance_pending`
  (auditado en `ai_messages.tools_used`), que **solo** cubre `compliance_cases`+`compliance_documents`,
  **nunca `contracts`**. Hay **4 contratos con `fecha_fin` ≤90d** (`contracts_expiring_90d=4`) y
  **los 4 no tienen `contract_documents`** → tampoco están en `searchable_items`. Solo **4/57** contratos
  tienen fichas. ⇒ **los contratos deben leerse a grano contrato desde `public.contracts`.**
- **F-2 "último contrato firmado" → NO_EVIDENCE**: `ai_search_knowledge` es FTS puro sin orden por firma;
  la proyección pone `fecha_fin` en `entity_date`, **nunca `fecha_firma`**. Hay **41/57** con `fecha_firma`
  (solo 1 con documentos). ⇒ grano contrato.
- **F-3 búsquedas genéricas**: FTS mide 0 hits para `'vencimiento'` (vs 26 para `'vence'`: el stemmer no los
  unifica), 0 para `'buscame contratos'`, 1 para `'documentos de compliance'`. El `body` no tiene vocabulario
  de dominio; `websearch_to_tsquery` es AND + stopwords. Además "buscame documentos compliance" se ruteó a
  `compliance_pending` (solo 15 vencidos), no a las 569 fichas.
- **NO es el guard**: `error_detail=null` en F-1/F-2 (el guard marca su motivo). El guard se preserva.

## 2. Paquete implementado (local)

**Migración `0178_docs_retrieval_improvements.sql`** (idempotente, aditiva, NO aplicada) +
**`ROLLBACK_0178_docs_retrieval_improvements.md`**:
1. `create or replace view public.ai_docs_projection` — `body` enriquecido con vocabulario de dominio
   (`documento compliance cumplimiento` / `contrato documento acuerdo comercial`), `vencimiento` (sustantivo)
   junto a `vence`, y `firmado firma el <fecha_firma>` (metadata, no contenido). Solo cambia `body`
   (title/status/entity_date/public_id/visibility_key intactos). `tsv` es columna generada → se re-indexa al
   reproyectar. **No** hay estado temporal (vencido/vigente) baked en el body (evita staleness).
2. `public.ai_contracts_overview(p_mode, p_dias, p_query, p_limit)` — **SECURITY INVOKER**, lee
   `public.contracts` a grano contrato. `mode ∈ {por_vencer, vencidos, vigentes, firmados_recientes, todos}`.
   Devuelve **solo metadata** (public_id, razon_social, tipo, estado, fecha_firma/inicio/fin, dias_para_vencer,
   detalle); `razon_social`+`detalle` pasan por `ai_docs_redact`. `grant execute to authenticated`.
3. `public.ai_docs_browse(p_tipo, p_query, p_limit)` — **SECURITY INVOKER**, lista fichas de
   `searchable_items` por tipo (compliance|contrato) + nombre (ILIKE), acotado a los 2 entity_types
   documentales. `grant execute to authenticated`.

**Código TS** (worktree): `types.ts` (2 tool names), `tools.ts` (2 `ToolSpec` + 2 `TOOL_INPUT_SCHEMAS` +
descripción de `compliance_pending` aclarada), `mock.ts` (2 fixtures), `guardrails.ts`
(`METADATA_INTENT_TERMS` += firma/vigencia de contrato), `prompts/system.v1.ts` (guía de ruteo +
`PROMPT_VERSION → system.v3`).

**Tests** (vitest): `knowledge-eval.test.ts` (eval set), + casos en `guardrails.test.ts` y `tools.test.ts`.

## 3. Decisiones de diseño (y por qué)

- **Grano contrato leyendo `contracts`** (no `searchable_items`): los 4 por-vencer no tienen fichas ⇒ leer
  fichas devolvería 0. `contracts_overview` arregla F-1/F-2 **sin depender de reproyección**.
- **SECURITY INVOKER** (GO Dirección): hereda la RLS role-based de `contracts` (admin/supervisor/operaciones);
  los 6 pilotos son staff. Nunca sobre-expone. Divergencia con el modelo permission-based de fichas es
  **fail-closed** (un piloto no-staff futuro no vería contratos hasta ser staff). El retrieval corre con el
  cliente de sesión (RLS activa); `src/lib/ai` tiene prohibido el service-role (lo vigila `tools.test.ts`).
- **entityType `'contrato'`** en `contracts_overview` ⇒ queda bajo el guard metadata-vs-contenido: "resumime el
  contenido del contrato X" degrada a NO_EVIDENCE aunque la tool devuelva metadata.
- **`METADATA_INTENT_TERMS` += `firmad` + `se firmo`** (participio/reflexivo del estado de firma):
  sin ese cambio, "último contrato firmado" caía en `!meta` y el guard fail-closed lo degradaba (falso
  NO_EVIDENCE). Términos PRECISOS a propósito (revisión adversarial): NO el presente "firma" (firmante) ni
  el adjetivo suelto "vigente" — reabrían "quién firma la habilitación" / "resumime lo vigente". La vigencia
  como lista ya entra por "contratos". El vocabulario de CONTENIDO mantiene prioridad (`content OR !meta`)
  ⇒ no se debilita el guard para preguntas de contenido (tests lo fijan, incl. las re-cerradas del review).
- **`body` sin estado temporal**: vencido/vigente se resuelve por RPC date-aware, no por FTS (evita staleness).

## 4. Eval set (guard-level; e2e Gemini = smoke DRAFT/PROD)

`knowledge-eval.test.ts`: 7 metadata → responden (incl. último firmado / por vencer / buscar), 3 contenido →
NO_EVIDENCE (resumen/cláusulas/obligaciones). + tools nuevas bajo el guard.

## 5. Validación SQL (read-only, ejecutada en vivo 2026-07-03)

Equivalentes a los cuerpos de las RPC (probados antes de existir la migración):

```sql
-- por_vencer (esperado 4) / firmados_recientes (esperado 41) / vencidos (esperado 0)
select
 (select count(*) from contracts where fecha_fin between current_date and current_date + 90) as por_vencer,
 (select count(*) from contracts where fecha_firma is not null)                              as firmados,
 (select count(*) from contracts where fecha_fin < current_date)                             as vencidos,
 (select count(*) from contracts)                                                            as total; -- 57
-- FTS: 'vencimiento' 0 hits vs 'vence' 26; 'buscame contratos' 0 (por eso docs_browse no usa FTS).
```

## 6. Riesgos remanentes

- **R1** el `body` enriquecido solo surte efecto **tras reproyección** (`ai_docs_backfill_apply()`, paso de
  apply aprobado aparte). `contracts_overview` (el fix más valioso) es independiente.
- **R2** doble representación contrato-grano (57) vs fichas (4 contratos): el LLM no debe doble-contar
  (mitigado por descripciones + citas por `public_id`).
- **R3/R4 (seguridad/PII)** `contracts_overview` metadata-only, sin cuit/contenido; INVOKER = fail-closed;
  `razon_social`+`detalle` redactados.
- **R6** lenguaje natural aún depende del planner; `docs_browse` no usa FTS para mitigar.

## 7. Rollback

`ROLLBACK_0178_docs_retrieval_improvements.md`: drop de las 2 RPC + restaurar la vista 0176 (definición exacta);
re-materializar `body` viejo = reproyección (paso de apply). TS: revertir por git (rama aislada, sin merge).

## 8. GO / NO GO

- **GO local**: cumplido (aditivo, metadata-only, RLS-preservada INVOKER, idempotente + rollback, evidencia
  read-only 4/41/57, gates verdes, eval + guard tests).
- **NO GO / fuera de scope**: texto/OCR/embeddings/pgvector; apply/deploy/push/merge/main; reproyección
  productiva; Drive/knowledge drain/cron/RBAC_ENFORCE. Apply/DRAFT/PROD = ventana futura con nueva autorización.

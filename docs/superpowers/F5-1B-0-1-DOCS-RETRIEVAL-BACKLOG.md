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

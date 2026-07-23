-- 0186_manual_nexus_kb_layer.sql
-- C1.5 · Habilita la capa "Manual Nexus / Ayuda Interna" en el KB del Copilot.
--
-- PROBLEMA (preflight 2026-07-08): la tabla company_knowledge_documents (mig
-- 0185) tiene 3 CHECK que NO admiten la metadata del Manual de Usuario de TOPS
-- Nexus, así que la ingesta rompería:
--   * capa         → hoy ('institucional','research');           falta 'manual_nexus'
--   * business_unit→ hoy (ANMAT,CARGAS_GENERALES,CORPORATIVO,     falta 'SISTEMA_NEXUS'
--                         REGULADOS,NEXUS,OTRO)
--   * source_type  → hoy (SITE_COMPLETO,LANDING,DOSSIER,…,        falta 'MANUAL_USUARIO'
--                         INVESTIGACION)                          (= document_type del manual)
--
-- SOLUCIÓN: extender los 3 CHECK con los valores nuevos (superset — no invalida
-- ninguna fila existente). NO agrega columnas, NO migra datos, NO toca 0180, NO
-- toca ninguna otra tabla. El retrieval ya soporta la capa: la RPC
-- ai_company_knowledge_search acepta p_capa, así que el tool del Copilot puede
-- apuntar a 'manual_nexus' sin cambiar la función.
--
-- Idempotente (drop constraint if exists + add). Es un CHECK sobre columnas TEXT
-- (no enum) → no requiere aislar 'alter type add value'.
--
-- ⚠️ ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor / execute_sql
-- del prod arsksytgdnzukbmfgkju tras OK. NO registrar en la tabla migrations,
-- NO db push (política del repo).

-- ── capa: + 'manual_nexus' ───────────────────────────────────────────────────
alter table public.company_knowledge_documents
  drop constraint if exists company_kb_capa_ck;
alter table public.company_knowledge_documents
  add constraint company_kb_capa_ck
  check (capa = any (array['institucional'::text, 'research'::text, 'manual_nexus'::text]));

-- ── business_unit: + 'SISTEMA_NEXUS' ─────────────────────────────────────────
alter table public.company_knowledge_documents
  drop constraint if exists company_kb_business_unit_ck;
alter table public.company_knowledge_documents
  add constraint company_kb_business_unit_ck
  check (business_unit = any (array[
    'ANMAT'::text, 'CARGAS_GENERALES'::text, 'CORPORATIVO'::text,
    'REGULADOS'::text, 'NEXUS'::text, 'OTRO'::text, 'SISTEMA_NEXUS'::text
  ]));

-- ── source_type: + 'MANUAL_USUARIO' ──────────────────────────────────────────
-- (= document_type del frontmatter; la tabla no tiene columna document_type, así
--  que source_type porta el tipo. Mayúscula-snake para respetar la convención
--  del enum existente. Si preferís el literal 'manual_sistema', avisá y lo cambio.)
alter table public.company_knowledge_documents
  drop constraint if exists company_kb_source_type_ck;
alter table public.company_knowledge_documents
  add constraint company_kb_source_type_ck
  check (source_type = any (array[
    'SITE_COMPLETO'::text, 'LANDING'::text, 'DOSSIER'::text, 'PROPUESTA_MODELO'::text,
    'ARGUMENTARIO'::text, 'FAQ'::text, 'CODIGO_ETICA'::text, 'IDENTIDAD_CORPORATIVA'::text,
    'CAPACITACION'::text, 'INVESTIGACION'::text, 'MANUAL_USUARIO'::text
  ]));

-- ── Kit de validación (READ-ONLY · correr después de aplicar) ────────────────
-- Debe devolver los 3 CHECK con los valores nuevos incluidos:
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.company_knowledge_documents'::regclass
--     and conname in ('company_kb_capa_ck','company_kb_business_unit_ck','company_kb_source_type_ck');
-- Y un smoke de admisión (rollback, 0 footprint):
--   begin;
--   insert into public.company_knowledge_documents
--     (title, source_type, business_unit, capa, estado, confidencialidad, ingestable)
--   values ('__probe__','MANUAL_USUARIO','SISTEMA_NEXUS','manual_nexus','VIGENTE','INTERNO',true);
--   rollback;  -- si no lanza CHECK violation, la capa quedó habilitada.

-- 0069_crm_opportunities_deal_name.sql
-- CRM360 — columna espejo del NOMBRE REAL del deal/oportunidad de Clientify.
--
-- CONTEXTO: el título comercial caía a `company_name`, que en algunos deals viene
-- poblado con una URL técnica de la API de Clientify
-- (p. ej. https://api.clientify.net/v1/companies/16216611/). El front ya sanea esa
-- URL (helper isClientifyApiUrl) y muestra un fallback comercial. Para mostrar el
-- NOMBRE REAL del deal hace falta persistirlo: esta columna es el espejo de display.
--
-- ⚠️ NO EJECUTAR sin autorización explícita. Aplicar en el SQL Editor de prod
--    (arsksytgdnzukbmfgkju) recién cuando se apruebe. Es aditiva e idempotente:
--    no borra datos, no toca otras columnas, segura de re-correr.
--
-- DESPUÉS DE APLICAR (fuera de este frente, requiere autorización aparte):
--   1) Agregar `clientify_deal_name` al SELECT de opportunities-supabase.ts
--      (LIST_SELECT/FULL_SELECT) — el mapper ya lo lee de forma defensiva.
--   2) Extender el upsert de sync (crm_ingest_deal) para escribir el `name` del Deal.
--      → NO se toca el sync en este frente.

alter table public.crm_opportunities
  add column if not exists clientify_deal_name text;

comment on column public.crm_opportunities.clientify_deal_name is
  'Nombre real del deal/oportunidad en Clientify (campo name del Deal). Espejo de display; el front lo prioriza como título. Poblar vía sync.';

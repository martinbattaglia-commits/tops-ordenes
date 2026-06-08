-- CRM360 · E1 — Columnas espejo de Clientify en crm_opportunities (campos mínimos del Deal).
-- Idempotente. NO aplicado a producción desde la sesión. Aplicar ANTES de 0053.
-- No toca lógica/RBAC/rutas; sólo agrega columnas para preservar el Deal crudo de Clientify.

alter table public.crm_opportunities add column if not exists company_name         text;
alter table public.crm_opportunities add column if not exists clientify_contact_id text;
alter table public.crm_opportunities add column if not exists owner_name           text;
alter table public.crm_opportunities add column if not exists clientify_modified   timestamptz;

comment on column public.crm_opportunities.company_name is 'Nombre de empresa del Deal Clientify (cuando no hay client_id linkeado).';
comment on column public.crm_opportunities.clientify_modified is 'Timestamp modified del Deal en Clientify (reconciliación/idempotencia por cambio).';

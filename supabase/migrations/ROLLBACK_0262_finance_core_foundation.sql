-- =========================================================================
-- ROLLBACK_0262_finance_core_foundation.sql — Reversión de 0262
-- =========================================================================

drop table if exists public.finance_quicken_imports cascade;
drop table if exists public.finance_document_inbox cascade;
drop table if exists public.finance_report_snapshots cascade;
drop table if exists public.finance_scenarios cascade;
drop table if exists public.finance_forecast_adjustments cascade;
drop table if exists public.finance_plan_lines cascade;
drop table if exists public.finance_cost_centers cascade;
drop table if exists public.finance_categories cascade;
drop table if exists public.finance_assumptions cascade;
drop table if exists public.finance_versions cascade;

delete from public.role_permissions where permission_id in (select id from public.permissions where slug like 'finanzas.%');
delete from public.permissions where slug like 'finanzas.%';

drop type if exists public.finance_currency_t;
drop type if exists public.finance_forecast_status_t;
drop type if exists public.finance_certainty_level_t;
drop type if exists public.finance_account_group_t;
drop type if exists public.finance_direction_t;
drop type if exists public.finance_version_status_t;

notify pgrst, 'reload schema';

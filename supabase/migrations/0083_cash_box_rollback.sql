-- =========================================================================
-- 0083_cash_box_rollback — revierte 0082 (NO aplicar salvo rollback explícito)
-- =========================================================================
-- Deja Caja Chica en cero. Orden inverso a 0082 (dependencias primero).
-- =========================================================================

drop view if exists public.v_cash_box_resumen;
drop view if exists public.v_cash_box_movimientos;

drop function if exists public.cash_box_replace_periodo(int, jsonb, uuid);

drop table if exists public.cash_box_snapshots;
drop table if exists public.cash_box_sync_log;
drop table if exists public.cash_box_category_rules;
drop table if exists public.cash_box_transactions;

drop type if exists public.cash_box_direction_t;

notify pgrst, 'reload schema';

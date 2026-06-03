-- =========================================================================
-- 0034_wms_packing_cancel.sql — MINI-GATE 4B.1: ANULAR PACKING UNIT.
--
-- Cierra la deuda operativa `anular_packing_unit()` (GATE_4C_READINESS_REPORT,
-- Bloqueante #3): un bulto VACÍO 'abierta' hoy queda trabado (no cierra porque
-- close exige ≥1 ítem; no anula porque no había RPC). Esta migración le da una
-- salida terminal limpia: 'abierta' (vacío) → 'anulada'.
--
-- ESTRATEGIA APROBADA — EMPTY-ONLY (diseño GATE_4B1_CANCEL_PACKING_UNIT_DESIGN):
--   · ÚNICA transición: 'abierta' (sin ítems) → 'anulada'.
--   · PROHIBIDO directo: 'cerrada' → 'anulada' (cerrada SIEMPRE tiene ítems por
--     el invariante de close). Vía correcta: reopen → unpack×N → anular.
--   · PROHIBIDO: 'despachada' → 'anulada' (territorio Gate 4C: reversión de despacho).
--   · 'anulada' es TERMINAL.
--
-- GARANTÍAS DURAS (cero cruce de dominios — 100% dentro de Packing):
--   · CERO impacto sobre stock (inventory_items.stock_available/stock_reserved).
--   · CERO impacto sobre ledger (inventory_movements) — ni se referencia.
--   · CERO impacto sobre FEFO (inventory_lots / allocate_order).
--   · CERO impacto sobre reservas (stock_allocations) — el guard de vacío lo garantiza.
--   · CERO impacto sobre pedidos (logistics_orders / _items) — roll-up-neutral:
--     un bulto vacío no referencia ninguna allocation → NO se invoca wms_pack_recompute.
--
-- ADDITIVE ONLY: NO crea enum ('anulada' ya existe en packing_status_t, 0033),
--   NO crea/altera tablas, NO crea permisos. Solo agrega UNA función + grant.
--   Las 6 RPC y 2 tablas de 0033 quedan INTACTAS.
--
-- AUDITORÍA (audit_log, único mecanismo): packing.cancel. RPC SECURITY DEFINER
--   (owner) → bypassa RLS para el insert, igual que 0027/0032/0033.
--
-- HOTFIX 42804 (uniforme con 0031/0032/0033): CAST EXPLÍCITO a enum en la
--   asignación de status. Las comparaciones van sin cast.
--
-- Re-ejecutable: create or replace / revoke/grant idempotentes.
-- ⚠️ Requiere 0024/0026/0027 + 0029/0030/0031 + 0032 + 0033 APLICADAS. NO aplicar aún.
-- =========================================================================

-- =========================================================================
-- anular_packing_unit — anula un bulto VACÍO 'abierta' → 'anulada'.
--   Patrón idéntico a reopen_packing_unit/close_packing_unit (0033). Guard de
--   vacío DURO: garantiza que jamás se toca stock_allocations.
-- =========================================================================
create or replace function public.anular_packing_unit(p_packing_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit  public.packing_units;
  v_items int;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_unit from public.packing_units where id = p_packing_unit_id for update;
  if not found then
    raise exception 'bulto % no existe', p_packing_unit_id using errcode = 'no_data_found';
  end if;

  -- Guard despacho (Gate 4C): un bulto despachado NO se anula acá. Mensaje que
  -- redirige a la reversión de despacho (revert_dispatch, Gate 4C).
  if v_unit.status = 'despachada' then
    raise exception 'bulto % ya despachado — usar reversión de despacho (Gate 4C)', v_unit.public_id;
  end if;

  -- EMPTY-ONLY: solo se anula un bulto ABIERTO. 'cerrada' (siempre con ítems) y
  -- 'anulada' (terminal) caen acá con mensaje que guía a reabrir/desempacar.
  if v_unit.status <> 'abierta' then
    raise exception 'bulto % no está abierto (estado %) — reabrí y desempacá antes de anular',
      v_unit.public_id, v_unit.status;
  end if;

  -- Guard de VACÍO (duro): es la barrera que garantiza CERO-touch de
  -- stock_allocations. Un bulto con contenido debe vaciarse con unpack_allocation
  -- (canal de 0033 autorizado a tocar reservas) antes de poder anularse.
  select count(*) into v_items from public.packing_unit_items where packing_unit_id = p_packing_unit_id;
  if v_items <> 0 then
    raise exception 'bulto % con contenido (% ítems) — desempacá las reservas antes de anular',
      v_unit.public_id, v_items;
  end if;

  -- Única escritura: estado terminal + desactivación (señal canónica = status).
  update public.packing_units
    set status = 'anulada'::packing_status_t, active = false
    where id = p_packing_unit_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'packing_unit', p_packing_unit_id, 'packing.cancel',
          jsonb_build_object(
            'order_id',  v_unit.order_id,
            'public_id', v_unit.public_id,
            'from',      'abierta',
            'to',        'anulada',
            'items',     0));
end;
$$;

-- ---- Grant: la RPC se invoca desde la app (rol authenticated) ------------
grant execute on function public.anular_packing_unit(uuid) to authenticated;

notify pgrst, 'reload schema';

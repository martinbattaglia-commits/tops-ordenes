-- P3-N1B · BACKFILL DETERMINISTA DE IDENTIDAD CANÓNICA WMS — TEMPLATE
-- =====================================================================
-- ESTADO: PREPARADO, NO EJECUTABLE COMO ESTÁ (set de asignaciones VACÍO).
-- Ejecutar únicamente con autorización expresa de Dirección, con 0219 ya
-- aplicada y el puente publicado. Uso: psql -v ON_ERROR_STOP=1 -f backfill.sql
--
-- REGLA: acá sólo entran pares (fila → client_id) designados por Dirección o
-- con evidencia DETERMINÍSTICA documentada en PLAN.md. PROHIBIDO inferir por
-- client_name.

begin;

-- ── 0) Precondición: 0219 aplicada (columna presente) ──────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'inventory_items'
       and column_name = 'client_id'
  ) then
    raise exception '[P3-N1B BACKFILL] 0219 no aplicada: no existe inventory_items.client_id';
  end if;
end $$;

-- ── 1) Conteos ANTES (esperados según auditoría 2026-08-13) ────────────
do $$
declare v_ii int; v_rc int; v_lo int;
begin
  select count(*) into v_ii from public.inventory_items  where client_id is null;
  select count(*) into v_rc from public.receptions       where client_id is null;
  select count(*) into v_lo from public.logistics_orders where client_id is null;
  raise notice '[P3-N1B BACKFILL] antes: inventory_items=% receptions=% logistics_orders=%', v_ii, v_rc, v_lo;
end $$;

-- ── 2) SET DE ASIGNACIONES AUTORIZADAS ─────────────────────────────────
-- VACÍO por decisión: la auditoría 2026-08-13 no halló NINGUNA fila con
-- evidencia determinística. Completar EXCLUSIVAMENTE con la decisión de
-- Dirección, una fila por par, con el expediente citado en el comentario:
create temporary table p3n1b_asignaciones (
  tabla      text not null check (tabla in ('inventory_items','receptions','logistics_orders')),
  fila_id    uuid not null,
  client_id  uuid not null,
  evidencia  text not null,
  primary key (tabla, fila_id)
) on commit drop;

-- EJEMPLO (NO ACTIVO):
-- insert into p3n1b_asignaciones values
--   ('inventory_items','c0c5b7b7-....-....-....-............','<uuid clients>','Resolución R-0NN de Dirección, 2026-08-XX');

-- ── 3) Controles del set: clientes existentes y activos, sin duplicados ─
do $$
declare v_bad int;
begin
  select count(*) into v_bad
    from p3n1b_asignaciones a
    left join public.clients c on c.id = a.client_id
   where c.id is null or c.activo is not true;
  if v_bad > 0 then
    raise exception '[P3-N1B BACKFILL] % asignación(es) apuntan a cliente inexistente o inactivo', v_bad;
  end if;
end $$;

-- ── 4) Aplicación (sólo filas con client_id NULL: nunca pisa identidad) ─
update public.inventory_items ii
   set client_id = a.client_id
  from p3n1b_asignaciones a
 where a.tabla = 'inventory_items' and ii.id = a.fila_id and ii.client_id is null;

update public.receptions r
   set client_id = a.client_id
  from p3n1b_asignaciones a
 where a.tabla = 'receptions' and r.id = a.fila_id and r.client_id is null;

update public.logistics_orders lo
   set client_id = a.client_id
  from p3n1b_asignaciones a
 where a.tabla = 'logistics_orders' and lo.id = a.fila_id and lo.client_id is null;

-- ── 5) Unicidad canónica preventiva (el criterio exacto de 0220 G-4) ───
do $$
declare v_dup int;
begin
  select count(*) into v_dup from (
    select client_id, sku, position_id
      from public.inventory_items
     where client_id is not null
     group by client_id, sku, position_id
    having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception '[P3-N1B BACKFILL] % identidad(es) canónica(s) duplicada(s): el backfill se aborta', v_dup;
  end if;
end $$;

-- ── 6) Verificación POSTERIOR: reproduce G-1/G-2/G-3 de 0220 ───────────
do $$
declare v_ii int; v_rc int; v_lo int;
begin
  select count(*) into v_ii from public.inventory_items  where client_id is null;
  select count(*) into v_rc from public.receptions       where client_id is null;
  select count(*) into v_lo from public.logistics_orders where client_id is null;
  raise notice '[P3-N1B BACKFILL] después: inventory_items=% receptions=% logistics_orders=%', v_ii, v_rc, v_lo;
  if v_ii + v_rc + v_lo > 0 then
    raise warning '[P3-N1B BACKFILL] cobertura INCOMPLETA: 0220 sigue BLOQUEADA (esto es correcto si Dirección no resolvió todas las filas)';
  end if;
end $$;

commit;

-- ── COMPENSACIÓN (rollback administrativo, ejecutar SOLO por orden expresa) ─
-- begin;
-- update public.inventory_items  set client_id = null where id in (select fila_id from ... );
-- update public.receptions       set client_id = null where id in (select fila_id from ... );
-- update public.logistics_orders set client_id = null where id in (select fila_id from ... );
-- commit;
-- (los ids tocados quedan registrados en el acta de la ventana de ejecución)

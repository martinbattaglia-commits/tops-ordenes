# COMPENSACIÓN 0220 · P3-N1B — Identidad canónica WMS

Este runbook define la reversión operativa autorizada de `0220` hacia el estado
transicional de `0219`. **0219 es forward-only**: sus columnas, identidades,
proyección de `business_unit`, trazabilidad `business_unit_source`, anomalías,
triggers y funciones canónicas se conservan.

La compensación es no destructiva e idempotente. Su único cambio de esquema es
devolver `inventory_items.client_id` a anulable. El índice canónico exacto se
mantiene y las RPC continúan resolviendo exclusivamente por `client_id`; por lo
tanto, toda operación sobre una fila todavía no resuelta permanece fail-closed.
Dos clientes canónicos distintos pueden conservar el mismo `client_name`, SKU y
posición sin colisionar ni perder datos.

> Aplicación manual y separada. Este expediente sólo verifica el runbook contra
> PostgreSQL local; no autoriza producción ni Supabase remoto.

## Límites del contrato

- No se restaura unicidad legacy por `client_name`.
- No se reemplazan `confirm_reception` ni `allocate_order` por versiones que
  decidan identidad a partir del nombre.
- No se eliminan columnas, tablas, tipos, anomalías ni datos.
- No se modifica `business_unit`, `business_unit_source` ni su procedencia.
- La restauración exacta al esquema histórico 0035 queda fuera de este contrato:
  requeriría una migración extraordinaria, destructiva y una autorización nueva.

## Paso 0 — precheck de evidencia (sólo lectura)

```sql
select
  (select count(*) from public.inventory_items where client_id is not null) as items_con_identidad,
  (select count(*) from public.inventory_items where client_id is null) as items_transicionales,
  (select count(*) from public.receptions where client_id is not null) as recepciones_con_identidad,
  (select count(*) from public.logistics_orders where client_id is not null) as pedidos_con_identidad,
  (select count(*) from public.inventory_bu_anomalies) as anomalias_preservadas,
  (select count(*) from public.stock_allocations where business_unit is not null) as reservas_con_bu;
```

## Paso 1 — compensación no destructiva de 0220

El bloque primero valida que el índice canónico existente sea el objeto exacto
esperado. Sólo entonces devuelve la columna a su nulabilidad transicional.

```sql
do $$
declare
  v_exact boolean;
begin
  select exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_index i on i.indexrelid = c.oid
      join pg_catalog.pg_class t on t.oid = i.indrelid
      join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
      join pg_catalog.pg_am am on am.oid = c.relam
      where n.nspname = 'public'
        and c.relname = 'inventory_items_canonical_identity_uk'
        and c.relkind = 'i'
        and tn.nspname = 'public'
        and t.relname = 'inventory_items'
        and am.amname = 'btree'
        and i.indisunique
        and i.indisvalid
        and i.indisready
        and i.indislive
        and i.indimmediate
        and i.indnullsnotdistinct
        and not i.indisprimary
        and not i.indisexclusion
        and i.indpred is null
        and i.indexprs is null
        and i.indnkeyatts = 3
        and i.indnatts = 3
        and coalesce((
          select array_agg(a.attname::text order by k.ord)
            from unnest(i.indkey::smallint[]) with ordinality as k(attnum, ord)
            left join pg_catalog.pg_attribute a
              on a.attrelid = i.indrelid and a.attnum = k.attnum
            where k.ord <= i.indnkeyatts
        ), array[]::text[]) = array['client_id', 'sku', 'position_id']::text[]
  ) into v_exact;

  if not v_exact then
    raise exception '[P3-N1B COMPENSATION] falta el índice canónico exacto; no se modifica la nulabilidad.';
  end if;
end $$;

alter table public.inventory_items alter column client_id drop not null;
notify pgrst, 'reload schema';
```

## Paso 2 — poscondiciones preservadoras

```sql
do $$
declare
  v_nullable text;
  v_exact boolean;
begin
  select c.is_nullable
    into v_nullable
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'inventory_items'
      and c.column_name = 'client_id';

  if v_nullable is distinct from 'YES' then
    raise exception '[P3-N1B COMPENSATION] inventory_items.client_id no quedó anulable.';
  end if;

  select exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_index i on i.indexrelid = c.oid
      join pg_catalog.pg_class t on t.oid = i.indrelid
      join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
      join pg_catalog.pg_am am on am.oid = c.relam
      where n.nspname = 'public'
        and c.relname = 'inventory_items_canonical_identity_uk'
        and c.relkind = 'i'
        and tn.nspname = 'public'
        and t.relname = 'inventory_items'
        and am.amname = 'btree'
        and i.indisunique
        and i.indisvalid
        and i.indisready
        and i.indislive
        and i.indimmediate
        and i.indnullsnotdistinct
        and not i.indisprimary
        and not i.indisexclusion
        and i.indpred is null
        and i.indexprs is null
        and i.indnkeyatts = 3
        and i.indnatts = 3
        and coalesce((
          select array_agg(a.attname::text order by k.ord)
            from unnest(i.indkey::smallint[]) with ordinality as k(attnum, ord)
            left join pg_catalog.pg_attribute a
              on a.attrelid = i.indrelid and a.attnum = k.attnum
            where k.ord <= i.indnkeyatts
        ), array[]::text[]) = array['client_id', 'sku', 'position_id']::text[]
  ) into v_exact;

  if not v_exact then
    raise exception '[P3-N1B COMPENSATION] el índice canónico exacto no fue preservado.';
  end if;

  if to_regclass('public.inventory_bu_anomalies') is null
     or to_regprocedure('public.wms_recompute_item_business_unit(uuid)') is null
     or to_regprocedure('public.confirm_reception(uuid)') is null
     or to_regprocedure('public.allocate_order(uuid)') is null then
    raise exception '[P3-N1B COMPENSATION] falta un artefacto preservador de 0219/0220.';
  end if;

  if not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'receptions'
         and column_name = 'business_unit_source'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'inventory_items'
         and column_name = 'business_unit'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'stock_allocations'
         and column_name = 'business_unit'
     ) then
    raise exception '[P3-N1B COMPENSATION] falta evidencia de business_unit o de su procedencia.';
  end if;
end $$;
```

## Reaplicación controlada

Mientras existan filas transicionales con `inventory_items.client_id` nulo,
`0220` debe abortar por G-1. Después de resolverlas administrativamente, la
reaplicación de `0220` vuelve a exigir G-1…G-5 y restaura `NOT NULL` sin cambiar
la identidad, las BU, su procedencia ni las anomalías preservadas.


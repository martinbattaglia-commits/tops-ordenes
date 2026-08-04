-- =========================================================================
-- 0219_wms_client_identity_foundation.sql — P3-N1B · Etapa 3.1 (fundación).
--
-- Identidad canónica de cliente y proyección de business_unit para el WMS,
-- conforme a P3-D1 (ADR-P3-06 §6.a/6.b, ADR-P3-11, ADR-P3-12, ADR-P3-13).
--
-- ADDITIVE ONLY sobre datos: ninguna fila se descarta, reasigna ni infiere.
--   · client_id (uuid → public.clients) ANULABLE en receptions,
--     inventory_items y logistics_orders (ADR-P3-13: anulable al inicio;
--     la obligatoriedad recién en 0220, tras demostrar cobertura 100 %).
--   · inventory_items.business_unit ANULABLE, derivado EXCLUSIVAMENTE de
--     reception_items.business_unit vía el vínculo inventory_item_id
--     (ADR-P3-06 §6.a). PROHIBIDA toda heurística (SKU/depósito/posición).
--   · Ítem multi-BU ⇒ atributo SIN VALOR + anomalía DURABLE (ADR-P3-11
--     reglas 3-5). Nunca se elige una línea; nunca se conserva una vieja.
--   · GENERAL explícito vs por omisión (P3-D1 v1.4 · M-03): se retira el
--     DEFAULT 'GENERAL' de receptions.business_unit y un trigger BEFORE
--     INSERT lo repone marcando business_unit_source = 'defaulted'. Una
--     inserción que declara el valor queda 'declared'. Las filas históricas
--     quedan 'unknown' (no demostrable): el default NO es evidencia.
--     La operación NO se bloquea: toda inserción que hoy funciona sigue
--     funcionando con el mismo resultado en business_unit.
--
-- 🔴 SIN BACKFILL DE client_id: la resolución nombre→identidad es un proceso
--    ADMINISTRATIVO con validación (ADR-P3-06 §6.b). Ninguna coincidencia por
--    client_name se considera definitiva sin validación. Esta migración NO
--    adivina.
--
-- NUMERACIÓN: el candidato Git inmutable bf33fa4 contiene migraciones hasta
-- 0218; por eso este archivo usa 0219 y no reutiliza números observados.
-- Esto demuestra sólo procedencia documental en Git: el estado de producción
-- y qué migraciones fueron aplicadas allí permanecen NO VERIFICABLES en este
-- expediente. P3-D1 presenta además metadatos v1.4 y changelog v1.5; M-03 se
-- implementa según su definición normativa v1.4, dejando esa inconsistencia
-- documental como dependencia externa y sin afirmar una resolución.
--
-- Idempotente: re-ejecutable sin error. Aplica Martín A MANO (G3). NO
-- requiere PostGIS. ⚠️ Requiere 0001/0024/0025/0030 aplicadas.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enum de trazabilidad de la declaración de BU -----------------------
-- Tres poblaciones de M-03: declarada / por omisión / no demostrable.
do $$ begin
  create type bu_declaration_t as enum ('declared', 'defaulted', 'unknown');
exception when duplicate_object then null; end $$;

-- ---- 1) Identidad canónica: client_id ANULABLE + FK restrict ------------
-- on delete RESTRICT: un cliente con operación registrada no puede
-- desaparecer en silencio (patrón integridad 0011). La identidad legacy
-- client_name SE CONSERVA como dato descriptivo (ADR-P3-13: no se retira,
-- no se renombra, no se vacía).
alter table public.receptions
  add column if not exists client_id uuid references public.clients(id) on delete restrict;
alter table public.inventory_items
  add column if not exists client_id uuid references public.clients(id) on delete restrict;
alter table public.logistics_orders
  add column if not exists client_id uuid references public.clients(id) on delete restrict;

create index if not exists receptions_client_id_idx       on public.receptions (client_id);
create index if not exists inventory_items_client_id_idx  on public.inventory_items (client_id);
create index if not exists logistics_orders_client_id_idx on public.logistics_orders (client_id);

-- ---- 2) Línea regulatoria proyectada + restricción declarada del pedido --
-- inventory_items.business_unit: ANULABLE durante la transición (ADR-P3-06:
-- exigirla antes de resolver la cobertura convertiría el defecto en bloqueo).
-- logistics_orders.business_unit: restricción DECLARADA del pedido; NULL =
-- pedido sin restricción de línea (comportamiento legacy, sin inventar dato).
alter table public.inventory_items
  add column if not exists business_unit business_unit_t;
alter table public.logistics_orders
  add column if not exists business_unit business_unit_t;
-- stock_allocations.business_unit: FOTO de la línea del ítem al reservar
-- (trazabilidad; NULL = ítem sin clasificar al momento de la reserva).
alter table public.stock_allocations
  add column if not exists business_unit business_unit_t;

create index if not exists inventory_items_bu_idx on public.inventory_items (business_unit);

-- ---- 3) GENERAL explícito vs por omisión (M-03) --------------------------
alter table public.receptions
  add column if not exists business_unit_source bu_declaration_t not null default 'unknown';

-- Se retira el DEFAULT: la omisión pasa por el trigger, que repone 'GENERAL'
-- y deja constancia de que NO hubo declaración. NOT NULL se evalúa DESPUÉS
-- de los triggers BEFORE ⇒ ninguna inserción existente se rompe.
alter table public.receptions alter column business_unit drop default;

create or replace function public.wms_reception_bu_declaration()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.business_unit is null then
      -- misma semántica operativa que el DEFAULT retirado, ahora con traza
      new.business_unit := 'GENERAL';
      new.business_unit_source := 'defaulted';
    else
      new.business_unit_source := 'declared';
    end if;
  else
    -- UPDATE OF business_unit
    if new.business_unit is null then
      raise exception 'business_unit no admite NULL: la línea de negocio no se des-declara (recepción %)',
        coalesce(old.public_id, old.id::text);
    end if;
    if new.business_unit is distinct from old.business_unit then
      new.business_unit_source := 'declared';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reception_bu_declaration on public.receptions;
create trigger trg_reception_bu_declaration
  before insert or update of business_unit on public.receptions
  for each row execute function public.wms_reception_bu_declaration();

-- ---- 4) Anomalías durables de línea (ADR-P3-11 regla 5) ------------------
create table if not exists public.inventory_bu_anomalies (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  kind text not null default 'multi_business_unit'
    constraint inventory_bu_anomalies_kind_ck check (kind in ('multi_business_unit')),
  business_units business_unit_t[] not null,   -- las BU en conflicto, para el resolutor
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,                     -- durable: se RESUELVE, no se borra
  notes text
);
create index if not exists inventory_bu_anomalies_item_idx
  on public.inventory_bu_anomalies (inventory_item_id);
-- A lo sumo UNA anomalía abierta por (ítem, tipo); la resolución la cierra.
create unique index if not exists inventory_bu_anomalies_open_uk
  on public.inventory_bu_anomalies (inventory_item_id, kind) where resolved_at is null;

alter table public.inventory_bu_anomalies enable row level security;
drop policy if exists "inventory_bu_anomalies read" on public.inventory_bu_anomalies;
create policy "inventory_bu_anomalies read" on public.inventory_bu_anomalies
  for select using (auth.role() = 'authenticated');
-- Sin policies de escritura: las anomalías las escribe EXCLUSIVAMENTE el
-- sistema (función definer de proyección). Fail-closed por omisión.

-- ---- 5) Proyección determinista de business_unit -------------------------
-- ÚNICA fuente: reception_items.business_unit vía inventory_item_id (N-6).
--   0 vínculos → SIN VALOR (no hay fuente; regla 3: nada de valores viejos).
--   1 BU       → se proyecta; una anomalía abierta se cierra.
--   >1 BU      → SIN VALOR + anomalía durable (ADR-P3-11; jamás se elige).
-- SECURITY DEFINER: corre desde triggers de usuarios operativos y debe poder
-- escribir el atributo proyectado y la anomalía pese al lockdown RLS de 0027.
create or replace function public.wms_recompute_item_business_unit(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_locked uuid;
  v_bus business_unit_t[];
begin
  if p_item_id is null then
    return;
  end if;

  -- Serializa recomputaciones concurrentes del mismo ítem. Si el ítem está
  -- siendo eliminado en esta misma transacción, no hay nada que proyectar.
  select id into v_locked from public.inventory_items where id = p_item_id for update;
  if v_locked is null then
    return;
  end if;

  select coalesce(array_agg(distinct ri.business_unit order by ri.business_unit), '{}')
    into v_bus
    from public.reception_items ri
    where ri.inventory_item_id = p_item_id;

  if coalesce(array_length(v_bus, 1), 0) = 1 then
    update public.inventory_items set business_unit = v_bus[1] where id = p_item_id;
    update public.inventory_bu_anomalies
      set resolved_at = now(),
          notes = coalesce(notes || ' · ', '') || 'reconvergió a ' || v_bus[1]::text
      where inventory_item_id = p_item_id and kind = 'multi_business_unit'
        and resolved_at is null;
  elsif coalesce(array_length(v_bus, 1), 0) > 1 then
    -- Regla 3 + 4: ni elegir, ni conservar una línea que dejó de ser cierta.
    update public.inventory_items set business_unit = null where id = p_item_id;
    insert into public.inventory_bu_anomalies (inventory_item_id, kind, business_units)
      values (p_item_id, 'multi_business_unit', v_bus)
      on conflict (inventory_item_id, kind) where resolved_at is null
      do update set business_units = excluded.business_units;
  else
    -- Sin vínculos: sin fuente de proyección ⇒ sin valor.
    update public.inventory_items set business_unit = null where id = p_item_id;
    update public.inventory_bu_anomalies
      set resolved_at = now(),
          notes = coalesce(notes || ' · ', '') || 'sin vínculos de recepción'
      where inventory_item_id = p_item_id and kind = 'multi_business_unit'
        and resolved_at is null;
  end if;
end;
$$;

-- Función interna del sistema: fuera de toda superficie invocable por roles.
revoke execute on function public.wms_recompute_item_business_unit(uuid) from public;
revoke execute on function public.wms_recompute_item_business_unit(uuid) from anon;
revoke execute on function public.wms_recompute_item_business_unit(uuid) from authenticated;

create or replace function public.wms_reception_item_bu_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.wms_recompute_item_business_unit(old.inventory_item_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.inventory_item_id is distinct from new.inventory_item_id then
    perform public.wms_recompute_item_business_unit(old.inventory_item_id);
  end if;
  perform public.wms_recompute_item_business_unit(new.inventory_item_id);
  return new;
end;
$$;

drop trigger if exists trg_reception_item_bu_projection on public.reception_items;
create trigger trg_reception_item_bu_projection
  after insert or update of inventory_item_id, business_unit or delete
  on public.reception_items
  for each row execute function public.wms_reception_item_bu_projection();

-- ---- 6) Backfill DETERMINISTA de la proyección (idempotente) -------------
-- Recorre únicamente ítems CON vínculo real. Cero heurística, cero descarte:
-- el resultado es función exacta de los vínculos existentes. Re-ejecutarlo
-- converge al mismo estado.
do $$
declare r record;
begin
  for r in
    select distinct ri.inventory_item_id as id
    from public.reception_items ri
    where ri.inventory_item_id is not null
  loop
    perform public.wms_recompute_item_business_unit(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

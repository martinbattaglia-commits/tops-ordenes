-- =========================================================================
-- 0194_treasury_beneficiaries.sql — T-004 · Gate 2 (beneficiario formal)
--
-- Expediente: "Tesorería Stabilization Pack" (2026-07-22) · entregable T-004.
-- Autoridad: Dirección — "selección formal de Beneficiario". ADITIVO.
--
-- Requiere 0193 COMMITEADA (el CHECK del punto 3 usa 'honorarios' y
--   'adelanto_sueldo', valores agregados al enum en 0193).
--
-- ⚠️ Se aplica A MANO por Dirección (G3 / DA-001). El asistente NO aplica.
--    Idempotente (if not exists / create or replace / drop+add de constraint).
--
-- PROBLEMA QUE RESUELVE
--   Un adelanto de sueldo o un honorario sin persona identificada no es
--   imputable por la Contadora. Hasta 0192 el único dato de destinatario era
--   `description` (texto libre) ⇒ no agrupable, no auditable, no reutilizable.
--
-- POR QUÉ UN CATÁLOGO PROPIO Y NO `rrhh_empleados`
--   La RLS de `rrhh_empleados` exige el permiso 'rrhh.view'
--   ( policy "rrhh_empleados read": has_permission('rrhh.view') OR profile_id = auth.uid() ).
--   Los perfiles que operan Tesorería NO lo tienen (p.ej. rol `admin_sin_rrhh`),
--   por lo que un FK a RRHH dejaría el selector VACÍO justamente para el usuario
--   que registra el movimiento, y filtraría el padrón de empleados hacia
--   Finanzas. Además el universo de beneficiarios excede a RRHH: directores y
--   profesionales que facturan honorarios no son empleados.
--   ⇒ Catálogo propio del bounded context Tesorería. Sin duplicación: no existe
--     hoy ninguna tabla de beneficiarios de pagos no-proveedor.
--
-- POR QUÉ NO `vendors`
--   Orden expresa del expediente: "No utilizar proveedores ficticios".
--   Un director o un empleado no es un proveedor.
-- =========================================================================

-- =========================================================================
-- 1. Tipo de beneficiario (create type: seguro dentro de transacción — no es
--    ALTER TYPE ADD VALUE sobre un enum preexistente)
-- =========================================================================
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'treasury_beneficiary_kind_t' and n.nspname = 'public') then
    create type public.treasury_beneficiary_kind_t as enum (
      'empleado',
      'director',
      'profesional',
      'tercero'
    );
  end if;
end $$;

-- =========================================================================
-- 2. Catálogo de beneficiarios
--    Append-only en la práctica: se da de baja con active=false, nunca DELETE
--    (G10). `document_id` es opcional: un adelanto de caja puede registrarse
--    antes de tener el CUIL a mano; los honorarios en cambio lo necesitan y la
--    UI lo pide, pero la regla dura vive en la RPC, no en el tipo.
-- =========================================================================
create table if not exists public.treasury_beneficiaries (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  kind        public.treasury_beneficiary_kind_t not null default 'tercero',
  document_id text,
  active      boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'treasury_beneficiaries_full_name_ck') then
    alter table public.treasury_beneficiaries
      add constraint treasury_beneficiaries_full_name_ck
      check (btrim(full_name) <> '');
  end if;
end $$;

-- Identidad única por nombre normalizado: evita "Juan Perez" / "juan perez  "
-- como dos beneficiarios distintos (que romperían el agrupamiento contable).
create unique index if not exists treasury_beneficiaries_name_uq
  on public.treasury_beneficiaries (lower(btrim(full_name)));

create index if not exists treasury_beneficiaries_active_idx
  on public.treasury_beneficiaries (active, lower(btrim(full_name)));

-- RLS — espejo EXACTO de bank_accounts (mismo bounded context, misma audiencia).
alter table public.treasury_beneficiaries enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='treasury_beneficiaries'
                   and policyname='treasury_beneficiaries read') then
    create policy "treasury_beneficiaries read" on public.treasury_beneficiaries
      for select using (
        public.current_role() = any (array['admin','operaciones','supervisor']::user_role_t[])
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='treasury_beneficiaries'
                   and policyname='treasury_beneficiaries write admin') then
    -- Alta/baja directa reservada a admin. El alta operativa NO pasa por acá:
    -- va por la RPC SECURITY DEFINER del punto 4 (RPC-first, G10).
    create policy "treasury_beneficiaries write admin" on public.treasury_beneficiaries
      for all using (public.current_role() = 'admin'::user_role_t)
             with check (public.current_role() = 'admin'::user_role_t);
  end if;
end $$;

grant select on public.treasury_beneficiaries to authenticated;

-- =========================================================================
-- 3. Vínculo movimiento → beneficiario + regla de obligatoriedad
-- =========================================================================
alter table public.treasury_movements
  add column if not exists beneficiary_id uuid references public.treasury_beneficiaries(id);

create index if not exists treasury_movements_beneficiary_idx
  on public.treasury_movements (beneficiary_id) where beneficiary_id is not null;

do $$
begin
  -- Coherencia: solo un movimiento operativo puede tener beneficiario.
  if not exists (select 1 from pg_constraint where conname = 'treasury_movements_beneficiary_scope_ck') then
    alter table public.treasury_movements
      add constraint treasury_movements_beneficiary_scope_ck
      check (beneficiary_id is null or type = 'movimiento_operativo');
  end if;
end $$;

-- Obligatoriedad por categoría. Las 5 categorías "de persona" exigen beneficiario;
-- regularizacion / gasto_operativo / otro no (no siempre hay una persona detrás).
-- Se recrea con drop+add para que la migración sea reaplicable sin error.
-- Filas existentes: las 8 de producción son type <> 'movimiento_operativo' ⇒ la
-- primera cláusula las satisface. Cero filas afectadas.
alter table public.treasury_movements
  drop constraint if exists treasury_movements_beneficiary_required_ck;

alter table public.treasury_movements
  add constraint treasury_movements_beneficiary_required_ck check (
       type <> 'movimiento_operativo'
    or operational_category not in ('honorarios','adelanto_sueldo','adelanto_director','adelanto_efectivo','reintegro')
    or beneficiary_id is not null
  );

-- =========================================================================
-- 4. RPC · tesoreria_register_operational_movement (v2 — con beneficiario)
--
--    Se DROPEA la firma anterior antes de crear la nueva: agregar parámetros a
--    una función existente NO la reemplaza, crea una SOBRECARGA, y PostgREST
--    no podría resolver cuál invocar (PGRST203). El drop es explícito y acotado
--    a la firma exacta de 0190/0191.
--
--    Resolución de beneficiario en UNA sola transacción (select-or-create): si
--    llega p_beneficiary_id se usa; si llega p_beneficiary_name se busca por
--    nombre normalizado y se crea si no existe. Así no quedan beneficiarios
--    huérfanos cuando el alta del movimiento falla: cae todo junto.
-- =========================================================================
drop function if exists public.tesoreria_register_operational_movement(
  date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, text
);

create or replace function public.tesoreria_register_operational_movement(
  p_date                 date,
  p_category             public.treasury_operational_category_t,
  p_direction            public.treasury_direction_t,
  p_bank_account_id      uuid,
  p_amount               numeric,
  p_concept              text,
  p_beneficiary_id       uuid default null,
  p_beneficiary_name     text default null,
  p_beneficiary_kind     public.treasury_beneficiary_kind_t default 'tercero',
  p_beneficiary_document text default null,
  p_observations         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_desc text;
  v_cur text; v_active boolean;
  v_mov uuid; v_pub text;
  v_ben uuid := p_beneficiary_id;
  v_ben_name text := nullif(btrim(coalesce(p_beneficiary_name, '')), '');
  v_ben_label text;
  v_requires boolean;
begin
  -- guarda de inserción: habilita el alta de tipos <> 'ajuste' (scope transacción)
  perform set_config('treasury.via_rpc', 'on', true);

  -- fail-closed (patrón HOTFIX 0055: NULL ↓ FALSE)
  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create' using errcode='42501';
  end if;
  if p_concept is null or btrim(p_concept) = '' then
    raise exception 'OPMOV_CONCEPT_REQUIRED: el concepto es obligatorio' using errcode='check_violation';
  end if;
  if p_direction is null then
    raise exception 'OPMOV_DIRECTION_INVALID: dirección requerida (ingreso|egreso)' using errcode='check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: el importe debe ser > 0' using errcode='check_violation';
  end if;

  select currency, active into v_cur, v_active from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'BANK_INVALID' using errcode='check_violation'; end if;
  if not v_active then raise exception 'BANK_INACTIVE' using errcode='check_violation'; end if;
  if v_cur <> 'ARS' then raise exception 'CURRENCY_UNSUPPORTED: solo ARS' using errcode='check_violation'; end if;

  -- ── Beneficiario (select-or-create atómico) ──────────────────────────────
  v_requires := p_category in ('honorarios','adelanto_sueldo','adelanto_director','adelanto_efectivo','reintegro');

  if v_ben is not null then
    select active into v_active from public.treasury_beneficiaries where id = v_ben;
    if not found then
      raise exception 'BENEFICIARY_INVALID: el beneficiario no existe' using errcode='check_violation';
    end if;
    if not v_active then
      raise exception 'BENEFICIARY_INACTIVE: el beneficiario está dado de baja' using errcode='check_violation';
    end if;

  elsif v_ben_name is not null then
    -- alta implícita: primero buscar por nombre normalizado (evita duplicados)
    select id into v_ben from public.treasury_beneficiaries
     where lower(btrim(full_name)) = lower(v_ben_name);
    if v_ben is null then
      insert into public.treasury_beneficiaries(full_name, kind, document_id, created_by)
      values (v_ben_name, coalesce(p_beneficiary_kind, 'tercero'),
              nullif(btrim(coalesce(p_beneficiary_document, '')), ''), v_uid)
      returning id into v_ben;
    end if;

  elsif v_requires then
    raise exception 'BENEFICIARY_REQUIRED: la categoría % exige identificar al beneficiario', p_category
      using errcode='check_violation';
  end if;

  v_desc := btrim(p_concept);

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, operational_category, beneficiary_id, status, created_by)
  values (coalesce(p_date, current_date), 'movimiento_operativo', p_direction, p_bank_account_id, p_amount, v_desc,
       'manual', p_category, v_ben, 'confirmado', v_uid)
  returning id, public_id into v_mov, v_pub;

  select full_name into v_ben_label from public.treasury_beneficiaries where id = v_ben;

  return jsonb_build_object(
    'movement_id', v_mov,
    'public_id', v_pub,
    'beneficiary_id', v_ben,
    'beneficiary_name', v_ben_label
  );
end; $$;

grant execute on function public.tesoreria_register_operational_movement(
  date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text,
  uuid, text, public.treasury_beneficiary_kind_t, text, text
) to authenticated;

-- =========================================================================
-- 5. Vista de lectura — movimientos operativos con el nombre del beneficiario
--    resuelto. Evita que la UI arme el join a mano (D1/D5: nada se calcula en
--    TS). NO agrega saldos ni totales: es una proyección de etiquetas.
--
--    ⚠️ security_invoker = true — OBLIGATORIO. Sin esta opción la vista se
--    evalúa con los privilegios del OWNER y BYPASSEA la RLS de
--    treasury_movements / treasury_beneficiaries, exponiendo Tesorería a
--    cualquier rol `authenticated`. Es la convención verificada del ERP:
--    treasury_bank_balances, customer_open_items, supplier_open_items,
--    customer_current_account y treasury_cashflow_projection la llevan todas.
-- =========================================================================
create or replace view public.treasury_operational_movements
with (security_invoker = true) as
  select m.id,
         m.public_id,
         m.date,
         m.direction,
         m.bank_account_id,
         m.amount,
         m.description,
         m.operational_category,
         m.status,
         m.beneficiary_id,
         b.full_name   as beneficiary_name,
         b.kind        as beneficiary_kind,
         b.document_id as beneficiary_document,
         m.created_at
    from public.treasury_movements m
    left join public.treasury_beneficiaries b on b.id = m.beneficiary_id
   where m.type = 'movimiento_operativo';

grant select on public.treasury_operational_movements to authenticated;

notify pgrst, 'reload schema';

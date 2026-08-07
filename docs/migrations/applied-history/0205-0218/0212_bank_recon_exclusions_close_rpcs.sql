-- =====================================================================
-- 0212 · CONCILIACIÓN BANCARIA — EXCLUSIONES GOBERNADAS + RPC DE CIERRE
--        (TREAS-RECON-001 · E2 · FUNCIONAL)
-- Grants de tablas bank_* existentes: NO se tocan (hardening separado).
-- ROLLBACK: ver supabase/migrations/ROLLBACK_0212_bank_recon_exclusions_close_rpcs.md
-- =====================================================================

-- ── 1 · Tabla de exclusiones gobernadas ───────────────────────────────
create table if not exists public.treasury_reconciliation_exclusions (
  id                    uuid primary key default gen_random_uuid(),
  treasury_movement_id  uuid not null unique references public.treasury_movements(id),
  motivo                text not null check (btrim(motivo) <> ''),
  expediente            text not null check (btrim(expediente) <> ''),
  active                boolean not null default true,
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid not null references auth.users(id) default auth.uid(),
  created_by_actor      text not null default coalesce(nullif(current_user::text,''),'desconocido'),
  created_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id),
  updated_at            timestamptz
);
alter table public.treasury_reconciliation_exclusions
  add column if not exists created_by_actor text not null default coalesce(nullif(current_user::text,''),'desconocido');

comment on table public.treasury_reconciliation_exclusions is
  'Movimientos de tesorería excluidos del universo de conciliación bancaria (p.ej. ajustes de baseline/cutover). Fuente gobernada — TREAS-RECON-001. Baja lógica vía active=false; DELETE prohibido (auditoría).';

create or replace function public.tg_touch_recon_exclusion()
returns trigger language plpgsql as $function$
begin
  if new.treasury_movement_id is distinct from old.treasury_movement_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'RECON_EXCLUSION_IMMUTABLE: treasury_movement_id/created_* no se modifican; usar active=false y crear otra fila'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_touch_recon_exclusion' and tgrelid='public.treasury_reconciliation_exclusions'::regclass) then
    create trigger trg_touch_recon_exclusion
      before update on public.treasury_reconciliation_exclusions
      for each row execute function public.tg_touch_recon_exclusion();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_forbid_delete_recon_exclusion' and tgrelid='public.treasury_reconciliation_exclusions'::regclass) then
    create trigger trg_forbid_delete_recon_exclusion
      before delete on public.treasury_reconciliation_exclusions
      for each row execute function public.tg_forbid_delete_financial();
  end if;
end $$;

alter table public.treasury_reconciliation_exclusions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname='tre_sel' and polrelid='public.treasury_reconciliation_exclusions'::regclass) then
    create policy tre_sel on public.treasury_reconciliation_exclusions
      for select using (public.has_permission('tesoreria.conciliacion.view'));
  end if;
end $$;

revoke all   on public.treasury_reconciliation_exclusions from public, anon, authenticated;
grant select on public.treasury_reconciliation_exclusions to authenticated;
grant all    on public.treasury_reconciliation_exclusions to service_role;

create or replace function public._recon_movement_excluido(p_movement_id uuid)
returns boolean language sql stable set search_path = 'public' as $function$
  select exists (
    select 1 from public.treasury_reconciliation_exclusions e
     where e.treasury_movement_id = p_movement_id and e.active
  );
$function$;
revoke all on function public._recon_movement_excluido(uuid) from public, anon;
grant execute on function public._recon_movement_excluido(uuid) to authenticated, service_role;

-- ── 2 · Carve-out del lock de movimientos confirmados ────────────────
create or replace function public.tg_lock_treasury_movement()
returns trigger language plpgsql as $function$
begin
  if old.status = 'anulado' then
    raise exception 'TREASURY_IMMUTABLE: movimiento anulado es inmutable' using errcode='check_violation';
  end if;
  if old.status = 'confirmado' then
    if coalesce(current_setting('recon.via_rpc', true), 'off') = 'on'
       and new.status = 'confirmado'
       and row(new.id,new.short_id,new.public_id,new.date,new.type,new.direction,
               new.bank_account_id,new.amount,new.description,new.reference_type,
               new.reference_id,new.transfer_group_id,new.created_by,new.created_at)
           is not distinct from
           row(old.id,old.short_id,old.public_id,old.date,old.type,old.direction,
               old.bank_account_id,old.amount,old.description,old.reference_type,
               old.reference_id,old.transfer_group_id,old.created_by,old.created_at)
       and new.voided_at  is not distinct from old.voided_at
       and new.voided_by  is not distinct from old.voided_by
       and new.void_reason is not distinct from old.void_reason
       and new.operational_category is not distinct from old.operational_category
       and new.beneficiary_id       is not distinct from old.beneficiary_id
       and (new.reconciled_at is distinct from old.reconciled_at
            or new.reconciled_statement_line_id is distinct from old.reconciled_statement_line_id)
    then
      return new;
    end if;
    if row(new.id,new.short_id,new.public_id,new.date,new.type,new.direction,
           new.bank_account_id,new.amount,new.description,new.reference_type,
           new.reference_id,new.transfer_group_id,new.created_by,new.created_at)
       is distinct from
       row(old.id,old.short_id,old.public_id,old.date,old.type,old.direction,
           old.bank_account_id,old.amount,old.description,old.reference_type,
           old.reference_id,old.transfer_group_id,old.created_by,old.created_at) then
      raise exception 'TREASURY_CONFIRMED_IMMUTABLE: solo se permite confirmado→anulado, sin alterar datos' using errcode='check_violation';
    end if;
    if new.status <> 'anulado' then
      raise exception 'TREASURY_CONFIRMED_IMMUTABLE: única transición permitida confirmado→anulado' using errcode='check_violation';
    end if;
    if new.voided_at is null or new.voided_by is null
       or new.void_reason is null or btrim(new.void_reason) = '' then
      raise exception 'TREASURY_VOID_REQUIRES_AUDIT: voided_at/voided_by/void_reason obligatorios' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $function$;

-- ── 3 · Aceptación ATÓMICA (1:1 y N:M) + exclusiones gobernadas ──────
drop function if exists public.tesoreria_recon_accept(uuid);
create or replace function public.tesoreria_recon_accept(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $function$
declare
  v_line       uuid;
  v_importe    numeric(15,2);
  v_excl       uuid;
  v_ya         uuid;
  v_n          int;
  v_suma       numeric(15,2);
  v_sellados   int;
begin
  if not public.has_permission('tesoreria.conciliacion.approve') then
    raise exception 'forbidden';
  end if;

  select m.statement_line_id, l.importe
    into v_line, v_importe
    from public.bank_reconciliation_matches m
    join public.bank_statement_lines l on l.id = m.statement_line_id
   where m.id = p_match_id and m.status = 'sugerido'
     for update of m;
  if v_line is null then raise exception 'match inexistente o ya decidido'; end if;

  perform 1
     from public.bank_reconciliation_match_movements mm
     join public.treasury_movements tm on tm.id = mm.movement_id
    where mm.match_id = p_match_id
      for update of tm;

  select count(*) into v_n
    from public.bank_reconciliation_match_movements
   where match_id = p_match_id;

  if v_n > 0 then
    select mm.movement_id into v_excl
      from public.bank_reconciliation_match_movements mm
     where mm.match_id = p_match_id
       and public._recon_movement_excluido(mm.movement_id)
     limit 1;
    if v_excl is not null then
      raise exception 'RECON_EXCLUDED_MOVEMENT: el movimiento % está excluido de conciliación (treasury_reconciliation_exclusions)', v_excl
        using errcode = 'check_violation';
    end if;

    select tm.id into v_ya
      from public.bank_reconciliation_match_movements mm
      join public.treasury_movements tm on tm.id = mm.movement_id
     where mm.match_id = p_match_id and tm.reconciled_at is not null
     limit 1;
    if v_ya is not null then
      raise exception 'RECON_MOVEMENT_ALREADY_RECONCILED: el movimiento % ya está conciliado', v_ya
        using errcode = 'check_violation';
    end if;

    update public.bank_reconciliation_match_movements mm
       set monto_imputado = tm.amount
      from public.treasury_movements tm
     where mm.match_id = p_match_id and tm.id = mm.movement_id;

    select coalesce(sum(monto_imputado), 0) into v_suma
      from public.bank_reconciliation_match_movements
     where match_id = p_match_id;
    if v_suma <> v_importe then
      raise exception 'RECON_ALLOCATION_MISMATCH: la suma imputada (%) no coincide con el importe de la línea (%)', v_suma, v_importe
        using errcode = 'check_violation';
    end if;

    perform set_config('recon.via_rpc', 'on', true);
    with sellados as (
      update public.treasury_movements tm
         set reconciled_at = now(),
             reconciled_statement_line_id = v_line
       where tm.id in (select movement_id from public.bank_reconciliation_match_movements where match_id = p_match_id)
         and tm.reconciled_at is null
      returning 1
    )
    select count(*) into v_sellados from sellados;
    perform set_config('recon.via_rpc', 'off', true);

    if v_sellados <> v_n then
      raise exception 'RECON_PARTIAL_SEAL: se sellaron % de % movimientos; la operación se revierte completa', v_sellados, v_n
        using errcode = 'check_violation';
    end if;
  end if;

  update public.bank_reconciliation_matches
     set status = 'aceptado', decided_by = auth.uid(), decided_at = now()
   where id = p_match_id;
  update public.bank_statement_lines
     set match_status = 'conciliado'
   where id = v_line;

  return jsonb_build_object('match_id', p_match_id, 'line_id', v_line, 'movimientos_sellados', coalesce(v_sellados, 0), 'imputado', coalesce(v_suma, 0));
end $function$;

-- ── 4 · Validación banco↔cuenta en la ingesta (defensa en profundidad) ─
create or replace function public.tesoreria_recon_ingest(p_bank_account_id uuid, p_file_path text, p_saldo_ok boolean, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = 'public' as $function$
declare
  v_stmt     uuid;
  v_line     jsonb;
  v_match    jsonb;
  v_line_id  uuid;
  v_match_id uuid;
  v_mov      text;
  v_banco    text;
  v_banco_cuenta text;
  v_acc      record;
begin
  if not public.has_permission('tesoreria.conciliacion.upload') then
    raise exception 'forbidden';
  end if;

  v_banco := lower(btrim(coalesce(p_payload -> 'statement' ->> 'banco', '')));
  v_banco := regexp_replace(v_banco, '\s+', ' ', 'g');
  if v_banco = '' then
    raise exception 'RECON_BANK_REQUIRED: el extracto no declara banco' using errcode='check_violation';
  end if;
  if v_banco not in ('santander','galicia') then
    raise exception 'RECON_BANK_UNSUPPORTED: banco "%" fuera del dominio soportado (santander, galicia)', v_banco using errcode='check_violation';
  end if;

  select id, bank_name, account_name, account_type, currency, active
    into v_acc from public.bank_accounts where id = p_bank_account_id;
  if v_acc.id is null then
    raise exception 'RECON_ACCOUNT_NOT_FOUND: la cuenta indicada no existe' using errcode='check_violation';
  end if;
  if not v_acc.active then
    raise exception 'RECON_ACCOUNT_INACTIVE: la cuenta % está inactiva', v_acc.account_name using errcode='check_violation';
  end if;
  if v_acc.account_type = 'caja' then
    raise exception 'RECON_ACCOUNT_NOT_BANK: la cuenta % es una caja; la conciliación bancaria requiere una cuenta bancaria', v_acc.account_name using errcode='check_violation';
  end if;
  v_banco_cuenta := case
                      when lower(v_acc.bank_name) like '%santander%' then 'santander'
                      when lower(v_acc.bank_name) like '%galicia%'   then 'galicia'
                      else null
                    end;
  if v_banco_cuenta is distinct from v_banco then
    raise exception 'RECON_BANK_MISMATCH: el extracto es de "%" pero la cuenta % pertenece a "%"', v_banco, v_acc.account_name, v_acc.bank_name using errcode='check_violation';
  end if;
  if v_acc.currency is not null and v_acc.currency <> 'ARS' then
    raise exception 'RECON_CURRENCY_UNSUPPORTED: la cuenta % opera en % y el pipeline actual sólo soporta ARS', v_acc.account_name, v_acc.currency using errcode='check_violation';
  end if;

  insert into public.bank_statements (
    bank_account_id, banco, source_kind, file_path,
    period_from, period_to, opening_balance, closing_balance,
    hash, status, uploaded_by
  ) values (
    p_bank_account_id,
    (p_payload -> 'statement' ->> 'banco'),
    (p_payload -> 'statement' ->> 'source_kind')::public.bank_source_t,
    p_file_path,
    (p_payload -> 'statement' ->> 'period_from')::date,
    (p_payload -> 'statement' ->> 'period_to')::date,
    (p_payload -> 'statement' ->> 'opening_balance')::numeric,
    (p_payload -> 'statement' ->> 'closing_balance')::numeric,
    (p_payload -> 'statement' ->> 'hash'),
    case when p_saldo_ok then 'procesado' else 'revisar' end,
    auth.uid()
  ) returning id into v_stmt;

  for v_line in select * from jsonb_array_elements(p_payload -> 'lines') loop
    insert into public.bank_statement_lines (
      statement_id, line_no, fecha, descripcion, importe, direction,
      saldo, referencia, contraparte, categoria, subtipo, codigo_concepto, match_status
    ) values (
      v_stmt,
      (v_line ->> 'line_no')::int,
      (v_line ->> 'fecha')::date,
      (v_line ->> 'descripcion'),
      (v_line ->> 'importe')::numeric,
      (v_line ->> 'direction')::public.treasury_direction_t,
      (v_line ->> 'saldo')::numeric,
      (v_line ->> 'referencia'),
      (v_line ->> 'contraparte'),
      (v_line ->> 'categoria'),
      (v_line ->> 'subtipo'),
      (v_line ->> 'codigo_concepto'),
      (v_line ->> 'match_status')::public.recon_line_status_t
    ) returning id into v_line_id;

    for v_match in
      select * from jsonb_array_elements(p_payload -> 'matches')
       where (value ->> 'line_no')::int = (v_line ->> 'line_no')::int
    loop
      insert into public.bank_reconciliation_matches (
        statement_line_id, score, method, status, motivo
      ) values (
        v_line_id,
        (v_match ->> 'score')::int,
        (v_match ->> 'method')::public.recon_method_t,
        'sugerido',
        (v_match ->> 'motivo')
      ) returning id into v_match_id;

      for v_mov in
        select jsonb_array_elements_text(v_match -> 'movement_ids')
      loop
        insert into public.bank_reconciliation_match_movements (
          match_id, movement_id, monto_imputado
        ) values (v_match_id, v_mov::uuid, 0)
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  return v_stmt;
end $function$;

-- ── 5 · reference_type: extensión ADITIVA del CHECK ───────────────────
alter table public.treasury_movements drop constraint if exists treasury_movements_reference_type_ck;
alter table public.treasury_movements add constraint treasury_movements_reference_type_ck
  check (reference_type is null or reference_type = any (array[
    'customer_receipt','supplier_payment','transfer','manual',
    'recon_systemic_batch','recon_line_adjustment'
  ]));

-- ── 5 bis · M5 · Idempotencia REAL (a prueba de concurrencia) ─────────
create unique index if not exists uq_recon_adjustment_activo
  on public.treasury_movements (reference_type, reference_id)
  where status = 'confirmado'
    and reference_type in ('recon_line_adjustment','recon_systemic_batch');

-- ── 6a · RPC: cierre de sistémicos por lote (D7) ──────────────────────
create or replace function public.tesoreria_recon_accept_systemic_batch(p_statement_id uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $function$
declare
  v_stmt      record;
  v_acc       record;
  v_egresos   numeric(15,2);
  v_ingresos  numeric(15,2);
  v_net       numeric(15,2);
  v_dir       public.treasury_direction_t;
  v_count     int;
  v_mov_id    uuid;
  v_public_id text;
begin
  if not public.has_permission('tesoreria.conciliacion.approve') then
    raise exception 'forbidden';
  end if;

  select id, bank_account_id, banco, period_from, period_to
    into v_stmt from public.bank_statements where id = p_statement_id;
  if v_stmt.id is null then
    raise exception 'RECON_STATEMENT_NOT_FOUND: extracto inexistente' using errcode='check_violation';
  end if;

  select id, account_name, account_type, active
    into v_acc from public.bank_accounts where id = v_stmt.bank_account_id;
  if v_acc.account_type = 'caja' or not v_acc.active then
    raise exception 'RECON_ACCOUNT_NOT_BANK: el extracto % está asociado a una cuenta no bancaria o inactiva (%)', p_statement_id, v_acc.account_name
      using errcode='check_violation';
  end if;

  if exists (
    select 1 from public.treasury_movements
     where reference_type = 'recon_systemic_batch'
       and reference_id = p_statement_id
       and status = 'confirmado'
  ) then
    raise exception 'RECON_SYSTEMIC_BATCH_EXISTS: los sistémicos de este extracto ya fueron registrados' using errcode='check_violation';
  end if;

  select count(*),
         coalesce(sum(importe) filter (where direction = 'egreso'), 0),
         coalesce(sum(importe) filter (where direction = 'ingreso'), 0)
    into v_count, v_egresos, v_ingresos
    from public.bank_statement_lines
   where statement_id = p_statement_id and match_status = 'sistemico';
  if v_count = 0 then
    raise exception 'RECON_NO_SYSTEMIC_LINES: el extracto no tiene líneas sistémicas pendientes' using errcode='check_violation';
  end if;

  v_net := v_egresos - v_ingresos;
  if v_net = 0 then
    raise exception 'RECON_SYSTEMIC_NET_ZERO: el neto sistémico es 0; no corresponde ajuste' using errcode='check_violation';
  end if;
  v_dir := case when v_net > 0 then 'egreso'::public.treasury_direction_t else 'ingreso'::public.treasury_direction_t end;

  begin
    insert into public.treasury_movements
      (date, type, direction, bank_account_id, amount, description,
       reference_type, reference_id, status, created_by)
    values
      (coalesce(v_stmt.period_to, current_date),
       'ajuste', v_dir, v_stmt.bank_account_id, abs(v_net),
       format('Conciliación · sistémicos %s %s→%s (%s líneas: egresos %s / ingresos %s) — TREAS-RECON-001',
              v_stmt.banco, coalesce(v_stmt.period_from::text,'?'), coalesce(v_stmt.period_to::text,'?'),
              v_count, v_egresos, v_ingresos),
       'recon_systemic_batch', p_statement_id, 'confirmado', auth.uid())
    returning id, public_id into v_mov_id, v_public_id;
  exception when unique_violation then
    raise exception 'RECON_SYSTEMIC_BATCH_EXISTS: los sistémicos de este extracto ya fueron registrados' using errcode='check_violation';
  end;

  return jsonb_build_object(
    'adjustment_id', v_mov_id,
    'public_id',     v_public_id,
    'lines',         v_count,
    'egresos',       v_egresos,
    'ingresos',      v_ingresos,
    'net',           v_net
  );
end $function$;

-- ── 6b · RPC: ajuste por línea sin contraparte (diferencia) ───────────
create or replace function public.tesoreria_recon_create_adjustment(p_line_id uuid, p_bank_account_id uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $function$
declare
  v_line      record;
  v_acc       record;
  v_mov_id    uuid;
  v_public_id text;
begin
  if not public.has_permission('tesoreria.conciliacion.approve') then
    raise exception 'forbidden';
  end if;

  select l.id, l.fecha, l.descripcion, l.importe, l.direction, l.match_status,
         s.bank_account_id, s.banco
    into v_line
    from public.bank_statement_lines l
    join public.bank_statements s on s.id = l.statement_id
   where l.id = p_line_id;
  if v_line.id is null then
    raise exception 'RECON_LINE_NOT_FOUND: línea de extracto inexistente' using errcode='check_violation';
  end if;
  if v_line.bank_account_id <> p_bank_account_id then
    raise exception 'RECON_ACCOUNT_MISMATCH: la cuenta indicada no corresponde al extracto de la línea' using errcode='check_violation';
  end if;

  select id, account_name, account_type, active
    into v_acc from public.bank_accounts where id = p_bank_account_id;
  if v_acc.account_type = 'caja' or not v_acc.active then
    raise exception 'RECON_ACCOUNT_NOT_BANK: cuenta no bancaria o inactiva (%)', v_acc.account_name using errcode='check_violation';
  end if;

  if v_line.match_status <> 'no_conciliado' then
    raise exception 'RECON_LINE_NOT_OPEN: la línea está en estado % y no admite ajuste', v_line.match_status using errcode='check_violation';
  end if;

  if exists (
    select 1 from public.treasury_movements
     where reference_type = 'recon_line_adjustment'
       and reference_id = p_line_id
       and status = 'confirmado'
  ) then
    raise exception 'RECON_LINE_ADJUSTMENT_EXISTS: la línea ya tiene un ajuste registrado' using errcode='check_violation';
  end if;

  begin
    insert into public.treasury_movements
      (date, type, direction, bank_account_id, amount, description,
       reference_type, reference_id, status, created_by)
    values
      (v_line.fecha, 'ajuste', v_line.direction, p_bank_account_id, v_line.importe,
       format('Ajuste conciliación · %s — TREAS-RECON-001', left(v_line.descripcion, 120)),
       'recon_line_adjustment', p_line_id, 'confirmado', auth.uid())
    returning id, public_id into v_mov_id, v_public_id;
  exception when unique_violation then
    raise exception 'RECON_LINE_ADJUSTMENT_EXISTS: la línea ya tiene un ajuste registrado' using errcode='check_violation';
  end;

  update public.bank_statement_lines
     set match_status = 'diferencia'
   where id = p_line_id;

  return jsonb_build_object('adjustment_id', v_mov_id, 'public_id', v_public_id);
end $function$;

-- ── 6c · M6 · Canal gobernado de alta de exclusiones ──────────────────
create or replace function public.tesoreria_recon_add_exclusion(
  p_movement_id uuid,
  p_motivo      text,
  p_expediente  text,
  p_created_by  uuid default null,
  p_metadata    jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = 'public' as $function$
declare
  v_uid    uuid := auth.uid();
  v_author uuid;
  v_mov    record;
  v_id     uuid;
begin
  if v_uid is not null then
    if p_created_by is not null and p_created_by <> v_uid then
      raise exception 'RECON_EXCLUSION_ACTOR_FORBIDDEN: no se puede declarar un autor distinto del usuario autenticado'
        using errcode='check_violation';
    end if;
    if not public.has_permission('tesoreria.conciliacion.approve') then
      raise exception 'forbidden';
    end if;
    v_author := v_uid;
  else
    if p_created_by is null then
      raise exception 'RECON_EXCLUSION_ACTOR_REQUIRED: sin sesión autenticada, el data-op debe declarar created_by explícito'
        using errcode='check_violation';
    end if;
    if not exists (select 1 from auth.users u where u.id = p_created_by) then
      raise exception 'RECON_EXCLUSION_ACTOR_INVALID: el autor declarado no existe' using errcode='check_violation';
    end if;
    v_author := p_created_by;
  end if;

  select id, public_id, type, status into v_mov
    from public.treasury_movements where id = p_movement_id;
  if v_mov.id is null then
    raise exception 'RECON_EXCLUSION_MOVEMENT_NOT_FOUND: el movimiento no existe' using errcode='check_violation';
  end if;

  insert into public.treasury_reconciliation_exclusions
    (treasury_movement_id, motivo, expediente, active, metadata, created_by)
  values (p_movement_id, p_motivo, p_expediente, true,
          coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('public_id', v_mov.public_id), v_author)
  on conflict (treasury_movement_id) do nothing
  returning id into v_id;

  return jsonb_build_object(
    'exclusion_id', v_id,
    'ya_existia',   v_id is null,
    'movement',     v_mov.public_id,
    'created_by',   v_author,
    'actor',        current_user
  );
end $function$;

-- Grants de ejecución (mismo perfil que las RPC existentes).
revoke all on function public.tesoreria_recon_accept(uuid) from public, anon;
grant execute on function public.tesoreria_recon_accept(uuid) to authenticated, service_role;
revoke all on function public.tesoreria_recon_accept_systemic_batch(uuid) from public, anon;
revoke all on function public.tesoreria_recon_create_adjustment(uuid, uuid) from public, anon;
revoke all on function public.tesoreria_recon_add_exclusion(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.tesoreria_recon_accept_systemic_batch(uuid) to authenticated, service_role;
grant execute on function public.tesoreria_recon_create_adjustment(uuid, uuid) to authenticated, service_role;
grant execute on function public.tesoreria_recon_add_exclusion(uuid, text, text, uuid, jsonb) to authenticated, service_role;

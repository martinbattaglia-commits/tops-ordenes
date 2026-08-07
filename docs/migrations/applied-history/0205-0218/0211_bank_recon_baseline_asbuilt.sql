-- =====================================================================
-- 0211 · CONCILIACIÓN BANCARIA — BASELINE AS-BUILT (TREAS-RECON-001 · E2)
--
-- NATURALEZA: migración DOCUMENTAL e IDEMPOTENTE. Reconcilia el linaje del
-- repositorio con el esquema que YA EXISTE en producción.
--
-- ⚖️  DECLARACIÓN DE ORIGEN (reconciliación de linaje):
--   · Los objetos bank_* y las RPC tesoreria_recon_{ingest,accept,reject}
--     fueron aplicados A MANO en producción (≤ 2026-07-13; existe copia en el
--     schema de backup `bak_precleanup_20260713`), a partir del diseño
--     docs/conciliacion-bancaria/migrations-design.sql (numeración 0078-0080,
--     hoy obsoleta). NUNCA pasaron por supabase/migrations/.
--   · Esta migración NO pretende haber creado esos objetos originalmente:
--     los DOCUMENTA tal como son (as-built, verificado contra el catálogo de
--     Postgres el 2026-07-28 — expediente TREAS-RECON-001 · E0 BASELINE REPORT).
--   · Sobre una base que ya coincide es NO-OP garantizado: todo es
--     `if not exists` / `create or replace` byte-equivalente / guardas DO.
--   · Las RPC de cierre (accept_systemic_batch / create_adjustment) NO están
--     acá: nunca existieron y son cambio funcional → 0212.
--   · Grants de tablas: NO se tocan (hardening separado, por resolución de
--     Dirección 2026-07-28).
--
-- ROLLBACK: no aplica. Esta migración no altera un entorno coincidente; en un
-- entorno vacío crea el módulo completo (comportamiento deseado para replays).
-- =====================================================================

-- ── Tipos ─────────────────────────────────────────────────────────────
do $$ begin
  create type public.bank_source_t        as enum ('csv','xls','pdf');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.recon_line_status_t  as enum ('conciliado','posible','no_conciliado','diferencia','sistemico');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.recon_match_status_t as enum ('sugerido','aceptado','rechazado');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.recon_method_t       as enum ('sistemico','exacto','aproximado','ia','n_m','ninguno');
exception when duplicate_object then null; end $$;

-- ── Tablas ────────────────────────────────────────────────────────────
create table if not exists public.bank_statements (
  id               uuid primary key default gen_random_uuid(),
  bank_account_id  uuid not null references public.bank_accounts(id),
  banco            text not null,
  source_kind      public.bank_source_t not null,
  file_path        text,
  period_from      date,
  period_to        date,
  opening_balance  numeric(15,2),
  closing_balance  numeric(15,2),
  hash             text not null,
  status           text not null default 'procesado',
  uploaded_by      uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (bank_account_id, hash)
);

create table if not exists public.bank_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  statement_id    uuid not null references public.bank_statements(id) on delete cascade,
  line_no         int not null,
  fecha           date not null,
  descripcion     text not null,
  importe         numeric(15,2) not null,
  direction       public.treasury_direction_t not null,
  saldo           numeric(15,2),
  referencia      text,
  contraparte     text,
  categoria       text not null default 'operativo',
  subtipo         text,
  codigo_concepto text,
  match_status    public.recon_line_status_t not null default 'no_conciliado',
  raw             jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists public.bank_reconciliation_matches (
  id                 uuid primary key default gen_random_uuid(),
  statement_line_id  uuid not null references public.bank_statement_lines(id) on delete cascade,
  score              int not null check (score between 0 and 100),
  method             public.recon_method_t not null,
  status             public.recon_match_status_t not null default 'sugerido',
  group_id           uuid,
  decided_by         uuid references auth.users(id),
  decided_at         timestamptz,
  motivo             text,
  created_at         timestamptz not null default now()
);

create table if not exists public.bank_reconciliation_match_movements (
  match_id       uuid not null references public.bank_reconciliation_matches(id) on delete cascade,
  movement_id    uuid not null references public.treasury_movements(id),
  monto_imputado numeric(15,2) not null,
  primary key (match_id, movement_id)
);

-- ── Aditivo sobre treasury_movements ──────────────────────────────────
alter table public.treasury_movements
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_statement_line_id uuid references public.bank_statement_lines(id);

-- ── Índices ───────────────────────────────────────────────────────────
create index if not exists ix_tm_concilia  on public.treasury_movements (bank_account_id, date, status) where reconciled_at is null;
create index if not exists ix_tm_importe   on public.treasury_movements (amount);
create index if not exists ix_bsl_statement on public.bank_statement_lines (statement_id);
create index if not exists ix_bsl_match     on public.bank_statement_lines (importe, fecha) where match_status <> 'conciliado';
create index if not exists ix_brm_line      on public.bank_reconciliation_matches (statement_line_id);
create index if not exists ix_brm_aceptado  on public.bank_reconciliation_matches (status) where status = 'aceptado';
create index if not exists ix_brmm_movement on public.bank_reconciliation_match_movements (movement_id);

-- ── Vista resumen ─────────────────────────────────────────────────────
create or replace view public.bank_reconciliation_summary
with (security_invoker = true) as
select s.id as statement_id, s.banco, s.period_from, s.period_to,
       count(*) filter (where l.match_status = 'conciliado')              as conciliados,
       count(*) filter (where l.match_status = 'posible')                 as posibles,
       count(*) filter (where l.match_status = 'no_conciliado')           as no_conciliados,
       count(*) filter (where l.match_status = 'sistemico')               as sistemicos,
       coalesce(sum(l.importe) filter (where l.match_status in ('conciliado','sistemico')),0) as monto_conciliado,
       coalesce(sum(l.importe) filter (where l.match_status in ('posible','no_conciliado')),0) as monto_pendiente,
       s.closing_balance,
       (select balance from public.treasury_bank_balances b where b.bank_account_id = s.bank_account_id) as saldo_nexus
from public.bank_statements s
left join public.bank_statement_lines l on l.statement_id = s.id
group by s.id;

-- ── RBAC (permisos de aplicación) ─────────────────────────────────────
insert into public.permissions (module, slug, label)
select v.module::public.permission_module_t, v.slug, v.label
from (values
  ('tesoreria','tesoreria.conciliacion.view',    'Conciliación · ver'),
  ('tesoreria','tesoreria.conciliacion.upload',  'Conciliación · subir extracto'),
  ('tesoreria','tesoreria.conciliacion.approve', 'Conciliación · aprobar')
) as v(module, slug, label)
where not exists (select 1 from public.permissions p where p.slug = v.slug);
-- NOTA as-built: las asignaciones reales en prod (role_permissions) son
-- admin, admin_sin_rrhh, director_ops, gerencia, super_admin para los 3 slugs.
-- Son DATA de RBAC administrada por el módulo de roles; no se siembran acá.

-- ── RLS + policies (SELECT-only; escritura SOLO vía RPC) ──────────────
alter table public.bank_statements                     enable row level security;
alter table public.bank_statement_lines                enable row level security;
alter table public.bank_reconciliation_matches         enable row level security;
alter table public.bank_reconciliation_match_movements enable row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polname='bs_sel'  and polrelid='public.bank_statements'::regclass) then
    create policy bs_sel  on public.bank_statements             for select using (public.has_permission('tesoreria.conciliacion.view'));
  end if;
  if not exists (select 1 from pg_policy where polname='bsl_sel' and polrelid='public.bank_statement_lines'::regclass) then
    create policy bsl_sel on public.bank_statement_lines        for select using (public.has_permission('tesoreria.conciliacion.view'));
  end if;
  if not exists (select 1 from pg_policy where polname='brm_sel' and polrelid='public.bank_reconciliation_matches'::regclass) then
    create policy brm_sel on public.bank_reconciliation_matches for select using (public.has_permission('tesoreria.conciliacion.view'));
  end if;
  if not exists (select 1 from pg_policy where polname='brmm_sel' and polrelid='public.bank_reconciliation_match_movements'::regclass) then
    create policy brmm_sel on public.bank_reconciliation_match_movements for select using (public.has_permission('tesoreria.conciliacion.view'));
  end if;
end $$;

-- ── RPC as-built (cuerpos byte-equivalentes a producción, E0 §2) ──────
-- IDEMPOTENCIA CRUZADA: 0212 recrea `tesoreria_recon_accept` con retorno
-- `jsonb` (aceptación atómica N:M). Si esta baseline se re-ejecutara sobre
-- una base que YA tiene 0212, un `create or replace` fallaría ("cannot change
-- return type") y, peor aún, si no fallara degradaría la función a la versión
-- defectuosa. Se omite entonces la recreación cuando ya existe una versión
-- posterior; la baseline sigue describiendo el estado as-built original.
do $baseline_accept$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'tesoreria_recon_accept'
       and pg_get_function_result(p.oid) <> 'void'
  ) then
    raise notice '0211: tesoreria_recon_accept ya fue evolucionada (0212); se preserva la versión vigente.';
    return;
  end if;

  execute $ddl$
create or replace function public.tesoreria_recon_accept(p_match_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_line uuid; v_mov uuid;
begin
  if not public.has_permission('tesoreria.conciliacion.approve') then
    raise exception 'forbidden';
  end if;
  select statement_line_id into v_line
    from public.bank_reconciliation_matches
   where id = p_match_id and status = 'sugerido';
  if v_line is null then raise exception 'match inexistente o ya decidido'; end if;
  select movement_id into v_mov
    from public.bank_reconciliation_match_movements
   where match_id = p_match_id limit 1;
  update public.bank_reconciliation_matches
     set status = 'aceptado', decided_by = auth.uid(), decided_at = now()
   where id = p_match_id;
  update public.bank_statement_lines
     set match_status = 'conciliado'
   where id = v_line;
  if v_mov is not null then
    update public.treasury_movements
       set reconciled_at = now(),
           reconciled_statement_line_id = v_line
     where id = v_mov and reconciled_at is null;
  end if;
end $function$;
  $ddl$;
end
$baseline_accept$;

create or replace function public.tesoreria_recon_reject(p_match_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $function$
begin
  if not public.has_permission('tesoreria.conciliacion.approve') then
    raise exception 'forbidden';
  end if;
  update public.bank_reconciliation_matches
     set status = 'rechazado', decided_by = auth.uid(), decided_at = now()
   where id = p_match_id and status = 'sugerido';
end $function$;

create or replace function public.tesoreria_recon_ingest(p_bank_account_id uuid, p_file_path text, p_saldo_ok boolean, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = 'public' as $function$
declare
  v_stmt     uuid;
  v_line     jsonb;
  v_match    jsonb;
  v_line_id  uuid;
  v_match_id uuid;
  v_mov      text;
begin
  if not public.has_permission('tesoreria.conciliacion.upload') then
    raise exception 'forbidden';
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

-- Grants de EJECUCIÓN idénticos al estado real (authenticated + service_role).
revoke all on function public.tesoreria_recon_accept(uuid)                     from public, anon;
revoke all on function public.tesoreria_recon_reject(uuid)                     from public, anon;
revoke all on function public.tesoreria_recon_ingest(uuid, text, boolean, jsonb) from public, anon;
grant execute on function public.tesoreria_recon_accept(uuid)                     to authenticated, service_role;
grant execute on function public.tesoreria_recon_reject(uuid)                     to authenticated, service_role;
grant execute on function public.tesoreria_recon_ingest(uuid, text, boolean, jsonb) to authenticated, service_role;

-- ── Storage ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bank-statements','bank-statements', false, 20971520,
        array['application/pdf','text/csv','application/vnd.ms-excel','text/plain'])
on conflict (id) do nothing;

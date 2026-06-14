-- =====================================================================
-- CONCILIACIÓN BANCARIA IA · V1 — MIGRACIONES DE DISEÑO (Sprint 3)
--
-- ⚠️  DISEÑO — NO APLICADAS. No están en supabase/migrations/ a propósito,
--     para evitar aplicación accidental. Al aprobar, mover a la ruta viva
--     con los números definitivos (ver nota de colisión).
--
-- NUMERACIÓN: 0078/0079/0080.  (0076 y 0077 OCUPADAS y APLICADAS a prod por el
--     módulo Contratos: 0076_crm_contracts, 0077_contracts_drive_sync.)
--
-- Naturaleza: tablas + índices + vista + RLS + RPC (security definer,
--     append-only) + storage. ADITIVO sobre treasury_movements (nullable).
--     NO toca fiscal/ARCA/IVA ni recalcula saldos (D1/D5 intactos).
-- =====================================================================


-- ========================= 0078 · CORE ===============================
do $$ begin
  create type public.bank_source_t       as enum ('csv','xls','pdf');               -- Santander CSV primario · XLS alterno · Galicia PDF
  create type public.recon_line_status_t as enum ('conciliado','posible','no_conciliado','diferencia','sistemico');
  create type public.recon_match_status_t as enum ('sugerido','aceptado','rechazado');
  create type public.recon_method_t      as enum ('sistemico','exacto','aproximado','ia','n_m','ninguno');
exception when duplicate_object then null; end $$;

create table if not exists public.bank_statements (
  id               uuid primary key default gen_random_uuid(),
  bank_account_id  uuid not null references public.bank_accounts(id),
  banco            text not null,                         -- 'galicia' | 'santander'
  source_kind      public.bank_source_t not null,
  file_path        text,                                  -- objeto en bucket bank-statements
  period_from      date,
  period_to        date,
  opening_balance  numeric(15,2),
  closing_balance  numeric(15,2),
  hash             text not null,                         -- idempotencia (OB7)
  status           text not null default 'procesado',
  uploaded_by      uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (bank_account_id, hash)                          -- mismo extracto no se ingesta 2 veces
);

create table if not exists public.bank_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  statement_id    uuid not null references public.bank_statements(id) on delete cascade,
  line_no         int not null,
  fecha           date not null,
  descripcion     text not null,
  importe         numeric(15,2) not null,                 -- ABSOLUTO; el signo va en direction
  direction       public.treasury_direction_t not null,  -- 'ingreso'(crédito) | 'egreso'(débito) — enum de 0053
  saldo           numeric(15,2),
  referencia      text,
  contraparte     text,
  categoria       text not null default 'operativo',      -- 'sistemico' | 'operativo'
  subtipo         text,                                   -- ley_25413_*, sircreb, iva, … (sistémicos)
  codigo_concepto text,                                   -- código Santander (4633, 1743, …)
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
  group_id           uuid,                                -- agrupa los N de un N:M
  decided_by         uuid references auth.users(id),
  decided_at         timestamptz,
  motivo             text,
  created_at         timestamptz not null default now()
);

-- Puente N:M (una línea ↔ varios treasury_movements) — OB3.
create table if not exists public.bank_reconciliation_match_movements (
  match_id       uuid not null references public.bank_reconciliation_matches(id) on delete cascade,
  movement_id    uuid not null references public.treasury_movements(id),
  monto_imputado numeric(15,2) not null,
  primary key (match_id, movement_id)
);

-- ADITIVO sobre treasury_movements (nullable → no rompe consumidores · OB4).
alter table public.treasury_movements
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_statement_line_id uuid references public.bank_statement_lines(id);

-- Índices (OB2).
create index if not exists ix_tm_concilia        on public.treasury_movements (bank_account_id, date, status) where reconciled_at is null;
create index if not exists ix_tm_importe          on public.treasury_movements (amount);
create index if not exists ix_bsl_statement       on public.bank_statement_lines (statement_id);
create index if not exists ix_bsl_match           on public.bank_statement_lines (importe, fecha) where match_status <> 'conciliado';
create index if not exists ix_brm_line            on public.bank_reconciliation_matches (statement_line_id);
create index if not exists ix_brm_aceptado        on public.bank_reconciliation_matches (status) where status = 'aceptado';
create index if not exists ix_brmm_movement        on public.bank_reconciliation_match_movements (movement_id); -- lado movimiento del puente N:M

-- Vista resumen (Dashboard) — security_invoker, derivada.
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


-- ============== 0079 · RBAC + RLS + RPC (write-path) ==================
-- Permisos (slugs). 'tesoreria' ya existe en permission_module_t (0052).
insert into public.permissions (module, slug, label) values
  ('tesoreria','tesoreria.conciliacion.view',    'Conciliación · ver'),
  ('tesoreria','tesoreria.conciliacion.upload',  'Conciliación · subir extracto'),
  ('tesoreria','tesoreria.conciliacion.approve', 'Conciliación · aprobar')
on conflict do nothing;

alter table public.bank_statements                    enable row level security;
alter table public.bank_statement_lines               enable row level security;
alter table public.bank_reconciliation_matches        enable row level security;
alter table public.bank_reconciliation_match_movements enable row level security;

-- SELECT: requiere permiso de ver. INSERT/UPDATE: SOLO vía RPC (security definer).
create policy bs_sel  on public.bank_statements             for select using (public.has_permission('tesoreria.conciliacion.view'));
create policy bsl_sel on public.bank_statement_lines        for select using (public.has_permission('tesoreria.conciliacion.view'));
create policy brm_sel on public.bank_reconciliation_matches for select using (public.has_permission('tesoreria.conciliacion.view'));
create policy brmm_sel on public.bank_reconciliation_match_movements for select using (public.has_permission('tesoreria.conciliacion.view'));

-- RPC: aceptar una sugerencia (humano). LOCK + enlace (NO crea asiento). Append-only.
create or replace function public.tesoreria_recon_accept(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_line uuid; v_mov uuid;
begin
  if not public.has_permission('tesoreria.conciliacion.approve') then
    raise exception 'forbidden';
  end if;
  select statement_line_id into v_line from public.bank_reconciliation_matches where id = p_match_id and status = 'sugerido';
  if v_line is null then raise exception 'match inexistente o ya decidido'; end if;
  -- 1:1 (exacto/aprox/ia) → enlazar el movimiento; N:M usa la tabla puente.
  select movement_id into v_mov from public.bank_reconciliation_match_movements where match_id = p_match_id limit 1;
  update public.bank_reconciliation_matches
     set status = 'aceptado', decided_by = auth.uid(), decided_at = now()
   where id = p_match_id;
  update public.bank_statement_lines set match_status = 'conciliado' where id = v_line;
  if v_mov is not null then
    update public.treasury_movements
       set reconciled_at = now(), reconciled_statement_line_id = v_line
     where id = v_mov and reconciled_at is null;   -- LOCK: no re-conciliar (OB7)
  end if;
end $$;

create or replace function public.tesoreria_recon_reject(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('tesoreria.conciliacion.approve') then raise exception 'forbidden'; end if;
  update public.bank_reconciliation_matches set status='rechazado', decided_by=auth.uid(), decided_at=now()
   where id = p_match_id and status = 'sugerido';
end $$;

-- RPC: ingesta (persiste statement + lines + matches desde el payload jsonb del
-- pipeline). Append-only; todo entra en estado 'sugerido' — nunca registra solo.
create or replace function public.tesoreria_recon_ingest(
  p_bank_account_id uuid, p_file_path text, p_saldo_ok boolean, p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_stmt uuid; v_line jsonb; v_match jsonb; v_line_id uuid; v_match_id uuid; v_mov text;
begin
  if not public.has_permission('tesoreria.conciliacion.upload') then raise exception 'forbidden'; end if;
  insert into public.bank_statements(bank_account_id, banco, source_kind, file_path, period_from, period_to,
    opening_balance, closing_balance, hash, status, uploaded_by)
  values (p_bank_account_id, (p_payload->'statement'->>'banco'), (p_payload->'statement'->>'source_kind')::public.bank_source_t,
    p_file_path, (p_payload->'statement'->>'period_from')::date, (p_payload->'statement'->>'period_to')::date,
    (p_payload->'statement'->>'opening_balance')::numeric, (p_payload->'statement'->>'closing_balance')::numeric,
    (p_payload->'statement'->>'hash'), case when p_saldo_ok then 'procesado' else 'revisar' end, auth.uid())
  returning id into v_stmt;
  -- líneas (line_no como índice) + matches con su puente N:M
  for v_line in select * from jsonb_array_elements(p_payload->'lines') loop
    insert into public.bank_statement_lines(statement_id, line_no, fecha, descripcion, importe, direction, saldo,
      referencia, contraparte, categoria, subtipo, codigo_concepto, match_status)
    values (v_stmt, (v_line->>'line_no')::int, (v_line->>'fecha')::date, (v_line->>'descripcion'),
      (v_line->>'importe')::numeric, (v_line->>'direction')::public.treasury_direction_t, (v_line->>'saldo')::numeric,
      (v_line->>'referencia'), (v_line->>'contraparte'), (v_line->>'categoria'), (v_line->>'subtipo'),
      (v_line->>'codigo_concepto'), (v_line->>'match_status')::public.recon_line_status_t)
    returning id into v_line_id;
    for v_match in select * from jsonb_array_elements(p_payload->'matches') where (value->>'line_no')::int = (v_line->>'line_no')::int loop
      insert into public.bank_reconciliation_matches(statement_line_id, score, method, status, motivo)
      values (v_line_id, (v_match->>'score')::int, (v_match->>'method')::public.recon_method_t, 'sugerido', (v_match->>'motivo'))
      returning id into v_match_id;
      for v_mov in select jsonb_array_elements_text(v_match->'movement_ids') loop
        insert into public.bank_reconciliation_match_movements(match_id, movement_id, monto_imputado)
        values (v_match_id, v_mov::uuid, 0) on conflict do nothing;
      end loop;
    end loop;
  end loop;
  return v_stmt;
end $$;

-- (tesoreria_recon_create_adjustment y _accept_systemic_batch: mismo patrón
--  security-definer + has_permission('…approve'); el batch sistémico genera UN
--  ajuste por lote con aprobación humana — respeta "nunca registra solo" · D7.)

-- RBAC seed: asignar el permiso de aprobación al rol/operadora del piloto (Natalia).
-- (Ejemplo; ajustar al modelo real de role_permissions/user_roles del proyecto.)
insert into public.role_permissions (role, slug)
select r.role, p.slug
from (values ('admin'),('supervisor')) as r(role)
cross join (values ('tesoreria.conciliacion.view'),('tesoreria.conciliacion.upload'),('tesoreria.conciliacion.approve')) as p(slug)
on conflict do nothing;


-- ===================== 0080 · STORAGE ================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bank-statements','bank-statements', false, 20971520,
        array['application/pdf','text/csv','application/vnd.ms-excel','text/plain'])
on conflict (id) do nothing;
-- Sin policy de lectura directa → acceso SOLO por signed URL server-side.
-- Datos bancarios sensibles (CBU/saldos): cifrado en reposo + redacción de CBU
--   antes de cualquier egress a IA (OB11/D6).

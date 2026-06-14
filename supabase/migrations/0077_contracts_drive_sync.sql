-- =========================================================================
-- 0077_contracts_drive_sync — Sincronización CRM Contratos ↔ Google Drive
-- =========================================================================
-- Contexto (Addendum al diseño del módulo Contratos):
--   Google Drive («Comercial → Cynthia → Clientes») pasa a ser la FUENTE DE
--   VERDAD OPERATIVA de la cartera contractual. Un job diario (21:00 ART) recorre
--   la carpeta, detecta altas/cambios/bajas de documentos y actualiza el
--   repositorio Nexus. Esta migración agrega:
--     · estado de sincronización por documento y por contrato (detección de cambios),
--     · bitácora de corridas (contract_sync_runs) y eventos (contract_sync_events).
--
--   Reutiliza la integración Drive corporativa existente (service account) — no crea
--   una integración nueva. Mirror del patrón de auditoría clientify_sync_log (0045).
--
-- Requiere: 0076_crm_contracts.sql.
-- NO aplicada a producción desde esta sesión (esperar aprobación de Dirección).
-- =========================================================================

-- ---- Extensiones a contracts (origen + estado de sync) ------------------
alter table public.contracts
  add column if not exists source           text not null default 'audit',   -- audit | drive | manual
  add column if not exists drive_folder_id  text,                            -- carpeta del cliente en Drive
  add column if not exists drive_modified_at timestamptz,
  add column if not exists last_synced_at   timestamptz;

do $$ begin
  alter table public.contracts
    add constraint contracts_source_chk check (source in ('audit','drive','manual'));
exception when duplicate_object then null; end $$;

-- ---- Extensiones a contract_documents (detección de cambios + texto) ----
alter table public.contract_documents
  add column if not exists md5_checksum     text,
  add column if not exists drive_modified_at timestamptz,
  add column if not exists size_bytes       bigint,
  add column if not exists mime_type        text,
  add column if not exists extracted_text   text,
  add column if not exists text_source      text,   -- native | gdoc | gsheet | xlsx | pdf_text | ocr | none
  add column if not exists quality          text not null default 'pendiente', -- ok | sin_texto | parcial | error | pendiente
  add column if not exists sync_status      text not null default 'synced',    -- synced | removed | error
  add column if not exists last_synced_at   timestamptz,
  add column if not exists sync_error       text;

-- Índice único del upsert por archivo de Drive (un doc por drive_file_id).
-- NO parcial: Postgres exige un índice único completo como árbitro de
-- `ON CONFLICT (drive_file_id)` (un índice parcial no se infiere sin repetir su
-- predicado). drive_file_id NULL se trata como distinto ⇒ admite docs sin Drive.
create unique index if not exists contract_documents_drive_file_uniq
  on public.contract_documents (drive_file_id);

create index if not exists contract_documents_sync_status_idx
  on public.contract_documents (sync_status);

-- ---- contract_sync_runs (bitácora de corridas, una fila por ejecución) --
create table if not exists public.contract_sync_runs (
  id                 bigserial primary key,
  run_id             uuid not null unique default gen_random_uuid(),
  trigger            text not null default 'cron',     -- cron | manual | api
  status             text not null default 'running',  -- running | completed | partial | error | skipped
  folder_id          text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  duration_ms        integer,
  folders_scanned    integer not null default 0,
  docs_seen          integer not null default 0,
  docs_new           integer not null default 0,
  docs_updated       integer not null default 0,
  docs_removed       integer not null default 0,
  contracts_upserted integer not null default 0,
  alerts_raised      integer not null default 0,
  errors             integer not null default 0,
  message            text,
  report             jsonb,
  created_by         uuid references auth.users(id) on delete set null,
  constraint contract_sync_runs_status_chk
    check (status in ('running','completed','partial','error','skipped')),
  constraint contract_sync_runs_trigger_chk
    check (trigger in ('cron','manual','api'))
);

create index if not exists contract_sync_runs_started_idx
  on public.contract_sync_runs (started_at desc);

-- ---- contract_sync_events (bitácora granular, append-only) --------------
create table if not exists public.contract_sync_events (
  id            bigserial primary key,
  run_id        uuid not null references public.contract_sync_runs(run_id) on delete cascade,
  level         text not null default 'info',   -- info | warn | error
  category      text not null,                  -- folder | document | contract | alert
  action        text not null,                  -- new | updated | removed | adenda_modificada | rescision_detectada | error | ...
  drive_file_id text,
  contract_id   uuid references public.contracts(id) on delete set null,
  titulo        text,
  detail        text,
  created_at    timestamptz not null default now(),
  constraint contract_sync_events_level_chk check (level in ('info','warn','error'))
);

create index if not exists contract_sync_events_run_idx
  on public.contract_sync_events (run_id, created_at);
create index if not exists contract_sync_events_alert_idx
  on public.contract_sync_events (level, created_at desc)
  where level in ('warn','error');

-- ---- RLS ----------------------------------------------------------------
-- Lectura para staff interno; escritura vía service-role (admin client, que
-- omite RLS). Se agregan policies de staff por consistencia con 0076.
alter table public.contract_sync_runs   enable row level security;
alter table public.contract_sync_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['contract_sync_runs','contract_sync_events'] loop
    -- `create policy` no admite IF NOT EXISTS → drop previo para idempotencia.
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format($f$
      create policy "%1$s read" on public.%1$s
        for select to authenticated
        using (public.current_role() in ('admin','supervisor','operaciones'));
    $f$, t);
    execute format('drop policy if exists "%1$s write" on public.%1$s', t);
    execute format($f$
      create policy "%1$s write" on public.%1$s
        for all to authenticated
        using (public.current_role() in ('admin','supervisor','operaciones'))
        with check (public.current_role() in ('admin','supervisor','operaciones'));
    $f$, t);
  end loop;
end $$;

grant select, insert, update, delete on public.contract_sync_runs, public.contract_sync_events to authenticated;
grant usage, select on sequence public.contract_sync_runs_id_seq, public.contract_sync_events_id_seq to authenticated;

-- =========================================================================
-- Verificación (correr post-migración):
--   select column_name from information_schema.columns
--     where table_name='contract_documents' and column_name in
--       ('md5_checksum','extracted_text','quality','sync_status');   -- 4 filas
--   select tablename from pg_tables where tablename like 'contract_sync%'; -- 2
-- =========================================================================

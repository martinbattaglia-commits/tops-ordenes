-- =========================================================================
-- 0081_compliance_drive_sync — Compliance Cockpit ↔ Google Drive (ingesta diaria)
-- =========================================================================
-- Contexto:
--   El Compliance Cockpit (/anmat) pasa a ser un sistema VIVO: Google Drive es la
--   fuente documental de verdad y Supabase la capa persistente que alimenta el
--   tablero. Un job diario (21:00 ART = 00:00 UTC) recorre la carpeta regulatoria,
--   detecta documentos (altas/cambios/bajas), los cataloga, asocia a ítems
--   regulatorios, recalcula alertas y registra trazabilidad.
--
--   Esta migración EXTIENDE 0065_compliance_core.sql (que creó compliance_items y
--   sembró el snapshot de auditoría del 08/06/2026). Es ADITIVA e IDEMPOTENTE:
--   no borra ni reescribe el inventario auditado. El snapshot sigue siendo el
--   fallback de la app (src/lib/compliance/data.ts).
--
--   Reutiliza la integración Drive corporativa (service account) — no crea una
--   integración nueva. Mirror del patrón 0077_contracts_drive_sync.
--
-- Requiere: 0065_compliance_core.sql.
-- NO aplicada a producción desde esta sesión (esperar aprobación de Dirección).
-- =========================================================================

-- ---- 1) compliance_items: origen + estado de sincronización -------------
alter table public.compliance_items
  add column if not exists source           text not null default 'audit',  -- audit | drive | manual
  add column if not exists drive_folder_id  text,
  add column if not exists last_synced_at   timestamptz;

do $$ begin
  alter table public.compliance_items
    add constraint compliance_items_source_chk check (source in ('audit','drive','manual'));
exception when duplicate_object then null; end $$;

-- ---- 2) compliance_categories (catálogo de referencia, seed de las 12) ---
create table if not exists public.compliance_categories (
  slug       text primary key,
  nombre     text not null,
  orden      int  not null default 0,
  created_at timestamptz not null default now()
);

insert into public.compliance_categories (slug, nombre, orden) values
  ('habilitacion','Habilitación',1),
  ('impacto_ambiental','Impacto Ambiental',2),
  ('residuos','Residuos',3),
  ('incendio','Incendio',4),
  ('seguridad','Seguridad',5),
  ('simulacros','Simulacros',6),
  ('electricidad','Electricidad',7),
  ('plagas','Plagas',8),
  ('agua','Agua',9),
  ('seguros','Seguros',10),
  ('anmat','ANMAT',11),
  ('acumar','ACUMAR',12)
on conflict (slug) do nothing;

-- ---- 3) compliance_documents (1 fila por archivo de Drive) --------------
create table if not exists public.compliance_documents (
  id                uuid primary key default gen_random_uuid(),
  item_id           text references public.compliance_items(id) on delete set null,
  sede              text,                       -- MAGALDI | LUJAN | null (no determinado)
  categoria         text,
  tipo_doc          text,
  organismo         text,
  titulo            text not null,
  drive_file_id     text,
  url               text,
  mime_type         text,
  size_bytes        bigint,
  md5_checksum      text,                       -- checksum de Drive (detección de cambios)
  sha256            text,                       -- hash de contenido (opcional, si se descarga)
  drive_modified_at timestamptz,
  fecha_emision     date,
  fecha_vencimiento date,
  estado            text,
  riesgo            text,
  sync_status       text not null default 'synced',  -- synced | removed | error
  sync_error        text,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now()
);

-- Índice único árbitro del upsert por archivo de Drive (NULL = distinto ⇒ admite
-- documentos sin Drive). No parcial: Postgres exige índice único completo para
-- inferir ON CONFLICT (drive_file_id).
create unique index if not exists compliance_documents_drive_file_uniq
  on public.compliance_documents (drive_file_id);
create index if not exists compliance_documents_item_idx
  on public.compliance_documents (item_id);
create index if not exists compliance_documents_sync_status_idx
  on public.compliance_documents (sync_status);
create index if not exists compliance_documents_sede_idx
  on public.compliance_documents (sede);

-- ---- 4) compliance_alerts (alertas materializadas 30/60/90 + faltantes) -
create table if not exists public.compliance_alerts (
  id               uuid primary key default gen_random_uuid(),
  item_id          text references public.compliance_items(id) on delete cascade,
  nivel            text not null,              -- critical | warning | ok
  kind             text not null,              -- expiration | missing_doc | audit_observation | regulatory_update
  titulo           text,
  detalle          text,
  due_date         date,
  dias             int,
  notificado_mail  boolean not null default false,
  notificado_nexus boolean not null default false,
  run_id           uuid,
  estado           text not null default 'abierta',  -- abierta | resuelta | descartada
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  constraint compliance_alerts_nivel_chk check (nivel in ('critical','warning','ok')),
  constraint compliance_alerts_estado_chk check (estado in ('abierta','resuelta','descartada'))
);

create index if not exists compliance_alerts_item_idx
  on public.compliance_alerts (item_id);
create index if not exists compliance_alerts_estado_idx
  on public.compliance_alerts (estado, created_at desc);

-- ---- 5) compliance_sync_log (bitácora de corridas, 1 fila por ejecución) -
create table if not exists public.compliance_sync_log (
  id                   bigserial primary key,
  run_id               uuid not null unique default gen_random_uuid(),
  trigger              text not null default 'cron',     -- cron | manual | api
  status               text not null default 'running',  -- running | completed | partial | error | skipped
  folder_id            text,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  duration_ms          integer,
  documents_scanned    integer not null default 0,
  documents_upserted   integer not null default 0,
  documents_removed    integer not null default 0,
  items_touched        integer not null default 0,
  alerts_created       integer not null default 0,
  errors               integer not null default 0,
  message              text,
  report               jsonb,
  created_by           uuid references auth.users(id) on delete set null,
  constraint compliance_sync_log_status_chk
    check (status in ('running','completed','partial','error','skipped')),
  constraint compliance_sync_log_trigger_chk
    check (trigger in ('cron','manual','api'))
);

create index if not exists compliance_sync_log_started_idx
  on public.compliance_sync_log (started_at desc);

-- ---- RLS ----------------------------------------------------------------
-- Lectura: cualquier usuario autenticado (el cockpit lo consumen staff internos,
-- consistente con la policy de lectura de compliance_items en 0065).
-- Escritura: roles administrativos (compatibles con RBAC) — el motor de sync usa
-- el cliente service-role, que omite RLS de todos modos.
alter table public.compliance_categories enable row level security;
alter table public.compliance_documents  enable row level security;
alter table public.compliance_alerts     enable row level security;
alter table public.compliance_sync_log   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'compliance_categories','compliance_documents','compliance_alerts','compliance_sync_log'
  ] loop
    -- `create policy` no admite IF NOT EXISTS → drop previo para idempotencia.
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format($f$
      create policy "%1$s read" on public.%1$s
        for select to authenticated using (true);
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

grant select, insert, update, delete
  on public.compliance_categories, public.compliance_documents,
     public.compliance_alerts, public.compliance_sync_log
  to authenticated;
grant usage, select on sequence public.compliance_sync_log_id_seq to authenticated;

-- =========================================================================
-- Verificación (correr post-migración):
--   select tablename from pg_tables where tablename like 'compliance_%';
--     -- compliance_items, compliance_categories, compliance_documents,
--     -- compliance_alerts, compliance_sync_log  (5 filas)
--   select column_name from information_schema.columns
--     where table_name='compliance_items' and column_name in
--       ('source','drive_folder_id','last_synced_at');           -- 3 filas
--   select count(*) from public.compliance_categories;           -- 12
-- =========================================================================

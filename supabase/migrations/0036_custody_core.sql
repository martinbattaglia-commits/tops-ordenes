-- =========================================================================
-- 0036_custody_core.sql — GATE 5: CADENA DE CUSTODIA · CORE (solo modelo de datos).
--
-- Capa de evidencia y auditoría visual ADDITIVE sobre packing_units / shipments
-- (Gates 4B/4C). NO mueve stock ni ledger. Esta migración es SOLO el núcleo de
-- datos: enums + tablas + integridad (doble FK + CHECK + hash-chain + append-only)
-- + tokens QR (modelo) + PostGIS. SIN RPC, SIN Storage, SIN signed URLs, SIN PDF, SIN UI.
--   · RPC de captura/erasure/verify  → 0038 (Evidence + Chain)
--   · Storage (buckets) + signed URLs → 0037
--   · POD (generate_pod) + lecturas   → 0039
--
-- ALCANCE (aprobado · GATE_5_*_DESIGN/REVIEW/IMPLEMENTATION_PLAN):
--   · Enums: custody_stage_t (req. por la tabla), custody_event_type_t, evidence_kind_t.
--   · Tablas: custody_events, custody_evidence, delivery_pods.
--   · Integridad: DOBLE FK NULLABLE (packing_unit_id | shipment_id) + CHECK de
--     exclusividad; HASH-CHAIN por entidad (prev_hash/row_hash, trigger BEFORE INSERT);
--     APPEND-ONLY (bloqueo UPDATE/DELETE/TRUNCATE, patrón inventory_movements 0026).
--   · QR: columnas custody_token en packing_units y shipments (modelo; el QR-imagen es app-side).
--   · PostGIS: geo_lat/geo_lng + geom GENERATED geometry(Point,4326) (patrón Tracking 0016).
--
-- INTEGRIDAD/HASH-CHAIN: row_hash = SHA256(prev_hash ‖ campos_canónicos ‖ evidence_sha256).
--   Se usa el sha256() BUILT-IN de PostgreSQL (pg_catalog) → sin dependencia de pgcrypto
--   ni de schema. La cadena se serializa por entidad con pg_advisory_xact_lock.
--
-- REDACCIÓN (erasure de PII, cambio #6): custody_evidence es append-only salvo el FLIP
--   controlado redacted=false→true (+ redacted_at); el resto de columnas es inmutable.
--   El borrado del binario en Storage y la RPC de erasure son de 0038.
--
-- DESVIACIÓN DOCUMENTADA vs plan: custody_evidence se crea NO particionada (PK simple `id`)
--   para preservar FK limpias (delivery_pods.signature_evidence_id → custody_evidence(id)).
--   El particionado mensual es una optimización operativa diferible (ver reporte).
--
-- HOTFIX 42804 (uniforme 0031–0035): CAST EXPLÍCITO a enum en toda asignación.
-- Re-ejecutable: create [or replace] / if not exists / do-block guard de enums.
-- ⚠️ Requiere 0024/0026/0030/0033/0035 + PostGIS (0016) APLICADAS. Backup manual previo (PITR off).
-- =========================================================================

create extension if not exists "pgcrypto";

-- =========================================================================
-- Enums nuevos
-- =========================================================================
do $$ begin
  create type custody_stage_t as enum ('packing', 'despacho', 'transporte', 'entrega', 'pod');
exception when duplicate_object then null; end $$;

do $$ begin
  create type custody_event_type_t as enum ('foto_packing', 'cargado', 'en_transito', 'foto_entrega', 'firmado', 'pod');
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_kind_t as enum ('foto', 'firma', 'documento');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- Columnas aditivas — tokens QR (modelo). Token OPACO (no public_id).
-- gen_random_uuid() es volátil → cada fila existente recibe un token único.
-- =========================================================================
alter table public.packing_units add column if not exists custody_token uuid;
alter table public.shipments     add column if not exists custody_token uuid;
update public.packing_units set custody_token = gen_random_uuid() where custody_token is null;
update public.shipments     set custody_token = gen_random_uuid() where custody_token is null;
alter table public.packing_units alter column custody_token set default gen_random_uuid();
alter table public.shipments     alter column custody_token set default gen_random_uuid();
do $$ begin
  alter table public.packing_units add constraint packing_units_custody_token_uk unique (custody_token);
exception when duplicate_table or duplicate_object then null; end $$;
do $$ begin
  alter table public.shipments add constraint shipments_custody_token_uk unique (custody_token);
exception when duplicate_table or duplicate_object then null; end $$;

-- =========================================================================
-- Secuencias (public_id legible + orden de cadena)
-- =========================================================================
create sequence if not exists public.custody_event_short_id_seq start 1;
create sequence if not exists public.custody_event_chain_seq start 1;
create sequence if not exists public.delivery_pod_short_id_seq start 1;

-- =========================================================================
-- Tabla: custody_events — línea de tiempo append-only + HASH-CHAIN
-- =========================================================================
create table if not exists public.custody_events (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.custody_event_short_id_seq'),
  public_id text not null unique,                  -- 'CUST-2026-0001' (trigger)
  chain_seq bigint not null default nextval('public.custody_event_chain_seq'),  -- orden determinístico de la cadena
  -- DOBLE FK NULLABLE + CHECK de exclusividad (integridad referencial real):
  packing_unit_id uuid references public.packing_units(id) on delete restrict,
  shipment_id     uuid references public.shipments(id)     on delete restrict,
  stage      custody_stage_t not null,
  event_type custody_event_type_t not null,
  actor_id   uuid references auth.users(id) on delete set null,   -- QUIÉN
  occurred_at timestamptz not null default now(),                 -- CUÁNDO
  geo_lat    double precision,                                     -- DÓNDE (opcional/configurable)
  geo_lng    double precision,
  geo_accuracy_m numeric,
  geo_source text,                                                 -- 'device' | 'traccar' | null
  geom       extensions.geometry(Point, 4326)                      -- PostGIS (patrón 0016)
               generated always as (
                 extensions.ST_SetSRID(extensions.ST_MakePoint(geo_lng, geo_lat), 4326)
               ) stored,
  device_ref text,
  notes      text,
  evidence_sha256 text,                            -- hash de la evidencia primaria, plegado en la cadena (null si evento sin archivo)
  prev_hash  text,                                 -- row_hash del evento anterior de la MISMA entidad (trigger)
  row_hash   text not null,                        -- SHA256(prev_hash ‖ canónico ‖ evidence_sha256) (trigger)
  created_at timestamptz not null default now(),
  constraint custody_events_one_scope_chk check (num_nonnulls(packing_unit_id, shipment_id) = 1),
  constraint custody_events_stage_type_chk check (
        (stage = 'packing'    and event_type = 'foto_packing')
     or (stage = 'despacho'   and event_type = 'cargado')
     or (stage = 'transporte' and event_type = 'en_transito')
     or (stage = 'entrega'    and event_type in ('foto_entrega','firmado'))
     or (stage = 'pod'        and event_type = 'pod')
  )
);
create index if not exists custody_events_pu_idx       on public.custody_events (packing_unit_id);
create index if not exists custody_events_ship_idx     on public.custody_events (shipment_id);
create index if not exists custody_events_stage_idx    on public.custody_events (stage);
create index if not exists custody_events_type_idx     on public.custody_events (event_type);
create index if not exists custody_events_occurred_idx on public.custody_events (occurred_at desc);
create index if not exists custody_events_geom_gix     on public.custody_events using gist (geom);

-- public_id 'CUST-' (patrón set_*_public_id de 0030/0033/0035)
create or replace function public.set_custody_event_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'CUST-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_custody_event_public_id on public.custody_events;
create trigger trg_set_custody_event_public_id
  before insert on public.custody_events
  for each row execute function public.set_custody_event_public_id();

-- HASH-CHAIN — encadena el evento al anterior de la MISMA entidad (sha256 built-in).
-- Serializado por entidad con advisory lock → sin fork de cadena bajo concurrencia.
create or replace function public.custody_event_hashchain()
returns trigger as $$
declare
  v_prev text;
  v_canon text;
begin
  if new.packing_unit_id is not null then
    perform pg_advisory_xact_lock(hashtext('custody_chain:pu:' || new.packing_unit_id::text));
    select row_hash into v_prev from public.custody_events
      where packing_unit_id = new.packing_unit_id order by chain_seq desc limit 1;
  else
    perform pg_advisory_xact_lock(hashtext('custody_chain:sh:' || new.shipment_id::text));
    select row_hash into v_prev from public.custody_events
      where shipment_id = new.shipment_id order by chain_seq desc limit 1;
  end if;

  new.prev_hash := v_prev;
  v_canon := concat_ws('|',
    coalesce(new.packing_unit_id::text, ''),
    coalesce(new.shipment_id::text, ''),
    new.stage::text,
    new.event_type::text,
    coalesce(new.actor_id::text, ''),
    to_char(new.occurred_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
    coalesce(new.geo_lat::text, ''),
    coalesce(new.geo_lng::text, ''),
    coalesce(new.evidence_sha256, ''),
    coalesce(new.notes, ''));
  new.row_hash := encode(sha256(convert_to(coalesce(v_prev, '') || '||' || v_canon, 'UTF8')), 'hex');
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_custody_event_hashchain on public.custody_events;
create trigger trg_custody_event_hashchain
  before insert on public.custody_events
  for each row execute function public.custody_event_hashchain();

-- APPEND-ONLY — bloquea UPDATE/DELETE/TRUNCATE para TODOS los roles (patrón 0026).
create or replace function public.prevent_custody_event_mutation()
returns trigger as $$
begin
  raise exception 'custody_events es append-only (cadena de custodia inmutable): % no está permitido', tg_op
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

drop trigger if exists trg_custody_events_immutable on public.custody_events;
create trigger trg_custody_events_immutable
  before update or delete on public.custody_events
  for each row execute function public.prevent_custody_event_mutation();

drop trigger if exists trg_custody_events_no_truncate on public.custody_events;
create trigger trg_custody_events_no_truncate
  before truncate on public.custody_events
  for each statement execute function public.prevent_custody_event_mutation();

-- =========================================================================
-- Tabla: custody_evidence — archivos (en Storage) ligados a un evento
-- =========================================================================
create table if not exists public.custody_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.custody_events(id) on delete restrict,
  kind evidence_kind_t not null,
  storage_bucket text not null
    check (storage_bucket in ('custody-evidence','custody-pii','custody-pod')),
  storage_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  sha256 text not null,                            -- tamper-evidence (obligatorio)
  captured_at timestamptz,
  exif jsonb,
  redacted boolean not null default false,         -- erasure de PII (flip controlado)
  redacted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint custody_evidence_path_uk unique (storage_bucket, storage_path)
);
create index if not exists custody_evidence_event_idx   on public.custody_evidence (event_id);
create index if not exists custody_evidence_kind_idx    on public.custody_evidence (kind);
create index if not exists custody_evidence_sha_idx     on public.custody_evidence (sha256);
create index if not exists custody_evidence_created_idx on public.custody_evidence (created_at);

-- APPEND-ONLY con EXCEPCIÓN de redacción: bloquea DELETE/TRUNCATE siempre; UPDATE solo
-- permite el flip redacted=false→true (+ redacted_at), con el resto de columnas INMUTABLE.
create or replace function public.prevent_custody_evidence_mutation()
returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    if old.redacted = false and new.redacted = true
       and new.id = old.id
       and new.event_id = old.event_id
       and new.kind = old.kind
       and new.storage_bucket = old.storage_bucket
       and new.storage_path = old.storage_path
       and new.sha256 = old.sha256
       and new.created_at = old.created_at
       and new.created_by is not distinct from old.created_by
       and new.size_bytes is not distinct from old.size_bytes
       and new.mime_type is not distinct from old.mime_type
       and new.file_name is not distinct from old.file_name
       and new.captured_at is not distinct from old.captured_at
       and new.exif is not distinct from old.exif then
      return new;   -- redacción permitida (erasure de PII)
    end if;
    raise exception 'custody_evidence es append-only (solo se permite el flip de redacción)'
      using errcode = 'restrict_violation';
  end if;
  -- DELETE
  raise exception 'custody_evidence es append-only: % no está permitido', tg_op
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

drop trigger if exists trg_custody_evidence_immutable on public.custody_evidence;
create trigger trg_custody_evidence_immutable
  before update or delete on public.custody_evidence
  for each row execute function public.prevent_custody_evidence_mutation();

drop trigger if exists trg_custody_evidence_no_truncate on public.custody_evidence;
create trigger trg_custody_evidence_no_truncate
  before truncate on public.custody_evidence
  for each statement execute function public.prevent_custody_evidence_mutation();

-- =========================================================================
-- Tabla: delivery_pods — Proof Of Delivery (1 por shipment). Receptor canónico.
-- =========================================================================
create table if not exists public.delivery_pods (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.delivery_pod_short_id_seq'),
  public_id text not null unique,                  -- 'POD-2026-0001' (trigger)
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  receiver_name text not null,                     -- nombre aclarado (fuente de verdad)
  receiver_document text,                          -- PII sensible
  observations text,
  signature_evidence_id uuid references public.custody_evidence(id) on delete set null,  -- firma (custody-pii)
  pod_storage_path text,                           -- PDF (custody-pod)
  signed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint delivery_pods_shipment_uk unique (shipment_id)   -- 1 POD por despacho
);
create index if not exists delivery_pods_signed_idx on public.delivery_pods (signed_at);

create or replace function public.set_delivery_pod_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'POD-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_delivery_pod_public_id on public.delivery_pods;
create trigger trg_set_delivery_pod_public_id
  before insert on public.delivery_pods
  for each row execute function public.set_delivery_pod_public_id();

-- =========================================================================
-- RLS — lectura authenticated · escritura SOLO vía RPC (lockdown; las RPC de
-- 0038/0039 son SECURITY DEFINER y bypassan RLS). Sin policies de escritura.
-- =========================================================================
alter table public.custody_events   enable row level security;
alter table public.custody_evidence enable row level security;
alter table public.delivery_pods    enable row level security;

drop policy if exists "custody_events read" on public.custody_events;
create policy "custody_events read" on public.custody_events for select
  using (auth.role() = 'authenticated');

drop policy if exists "custody_evidence read" on public.custody_evidence;
create policy "custody_evidence read" on public.custody_evidence for select
  using (auth.role() = 'authenticated');

drop policy if exists "delivery_pods read" on public.delivery_pods;
create policy "delivery_pods read" on public.delivery_pods for select
  using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';

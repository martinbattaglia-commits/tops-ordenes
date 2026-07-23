-- 0164_connect_incidents_schema.sql — Nexus Link F4.2A (Centro de Incidentes).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- Implementa el modelo de datos del Addendum A2 (spec:2898-2932) con las
-- decisiones D1-D6 ratificadas por Dirección (2026-07-02):
--   · Entidad de primera clase `connect_incidents` vinculada 1:1 a una
--     conversación `kind='incident'` (enum YA reservado en 0143 — sin migrar enums).
--   · public_id `INC-AAAA-NNNN` por sequence + trigger (patrón OC-/PROS-).
--   · Estados A2: abierto|en_progreso|en_espera|resuelto|cerrado. Ajuste técnico
--     ratificado (D4 "salvo ajuste técnico del plan"): "asignado" NO es estado
--     (es el atributo asignado_a) y "reabierto" NO es estado (es la transición
--     auditada resuelto→en_progreso). `sla_due_at` = INFORMATIVO (sin motor SLA).
--   · RLS: SELECT = connect.view + miembro del hilo (o admin). Escrituras SOLO
--     vía RPCs SECDEF de 0165 (sin policies de INSERT/UPDATE/DELETE = deny) +
--     revoke de escritura table-level (hardening patrón SEC-PARTICIPANTS-1).
--   · D3: acá se agrega SOLO el valor de enum `incident_admin` a
--     permission_action_t (fix C-1 de la revisión adversarial: `permissions`
--     tiene UNIQUE (module, action) y ('connect','admin') ya lo ocupa
--     connect.admin de 0146 — verificado en prod; un INSERT con action='admin'
--     abortaría el batch). El SEED del permiso + grants va en 0165 (batch/tx
--     separado: Postgres prohíbe USAR un valor de enum nuevo en la misma tx).
--     SIN otros cambios RBAC. RBAC_ENFORCE intacto.
-- 100% ADITIVA · IDEMPOTENTE (re-run = no-op). DEPENDE de: 0143 (enums/tablas/
-- _connect_is_member), 0146 (permissions connect), 0009 (RBAC), 0004 (tg_touch_updated_at).
-- Rollback: ver docs/superpowers/ROLLBACK_0164_0166.md.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== Enums (A2 textual) =====
do $$ begin
  create type public.connect_incident_status_t as enum
    ('abierto','en_progreso','en_espera','resuelto','cerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connect_incident_severity_t as enum
    ('baja','media','alta','critica');
exception when duplicate_object then null; end $$;

-- ===== public_id INC-AAAA-NNNN (patrón OC-/PROS-: sequence + trigger before insert) =====
create sequence if not exists public.connect_incident_seq;

create or replace function public._connect_set_incident_public_id()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare v_n text;
begin
  if new.public_id is null or new.public_id = '' then
    -- greatest(): lpad TRUNCA si el número supera el ancho (INC-…-10000 → '1000',
    -- colisión determinística; hallazgo M-1 de la revisión adversarial).
    v_n := nextval('public.connect_incident_seq')::text;
    new.public_id := 'INC-' || to_char(now(),'YYYY') || '-' ||
                     lpad(v_n, greatest(4, length(v_n)), '0');
  end if;
  return new;
end;
$$;

-- ===== Tabla (A2 + adiciones de implementación del Master Plan §5.1) =====
create table if not exists public.connect_incidents (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique,                         -- INC-AAAA-NNNN (trigger)
  conversation_id uuid not null references public.connect_conversations(id) on delete restrict,
  titulo          text not null,
  sector          text,                                -- libre; FK futura a wms.warehouse_sectors
  ubicacion       text,
  tipo_averia     text,
  severidad       public.connect_incident_severity_t not null default 'media',
  estado          public.connect_incident_status_t not null default 'abierto',
  reportado_por   uuid references auth.users(id) on delete set null,
  asignado_a      uuid references auth.users(id) on delete set null,
  sla_due_at      timestamptz,                         -- INFORMATIVO (decisión A2/D5 del plan)
  resuelto_at     timestamptz,
  resolucion_text text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 1:1 con la conversación (el hilo pertenece a UN incidente).
create unique index if not exists connect_incidents_conversation_uidx
  on public.connect_incidents (conversation_id);

-- Índices de gestión (lista filtrable por estado/severidad/sector/asignado).
create index if not exists connect_incidents_estado_sev_idx
  on public.connect_incidents (estado, severidad);
create index if not exists connect_incidents_asignado_idx
  on public.connect_incidents (asignado_a)
  where estado not in ('resuelto','cerrado');
create index if not exists connect_incidents_sector_idx
  on public.connect_incidents (sector) where sector is not null;
create index if not exists connect_incidents_created_idx
  on public.connect_incidents (created_at desc);

drop trigger if exists trg_connect_incidents_public_id on public.connect_incidents;
create trigger trg_connect_incidents_public_id
  before insert on public.connect_incidents
  for each row execute function public._connect_set_incident_public_id();

drop trigger if exists trg_connect_incidents_touch on public.connect_incidents;
create trigger trg_connect_incidents_touch
  before update on public.connect_incidents
  for each row execute function public.tg_touch_updated_at();

-- ===== RLS =====
alter table public.connect_incidents enable row level security;

-- SELECT (A2 + fix I-3/C-1 adversarial): connect.view + (miembro del hilo, admin,
-- o tenedor de connect.incident_admin — sin esto un incident_admin no-admin
-- recibiría la notificación de apertura pero la RLS le ocultaría el incidente).
-- has_permission puede devolver NULL (sin fila en profiles): en policy, NULL
-- excluye la fila (fail-closed); coalesce explícito por claridad P-1.
drop policy if exists "connect_incidents select" on public.connect_incidents;
create policy "connect_incidents select" on public.connect_incidents
  for select to authenticated
  using (
    coalesce(public.has_permission('connect.view'), false)
    and (
      public._connect_is_member(conversation_id)
      or public.is_admin()
      or coalesce(public.has_permission('connect.incident_admin'), false)
    )
  );

-- Escrituras: SIN policies de INSERT/UPDATE/DELETE (deny) — todo ciclo de vida
-- pasa por las RPCs SECDEF de 0165 (transiciones validadas + audit append-only).
-- Hardening belt-and-suspenders (patrón SEC-PARTICIPANTS-1 / 0162): además del
-- deny por RLS, se revoca el privilegio de escritura table-level; las RPCs SECDEF
-- corren como owner y no se ven afectadas.
revoke insert, update, delete on public.connect_incidents from authenticated;

-- ===== Realtime (patrón 0147, idempotente): lista de incidentes viva =====
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'connect_incidents'
  ) then
    execute 'alter publication supabase_realtime add table public.connect_incidents';
  end if;
exception
  when undefined_object then null;  -- publicación inexistente (entorno no-Supabase)
end $$;

-- ===== D3 · RBAC (parte 1/2): valor de enum para el permiso nuevo =====
-- ('connect','admin') está OCUPADO por connect.admin (0146, UNIQUE module+action).
-- Se agrega la acción 'incident_admin' al catálogo de acciones; el INSERT del
-- permiso + grants va en 0165 (tx separada — regla "enum nuevo no se usa en la
-- misma tx", patrón 0021/0029/0052). idempotente (if not exists).
alter type public.permission_action_t add value if not exists 'incident_admin';

notify pgrst, 'reload schema';

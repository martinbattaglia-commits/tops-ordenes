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
--   · D3: permiso nuevo `connect.incident_admin` (solo catálogo; grants a
--     admin/director_ops). SIN otros cambios RBAC. RBAC_ENFORCE intacto.
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
begin
  if new.public_id is null or new.public_id = '' then
    new.public_id := 'INC-' || to_char(now(),'YYYY') || '-' ||
                     lpad(nextval('public.connect_incident_seq')::text, 4, '0');
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

-- SELECT (A2): connect.view + miembro del hilo, o admin.
drop policy if exists "connect_incidents select" on public.connect_incidents;
create policy "connect_incidents select" on public.connect_incidents
  for select to authenticated
  using (
    public.has_permission('connect.view')
    and (public._connect_is_member(conversation_id) or public.is_admin())
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

-- ===== D3 · RBAC: permiso connect.incident_admin (SOLO catálogo, patrón 0146) =====
-- Administración avanzada de incidentes: reasignar, cierre forzado, ajustar
-- severidad, acciones que exceden al creador/asignado. Reportar/ver NO lo
-- requieren (usan connect.view / connect.create existentes).
insert into public.permissions (slug, module, action, label, description) values
  ('connect.incident_admin', 'connect', 'admin', 'Administrar incidentes',
   'Administracion avanzada del Centro de Incidentes: reasignar, cerrar forzado, ajustar severidad')
on conflict (slug) do nothing;

insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug = 'connect.incident_admin'
where ro.slug in ('admin','director_ops')
on conflict do nothing;

notify pgrst, 'reload schema';

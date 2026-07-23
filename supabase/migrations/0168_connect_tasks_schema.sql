-- 0168_connect_tasks_schema.sql — Nexus Link F4.3B (Tareas colaborativas).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- Modelo de datos del ADR-F4-3 (§1-§13) con D-F43-1..9 ratificadas:
--   · connect_tasks (TSK-AAAA-NNNN, estados, prioridad, due INFORMATIVO,
--     hilo LAZY kind='task', vínculos incidente/workflow) + followers +
--     workflow templates/steps/instances (secuencias LINEALES, sin motor).
--   · RLS privado-por-involucrados (D-F43-4): creador/asignado/seguidor/
--     miembro del hilo/task_admin/admin. Helpers SECDEF para evitar recursión
--     de policies (patrón _connect_is_member de 0143).
--   · Escrituras deny-all para sesión (todo por RPCs de 0169) + revoke.
--   · Seed del permiso connect.task_admin (action='task_admin' de 0167 — tx
--     separada; UNIQUE(module,action) hace imposible 'admin'; sin
--     on-conflict-sin-target, precedente 0070) + grants admin/director_ops.
-- 100% ADITIVA · IDEMPOTENTE. DEPENDE de: 0167 (valores de enum), 0143
-- (conversaciones/_connect_is_member), 0164 (connect_incidents), 0009 (RBAC),
-- 0004 (tg_touch_updated_at). Rollback: ROLLBACK_0167_0170.md.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== Enums propios =====
do $$ begin
  create type public.connect_task_status_t as enum
    ('pendiente','en_progreso','completada','cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connect_task_priority_t as enum
    ('baja','media','alta','urgente');
exception when duplicate_object then null; end $$;

-- ===== public_id TSK-AAAA-NNNN (sequence + trigger; lpad con greatest, lección M-1) =====
create sequence if not exists public.connect_task_seq;

create or replace function public._connect_set_task_public_id()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare v_n text;
begin
  if new.public_id is null or new.public_id = '' then
    v_n := nextval('public.connect_task_seq')::text;
    new.public_id := 'TSK-' || to_char(now(),'YYYY') || '-' ||
                     lpad(v_n, greatest(4, length(v_n)), '0');
  end if;
  return new;
end;
$$;

-- ===== Workflow: plantillas LINEALES (catálogo por seed, D-F43-6) =====
create table if not exists public.connect_workflow_templates (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.connect_workflow_steps (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references public.connect_workflow_templates(id) on delete cascade,
  step_no          int not null check (step_no >= 1),
  titulo           text not null,
  descripcion      text,
  rol_sugerido     user_role_t,                          -- role_target del aviso (D-F43-5)
  due_offset_days  int check (due_offset_days is null or due_offset_days >= 0),
  prioridad        public.connect_task_priority_t not null default 'media',
  unique (template_id, step_no)
);

create table if not exists public.connect_workflow_instances (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.connect_workflow_templates(id) on delete restrict,
  iniciado_por  uuid references auth.users(id) on delete set null,
  estado        text not null default 'en_curso'
                  check (estado in ('en_curso','completado','cancelado')),
  current_step  int not null default 1,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists connect_workflow_instances_estado_idx
  on public.connect_workflow_instances (estado) where estado = 'en_curso';

-- ===== Tareas =====
create table if not exists public.connect_tasks (
  id                    uuid primary key default gen_random_uuid(),
  public_id             text unique,                     -- TSK-AAAA-NNNN (trigger)
  titulo                text not null,
  descripcion           text,                            -- bajo RLS de involucrados (no viaja a audit/notifs)
  estado                public.connect_task_status_t not null default 'pendiente',
  prioridad             public.connect_task_priority_t not null default 'media',
  due_at                timestamptz,                     -- INFORMATIVO (ADR §9; sin cron)
  creado_por            uuid references auth.users(id) on delete set null,
  asignado_a            uuid references auth.users(id) on delete set null,
  conversation_id       uuid references public.connect_conversations(id) on delete restrict, -- hilo LAZY (ADR §10)
  incident_id           uuid references public.connect_incidents(id) on delete set null,     -- origen incidente (ADR §19 plan)
  workflow_instance_id  uuid references public.connect_workflow_instances(id) on delete set null,
  step_no               int,
  area                  text,                            -- informativo (rol/área sugerida del paso)
  cancel_reason         text,                            -- breve; bajo RLS (a audit va solo length)
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint connect_tasks_workflow_step_chk check (
    (workflow_instance_id is null and step_no is null)
    or (workflow_instance_id is not null and step_no is not null)
  )
);

-- Hilo 1:0..1 y unicidad de paso por instancia (anti doble-avance).
create unique index if not exists connect_tasks_conversation_uidx
  on public.connect_tasks (conversation_id) where conversation_id is not null;
create unique index if not exists connect_tasks_instance_step_uidx
  on public.connect_tasks (workflow_instance_id, step_no) where workflow_instance_id is not null;

-- Índices de gestión.
create index if not exists connect_tasks_estado_prio_idx
  on public.connect_tasks (estado, prioridad);
create index if not exists connect_tasks_asignado_idx
  on public.connect_tasks (asignado_a) where estado in ('pendiente','en_progreso');
create index if not exists connect_tasks_creador_idx
  on public.connect_tasks (creado_por);
create index if not exists connect_tasks_due_idx
  on public.connect_tasks (due_at) where estado in ('pendiente','en_progreso') and due_at is not null;
create index if not exists connect_tasks_incident_idx
  on public.connect_tasks (incident_id) where incident_id is not null;
create index if not exists connect_tasks_created_idx
  on public.connect_tasks (created_at desc);

drop trigger if exists trg_connect_tasks_public_id on public.connect_tasks;
create trigger trg_connect_tasks_public_id
  before insert on public.connect_tasks
  for each row execute function public._connect_set_task_public_id();

drop trigger if exists trg_connect_tasks_touch on public.connect_tasks;
create trigger trg_connect_tasks_touch
  before update on public.connect_tasks
  for each row execute function public.tg_touch_updated_at();

-- ===== Seguidores (ADR §7) =====
create table if not exists public.connect_task_followers (
  task_id     uuid not null references public.connect_tasks(id) on delete cascade,
  profile_id  uuid not null references auth.users(id) on delete cascade,
  added_by    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (task_id, profile_id)
);
create index if not exists connect_task_followers_profile_idx
  on public.connect_task_followers (profile_id);

-- ===== Helpers SECDEF (evitan recursión de policies, patrón 0143) =====
create or replace function public._connect_task_is_follower(p_task uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.connect_task_followers f
    where f.task_id = p_task and f.profile_id = auth.uid()
  );
$$;
revoke all on function public._connect_task_is_follower(uuid) from public, anon;
grant execute on function public._connect_task_is_follower(uuid) to authenticated, service_role;

-- ¿Involucrado en la tarea? (creador/asignado/seguidor/miembro del hilo) — NULL-safe.
create or replace function public._connect_task_is_involved(p_task uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((
    select (t.creado_por is not distinct from auth.uid() and t.creado_por is not null)
        or (t.asignado_a is not distinct from auth.uid() and t.asignado_a is not null)
        or public._connect_task_is_follower(t.id)
        or (t.conversation_id is not null and public._connect_is_member(t.conversation_id))
    from public.connect_tasks t where t.id = p_task
  ), false);
$$;
revoke all on function public._connect_task_is_involved(uuid) from public, anon;
grant execute on function public._connect_task_is_involved(uuid) to authenticated, service_role;

-- ===== RLS =====
alter table public.connect_tasks              enable row level security;
alter table public.connect_task_followers     enable row level security;
alter table public.connect_workflow_templates enable row level security;
alter table public.connect_workflow_steps     enable row level security;
alter table public.connect_workflow_instances enable row level security;

-- Tareas: privado-por-involucrados (D-F43-4) + task_admin/admin + VACANTES
-- abiertas visibles para todo staff con connect.view. La rama de vacantes es
-- REQUERIDA por el ADR §5 ("vacante = reclamable por cualquier staff") y por
-- el flujo de workflows (aviso role_target → claim): sin ella, la tarea
-- vacante era invisible para quien debía reclamarla (fix C-1 adversarial
-- frontend F4.3 — el "tablero de vacantes" leía bajo la misma RLS). Al
-- asignarse, la tarea vuelve a ser privada-por-involucrados. NULL-safe.
drop policy if exists "connect_tasks select" on public.connect_tasks;
create policy "connect_tasks select" on public.connect_tasks
  for select to authenticated
  using (
    coalesce(public.has_permission('connect.view'), false)
    and (
      (creado_por = auth.uid())
      or (asignado_a = auth.uid())
      or (asignado_a is null and estado in ('pendiente','en_progreso'))
      or public._connect_task_is_follower(id)
      or (conversation_id is not null and public._connect_is_member(conversation_id))
      or public.is_admin()
      or coalesce(public.has_permission('connect.task_admin'), false)
    )
  );

-- Seguidores: visibles para involucrados/admins (helper SECDEF, sin recursión).
drop policy if exists "connect_task_followers select" on public.connect_task_followers;
create policy "connect_task_followers select" on public.connect_task_followers
  for select to authenticated
  using (
    coalesce(public.has_permission('connect.view'), false)
    and (
      public._connect_task_is_involved(task_id)
      or public.is_admin()
      or coalesce(public.has_permission('connect.task_admin'), false)
    )
  );

-- Catálogo de workflows: lectura para todo staff con connect.view (sin PII).
drop policy if exists "connect_workflow_templates select" on public.connect_workflow_templates;
create policy "connect_workflow_templates select" on public.connect_workflow_templates
  for select to authenticated
  using (coalesce(public.has_permission('connect.view'), false));

drop policy if exists "connect_workflow_steps select" on public.connect_workflow_steps;
create policy "connect_workflow_steps select" on public.connect_workflow_steps
  for select to authenticated
  using (coalesce(public.has_permission('connect.view'), false));

-- Instancias: iniciador, quien vea alguna de sus tareas (RLS de tasks aplica
-- en la subquery), task_admin o admin. ⚠️ El lado externo va CALIFICADO
-- (fix I-1 adversarial: `= id` sin calificar resolvía contra t.id → rama
-- siempre falsa; patrón 0143 de calificar el lado externo).
drop policy if exists "connect_workflow_instances select" on public.connect_workflow_instances;
create policy "connect_workflow_instances select" on public.connect_workflow_instances
  for select to authenticated
  using (
    coalesce(public.has_permission('connect.view'), false)
    and (
      iniciado_por = auth.uid()
      or exists (select 1 from public.connect_tasks t
                  where t.workflow_instance_id = connect_workflow_instances.id)
      or public.is_admin()
      or coalesce(public.has_permission('connect.task_admin'), false)
    )
  );

-- Escrituras: SIN policies (deny) — TODO por RPCs SECDEF de 0169.
-- Hardening belt-and-suspenders (patrón SEC-PARTICIPANTS-1 / 0164).
revoke insert, update, delete on public.connect_tasks              from anon, authenticated;
revoke insert, update, delete on public.connect_task_followers     from anon, authenticated;
revoke insert, update, delete on public.connect_workflow_templates from anon, authenticated;
revoke insert, update, delete on public.connect_workflow_steps     from anon, authenticated;
revoke insert, update, delete on public.connect_workflow_instances from anon, authenticated;

-- ===== Realtime (lista de tareas viva; patrón 0147/0164) =====
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'connect_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.connect_tasks';
  end if;
exception
  when undefined_object then null;
end $$;

-- ===== D3/D-F43 · RBAC: permiso connect.task_admin (usa 'task_admin' de 0167, tx separada) =====
-- ⚠️ Sin `on conflict do nothing` sin target (precedente 0070): el arbiter es slug.
insert into public.permissions (slug, module, action, label, description) values
  ('connect.task_admin', 'connect', 'task_admin', 'Administrar tareas',
   'Administracion avanzada de tareas: reasignar, cancelar/cerrar cross, gestionar seguidores. Instanciar workflows solo requiere connect.create (ADR paragrafo 13)')
on conflict (slug) do nothing;

insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug = 'connect.task_admin'
where ro.slug in ('admin','director_ops')
on conflict do nothing;

notify pgrst, 'reload schema';

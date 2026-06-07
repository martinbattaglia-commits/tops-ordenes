-- =========================================================================
-- 0058_rrhh_core.sql — RRHH (Core Data Model · Gate R3).
-- Fundación de datos del legajo: empleados + bancario + historial + organigrama.
--
-- ALCANCE R3 (estricto): SOLO modelo de datos + RLS (FD-1/FD-5) + append-only
--   (FD-10). NO workflows, NO vacaciones/permisos/licencias/novedades, NO
--   recibos, NO buckets/storage, NO RPCs, NO UI.
--
-- Seguridad: RLS por has_permission (RBAC, modelo grueso OPCIÓN 1) + propiedad
--   (profile_id = auth.uid()). PROHIBIDO current_role() (FD-5). Guards
--   fail-closed con coalesce(...,false) (FD-4). Patrón de RLS con has_permission
--   ya probado en CRM (0042/0043).
--
-- Modelo: docs/handoff/RRHH_MASTER_ARCHITECTURE_v2_0.md §4
--         + RRHH_R2_ARCHITECTURE_AMENDMENT.md §3 (seguridad gruesa).
-- Precondición: módulo 'rrhh' (0056) + seed RBAC (0057) aplicados.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Enums de soporte (tipos NUEVOS; idempotentes).
-- -------------------------------------------------------------------------
do $$ begin
  create type public.rrhh_estado_empleado_t as enum ('activo','licencia','baja');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rrhh_estado_civil_t as enum
    ('soltero','casado','divorciado','viudo','union_convivencial','otro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rrhh_modalidad_contratacion_t as enum
    ('tiempo_indeterminado','plazo_fijo','eventual','temporada','pasantia','otro');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. Triggers de inmutabilidad (FD-10 append-only).
-- -------------------------------------------------------------------------
create or replace function public.tg_forbid_delete_rrhh()
returns trigger language plpgsql as $$
begin
  raise exception 'RRHH es append-only: DELETE no permitido en %', tg_table_name
    using errcode = 'restrict_violation';
end; $$;

create or replace function public.tg_forbid_update_rrhh()
returns trigger language plpgsql as $$
begin
  raise exception 'RRHH append-only: UPDATE no permitido en % (corregir por contrapartida)', tg_table_name
    using errcode = 'restrict_violation';
end; $$;

-- -------------------------------------------------------------------------
-- 3. Secuencia de legajo (public_id legible).
-- -------------------------------------------------------------------------
create sequence if not exists public.rrhh_empleado_legajo_seq start 1;

-- -------------------------------------------------------------------------
-- 4. rrhh_empleados — legajo (tabla principal).
-- -------------------------------------------------------------------------
create table if not exists public.rrhh_empleados (
  id                     uuid primary key default gen_random_uuid(),
  public_id              int  not null unique default nextval('public.rrhh_empleado_legajo_seq'),  -- nº legajo
  profile_id             uuid references public.profiles(id) on delete set null,                    -- 1:0..1 (portal)
  -- Datos personales (PII)
  apellido_nombre        text not null,
  dni                    text not null unique,
  cuil                   text not null unique,
  fecha_nacimiento       date,
  domicilio              text,
  telefono               text,
  email_personal         text,
  estado_civil           public.rrhh_estado_civil_t,
  contacto_emergencia    jsonb,
  -- Datos laborales
  fecha_ingreso          date not null,
  fecha_reconocida       date,                                  -- base de antigüedad
  categoria              text,
  seccion                text,
  calificacion           text,
  convenio               text,
  modalidad_contratacion public.rrhh_modalidad_contratacion_t,
  depot                  public.depot_t,                        -- reutiliza enum de 0001
  supervisor_id          uuid references public.rrhh_empleados(id) on delete set null,  -- organigrama
  obra_social            text,
  -- Estado / baja lógica
  estado                 public.rrhh_estado_empleado_t not null default 'activo',
  fecha_baja             date,
  motivo_baja            text,
  -- Auditoría de fila
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id) on delete set null,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id) on delete set null,
  constraint rrhh_empleados_baja_chk check (estado <> 'baja' or fecha_baja is not null),
  constraint rrhh_empleados_no_self_supervisor_chk check (supervisor_id is null or supervisor_id <> id)
);

create index if not exists rrhh_empleados_supervisor_idx on public.rrhh_empleados(supervisor_id);
create index if not exists rrhh_empleados_profile_idx    on public.rrhh_empleados(profile_id);
create index if not exists rrhh_empleados_estado_idx     on public.rrhh_empleados(estado);
create index if not exists rrhh_empleados_depot_idx      on public.rrhh_empleados(depot);
create index if not exists rrhh_empleados_seccion_idx    on public.rrhh_empleados(seccion);

-- -------------------------------------------------------------------------
-- 5. rrhh_empleado_bancario — datos bancarios (separado por sensibilidad, FD-1).
--    Append-only: historial de cuentas (sin UPDATE/DELETE).
-- -------------------------------------------------------------------------
create table if not exists public.rrhh_empleado_bancario (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid not null references public.rrhh_empleados(id) on delete cascade,
  banco         text not null,
  cbu           text,
  alias         text,
  cuenta        text,
  vigente_desde date not null default current_date,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);
create index if not exists rrhh_empleado_bancario_emp_idx on public.rrhh_empleado_bancario(empleado_id);

-- -------------------------------------------------------------------------
-- 6. rrhh_empleado_historial — cambios de atributos / organigrama (append-only).
-- -------------------------------------------------------------------------
create table if not exists public.rrhh_empleado_historial (
  id             uuid primary key default gen_random_uuid(),
  empleado_id    uuid not null references public.rrhh_empleados(id) on delete cascade,
  campo          text not null,                  -- categoria | remuneracion | supervisor | seccion | ...
  valor_anterior text,
  valor_nuevo    text,
  vigente_desde  date not null default current_date,
  changed_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists rrhh_empleado_historial_emp_idx on public.rrhh_empleado_historial(empleado_id, vigente_desde desc);

-- -------------------------------------------------------------------------
-- 7. Triggers (updated_at + append-only).
-- -------------------------------------------------------------------------
drop trigger if exists trg_rrhh_empleados_updated_at on public.rrhh_empleados;
create trigger trg_rrhh_empleados_updated_at
  before update on public.rrhh_empleados
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_forbid_delete_rrhh_empleados on public.rrhh_empleados;
create trigger trg_forbid_delete_rrhh_empleados
  before delete on public.rrhh_empleados
  for each row execute function public.tg_forbid_delete_rrhh();

drop trigger if exists trg_forbid_delete_rrhh_bancario on public.rrhh_empleado_bancario;
create trigger trg_forbid_delete_rrhh_bancario
  before delete on public.rrhh_empleado_bancario
  for each row execute function public.tg_forbid_delete_rrhh();
drop trigger if exists trg_forbid_update_rrhh_bancario on public.rrhh_empleado_bancario;
create trigger trg_forbid_update_rrhh_bancario
  before update on public.rrhh_empleado_bancario
  for each row execute function public.tg_forbid_update_rrhh();

drop trigger if exists trg_forbid_delete_rrhh_historial on public.rrhh_empleado_historial;
create trigger trg_forbid_delete_rrhh_historial
  before delete on public.rrhh_empleado_historial
  for each row execute function public.tg_forbid_delete_rrhh();
drop trigger if exists trg_forbid_update_rrhh_historial on public.rrhh_empleado_historial;
create trigger trg_forbid_update_rrhh_historial
  before update on public.rrhh_empleado_historial
  for each row execute function public.tg_forbid_update_rrhh();

-- -------------------------------------------------------------------------
-- 8. RLS (FD-1/FD-4/FD-5): has_permission (grueso) + propiedad. SIN current_role().
--    Escritura directa solo rrhh.admin (granularidad fina vía RPC en gate posterior;
--    carga inicial por service_role, que bypassa RLS).
-- -------------------------------------------------------------------------
alter table public.rrhh_empleados        enable row level security;
alter table public.rrhh_empleado_bancario enable row level security;
alter table public.rrhh_empleado_historial enable row level security;

-- empleados: lectura = staff (rrhh.view) o el propio empleado (propiedad).
drop policy if exists "rrhh_empleados read" on public.rrhh_empleados;
create policy "rrhh_empleados read" on public.rrhh_empleados
  for select to authenticated
  using (
    coalesce(public.has_permission('rrhh.view'), false)
    or profile_id = auth.uid()
  );
-- empleados: escritura = rrhh.admin (fail-closed).
drop policy if exists "rrhh_empleados insert" on public.rrhh_empleados;
create policy "rrhh_empleados insert" on public.rrhh_empleados
  for insert to authenticated
  with check (coalesce(public.has_permission('rrhh.admin'), false));
drop policy if exists "rrhh_empleados update" on public.rrhh_empleados;
create policy "rrhh_empleados update" on public.rrhh_empleados
  for update to authenticated
  using (coalesce(public.has_permission('rrhh.admin'), false))
  with check (coalesce(public.has_permission('rrhh.admin'), false));

-- bancario 🔒: lectura = rrhh.admin o el propio empleado. Escritura = rrhh.admin.
drop policy if exists "rrhh_bancario read" on public.rrhh_empleado_bancario;
create policy "rrhh_bancario read" on public.rrhh_empleado_bancario
  for select to authenticated
  using (
    coalesce(public.has_permission('rrhh.admin'), false)
    or exists (
      select 1 from public.rrhh_empleados e
      where e.id = rrhh_empleado_bancario.empleado_id and e.profile_id = auth.uid()
    )
  );
drop policy if exists "rrhh_bancario insert" on public.rrhh_empleado_bancario;
create policy "rrhh_bancario insert" on public.rrhh_empleado_bancario
  for insert to authenticated
  with check (coalesce(public.has_permission('rrhh.admin'), false));

-- historial: lectura = staff (rrhh.view). Escritura = rrhh.admin.
drop policy if exists "rrhh_historial read" on public.rrhh_empleado_historial;
create policy "rrhh_historial read" on public.rrhh_empleado_historial
  for select to authenticated
  using (coalesce(public.has_permission('rrhh.view'), false));
drop policy if exists "rrhh_historial insert" on public.rrhh_empleado_historial;
create policy "rrhh_historial insert" on public.rrhh_empleado_historial
  for insert to authenticated
  with check (coalesce(public.has_permission('rrhh.admin'), false));

-- Sin políticas de DELETE/UPDATE en bancario/historial ⇒ bloqueadas por RLS
-- (defensa en profundidad junto a los triggers append-only).

notify pgrst, 'reload schema';

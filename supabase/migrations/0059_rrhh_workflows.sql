-- =========================================================================
-- 0059_rrhh_workflows.sql — RRHH (Workflow Foundation · Gate R4).
-- Solicitudes (vacaciones/permisos/licencias/horas extra) + máquina de estados
-- + aprobaciones (L1 jerárquica + L2 RRHH) + trazabilidad + novedades.
--
-- ALCANCE R4 (congelado): tablas + estados + RPCs de transición + RLS + append-only.
--   NO UI, NO buckets/storage, NO recibos, NO firma digital, NO liquidación salarial.
--
-- Seguridad: RPC-First. Transiciones SOLO por RPC security-definer (que auto-validan
--   permisos porque bypassan RLS). Autorización: has_permission (grueso, fail-closed
--   coalesce) + propiedad (profile_id=auth.uid()) + jerarquía (supervisor_id) +
--   workflow_state. PROHIBIDO current_role() (FD-5). Append-only (FD-10).
--
-- Modelo: RRHH_MASTER_ARCHITECTURE_v2_0.md §6 + RRHH_R2_ARCHITECTURE_AMENDMENT.md §3
--         + RRHH_R4_IMPLEMENTATION_PLAN.md (APPROVED).
-- Precondición: 0056 (módulo) + 0057 (RBAC) + 0058 (legajo) aplicados.
-- Patrón: CRM (estados), treasury (RPC/guard), po_events (trazabilidad).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Enums
-- -------------------------------------------------------------------------
do $$ begin create type public.rrhh_solicitud_tipo_t as enum
  ('vacaciones','permiso','licencia','hora_extra');
exception when duplicate_object then null; end $$;

do $$ begin create type public.rrhh_solicitud_estado_t as enum
  ('borrador','pendiente_supervisor','pendiente_rrhh','aprobada','rechazada','cancelada','anulada');
exception when duplicate_object then null; end $$;

do $$ begin create type public.rrhh_permiso_subtipo_t as enum
  ('inasistencia','llegada_tarde','retiro_anticipado','medico','estudio','otro');
exception when duplicate_object then null; end $$;

do $$ begin create type public.rrhh_licencia_subtipo_t as enum
  ('enfermedad','maternidad','paternidad','art','especial');
exception when duplicate_object then null; end $$;

do $$ begin create type public.rrhh_recargo_t as enum ('al_50','al_100');
exception when duplicate_object then null; end $$;

do $$ begin create type public.rrhh_novedad_tipo_t as enum
  ('hora_extra','vacaciones','licencia','permiso','ausencia','llegada_tarde');
exception when duplicate_object then null; end $$;

do $$ begin create type public.rrhh_evento_accion_t as enum
  ('crear','enviar','aprobar_l1','aprobar_l2','rechazar','cancelar','anular');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. Secuencia + public_id legible (SOL-YYYY-NNNNNN)
-- -------------------------------------------------------------------------
create sequence if not exists public.rrhh_solicitud_short_id_seq start 1;

-- -------------------------------------------------------------------------
-- 3. Tablas
-- -------------------------------------------------------------------------
create table if not exists public.rrhh_solicitudes (
  id                 uuid primary key default gen_random_uuid(),
  short_id           int  not null default nextval('public.rrhh_solicitud_short_id_seq'),
  public_id          text not null unique,
  empleado_id        uuid not null references public.rrhh_empleados(id) on delete cascade,
  tipo               public.rrhh_solicitud_tipo_t not null,
  subtipo            text,                              -- permiso/licencia subtipo (validado en RPC)
  fecha_desde        date not null,
  fecha_hasta        date not null,
  cantidad_dias      numeric(6,2),
  motivo             text,
  estado             public.rrhh_solicitud_estado_t not null default 'borrador',
  requiere_doc       boolean not null default false,
  con_goce           boolean not null default true,
  computa_ausentismo boolean not null default false,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id) on delete set null,
  constraint rrhh_solicitudes_fechas_chk check (fecha_hasta >= fecha_desde)
);
create index if not exists rrhh_solicitudes_emp_idx    on public.rrhh_solicitudes(empleado_id);
create index if not exists rrhh_solicitudes_estado_idx on public.rrhh_solicitudes(estado);
create index if not exists rrhh_solicitudes_tipo_idx   on public.rrhh_solicitudes(tipo);

create table if not exists public.rrhh_horas_extra_detalle (
  solicitud_id   uuid primary key references public.rrhh_solicitudes(id) on delete cascade,
  fecha          date not null,
  cantidad_horas numeric(5,2) not null check (cantidad_horas > 0),
  recargo        public.rrhh_recargo_t not null,
  origen         text not null default 'solicitud_empleado'   -- carga_supervisor|solicitud_empleado|fichaje
);

create table if not exists public.rrhh_solicitud_eventos (
  id           bigserial primary key,
  solicitud_id uuid not null references public.rrhh_solicitudes(id) on delete cascade,
  ts           timestamptz not null default now(),
  accion       public.rrhh_evento_accion_t not null,
  actor_id     uuid references auth.users(id) on delete set null,
  nivel        text,                                  -- empleado|supervisor|rrhh
  comentario   text,
  meta         jsonb not null default '{}'::jsonb
);
create index if not exists rrhh_solicitud_eventos_sol_idx on public.rrhh_solicitud_eventos(solicitud_id, ts);

create table if not exists public.rrhh_novedades (
  id                  uuid primary key default gen_random_uuid(),
  empleado_id         uuid not null references public.rrhh_empleados(id) on delete cascade,
  periodo             text not null,                  -- YYYY-MM
  tipo                public.rrhh_novedad_tipo_t not null,
  cantidad            numeric(8,2) not null,
  origen_solicitud_id uuid references public.rrhh_solicitudes(id) on delete set null,
  confirmada          boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null
);
create index if not exists rrhh_novedades_emp_periodo_idx on public.rrhh_novedades(empleado_id, periodo);

-- -------------------------------------------------------------------------
-- 4. Triggers: updated_at + append-only (FD-10).
-- -------------------------------------------------------------------------
drop trigger if exists trg_rrhh_solicitudes_updated_at on public.rrhh_solicitudes;
create trigger trg_rrhh_solicitudes_updated_at
  before update on public.rrhh_solicitudes
  for each row execute function public.touch_updated_at();

-- solicitudes: append-only sobre DELETE (UPDATE de estado permitido vía RPC).
drop trigger if exists trg_forbid_delete_rrhh_solic on public.rrhh_solicitudes;
create trigger trg_forbid_delete_rrhh_solic
  before delete on public.rrhh_solicitudes
  for each row execute function public.tg_forbid_delete_rrhh();

-- eventos + novedades: inmutables (forbid delete + update).
drop trigger if exists trg_forbid_delete_rrhh_eventos on public.rrhh_solicitud_eventos;
create trigger trg_forbid_delete_rrhh_eventos
  before delete on public.rrhh_solicitud_eventos
  for each row execute function public.tg_forbid_delete_rrhh();
drop trigger if exists trg_forbid_update_rrhh_eventos on public.rrhh_solicitud_eventos;
create trigger trg_forbid_update_rrhh_eventos
  before update on public.rrhh_solicitud_eventos
  for each row execute function public.tg_forbid_update_rrhh();

drop trigger if exists trg_forbid_delete_rrhh_novedades on public.rrhh_novedades;
create trigger trg_forbid_delete_rrhh_novedades
  before delete on public.rrhh_novedades
  for each row execute function public.tg_forbid_delete_rrhh();
drop trigger if exists trg_forbid_update_rrhh_novedades on public.rrhh_novedades;
create trigger trg_forbid_update_rrhh_novedades
  before update on public.rrhh_novedades
  for each row execute function public.tg_forbid_update_rrhh();

-- -------------------------------------------------------------------------
-- 5. RLS (FD-1/FD-4/FD-5): lectura por has_permission + propiedad + supervisor.
--    Escritura directa = rrhh.admin; las transiciones van por RPC (definer).
-- -------------------------------------------------------------------------
alter table public.rrhh_solicitudes        enable row level security;
alter table public.rrhh_horas_extra_detalle enable row level security;
alter table public.rrhh_solicitud_eventos  enable row level security;
alter table public.rrhh_novedades          enable row level security;

-- Helper inline: ¿caller es el empleado dueño?  (e.profile_id = auth.uid())
-- Se usa como subselect en las policies.

-- solicitudes: lectura = staff | dueño | supervisor directo.
drop policy if exists "rrhh_solic read" on public.rrhh_solicitudes;
create policy "rrhh_solic read" on public.rrhh_solicitudes
  for select to authenticated
  using (
    coalesce(public.has_permission('rrhh.view'), false)
    or exists (select 1 from public.rrhh_empleados e
               where e.id = rrhh_solicitudes.empleado_id and e.profile_id = auth.uid())
    or exists (select 1 from public.rrhh_empleados sub
               join public.rrhh_empleados sup on sup.id = sub.supervisor_id
               where sub.id = rrhh_solicitudes.empleado_id and sup.profile_id = auth.uid())
  );
drop policy if exists "rrhh_solic write admin" on public.rrhh_solicitudes;
create policy "rrhh_solic write admin" on public.rrhh_solicitudes
  for all to authenticated
  using (coalesce(public.has_permission('rrhh.admin'), false))
  with check (coalesce(public.has_permission('rrhh.admin'), false));

-- detalle OT: sigue la visibilidad de la solicitud.
drop policy if exists "rrhh_hext read" on public.rrhh_horas_extra_detalle;
create policy "rrhh_hext read" on public.rrhh_horas_extra_detalle
  for select to authenticated
  using (exists (select 1 from public.rrhh_solicitudes s where s.id = rrhh_horas_extra_detalle.solicitud_id));
drop policy if exists "rrhh_hext write admin" on public.rrhh_horas_extra_detalle;
create policy "rrhh_hext write admin" on public.rrhh_horas_extra_detalle
  for all to authenticated
  using (coalesce(public.has_permission('rrhh.admin'), false))
  with check (coalesce(public.has_permission('rrhh.admin'), false));

-- eventos: lectura = staff | dueño de la solicitud. Inserción solo vía RPC (definer).
drop policy if exists "rrhh_eventos read" on public.rrhh_solicitud_eventos;
create policy "rrhh_eventos read" on public.rrhh_solicitud_eventos
  for select to authenticated
  using (
    coalesce(public.has_permission('rrhh.view'), false)
    or exists (select 1 from public.rrhh_solicitudes s
               join public.rrhh_empleados e on e.id = s.empleado_id
               where s.id = rrhh_solicitud_eventos.solicitud_id and e.profile_id = auth.uid())
  );

-- novedades: lectura = staff | dueño. Inserción solo vía RPC (definer).
drop policy if exists "rrhh_novedades read" on public.rrhh_novedades;
create policy "rrhh_novedades read" on public.rrhh_novedades
  for select to authenticated
  using (
    coalesce(public.has_permission('rrhh.view'), false)
    or exists (select 1 from public.rrhh_empleados e
               where e.id = rrhh_novedades.empleado_id and e.profile_id = auth.uid())
  );

-- =========================================================================
-- 6. RPCs de transición (RPC-First). SECURITY DEFINER ⇒ auto-validan permisos.
--    Todas: fail-closed coalesce(has_permission), FOR UPDATE, validan estado,
--    escriben evento. Sin current_role().
-- =========================================================================

-- Helper: empleado_id del caller (o null).
create or replace function public.rrhh_caller_empleado_id()
returns uuid language sql stable security definer set search_path = public as $fn$
  select id from public.rrhh_empleados where profile_id = auth.uid() limit 1;
$fn$;

-- 6.1 crear (borrador). Dueño (self) o rrhh.create (en nombre de otro).
create or replace function public.rrhh_solicitud_crear(
  p_empleado_id uuid, p_tipo public.rrhh_solicitud_tipo_t, p_subtipo text,
  p_fecha_desde date, p_fecha_hasta date, p_motivo text default null,
  p_cantidad_dias numeric default null,
  p_he_cantidad_horas numeric default null, p_he_recargo public.rrhh_recargo_t default null,
  p_he_origen text default 'solicitud_empleado'
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_caller uuid; v_id uuid; v_pub text;
begin
  v_caller := public.rrhh_caller_empleado_id();
  if not (
       coalesce(public.has_permission('rrhh.create'), false)
    or (v_caller is not null and v_caller = p_empleado_id)
  ) then
    raise exception 'ACCESS_DENIED: requiere rrhh.create o ser el propio empleado' using errcode='42501';
  end if;
  if p_fecha_hasta < p_fecha_desde then
    raise exception 'INVALID_RANGE: fecha_hasta < fecha_desde' using errcode='check_violation';
  end if;

  insert into public.rrhh_solicitudes
    (public_id, empleado_id, tipo, subtipo, fecha_desde, fecha_hasta, cantidad_dias, motivo, created_by, updated_by)
  values
    ('SOL-' || extract(year from now())::text || '-' || lpad(nextval('public.rrhh_solicitud_short_id_seq')::text,6,'0'),
     p_empleado_id, p_tipo, p_subtipo, p_fecha_desde, p_fecha_hasta, p_cantidad_dias, p_motivo, auth.uid(), auth.uid())
  returning id, public_id into v_id, v_pub;

  if p_tipo = 'hora_extra' then
    if p_he_cantidad_horas is null or p_he_recargo is null then
      raise exception 'INVALID_HE: hora_extra requiere cantidad_horas y recargo' using errcode='check_violation';
    end if;
    insert into public.rrhh_horas_extra_detalle (solicitud_id, fecha, cantidad_horas, recargo, origen)
    values (v_id, p_fecha_desde, p_he_cantidad_horas, p_he_recargo, coalesce(p_he_origen,'solicitud_empleado'));
  end if;

  insert into public.rrhh_solicitud_eventos (solicitud_id, accion, actor_id, nivel, comentario)
  values (v_id, 'crear', auth.uid(), 'empleado', p_motivo);
  return v_id;
end; $fn$;

-- 6.2 enviar (borrador → pendiente_supervisor | pendiente_rrhh). Dueño.
create or replace function public.rrhh_solicitud_enviar(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare s record; v_caller uuid; v_next public.rrhh_solicitud_estado_t; v_origen text;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='no_data_found'; end if;
  v_caller := public.rrhh_caller_empleado_id();
  if not (v_caller is not null and v_caller = s.empleado_id) then
    raise exception 'ACCESS_DENIED: solo el dueño puede enviar' using errcode='42501';
  end if;
  if s.estado <> 'borrador' then
    raise exception 'INVALID_STATE: solo desde borrador (actual: %)', s.estado using errcode='check_violation';
  end if;
  -- Ruteo: licencia salud (enfermedad/art/maternidad/paternidad) y OT cargada por supervisor → directo a RRHH.
  v_next := 'pendiente_supervisor';
  if s.tipo = 'licencia' and s.subtipo in ('enfermedad','art','maternidad','paternidad') then
    v_next := 'pendiente_rrhh';
  elsif s.tipo = 'hora_extra' then
    select origen into v_origen from public.rrhh_horas_extra_detalle where solicitud_id = p_id;
    if v_origen = 'carga_supervisor' then v_next := 'pendiente_rrhh'; end if;
  end if;
  update public.rrhh_solicitudes set estado = v_next, updated_by = auth.uid() where id = p_id;
  insert into public.rrhh_solicitud_eventos (solicitud_id, accion, actor_id, nivel)
  values (p_id, 'enviar', auth.uid(), 'empleado');
end; $fn$;

-- 6.3 aprobar_l1 (pendiente_supervisor → pendiente_rrhh). Supervisor directo (jerarquía).
create or replace function public.rrhh_solicitud_aprobar_l1(p_id uuid, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare s record; v_caller uuid; v_sup uuid;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='no_data_found'; end if;
  if s.estado <> 'pendiente_supervisor' then
    raise exception 'INVALID_STATE: requiere pendiente_supervisor (actual: %)', s.estado using errcode='check_violation';
  end if;
  v_caller := public.rrhh_caller_empleado_id();
  select supervisor_id into v_sup from public.rrhh_empleados where id = s.empleado_id;
  if not (v_caller is not null and v_caller = v_sup) then
    raise exception 'ACCESS_DENIED: solo el supervisor directo aprueba L1' using errcode='42501';
  end if;
  update public.rrhh_solicitudes set estado = 'pendiente_rrhh', updated_by = auth.uid() where id = p_id;
  insert into public.rrhh_solicitud_eventos (solicitud_id, accion, actor_id, nivel, comentario)
  values (p_id, 'aprobar_l1', auth.uid(), 'supervisor', p_comentario);
end; $fn$;

-- 6.4 aprobar_l2 (pendiente_rrhh → aprobada) + genera novedad. RRHH (rrhh.edit).
create or replace function public.rrhh_solicitud_aprobar_l2(p_id uuid, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare s record; v_tipo public.rrhh_novedad_tipo_t; v_cant numeric; v_periodo text; v_he record;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='no_data_found'; end if;
  if not coalesce(public.has_permission('rrhh.edit'), false) then
    raise exception 'ACCESS_DENIED: requiere rrhh.edit' using errcode='42501';
  end if;
  if s.estado <> 'pendiente_rrhh' then
    raise exception 'INVALID_STATE: requiere pendiente_rrhh (actual: %)', s.estado using errcode='check_violation';
  end if;
  if s.requiere_doc then
    -- la documentación se gestiona en gate de storage; aquí solo se respeta el flag.
    null;
  end if;
  update public.rrhh_solicitudes set estado = 'aprobada', updated_by = auth.uid() where id = p_id;
  insert into public.rrhh_solicitud_eventos (solicitud_id, accion, actor_id, nivel, comentario)
  values (p_id, 'aprobar_l2', auth.uid(), 'rrhh', p_comentario);

  -- Genera novedad (insumo de liquidación futura; sin importes).
  if s.tipo = 'hora_extra' then
    select * into v_he from public.rrhh_horas_extra_detalle where solicitud_id = p_id;
    v_tipo := 'hora_extra'; v_cant := v_he.cantidad_horas; v_periodo := to_char(v_he.fecha,'YYYY-MM');
  else
    v_tipo := s.tipo::text::public.rrhh_novedad_tipo_t;   -- vacaciones|licencia|permiso
    v_cant := coalesce(s.cantidad_dias, 0);
    v_periodo := to_char(s.fecha_desde,'YYYY-MM');
  end if;
  insert into public.rrhh_novedades (empleado_id, periodo, tipo, cantidad, origen_solicitud_id, created_by)
  values (s.empleado_id, v_periodo, v_tipo, v_cant, p_id, auth.uid());
end; $fn$;

-- 6.5 rechazar (pendiente_supervisor → rechazada por supervisor; pendiente_rrhh → rechazada por RRHH).
create or replace function public.rrhh_solicitud_rechazar(p_id uuid, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare s record; v_caller uuid; v_sup uuid; v_nivel text;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='no_data_found'; end if;
  if s.estado = 'pendiente_supervisor' then
    v_caller := public.rrhh_caller_empleado_id();
    select supervisor_id into v_sup from public.rrhh_empleados where id = s.empleado_id;
    if not (v_caller is not null and v_caller = v_sup) then
      raise exception 'ACCESS_DENIED: solo el supervisor directo' using errcode='42501';
    end if;
    v_nivel := 'supervisor';
  elsif s.estado = 'pendiente_rrhh' then
    if not coalesce(public.has_permission('rrhh.edit'), false) then
      raise exception 'ACCESS_DENIED: requiere rrhh.edit' using errcode='42501';
    end if;
    v_nivel := 'rrhh';
  else
    raise exception 'INVALID_STATE: solo desde pendiente_* (actual: %)', s.estado using errcode='check_violation';
  end if;
  update public.rrhh_solicitudes set estado = 'rechazada', updated_by = auth.uid() where id = p_id;
  insert into public.rrhh_solicitud_eventos (solicitud_id, accion, actor_id, nivel, comentario)
  values (p_id, 'rechazar', auth.uid(), v_nivel, p_comentario);
end; $fn$;

-- 6.6 cancelar (borrador/pendiente_* → cancelada). Dueño (retiro pre-aprobación).
create or replace function public.rrhh_solicitud_cancelar(p_id uuid, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare s record; v_caller uuid;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='no_data_found'; end if;
  v_caller := public.rrhh_caller_empleado_id();
  if not (v_caller is not null and v_caller = s.empleado_id) then
    raise exception 'ACCESS_DENIED: solo el dueño cancela' using errcode='42501';
  end if;
  if s.estado not in ('borrador','pendiente_supervisor','pendiente_rrhh') then
    raise exception 'INVALID_STATE: no cancelable (actual: %)', s.estado using errcode='check_violation';
  end if;
  update public.rrhh_solicitudes set estado = 'cancelada', updated_by = auth.uid() where id = p_id;
  insert into public.rrhh_solicitud_eventos (solicitud_id, accion, actor_id, nivel, comentario)
  values (p_id, 'cancelar', auth.uid(), 'empleado', p_comentario);
end; $fn$;

-- 6.7 anular (aprobada → anulada) + contrapartida de novedad. RRHH (rrhh.edit).
create or replace function public.rrhh_solicitud_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $fn$
declare s record; n record;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='no_data_found'; end if;
  if not coalesce(public.has_permission('rrhh.edit'), false) then
    raise exception 'ACCESS_DENIED: requiere rrhh.edit' using errcode='42501';
  end if;
  if s.estado <> 'aprobada' then
    raise exception 'INVALID_STATE: solo desde aprobada (actual: %)', s.estado using errcode='check_violation';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'MOTIVO_REQUIRED: anular requiere motivo' using errcode='check_violation';
  end if;
  update public.rrhh_solicitudes set estado = 'anulada', updated_by = auth.uid() where id = p_id;
  insert into public.rrhh_solicitud_eventos (solicitud_id, accion, actor_id, nivel, comentario)
  values (p_id, 'anular', auth.uid(), 'rrhh', p_motivo);
  -- Contrapartida append-only de las novedades generadas por esta solicitud.
  for n in select * from public.rrhh_novedades where origen_solicitud_id = p_id and cantidad >= 0 loop
    insert into public.rrhh_novedades (empleado_id, periodo, tipo, cantidad, origen_solicitud_id, confirmada, created_by)
    values (n.empleado_id, n.periodo, n.tipo, -n.cantidad, p_id, true, auth.uid());
  end loop;
end; $fn$;

revoke all on function
  public.rrhh_solicitud_crear(uuid, public.rrhh_solicitud_tipo_t, text, date, date, text, numeric, numeric, public.rrhh_recargo_t, text),
  public.rrhh_solicitud_enviar(uuid),
  public.rrhh_solicitud_aprobar_l1(uuid, text),
  public.rrhh_solicitud_aprobar_l2(uuid, text),
  public.rrhh_solicitud_rechazar(uuid, text),
  public.rrhh_solicitud_cancelar(uuid, text),
  public.rrhh_solicitud_anular(uuid, text)
  from public, anon;
grant execute on function
  public.rrhh_solicitud_crear(uuid, public.rrhh_solicitud_tipo_t, text, date, date, text, numeric, numeric, public.rrhh_recargo_t, text),
  public.rrhh_solicitud_enviar(uuid),
  public.rrhh_solicitud_aprobar_l1(uuid, text),
  public.rrhh_solicitud_aprobar_l2(uuid, text),
  public.rrhh_solicitud_rechazar(uuid, text),
  public.rrhh_solicitud_cancelar(uuid, text),
  public.rrhh_solicitud_anular(uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

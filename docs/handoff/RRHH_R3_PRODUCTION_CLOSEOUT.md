# TOPS NEXUS — RRHH · R3 PRODUCTION CLOSEOUT (EXECUTION PACKAGE + STANDBY)

> **Modo:** `READY FOR MANUAL EXECUTION · AWAITING EVIDENCE`. Paquete único de ejecución y cierre de
> R3. **No** aplica nada, **no** toca producción. Instrumento listo para que el operador ejecute
> `0058` y capture la evidencia E1–E8; el cierre se emite con esa evidencia.
> **SQL aprobado:** `0058_rrhh_core.sql` (commit `bf8ca7e`) — **sin modificaciones** (decisión de
> Dirección). **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

---

## 0. Estado y decisiones

```text
RRHH R3
SQL APPROVED FOR PRODUCTION   (RRHH_R3_SQL_AUDIT.md → OPTION A; 0 críticos / 0 mayores)
HARDENING DEFERRED            (m1 TRUNCATE → recomendación, gate de hardening transversal)
READY FOR MANUAL EXECUTION
```

**Decisión de Dirección sobre hallazgos del SQL audit:**
- **m1 (TRUNCATE no bloqueado):** válido pero **NO bloquea R3** (sin regresión, sin exposición de
  PII, no invalida el modelo). Clasificado **HARDENING RECOMMENDATION**, trasladado a un gate de
  hardening transversal. **No** se crea `0058a`. **No** se altera el SQL aprobado.
- **m2–m5:** menores documentados (`RRHH_R3_SQL_AUDIT.md §4`); m3 (anti-ciclos de organigrama) se
  resolverá en el RPC de escritura del gate posterior.

---

## 1. Preflight (operador, antes de pegar)
```
☐ Backup de producción verificado y restaurable
☐ Orden de migraciones: 0056 y 0057 ya aplicadas (aplicar en orden 0056 → 0057 → 0058)
☐ 0058 es la próxima libre en prod
☐ Ventana de cambio acordada; un único operador
```
Verificación de precondición (read-only):
```sql
select exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
  where t.typname='permission_module_t' and e.enumlabel='rrhh') as mod_rrhh,
  (select count(*) from public.permissions where module='rrhh') as permisos_rrhh;
-- esperado: mod_rrhh = true, permisos_rrhh = 5
```

---

## 2. SQL final (idéntico a `bf8ca7e` — pegar en el SQL Editor)

```sql
-- 0058_rrhh_core — RRHH Core Data Model (R3). SOLO datos + RLS + append-only.
-- Precondición: 0056 (módulo 'rrhh') + 0057 (seed RBAC) aplicadas.

-- 1. Enums de soporte
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

-- 2. Triggers de inmutabilidad (append-only)
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

-- 3. Secuencia de legajo
create sequence if not exists public.rrhh_empleado_legajo_seq start 1;

-- 4. rrhh_empleados — legajo
create table if not exists public.rrhh_empleados (
  id                     uuid primary key default gen_random_uuid(),
  public_id              int  not null unique default nextval('public.rrhh_empleado_legajo_seq'),
  profile_id             uuid references public.profiles(id) on delete set null,
  apellido_nombre        text not null,
  dni                    text not null unique,
  cuil                   text not null unique,
  fecha_nacimiento       date,
  domicilio              text,
  telefono               text,
  email_personal         text,
  estado_civil           public.rrhh_estado_civil_t,
  contacto_emergencia    jsonb,
  fecha_ingreso          date not null,
  fecha_reconocida       date,
  categoria              text,
  seccion                text,
  calificacion           text,
  convenio               text,
  modalidad_contratacion public.rrhh_modalidad_contratacion_t,
  depot                  public.depot_t,
  supervisor_id          uuid references public.rrhh_empleados(id) on delete set null,
  obra_social            text,
  estado                 public.rrhh_estado_empleado_t not null default 'activo',
  fecha_baja             date,
  motivo_baja            text,
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

-- 5. rrhh_empleado_bancario (separado por sensibilidad; append-only)
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

-- 6. rrhh_empleado_historial (append-only)
create table if not exists public.rrhh_empleado_historial (
  id             uuid primary key default gen_random_uuid(),
  empleado_id    uuid not null references public.rrhh_empleados(id) on delete cascade,
  campo          text not null,
  valor_anterior text,
  valor_nuevo    text,
  vigente_desde  date not null default current_date,
  changed_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists rrhh_empleado_historial_emp_idx on public.rrhh_empleado_historial(empleado_id, vigente_desde desc);

-- 7. Triggers (updated_at + append-only)
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

-- 8. RLS: has_permission (grueso) + propiedad. SIN current_role(). Fail-closed.
alter table public.rrhh_empleados         enable row level security;
alter table public.rrhh_empleado_bancario  enable row level security;
alter table public.rrhh_empleado_historial enable row level security;

drop policy if exists "rrhh_empleados read" on public.rrhh_empleados;
create policy "rrhh_empleados read" on public.rrhh_empleados
  for select to authenticated
  using (coalesce(public.has_permission('rrhh.view'), false) or profile_id = auth.uid());
drop policy if exists "rrhh_empleados insert" on public.rrhh_empleados;
create policy "rrhh_empleados insert" on public.rrhh_empleados
  for insert to authenticated
  with check (coalesce(public.has_permission('rrhh.admin'), false));
drop policy if exists "rrhh_empleados update" on public.rrhh_empleados;
create policy "rrhh_empleados update" on public.rrhh_empleados
  for update to authenticated
  using (coalesce(public.has_permission('rrhh.admin'), false))
  with check (coalesce(public.has_permission('rrhh.admin'), false));

drop policy if exists "rrhh_bancario read" on public.rrhh_empleado_bancario;
create policy "rrhh_bancario read" on public.rrhh_empleado_bancario
  for select to authenticated
  using (
    coalesce(public.has_permission('rrhh.admin'), false)
    or exists (select 1 from public.rrhh_empleados e
               where e.id = rrhh_empleado_bancario.empleado_id and e.profile_id = auth.uid())
  );
drop policy if exists "rrhh_bancario insert" on public.rrhh_empleado_bancario;
create policy "rrhh_bancario insert" on public.rrhh_empleado_bancario
  for insert to authenticated
  with check (coalesce(public.has_permission('rrhh.admin'), false));

drop policy if exists "rrhh_historial read" on public.rrhh_empleado_historial;
create policy "rrhh_historial read" on public.rrhh_empleado_historial
  for select to authenticated
  using (coalesce(public.has_permission('rrhh.view'), false));
drop policy if exists "rrhh_historial insert" on public.rrhh_empleado_historial;
create policy "rrhh_historial insert" on public.rrhh_empleado_historial
  for insert to authenticated
  with check (coalesce(public.has_permission('rrhh.admin'), false));

notify pgrst, 'reload schema';
```

---

## 3. Evidencia E1–E8 (read-only, completar al aplicar)

| ID | Evidencia | Query / acción | Esperado | Estado |
|----|-----------|----------------|----------|--------|
| **E1** | Enums creados | `select typname from pg_type where typname like 'rrhh_%_t' order by 1;` | 3 (`rrhh_estado_civil_t`, `rrhh_estado_empleado_t`, `rrhh_modalidad_contratacion_t`) | ☐ |
| **E2** | Tablas creadas | `select table_name from information_schema.tables where table_schema='public' and table_name in ('rrhh_empleados','rrhh_empleado_bancario','rrhh_empleado_historial');` | 3 | ☐ |
| **E3** | Índices creados | `select indexname from pg_indexes where schemaname='public' and tablename like 'rrhh_emplead%' order by 1;` | `rrhh_*_idx` + unique | ☐ |
| **E4** | Triggers creados | `select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.rrhh_emplead%' order by 2,1;` | 6 `trg_*` | ☐ |
| **E5** | RLS habilitada | `select relname, relrowsecurity from pg_class where relname like 'rrhh_emplead%';` | rowsecurity=true ×3 | ☐ |
| **E6** | Policies creadas | `select tablename, policyname, cmd from pg_policies where tablename like 'rrhh_emplead%' order by 1,2;` | 7 (sin delete/update en bancario/historial) | ☐ |
| **E7** | Sin errores | captura del SQL Editor | éxito, sin error | ☐ |
| **E8** | Sin objetos fuera de alcance | `select table_name from information_schema.tables where table_schema='public' and table_name like 'rrhh_%' and table_name not in ('rrhh_empleados','rrhh_empleado_bancario','rrhh_empleado_historial');` + `select id from storage.buckets where id like 'rrhh%';` | 0 + 0 | ☐ |

**Smoke de seguridad (recomendado):**
```
☐ DELETE en cualquier tabla RRHH → ERROR (append-only)
☐ UPDATE en bancario/historial → ERROR (append-only)
☐ Empleado (con profile_id) ve solo su fila; sin rrhh.admin no ve bancario ajeno
☐ Usuario operaciones (sin rrhh.*) → 0 filas
```

---

## 4. Lógica de cierre (determinística)

```text
SI  E1 ∧ E2 ∧ E3 ∧ E4 ∧ E5 ∧ E6 ∧ E7 ∧ E8 (con evidencia)
    → R3 CLOSED · CORE DATA MODEL COMPLETE · READY FOR R4

EN OTRO CASO
    → R3 OPEN · PRODUCTION APPLICATION/VERIFICATION REQUIRED
```
**R4 = NO-GO** hasta R3 CLOSED + nueva autorización de Dirección.

---

## 5. Estado del standby
- SQL aprobado y listo: **SÍ** (`bf8ca7e`, sin cambios).
- m1 (TRUNCATE): **diferido** (hardening transversal).
- Aplicación en producción: **NO RECIBIDA**.
- Veredicto vigente: **R3 OPEN · READY FOR MANUAL EXECUTION** (cierre al completar E1–E8).

```text
RRHH R3

SQL APPROVED FOR PRODUCTION
HARDENING DEFERRED
READY FOR MANUAL EXECUTION
→ al completar E1–E8: CORE DATA MODEL COMPLETE · READY FOR R4
```

*Paquete de ejecución y cierre R3 — sin aplicar, sin tocar producción. Pendiente de evidencia E1–E8.*

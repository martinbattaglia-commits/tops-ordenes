# TOPS NEXUS — RBAC-ARCHITECTURE

> **Estado:** auditoría + diseño · **Fecha:** 2026-05-29 · **Revisión FASE 3**
> Arquitectura de control de acceso del ERP: roles, permisos, jerarquías,
> `current_role()`, RLS, **versionado/auditoría de RBAC** y seguridad. Documenta
> el estado **real** (dos sistemas coexistiendo) y el **modelo objetivo** de 9 roles.
> **No** crea tablas ni migraciones — es documentación de consolidación y diseño.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md). Base de evidencia:
> [ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md).
>
> **Corrección FASE 3:** (a) `0009` está **trackeada** (no "untracked" como decían
> versiones previas); (b) el catálogo de permisos define **24** (22 en 0009 + 2 en
> 0010), de los cuales solo **22 están en DB** porque 0010 no está aplicada;
> (c) se agrega §8 **Versionado de RBAC** (diseño, sin migración).

---

## 0. Hallazgo: hay DOS sistemas de RBAC coexistiendo

| | Sistema A — **enum simple** | Sistema B — **RBAC granular** |
|---|---|---|
| Origen | Migración `0001` (+ hardening `0005`) | Migración `0009` (**trackeada**, aplicada en DB) + `0010` (2 permisos, **no aplicada**) |
| Almacén | `profiles.role` (`user_role_t`) | `roles` + `permissions` + `role_permissions` + `user_roles` |
| Valores | `admin`, `operaciones`, `supervisor`, `cliente` | 7 roles · **24 permisos en catálogo** (22 en DB) · mapeos role×permission |
| Lo consume | **TODA la RLS** vía `current_role()` | `has_permission()` / vista `my_permissions` |
| Asignaciones reales | 6 usuarios (admin=1, operaciones=2, supervisor=3) | **`user_roles` = 0 filas → NADIE asignado** |
| Estado efectivo | ✅ **EN USO** (autorización real) | ⚠️ **DORMIDO** (seedeado pero no aplica) |

> **Conclusión crítica:** aunque existe un RBAC rico (roles/permisos), la
> autorización efectiva del sistema hoy depende del **enum de 4 valores**. El
> RBAC granular está sembrado pero no conectado (nadie tiene filas en
> `user_roles`, y la RLS no llama a `has_permission`). **Unificar esto es la
> tarea de gobernanza #1 antes de sumar Tesorería/Cuentas Corrientes.**

---

## 1. `current_role()` — el corazón de la autorización

Definida en `0001`, endurecida en `0005` (fix de recursión RLS):

```sql
create or replace function public.current_role()
returns public.user_role_t
language sql stable
security definer                       -- bypassa RLS al leer profiles (corta recursión)
set search_path = public, pg_temp     -- anti schema-hijacking
as $$ select role from public.profiles where id = auth.uid() $$;

revoke all on function public.current_role() from public;
grant execute on function public.current_role() to authenticated, anon, service_role;
```

Helpers complementarios (también `SECURITY DEFINER`, no recursivos):
- `is_staff()` → `role in ('admin','operaciones','supervisor')`.
- `is_admin()` → `role = 'admin'`.

**Por qué `SECURITY DEFINER`:** la policy de `profiles` referenciaba
`current_role()`, que leía `profiles` → recursión infinita (PG error 54001).
`SECURITY DEFINER` hace que la función lea `profiles` saltando RLS, cortando el
ciclo. **No tocar esta propiedad** sin entender el efecto (riesgo de recursión).

Helper del RBAC granular (`0009`, hoy sin uso en RLS):
```sql
public.has_permission(p_slug text) returns boolean   -- une user_roles→role_permissions→permissions
```

---

## 2. Permisos catalogados (Sistema B — 24 en catálogo, 22 en DB)

Modelo: `permission(module, action)`. Enums `permission_module_t` ×
`permission_action_t`. **22 sembrados en `0009`** + **2 en `0010`**
(`documental.export`, `documental.admin`). Como 0010 **no está aplicada**, la DB
real hoy tiene 22; el catálogo objetivo es 24.

| Módulo | Permisos (slug.action) | Origen |
|--------|------------------------|--------|
| `cockpit` | view, export | 0009 |
| `compras` | view, create, edit, sign, export, delete | 0009 |
| `servicios` | view, create, sign | 0009 |
| `comercial` | view, edit | 0009 |
| `compliance` | view, edit | 0009 |
| `cctv` | view, admin | 0009 |
| `documental` | view, create, delete | 0009 |
| `documental` | **export, admin** | **0010 (pendiente)** |
| `analytics` | view | 0009 |
| `sistema` | admin | 0009 |

Acciones disponibles: `view, create, edit, delete, sign, export, admin`.

---

## 3. Roles del sistema (Sistema B, 7 en DB)

| slug | Nombre | is_system | Permisos asignados (resumen) |
|------|--------|:---------:|------------------------------|
| `director_ops` | Director de Operaciones | ✅ | **TODOS** (único con `compras.sign`) |
| `admin` | Administración | ✅ | todo **menos** `compras.sign` |
| `operaciones` | Operaciones | ✅ | cockpit.view, compras view/create, servicios (view/create/sign), cctv.view, documental.view |
| `compliance` | Compliance / DT | ✅ | cockpit.view, compliance (view/edit), documental (view/create), cctv.view |
| `comercial` | Comercial | ✅ | cockpit.view, comercial (view/edit) |
| `seguridad` | Seguridad / CCTV | ✅ | cockpit.view, cctv (view/admin) |
| `cliente_b2b` | Cliente B2B | ✅ | servicios.view (solo su dominio) |

> `user_roles` = 0 → estos roles **no están asignados a ningún usuario todavía**.

---

## 4. Jerarquía efectiva HOY (enum simple, lo que realmente aplica)

```
            admin                 ← acceso total interno (escritura fiscal, RBAC, config)
              │
          supervisor              ← lectura amplia + auditoría (invoice_audit read)
              │
         operaciones              ← operación diaria (crea OS/OC, emite facturas)
              │
           cliente                ← portal B2B: solo SUS comprobantes (profiles.client_id)
```

Reglas RLS observadas (de 0008/0009/0011), todas vía `current_role()`:
- **Escritura fiscal** (`customer_invoices`, `invoice_items`): `admin`, `operaciones`.
- **Config fiscal / puntos de venta / RBAC** (escritura): `admin`.
- **Auditoría fiscal** (`invoice_audit` read): `admin`, `supervisor`; insert: `admin`, `operaciones`.
- **OC** (`purchase_orders` write): `admin`, `operaciones`, `supervisor`.
- **Cliente** ve solo lo suyo: `client_id = (select client_id from profiles where id = auth.uid())`.

---

## 5. Modelo OBJETIVO — 9 roles (lo pedido) y su mapeo

| Rol objetivo | Mapea a (actual) | Permisos núcleo | ¿Existe? |
|--------------|------------------|-----------------|:--------:|
| **Super Admin** | `admin` (enum) + `sistema.admin` | Todo, incl. gestión de roles/usuarios/config fiscal y X.509 | 🟡 parcial (no hay rol "super" separado del admin financiero) |
| **Directorio** | `director_ops` | Todo lo operativo + **firma OC** + cockpit ejecutivo | ✅ |
| **Administración** | `admin` | Finanzas, facturación, proveedores, compliance; **sin firmar OC** | ✅ |
| **Facturación** | — | `analytics.view`, emitir/leer `customer_invoices`, config fiscal lectura | ❌ **falta** |
| **Compras** | (operaciones parcial) | `compras` view/create/edit/export; **sin** `sign` | 🟡 parcial (no hay rol dedicado) |
| **Operaciones** | `operaciones` | OS/OC operativo, cctv.view, documental.view | ✅ |
| **Comercial** | `comercial` | pipeline/contactos Clientify | ✅ |
| **Cliente Portal** | `cliente_b2b` / enum `cliente` | solo SUS OS/OC/facturas/CC | ✅ |
| **Auditor** | (supervisor parcial) | **solo lectura** transversal + `invoice_audit`/`audit_log` read; sin escritura | ❌ **falta** |

**Gaps de roles a cubrir (sin crear tablas — solo seed/config de RBAC existente):**
1. **Facturación** — rol nuevo en `roles` + mapeo a permisos de invoices/analytics.
2. **Compras** — separar de `operaciones`; rol con permisos `compras.*` sin `sign`.
3. **Auditor** — rol read-only transversal (clave para compliance/Neuralsoft).
4. **Super Admin** vs **Administración** — hoy ambos colapsan en `admin`. Separar
   el rol técnico (gestión de sistema/usuarios/cert) del rol financiero.

> Estos 4 roles se pueden cubrir **sin nuevas tablas**: ya existen `roles`,
> `permissions`, `role_permissions`. Solo falta **seed** + ampliar el enum
> `user_role_t` o (mejor) **migrar la RLS al RBAC granular** (ver §7).

---

## 6. Seguridad — checklist de estado

| Control | Estado | Nota |
|---------|:------:|------|
| RLS habilitada en todas las tablas | ✅ | 0008/0009/0011 hacen `enable row level security` |
| `current_role()` no recursiva | ✅ | `SECURITY DEFINER` + `search_path` fijo (0005) |
| Clave X.509 fuera de DB/repo | ✅ | host-only (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`), `cert_alias` en `fiscal_config` |
| `.env.local` fuera de git | ✅ | `.gitignore` cubre `.env*.local`, `*.pem` |
| Auditoría append-only | 🟡 | `invoice_audit`/`po_events`/`audit_log` insert-only por RLS, pero **CASCADE permite borrado** vía la factura/OC padre |
| Bucket fiscal con scoping por cliente | ❌ | bucket `invoices` daría acceso a cualquier `authenticated` (riesgo R4 del informe ERP) |
| RBAC granular conectado a RLS | ❌ | RLS usa enum simple; `has_permission` sin uso |
| Asignación de usuarios a roles | ❌ | `user_roles` vacío |
| **Versionado/auditoría de cambios RBAC** | ❌ | sin `rbac_audit` ni triggers; `profiles.role` se pisa sin historial → ver §8 |
| Separación de deberes (SoD) | 🟡 | firma OC aislada a `director_ops` ✅; falta rol Auditor y Facturación |

---

## 7. Recomendación de unificación (gobernanza, sin nuevas tablas)

**Camino sugerido (post-consolidación, antes de Tesorería):**

1. **Poblar `user_roles`** para los 6 usuarios actuales (mapear su
   `profiles.role` a un rol granular).
2. **Agregar roles faltantes** (Facturación, Compras, Auditor, Super Admin) vía
   seed en `roles` + `role_permissions` (tablas ya existen).
3. **Agregar permisos faltantes** para el dominio financiero futuro
   (`tesoreria.*`, `cuentas_corrientes.*`, `contabilidad.*`) en el catálogo
   `permissions` — esto **sí** será parte de la migración financiera, no ahora.
4. **Migrar la RLS** progresivamente de `current_role() in (...)` a
   `has_permission('modulo.accion')`, dejando `current_role()` como fallback de
   compatibilidad. Tabla por tabla, con tests.
5. **Trigger anti-borrado** en comprobantes/OC autorizados + `ON DELETE RESTRICT`
   en las auditorías (cierra el gap append-only real).

> Mientras tanto, el enum simple sigue siendo la fuente de verdad: **no romper
> `current_role()`** ni sus propiedades `SECURITY DEFINER`.

---

## 8. Versionado de RBAC (diseño — Prioridad 3, sin migración)

> **Problema a resolver.** Hoy un cambio de autorización es **invisible y
> destructivo**: `settings/users` reescribe `profiles.role` (un `UPDATE` que
> pisa el valor anterior, sin historial); `role_permissions`/`user_roles` **no
> tienen triggers ni auditoría**; `user_roles.assigned_by`/`assigned_at` guardan
> solo el *último* estado (se sobrescriben al reasignar). No existe forma de
> responder *"¿quién le dio a Fulano permiso de firmar OC, cuándo y quién lo
> aprobó?"*. Para un ERP que reemplaza a Neuralsoft y maneja firma fiscal/OC,
> esto es un **gap de compliance** (SoD, trazabilidad, no-repudio).

### 8.1 Estado actual verificado

| Objeto | Mutado por | Historial | Auditoría |
|--------|-----------|:---------:|:---------:|
| `profiles.role` (enum, lo que aplica) | `settings/users/actions.ts` (`UPDATE`) | ❌ se pisa | 🟡 `audit_log` ad-hoc (solo en *invite*, no en cambios posteriores) |
| `user_roles` (granular) | nada en runtime (UI read-only) | ❌ | ❌ sin trigger |
| `role_permissions` (granular) | nada en runtime (seed only) | ❌ | ❌ sin trigger |
| `roles` / `permissions` | seed only | ❌ | ❌ sin trigger |

> `settings/roles` (`src/lib/rbac/data.ts`) es **solo lectura** (`getRoles`,
> `getRolePermissions`, …); no hay `insert/update/delete` a RBAC. El gap de
> historial existe **independientemente** de qué modelo (enum vs granular) sea
> la fuente de verdad.

### 8.2 Patrón de referencia: `documents_audit` (0010)

El versionado de RBAC debe **reusar el patrón ya validado** del Centro Documental
(append-only + trigger `SECURITY DEFINER` AFTER INSERT/UPDATE/DELETE), no inventar
uno nuevo:

- Tabla append-only con `INSERT`-only por RLS y **`ON DELETE RESTRICT`** hacia
  cualquier FK (cerrar el gap CASCADE del §6).
- Trigger `SECURITY DEFINER` + `set search_path = public, pg_temp`.
- Captura `auth.uid()` como actor, `now()` como timestamp, y `to_jsonb(OLD)` /
  `to_jsonb(NEW)` como snapshot diff.

### 8.3 Diseño propuesto (DDL objetivo — NO aplicar hasta GATE financiero)

```sql
-- Append-only. Una fila por cada cambio de autorización (grant/revoke/role swap).
create table public.rbac_audit (
  id            bigserial primary key,
  ts            timestamptz not null default now(),
  actor_id      uuid references auth.users(id) on delete set null,  -- quién cambió
  target_table  text   not null check (target_table in
                  ('profiles','user_roles','role_permissions','roles','permissions')),
  op            text   not null check (op in ('INSERT','UPDATE','DELETE')),
  target_user   uuid,            -- a quién afecta (si aplica)
  role_slug     text,            -- rol involucrado (denormalizado para lectura)
  permission_slug text,          -- permiso involucrado (denormalizado)
  before_state  jsonb,           -- to_jsonb(OLD)
  after_state   jsonb,           -- to_jsonb(NEW)
  reason        text             -- justificación opcional (lo setea el server action)
);
create index rbac_audit_target_user_idx on public.rbac_audit(target_user, ts desc);
create index rbac_audit_actor_idx       on public.rbac_audit(actor_id, ts desc);
```

```sql
-- Trigger SECURITY DEFINER (mismo molde que tg_documents_audit)
create or replace function public.tg_rbac_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.rbac_audit(actor_id, target_table, op,
                                target_user, before_state, after_state)
  values (
    auth.uid(),
    tg_table_name,
    tg_op,
    coalesce( (case when tg_op='DELETE' then OLD else NEW end ->> 'user_id')::uuid, null),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(NEW) end
  );
  return case when tg_op = 'DELETE' then OLD else NEW end;
end $$;

create trigger user_roles_audit
  after insert or update or delete on public.user_roles
  for each row execute function public.tg_rbac_audit();
create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row execute function public.tg_rbac_audit();
-- (idem profiles para capturar el cambio de enum, y roles/permissions)
```

```sql
-- RLS: append-only, lectura solo admin/auditor
alter table public.rbac_audit enable row level security;
create policy rbac_audit_insert on public.rbac_audit
  for insert to authenticated with check (true);          -- solo vía trigger DEFINER
create policy rbac_audit_read on public.rbac_audit
  for select to authenticated using (is_admin());          -- + rol Auditor cuando exista
-- sin policy de UPDATE/DELETE → inmutable. Las FK NO usan CASCADE.
```

### 8.4 Capa de aplicación (server actions, hoy inexistentes)

`settings/roles` es read-only; para que el versionado tenga sentido, las
mutaciones deben pasar por **server actions auditados** (no `UPDATE` directos):

1. `grantPermission(role, permission, reason)` / `revokePermission(...)` →
   `INSERT`/`DELETE` en `role_permissions`; el trigger registra la fila.
2. `assignRole(user, role, reason)` / `unassignRole(...)` → `user_roles`.
3. `setUserBaseRole(user, enumRole, reason)` → reemplaza el `UPDATE` crudo de
   `settings/users`, escribiendo `reason` y dejando rastro en `rbac_audit`.
4. Todos: gate `is_admin()` server-side **antes** del write (defensa en
   profundidad, no confiar solo en RLS).

### 8.5 Versionado del *catálogo* (roles/permisos como código)

Independiente del historial de asignaciones: el **catálogo** de roles y permisos
(qué permisos existen, qué incluye cada rol) debe versionarse **como migración
idempotente** (el patrón actual `on conflict do nothing` de 0009/0010 ya lo es).
Regla: **ningún seed de RBAC se edita in-place en producción** — todo cambio de
catálogo entra por una migración nueva (0012+), preservando PARIDAD
Código↔Migración↔DB. El `rbac_audit` cubre los cambios *de datos en runtime*; las
migraciones cubren los cambios *de catálogo*.

### 8.6 Checklist de cierre (cuándo se considera "versionado")

| Criterio | Estado |
|----------|:------:|
| Tabla `rbac_audit` append-only con FK `RESTRICT` | ⬜ diseño |
| Trigger `tg_rbac_audit` SECURITY DEFINER en las 4+ tablas | ⬜ diseño |
| Server actions auditados (grant/revoke/assign/setBaseRole) | ⬜ diseño |
| Vista de lectura para Auditor (`rbac_audit` + join slugs) | ⬜ diseño |
| Catálogo versionado solo por migración (no in-place) | ✅ ya se cumple (0009/0010 idempotentes) |
| `reason` obligatorio en cambios sensibles (`*.sign`, `sistema.admin`) | ⬜ diseño |

> **Restricción de fase:** esto es **diseño**. El DDL de §8.3 entra como parte de
> la **migración financiera/RBAC (0012+)**, no ahora. No aplicar contra producción.
> Va atado al mismo GATE que la unificación RLS (§7) — versionar primero lo que
> hoy está dormido sería auditar una tabla vacía.

Documentos relacionados: [ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) ·
[ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md) ·
[ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md) ·
[erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md).

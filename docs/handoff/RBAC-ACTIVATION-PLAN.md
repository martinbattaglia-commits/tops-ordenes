# RBAC-ACTIVATION-PLAN

**Fecha:** 2026-06-08
**Estado base (RBAC-QA-REPORT):** `user_roles=0`, 6 roles definitivos ausentes, `RBAC_ENFORCE` off → fail-open.
**Objetivo:** preparar la activación completa del RBAC en el Supabase productivo `arsksytgdnzukbmfgkju`.
**⚠️ NO EJECUTAR.** Plan para aprobación. SQL idempotente, email-based (sin UUIDs hardcodeados).

---

## 0) Usuarios reales detectados (auth.users) y mapeo

| Email (real, en auth.users) | Rol destino | depot | Nota |
|---|---|---|---|
| martin@logisticatops.com | `super_admin` | — | Presidencia |
| **martin.battaglia@logisticatops.com** | `super_admin` | — | **cuenta operadora — DEBE tener super_admin o queda bloqueada** (H4: consolidar luego) |
| joseluis@logisticatops.com | `admin_operativo` | — | |
| cynthia@logisticatops.com | `gerencia_comercial` | — | |
| martinrinas@logisticatops.com | `gerencia_comercial` | — | |
| ruth@logisticatops.com | `administracion_finanzas` | — | |
| despachos-lujan@logisticatops.com | `jefe_deposito_anexa` | LUJAN | Jorge Merino |
| *(no existe cuenta)* | `jefe_deposito_central` | MAGALDI | **Juan C. Reynoso — alta de usuario pendiente**; rol se crea sin asignar |

> Los **7 usuarios** quedan asignados → sin lockout al activar enforce. `jefe_deposito_central` se crea pero sin usuario (no rompe nada).

---

## 1) SQL — Creación de los 6 roles definitivos

```sql
-- Idempotente. Los slugs nuevos NO colisionan con los 11 legacy existentes.
insert into public.roles (slug, name, description, color, is_system) values
  ('super_admin',             'Super Admin · Presidencia',      'Acceso total + administración RBAC/seguridad', '#050555', true),
  ('admin_operativo',         'Admin Operativo',                 'Total funcional; sin RBAC; RRHH solo lectura', '#214576', true),
  ('gerencia_comercial',      'Gerencia Comercial',              'CRM/Comercial + Compras + Operaciones/WMS',    '#0E7C3A', true),
  ('administracion_finanzas', 'Administración y Finanzas',       'Tesorería/AP/Compras + Operaciones/WMS + Analytics', '#B45309', true),
  ('jefe_deposito_central',   'Jefe Depósito Central · Magaldi', 'Operaciones/WMS/Pedidos',                      '#214576', true),
  ('jefe_deposito_anexa',     'Jefe Depósito Anexa · Luján',     'Operaciones/WMS/Pedidos',                      '#214576', true)
on conflict (slug) do nothing;
```

---

## 2) SQL — Permisos (grants `role_permissions`, basados en módulos sobre los 52 permisos existentes)

```sql
-- super_admin → TODOS los permisos (incluye sistema = RBAC/seguridad y cockpit ejecutivo)
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'super_admin'
on conflict do nothing;

-- admin_operativo → TODO menos 'sistema'; RRHH solo 'view'. (incluye cockpit.* → ve cockpit ejecutivo)
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'admin_operativo'
    and p.module <> 'sistema'
    and not (p.module = 'rrhh' and p.action <> 'view')
on conflict do nothing;

-- gerencia_comercial → comercial + compras + servicios + operaciones + wms
--   (SIN cockpit/analytics/tesoreria/cuentas_pagar/sistema/compliance/cctv/documental/rrhh)
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'gerencia_comercial'
    and p.module in ('comercial','compras','servicios','operaciones','wms')
on conflict do nothing;

-- administracion_finanzas → tesoreria + cuentas_pagar + compras + servicios + operaciones + wms + analytics.view
--   (SIN comercial; SIN cockpit.view → el cockpit le oculta bloques financieros; su finanzas vive en módulo Tesorería)
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'administracion_finanzas'
    and ( p.module in ('tesoreria','cuentas_pagar','compras','servicios','operaciones','wms')
          or p.slug = 'analytics.view' )
on conflict do nothing;

-- jefes de depósito (central + anexa) → servicios + operaciones + wms + pedidos
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug in ('jefe_deposito_central','jefe_deposito_anexa')
    and p.module in ('servicios','operaciones','wms','pedidos')
on conflict do nothing;
```

> **Frontera de Cockpit (rollback model):** `cockpit.view` solo lo tienen `super_admin` y `admin_operativo` (vía sus reglas) → solo ellos ven los **bloques financieros** del Cockpit y los ítems exec del sidebar (`/ejecutivo`, `/analytics`). Comercial, Finanzas y depósitos ven el Cockpit operativo, sin financiero.
> *(Opcional, fuera de alcance: crear `mi_espacio.view` — hoy no existe en DB y la ruta `/workspace` no está gateada.)*

---

## 3) SQL — Asignación de usuarios (`user_roles`, email-based contra auth.users)

```sql
-- No requiere pegar UUIDs: resuelve user_id por email. Idempotente.
insert into public.user_roles (user_id, role_id, depot)
select u.id, r.id, m.depot
from (values
  ('martin@logisticatops.com',            'super_admin',             null),
  ('martin.battaglia@logisticatops.com',  'super_admin',             null),  -- operadora: evita lockout
  ('joseluis@logisticatops.com',          'admin_operativo',         null),
  ('cynthia@logisticatops.com',           'gerencia_comercial',      null),
  ('martinrinas@logisticatops.com',       'gerencia_comercial',      null),
  ('ruth@logisticatops.com',              'administracion_finanzas', null),
  ('despachos-lujan@logisticatops.com',   'jefe_deposito_anexa',     'LUJAN')
) as m(email, role_slug, depot)
join auth.users u on u.email = m.email
join public.roles r on r.slug = m.role_slug
on conflict (user_id, role_id) do nothing;

-- jefe_deposito_central (Juan C. Reynoso / MAGALDI): SIN cuenta aún.
-- Cuando se cree el usuario, ejecutar:
-- insert into public.user_roles (user_id, role_id, depot)
-- select u.id, r.id, 'MAGALDI' from auth.users u, public.roles r
-- where u.email='<email_reynoso>' and r.slug='jefe_deposito_central'
-- on conflict (user_id, role_id) do nothing;
```

> Verificar que `user_roles` tenga columna `depot` (enum MAGALDI/LUJAN/null) y PK `(user_id, role_id)` (migración 0009). Si la PK difiere, ajustar el `on conflict`.

---

## 4) Plan de migración (fases)

| Fase | Acción | Reversible |
|---|---|---|
| F0 | **Backup**: `pg_dump` de `roles`, `role_permissions`, `user_roles` (o snapshot Supabase) | — |
| F1 | Ejecutar §1 (crear 6 roles) | sí (§5) |
| F2 | Ejecutar §2 (grants) | sí (§5) |
| F3 | Ejecutar §3 (asignar 7 usuarios) | sí (§5) |
| F4 | **Validar en fail-open** (enforce OFF): contar filas, revisar grants por rol (§7 QA-A) | — |
| F5 | Activar `RBAC_ENFORCE=1` en **Netlify** (prod) y redeploy/restart | sí (quitar var) |
| F6 | QA por rol logueado (§7 QA-B) | — |

> **Regla de oro:** seed PRIMERO (F1-F3), enforce DESPUÉS (F5). Nunca enforce con `user_roles` incompleto.

---

## 5) Plan de rollback

```sql
-- Revertir SOLO lo nuevo (no toca los 11 roles legacy ni sus 141 grants).
delete from public.user_roles
  where role_id in (select id from public.roles where slug in
    ('super_admin','admin_operativo','gerencia_comercial','administracion_finanzas','jefe_deposito_central','jefe_deposito_anexa'));

delete from public.role_permissions
  where role_id in (select id from public.roles where slug in
    ('super_admin','admin_operativo','gerencia_comercial','administracion_finanzas','jefe_deposito_central','jefe_deposito_anexa'));

delete from public.roles where slug in
    ('super_admin','admin_operativo','gerencia_comercial','administracion_finanzas','jefe_deposito_central','jefe_deposito_anexa');
```
- **Y** quitar `RBAC_ENFORCE` (o `=0`) en Netlify → vuelve a fail-open inmediato.
- Efecto: sistema regresa exactamente al estado pre-activación (fail-open, sin roles nuevos). Riesgo de rollback: **bajo** (solo borra filas nuevas; legacy intacto).

---

## 6) Checklist de activación

- [ ] F0 Backup tomado (roles/role_permissions/user_roles).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` válida para ejecutar SQL (o acceso al SQL editor de Supabase).
- [ ] §1 ejecutado → `select count(*) from roles where slug in (6)` = 6.
- [ ] §2 ejecutado → grants por rol > 0 (ver QA-A).
- [ ] §3 ejecutado → `select count(*) from user_roles` = 7.
- [ ] **Confirmado: `martin.battaglia@` (operadora) tiene super_admin** (anti-lockout).
- [ ] Verificado en fail-open que la app sigue operativa.
- [ ] `RBAC_ENFORCE=1` seteado en Netlify (y `.env.local` dev si se quiere probar local).
- [ ] Redeploy/restart hecho.
- [ ] QA-B por rol superado.

---

## 7) Checklist de QA

**QA-A — datos (enforce OFF, post-seed):**
```sql
select r.slug, count(rp.permission_id) grants
from roles r left join role_permissions rp on rp.role_id=r.id
where r.slug in ('super_admin','admin_operativo','gerencia_comercial','administracion_finanzas','jefe_deposito_central','jefe_deposito_anexa')
group by r.slug order by r.slug;
-- Esperado (aprox, sobre 52 permisos):
--   super_admin = 52 (todos)
--   admin_operativo = todos menos sistema(1) y rrhh no-view → ~ (52 - 1 - (rrhh no-view))
--   gerencia_comercial = comercial+compras+servicios+operaciones+wms
--   administracion_finanzas = tesoreria+cuentas_pagar+compras+servicios+operaciones+wms + analytics.view
--   jefe_deposito_* = servicios+operaciones+wms+pedidos
select count(*) from user_roles;  -- = 7
```

**QA-B — runtime por rol (enforce ON, login real):**

| Rol | DEBE acceder | DEBE ser bloqueado (403/oculto) |
|---|---|---|
| super_admin | todo, incl. /settings/roles, /ejecutivo (financiero), /analytics | nada |
| admin_operativo | todo funcional, /ejecutivo (financiero), /analytics | /settings/roles (sistema), editar RRHH |
| gerencia_comercial | /comercial, /compras, /dashboard, /wms, cockpit operativo | /tesoreria, /analytics, financiero del cockpit, /settings |
| administracion_finanzas | /tesoreria, /compras, /wms, /analytics | /comercial, financiero del cockpit ejecutivo, /settings |
| jefe_deposito_central/anexa | /dashboard, /wms, /pedidos, cockpit operativo | /tesoreria, /comercial, /analytics, /settings |

> Probar también **URL directa** (no solo menú): p.ej. gerencia_comercial → GET /tesoreria debe dar acceso restringido. *(Nota: hoy solo 3 páginas + drive/cuentas_pagar tienen guard server-side; el resto de rutas/APIs necesitan ampliar `checkPermission` para que el 403 sea efectivo — ver dependencias.)*

---

## 8) Orden exacto de ejecución

```
1. Backup (F0)
2. §1  crear roles
3. §2  grants
4. §3  asignar usuarios   ← verificar martin.battaglia@ = super_admin
5. QA-A (conteos/grants)  ← con enforce OFF
6. RBAC_ENFORCE=1 en Netlify + redeploy
7. QA-B (login por rol)
8. (si falla) → §5 rollback + quitar RBAC_ENFORCE
```

---

## Impacto / Riesgos / Dependencias / Validaciones

**Impacto:** pasa de fail-open (todos ven todo) a fail-closed por rol. Cambia el acceso efectivo de los 7 usuarios.

**Riesgos:**
- 🔴 **Lockout** si se activa enforce con usuarios sin rol → mitigado: los 7 quedan asignados; `martin.battaglia@` (operadora) = super_admin.
- 🟠 **Cobertura parcial de enforcement:** hoy solo ~3 páginas + drive/cuentas_pagar chequean permiso; muchas rutas/APIs (~19-20/23) **no** tienen `checkPermission`. Con enforce ON, esas rutas **no** bloquean por permiso (siguen accesibles a cualquier logueado). El RBAC será efectivo **solo donde hay guard**. → Ampliar cobertura es trabajo posterior (no bloquea la activación, pero acotar expectativas).
- 🟠 `jefe_deposito_central` sin usuario hasta crear la cuenta de Reynoso.
- 🟢 Rollback simple y de bajo riesgo (solo filas nuevas).

**Dependencias:** acceso de escritura al Supabase productivo (SQL editor o service key); acceso a Netlify env para `RBAC_ENFORCE`; alta de usuario Reynoso (opcional, diferible); resolución H4 (consolidar martin.battaglia@↔martin@) — diferible.

**Validaciones:** QA-A (datos) + QA-B (runtime por rol) + prueba de URL directa.

> **NO aplicar.** Este documento es para aprobación. Tras tu OK indico/ejecuto en el orden §8, con backup previo y verificación anti-lockout.

# TOPS NEXUS — RBAC-ARCHITECTURE

> **Estado:** auditoría + diseño · **Fecha:** 2026-05-29
> Arquitectura de control de acceso del ERP: roles, permisos, jerarquías,
> `current_role()`, RLS y seguridad. Documenta el estado **real** (dos sistemas
> coexistiendo) y el **modelo objetivo** de 9 roles.
> **No** crea tablas ni migraciones — es documentación de consolidación.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md).

---

## 0. Hallazgo: hay DOS sistemas de RBAC coexistiendo

| | Sistema A — **enum simple** | Sistema B — **RBAC granular** |
|---|---|---|
| Origen | Migración `0001` (+ hardening `0005`) | Migración `0009` (untracked, **aplicada en DB**) |
| Almacén | `profiles.role` (`user_role_t`) | `roles` + `permissions` + `role_permissions` + `user_roles` |
| Valores | `admin`, `operaciones`, `supervisor`, `cliente` | 7 roles · 22 permisos · 64 mapeos |
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

## 2. Permisos catalogados (Sistema B, 22 en DB)

Modelo: `permission(module, action)`. Enums `permission_module_t` ×
`permission_action_t`.

| Módulo | Permisos (slug.action) |
|--------|------------------------|
| `cockpit` | view, export |
| `compras` | view, create, edit, sign, export, delete |
| `servicios` | view, create, sign |
| `comercial` | view, edit |
| `compliance` | view, edit |
| `cctv` | view, admin |
| `documental` | view, create, delete |
| `analytics` | view |
| `sistema` | admin |

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

Documentos relacionados: [ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) ·
[ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md) ·
[erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md).

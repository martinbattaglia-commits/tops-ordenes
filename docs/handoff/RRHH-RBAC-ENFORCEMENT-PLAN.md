# RRHH-RBAC-ENFORCEMENT-PLAN (Opción A)

**Fecha:** 2026-06-08 · **Modo:** plan. **No ejecutar · No activar RBAC · No modificar producción.**
**Objetivo:** que `mi_espacio.view` exista y gatee `/rrhh/mi-espacio`, y que todo `/rrhh/*` sensible quede protegido por `rrhh.*`, materializando:

```
SUPER_ADMIN / ADMIN_OPERATIVO → RRHH completo + Mi Espacio
GERENCIA_COMERCIAL / ADMIN_FINANZAS / JEFE_DEP_CENTRAL / JEFE_DEP_ANEXA → solo Mi Espacio
```

> ⚠️ **Cambio vs matriz previa:** este addendum define **ADMIN_OPERATIVO → RRHH completo** (antes era "RRHH solo lectura"). El plan asume RRHH completo para admin_operativo; **confirmar** si debe ser full o solo `rrhh.view`.

---

## 1) Inventario real auditado de `/rrhh/*`

| Recurso | Archivo | Guard actual | Acción |
|---|---|---|---|
| Dashboard RRHH | `app/(app)/rrhh/page.tsx` | parcial (`hasPerm`, UI) | gatear con `rrhh.view` |
| Empleados (lista) | `app/(app)/rrhh/empleados/page.tsx` | ❌ sin guard | gatear `rrhh.view` |
| Empleado (detalle) | `app/(app)/rrhh/empleados/[id]/page.tsx` | `hasPerm("rrhh.admin")` (UI) | gatear `rrhh.view` (+ admin para datos sensibles) |
| Novedades | `app/(app)/rrhh/novedades/page.tsx` | ❌ sin guard | gatear `rrhh.view` |
| Solicitudes (lista) | `app/(app)/rrhh/solicitudes/page.tsx` | ❌ sin guard | gatear `rrhh.view` |
| Solicitud (detalle) | `app/(app)/rrhh/solicitudes/[id]/page.tsx` | `hasPerm("rrhh.edit")` (UI) | gatear `rrhh.view` |
| Documentos | `app/(app)/rrhh/documentos/page.tsx` | ❌ sin guard | gatear `rrhh.view` |
| **Mi Espacio** | `app/(app)/rrhh/mi-espacio/page.tsx` | ❌ sin guard | gatear **`mi_espacio.view`** (NO `rrhh.*`) |
| Accesos Google | `app/(app)/workspace/page.tsx` | ❌ sin guard | gatear **`mi_espacio.view`** (autoservicio) |
| Server actions | `lib/rrhh/actions.ts` + inline en `documentos/page.tsx`, `solicitudes/[id]/page.tsx` | parcial | **verificar permiso server-side** en cada action mutante |
| APIs REST RRHH | — | (no hay `/api/rrhh/*`; se usa server actions) | n/a |
| RLS | tablas RRHH (ej. bancario → `rrhh.admin` o dueño, `lib/rrhh/data.ts:78`) | parcial | verificar/extender por tabla |

Helper disponible: `hasPerm(slug): Promise<boolean>` (`lib/rrhh/data.ts:21`) — reutilizable para los guards de página.

---

## 2) Permisos

`rrhh.*` ya existen en DB: `rrhh.view`, `rrhh.create`, `rrhh.edit`, `rrhh.export`, `rrhh.admin`.
**Falta crear** `mi_espacio.view` (hoy solo está como tipo en `types.ts`).

```sql
-- CREAR permiso Mi Espacio (independiente de RRHH)
insert into public.permissions (slug, module, action, label, description) values
  ('mi_espacio.view','mi_espacio','view',
   'Ver Mi Espacio (autoservicio)',
   'Legajo/datos/solicitudes/vacaciones/documentación propios. Independiente de rrhh.*')
on conflict (slug) do nothing;
```

### Grants (sobre el plan de activación)
```sql
-- mi_espacio.view → los 4 roles limitados (super_admin lo tiene por "todos";
--   admin_operativo por su regla "módulo <> sistema"). Explícito para los 4:
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.slug='mi_espacio.view'
  where r.slug in ('gerencia_comercial','administracion_finanzas','jefe_deposito_central','jefe_deposito_anexa')
on conflict do nothing;

-- rrhh.* completo → SUPER_ADMIN (ya por "todos") + ADMIN_OPERATIVO
--   (admin_operativo ya recibe rrhh.* por su regla módulo<>sistema; si se quería "solo view",
--    ESA regla debe ajustarse — ver advertencia arriba).
-- Los 4 limitados NO reciben ningún rrhh.* → solo Mi Espacio.
```

> Resultado de grants: limitados = `mi_espacio.view` y **cero `rrhh.*`**; super_admin/admin_operativo = `rrhh.*` + `mi_espacio.view`.

---

## 3) Guards a implementar (spec de código — NO ejecutado)

Patrón server-side al tope de cada page (reusa `hasPerm` + un componente "Acceso restringido"):

```tsx
// páginas RRHH sensibles
import { hasPerm } from "@/lib/rrhh/data";
export default async function Page() {
  if (!(await hasPerm("rrhh.view"))) return <AccesoRestringido modulo="RRHH" />;
  // …
}

// /rrhh/mi-espacio y /workspace
if (!(await hasPerm("mi_espacio.view"))) return <AccesoRestringido modulo="Mi Espacio" />;
```

Archivos a tocar (8 páginas + workspace):
- `rrhh/page.tsx`, `rrhh/empleados/page.tsx`, `rrhh/empleados/[id]/page.tsx`, `rrhh/novedades/page.tsx`, `rrhh/solicitudes/page.tsx`, `rrhh/solicitudes/[id]/page.tsx`, `rrhh/documentos/page.tsx` → `rrhh.view`.
- `rrhh/mi-espacio/page.tsx`, `workspace/page.tsx` → `mi_espacio.view`.

**Server actions (mutaciones):** en `lib/rrhh/actions.ts` y las inline, agregar verificación al inicio de cada action (`rrhh.create`/`rrhh.edit`/`rrhh.admin` según corresponda) — el guard de página NO protege la action; debe chequearse en el servidor.

**RLS:** verificar que las tablas RRHH (empleados, legajos, solicitudes, documentos, bancario) tengan políticas que limiten a `rrhh.*` o al dueño; extender donde falte (defensa en profundidad además del guard de página).

---

## 4) MAGALDI — alta preparada (NO ejecutar)

```sql
-- 1) Crear usuario despachos-magaldi@logisticatops.com (Supabase Auth → Invite/Create user).
--    (acción en consola Supabase / admin API; no incluida aquí)
-- 2) Asignar rol (tras el alta):
insert into public.user_roles (user_id, role_id, depot)
select u.id, r.id, 'MAGALDI'
from auth.users u, public.roles r
where u.email='despachos-magaldi@logisticatops.com' and r.slug='jefe_deposito_central'
on conflict (user_id, role_id) do nothing;
```
Recibe: `servicios/operaciones/wms/pedidos` + `mi_espacio.view`. **Sin RRHH.**

---

## 5) Impacto

- **Limitados (Comercial/Finanzas/Depósitos):** pierden el acceso (hoy abierto por fail-open/sin guard) a Empleados/Novedades/Solicitudes/Documentos; **conservan Mi Espacio**.
- **SUPER_ADMIN/ADMIN_OPERATIVO:** RRHH completo + Mi Espacio.
- Requiere **cambios de código** (guards en 9 archivos + actions) además del SQL.

## 6) Riesgos

- 🟠 **Server actions sin guard real:** si solo se gatean páginas y no las actions, un limitado podría invocar mutaciones RRHH. → Obligatorio chequear permiso en cada action.
- 🟠 **`admin_operativo` RRHH full vs solo-lectura:** discrepancia con la matriz previa → confirmar.
- 🟠 **Mi Espacio depende de datos propios:** `/rrhh/mi-espacio` debe filtrar por el usuario actual (RLS/owner) para no exponer terceros aun con `mi_espacio.view`.
- 🟢 Bajo riesgo de lockout (Mi Espacio se concede a todos los roles).
- 🟠 Sin guard, el plan NO surte efecto hasta desplegar el código.

## 7) QA requerido

| Rol | `/rrhh/empleados` | `/rrhh/novedades` | `/rrhh/mi-espacio` | `/workspace` |
|---|:--:|:--:|:--:|:--:|
| super_admin | ✅ | ✅ | ✅ | ✅ |
| admin_operativo | ✅ | ✅ | ✅ | ✅ |
| gerencia_comercial | ❌ 403 | ❌ 403 | ✅ | ✅ |
| administracion_finanzas | ❌ 403 | ❌ 403 | ✅ | ✅ |
| jefe_dep_central/anexa | ❌ 403 | ❌ 403 | ✅ | ✅ |

- Probar **URL directa** (no solo menú).
- Probar **server action** (ej. crear novedad) con rol limitado → debe rechazar.
- Verificar que Mi Espacio muestra **solo datos propios**.
- Pre-requisito de QA real: RBAC activado (roles+user_roles+`RBAC_ENFORCE=1`) — ver `RBAC-ACTIVATION-PLAN.md`.

---

## Orden sugerido (cuando apruebes)
1. `mi_espacio.view` (SQL §2) + grants §2.
2. Guards en código §3 (9 páginas + server actions) + verificación RLS.
3. Deploy.
4. Activación RBAC (plan general) + QA §7.

> **Nada ejecutado.** Pendiente: confirmar (a) admin_operativo RRHH full vs view, (b) alta de `despachos-magaldi@`, y aprobar los cambios de código del §3.

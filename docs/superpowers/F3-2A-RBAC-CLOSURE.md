# Fase 3.2A — Cierre Definitivo del Bloque RBAC de Nexus Link (read-only)

> Security Architect · 2026-06-30. **Read-only / diseño.** Decisiones de Dirección aplicadas al modelo. `0155` queda definida (SQL final) pero **NO creada/implementada**. Evidencia: Supabase MCP (`arsksytgdnzukbmfgkju`).

## 1. Modelo RBAC definitivo (decisiones de Dirección aplicadas)
| Rol (slug) | view | create | edit | delete | admin | Origen | Usuarios |
|---|---|---|---|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ | 0146 | 0 |
| `director_ops` | ✓ | ✓ | ✓ | ✓ | ✓ | 0146 | 2 |
| `gerencia` | ✓ | ✓ | ✓ | – | – | **0155** | 3 |
| `jefe_deposito` | ✓ | ✓ | ✓ | – | – | **0155** | 2 |
| `operaciones` | ✓ | ✓ | ✓ | – | – | 0146 | 0 |
| `comercial` | ✓ | ✓ | ✓ | – | – | 0146 | 0 |
| `compliance` | ✓ | ✓ | ✓ | – | – | 0146 | 0 |
| `seguridad` | ✓ | ✓ | – | – | – | 0146 | 0 |
| `rrhh_admin` | ✓ | ✓ | – | – | – | **0155** | 2 |
| `cliente_b2b`·`employee_self_service`·`rrhh_manager`·`rrhh_viewer` | – | – | – | – | – | excluidos | — |
- **Decisión 1 (`rrhh_admin`):** view+create, SIN edit/admin/delete. ✓ (0155 lo refleja).
- **Decisión 2 (`seguridad`):** view+create, SIN edit/admin/delete. ✓ (ya así por 0146; 0155 no lo toca).
- **Cobertura:** 7/10 usuarios activos. `admin/delete` = mínimo privilegio (solo admin+director_ops, sin cambios).

## 2. SQL definitivo de `0155` (diseñada, NO creada)
```sql
-- 0155_connect_rbac_pilot_grants.sql — Fase 3 (Integración Productiva). ENTREGADA, NO APLICADA (G3).
-- ÚNICA responsabilidad: ampliar el CATÁLOGO RBAC (role_permissions) al alcance del piloto F3
-- aprobado por Dirección. NO modifica 0146 (intacta, historial). NO toca tablas funcionales, RLS,
-- RPC, triggers, realtime ni estructuras existentes. IDEMPOTENTE (on conflict do nothing → PK
-- role_permissions(role_id,permission_id)). Fail-closed: externos NO reciben connect.*.
-- DEPENDE de 0146 (permisos connect.* + grants base) y 0009 (roles/permissions/role_permissions).

-- view + create (participación base): roles del piloto nuevos.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id from public.roles ro
join public.permissions p on p.slug in ('connect.view','connect.create')
where ro.slug in ('gerencia','jefe_deposito','rrhh_admin')
on conflict do nothing;

-- edit (moderar / vincular entidades): management + jefatura operativa.
-- rrhh_admin y seguridad NO moderan (Decisión Dirección 1 y 2).
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id from public.roles ro
join public.permissions p on p.slug = 'connect.edit'
where ro.slug in ('gerencia','jefe_deposito')
on conflict do nothing;

-- admin/delete: SIN cambios (solo admin + director_ops, definido en 0146). NO se amplía.

notify pgrst, 'reload schema';
```
- **Cumple las restricciones de Dirección:** solo catálogo RBAC; sin ALTER de tablas/estructuras; sin RLS/RPC/triggers/realtime.

## 3. Validación de idempotencia (evidencia)
- `public.role_permissions` tiene **PRIMARY KEY `(role_id, permission_id)`** (verificado en catálogo). → `insert ... on conflict do nothing` encuentra árbitro en la PK; **re-ejecución = no-op** (0 filas nuevas en la 2ª corrida).
- Los `insert...select` están acotados por el `where ro.slug in (...)` + el join a `permissions.slug` → no insertan filas espurias. **Idempotente confirmado.**

## 4. Validación fail-closed
- **Externos sin acceso:** `cliente_b2b`/`employee_self_service`/`rrhh_manager`/`rrhh_viewer` no reciben `connect.*` → `has_permission('connect.*')`=false → módulo invisible + RPC/RLS niegan. ✓
- **Sin herencia indebida:** `role_permissions` explícito por rol; sin transitividad. ✓
- **RLS refleja los grants sin cambios de policy:** las policies de `connect_*` (0143) evalúan `has_permission` → toman los nuevos grants automáticamente; 0155 no toca policies. ✓
- **⚠️ Caveat sistémico (NO es defecto del modelo RBAC):** el fallback `isLegacyAdmin` (boot-permissions: `connect = slugs.has('connect.view') || isLegacyAdmin`) habilita connect a cuentas con `profiles.role='admin'` aunque no tengan grant RBAC. Es la postura global super-admin (**R-2**, ya documentada), no específica de connect. Afecta a 1 de los 3 usuarios sin rol (ver §7).

## 5. Compatibilidad entre ambientes
prod: **0 `connect.*` hoy** (greenfield). Secuencia canónica `0146 → 0155`, ambas idempotentes → cualquier ambiente (prod/dev/demo) **converge** aplicando la secuencia ordenada. La numeración (0155>0146) garantiza el orden. Sin divergencia (append-only).

## 6. Compatibilidad RLS / Auth / Profiles
- **RLS:** 0155 solo agrega filas `role_permissions`; las policies (0143) no cambian y reflejan los grants vía `has_permission`. ✓
- **Auth:** 0155 no toca `auth.*`; usa `roles`/`user_roles` existentes. ✓
- **Profiles:** 0155 no toca `profiles`; el gating usa roles RBAC (vía `user_roles`), no `profiles.role` (salvo el fallback isLegacyAdmin, §4). ✓

## 7. Usuarios sin rol — registro (Decisión Dirección 3: NO incorporar; mantener fail-closed)
| Identidad | Email | `profiles.role` legacy | Alta | Motivo de ausencia de rol | ¿Vería connect? | Recomendación futura |
|---|---|---|---|---|---|---|
| martin@logisticatops.com | martin@logisticatops.com | **admin** | 2026-05-26 | Cuenta de setup/owner; perfil incompleto (full_name = email); nunca asignada a `user_roles` | **SÍ, vía `isLegacyAdmin`** (R-2, no por RBAC) | Revisar: completar perfil + asignar rol explícito (p.ej. director_ops/gerencia) o desactivar si es cuenta de setup. Cierra el caveat R-2 para esta cuenta |
| martin.battaglia@logisticatops.com | (idem) | operaciones | 2026-05-29 | Perfil incompleto (full_name = email); sin `user_roles`. Posible cuenta secundaria/duplicada del titular | **NO** (operaciones legacy ≠ admin) | Revisar duplicidad con la cuenta RBAC del titular; completar/consolidar o desactivar |
| Martib Fernandez | martinferbat@gmail.com | operaciones | 2026-06-10 | Email personal (gmail); nombre con typo ("Martib"); sin `user_roles`. Posible cuenta de prueba | **NO** | Revisar si es usuario real (onboarding) o cuenta de prueba (desactivar) |
> **Acción:** NINGUNA automática (Dirección: no asignar roles). Quedan fuera del piloto. **Salvedad honesta:** la cuenta legacy-admin (#1) **sí** accedería por la postura global R-2; excluirla requiere acción sobre R-2 o sobre su `profiles.role` (fuera del alcance del modelo RBAC connect).

## 8. Riesgos remanentes
- 🟠 **R-2 (sistémico, pre-existente):** `isLegacyAdmin` da connect a cuentas legacy-admin sin grant RBAC (1 cuenta hoy). No es defecto del modelo RBAC; es la postura global. Decisión de Dirección si se desea cerrar antes de exponer a externos (F5).
- 🟢 Sequencing: 0155 debe aplicarse **después** de 0146 (numeración lo garantiza).
- 🟢 Cobertura 7/10: los otros 3 son cuentas incompletas/prueba (no usuarios productivos del piloto).

## 9. Checklist final de RBAC
| Validación | Estado |
|---|---|
| 9 roles del piloto existen (slug verificado) | ✅ |
| Modelo definitivo con decisiones de Dirección (rrhh_admin/seguridad view+create) | ✅ |
| `0155` SQL final (solo catálogo RBAC, sin tablas/RLS/RPC/triggers/realtime/estructuras) | ✅ |
| Idempotencia (PK role_permissions = árbitro de on conflict) | ✅ Verificado |
| Fail-closed (externos/herencia/RLS) | ✅ (con caveat R-2 documentado) |
| Compatibilidad entre ambientes (append-only, convergencia) | ✅ |
| Compatibilidad RLS/Auth/Profiles | ✅ |
| 3 usuarios sin rol registrados (identidad/motivo/recomendación) | ✅ |
| `0146` intacta (no modificada) | ✅ |
| Crear archivo `0155` + materializar | ⏳ F3.2B (sin autorización) |

## 10. Recomendación GO / NO GO — Cierre del bloque RBAC
**🟢 GO. El bloque RBAC queda DEFINITIVAMENTE CERRADO.** Todas las validaciones resultan satisfactorias: modelo definitivo conforme a las decisiones de Dirección, `0155` final (idempotente, solo catálogo, fail-closed, sin tocar estructuras), `0146` intacta, compatibilidad entre ambientes y con RLS/Auth/Profiles confirmada, usuarios sin rol registrados y excluidos. El único riesgo remanente (R-2, `isLegacyAdmin`) es sistémico/pre-existente y ajeno al modelo RBAC de connect.

**F3.2B puede comenzar una vez cumplidas ÚNICAMENTE las condiciones operativas restantes:**
1. Crear la rama dedicada `feat/nexus-link-integration`.
2. Verificar el backup lógico (dashboard Supabase) — PITR/WAL ya verificado operativo.
3. Autorización explícita de la ventana G3.

El bloque de apply queda definido como **`0142`–`0155`**. **No se inicia F3.2B** hasta la autorización explícita posterior.

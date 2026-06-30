# Fase 3.2A — Modelo RBAC Definitivo de Nexus Link (diseño, read-only)

> Security Architect · 2026-06-30. **Read-only / solo diseño.** Nada aplicado/implementado: no se creó la migración, no se tocó prod/código. Evidencia: Supabase MCP (`arsksytgdnzukbmfgkju`) + `0146`. Decisión de Dirección: piloto de 9 roles internos.

## 1. Matriz definitiva de roles (ETAPA 1 — verificado en prod, todos EXISTEN)
| Etiqueta Dirección | slug | Nombre real prod | Usuarios | Permisos hoy | connect.* hoy |
|---|---|---|---|---|---|
| Administrador | `admin` | Administración | 0 | 60 | 0 |
| Director de Operaciones | `director_ops` | Director de Operaciones | **2** | 65 | 0 |
| Gerencia | `gerencia` | Gerencia (acceso total sin RRHH) | **3** | 57 | 0 |
| Jefe de Depósito | `jefe_deposito` | Jefe de Deposito | **2** | 8 | 0 |
| Operaciones | `operaciones` | Operaciones | 0 | 25 | 0 |
| Comercial | `comercial` | Comercial | 0 | 14 | 0 |
| Compliance | `compliance` | Compliance / DT | 0 | 20 | 0 |
| Seguridad / CCTV | `seguridad` | Seguridad / CCTV | 0 | 8 | 0 |
| RRHH Administrativo | `rrhh_admin` | Administrador RRHH | **2** | 7 | 0 |
- **9/9 roles existen.** Compatibilidad con `connect.*`: **total** (acción `permission_action_t` ya soporta view/create/edit/delete/admin; ningún rol tiene connect.* aún → sin colisión).
- **Cobertura:** con el set de 9, **7 de 10 usuarios activos** verían Nexus Link (hoy solo 2 con `director_ops`).
- **Residual:** **3 usuarios sin ningún rol** asignado → quedarían sin acceso (fail-closed correcto). **Decisión de Dirección** (ver §5/riesgos): asignarles rol o dejarlos fuera del piloto.
- **Exclusiones (verificadas):** `cliente_b2b`, `employee_self_service` (Portal del Empleado), `rrhh_manager` (Responsable RRHH), `rrhh_viewer` (Visor RRHH) → fuera del piloto. Ningún usuario interno está asignado SOLO a un rol excluido (sin lock-out indebido).

## 2. Matriz definitiva de permisos (estado resultante 0146 + corrección)
| Rol | view | create | edit | delete | admin | Origen |
|---|---|---|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ | 0146 |
| `director_ops` | ✓ | ✓ | ✓ | ✓ | ✓ | 0146 |
| `operaciones` | ✓ | ✓ | ✓ | – | – | 0146 |
| `comercial` | ✓ | ✓ | ✓ | – | – | 0146 |
| `compliance` | ✓ | ✓ | ✓ | – | – | 0146 |
| `seguridad` | ✓ | ✓ | – | – | – | 0146 |
| **`gerencia`** | ✓ | ✓ | ✓ | – | – | **0155 (nuevo)** |
| **`jefe_deposito`** | ✓ | ✓ | ✓ | – | – | **0155 (nuevo)** |
| **`rrhh_admin`** | ✓ | ✓ | – | – | – | **0155 (nuevo)** |
| `cliente_b2b`, `employee_self_service`, `rrhh_manager`, `rrhh_viewer` | – | – | – | – | – | excluidos |
- **Niveles (criterio):** `view+create` = participación base (todos). `edit` = moderar/vincular entidades → operativos+management (no `seguridad` ni `rrhh_admin`). `admin+delete` = gestión total/borrado físico → solo `admin`+`director_ops` (sin cambios; mínimo privilegio).
- **Decisiones a confirmar por Dirección (judgment calls):** (a) `rrhh_admin` = view+create (RRHH participa, no modera) — ¿se desea `edit`? (b) `seguridad` = view+create (heredado de 0146) — ¿se desea `edit`?

## 3. Estrategia recomendada — **B) Nueva migración correctiva `0155`** (NO modificar `0146`)
## 4. Justificación técnica (no por simplicidad)
| Criterio | A) Modificar 0146 | **B) Nueva migración 0155 (recomendada)** |
|---|---|---|
| **Trazabilidad** | Reescribe el seed RC1.0; el "por qué" se pierde en un diff | **Cada migración = una decisión**: 0146 (baseline RC1.0) + 0155 (decisión F3 de Dirección, fechada y documentada) |
| **Historial** | Reabre un artefacto del commit RC1.0 CERRADO (`42ad20d`) | **Append-only**; respeta el cierre de RC1; no reescribe lo entregado |
| **Mantenibilidad** | 1 archivo, pero mezcla baseline + decisión posterior | Self-documenting; idempotente (`on conflict do nothing`); patrón estándar del proyecto |
| **Compatibilidad entre ambientes** | 0146 hoy NO aplicada → "seguro ahora", pero si se aplica en otro ambiente y luego se edita → **divergencia latente** (la clase de problema que mostró el renumerado 0141) | **Environment-safe por construcción**: cualquier ambiente converge aplicando la secuencia ordenada completa |
| **Gobernanza del proyecto** | Viola "nunca editar seed in-place; versionar RBAC solo por migración idempotente" | **Cumple** la regla mandatoria (architecture-tops-nexus) |
**Conclusión:** B gana en 5/5 criterios salvo "1 archivo". La regla de gobernanza del catálogo RBAC ("se versiona solo por migración idempotente, nunca editar in-place") es **mandatoria** → **B**.

## 5. Diseño completo de `0155` (ETAPA 3 — diseñada, NO implementada)
> **Objetivo:** extender los grants `connect.*` al alcance del piloto F3 aprobado por Dirección (suma `gerencia`, `jefe_deposito`, `rrhh_admin`), sin tocar 0146.
> **Operaciones:** solo `insert into role_permissions ... on conflict do nothing` (3 grupos). **No** crea permisos (ya en 0146), **no** toca RLS/RPC/tablas, **no** ALTER. **Impacto:** +5 filas `role_permissions` (gerencia: view/create/edit; jefe_deposito: view/create/edit; rrhh_admin: view/create → 3+3+2 = 8 filas; menos solapes = neto según estado). **Idempotente.**

```sql
-- 0155_connect_rbac_pilot_grants.sql — Fase 3 (Integración Productiva). ENTREGADA, NO APLICADA (G3).
-- Extiende los grants connect.* de 0146 al ALCANCE DEL PILOTO aprobado por Dirección (F3.2A):
-- suma gerencia, jefe_deposito, rrhh_admin. NO modifica 0146 (append-only, trazabilidad).
-- IDEMPOTENTE (on conflict do nothing). NO crea permisos (ya en 0146), NO toca RLS/RPC/tablas.
-- Fail-closed intacto: externos (cliente_b2b/employee_self_service/rrhh_manager/rrhh_viewer) NO reciben connect.*.
-- DEPENDE de 0146 (permisos connect.* + grants base) y 0009 (roles/permissions/role_permissions).

-- view + create (participación base): roles operativos/management nuevos del piloto.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id from public.roles ro
join public.permissions p on p.slug in ('connect.view','connect.create')
where ro.slug in ('gerencia','jefe_deposito','rrhh_admin')
on conflict do nothing;

-- edit (moderar / vincular entidades): management + jefatura operativa (rrhh_admin NO modera).
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id from public.roles ro
join public.permissions p on p.slug = 'connect.edit'
where ro.slug in ('gerencia','jefe_deposito')
on conflict do nothing;

-- admin/delete: SIN cambios (solo admin + director_ops, definido en 0146). NO se amplía (mínimo privilegio).

notify pgrst, 'reload schema';
```
> **Rollback:** `delete from role_permissions` de esas filas (join roles gerencia/jefe_deposito/rrhh_admin × connect.view/create/edit). Reversible limpio, sin pérdida de datos. **Compatibilidad:** prod en 0 connect.* (greenfield) → aplicar 0146+0155 en orden siembra el set completo; cualquier ambiente converge por secuencia.

## 6. Compatibilidad entre ambientes
prod: 0 `connect.*` hoy. Secuencia canónica = `0146` (baseline) → `0155` (piloto). Ambos idempotentes (`on conflict do nothing`) → re-ejecución segura, sin divergencia. Demo/dev convergen aplicando la misma secuencia. El orden lo garantiza la numeración (0155 > 0146).

## 7. Plan de rollback
Lógico (preferido): `delete` de las filas `role_permissions` de 0155 (gerencia/jefe_deposito/rrhh_admin) → revierte el piloto sin tocar 0146. Si se revierte todo connect: delete de connect.* perms (cubre 0146+0155). Red final: PITR. Sin datos de runtime involucrados (solo catálogo RBAC).

## 8. Confirmación del modelo fail-closed (ETAPA 4)
- **Externos sin acceso:** `cliente_b2b`/`employee_self_service`/`rrhh_manager`/`rrhh_viewer` no reciben `connect.*` → `has_permission('connect.view')`=false → módulo invisible + RPC niegan + RLS niega. ✓
- **Sin herencia indebida:** `role_permissions` es explícito por rol (no hay herencia transitiva); cada rol obtiene SOLO lo que 0146/0155 le otorgan. ✓
- **RLS intacta:** 0155 solo agrega filas `role_permissions`; no toca policies, RPCs ni helpers. Las RLS de `connect_*` (0143) siguen evaluando `has_permission` + membresía sin cambios. ✓
- **3 usuarios sin rol:** no obtienen connect (fail-closed correcto) salvo `isLegacyAdmin`. Comportamiento seguro por defecto.

## 9. Checklist de validación
| Punto | Estado |
|---|---|
| 9 roles del piloto existen en prod (slug verificado) | ✅ Completo |
| Cobertura calculada (7/10 usuarios) + residual (3 sin rol) | ✅ Completo |
| Matriz de roles + permisos definitiva | ✅ Completo |
| Estrategia (B: nueva migración) justificada en 5 criterios | ✅ Completo |
| `0155` diseñada (SQL completo, no implementada) | ✅ Completo |
| Fail-closed re-verificado (externos/herencia/RLS) | ✅ Completo |
| Rollback + compatibilidad entre ambientes | ✅ Completo |
| Decisión: niveles `rrhh_admin`/`seguridad` (edit?) | 🔴 Confirmar Dirección |
| Decisión: 3 usuarios sin rol | 🔴 Confirmar Dirección |
| Crear archivo `0155` + materializar | ⏳ Pendiente (F3.2B, sin autorización) |

## 10. Recomendación GO / NO GO para F3.2B
**🟢 GO — con la condición RBAC RESUELTA a nivel de diseño.** El bloqueante RBAC-1 queda **cerrado en diseño**: modelo definitivo, migración `0155` diseñada, fail-closed confirmado. Para autorizar F3.2B restan **decisiones puntuales de Dirección** (no técnicas): (a) confirmar niveles `rrhh_admin`/`seguridad` (¿edit?); (b) resolver los 3 usuarios sin rol; y las condiciones procedimentales ya conocidas (rama dedicada, backup lógico en dashboard, autorización G3). Con (a) y (b) confirmadas, el modelo RBAC queda 100% cerrado y **F3.2B puede materializarse** (crear `0155` + ejecutar el plan G3 con `0142`–`0155`).

---
**No se inicia ninguna implementación.** Modelo RBAC definido y documentado; `0155` diseñada pero NO creada. A la espera de aprobación explícita para F3.2B.

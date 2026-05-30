# TOPS NEXUS — RBAC · VALIDATION REPORT (Fase 5)

> **Estado:** ✅ **RBAC VALIDADO EN STAGING AISLADO — modelo SIMPLE activo, GRANULAR dormido** · **Fecha:** 2026-05-29
> Valida roles, permisos, RLS, `current_role()` y `has_permission()` sobre `tops-nexus-staging`.
> **Producción intacta.** Qué funciona HOY vs qué queda pendiente, con evidencia ejecutada.

---

## 0. Dos modelos de RBAC coexisten (verificado)

| Modelo | Definición | Estado en staging |
|--------|-----------|--------------------|
| **SIMPLE** | `profiles.role` (enum `user_role_t`) + `current_role()` | ✅ **ACTIVO y enforced** |
| **GRANULAR** | `roles` + `permissions` + `role_permissions` + `user_roles` + `has_permission()` | ⚠️ **DORMIDO** (construido, no cableado) |

---

## 1. Modelo SIMPLE (activo) — evidencia

- **Enum `user_role_t`** = `admin / operaciones / supervisor / cliente`.
- **`current_role()`** (SECURITY DEFINER STABLE): retorna `profiles.role` del `auth.uid()`. Probado: para el usuario admin → `current_role()='admin'` ✅.
- **`is_staff()`**: helper para staff interno (admin/operaciones/supervisor).
- **Enforcement:** **50 policies RLS** (en `public` + `storage`) usan `current_role()`.

**Validación funcional (Fases 2–4):**

| Evidencia | Resultado |
|-----------|-----------|
| Cliente ve sólo sus documentos; interno ve todos (T1) | ✅ |
| Ataque cross-tenant bloqueado (T2) | ✅ |
| Soft-delete: cliente no ve, admin sí (T5) | ✅ |
| Storage `documents` scoped por `split_part(name,'/',1)=client_id` o staff | ✅ |
| Inmutabilidad fiscal/documental por trigger (T7, T8, A6) | ✅ |

> **El modelo SIMPLE es seguro y suficiente para todo lo que está hoy en producción.** Es el que protege
> el aislamiento multi-tenant y los módulos documental y fiscal validados en este GATE.

---

## 2. Modelo GRANULAR (dormido) — evidencia

| Métrica | Valor verificado |
|---------|------------------|
| `roles` | **7** — `admin, cliente_b2b, comercial, compliance, director_ops, operaciones, seguridad` |
| `permissions` | **24** (módulos: analytics, cctv, cockpit, comercial, compliance, compras, **documental**, servicios, sistema) |
| `role_permissions` (mapeos) | **68** |
| **`user_roles` (asignaciones a usuarios)** | **0** ← **clave: nadie tiene rol granular asignado** |
| Policies RLS que usan `has_permission()` | **0** ← **no cableado a control de acceso** |
| Tabla `rbac_audit` | **no existe** |

### 2.1 `has_permission()` — comportamiento real (verificado)

Definición:
```sql
has_permission(slug) :=
  EXISTS (user_roles ⋈ role_permissions ⋈ permissions WHERE user_id=auth.uid() AND slug=…)
  OR current_role() = 'admin'
```

| Caso probado | Resultado | Interpretación |
|--------------|-----------|----------------|
| admin → `has_permission('documental.view')` | **true** | pasa por el **fallback SIMPLE** `current_role()='admin'`, NO por la rama granular |
| cliente → `has_permission('documental.view')` | **false** | la rama granular está vacía (`user_roles=0`) y no es admin |
| cliente → `has_permission('compras.sign')` | **false** | idem |

> **Diagnóstico:** la función existe y su lógica es correcta, pero **la rama granular (`user_roles`) está
> muerta** porque no hay asignaciones, y **ninguna policy la invoca**. Sólo opera el atajo de admin.

---

## 3. Hallazgos RBAC (confirmados con evidencia)

| ID | Hallazgo | Severidad | Impacto |
|----|----------|-----------|---------|
| **G3** | RBAC granular dormido: `user_roles=0`, `has_permission()` en 0 policies | ⚠️ alto (compliance) | **Sin SoD** (Separation of Duties): un mismo usuario interno puede emitir y autorizar. Aceptable para módulos actuales; **insuficiente para ERP financiero con dinero real**. |
| **G9** | Cambios de RBAC sin versionar (`rbac_audit` no existe) | ⚠️ alto (auditoría) | Escalada de privilegios **no trazable**. |

> Ninguno bloquea el **schema** de GATE 2 (ambos son del modelo granular dormido). Bloquean **operar el ERP
> financiero con control interno auditable** → deben cerrarse en `0012+`.

---

## 4. Qué funciona HOY vs qué queda pendiente

| Capacidad | Estado |
|-----------|--------|
| Aislamiento multi-tenant por rol/cliente | ✅ **funciona** (SIMPLE, 50 policies) |
| Staff interno ve todo / cliente sólo lo suyo | ✅ **funciona** |
| Inmutabilidad documental y fiscal por rol+trigger | ✅ **funciona** |
| Permisos finos por acción (ej. sólo "compras.sign") | ❌ **pendiente** (granular dormido) |
| Separation of Duties (emite ≠ autoriza) | ❌ **pendiente** (G3) |
| Auditoría de cambios de permisos | ❌ **pendiente** (G9: `rbac_audit`) |
| Roles B2B finos para clientes (`cliente_b2b`) | ❌ **pendiente** (sin `user_roles`) |

---

## 5. Checklist para activar RBAC granular auditado (diseño, NO ejecutar aquí)

- [ ] **Poblar `user_roles`** (asignar roles granulares a usuarios reales).
- [ ] **Cablear `has_permission()`** en las RLS de módulos financieros sensibles (reemplazar/complementar `current_role()`).
- [ ] **Crear `rbac_audit`** (trigger `SECURITY DEFINER` append-only, patrón `documents_audit`) → cierra G9.
- [ ] **Definir SoD** explícito: separar emisión vs autorización de comprobantes → cierra G3.
- [ ] **Migrar la decisión de admin-fallback**: revisar si el atajo `current_role()='admin'` debe permanecer o restringirse por permiso.

> Estas acciones corresponden a `0012+` (la `rbac_audit` ya tiene diseño conceptual en MIGRATION-0012-DESIGN-REVIEW).

---

## 6. Veredicto Fase 5

> **✅ RBAC VALIDADO con diagnóstico claro.** El **modelo SIMPLE está activo, correcto y enforced**
> (50 policies, multi-tenant probado) — **seguro para lo que está en producción y para los módulos
> documental/fiscal de este GATE**. El **modelo GRANULAR está construido pero dormido** (G3: `user_roles=0`,
> `has_permission` sin cablear; G9: sin `rbac_audit`). **No bloquea GATE 2 (schema)**, pero **debe activarse
> antes de operar el ERP financiero con dinero real** para tener SoD y auditoría de privilegios.

---

## 7. ¿Acerca a reemplazar Neuralsoft?

**SÍ.** El control de acceso multi-tenant base ya es sólido (SIMPLE). Activar el RBAC granular + `rbac_audit`
(G3/G9) dota al ERP del **control interno auditable** que exige operar finanzas reales — capacidad que
diferencia un ERP serio. Está **diseñado y a un paso de ejecución** (`0012+`), sobre una base ya validada.

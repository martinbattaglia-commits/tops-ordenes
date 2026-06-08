# RBAC-QA-REPORT

**Fecha:** 2026-06-08
**Base productiva auditada:** `https://arsksytgdnzukbmfgkju.supabase.co` (el productivo, por directiva).
**Método:** consultas read-only a PostgREST con service role (bypassa RLS → conteos globales reales) + inspección de código. Secretos no impresos.

---

## RESPUESTA EXPLÍCITA

> ## ❌ El RBAC **NO está operativo**. Está **modelado y pendiente de activación**.

Tres hechos lo determinan, con evidencia de la DB productiva:
1. **`user_roles` = 0 asignaciones** (global) → `checkPermission` entra en su rama fail-open: **todo usuario autenticado pasa cualquier permiso** (`enforced:false`).
2. **Los 6 roles definitivos NO existen en la DB** (solo están en código/tipos/spec de migración).
3. **`RBAC_ENFORCE` está sin setear** → el override fail-closed está apagado.

Resultado: hoy, cualquier usuario logueado tiene **acceso completo**, sin importar la matriz diseñada.

---

## 1) `user_roles` — EVIDENCIA REAL
```
GET /rest/v1/user_roles?select=user_id  (Prefer: count=exact)
→ Content-Range: */0   [HTTP 200]
total asignaciones = 0
```
**0 filas.** Es el disparador exacto del fail-open (H1). Mientras esté vacía, RBAC está dormido.

## 2) `permissions` — REAL
```
count = 52   ·   cockpit.view presente: True
muestra: analytics.view, cctv.admin/view, cockpit.export/view, comercial.{admin,create,delete,edit,view}, compliance.{edit,view}…
```
Catálogo **sí** seedeado (52 permisos). ✅ (la definición existe)

## 3) `roles` — REAL (¡modelo viejo, no el definitivo!)
```
count = 11
slugs: admin, cliente_b2b, comercial, compliance, director_ops,
       employee_self_service, operaciones, rrhh_admin, rrhh_manager,
       rrhh_viewer, seguridad
role_permissions = 141   (los roles legacy SÍ tienen grants)
```
**Los 6 roles definitivos NO existen en la DB:**
```
super_admin ............... NO existe
admin_operativo ........... NO existe
gerencia_comercial ........ NO existe
administracion_finanzas ... NO existe
jefe_deposito_central ..... NO existe
jefe_deposito_anexa ....... NO existe
```
→ El modelo definitivo (F3) está **solo en código/spec**, nunca migrado a la DB.

## 4) `RBAC_ENFORCE`
```
.env.local: ausente   ·   env.ts:62 enforce = process.env.RBAC_ENFORCE === "1"  → false
```
Override fail-closed **apagado**. Con `user_roles` vacía + enforce off ⇒ fail-open puro.

## 5) Middleware
```
src/middleware.ts → return updateSession(request)   (solo SESIÓN)
```
**No** valida permiso ni rol por ruta. Solo distingue público/privado (redirect a /login).

## 6) Sidebar
```
Único gating por permiso: ítems exec (/ejecutivo, /analytics) filtrados por canViewExecutive
canViewExecutive = checkPermission("cockpit.view")  → hoy fail-open → TRUE para todos
Resto de ítems: estáticos (sin gating)
```

## 7) Rutas protegidas (guards en páginas)
```
Solo 3 superficies con guard server-side:
  /analytics            → analytics.view
  /compras/libro-iva    → cuentas_pagar.export (mostrar/ocultar export)
  /ejecutivo (bloques)  → cockpit.view (visibilidad financiera)
Todas resuelven fail-open hoy (enforced:false).
```

## 8) APIs protegidas
```
route handlers en /api = 23
con gate RBAC: /api/drive/* (requireDrivePermission "compliance.view") + 1 (cuentas_pagar.export)
≈ 19-20 de 23 route handlers SIN gate de permiso.
Los gateados también resuelven fail-open hoy.
```

---

## EVIDENCIA POR ROL (los 5 solicitados)

Ninguno existe en la DB ni tiene usuarios; el acceso efectivo runtime es **completo (fail-open)** para cualquier usuario autenticado.

| Rol | ¿Existe en DB? | Usuarios asignados (`user_roles`) | Grants efectivos | Acceso efectivo runtime |
|---|---|---|---|---|
| **SUPER_ADMIN** | ❌ no (`super_admin` ausente; existe legacy `admin`) | 0 | — | **TODO (fail-open)** |
| **GERENCIA_COMERCIAL** | ❌ no (`gerencia_comercial` ausente) | 0 | — | **TODO (fail-open)** |
| **ADMIN_FINANZAS** | ❌ no (`administracion_finanzas` ausente) | 0 | — | **TODO (fail-open)** |
| **JEFE_DEP_CENTRAL** | ❌ no (`jefe_deposito_central` ausente) | 0 | — | **TODO (fail-open)** |
| **JEFE_DEP_ANEXA** | ❌ no (`jefe_deposito_anexa` ausente) | 0 | — | **TODO (fail-open)** |

> No se puede generar evidencia de restricción por rol porque **no hay roles definitivos ni asignaciones** en la DB. La matriz aprobada vive en `RBAC-PERMISSIONS-UPDATE-REPORT.md` (spec), no en producción.

---

## Resumen de las 8 capas

| # | Capa | Estado real |
|---|---|---|
| 1 | `user_roles` | 🔴 **vacía (0)** → fail-open global |
| 2 | `permissions` | ✅ 52 seedeados (definición OK) |
| 3 | `roles` | 🟠 11 **legacy**; los 6 definitivos **no existen** |
| 4 | `RBAC_ENFORCE` | 🔴 sin setear → fail-closed apagado |
| 5 | middleware | 🟠 solo sesión, sin permiso por ruta |
| 6 | sidebar | 🟠 gating mínimo (2 ítems), hoy fail-open |
| 7 | rutas | 🟠 3 guards, todos fail-open |
| 8 | APIs | 🔴 ~1-3/23 con gate, todos fail-open |

---

## Qué falta para que sea OPERATIVO (secuencia)

1. **Migrar los 6 roles definitivos** + sus grants a la DB (spec en `RBAC-PERMISSIONS-UPDATE-REPORT.md` §7).
2. **Seedear `user_roles`** con los usuarios reales (requiere UUIDs de `auth.users`). ← sin esto, todo lo demás sigue fail-open.
3. **Setear `RBAC_ENFORCE=1`** (Netlify) **después** del seed → fail-closed.
4. Ampliar enforcement: middleware por ruta + cobertura `checkPermission` en las ~20 APIs sin gate + RLS por rol.
5. QA por rol (recién aquí se puede generar evidencia de restricción real).

> **Conclusión:** la **definición** del RBAC está lista (permisos en DB, código de chequeo, matriz en spec, flag de enforce). La **activación** no se hizo: faltan los 6 roles en DB, las asignaciones `user_roles` y el `RBAC_ENFORCE`. Pasos 1-3 son operacionales (DB/Netlify + UUIDs reales) y no se ejecutan a ciegas. Hoy el sistema opera **fail-open** (cualquier autenticado ve todo).

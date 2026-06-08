# RBAC-PERMISSIONS-UPDATE-REPORT

**Fecha:** 2026-06-08
**Alcance aprobado:** actualizar permisos de **GERENCIA_COMERCIAL** y **ADMIN_FINANZAS** + convertir **"Mi Espacio"** en permiso independiente del módulo RRHH.
**Restricciones respetadas:** no se tocó diseño, componentes, layout, estilos ni lógica de autenticación. No se alteró SUPER_ADMIN ni ADMIN_OPERATIVO. No se modificaron otros roles. No se hicieron cambios adicionales.

> **Cambio aplicado en código (worktree servido `gracious-pasteur`, `tsc --noEmit` EXIT 0):** nuevo permiso de catálogo `mi_espacio` en `src/lib/rbac/types.ts` (`PermissionModule` + `MODULE_LABELS`).
> **Resto (grants en DB + enforcement runtime):** entregado como **spec revisable** + auditoría de estado — no auto-aplicado a prod (requiere `user_roles` reales y, el enforcement, una fase autorizada que toca rutas).

---

## 0) Mapeo nombre-de-negocio → slug real (necesario para entender la matriz)

El documento usa nombres de negocio; el catálogo RBAC real tiene 22+ slugs `modulo.accion`. Mapeo:

| Nombre en el documento | Slug(s) real(es) | Nota |
|---|---|---|
| Dashboard Ejecutivo | `cockpit.view` | Panel `/ejecutivo` |
| CRM / Comercial | `comercial.view/create/edit/delete/admin` | Módulo `/comercial` |
| **Analytics Comercial / Reportes Comerciales** | **cubierto por `comercial.view`** | No existe slug propio; los reportes comerciales viven dentro del módulo Comercial |
| **Analytics Ejecutivo / Financiero** | **`analytics.view`** | Slug único "Ver reportes & finanzas" (`/analytics`) |
| Compras / Proveedores | `compras.view/create/edit/sign/export/delete` | |
| Operaciones / Servicios | `servicios.view/create/sign` (+ `operaciones.view/edit/admin` en DB) | |
| WMS | `wms.view/edit/admin` | |
| **Integraciones / Google Workspace** | **⛔ sin slug dedicado** — `/api/drive/*` hoy exige `compliance.view` | Ver RIESGO R1 |
| **Mi Espacio** | **`mi_espacio.view` (NUEVO)** | Independiente de RRHH (este cambio) |
| Finanzas / Tesorería / Bancos | `tesoreria.*` + `cuentas_pagar.*` | |
| Admin Usuarios / RBAC / Seguridad | `sistema.admin` | Exclusivo SUPER_ADMIN |

**Decisión clave (analytics):** como `analytics` es un único permiso (= Analytics **Ejecutivo/Financiero**), la separación que pide el documento se logra **sin tocar el catálogo**: GC obtiene *Analytics Comercial* vía `comercial.view` y **NO** `analytics.view`; AF obtiene `analytics.view` y **NO** `comercial.*`. Así cada rol recibe su analytics correcto y se preserva la separación Comercial≠Finanzas (H3).

---

## 1) Permisos ANTERIORES (estado previo, matriz F3 §2)

| Rol | Slugs concedidos (antes) |
|---|---|
| **GERENCIA_COMERCIAL** | `comercial.view/create/edit/delete/admin` |
| **ADMIN_FINANZAS** | `cockpit.view`, `analytics.view`, `tesoreria.*`, `cuentas_pagar.*`, `compras.*` |

## 2) Permisos NUEVOS (estado objetivo aprobado)

### GERENCIA_COMERCIAL — HABILITADO
`cockpit.view` · `comercial.view/create/edit/delete/admin` (incluye Analytics/Reportes Comerciales) · `compras.view/create/edit/sign/export/delete` · `servicios.view/create/sign` (+`operaciones.view/edit/admin`) · `wms.view/edit/admin` · **`mi_espacio.view`** · *Integraciones/Workspace → ver R1*

### GERENCIA_COMERCIAL — BLOQUEADO
`tesoreria.*` · `cuentas_pagar.*` · **`analytics.view`** (ejecutivo/financiero) · `sistema.admin` · `cctv.*` · `compliance.*` · `documental.*` · `pedidos.*` · `rrhh.*` (todo RRHH salvo Mi Espacio)

### ADMIN_FINANZAS — HABILITADO
`cockpit.view` · `tesoreria.view/create/edit/export/admin` · `cuentas_pagar.view/create/edit/delete/sign/export` · `compras.view/create/edit/sign/export/delete` · `servicios.view/create/sign` (+`operaciones.view/edit/admin`) · `wms.view/edit/admin` · `analytics.view` (ejecutivo/financiero) · **`mi_espacio.view`** · *Integraciones/Workspace → ver R1*

### ADMIN_FINANZAS — BLOQUEADO
`comercial.*` (incluye Analytics/Reportes Comerciales) · `sistema.admin` · `cctv.*` · `compliance.*` · `documental.*` · `pedidos.*` · `rrhh.*` (todo RRHH salvo Mi Espacio)

---

## 3) Cambios realizados

| # | Cambio | Tipo | Estado |
|---|---|---|---|
| C1 | **`mi_espacio` como permiso independiente** (desacoplado de RRHH) en `types.ts` (`PermissionModule` + `MODULE_LABELS`) | **Código** (worktree servido) | ✅ aplicado, `tsc` EXIT 0 |
| C2 | Alta del permiso `mi_espacio.view` en catálogo DB (`permissions`) | Migración (spec §7) | ⏳ aplicar con autorización |
| C3 | **GERENCIA_COMERCIAL** gana: `cockpit.view`, `compras.*`, `servicios.*`+`operaciones.*`, `wms.*`, `mi_espacio.view` (mantiene `comercial.*`) | Grants `role_permissions` (spec §7) | ⏳ |
| C4 | **ADMIN_FINANZAS** gana: `servicios.*`+`operaciones.*`, `wms.*`, `mi_espacio.view` (mantiene cockpit/analytics/tesoreria/cuentas_pagar/compras) | Grants `role_permissions` (spec §7) | ⏳ |
| C5 | Garantizar bloqueos (revocar lo no listado en §2 para esos 2 roles) | Grants (spec §7) | ⏳ |

> SUPER_ADMIN y ADMIN_OPERATIVO: **sin cambios** (SUPER_ADMIN ya posee todos los permisos, incluido `mi_espacio.view` por su grant "todos"; eso es comportamiento esperado, no una alteración de intención).

---

## 4) Impacto

- **Funcional:** GC y AF pasan a ser roles operativos amplios (suman Compras/Operaciones/WMS y Dashboard Ejecutivo en el caso de GC). Cada uno conserva su dominio exclusivo (GC→Comercial, AF→Finanzas) **sin cruzarse** (H3 preservado).
- **Mi Espacio:** ahora es un permiso de primera clase. Un usuario puede tener `mi_espacio.view` **sin** `rrhh.*` → ve únicamente su propio legajo/datos/solicitudes/vacaciones/documentación, nunca información de terceros.
- **RRHH para GC/AF:** queda **bloqueado por completo** (no se concede ningún `rrhh.*`); el único acceso "de RRHH" es el autoservicio vía `mi_espacio.view`.
- **Compatibilidad de tipos:** sin romper nada — `tsc --noEmit` EXIT 0.

---

## 5) Riesgos

| ID | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| **R1** | **Integraciones/Google Workspace sin slug propio.** `/api/drive/*` exige `compliance.view`. Conceder eso a GC/AF **filtraría ANMAT** (Compliance), que el documento NO autoriza. | 🟠 Media | **No se concede compliance.view.** Recomendación: crear `integraciones.view` (o `drive.view`) y re-apuntar las rutas Drive en la **fase de enforcement** (toca auth → fuera del alcance "no modificar auth" de este documento). Hasta entonces, "Integraciones" queda **pendiente** para estos roles. |
| **R2** | **`mi_espacio.view` definido pero no enforced en runtime.** `/workspace` no tiene guard y el Sidebar no filtra por permiso. | 🟠 Media | El permiso ya existe a nivel RBAC real (catálogo/tipo/grant). El **wiring** (guard de ruta + ítem de menú condicional + scoping "solo mis datos") es la fase de enforcement (requiere `user_roles` seedeado para QA y toca rutas). Flagueado, no ejecutado aquí. |
| **R3** | **Grants amplios (WMS/Operaciones) a perfiles de oficina.** | 🟡 Baja | Es lo aprobado explícitamente en el documento. Confirmar con Presidencia si `wms.admin`/`operaciones.admin` debe ser `view` en lugar de full. |
| **R4** | **Analytics Comercial = `comercial.view` (asunción de mapeo).** | 🟡 Baja | Si existe una vista "Reportes Comerciales" gateada por otro slug, revisar. Hoy no existe. |
| **R5** | **RBAC dormido (fail-open).** Mientras `user_roles` esté vacío en prod, los grants no surten efecto (todo autenticado pasa) salvo `RBAC_ENFORCE=1` post-seed. | 🔴 Alta (preexistente, H1) | Seedeo de `user_roles` + `RBAC_ENFORCE=1` (operacional, fuera de este cambio). |

---

## 6) Resultado de validaciones obligatorias

| # | Validación | Resultado |
|---|---|---|
| 1 | Matriz RBAC actualizada | ✅ §8 |
| 2 | Tabla completa de permisos por rol | ✅ §8 |
| 3 | Verificación de **permisos efectivos** | ⏳ **No verificable en runtime aún**: requiere aplicar grants §7 + `user_roles` seedeado. Hoy RBAC dormido (fail-open) salvo `RBAC_ENFORCE=1`. Estáticamente: matriz §8 correcta. |
| 4 | Verificación de **navegación** | ⚠️ **Gap**: `Sidebar.tsx` es estático (no filtra por permiso; sólo oculta `/settings/roles`). Menús por rol = fase de enforcement. |
| 5 | Verificación de **protección backend** | ⚠️ **Cobertura mínima**: `checkPermission` sólo en `/api/drive/*` (`compliance.view`), `cuentas_pagar.export` (×2) y `analytics.view` (×1). Mayoría de rutas sin gate. Gap preexistente. |
| 6 | Verificación de **middleware** | ⚠️ `middleware.ts` valida **sesión**, no permiso por ruta. Gap. |
| 7 | Verificación de **menús dinámicos** | ⚠️ No implementado (ver #4). |
| 8 | Verificación de **rutas protegidas** | ⚠️ Sólo sesión (público/privado); no por permiso. |
| 9 | Verificación de **APIs protegidas** | ⚠️ Parcial (ver #5). |
| 10 | Verificación de **componentes ocultos por rol** | ⚠️ No implementado. |

> **Lectura honesta:** las validaciones 1–2 están **cumplidas** (definición de permisos/matriz). Las 3–10 evidencian que **la capa de enforcement (sidebar/middleware/cobertura de checkPermission/RLS) aún no existe** — es la fase autorizada pendiente de F3 y requiere `user_roles` seedeado para QA. Este documento entrega la **matriz y los grants**; no construye el enforcement (eso sería "cambio adicional" + tocaría auth, expresamente fuera de alcance).

---

## 7) Migración (SPEC — aplicar con autorización; NO en `migrations/`)

```sql
-- RBAC-PERMISSIONS-UPDATE — acotado a GERENCIA_COMERCIAL y ADMIN_FINANZAS.
-- Revisar antes de aplicar al Supabase productivo (arsksytgdnzukbmfgkju).

-- (C2) Nuevo permiso independiente "Mi Espacio"
insert into public.permissions (slug, module, action, label, description) values
  ('mi_espacio.view', 'mi_espacio', 'view',
   'Ver Mi Espacio (autoservicio)',
   'Acceso al propio legajo/datos/solicitudes/vacaciones/documentación. Independiente de RRHH.')
on conflict (slug) do nothing;

-- (C6 · ADDENDUM) Subdivisión del Cockpit en 4 superficies (reemplaza cockpit.view monolítico)
insert into public.permissions (slug, module, action, label, description) values
  ('cockpit_operativo.view',     'cockpit_operativo',     'view', 'Ver Cockpit Operativo',     'KPIs operativos, tracking, operaciones, WMS, estado de depósitos/servicios, actividad general.'),
  ('cockpit_comercial.view',     'cockpit_comercial',     'view', 'Ver Cockpit Comercial',     'KPIs y métricas comerciales, paneles comerciales. SIN datos financieros ejecutivos.'),
  ('cockpit_administrativo.view','cockpit_administrativo','view', 'Ver Cockpit Administrativo','KPIs financieros/administrativos/compras/proveedores/tesorería de gestión.'),
  ('cockpit_ejecutivo.view',     'cockpit_ejecutivo',     'view', 'Ver Cockpit Ejecutivo',     'RESERVADO Presidencia: EBITDA, cash flow, rentabilidad, márgenes, indicadores estratégicos, Analytics Ejecutivo.')
on conflict (slug) do nothing;

-- (C3/C4/C5) Reescritura idempotente de grants SÓLO para los 2 roles del cambio.
delete from public.role_permissions
 where role_id in (select id from public.roles where slug in ('gerencia_comercial','administracion_finanzas'));

-- GERENCIA_COMERCIAL  (Cockpit: Operativo + Comercial; NUNCA Ejecutivo/Administrativo)
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug='gerencia_comercial' and (
        p.module in ('comercial','compras','servicios','operaciones','wms',
                     'cockpit_operativo','cockpit_comercial')
     or p.slug in ('mi_espacio.view'));

-- ADMIN_FINANZAS  (Cockpit: Operativo + Administrativo; NUNCA Ejecutivo/Comercial)
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug='administracion_finanzas' and (
        p.module in ('tesoreria','cuentas_pagar','compras','servicios','operaciones','wms',
                     'cockpit_operativo','cockpit_administrativo')
     or p.slug in ('analytics.view','mi_espacio.view'));

-- cockpit_ejecutivo.view → EXCLUSIVO SUPER_ADMIN (lo recibe por su grant "todos los permisos";
--   NO se concede a GERENCIA_COMERCIAL ni ADMIN_FINANZAS).

-- NOTA R1: "Integraciones/Workspace" NO se concede (hoy = compliance.view → filtraría ANMAT).
--          Crear 'integraciones.view' + re-apuntar /api/drive/* en la fase de enforcement.
-- NOTA: SUPER_ADMIN y ADMIN_OPERATIVO no se tocan; reciben mi_espacio.view por sus reglas existentes.
```

---

## 8) Matriz final consolidada

`F`=full (todas las acciones del módulo) · `V`=solo view · `—`=bloqueado · `‡`=pendiente (R1)

| Módulo (slug) | GERENCIA_COMERCIAL | ADMIN_FINANZAS |
|---|:--:|:--:|
| `cockpit_operativo` | V | V |
| `cockpit_comercial` | V | — |
| `cockpit_administrativo` | — | V |
| `cockpit_ejecutivo` (Presidencia) | — | — |
| `comercial` (CRM + Analytics Comercial) | **F** | — |
| `analytics` (Ejecutivo/Financiero) | — | **V** |
| `tesoreria` | — | **F** |
| `cuentas_pagar` | — | **F** |
| `compras` | **F** | **F** |
| `servicios` + `operaciones` | **F** | **F** |
| `wms` | **F** | **F** |
| `mi_espacio` (autoservicio) | **V (nuevo)** | **V (nuevo)** |
| Integraciones/Workspace (Drive) | ‡ | ‡ |
| `pedidos` | — | — |
| `compliance` / `cctv` / `documental` | — | — |
| `rrhh` (Empleados/Legajos/Novedades/Gestión/Reportes) | — | — |
| `sistema` (RBAC/Seguridad) | — | — |

**Separación de poderes (H3):** GERENCIA_COMERCIAL ⟂ Finanzas/Analytics-financiero · ADMIN_FINANZAS ⟂ Comercial. ✅
**RRHH:** ambos roles sólo `mi_espacio.view` (autoservicio), cero acceso a datos de terceros. ✅

---

## Pendientes para cierre efectivo (operacional / fase enforcement)
1. Aplicar migración §7 al Supabase productivo.
2. Seedear `user_roles` (UUIDs reales) y activar `RBAC_ENFORCE=1`.
3. **R1:** crear `integraciones.view` y desacoplar `/api/drive/*` de `compliance.view`.
4. **R2:** wiring de enforcement: guard en `/workspace` (`mi_espacio.view`), Sidebar dinámico por permiso, scoping "solo mis datos", + cobertura `checkPermission` en rutas faltantes y RLS.
5. QA por rol (validaciones 3–10 en runtime).

**Aplicado en código:** `src/lib/rbac/types.ts` (permiso `mi_espacio`). Sin commit/push. Sin cambios de diseño/auth/otros roles.

---

# ADDENDUM — SUBDIVISIÓN DEL COCKPIT (2026-06-08)

## A1) Estado real auditado (evidencia)
- **Existe UN solo cockpit:** `/ejecutivo` ("Cockpit Ejecutivo 2.0 / Presidential Command Center") + `/dashboard`. **NO existen** superficies separadas Operativo/Comercial/Administrativo.
- `/ejecutivo` **mezcla operativo y financiero**: su "BLOQUE 2 — KPIs Ejecutivos" incluye **Facturación del mes** (`command-center.ts → billingThisMonth()`), junto a flota/cámaras (operativo).
- ⇒ El slug `cockpit.view` mapea hoy a esa superficie financiera ejecutiva → **es exactamente lo que el addendum manda bloquear** a GC/AF.

## A2) Corrección respecto del cambio anterior
El grant `cockpit.view` que GC y AF tenían **se reemplaza** por los sub-permisos. **Interino de seguridad:** hasta que se construyan las superficies Operativo/Comercial/Administrativo, GC/AF **no deben acceder a `/ejecutivo`** (es la superficie Ejecutiva/financiera). No hay regresión de exposición: el modelo nuevo es más restrictivo.

## A3) Ecosistema Cockpit — permisos y frontera de seguridad

| Sub-cockpit (slug) | Contenido permitido | Contenido prohibido | super_admin | GERENCIA_COMERCIAL | ADMIN_FINANZAS |
|---|---|---|:--:|:--:|:--:|
| `cockpit_operativo` | KPIs operativos, tracking, operaciones, WMS, estado depósitos/servicios, actividad general, widgets productividad | financiero ejecutivo | ✅ | ✅ | ✅ |
| `cockpit_comercial` | KPIs/métricas comerciales, paneles comerciales | finanzas, EBITDA, tesorería | ✅ | ✅ | ❌ |
| `cockpit_administrativo` | KPIs financieros de gestión, compras, proveedores, tesorería operativa, administrativos | indicadores estratégicos de Dirección | ✅ | ❌ | ✅ |
| `cockpit_ejecutivo` | **RESERVADO Presidencia:** EBITDA, cash flow, rentabilidad, márgenes, resultado económico, indicadores de Dirección, Analytics Ejecutivo, métricas corporativas reservadas | — | ✅ **exclusivo** | ❌ | ❌ |

**Frontera:** `cockpit_ejecutivo` y `analytics.view` (Analytics Ejecutivo) son **exclusivos de SUPER_ADMIN**. GC y AF acceden sólo a los tres primeros **según su dominio** (GC→Operativo+Comercial · AF→Operativo+Administrativo).

## A4) Validación obligatoria — restricción en UI / navegación / APIs / middleware / backend

| Capa | Estado actual | Acción requerida (fase build+enforcement) |
|---|---|---|
| **Permisos backend (definición)** | ✅ 4 slugs creados en tipo + spec de migración | aplicar migración §7 |
| **UI** | ⚠️ una sola página `/ejecutivo` mezcla todo; no hay 3 superficies | construir/segmentar Cockpit Operativo/Comercial/Administrativo y **separar el financiero ejecutivo** en su propia superficie gated |
| **Navegación / menús** | ⚠️ Sidebar estático, no filtra por permiso | menú dinámico que muestre cada sub-cockpit según slug |
| **Rutas** | ⚠️ `/ejecutivo` sin guard por permiso | guard por ruta: `/ejecutivo`→`cockpit_ejecutivo.view`; nuevas rutas→su slug |
| **Middleware** | ⚠️ sólo sesión | mapa ruta→permiso |
| **APIs** | ⚠️ `command-center.ts` no segrega KPIs por permiso (sirve facturación a cualquiera con acceso) | la capa de datos debe **filtrar KPIs financieros** salvo `cockpit_ejecutivo.view`/`cockpit_administrativo.view`; no depender de ocultamiento visual |

> **Honesto:** la validación "no depender únicamente de ocultamiento visual" **HOY no se cumple** porque las superficies no existen y la API no segrega KPIs. Este addendum entrega la **definición RBAC + matriz + migración**; el **build de las 3 superficies + segregación de KPIs + enforcement** es una fase de diseño/desarrollo que requiere decisión de UX (¿3 rutas nuevas o una `/cockpit` seccionada?) y `user_roles` seedeado para QA. No se construye a ciegas (chocaría con "no modificar diseño" sin tu visto y con la necesidad de evidencia).

## A5) Aplicado en código (este addendum)
`src/lib/rbac/types.ts`: módulos `cockpit_operativo`, `cockpit_comercial`, `cockpit_administrativo`, `cockpit_ejecutivo` (+ labels). `tsc --noEmit` EXIT 0. Sin commit/push. Sin cambios de diseño/UI/auth.

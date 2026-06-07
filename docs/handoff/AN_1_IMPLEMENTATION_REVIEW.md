# AN-1 · REVISIÓN DE IMPLEMENTACIÓN — DASHBOARD EJECUTIVO

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `AN_1_IMPLEMENTATION_REVIEW.md`
**Fecha:** 2026-06-07
**Rama:** `feature/an1-executive-dashboard` (sobre `main a06f637`)
**Naturaleza:** implementación + auditoría. **No se desplegó. No se modificó producción.** Fuente de verdad = `arsksytgdnzukbmfgkju`.

> Dashboard Ejecutivo en `/analytics` que **agrega KPIs Tier A** (confiables hoy) leyendo **solo lectura** capas ya funcionales: Tesorería (ERP-A), Compras (ERP-B), Capacity Engine (WMS), Órdenes y Clientify (comercial — fuente oficial por decisión presidencial). **No** implementa Tracking, IVA avanzado, Forecast, Rentabilidad ni Incidentes.

---

## 1. Pantalla

- **Ruta:** `/analytics` (`src/app/(app)/analytics/page.tsx`, `dynamic = "force-dynamic"`), grupo Sidebar "Cockpit" → "Analytics Ejecutivo".
- **Arquitectura:** Server Component carga `getExecutiveSnapshot()` y renderiza `ExecutiveDashboard` (presentacional). Guard `analytics.view`; si falta → tarjeta "Acceso restringido". Error de fuentes → `ModuleUnavailable`.
- **Layout:** Header → 6 KPI titulares → Financiero + Comercial → WMS + Operaciones → Compras → leyenda de Tiers. Cada bloque enlaza a su pantalla de detalle (`/tesoreria`, `/comercial/pipeline`, `/comercial/dashboard-vacancia`, `/orders`, `/compras/libro-iva`).
- **Degradación por dominio:** `Promise.allSettled` — un dominio caído muestra "sin datos / N/D" sin romper el resto.

---

## 2. KPIs

| Dominio | KPIs obligatorios | Implementado |
|---|---|---|
| **Comercial** | Leads · Oportunidades · Pipeline (Clientify) | ✅ leads (contactos) · oportunidades (deals) · pipeline total · ganado YTD |
| **Financiero** | Saldos · Cobros · Pagos · Flujo | ✅ caja por banco · cobros acum. · pagos acum. · AR/AP · flujo proyectado acum. |
| **Compras** | Facturas proveedor · IVA compras · Percepciones | ✅ count + total · IVA crédito fiscal · percepciones (badge "se poblará con OCR" si detalle vacío) |
| **WMS** | m² ocupados · m² libres · Vacancia | ✅ ocupados · libres (físico) · comercializables · vacancia física + comercial |
| **Operaciones** | Órdenes abiertas · cerradas | ✅ abiertas (BORRADOR/PENDIENTE/EN_CURSO/OBSERVADA) · cerradas (FIRMADA/FACTURADA) |

**Regla de honestidad:** Tier A muestra valor real; dominios caídos → "N/D"; KPIs cuya fuente existe pero está vacía (IVA compras) → badge "se poblará con OCR". Nunca un cero engañoso.

---

## 3. Fuentes

Todas **read-only**, capas ya funcionales (cero escritura, cero recálculo fiscal en el agregador):

| Bloque | Fuente | Función |
|---|---|---|
| Financiero | vistas ERP-A | `getBankBalances`, `getCustomer/SupplierCurrentAccount`, `listCustomer/SupplierOpenItems`, `getCashflowProjection` |
| Compras | ERP-B | `listSupplierInvoices`, `getLibroIvaCompras` |
| WMS | Capacity Engine | `getCorporateVacancySummary({})` (snapshot vacío → vacancia física; **no consume `crm_*`**) |
| Operaciones | órdenes | `listOrders` (counts por estado) |
| Comercial | **Clientify** (fuente oficial) | `getPipelineSnapshot`, `getContactsPage`, `clientifyConfigured` |

> **Decisión presidencial cumplida:** comercial = **Clientify**; `crm_*` **no se consume**. WMS usa snapshot vacío (no toca `crm_*`).

**Verificación contra prod (read-only) — el dashboard renderiza datos reales:**

| KPI | Valor real (prod) |
|---|---|
| Caja disponible | **$99.900,00** |
| Por cobrar (AR) | **$4.411.606,00** |
| Por pagar (AP) | **$1.341.263,57** |
| Cobros acumulados | **$100.000,00** |
| Pagos acumulados | **$100,00** |
| Facturas proveedor | **4** · total **$1.341.363,57** |
| IVA compras / percepciones | **$0** (libro vacío → badge "se poblará con OCR") |
| Órdenes abiertas / cerradas | **0 / 15** |
| WMS vacancia | Capacity Engine (m² relevados reales) |

---

## 4. Permisos

- **Guard de pantalla:** `checkPermission(req, "analytics.view")`. Permiso **ya existente** en prod.
- **Matriz real (`role_permissions`):** `analytics.view` → **Administración** + **Director de Operaciones** (= Dirección y Administración). admin (superusuario) incluido. Otros roles → "Acceso restringido".
- **Defensa en profundidad:** cada fuente es una vista `security_invoker` / capa con RLS → un usuario sin acceso a un dominio ve ese bloque vacío aunque la página cargue. **Sin permisos nuevos ni cambios de RBAC.**

---

## 5. Auditoría adversarial

| ADV | Verificación | Resultado |
|---|---|---|
| ADV-1 | Scope de archivos | ✅ 3 nuevos (`executive-data.ts`, `page.tsx`, `ExecutiveDashboard.tsx`) + Sidebar |
| ADV-2 | ¿Agregador solo lee? | ✅ 0 insert/update/delete/rpc — consume capas read-only |
| ADV-3 | ¿Importa Tracking/Forecast/Rentabilidad/Incidentes? | ✅ **no** (los 6 imports son tesorería/erp/libro-iva/wms-capacity/orders/clientify; el "match" de `tracking-wide` es clase CSS) |
| ADV-4 | ¿Consume `crm_*`? | ✅ **no** — comercial = Clientify; WMS snapshot vacío |
| ADV-5 | Degradación por dominio | ✅ `Promise.allSettled` + objetos `_FAIL` con `ok:false` |
| ADV-6 | ¿Modifica capas fuente / migraciones / ERP-A / ERP-B? | ✅ no (solo las importa) |
| ADV-7 | Honestidad de datos | ✅ "N/D" por dominio caído + badge "se poblará con OCR" (IVA) + "Clientify no configurado" |
| ADV-8 | Datos reales (no mock) | ✅ verificado contra prod (caja $99.9k, AR $4.4M, AP $1.34M, 15 órdenes cerradas) |
| ADV-9 | typecheck / lint / build | ✅ EXIT 0 / 0 / 0; ruta `/analytics` compila (230 B) |

---

## 6. Riesgos

### 🔴 P0
- **Ninguno.** Solo lectura de capas existentes + UI aislada; no toca ERP-A/ERP-B/migraciones; permiso ya en prod; degradación por dominio; build verde; datos reales verificados.

### 🟠 P1
- **R1 — Comercial depende de Clientify (externo) + `CLIENTIFY_API_KEY`.** Si la key no está en el entorno de deploy, el bloque comercial muestra "no configurado" (degradación limpia, no rompe). Mitigación: confirmar la env var en Netlify antes/después del deploy.
- **R2 — QA visual interactivo pendiente.** El render se valida por build + verificación de datos; la confirmación visual con sesión real va en el gate de DEPLOY.

### 🟡 P2
- **R3 — Volumen real bajo en varios KPIs.** IVA compras = $0 (sin OCR), órdenes abiertas = 0, pagos $100. Correcto pero "chico"; los badges lo explican.
- **R4 — `getLibroIvaCompras` sin filtros lee hasta 5.000 facturas** para el KPI de IVA. Hoy trivial (4 facturas); a futuro, cap ya presente.

### ⚪ P3
- **R5 — Performance de agregación** (varias vistas/motores por request). Mitigación: `Promise.all`/`allSettled` + `force-dynamic`; aceptable al volumen actual.
- **R6 — `analytics.view` solo 2 roles.** Si Dirección quiere más visibilidad, ampliar RBAC (fuera de alcance AN-1).

---

## 7. Veredicto

> # 🟢 READY FOR ANALYTICS DEPLOY
>
> El Dashboard Ejecutivo AN-1 está **implementado y auditado** en `feature/an1-executive-dashboard`. `/analytics` agrega **KPIs Tier A reales** de los 5 dominios autorizados (Financiero, Compras, WMS, Operaciones, Comercial) leyendo **solo lectura** capas ya funcionales, con **degradación por dominio** y **honestidad de Tiers**. Comercial usa **Clientify** (fuente oficial); **no se consume `crm_*`**. **No** se implementó Tracking, IVA avanzado, Forecast, Rentabilidad ni Incidentes.
>
> Validación: **typecheck / lint / build = PASS**; auditoría adversarial **9/9**; **datos reales verificados contra prod** (caja $99.9k · AR $4.41M · AP $1.34M · 4 facturas proveedor $1.34M · 15 órdenes cerradas · WMS Capacity Engine). Permiso `analytics.view` (Administración + Director de Operaciones) ya en prod. Alcance **aislado**: 3 archivos + Sidebar; **no toca** ERP-A, ERP-B, migraciones ni RBAC. Riesgos **sin P0**.
>
> **No se desplegó. No se modificó producción.** Listo para el gate de DEPLOY. **No se inició AN-2.**

---

## Anexo — Evidencia

| Verificación | Resultado |
|---|---|
| Rama | `feature/an1-executive-dashboard` (sobre `main a06f637`) |
| Archivos | `src/lib/analytics/executive-data.ts` · `src/app/(app)/analytics/page.tsx` · `ExecutiveDashboard.tsx` · Sidebar (M) |
| typecheck / lint / build | EXIT 0 / 0 / 0 — `/analytics` compila |
| Imports del agregador | tesorería · erp/data · libro-iva · wms/corporate-capacity · data/orders · clientify (6, Tier A) |
| Escrituras | 0 (solo `.select` vía capas existentes) |
| Comercial | Clientify (no `crm_*`) |
| Permiso | `analytics.view` → Administración + Director de Operaciones |
| Datos reales (prod) | caja $99.900 · AR $4.411.606 · AP $1.341.263,57 · facturas 4/$1.341.363,57 · órdenes 0 abiertas/15 cerradas |
| Fuera de alcance respetado | sin Tracking / IVA avanzado / Forecast / Rentabilidad / Incidentes |
| Veredicto | **READY FOR ANALYTICS DEPLOY** |

---

*Fin — Revisión de Implementación AN-1 (Dashboard Ejecutivo). Veredicto: READY FOR ANALYTICS DEPLOY. Implementado y auditado en rama; no se desplegó, no se modificó producción, no se tocó ERP-A ni ERP-B. No se inició AN-2.*

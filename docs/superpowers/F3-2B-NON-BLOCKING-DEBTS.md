# F3 · F3.2B — DEUDAS NO BLOQUEANTES (post-deploy)

> Registro formal de las deudas detectadas durante la validación del deploy a producción de Nexus Link F3 (commit `88add4b`, 2026-07-01).
> **Ninguna de estas deudas bloquea el cierre de F3.** Su resolución requiere una ventana/autorización separada.
> Referencia: `F3-2B-PROD-DEPLOY-REPORT.md`.

---

## A. Hydration mismatch del shell (React #425 / #422)

| Campo | Detalle |
|---|---|
| **Clasificación** | Deuda no bloqueante · **NO crítico** |
| **Síntoma** | 2 errores de consola por carga de página: React **#425** ("Text content does not match server-rendered HTML") + React **#422** ("This Suspense boundary received an update before it finished hydrating"). |
| **Alcance** | Aparecen en **todas** las rutas con el **mismo stack** (`sq`/`co` … `oZ` → `MessagePort.T`) → es a **nivel del shell/layout compartido**, NO route-specific y **NO** propio de Nexus Link. |
| **Causa probable** | Render de **fecha/hora localizada** en el top-bar (p.ej. "Martes, 30 De Junio") y/o timestamps relativos: el HTML del servidor difiere del cliente al hidratar. |
| **Impacto** | React se **recupera** con client-render. **Sin crash, sin pantalla en blanco, sin 5xx.** Las páginas renderizan al 100% (verificado con screenshots de `/dashboard`, `/connect`, `/connect/canales`). |
| **Estado** | **Recoverable** · casi con certeza **pre-existente** (no introducido por el feature F3, que es `/connect`). |
| **Evidencia** | `~/CODE/dashboard-prod-88add4b.png`, `~/CODE/connect-canales-prod-88add4b.png`; consola: `React #425` + `React #422`. |
| **Resolución futura (fuera de ventana)** | Envolver el/los nodos con fecha en `suppressHydrationWarning`, o mover el render de tiempo a **client-only** (`useEffect`/`dynamic({ ssr:false })`), o formatear fechas de forma determinista SSR↔CSR (misma zona horaria/locale fijo). Requiere **cambio de código fuente** → autorización explícita. |
| **Prioridad sugerida** | Baja (cosmético). Recomendado incluirlo en el primer lote de mantenimiento post-F3. |

---

## B. Grant RBAC `seguridad → knowledge.edit`

| Campo | Detalle |
|---|---|
| **Clasificación** | Deuda no bloqueante · observación de configuración |
| **Hallazgo** | El rol `seguridad` (Seguridad / CCTV) tiene **exactamente un** permiso de acción `edit`: `knowledge.edit` ("Editar conocimiento"). |
| **Contraste** | El rol `rrhh_admin` también tiene un único `edit` (`rrhh.edit` = "Editar / anular RRHH"), que **sí es esperado** (administra RRHH). El caso de `seguridad → knowledge.edit` es el único `edit` **fuera de dominio evidente**. |
| **Origen** | **NO** fue introducido por Nexus Link ni por este deploy. El RBAC vive en la base de datos y **no fue modificado** durante la ventana de deploy (el deploy fue solo-UI). Es estado pre-existente del modelo RBAC final de F3 (`F3-2A-RBAC-FINAL-MODEL.md`). |
| **Riesgo** | Bajo — es un grant **acotado a una sola permission**; no habilita edición amplia ni operativa/financiera. Sin exposición a clientes (blast-radius interno). |
| **Estado** | Abierto — **requiere confirmación de Dirección**: ¿es intencional que Seguridad pueda editar Knowledge, o debe revocarse? |
| **Acción requerida** | **NINGUNA en esta ventana** (prohibido modificar permisos). Decisión y eventual cambio → autorización explícita posterior. **No bloquear F3 por este punto.** |
| **Prioridad sugerida** | Media-baja. Resolver en la revisión RBAC posterior al piloto. |

---

## Resumen

| Deuda | Bloquea F3 | Requiere código | Requiere decisión Dirección | Prioridad |
|---|---|---|---|---|
| A · Hydration shell #425/#422 | **No** | Sí (fix futuro) | No | Baja |
| B · RBAC `seguridad→knowledge.edit` | **No** | No (solo si se decide revocar) | **Sí** | Media-baja |

Ambas quedan registradas para seguimiento. **Ninguna es condición para declarar F3 cerrada**, siempre que Dirección tome nota de (B).

---

## C. H-1 — RBAC dormido / anti-lockout (deuda ACEPTADA temporalmente)

| Campo | Detalle |
|---|---|
| **Clasificación** | Deuda técnica **preexistente y global del ERP** · **ACEPTADA temporalmente por Dirección (A+D)** para el piloto interno |
| **Hallazgo** | `RBAC_ENFORCE` ≠ "1" → usuarios **sin rol** reciben acceso permisivo (fail-open) por diseño anti-lockout. No es defecto de Nexus Link. |
| **Alcance** | Interno; 3 cuentas sin rol (todas de Martín); 0 clientes. |
| **Estado** | Aceptada como deuda temporal. **Debe resolverse (activar `RBAC_ENFORCE=1` con seed previo de `martin@`) ANTES de** habilitar clientes/proveedores/externos o exposición mayor. Detalle: `F3-H1-RBAC-DECISION-PACK.md`. |
| **Acción esta ventana** | Ninguna (no se activó enforcement, no se seedearon roles). |

---

## Nota — F-SEARCH (RESUELTO, no es deuda)

El bug de búsqueda `connect_search` (`42702` + `0A000`) detectado en el smoke **NO se aceptó como deuda**: Dirección exigió corregirlo antes del cierre. **Resuelto** con migs `0156`+`0157` aplicadas a prod (búsqueda operativa RPC+UI). Ver `F3-FSEARCH-HOTFIX-EXECUTION-LOG.md`.

---

## Resumen de deudas vigentes al cierre de F3

| Deuda | Bloquea F3 | Estado |
|---|---|---|
| A · Hydration shell #425/#422 | No | Abierta (cosmético, fix futuro) |
| B · RBAC `seguridad→knowledge.edit` | No | Abierta (decisión Dirección) |
| C · H-1 RBAC dormido | No (aceptada A+D) | Aceptada temporal; resolver antes de exposición externa |
| ~~F-SEARCH~~ | — | **RESUELTO** (0156+0157) |

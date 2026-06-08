# TOPS NEXUS — RRHH · R6 RENDER AUDIT (visual, producción · solo lectura)

> **Tipo:** auditoría visual de render del módulo RRHH (R6), ejecutada en vivo vía Claude Chrome
> Extension sobre el navegador local, contra el **runtime oficial = producción** (`arsksytgdnzukbmfgkju`).
> **Autorizado:** navegación, lectura, screenshots. **NO autorizado / NO ejecutado:** crear/aprobar/
> anular solicitudes, generar novedades, ni cualquier escritura append-only. (No se disparó ninguna.)
> **Entorno:** dev server levantado desde el worktree **`gracious-pasteur-6efdde`** (commit `043ae54`)
> en `localhost:3030`, `.env.local` → producción. Usuario logueado: `martin.battaglia` (rol admin/dir).
> **Fecha:** 2026-06-07.

---

## Resultado por pantalla

| # | Pantalla | URL | Render | Evidencia |
|---|----------|-----|--------|-----------|
| 1 | **Sidebar RRHH** | (global) | ✅ **PASS** | grupo "Recursos Humanos" con 6 ítems: Empleados, Solicitudes, Novedades, Documentación, **Organigrama→`/organigrama`** (D2, sin duplicar), Mi espacio (links `ref_23–28`) |
| 2 | **Dashboard RRHH** | `/rrhh` | ✅ **PASS** | header + 6 KPIs (Dotación/Activos/En licencia/Solicitudes pend./Vacaciones pend./Licencias activas) + 6 accesos rápidos. Screenshot capturado. |
| 3 | **Empleados** | `/rrhh/empleados` | ✅ **PASS** | "RRHH · Legajos · Empleados" + empty state "No hay empleados visibles para tu rol." |
| 4 | **Solicitudes (lectura)** | `/rrhh/solicitudes` | ✅ **PASS** | "RRHH · Workflow · Solicitudes" + empty state |
| 5 | **Novedades (lectura)** | `/rrhh/novedades` | ✅ **PASS** | "RRHH · Período · Novedades · Solo lectura" + empty state |
| 6 | **Documentación (lectura)** | `/rrhh/documentos` | ✅ **PASS** | "RRHH · Documentación · Acceso por enlace firmado y auditado. La salud está restringida…" + empty state |
| 7 | **Organigrama** | `/organigrama` | ✅ **PASS** | organigrama institucional Verotin S.A. completo (jerarquía + badges RBAC); integrado por enlace (D2) |
| 8 | **Mi Espacio** | `/rrhh/mi-espacio` | ✅ **PASS** | "Portal del empleado" + lógica de propiedad: usuario sin legajo → "Tu usuario no está vinculado a un legajo…" (correcto) |

**Veredicto de render:**

> ## R6 RENDER — **PASS** (8/8 pantallas renderizan; rutas resuelven; Sidebar integrado; sin 404, sin error)

Antes del fix de entorno, `/rrhh` daba 404 (el server activo corría otro worktree sin R6); con el
server sirviendo la rama R6, **todas** las pantallas cargan correctamente dentro del shell de Nexus.

---

## Observaciones (importantes, sin suavizar)
1. **Datos vacíos = dato real, no defecto.** Las tablas RRHH en producción (`0056–0060` aplicadas)
   **no tienen legajo cargado aún** → todos los listados muestran su *empty state* y los KPIs = 0.
   El render es correcto; la **validación con datos** queda pendiente de una carga inicial de legajo.
2. **Alcance del render-audit:** valida **render/ruteo/estructura/empty-states** como el usuario actual
   (admin/dirección). **NO** cubre (porque excede un render-audit de solo-lectura sin datos):
   - **Matriz por rol** (empleado/supervisor/manager/viewer/operaciones): requiere logins por rol.
     En particular, "Sidebar **oculto** para operaciones" **NO VALIDADO** (sesión única admin).
   - **Detalle de empleado** con gating de bancario/salud: **NO VALIDADO** (sin legajos).
   - **Workflow** (crear/aprobar/anular) y **descarga de documento (signed URL)**: **NO EJECUTADO**
     (sin datos + escritura no autorizada contra prod).
3. **Organigrama:** hoy es el documento institucional estático (D2 = una sola fuente, sin duplicar).
   La versión **derivada de `rrhh_empleados.supervisor_id`** sería una mejora futura, no parte de R6.

---

## Estado del entorno (operativo)
- Se **detuvo** el dev server que corría desde `magical-hopper-56b3dc` (no tenía R6) y se **levantó**
  el server desde el worktree R6 (`gracious-pasteur-6efdde`) en `:3030`, env → producción (uso
  **solo lectura**, autorizado). El dev server R6 queda **corriendo** para continuar la validación.
- Se copió `.env.local` (prod) al worktree R6 para permitir el render con datos reales.

> **Pendiente de limpieza** (cuando se decida): detener el dev server R6 y remover el `.env.local`
> copiado del worktree; opcionalmente, re-levantar el server original.

---

## Conclusión
- **R6 RENDER PASS** — el frontend de RRHH renderiza correctamente de punta a punta en producción.
- **R6 sigue `IMPLEMENTED`**: el cierre pleno de R6 requiere además la validación **con datos** y la
  **matriz por rol** (E2E), hoy no ejecutables (prod sin legajo + sesión única + escritura prohibida).
- **No se desplegó ni promovió nada** (RELEASE REVIEW es gate separado). **R7 no abierto.**

*Render-audit visual en producción (solo lectura). Sin escrituras, sin deploy, sin tocar R1–R5, sin abrir R7.*

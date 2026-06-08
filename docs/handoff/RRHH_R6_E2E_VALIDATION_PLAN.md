# TOPS NEXUS — RRHH · R6 E2E VALIDATION PLAN

> **Tipo:** plan de validación E2E del frontend RRHH (R6). **No** ejecuta, **no** modifica código/UI,
> **no** toca producción, **no** abre R7. Define el protocolo; la ejecución es un paso posterior.
> **Cierra junto con:** `RRHH_R6_PLAYWRIGHT_MATRIX.md` (automatizado) + `RRHH_R6_MANUAL_VALIDATION_CHECKLIST.md` (visual manual). D4 exige **ambos**.
> **Artefacto bajo prueba:** commit `043ae54` (UI RRHH). **Fecha:** 2026-06-07.

---

## 1. Objetivo
Validar que el frontend RRHH **espeja la seguridad de la base** (RLS/RBAC de R1–R5) y que cada rol ve
y puede hacer exactamente lo autorizado, sin fugas de PII. R6 se cierra cuando E2E (auto + manual) = PASS.

## 2. Roles a validar
`empleado` (employee_self_service) · `supervisor` (jerárquico por `supervisor_id`) · `rrhh_manager` ·
`rrhh_admin` · `viewer` (rrhh_viewer / dirección) · `operaciones` (sin permisos rrhh.*).

## 3. Áreas de cobertura (mínimo obligatorio)
| Área | Qué se valida |
|------|---------------|
| Sidebar RRHH | visibilidad del grupo + items por rol |
| Mi Espacio | acceso + **aislamiento** (solo lo propio) |
| Legajos | lectura / edición / restricciones (bancario+salud) |
| Solicitudes | creación · aprobación L1 · aprobación L2 · rechazo · cancelación |
| Novedades | generación (al aprobar L2) · visualización |
| Documentación | signed URLs · permisos · **salud aislada** |
| Organigrama | render · jerarquía · restricciones (integrado en `/organigrama`) |
| Dashboard RRHH | KPIs (conteos D1) · accesos rápidos |

## 4. Precondiciones (fixtures de prueba)
- App **desplegada y accesible** (preview/staging recomendado; ver §5) con `0056–0060` aplicadas.
- **6 usuarios de prueba** (uno por rol), con `user_roles` asignados:
  `employee_self_service`, (supervisor = empleado con subordinados), `rrhh_manager`, `rrhh_admin`,
  `rrhh_viewer`, y un `operaciones` **sin** permisos rrhh.*.
- Al menos **2 empleados** vinculados a `profiles` (uno como subordinado del supervisor) + datos de
  prueba: 1 solicitud por estado, 1 novedad, 1 documento `rrhh-legajo`, 1 documento `rrhh-health`.
- Credenciales de los usuarios de prueba para login E2E (Playwright storageState por rol).

## 5. ⚠️ Entorno de ejecución (clave)
- **Escenarios de LECTURA/visibilidad** (Sidebar, dashboard, listas, signed URL de docs existentes,
  organigrama) → seguros contra **producción** (no persisten).
- **Escenarios de ESCRITURA/workflow** (crear/enviar/aprobar/rechazar/cancelar solicitudes; generar
  novedad) → **persisten** y las tablas son **append-only** (no se pueden borrar). **Ejecutar en
  STAGING/preview**, no en producción. (Coherente con el patrón de cero-persistencia de gates previos.)
- Recomendación: correr el set completo contra un **preview deploy** con datos de prueba; reservar
  prod solo para una verificación de lectura/visibilidad si se desea.

## 6. Estrategia
1. **Automatizado (Playwright)** — `RRHH_R6_PLAYWRIGHT_MATRIX.md`: 1 sesión por rol (storageState),
   navegación + asserts de visibilidad y de acciones permitidas/denegadas.
2. **Manual visual** — `RRHH_R6_MANUAL_VALIDATION_CHECKLIST.md`: recorrido por rol con capturas,
   marcando PASS/FAIL/N/A por escenario.
3. Evidencia: capturas (Playwright + manuales) + export de resultados Playwright (lista de tests).

## 7. Criterio de cierre (R6 CLOSED)
- **Todos** los escenarios de la matriz (auto) = PASS **y** la checklist manual sin FAIL.
- Sin fuga de PII observada (bancario/salud nunca visibles a roles no autorizados; operaciones sin
  módulo).
- Resultado → `R6 CLOSED · DOCUMENTS & STORAGE… UI COMPLETE · READY FOR R7` (con autorización).
- Cualquier FAIL → `R6 OPEN` + causa; corrección y re-ejecución.

## 8. Fuera de alcance
Build/deploy a producción (D3, release separado) · R7 · cambios de UI/código.

---
```text
R6 E2E PACKAGE — PLAN COMPLETE
```

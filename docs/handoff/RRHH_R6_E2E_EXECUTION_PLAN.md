# TOPS NEXUS — RRHH · R6 E2E EXECUTION PLAN

> **Tipo:** plan de ejecución de la validación E2E de R6. **No** ejecuta, **no** toca producción,
> **no** abre R7, **no** modifica código. Define entorno, fixtures, usuarios, secuencia, evidencia y
> criterio PASS/FAIL.
> **Insumos:** `RRHH_R6_E2E_VALIDATION_PLAN.md`, `RRHH_R6_PLAYWRIGHT_MATRIX.md`,
> `RRHH_R6_MANUAL_VALIDATION_CHECKLIST.md`. Artefacto: commit `043ae54`. **Fecha:** 2026-06-07.

---

## ⚠️ GUARDARRAÍL CRÍTICO (leer primero)
Los escenarios de **escritura** (crear/enviar/aprobar L1/aprobar L2/generar novedad/cancelar/anular)
**persisten** y las tablas RRHH son **append-only** (no se pueden borrar). Por lo tanto:

> **El preview/staging DEBE apuntar a una base Supabase NO productiva.**

Riesgo documentado (lección ERP-A): el `.env.local` de la app apunta por defecto a **producción**
(`arsksytgdnzukbmfgkju`). Un Netlify **deploy preview** que herede esas env vars **escribiría en
producción**. Antes de cualquier escenario de escritura, **verificar** que el deploy use el proyecto
**staging** (`vrxosunxlhohmqymxots`) y **no** el prod. Si no hay staging con `0056–0060` aplicadas,
**no ejecutar los escenarios de escritura**.

| Tipo de escenario | Dónde es seguro ejecutar |
|-------------------|--------------------------|
| Lectura / visibilidad (sidebar, dashboard, listas, organigrama, descarga de docs existentes) | Preview→prod (read-only) **o** staging |
| **Escritura / workflow** (crear/L1/L2/novedad/cancelar/anular) | **Solo staging/preview con DB no productiva** |

---

## 1. Entorno de ejecución
- **App:** Next.js (Nexus) desplegada como **Netlify Deploy Preview** de la rama RRHH (no `main`).
- **DB:** Supabase **staging** (`vrxosunxlhohmqymxots`) con `0056–0060` aplicadas. Confirmar paridad
  de esquema con prod (correr `POST_DEPLOY_AUDIT` de R5 y un check de R3/R4 en staging).
- **Runner:** Playwright (`@playwright/test`) desde CI o local apuntando a la URL del preview.
- **Prohibido:** ejecutar escenarios de escritura contra `arsksytgdnzukbmfgkju`.

## 2. Preview deploy (preparación)
```
☐ Deploy preview de la rama RRHH en Netlify (build verde; Node 22, heap 4GB — patrón conocido)
☐ Env del preview apuntando a Supabase STAGING (NO prod) — verificar projectRef en la URL/anon key
☐ Smoke: abrir /rrhh → dashboard responde (no ModuleUnavailable)
☐ Confirmar que /api/drive y otros módulos no interfieren (fuera de alcance RRHH)
```

## 3. Fixtures requeridos (en staging)
```
☐ 2 empleados vinculados a profiles:  EMP (subordinado) y SUP (su supervisor, supervisor_id=SUP)
☐ Solicitudes seed: 1 en borrador, 1 pendiente_supervisor, 1 pendiente_rrhh, 1 aprobada
☐ 1 novedad (de una aprobación previa)
☐ 1 documento en rrhh-legajo (doc_class dni) + 1 en rrhh-health (estudio) + 1 adjunto_solicitud + 1 capacitacion
☐ (los binarios pueden ser archivos dummy; el test valida el grant/permiso, no el contenido)
```
> Alternativa para flujos efímeros: el patrón `BEGIN…ROLLBACK` + `set_config(request.jwt.claims)` de
> R4/R5 valida la **lógica de acceso** sin persistir; útil para complementar, pero la E2E **visual**
> requiere datos reales en staging para renderizar las pantallas.

## 4. Usuarios por rol (login → storageState)
| Rol | Usuario de prueba | user_roles / vínculo | storageState |
|-----|-------------------|----------------------|--------------|
| empleado | `e2e_emp@test` | `employee_self_service`; profile = EMP.profile_id | `emp.json` |
| supervisor | `e2e_sup@test` | profile = SUP.profile_id (es supervisor_id de EMP) | `sup.json` |
| rrhh_manager | `e2e_mgr@test` | rol `rrhh_manager` | `mgr.json` |
| rrhh_admin | `e2e_admin@test` | rol `rrhh_admin` | `admin.json` |
| viewer | `e2e_viewer@test` | rol `rrhh_viewer` | `viewer.json` |
| operaciones | `e2e_ops@test` | sin permisos `rrhh.*` | `ops.json` |
```
☐ Crear los 6 usuarios en staging + asignaciones user_roles
☐ Generar storageState por rol (login una vez; reusar sesión)
```

## 5. Secuencia de ejecución
1. **Preparación**: deploy preview + verificación de DB staging (guardarraíl §⚠️) + fixtures + storageState.
2. **Fase A — Lectura/visibilidad** (segura): Sidebar, Dashboard, Mi Espacio, listas, organigrama,
   descarga de docs existentes. (P-*-visibilidad de la matriz.)
3. **Fase B — Escritura/workflow** (solo staging): empleado crea→envía; supervisor L1/rechazo;
   manager/admin L2; verificar novedad; cancelar; admin anula (+contrapartida).
4. **Fase C — PII/negativos**: supervisor sin DNI/contrato/salud; manager sin salud; operaciones nulo;
   descargas denegadas.
5. **Validación manual** en paralelo: recorrer `RRHH_R6_MANUAL_VALIDATION_CHECKLIST.md` con capturas.
6. **Consolidación**: export de Playwright + capturas manuales → `RRHH_R6_FINAL_VALIDATION` (cierre).

## 6. Evidencia requerida
- **Automatizada:** reporte Playwright (lista de `P-*` con passed/failed) + screenshots por test +
  trazas de red para descargas (200 en autorizadas; error/denegado en negativas).
- **Manual:** checklist completada (PASS/FAIL/N/A) + capturas por rol en `r6-evidence/<rol>/`.
- **Lado base (opcional, read-only):** conteo en `rrhh_document_audit` tras descargas; estado de
  solicitudes tras transiciones; novedad/contrapartida tras L2/anular.

## 7. Criterio PASS / FAIL
- **PASS (R6 CLOSED):** todos los `P-*` de la matriz = passed **y** checklist manual **sin FAIL** **y**
  cero fuga de PII observada (bancario/salud nunca a roles no autorizados; operaciones sin módulo).
- **FAIL (R6 OPEN):** cualquier `P-*` failed o cualquier FAIL en checklist → documentar (id + captura +
  causa), corregir y re-ejecutar.
- **Bloqueo de seguridad:** si se detecta que el preview apuntaba a **prod**, **abortar** la fase de
  escritura y reportar (no continuar).

## 8. Fuera de alcance
Build/deploy a producción (D3, release separado) · R7 · cambios de UI/código · ejecución (este doc
solo planifica).

---
```text
R6 EXECUTION PLAN COMPLETE
READY FOR E2E RUN
```

# RRHH-DATA-AUDIT

**Fecha:** 2026-06-08 · **Modo:** auditoría read-only + corrección de mensajes UX. **No se tocó producción.**
**Base:** Supabase productivo `arsksytgdnzukbmfgkju` (conteos con service role = global real, bypass RLS).

---

## Respuesta explícita

> ## Causa = **A) FALTA DE DATOS**. No es permisos ni filtros.

1. **¿Las tablas RRHH tienen datos?** ❌ **No.** Las 7 tablas están en **0 registros**.
2. **¿Las consultas devuelven datos?** ❌ No — porque **no hay filas**. Las queries son correctas; con 0 filas no hay nada que devolver.
3. **¿El SUPER_ADMIN está filtrado incorrectamente?** ❌ No. No es problema de filtro/permiso: con las tablas vacías, **ningún rol** vería datos. (La RLS es irrelevante cuando hay 0 filas.)
4. **¿Permisos o datos?** **DATOS.** (El RBAC además está dormido, pero eso no cambia el resultado: aun con permisos perfectos, no hay registros.)
5. **¿Qué corregir?** (a) **Cargar datos** en RRHH (seed/import/captura); (b) ya corregí los **mensajes engañosos** que culpaban al rol.

---

## Tablas auditadas — cantidad real de registros

```
rrhh_empleados ............ 0   (HTTP 200, existe)
rrhh_solicitudes .......... 0
rrhh_novedades ............ 0
rrhh_documents ............ 0
rrhh_solicitud_eventos .... 0
rrhh_empleado_bancario .... 0
rrhh_empleado_historial ... 0
```
Todas existen (HTTP 200) y están **vacías** (`Content-Range: */0`).

---

## Por pantalla

| Pantalla | Tabla(s) | Query / filtros | Registros | Resultado |
|---|---|---|---|---|
| **Dashboard RRHH** | `rrhh_empleados`, `rrhh_solicitudes` | counts: total, activos, en licencia, solicitudes/vacaciones pendientes, licencias aprobadas | 0 | KPIs en 0 |
| **Empleados** | `rrhh_empleados` | `select(EMP_COLS)` (sin filtro de negocio; RLS por sesión) | 0 | vacío |
| **Solicitudes** | `rrhh_solicitudes` | lista (RLS por sesión) | 0 | vacío |
| **Novedades** | `rrhh_novedades` | filtro opcional `periodo` (no aplicado por defecto) | 0 | vacío |
| **Documentación** | `rrhh_documents` | lista (RLS por sesión) | 0 | vacío |

> No hay filtros de negocio "ocultos" que excluyan registros para SUPER_ADMIN. El único filtrado es la RLS por sesión (R3–R5), pero **es inocuo con 0 filas**.

---

## Filtros detectados

- `getDashboardCounts`: filtros `estado`/`tipo` para los KPIs (activo, licencia, vacaciones pendientes, etc.) — correctos; cuentan 0 porque no hay empleados/solicitudes.
- `listNovedades(periodo?)`: filtro de período **opcional**, no aplicado por defecto → no excluye nada.
- `listEmpleados`/`listSolicitudes`/`listDocumentos`: sin filtros de negocio; sólo RLS por sesión.
- **Ningún filtro incorrecto contra SUPER_ADMIN.**

---

## Causa raíz

**Las tablas RRHH están vacías en producción.** El módulo RRHH (R1–R6) se construyó y validó contra **staging**; en el Supabase productivo nunca se cargaron empleados/solicitudes/novedades/documentos. Mismo patrón que el CRM 360° (`CRM-OPPORTUNITIES-360-AUDIT.md`). No es un bug de permisos ni de queries.

---

## Corrección aplicada (UX — mensajes engañosos)

Los empty-states decían **"No hay X visibles para tu rol"**, atribuyendo el vacío al **rol/permiso** (falso: es ausencia de datos). Corregidos:

| Pantalla | Antes | Después |
|---|---|---|
| Empleados | "No hay empleados visibles para tu rol." | **"No hay empleados cargados."** |
| Solicitudes | "No hay solicitudes visibles para tu rol." | **"No hay solicitudes cargadas."** |
| Novedades | "No hay novedades visibles para tu rol." | **"No hay novedades cargadas."** |
| Documentación | "No hay documentos visibles para tu rol." | **"No hay documentos cargados."** |

Archivos: `rrhh/empleados/page.tsx`, `rrhh/solicitudes/page.tsx`, `rrhh/novedades/page.tsx`, `rrhh/documentos/page.tsx`. `tsc` EXIT 0. Sin cambios de lógica/queries/RLS.

---

## Corrección recomendada (datos — operacional, fuera de esta sesión)

Para que RRHH muestre información, **cargar datos** en producción (decisión de negocio):
- **Alta de empleados** (import del legajo real / formulario de carga) → `rrhh_empleados`.
- A partir de ahí el resto fluye: solicitudes (autoservicio), novedades, documentos.
- Opcional: seed inicial one-shot desde la planilla de RRHH vigente.

> No bloquea el resto del sistema. El módulo está construido y operativo a nivel de código; sólo le faltan datos. **No se cargó nada en prod** (requiere decisión + fuente de datos real).

---

## Evidencia
```
service role · /rest/v1/rrhh_*?select=id&count=exact → */0 en las 7 tablas
mensajes "visibles para tu rol" en rrhh/ → 0 (corregidos a "… cargados/cargadas")
tsc EXIT 0
```
Sin commit/push.

# TOPS NEXUS — RRHH · R6 IMPLEMENTATION PLAN
## R6 — UI / PORTAL & DASHBOARD (diseño-primero)

> **Estado:** PLAN — **pendiente de aprobación de Dirección**. **No** implementa, **no** escribe
> código, **no** crea migraciones, **no** toca producción. (No abrir R7.)
> **Naturaleza:** R6 es la **capa visual** que consume R1–R5 (RBAC + legajo + workflow + storage) ya
> aplicados y verificados en producción. **No requiere migraciones** salvo, opcionalmente, vistas
> derivadas de dashboard (decisión §8).
> **Modelo:** `RRHH_MASTER_ARCHITECTURE_v2_0.md` §1/§6/§7 + amendments. **Producción:** `arsksytgdnzukbmfgkju`.
> **Fecha:** 2026-06-07.

---

## 0. Auditoría inicial (patrones de frontend, verificados)
| Patrón Nexus | Aplicación a RRHH |
|--------------|-------------------|
| Rutas `src/app/(app)/<módulo>/page.tsx` + subpáginas (Tesorería: bancos/cobranzas/movimientos/…) | `src/app/(app)/rrhh/…` |
| `src/components/shell/Sidebar.tsx` (navegación por módulo) | Entrada "RRHH" gateada por permiso |
| Capa `src/lib/<mod>/{types,data,actions,validation,errors}.ts` | `src/lib/rrhh/*` (ya previsto en v2.0 §2.4) |
| Server actions `"use server"` → `supabase.rpc("…", {...})` | `actions.ts` invoca `rrhh_solicitud_*`, `emit_rrhh_signed_url` |
| Lectura con RLS aplicada (`data.ts` + `createClient`) | `data.ts` lee legajo/solicitudes/novedades/documentos |
| Acceso a binarios por signed URL (patrón documental) | `emit_rrhh_signed_url` → grant → firma con SDK |
| **Ruta `/organigrama` ya existe** a nivel app | **Reconciliar** (§7): integrar RRHH o enlazar |

**Regla dura (FD-9):** ningún cálculo (saldos/antigüedad/ausentismo) en el cliente; se leen de la base.

---

## 1. Estructura visual RRHH
Rutas bajo `src/app/(app)/rrhh/`:
```
rrhh/
  page.tsx                  Dashboard RRHH (landing del módulo)
  empleados/                Legajos: lista + [id] detalle
    [id]/page.tsx
  solicitudes/              Vacaciones/permisos/licencias/horas extra
    [id]/page.tsx
  novedades/                Registro del período (lectura)
  documentos/               Documentación (legajo + adjuntos)
  organigrama/              Árbol jerárquico (o enlace a /organigrama — §7)
  reportes/                 Export ausentismo/vacaciones/dotación/…
  mi-espacio/               Portal del empleado (self-service)
```
Capa lib: `src/lib/rrhh/{types,data,actions,validation,errors}.ts`.

## 2. Sidebar RRHH
- Entrada **"RRHH"** en `src/components/shell/Sidebar.tsx`, con sub-items (Dashboard, Empleados,
  Solicitudes, Novedades, Documentos, Organigrama, Reportes, Mi espacio).
- **Gating por permiso:** el grupo aparece si el usuario tiene `rrhh.view` **o** `rrhh.export` **o**
  es `employee_self_service` (ve solo "Mi espacio"). Cada sub-item se muestra según permiso/rol.
- Sin exponer ítems de PII a roles sin permiso.

## 3. Legajos (Empleados)
- **Lista** (`empleados/`): nombre, legajo, sección, depósito, estado, antigüedad (de vista). Filtros.
- **Detalle** (`empleados/[id]`): datos personales/laborales; **bancario** y **salud** solo si
  `rrhh.admin` (la RLS ya lo fuerza; la UI además oculta los tabs). Historial (append-only) en lectura.
- **Alta/edición**: solo `rrhh.admin`; vía server action → (RPC de legajo cuando exista) / carga
  controlada. Empleado: "Mi espacio" muestra **solo su** legajo (RLS por propiedad).

## 4. Solicitudes (workflow)
- **Lista/detalle** filtrable por estado/tipo; el empleado ve las suyas, el supervisor las de su
  equipo, RRHH todas (RLS de `0059`).
- **Acciones** (botonera condicionada por estado + rol) → server actions que invocan los RPCs:
  `rrhh_solicitud_crear/enviar/aprobar_l1/aprobar_l2/rechazar/cancelar/anular`.
- **Timeline** desde `rrhh_solicitud_eventos` (trazabilidad). Horas extra: alta con recargo (metadato).

## 5. Novedades
- Vista **de lectura** por período (YYYY-MM) y empleado/sección; deriva de `rrhh_novedades`
  (append-only). Sin edición (corrección por contrapartida vía workflow). Export a XLSX/PDF.

## 6. Documentación
- **Lista** de `rrhh_documents` por empleado/clase; **ver/descargar** vía `emit_rrhh_signed_url`
  (server action → grant `{bucket,path}` → firma con SDK; nunca exponer el path crudo).
- **Salud** visible solo a `rrhh.admin`/dueño (RLS + RPC ya lo fuerzan; UI oculta el tab).
- **Carga** (solo `rrhh.admin`/`rrhh.create`): server action con **cliente service_role** (los buckets
  `rrhh-*` no tienen escritura `authenticated`) → upload + insert metadatos.
- Supervisor: solo `adjunto_solicitud`/`capacitacion` de su equipo (D2).

## 7. Organigrama
- Árbol jerárquico desde `rrhh_empleados.supervisor_id`.
- **Reconciliación:** ya existe `src/app/(app)/organigrama`. **Decisión a confirmar:** (a) integrar el
  organigrama RRHH dentro de esa ruta existente, o (b) crear `rrhh/organigrama` y enlazar. Evitar
  duplicar funcionalidad (lección del audit original).

## 8. Dashboard RRHH
- KPIs: dotación (activos por depósito/sección), ausentismo (mes/YTD), vacaciones (pendientes/en
  curso/saldo), licencias activas por tipo, permisos del mes, antigüedad promedio, alertas.
- **Fuente de datos (FD-9, sin cálculo en cliente):** las vistas derivadas `rrhh_v_*`
  (`_dotacion`/`_ausentismo`/`_vacaciones_saldo`/`_dashboard_kpis`) **aún no existen**.
  **Decisión a confirmar:** (a) R6 muestra solo KPIs computables con conteos simples en `data.ts`
  (dotación, solicitudes por estado) y difiere ausentismo/saldo; **o** (b) un mini-gate de **vistas
  derivadas** (1 migración read-only) habilita los KPIs completos. (Dirección dijo "no migraciones en
  R6" → por defecto opción (a); opción (b) requeriría autorización.)
- Audiencia: `rrhh_viewer`/`director_ops`/`rrhh_admin` (permiso `rrhh.export`/`rrhh.view`).

## 9. Roles de acceso (UI)
| Rol | Ve |
|-----|----|
| `employee_self_service` | Solo "Mi espacio": su legajo, sus solicitudes, sus documentos/recibos |
| supervisor (jerárquico) | Solicitudes de su equipo + adjuntos laborales (D2); aprueba L1 |
| `rrhh_manager` | Legajos, solicitudes, novedades, documentos (sin salud/bancario) |
| `rrhh_admin` | Todo incl. salud/bancario, carga de documentos, anulaciones |
| `rrhh_viewer` / `director_ops` | Dashboard + reportes agregados (sin PII individual) |
| operaciones / otros | Sin acceso al módulo (no aparece en Sidebar) |
> La UI **refleja** la seguridad de la base (RLS/RPC), no la reemplaza: aunque la UI oculte algo, la
> base ya lo deniega (fail-closed). Gating de UI vía `has_permission` (consulta server-side).

## 10. Estrategia E2E visual
- **Herramienta:** Playwright (MCP disponible) + preview del proyecto; capturas por rol.
- **Matriz de escenarios** (login simulado por rol → navegar → verificar visibilidad):
  - Empleado: ve "Mi espacio"; **no** ve Legajos de otros; puede crear/cancelar su solicitud; ve sus docs.
  - Supervisor: ve solicitudes del equipo; aprueba L1; **no** ve DNI/contrato/salud.
  - RRHH manager: gestiona legajo/solicitudes; **no** ve salud/bancario.
  - RRHH admin: ve salud/bancario; carga documentos; anula.
  - Viewer/Dirección: ve dashboard/reportes; **no** PII individual.
  - Operaciones: **no** ve el módulo RRHH en el Sidebar.
- **Evidencia:** capturas + checklist V1..Vn (PASS/FAIL) por escenario; sin datos reales (usuarios de
  prueba). Patrón análogo al de validación de gates previos.

---

## 11. Alcance y límites
**Incluye:** `src/lib/rrhh/*`, `src/app/(app)/rrhh/*`, entrada de Sidebar, componentes UI, server
actions que consumen los RPCs/tablas de R1–R5, consumo de signed URLs.
**NO incluye:** migraciones (salvo decisión §8 con autorización aparte), recibos UI (D1), liquidación,
firma digital, OCR, R7.

## 12. Riesgos
| Tipo | Riesgo | Mitigación |
|------|--------|------------|
| PII | Render de CBU/salud a usuario sin permiso | UI espeja RLS; tabs ocultos por `has_permission`; base ya deniega |
| Seguridad | Exponer `storage_path` o URL persistente | Solo signed URL efímera vía RPC; nunca el path crudo |
| Cálculo en cliente (FD-9) | KPIs calculados en el browser | Derivar en base; §8 decide fuente |
| Duplicación | Organigrama duplicado vs `/organigrama` existente | §7 reconciliación |
| Carga de docs | Upload directo desde cliente a bucket | Upload por server action con service_role |
| Alcance | Scope creep a recibos/liquidación | Lista de exclusión §11 |

## 13. Entregables del gate
`RRHH_R6_IMPLEMENTATION_PLAN.md` (este) → aprobación → implementación UI (`src/lib/rrhh/*` +
`src/app/(app)/rrhh/*` + Sidebar) → `RRHH_R6_IMPLEMENTATION_REPORT.md` · `RRHH_R6_AUDIT_REPORT.md` ·
`RRHH_R6_FINAL_VALIDATION.md` (E2E visual) · `RRHH_R6_CLOSURE_REPORT.md`.

## 14. Decisiones a confirmar por Dirección
1. **Dashboard (§8):** ¿opción (a) KPIs simples sin migración, o (b) mini-gate de vistas `rrhh_v_*`?
2. **Organigrama (§7):** ¿integrar en `/organigrama` existente o crear `rrhh/organigrama`?
3. **Build/deploy:** ¿R6 incluye el build+deploy del frontend (Netlify) o se separa como release?
4. **E2E visual:** ¿Playwright automatizado o validación manual con capturas?

---
```text
R6 PLAN COMPLETE
AWAITING APPROVAL
(no código, no migraciones, no producción)
```

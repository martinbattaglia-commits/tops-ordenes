# TOPS NEXUS — RRHH · R6 PLAYWRIGHT MATRIX (E2E automatizado)

> Matriz de escenarios Playwright por rol. **No** ejecutar acá. Correr contra **staging/preview**
> (los escenarios de escritura persisten; tablas append-only). Una `storageState` por rol (login
> previo). Artefacto bajo prueba: commit `043ae54`.
> **Fecha:** 2026-06-07.

---

## Setup
- `storageState` por rol: `emp.json`, `sup.json`, `mgr.json`, `admin.json`, `viewer.json`, `ops.json`
  (login una vez por usuario de prueba; reusar sesión en cada test).
- Base URL = preview deploy. Rutas RRHH: `/rrhh`, `/rrhh/empleados`, `/rrhh/solicitudes`,
  `/rrhh/novedades`, `/rrhh/documentos`, `/rrhh/mi-espacio`, `/organigrama`.
- Selectores sugeridos: por texto visible (`getByRole`/`getByText`) — la UI usa labels en español.
  (Opcional: agregar `data-testid` en una iteración futura; no requerido para R6.)

## Convención de evidencia
Cada escenario captura: screenshot full-page + el resultado del assert (PASS/FAIL) + URL final.

---

## Matriz por rol × área

### empleado (`employee_self_service`)
| ID | Escenario | Pasos | Esperado | Evidencia |
|----|-----------|-------|----------|-----------|
| P-EMP-1 | Sidebar acotado | login emp → abrir sidebar | Ve grupo "Recursos Humanos" con **Mi espacio**; **no** ve gestión global (o items deshabilitados) | screenshot sidebar |
| P-EMP-2 | Mi Espacio propio | ir `/rrhh/mi-espacio` | Muestra **su** legajo (su public_id); no el de otros | screenshot |
| P-EMP-3 | Aislamiento legajos | ir `/rrhh/empleados/<id_ajeno>` | "no encontrado o sin acceso" (RLS) | screenshot |
| P-EMP-4 | Crear solicitud | `/rrhh/solicitudes` → crear (permiso) | Solicitud creada en `borrador`/`pendiente` a su nombre | screenshot + estado |
| P-EMP-5 | Cancelar propia | abrir su solicitud pendiente → Cancelar | estado → `cancelada` | screenshot |
| P-EMP-6 | No aprueba | abrir su solicitud | **no** aparecen botones Aprobar L1/L2 | screenshot |
| P-EMP-7 | Documentos propios | `/rrhh/documentos` → Descargar (doc propio) | redirige a signed URL (200) | network 200 |
| P-EMP-8 | Sin salud ajena | intentar doc salud ajeno (si visible) | no listado / descarga denegada | screenshot |

### supervisor (jerárquico)
| ID | Escenario | Pasos | Esperado | Evidencia |
|----|-----------|-------|----------|-----------|
| P-SUP-1 | Solicitudes del equipo | `/rrhh/solicitudes` | Ve las de sus subordinados | screenshot |
| P-SUP-2 | Aprobar L1 | abrir solicitud de subordinado en `pendiente_supervisor` → Aprobar (supervisor) | estado → `pendiente_rrhh` | screenshot |
| P-SUP-3 | Rechazar L1 | otra solicitud `pendiente_supervisor` → Rechazar | estado → `rechazada` | screenshot |
| P-SUP-4 | No L2 | solicitud `pendiente_rrhh` | **no** puede Aprobar (RRHH) → acción ausente/denegada | screenshot |
| P-SUP-5 | Docs equipo acotado | `/rrhh/documentos` | Ve **adjunto_solicitud / capacitacion** del equipo; **no** DNI/contrato/salud | screenshot |
| P-SUP-6 | Sin PII personal | abrir legajo subordinado | **no** ve bancario ni salud | screenshot |

### rrhh_manager
| ID | Escenario | Pasos | Esperado | Evidencia |
|----|-----------|-------|----------|-----------|
| P-MGR-1 | Legajos completos | `/rrhh/empleados` | Ve todos los legajos | screenshot |
| P-MGR-2 | Sin bancario/salud | abrir legajo → tabs | **no** ve sección bancaria (sin `rrhh.admin`) | screenshot |
| P-MGR-3 | Aprobar L2 | solicitud `pendiente_rrhh` → Aprobar (RRHH) | estado → `aprobada` + se genera novedad | screenshot + `/rrhh/novedades` |
| P-MGR-4 | Docs salud denegada | descargar doc `rrhh-health` | ACCESS_DENIED (no genera URL) | screenshot/network |
| P-MGR-5 | Dashboard | `/rrhh` | KPIs visibles (conteos) | screenshot |

### rrhh_admin
| ID | Escenario | Pasos | Esperado | Evidencia |
|----|-----------|-------|----------|-----------|
| P-ADM-1 | Bancario visible | abrir legajo → tab bancario | Ve datos bancarios (badge PII) | screenshot |
| P-ADM-2 | Salud accesible | descargar doc `rrhh-health` | redirige a signed URL (200) | network 200 |
| P-ADM-3 | Anular aprobada | solicitud `aprobada` → Anular (con motivo) | estado → `anulada` + contrapartida en novedades | screenshot + novedades |
| P-ADM-4 | Auditoría | tras descargas | (verificación lado base) filas en `rrhh_document_audit` | nota: chequeo SQL read-only opcional |

### viewer (`rrhh_viewer` / dirección)
| ID | Escenario | Pasos | Esperado | Evidencia |
|----|-----------|-------|----------|-----------|
| P-VW-1 | Dashboard | `/rrhh` | Ve KPIs/accesos | screenshot |
| P-VW-2 | Sin PII individual | `/rrhh/empleados` o documentos | **no** accede a registros individuales / descargas PII | screenshot |
| P-VW-3 | Reportes agregados | (cuando existan reportes) | acceso solo a agregados | screenshot/N/A |

### operaciones (sin rrhh.*)
| ID | Escenario | Pasos | Esperado | Evidencia |
|----|-----------|-------|----------|-----------|
| P-OPS-1 | Sin módulo | abrir sidebar | **no** ve "Recursos Humanos" (o sin items) | screenshot |
| P-OPS-2 | Acceso directo bloqueado | navegar `/rrhh/empleados` | listas vacías / sin datos (RLS) | screenshot |
| P-OPS-3 | Descarga denegada | intentar `emit` de cualquier doc | ACCESS_DENIED | network |

---

## Esqueleto de test (referencia, no ejecutar)
```ts
// tests/e2e/rrhh.spec.ts  (Playwright)
import { test, expect } from "@playwright/test";

const ROLE = (f: string) => ({ storageState: `tests/.auth/${f}.json` });

test.describe("RRHH · empleado", () => {
  test.use(ROLE("emp"));
  test("P-EMP-2 Mi Espacio muestra solo lo propio", async ({ page }) => {
    await page.goto("/rrhh/mi-espacio");
    await expect(page.getByText("Mi legajo")).toBeVisible();
  });
  test("P-EMP-6 no puede aprobar", async ({ page }) => {
    await page.goto("/rrhh/solicitudes");
    // abrir su solicitud y verificar ausencia de 'Aprobar (RRHH)'
    await expect(page.getByRole("button", { name: /Aprobar \(RRHH\)/ })).toHaveCount(0);
  });
});

test.describe("RRHH · operaciones", () => {
  test.use(ROLE("ops"));
  test("P-OPS-1 sin módulo RRHH", async ({ page }) => {
    await page.goto("/rrhh");
    // dashboard sin datos o sidebar sin grupo RRHH
    await expect(page.getByText("Recursos Humanos")).toHaveCount(0);
  });
});
```

## Resultado esperado (export Playwright)
Todos los `P-*` = **passed**. Cualquier `failed` → R6 OPEN + causa (test id + screenshot).

---
```text
R6 PLAYWRIGHT MATRIX — COMPLETE
```

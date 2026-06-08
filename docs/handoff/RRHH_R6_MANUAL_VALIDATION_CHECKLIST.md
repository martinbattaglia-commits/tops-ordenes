# TOPS NEXUS — RRHH · R6 MANUAL VALIDATION CHECKLIST (visual)

> Checklist de validación **visual manual** por rol (complementa la matriz Playwright; D4 exige ambos).
> **No** ejecutar acá. Marcar `PASS` / `FAIL` / `N/A` por escenario, adjuntando captura.
> Entorno: preview/staging (los flujos de escritura persisten — append-only). Artefacto: commit `043ae54`.
> **Fecha:** 2026-06-07.

Leyenda: ✅ PASS · ❌ FAIL · ⊘ N/A. Registrar capturas en una carpeta `r6-evidence/<rol>/`.

---

## 0. Preparación
```
☐ 6 usuarios de prueba con roles asignados (emp/sup/mgr/admin/viewer/ops)
☐ 2 empleados vinculados a profiles (uno subordinado del supervisor)
☐ datos de prueba: 1 solicitud por estado, 1 novedad, 1 doc rrhh-legajo, 1 doc rrhh-health
☐ entorno = preview/staging con 0056–0060 aplicadas
```

---

## 1. Sidebar RRHH (visibilidad por rol)
| Rol | Esperado | Resultado |
|-----|----------|-----------|
| empleado | ve grupo RRHH con "Mi espacio" (gestión global oculta/limitada) | ☐ |
| supervisor | ve solicitudes/equipo; sin PII personal | ☐ |
| rrhh_manager | ve todos los items de gestión (sin salud/bancario) | ☐ |
| rrhh_admin | ve todos los items | ☐ |
| viewer | ve Dashboard/reportes; sin PII individual | ☐ |
| operaciones | **no** ve el grupo "Recursos Humanos" | ☐ |

## 2. Mi Espacio
| Escenario | Esperado | Resultado |
|-----------|----------|-----------|
| empleado abre Mi Espacio | ve **su** legajo (su public_id) | ☐ |
| aislamiento | no ve datos de otros empleados | ☐ |
| accesos rápidos | "Mis solicitudes" / "Mis documentos" funcionan | ☐ |

## 3. Legajos
| Escenario | Esperado | Resultado |
|-----------|----------|-----------|
| manager/admin: lista de empleados | visible y completa | ☐ |
| empleado: legajo ajeno | "no encontrado/sin acceso" | ☐ |
| manager: tab bancario | **oculto** (sin rrhh.admin) | ☐ |
| admin: tab bancario | **visible** (badge PII) | ☐ |
| supervisor: legajo subordinado | datos laborales sí; bancario/salud **no** | ☐ |
| edición de legajo | solo admin (la UI no ofrece edición a otros) | ☐ |

## 4. Solicitudes (workflow)
| Escenario | Esperado | Resultado |
|-----------|----------|-----------|
| empleado: crear solicitud | creada a su nombre (borrador→enviar) | ☐ |
| empleado: cancelar propia (pre-aprobación) | estado → cancelada | ☐ |
| supervisor: Aprobar L1 (subordinado) | → pendiente_rrhh | ☐ |
| supervisor: Rechazar | → rechazada | ☐ |
| supervisor: **no** Aprobar L2 | acción ausente | ☐ |
| manager/admin: Aprobar L2 | → aprobada (+ novedad) | ☐ |
| admin: Anular aprobada (con motivo) | → anulada (+ contrapartida) | ☐ |
| timeline | refleja cada transición (eventos) | ☐ |

## 5. Novedades
| Escenario | Esperado | Resultado |
|-----------|----------|-----------|
| tras Aprobar L2 | aparece 1 novedad asociada | ☐ |
| tras Anular | aparece contrapartida (cantidad negativa) | ☐ |
| visualización por período | lista correcta; solo lectura | ☐ |
| empleado | ve solo sus novedades | ☐ |

## 6. Documentación
| Escenario | Esperado | Resultado |
|-----------|----------|-----------|
| empleado: descargar doc propio | abre signed URL (efímero) | ☐ |
| supervisor: adjunto_solicitud/capacitacion equipo | descarga OK | ☐ |
| supervisor: dni/contrato/salud | denegado | ☐ |
| manager: doc salud | **denegado** (sin admin) | ☐ |
| admin: doc salud | descarga OK | ☐ |
| operaciones: cualquier doc | denegado | ☐ |
| en ningún caso se ve el `storage_path` crudo | confirmado (solo signed URL) | ☐ |

## 7. Organigrama
| Escenario | Esperado | Resultado |
|-----------|----------|-----------|
| acceso desde RRHH | enlaza a `/organigrama` (no ruta duplicada) | ☐ |
| render jerárquico | muestra jerarquía supervisor→subordinados | ☐ |
| restricciones por rol | acorde a permisos (sin PII no autorizada) | ☐ |

## 8. Dashboard RRHH
| Escenario | Esperado | Resultado |
|-----------|----------|-----------|
| KPIs (conteos) | dotación/activos/licencia/solicitudes/vacaciones/licencias visibles | ☐ |
| accesos rápidos | tarjetas navegan a cada sección | ☐ |
| viewer/dirección | ve KPIs sin PII individual | ☐ |
| operaciones | sin acceso al dashboard RRHH | ☐ |

---

## Veredicto
```
Total escenarios: ___   PASS: ___   FAIL: ___   N/A: ___
```
- **Sin FAIL** (y matriz Playwright en verde) → `R6 CLOSED · UI COMPLETE · READY FOR R7` (con autorización).
- **Algún FAIL** → `R6 OPEN` + causa (escenario + captura) → corrección y re-validación.

---
```text
R6 MANUAL CHECKLIST — COMPLETE
```

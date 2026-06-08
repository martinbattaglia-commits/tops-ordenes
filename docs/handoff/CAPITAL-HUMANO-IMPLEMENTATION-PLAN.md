# CAPITAL-HUMANO-IMPLEMENTATION-PLAN

**Fecha:** 2026-06-08 · Plan por fases. Construir sobre R1–R6. Cada fase = entregable verificable (`tsc` + QA por rol).

---

## Fase CH0 — Cierre de pre-requisitos (bloqueantes de datos)
- [ ] Conseguir **1–2 recibos de sueldo reales** (R1) → fija el parser del Módulo 2.
- [ ] Conseguir la **planilla de vacaciones en xlsx** (fechas de ingreso exactas; la captura está truncada).
- [ ] Confirmar política de **firma** (sello interno OC/OS vs firma certificada externa).
- *Sin CH0, la importación y el cálculo de antigüedad no pueden ser exactos (no asumir).*

## Fase CH1 — Legajo digital (alta/baja/modificación) — Módulo 1
- Migración `0062_rrhh_empleado_rpcs.sql`: `rrhh_empleado_crear/actualizar/baja` (auditadas a historial).
- `lib/rrhh/actions.ts`: `crearEmpleado/actualizarEmpleado/bajaEmpleado` (Zod + `assertCan('rrhh.edit')`).
- UI: `/rrhh/empleados/nuevo` (form enterprise), edición en `/rrhh/empleados/[id]`, baja con motivo.
- Legajo 360°: pestañas datos básicos / laboral / documentación / bancario (RLS) / historial.
- **DoD:** alta crea empleado real; aparece en lista y dashboard; `tsc` EXIT 0; QA por rol.

## Fase CH2 — Documentación (Módulo 7)
- Subida/clasificación a `rrhh_documents` (contratos, recibos, certificados, ART, seguro, exámenes) con `fecha_vencimiento` → feed de "próximos vencimientos".
- Reusa Storage + `emit_rrhh_signed_url`. Versionado por `document_group_id`.

## Fase CH3 — Solicitudes + Firma + PDF (Módulos 3 y 6)
- Migración `0063_rrhh_sign.sql`: columnas firma + `rrhh_sign_solicitud` (integrity_hash sha256 canónico).
- `lib/rrhh/pdf/` (espejo de `compras/pdf/`): Permiso Retiro / Inasistencia / Solicitud genérica.
- UI: formularios por tipo en Mi Espacio + bandeja de aprobación (supervisor/RRHH) con timeline (`eventos`).
- **DoD:** flujo empleado→L1→L2→firma→PDF→legajo; novedad generada; `tsc` EXIT 0.

## Fase CH4 — Vacaciones (Módulos 4 y 5) — el más grande
- Migración `0064_rrhh_vacaciones.sql`: `rrhh_vacaciones_escala` (seed 14/21/28/35), vista `rrhh_vacaciones_saldo`, tabla `rrhh_vacaciones_periodo`, RPCs `rrhh_vacaciones_planificar/notificar`.
- Motor de saldos (vista) + validaciones (ventana legal 1-oct→30-abr, superposición, fraccionamiento, medio día).
- PDF "Período de Descanso Anual" (3 secciones legales) + flujo notificación→acuse→certificación.
- UI: `/rrhh/vacaciones` — calendario corporativo + saldos + planificación anual (digitaliza la planilla). En Mi Espacio: saldo propio + acuse.
- **DoD:** saldo = entitlement − tomados; calendario sin superposición; PDF legal; `tsc` EXIT 0.

## Fase CH5 — Importación masiva (Módulo 2)
- Migración `0065_rrhh_recibo_import.sql` (staging). Parser de recibo (a confirmar con CH0).
- UI: carga de archivo → preview/match → commit (`rrhh_recibo_import_commit`).
- **DoD:** alta inicial del personal sin carga manual. **Depende de CH0-R1.**

## Fase CH6 — Dashboard enterprise (Módulo 9)
- Vistas/counts: dotación, activos, licencias, vacaciones pendientes, solicitudes pendientes, **ausentismo**, **rotación**, **próximos vencimientos**.
- UI: dashboard con KPIs + drill-down (estilo Tesorería/Cockpit).

## Fase CH7 — Datos productivos (operacional, autorizado)
- Seed `rrhh_vacaciones_escala` (migración).
- Carga del roster real + vacaciones 2026 (import CH5 o alta CH1) en prod.
- Activar `RBAC_ENFORCE=1` (post-seed) → enforcement RRHH efectivo.

---

## Dependencias
```
CH0 ──→ CH5 (import)        CH1 ──→ CH2,CH3,CH4 (necesitan empleados)
CH3 ──→ CH4 (firma/PDF reusados por vacaciones)    CH1..CH6 ──→ CH7 (datos+enforce)
```

## Estándar de calidad (no negociable)
- Paridad UX con Compras/OS/CRM/Tesorería (nada de pantallas vacías ni MVP pobre).
- RPC-first, saldos en la base, append-only, RLS, `tsc` EXIT 0 por fase, QA por rol (incl. URL directa + Mi Espacio aislado).

## Estimación relativa (esfuerzo)
CH1 M · CH2 S · CH3 L · CH4 XL · CH5 M (post-CH0) · CH6 M · CH7 operacional.

> Orden recomendado de ejecución: **CH1 → CH2 → CH3 → CH4 → CH6**, con CH0/CH5 en paralelo cuando lleguen recibos, y CH7 al final. Cada fase vuelve para aprobación antes de la siguiente.

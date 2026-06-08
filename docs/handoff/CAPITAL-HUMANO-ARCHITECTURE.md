# CAPITAL-HUMANO-ARCHITECTURE

**Fecha:** 2026-06-08 · **Estado:** diseño (pre-implementación). **No se escribió código de feature.**
**Regla:** construir sobre la fundación RRHH existente (R1–R6), **no** greenfield. No asumir datos; no simplificar procesos.

---

## 1. Auditoría de la fundación existente (lo que YA está)

| Capa | Existe | Detalle (verificado en migraciones 0056–0060 + código) |
|---|---|---|
| **Esquema empleados** | ✅ | `rrhh_empleados` (datos personales/laborales) + `rrhh_empleado_bancario` + `rrhh_empleado_historial`. Enums `rrhh_estado_empleado_t (activo/licencia/baja)`, `estado_civil_t`, `modalidad_contratacion_t`, `depot_t`. |
| **Esquema solicitudes** | ✅ | `rrhh_solicitudes` + `rrhh_horas_extra_detalle` + `rrhh_solicitud_eventos` + `rrhh_novedades`. Enums `solicitud_tipo_t`, `solicitud_estado_t`, `permiso_subtipo_t`, `licencia_subtipo_t`, `recargo_t`, `novedad_tipo_t`. |
| **Workflow RPC** | ✅ | `rrhh_solicitud_crear / enviar / aprobar_l1 / aprobar_l2 / rechazar / cancelar / anular` (fail-closed, append-only, auditadas; generan novedades al aprobar). |
| **Documental** | ✅ | `rrhh_documents` (versionado por `document_group_id`) + bucket Storage + `emit_rrhh_signed_url` RPC + `rrhh_document_audit`. |
| **RLS** | ✅ | R3–R5: empleado ve lo suyo, supervisor su equipo, RRHH según permiso, datos bancarios solo `rrhh.admin`/dueño. Policy INSERT en `rrhh_empleados`. |
| **App layer** | ⚠️ parcial | `lib/rrhh/data.ts` (lectura), `lib/rrhh/actions.ts` (server actions → RPC), páginas Dashboard/Empleados/Solicitudes/Novedades/Documentación/Mi Espacio, guards `canAccess(rrhh.view / mi_espacio.view)`. |
| **RBAC** | ✅ | `rrhh.{view,create,edit,export,admin}` + `mi_espacio.view` (migración 0061, este proyecto). |

### Gaps (lo que Capital Humano 1.0 debe construir)
1. **Alta/Baja/Modificación de empleados** — hay policy INSERT pero **no hay RPC ni UI de alta** (form enterprise + validaciones).
2. **Importación masiva** desde recibos de sueldo — inexistente.
3. **Motor de Vacaciones** — entitlement por antigüedad (LCT art. 150), saldo disponible/usado/pendiente, calendario, planificación, control de superposición. Hoy solo existe `rrhh_novedades` (registro), no el cálculo de saldos.
4. **Firma digital estilo OC/OS** — las solicitudes tienen eventos de aprobación (L1/L2), pero falta el **sello de integridad** (`integrity_hash` sha256 canónico + `signature_hash`) y el **PDF institucional** que sí tienen las OC.
5. **PDF institucional** de Permiso de Retiro / Inasistencia / Período de Descanso Anual (formato TOP'S/VEROTIN).
6. **Datos** — el embudo está vacío en prod (0 empleados); requiere carga inicial/import.

> **Conclusión:** ~60% de la base (esquema + workflow + RLS + documental) ya existe. CH 1.0 = **app layer + motor de vacaciones + firma/PDF + import + datos**, reusando RPCs y tablas.

---

## 2. Documentos adjuntos — análisis y reglas extraídas

| Documento | Tipo | Extracción |
|---|---|---|
| **Permiso de Retiro** | Form TOP'S | Campos: empleado, fecha, destinatario, **día de retiro**, **hora de salida**, motivo, saludo. → subtipo de solicitud `permiso · retiro`. |
| **Permiso de Inasistencia** | Form TOP'S | Campos: empleado, fecha, **día de inasistencia**, motivo, firma empleado + "Por VEROTIN S.A.". → subtipo `permiso · inasistencia`. |
| **Planilla Vacaciones 2025→2026** | Spreadsheet | Roster 17 empleados + **entitlement por antigüedad** + distribución mensual + **fraccionamiento (X+Y)** + ventana legal + aniversarios. → motor de vacaciones + seed. |
| **Período de Descanso Anual** | Form **legal** (multi-sección) | Notificación del período (días, desde–hasta inclusive) → firma empleador → acuse del empleado → certificación de goce. → PDF legal + flujo de notificación de vacaciones. |
| **Recibos de sueldo** | (mencionados) | ⚠️ **NO adjuntado ningún recibo real** → no se puede extraer su layout. Ver §Riesgos. |

### Reglas de negocio laborales extraídas (NO asumidas — del adjunto + LCT)
- **Vacaciones por antigüedad (LCT art. 150):** `<5 años → 14 días`, `5–10 → 21`, `10–20 → 28`, `>20 → 35`. (coincide con la leyenda de la planilla).
- **Ventana legal de goce:** **1° de octubre – 30 de abril** ("legalmente se pueden tomar").
- **Fraccionamiento** permitido (la planilla muestra splits como `21+28`, `7+14`, `3.5+7+14`).
- **Aniversarios** disparan recálculo de entitlement (la planilla lista quién cumple 5/10 años por año).
- **Empleador:** VEROTIN S.A. · **Marca:** TOP'S Logística · **Domicilio:** Agustín Magaldi 1765, Barracas, CABA · tel. 4302-3944/3541/9409/9117 · logisticatops.com.

### Roster real (seed de referencia — de la planilla)
Alba Cynthia, Bauer Natalia, Rodríguez José Luis, Ruth Carrasquero, Reynoso Juan, Merino Jorge, Serrano Jaime, Rodríguez Eliezer, Fernández Carlos, Martínez Víctor, Velázquez Ezequiel, Silva Manuel, Mendoza Ricardo, Iván Rodríguez, González Silvia, Juan Carlos Ojeda, Néstor Véliz (17).
> ⚠️ Las **fechas de ingreso** de la planilla están **truncadas** en la captura (años cortados). No se asumen: el import requiere la planilla fuente (xlsx) para fechas exactas (ver DATA-MODEL §seed).

---

## 3. Arquitectura objetivo (capas)

```
UI (App Router, server components + client forms)        ← UI-MAP.md
  ├─ /rrhh (dashboard)            ├─ /rrhh/empleados (alta/legajo 360)
  ├─ /rrhh/solicitudes (workflow) ├─ /rrhh/vacaciones (calendario/saldos)  ← NUEVO
  ├─ /rrhh/documentos             └─ /rrhh/mi-espacio (autoservicio)
        │ guards: canAccess(rrhh.view) / mi_espacio.view
        ▼
Server Actions (lib/rrhh/actions.ts)  ── validan permiso + Zod ──┐
        │                                                        │
        ▼                                                        ▼
RPCs Postgres (fail-closed, append-only, auditadas)      Motor de Vacaciones (TS puro, server)
  rrhh_solicitud_*  ·  rrhh_empleado_crear (NUEVO)         entitlement(antigüedad) + saldos
  rrhh_sign_solicitud (NUEVO, integrity_hash)             (deriva de novedades; no recalcula en cliente)
        │
        ▼
Tablas + Vistas (DB = fuente de verdad de saldos)  ← DATA-MODEL.md
Storage (rrhh-docs bucket, signed URLs)  ·  PDF @react-pdf (institucional)  ← WORKFLOWS.md §PDF
```

**Principios (heredados del estándar OC/OS):**
- **RPC-first:** toda transición de estado pasa por un RPC fail-closed/auditado; la UI nunca escribe estado directo.
- **Saldos en la base:** ningún saldo de vacaciones se calcula en React; se derivan en vistas/funciones SQL (igual que Tesorería D1/D5).
- **Append-only + auditoría:** `rrhh_solicitud_eventos` / `rrhh_document_audit` registran todo.
- **Firma = integridad:** `integrity_hash` (sha256 del contenido canónico) + sellos de firmante, espejando `compras/totals.ts`.

---

## 4. Roles (matriz RBAC aprobada)

| Rol | Acceso |
|---|---|
| **SUPER_ADMIN** | Total RRHH (`rrhh.*` + `sistema`). |
| **ADMIN_OPERATIVO** | Total RRHH (`rrhh.*`). |
| **GERENCIA_COMERCIAL / ADMIN_FINANZAS / JEFE_DEP_***  | **Solo Mi Espacio** (`mi_espacio.view`): su legajo, sus solicitudes, sus vacaciones, sus documentos. Nunca terceros. |
| **Supervisor** (atributo de empleado) | Aprueba L1 de su equipo (vía RLS de supervisor sobre `rrhh_solicitudes`). |
| **Director de Operaciones** | Aprueba L2 (rol funcional en el workflow). |

> Enforcement ya implementado (guards `canAccess` + RLS R3–R5 + `mi_espacio.view`); se activa con `RBAC_ENFORCE=1` post-seed.

---

## 5. Riesgos / dependencias

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **Recibo de sueldo no adjuntado** → no se puede mapear el layout real para la importación (Módulo 2). | Pedir 1–2 recibos reales; el DATA-MODEL define un schema de extracción tentativo a confirmar. **No asumir** campos. |
| R2 | Fechas de ingreso truncadas en la planilla. | Import desde el xlsx fuente; sin fechas exactas no se calcula antigüedad real. |
| R3 | Datos vacíos en prod. | Fase de carga inicial (import + alta) antes de "go-live". |
| R4 | Firma digital legal: ¿requiere firma electrónica certificada o sello de integridad interno? | CH 1.0 replica el modelo OC/OS (sello de integridad + aprobaciones); si se requiere firma certificada externa, es fase posterior. |
| R5 | El formulario "Período de Descanso Anual" es legal (LCT) con secciones de notificación/acuse/certificación. | Modelar el flujo de notificación de vacaciones (no solo el PDF). |

---

## 6. Entregables del paquete de diseño
1. **CAPITAL-HUMANO-ARCHITECTURE.md** (este).
2. **CAPITAL-HUMANO-DATA-MODEL.md** — tablas existentes + extensiones (vacaciones/firma/recibos) + reglas SQL.
3. **CAPITAL-HUMANO-WORKFLOWS.md** — solicitudes/vacaciones/permisos + firma + PDF + form legal.
4. **CAPITAL-HUMANO-IMPLEMENTATION-PLAN.md** — fases CH1..CHn, dependencias, seed/import.
5. **CAPITAL-HUMANO-UI-MAP.md** — rutas, pantallas, componentes, por rol.

> Implementación recién después de aprobar este diseño. Nada de pantallas vacías ni MVP pobre: el plan apunta a paridad con Compras/OS/CRM/Tesorería.

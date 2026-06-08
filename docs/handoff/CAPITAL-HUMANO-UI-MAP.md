# CAPITAL-HUMANO-UI-MAP

**Fecha:** 2026-06-08 · Mapa de UI. Rutas bajo `/rrhh` (App Router). Guards `canAccess` + RLS. Estilo Nexus (paridad Compras/OS/CRM/Tesorería).

---

## 1. Rutas y acceso

| Ruta | Pantalla | Permiso | Estado |
|---|---|---|---|
| `/rrhh` | Dashboard RRHH (KPIs + drill-down) | `rrhh.view` | existe → enriquecer (CH6) |
| `/rrhh/empleados` | Lista de empleados | `rrhh.view` | existe → +filtros/estado |
| `/rrhh/empleados/nuevo` | **Alta de empleado** (form enterprise) | `rrhh.edit` | **NUEVO (CH1)** |
| `/rrhh/empleados/[id]` | **Legajo 360°** (tabs) + editar/baja | `rrhh.view` (+`rrhh.admin` bancario) | existe → completar (CH1/CH2) |
| `/rrhh/empleados/importar` | **Importación masiva** (recibos) | `rrhh.admin` | **NUEVO (CH5)** |
| `/rrhh/solicitudes` | Bandeja de solicitudes (aprobación) | `rrhh.view` | existe → +firma/PDF |
| `/rrhh/solicitudes/[id]` | Detalle + timeline + acciones L1/L2 | `rrhh.view` | existe → +firma |
| `/rrhh/vacaciones` | **Calendario + saldos + planificación** | `rrhh.view` | **NUEVO (CH4)** |
| `/rrhh/novedades` | Novedades por período | `rrhh.view` | existe |
| `/rrhh/documentos` | Repositorio documental | `rrhh.view` | existe → clasificación |
| `/rrhh/mi-espacio` | **Autoservicio** (legajo/solicitudes/vacaciones/docs propios) | `mi_espacio.view` | existe → completar |

---

## 2. Pantallas clave (contenido)

### Dashboard `/rrhh` (CH6)
KPIs (cards estilo Tesorería, drill-down): Dotación · Activos · En licencia · Vacaciones pendientes · Solicitudes pendientes · Ausentismo · Rotación · Próximos vencimientos. + accesos a Empleados / Solicitudes / Vacaciones.

### Alta de empleado `/rrhh/empleados/nuevo` (CH1)
Form en secciones (no básico): **Datos personales** (nombre, apellido, DNI, CUIL, nac., domicilio, tel., email) · **Laboral** (ingreso, fecha reconocida, categoría, convenio, cargo, sector, depot, supervisor, centro de costo, modalidad, estado) · **Bancario** (RLS) · **Documentación inicial**. Validaciones Zod + unicidad DNI/CUIL.

### Legajo 360° `/rrhh/empleados/[id]` (CH1/CH2)
Tabs: Resumen · Datos · Laboral · **Vacaciones** (saldo + períodos) · **Solicitudes** (historial) · **Documentos** (con vencimientos) · **Historial** (auditoría) · Bancario (`rrhh.admin`). Acciones: editar, baja (motivo).

### Vacaciones `/rrhh/vacaciones` (CH4)
- **Calendario corporativo** (mes/depot, control de superposición visual).
- **Tabla de saldos** (por empleado: correspondientes/tomados/disponibles/planificados).
- **Planificación anual** (digitaliza la planilla: fraccionamiento X+Y, medio día) → `rrhh_vacaciones_planificar`.
- Acción **Notificar** → PDF "Período de Descanso Anual".

### Solicitudes `/rrhh/solicitudes` + `[id]` (CH3)
Bandeja filtrable (estado/tipo/empleado) · Detalle con **timeline** (`eventos`), botones **Aprobar L1/L2 / Rechazar** (según rol), **firma** + **PDF** + descarga.

### Mi Espacio `/rrhh/mi-espacio` (CH3/CH4)
Tabs: Mi legajo · **Nueva solicitud** (Vacaciones/Retiro/Inasistencia/Llegada tarde/Licencia/Especial) · Mis vacaciones (saldo + acuse de notificación) · Mis documentos. Sólo datos propios (RLS).

### Importación `/rrhh/empleados/importar` (CH5)
Carga de recibos → preview/match (staging `rrhh_recibo_import`) → commit. *(parser depende de CH0).*

---

## 3. Componentes nuevos
- `lib/rrhh/pdf/` (espejo de `compras/pdf/`): `PermisoRetiroPdf`, `PermisoInasistenciaPdf`, `PeriodoDescansoAnualPdf`, `SolicitudGenericaPdf` + header institucional TOP'S/VEROTIN.
- `components/rrhh/`: `EmpleadoForm`, `LegajoTabs`, `VacacionesCalendar`, `SaldoVacacionesTable`, `SolicitudForm` (por tipo), `AprobacionTimeline`, `FirmaBadge`, `RrhhKpi` (drill-down).
- Reuso: `AccesoRestringido`, `ModuleUnavailable`, `StatusPill`, `Kpi` (tesorería ui), `CountUp`, `Icon`.

## 4. Formularios → mapeo a tipo/subtipo (de los adjuntos)
| Form institucional | Pantalla origen | tipo/subtipo |
|---|---|---|
| Permiso de Retiro | Mi Espacio → Nueva solicitud | `permiso/retiro` (día + hora salida + motivo) |
| Permiso de Inasistencia | idem | `permiso/inasistencia` (día + motivo) |
| Solicitud de Vacaciones | Mi Espacio → Vacaciones | `vacaciones` + período(s) |
| Período de Descanso Anual | `/rrhh/vacaciones` (RRHH notifica) | PDF legal 3-secciones |

## 5. Responsive / dark mode
- Todas las pantallas: tokens Nexus (`bg-bg-surface-alt`, `text-fg-link`, `tops-blue-*`), tablas `overflow-x-auto`, calendario responsive (grid → lista en mobile), modales vía portal (patrón CCTV/mapas).

---

> Este mapa es la guía de construcción de las fases CH1–CH6 (ver IMPLEMENTATION-PLAN). Sin pantallas vacías: cada ruta entrega función real o no se publica.

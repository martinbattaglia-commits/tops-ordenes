# CAPITAL-HUMANO — CH1 IMPLEMENTATION REPORT (Legajo Digital · Alta)

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Sobre la fundación R1–R6 (sin greenfield).
**Aprobado:** CH1 (Legajo), CH2 (Documentación), CH3 (Solicitudes+Firma+PDF). CH5 (import) en espera de recibos/Excel.

---

## Entregado en este slice: CH1 · Alta de empleado

Funcional **sin migración nueva**: usa la tabla `rrhh_empleados` y su **policy INSERT** ya existente (migración 0058) bajo la sesión (RLS). Unicidad DNI/CUIL la garantizan las constraints de la base.

| Componente | Archivo | Detalle |
|---|---|---|
| Validación | `src/lib/rrhh/validation.ts` | `empleadoCrearSchema` (Zod): obligatorios apellido_nombre/dni/cuil/fecha_ingreso + opcionales (personales/laborales). |
| Server action | `src/lib/rrhh/actions.ts` | `crearEmpleado(input)` → `guard("rrhh.edit")` → insert en `rrhh_empleados` (RLS) → `mapRrhhError` (unicidad) → revalida. |
| Form enterprise | `src/components/rrhh/EmpleadoForm.tsx` | 2 secciones (Datos personales / Laborales), selects de enums reales (estado_civil, modalidad, depot), validación client + server, manejo de error. |
| Página | `src/app/(app)/rrhh/empleados/nuevo/page.tsx` | guard `rrhh.edit` → `AccesoRestringido` si no. |
| Acceso | `src/app/(app)/rrhh/empleados/page.tsx` | botón **"Nuevo empleado"** visible solo con `rrhh.edit`. |

**Campos del alta** (esquema real 0058): apellido_nombre, dni, cuil, fecha_nacimiento, domicilio, teléfono, email_personal, estado_civil · fecha_ingreso, **fecha_reconocida** (base de antigüedad → vacaciones), categoría, sección, convenio, modalidad_contratación, depósito, obra_social. `public_id` (nº legajo) автоasignado por secuencia; `estado=activo` por default.

### Validaciones
- `tsc --noEmit` EXIT 0.
- `/rrhh/empleados` y `/rrhh/empleados/nuevo` → 307 (login; recompilan sin 500).
- Guard `rrhh.edit` en página + acción (defensa en profundidad); dormido hasta `RBAC_ENFORCE=1` (no rompe hoy).
- Alta efectiva: inserta empleado real (visible en lista/dashboard) — la verificación logueada la confirma quien tenga `rrhh.edit`.

---

## Estado del roadmap CH (transparente)

| Fase | Estado |
|---|---|
| **CH1 · Alta** | ✅ **implementado** (este slice) |
| CH1 · Baja / Modificación | ⏳ siguiente slice (RPC `rrhh_empleado_actualizar/baja` + edición en legajo 360°) |
| CH1 · Consulta (Legajo 360°) | ✅ ya existe (`/rrhh/empleados/[id]`) → enriquecer con tabs (vacaciones/solicitudes/docs) |
| **CH2 · Documentación** | ⏳ pendiente (subida/clasificación a `rrhh_documents` + vencimientos) |
| **CH3 · Solicitudes + Firma + PDF** | ⏳ pendiente (workflow ya existe; falta `integrity_hash`/firma + PDF institucional `@react-pdf`) |
| CH4 · Vacaciones | ⏳ (motor escala/saldo/calendario) — ver IMPLEMENTATION-PLAN |
| CH5 · Importación | ⛔ en espera de **recibos reales + Excel de vacaciones** |
| CH6 · Dashboard | ⏳ |
| CH7 · Datos + enforce | operacional |

> **Por qué por slices:** CH1–CH3 juntos son un build grande; entregar por incrementos verificables (cada uno con `tsc` + QA) mantiene calidad enterprise y permite tu revisión. Mantengo la arquitectura aprobada (ARCHITECTURE/DATA-MODEL/WORKFLOWS/UI-MAP).

---

## Próximo paso sugerido
Continuar CH1 (Baja/Modificación + legajo 360° con tabs) → CH2 (Documentación) → CH3 (Firma+PDF). Confirmás y sigo; o priorizás otro slice.

> Sin commit/push. CH5 retomará cuando envíes los recibos de sueldo y el Excel de vacaciones (no asumir datos).

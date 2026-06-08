# TOPS NEXUS — RRHH · Resumen Ejecutivo

> **Para:** Dirección · **Fecha:** 2026-06-07 · **Estado:** Diseño congelado, pendiente de aprobación.
> Documento técnico completo: [`RRHH_ARCHITECTURE_DESIGN.md`](RRHH_ARCHITECTURE_DESIGN.md)

---

## Objetivo

Cerrar el ciclo operativo de TOPS Nexus con el último gran módulo: **Recursos Humanos**.
Reemplazar la gestión manual actual (papel, Excel, PDFs sueltos, control manual de
vacaciones/permisos/licencias) por un sistema **enterprise** (nivel SuccessFactors /
Workday / BambooHR) adaptado a una operación logística 3PL argentina. No es digitalizar
formularios: es rediseñar el proceso con **legajo digital, workflow y trazabilidad total**.

## Alcance

**Sí hace:** legajo digital · motor de ausencias (vacaciones/permisos/licencias) con
aprobación multinivel · novedades del período · repositorio de recibos · calendario de
cobertura · portal del empleado · dashboard ejecutivo · reportería.

**No hace (límite duro):** **no liquida sueldos**, no reemplaza el sistema contable, no
calcula impuestos. Produce el insumo limpio (novedades) y guarda el resultado (recibo PDF).

Construido 100% sobre la arquitectura productiva real de Nexus (RBAC, seguridad y patrones
existentes). Fuente de verdad única: el Supabase oficial de producción.

## Módulos (9)

1. **Dashboard RRHH** — vista ejecutiva con KPIs y alertas.
2. **Empleados / Legajo** — fuente de verdad del empleado (personal, laboral, bancario, doc.).
3. **Vacaciones** — saldos automáticos por antigüedad (Ley 20.744: 14/21/28/35 días).
4. **Permisos** — inasistencia, llegada tarde, retiro, médico, estudio, etc.
5. **Licencias** — enfermedad, ART, maternidad/paternidad, especiales, sin goce.
6. **Novedades** — registro central del período (núcleo de una liquidación futura).
7. **Recibos** — repositorio documental (consulta, descarga, auditoría).
8. **Calendario corporativo** — cobertura operativa por depósito y sección.
9. **Reportes** — ausentismo, vacaciones, antigüedad, dotación, horas extra.

## Roadmap

Implementación por etapas ("gates"), **nada arranca sin aprobar este diseño**:

| Fase | Foco |
|------|------|
| **R0** | Aprobación del diseño |
| **R1–R4** | Base: RBAC, legajo digital, backend y portal mínimo |
| **R5–R7** | Motor de ausencias, workflow de aprobación y calendario |
| **R8** | Repositorio de recibos |
| **R9** | Dashboard ejecutivo y reportes |
| **R10** | Hardening de seguridad y datos personales |

El legajo (R1–R3) es la base de todo; ausencias y recibos se paralelizan luego.

## Riesgos principales

1. **PII masiva** (DNI/CUIL, CBU, datos de salud) — riesgo central, legal (Ley 25.326).
   Mitigado por separación de datos, acceso auditado y permisos segregados.
2. **Datos de salud** (licencias/ART) — categoría especial; acceso restringido y reforzado.
3. **Recibo PDF** = CUIL + cuenta bancaria + sueldo + firma en un archivo → almacenamiento
   privado, descarga auditada, sin exposición pública.
4. **No liquidar**: mantener el límite de alcance para evitar riesgo contable/legal.
5. **Trazabilidad**: todo registro es inmutable (append-only) para soporte legal.

---

### Decisión requerida de Dirección

**Aprobar (o ajustar) el diseño congelado** para habilitar el inicio de la Fase R1.
Hasta esa aprobación: cero implementación, cero cambios en producción.

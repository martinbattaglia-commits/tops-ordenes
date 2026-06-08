# TOPS NEXUS — RECURSOS HUMANOS (RRHH)
## Paquete Ejecutivo de Autorización — Apertura de R1

> **Para:** Dirección — Logística TOPS (Verotin S.A.)
> **De:** Equipo de Arquitectura TOPS Nexus
> **Fecha:** 2026-06-07 · **Decisión requerida:** autorizar o rechazar la apertura de **R1**.
> **Documentos de respaldo:** diseño congelado (`RRHH_MASTER_ARCHITECTURE_v2_0.md`) y plan de
> apertura (`RRHH_R1_IMPLEMENTATION_PLAN.md`).

---

## 1. Resumen ejecutivo

**Qué es RRHH.** El módulo de Recursos Humanos de TOPS Nexus: legajo digital de empleados,
gestión de vacaciones, permisos, licencias, horas extra, repositorio de recibos, calendario de
cobertura operativa, portal del empleado y tablero de indicadores para Dirección.

**Por qué se desarrolla.** Hoy RRHH se gestiona con papel, planillas Excel y PDFs sueltos, con
control manual de vacaciones, permisos y licencias. Es lento, propenso a errores y sin trazabilidad.

**Qué problema resuelve.** Centraliza la información del personal en un sistema único, seguro y
auditable, con flujos de aprobación claros y datos confiables para decidir.

**Qué procesos elimina.** Formularios físicos, planillas Excel paralelas, carpetas físicas, y el
seguimiento manual de saldos de vacaciones, permisos y licencias.

> **Importante:** RRHH **no liquida sueldos** ni reemplaza al sistema contable. Organiza la
> información y conserva los recibos; la liquidación sigue haciéndose donde se hace hoy.

---

## 2. Estado del proyecto

```text
Diseño:          COMPLETO
Auditoría:       COMPLETA  (incluyó detección y corrección de 2 problemas reales)
Arquitectura:    APROBADA Y CONGELADA
Implementación:  NO INICIADA
```

El diseño pasó por un ciclo exhaustivo de auditorías independientes que encontraron y corrigieron
dos riesgos importantes (uno de privacidad de datos, otro de seguridad de accesos) **antes** de
escribir una sola línea de código. El resultado final quedó sin observaciones críticas ni mayores.

---

## 3. Alcance de R1 (qué se autoriza ahora)

**R1 NO implementa el módulo RRHH.** R1 es el primer paso fundacional, mínimo y aislado: **dar de
alta el dominio “RRHH” dentro del sistema de permisos** de Nexus. Nada más.

- No crea pantallas, ni datos, ni carga empleados.
- No mueve información de nadie.
- Habilita que, en etapas siguientes, se puedan construir las funciones reales sobre una base segura.

Pensar R1 como **“abrir el casillero” del módulo** en el sistema de seguridad — todavía vacío.

---

## 4. Riesgo operativo

> **Nivel: BAJO.**

Fundamento objetivo:
- R1 es un cambio **aditivo** y reversible en la práctica: agrega una opción nueva sin tocar datos,
  pantallas ni procesos existentes.
- No afecta CRM, Tesorería (ERP-A), Cuentas a Pagar (ERP-B), Operaciones ni Compliance.
- Se aplica de forma **controlada**, con respaldo (backup) verificado, ventana acordada y un único
  responsable, siguiendo el mismo procedimiento ya usado con éxito en Tesorería.

El único riesgo relevante es operativo (intervenir producción), y está cubierto por el checklist
previo obligatorio.

---

## 5. Impacto en producción

**Qué cambia:**
- Se agrega “RRHH” como módulo reconocido por el sistema de permisos. (Cambio invisible para el
  usuario final.)

**Qué NO cambia:**
- Ningún dato existente. Ninguna pantalla. Ningún proceso actual. Ningún otro módulo.

**Usuarios afectados:** ninguno de forma perceptible. Nadie ve una función nueva tras R1.

**Usuarios NO afectados:** todos los actuales (CRM, Tesorería, Operaciones, etc.) siguen igual.

---

## 6. Roadmap ejecutivo

```text
R1  Alta del módulo RRHH en el sistema de permisos (este paso)
R2  Legajo digital del empleado (datos personales, laborales, bancarios — seguros)
R3  Motor interno del legajo (altas, bajas, modificaciones controladas)
R4  Portal del empleado (cada uno ve y gestiona lo suyo)
R5  Vacaciones, permisos, licencias y horas extra (registro y saldos)
R6  Flujos de aprobación (empleado → supervisor → RRHH)
```
*(Etapas posteriores: calendario de cobertura, recibos, tablero ejecutivo y reportes.)*

Cada etapa se entrega, audita y cierra antes de pasar a la siguiente — el mismo método con el que se
entregó Tesorería.

---

## 7. Recomendación

> ## Recomendación profesional: **GO**

Fundamento:
- El diseño está **aprobado y congelado**, con la privacidad de datos (DNI, CUIL, datos bancarios,
  recibos, salud) y la seguridad de accesos resueltas y verificadas contra patrones ya probados en
  producción.
- R1 es de **riesgo bajo** y **alto valor de habilitación**: desbloquea todo el desarrollo posterior
  sin impacto en los usuarios actuales.
- Demorar R1 no reduce riesgo (el paso es mínimo) y posterga los beneficios (eliminar papel, Excel y
  control manual).

---

## 8. Decisión requerida

```text
Dirección debe autorizar
o rechazar
la apertura de R1.
```

- **Si autoriza:** se ejecuta R1 (alta del módulo) de forma controlada y se reporta su cierre antes
  de planificar R2.
- **Si rechaza o pospone:** el dominio permanece congelado, listo, sin cambios en producción.

> La implementación **solo** comenzará con esta autorización explícita. Hasta entonces: cero cambios
> en producción.

---

```text
STATUS

AWAITING EXECUTIVE DECISION
```

*Paquete ejecutivo — sin implementación, sin migraciones, sin código, sin cambios en producción.*

# TOPS NEXUS — RRHH · AUDITORÍA FINAL (FASE R0 CLOSURE)

> **Tipo:** Auditoría documental (solo lectura). **No** se implementó, modificó, corrigió
> ni se crearon migraciones/código. Sin commits, sin PR, sin impacto en producción.
> **Alcance auditado:** `docs/handoff/RRHH_ARCHITECTURE_DESIGN.md` + `RRHH_EXECUTIVE_SUMMARY.md`,
> cruzados contra el código real de Nexus.
> **Fuente de verdad:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07. **Auditor:** Claude Code.

---

## 1. Resumen ejecutivo

El diseño de RRHH es **sólido, coherente con la arquitectura de Nexus y no invasivo** de
los dominios existentes (CRM, ERP-A, ERP-B, Operaciones, Compliance). Respeta los patrones
vivos en producción (RPC-First, RBAC, RLS≤RBAC, append-only, auditoría, vistas derivadas,
workflow explícito) y trata la PII como preocupación central, alineado con la Ley 25.326.

Sin embargo, la auditoría cruzada **contra el código real** revela un conjunto acotado de
inconsistencias y omisiones que deben resolverse **antes de iniciar R1**. Ninguna obliga a
rediseñar la arquitectura; son correcciones de alcance puntual (renumeración, reutilización
de infraestructura existente, completar entidades y estados).

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Críticos | **0** |
| 🟠 Mayores | **6** |
| 🟡 Menores | **7** |

**Veredicto:** `REQUIRES DESIGN CORRECTIONS` (correcciones acotadas, sin rediseño estructural).
Resueltos los 6 mayores → el módulo pasa a `ARCHITECTURE READY`. Ver §7.

### Tabla de resultados por verificación solicitada

| # | Verificación | Resultado |
|---|--------------|-----------|
| 1 | Consistencia arquitectónica / no invasión de dominios | ✅ **Conforme** — self-contained, sin invadir CRM/ERP-A/ERP-B/Operaciones/Compliance |
| 2 | Patrones Nexus (RPC-First, RBAC, RLS≤RBAC, append-only, auditoría, vistas, workflow) | ✅ **Conforme** |
| 3 | Modelo de datos | 🟠 Gaps: entidad faltante (horas extra), redundancia menor en historial |
| 4 | Seguridad y PII (Ley 25.326) | ✅ Fuerte · 🟡 acceso `compliance` a salud sin base documentada |
| 5 | Workflow (estados/transiciones) | 🟠 Cancelación/anulación incompleta (solo desde `aprobada`) |
| 6 | Portal del empleado | ✅ **Conforme** — own-only por RLS, alcance correcto |
| 7 | Dashboard ejecutivo (KPIs con fuente) | 🟠 Ausentismo y alerta de documentación sin fuente de datos completa |
| 8 | Roadmap (orden/dependencias) | 🟠 Numeración de migraciones no monotónica |

---

## 2. Hallazgos críticos (🔴)

**Ninguno.** No se detectaron fallas que comprometan la integridad arquitectónica, la
seguridad de la PII ni que obliguen a rediseñar. La ausencia de hallazgos críticos es, en
sí, una señal de que el diseño base es apto. Los bloqueos para implementar son los mayores
del §3.

---

## 3. Hallazgos mayores (🟠) — resolver antes de R1

### M1 · Duplicación del módulo documental existente
**Evidencia:** ya existe `src/lib/documental/` (`data.ts`, `storage.ts`) sobre la tabla
real `documents` (migración `0010_documents.sql`), con **bucket privado, hash SHA-256, path
canónico y signed URLs** (`src/lib/documental/storage.ts`). Su `DocType` ya incluye
`"Contrato"`, `"Habilitación"`, `"Capacitación"`.
**Problema:** el diseño (§2.3, §3.1 `rrhh_documentos`) propone **tablas y buckets nuevos**
(`rrhh-documentos`) y reinventa la emisión de signed URLs y la auditoría de acceso —
funcionalidad que ya existe y está probada en producción. Viola "no duplica funcionalidades
existentes" (verificación #1) y "reutilizar, no reinventar" (su propia recomendación #5).
**Acción:** decidir explícitamente reutilizar/extender `documental` (p.ej. `documents`
+ asociación a `rrhh_empleados`, o un tipo de documento RRHH) vs. crear estructura paralela,
con justificación. Idealmente reutilizar el helper de storage/signed-URL existente.

### M2 · Colisión de roles y sistema de roles dual no reconocido
**Evidencia:** coexisten **dos sistemas de rol** en producción:
- Enum legacy `user_role_t` = `('admin','operaciones','supervisor','cliente')` (`0001_init.sql:23`),
  usado en `profiles.role`.
- RBAC por tabla `roles` (slug) sembrada en `0009_rbac.sql` (7 roles: `director_ops`, `admin`,
  `comercial`, `operaciones`, `seguridad`, `compliance`, `cliente_b2b`).

**Problema:** el diseño (§5.2) propone un rol **`supervisor`** como "nuevo", pero `supervisor`
**ya existe** como valor del enum `user_role_t`, y **no** existe en la tabla RBAC. El doc
hedge ("`supervisor` es atributo derivable y/o rol RBAC — se decide en gate") no menciona la
colisión con el enum legacy ni aclara que los roles nuevos (`rrhh_admin`, `rrhh_analista`)
deben vivir como **filas de la tabla `roles`** (no como valores de `user_role_t`).
**Acción:** disambiguar el modelo de roles: confirmar que RRHH extiende el RBAC de tabla;
resolver el solapamiento de nombre `supervisor`; documentar que `supervisor` se modela como
`rrhh_empleados.supervisor_id` (jerarquía) y que la autorización L1 se evalúa por pertenencia
de equipo, no por un rol homónimo ambiguo.

### M3 · Roadmap: numeración de migraciones no monotónica
**Evidencia:** §8 asigna a **R1** las migraciones `0056` (enum) **y `0060`** (RBAC seed), y a
**R2** la `0057` (core). Las migraciones se aplican en orden numérico estricto.
**Problema:** no se puede desplegar `0060` en R1 antes de que existan `0057`–`0059` (R2/R5).
El mapeo gate→migración es contradictorio.
**Acción:** renumerar — el seed RBAC debería ser `0057` (justo tras el enum, no depende de las
tablas core), corriendo el resto; o aceptar explícitamente que los gates no mapean a rangos
contiguos y que las migraciones son globalmente monotónicas independientemente del gate.

### M4 · Entidad faltante: captura de Horas Extra
**Evidencia:** el flujo (§1.2) muestra una caja **"HORAS EXTRA"** alimentando Novedades, y
`rrhh_novedades.tipo` incluye `hora_extra` (§3.4). Pero `rrhh_solicitudes.tipo` solo admite
`vacaciones`/`permiso`/`licencia` (§3.3) y **no hay tabla ni workflow** que capture/apruebe
horas extra.
**Problema:** las horas extra entran a Novedades "desde la nada". Para un núcleo de liquidación
futura, la hora extra es de las novedades más sensibles a controlar.
**Acción:** definir la entidad/flujo de captura de horas extra (¿solicitud? ¿carga directa por
supervisor/RRHH con aprobación? ¿origen de fichaje?) y su trazabilidad.

### M5 · KPI de ausentismo sin fuente de datos completa
**Evidencia:** Dashboard (§6) y vista `rrhh_v_ausentismo` calculan **"% sobre días hábiles"**.
El modelo solo tiene `rrhh_feriados`; **no hay calendario laboral / turnos por empleado**.
**Problema:** en una operación 3PL con turnos y part-time, el denominador "días hábiles del
empleado" no es derivable solo de feriados. El KPI que verá Dirección puede ser incorrecto
o incalculable. Incumple verificación #7 ("cada KPI debe poder calcularse, no depender de
información inexistente").
**Acción:** definir la fuente del denominador (jornada/turno por empleado o convención de
días hábiles documentada) o redefinir el KPI a una base efectivamente disponible.

### M6 · Workflow: cancelación/anulación incompleta (estados inconsistentes)
**Evidencia:** la máquina de estados (§4.1) solo permite **anulación desde `aprobada`**. Pero
existe el permiso `rrhh:solicitud.cancel` (§5.3) y el requerimiento original pide
explícitamente "cancelaciones".
**Problema:** no hay transición para que el empleado **cancele un `borrador` o una solicitud
`pendiente_supervisor`/`pendiente_rrhh`** antes de aprobarse, ni para "devolver para
corrección". El permiso `cancel` queda sin transición que lo ejerza → estado inconsistente.
**Acción:** completar la máquina: definir `cancelada` (por el solicitante) desde
`borrador`/`pendiente_*`, y opcionalmente una devolución `pendiente_* → borrador`.

---

## 4. Hallazgos menores (🟡)

| # | Hallazgo | Acción sugerida |
|---|----------|-----------------|
| m1 | `depot` (§3.1) descrito como "enum (MAGALDI/LUJAN)" — riesgo de redefinir. Ya existe `public.depot_t` (`0001_init.sql:9`). | Aclarar reutilización de `public.depot_t`, no nuevo enum. |
| m2 | Alerta dashboard "documentación vencida/faltante" (§6) sin soporte: `rrhh_documentos` no tiene `vence_el` ni catálogo de docs requeridos por empleado. | Agregar campos/catálogo o quitar la alerta del alcance. |
| m3 | `rrhh_empleado_historial` (§3.1) dice rastrear "ausencias, licencias", que ya viven en `rrhh_solicitudes`/`rrhh_novedades`. | Limitar el historial a atributos de legajo (categoría, remuneración, supervisor, sección). |
| m4 | `rrhh_solicitudes.cantidad_dias` se almacena y a la vez se marca "derivable" (§3.3), en tensión con "cálculo en vistas, no almacenado". | Definir si es snapshot inmutable (justificado) o derivado en vista. |
| m5 | Acceso de `compliance` a datos de salud marcado como "excepción" (§5.4) sin base legal/proceso documentado. | Documentar base legal, registro y proceso de excepción (Ley 25.326). |
| m6 | Roles nuevos (`rrhh_admin`, `rrhh_analista`) no aclaran que son filas de la tabla `roles` (slug), no valores de `user_role_t`. | Explicitar el mecanismo (INSERT en `roles` + `role_permissions`, como `0009`). |
| m7 | Variante "licencia entra directo a `pendiente_rrhh`" (§4.2) no figura como arista en el diagrama de estados (§4.1). | Reflejar la entrada alternativa en la máquina de estados. |

---

## 5. Riesgos

Se confirma la tabla de riesgos del diseño (§9), bien construida (PII, salud, recibo,
liquidación, trazabilidad). La auditoría **añade** los siguientes riesgos detectados:

| # | Riesgo (descubierto en auditoría) | Impacto | Origen |
|---|-----------------------------------|---------|--------|
| A1 | **Fork de documentos**: convivencia de `documents` (documental) y `rrhh_documentos` → dos repositorios, dos políticas de acceso, doble superficie de fuga de PII. | Alto (seguridad + mantenimiento) | M1 |
| A2 | **Ambigüedad de autorización por rol dual** (`user_role_t` vs RBAC table + colisión `supervisor`) → riesgo de bypass o de denegación incorrecta en aprobaciones. | Alto (seguridad/autorización) | M2 |
| A3 | **KPI de ausentismo erróneo a Dirección** por denominador no disponible → decisiones sobre datos incorrectos. | Medio (decisión ejecutiva) | M5 |
| A4 | **Horas extra sin control de origen** → novedad de liquidación no trazable a una aprobación. | Medio (control interno) | M4 |
| A5 | **Despliegue roto** si se implementa el roadmap con la numeración tal cual. | Medio (operativo, fácil de evitar) | M3 |

---

## 6. Recomendaciones

1. **Emitir un addendum al `RRHH_ARCHITECTURE_DESIGN.md`** (v1.1) resolviendo los 6 mayores.
   No requiere reescribir el documento; son secciones acotadas (§2.3/§3.1 documentos,
   §5 roles, §8 roadmap, §3.3/§3.4 horas extra, §4 workflow, §6 KPI ausentismo).
2. **Decidir reutilización del módulo `documental`** antes de R2/R3 (M1). Evita un segundo
   repositorio de PII y aprovecha SHA-256 + signed URLs ya probados.
3. **Cerrar el modelo de roles** (M2): confirmar RBAC-por-tabla como sistema único para RRHH,
   resolver `supervisor`, documentar que los roles nuevos se siembran como `0009`.
4. **Renumerar el roadmap** (M3): seed RBAC inmediatamente tras el enum; resto monotónico.
5. **Definir captura de horas extra** (M4) y **la fuente del denominador de ausentismo** (M5)
   — ambos condicionan Novedades y el Dashboard.
6. **Completar la máquina de estados** con cancelación pre-aprobación (M6).
7. **Resolver los menores** en el mismo addendum (especialmente m1 `depot_t`, m5 acceso de
   compliance a salud, m6 mecanismo de roles).
8. **Mantener el congelamiento**: ningún gate (R1+) arranca hasta aprobar el addendum.

---

## 7. Veredicto final

> ## `REQUIRES DESIGN CORRECTIONS`

El diseño base es **arquitectónicamente apto y no invasivo**: conforme en consistencia con
Nexus (RPC-First, RBAC, RLS≤RBAC, append-only, auditoría, vistas, workflow), en separación de
dominios, en portal del empleado y en el enfoque PII-first. **Cero hallazgos críticos.**

No alcanza aún el sello `ARCHITECTURE READY` por **6 hallazgos mayores** —todos puntuales y
sin necesidad de rediseño estructural— que tocan: duplicación con el módulo `documental` (M1),
ambigüedad del modelo de roles dual (M2), numeración de migraciones del roadmap (M3), entidad
faltante de horas extra (M4), fuente del KPI de ausentismo (M5) y completitud del workflow de
cancelación (M6).

**Condición de paso a `ARCHITECTURE READY`:** addendum v1.1 que resuelva los 6 mayores y,
preferentemente, los 7 menores. Estimación: trabajo de diseño acotado, sin código. Una vez
aprobado el addendum, el módulo queda habilitado para iniciar la Fase R1.

---

*Fin de la auditoría. Solo lectura — no se modificó el diseño ni se tocó producción.*
*Próximo paso sugerido: addendum de diseño v1.1 (requiere aprobación explícita; esta auditoría no lo genera).*

# TOPS NEXUS — RRHH · FINAL RE-AUDIT REPORT (ABSOLUTE FINAL GATE)

> **Tipo:** auditoría definitiva, adversarial, solo lectura. Verificación contra código,
> migraciones y arquitectura reales — no contra los documentos.
> **Autoridad:** este gate puede cerrar el dominio RRHH.
> **No** se modificó documentación, no se implementó, no se migró, no se commiteó, sin impacto
> en producción.
> **Insumos:** diseño v1.0 + addenda v1.1/v1.2 + auditorías previas (`RRHH_AUDIT_REPORT.md`,
> `RRHH_CLOSURE_AUDIT_REPORT.md`).
> **Fuente de verdad:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07. **Auditor:** Claude Code.

---

## 1. Executive Summary

El Addendum v1.2 **resuelve correctamente la fuga de PII** que tumbó la auditoría de cierre: los
documentos laborales pasan a un almacén dedicado (`rrhh_documents`/`rrhh_receipts`, buckets
`rrhh-*`) con RLS de **propiedad + `has_permission`** y acceso por RPC auditada — el patrón de
aislamiento de PII ya probado por Custody. **F1, F2, F3, F5, F6, F7 y F8 pasan.**

Sin embargo, la verificación adversarial del **único camino de acceso a los recibos** (la RPC de
signed URL) descubre un **hallazgo mayor abierto en F4**, respaldado por código real:

1. **Falta el mandato de guard fail-closed.** `has_permission(slug) = exists(...) OR
   current_role()='admin'` devuelve **NULL** cuando el usuario no tiene `profiles.role`
   (`0055_treasury_security_fix.sql:7-12`). Entonces `if not has_permission(...)` evalúa
   `not NULL = NULL` → **el guard no dispara → FAIL-OPEN**. Este es exactamente el bug que requirió
   el **hotfix de seguridad 0055 en Tesorería**. v1.2 **nunca** exige el patrón corrector
   `coalesce(has_permission(...), false)`. Una RPC de recibos implementada al pie de la letra
   podría reproducir el fail-open → **exposición de recibos a usuarios sin rol**.
2. **El precedente que v1.2 manda "espejar" contradice su propia regla.** v1.2 §4.1 prohíbe
   `current_role()`. Pero la RPC que cita como modelo, `emit_custody_signed_url`
   (`0037_custody_storage.sql:141-167`), autoriza con **`current_role()`** (`v_role not in
   ('admin','supervisor')`), **no** con `has_permission`. "Mirror custody" y "prohibido
   current_role()" son instrucciones mutuamente inconsistentes; seguir la primera reintroduce la
   dependencia legacy que toda la remediación buscó eliminar. Además, **no existe en el repo ningún
   precedente de RPC de signed URL basada en `has_permission`** — el implementador no tiene patrón
   correcto de referencia, y v1.2 no lo provee.

Por la regla de aprobación ("un solo hallazgo crítico o mayor abierto ⇒ REQUIRES ADDITIONAL DESIGN
WORK"), **no se puede otorgar `ARCHITECTURE READY`**. Está a **una corrección puntual** de lograrlo
(ver §4): el modelo de seguridad de v1.2 es correcto; falta blindar explícitamente la capa RPC.

---

## 2. Resultado F1–F8

| Control | Estado |
|---------|--------|
| F1 — PII | **PASS** |
| F2 — RBAC | **PASS** (con observación) |
| F3 — Storage | **PASS** |
| F4 — RPC | **FAIL** 🟠 |
| F5 — Workflow | **PASS** |
| F6 — KPI | **PASS** |
| F7 — Roadmap | **PASS** |
| F8 — Separación de dominios | **PASS** |

---

## 3. Detalle por control

### F1 — PII · **PASS**
Recibos, CUIL, CBU, documentación médica y laboral viven en almacén RRHH dedicado
(`rrhh_documents`/`rrhh_receipts`/buckets `rrhh-*`), fuera de `documents` (v1.2 §2). La RLS de
tablas usa propiedad + `has_permission` (v1.2 §4.2); en cláusula `USING`, `has_permission` NULL se
trata como "no visible" → **lectura de tablas fail-closed**. Salud aislada en `rrhh-health`.
> Observación: la regla "prohibido `current_role()`" debería declararse explícitamente también para
> las **tablas de PII estructurada** (`rrhh_empleados.dni/cuil`, `rrhh_empleado_bancario.cbu`), no
> solo para las tablas de documentos. Intención clara (M2), redacción a extender. (Menor.)

### F2 — RBAC · **PASS** (con observación)
v1.2 §4.1 mandata `has_permission` + propiedad y prohíbe `current_role()`. Roles RRHH son filas en
`roles` (no `user_role_t`); sin colisión de slugs; sin rol `supervisor`.
> Observación: `has_permission` internamente hace `... OR current_role()='admin'`
> (`0009_rbac.sql:174`) — bypass de admin **por diseño** y universal en Nexus (aceptable: admin =
> superusuario). No constituye exposición a `operaciones`/`supervisor`. La dependencia problemática
> de `current_role()` aparece en la capa RPC (ver F4), no en el modelo de permisos.

### F3 — Storage · **PASS**
Buckets `rrhh-receipts`/`rrhh-legajo`/`rrhh-health` (nombres libres; verificado: existen
`documents`, `custody-pii`, `treasury`, etc., ninguno `rrhh-*`). No se reutiliza el bucket
`documents` ni sus policies. Centro Documental (`listDocs` sobre `documents`) **no** alcanza las
tablas `rrhh_*` → sin exposición. (v1.2 §2, §3, §5.)

### F4 — RPC · **FAIL** 🟠
El acceso a recibos depende de una RPC tipo `emit_rrhh_signed_url`. Dos defectos abiertos,
ambos verificables en código:
- **F4-a (mayor):** ausencia de mandato fail-closed. `has_permission` puede devolver NULL →
  `if not has_permission(...)` = fail-open (`0055_treasury_security_fix.sql:7-12`). v1.2 no exige
  `coalesce(has_permission(...), false)`. → riesgo de emisión de signed URL de recibos a usuarios
  sin rol.
- **F4-b (mayor, compuesto):** el precedente citado para "espejar", `emit_custody_signed_url`
  (`0037_custody_storage.sql:141-167`), autoriza con `current_role()` — **lo que v1.2 prohíbe**.
  Instrucción contradictoria; sin precedente correcto (`has_permission`-based) en el repo.
- **Mitigante parcial:** la RLS de tablas es fail-closed; pero el storage de v1.2 **no** tiene
  policy de lectura directa → el binario del recibo se obtiene **solo** por la RPC. Si la RPC falla
  abierta, el control colapsa. Por eso el defecto es mayor, no menor: es el **único** portón del
  PDF.
> Para PASS: v1.2 debe (1) exigir guards `coalesce(has_permission(...), false)` en toda RPC RRHH,
> citando 0055; (2) aclarar que "mirror custody" es por **estructura** (autoriza + audita + grant),
> y que la **autorización** usa `has_permission` + propiedad, **no** `current_role()`; (3) proveer
> el snippet canónico del guard (no hay precedente in-repo).

### F5 — Workflow · **PASS**
Vacaciones/permisos/licencias (máquina de estados completa con `cancelada`/`anulada`, v1.1 §M6) y
horas extra (subtipo `hora_extra` + `rrhh_horas_extra_detalle` + vínculo a novedades, v1.1 §M4).
Sin estados huérfanos ni transiciones imposibles.
> Menores (no bloqueantes): estado de entrada de OT cargada por supervisor; semántica de
> `cantidad_dias` para el subtipo `hora_extra`.

### F6 — KPI · **PASS**
Ausentismo con denominador definido (`rrhh_jornada` − feriados; numerador por `computa_ausentismo`,
v1.1 §M5). Dotación, vacaciones y permisos derivan de tablas existentes vía vistas.
> Menor (no bloqueante): turnos rotativos no representables en `rrhh_jornada.dias_semana[]`.

### F7 — Roadmap · **PASS**
Secuencia `0056`→`0061` estrictamente monotónica (v1.1 §M3); `0061` redefinida a storage dedicado
sin `ALTER TYPE document_type_t` (v1.2 §6.2); cada `ALTER TYPE` de enum aislado.
> Menor (no bloqueante): la fila R3 en v1.1 aún rotula "usa 0057/0061"; debería decir `0058`.

### F8 — Separación de dominios · **PASS**
RRHH ≠ Compliance (audita logs, sin PII salvo excepción reglada); RRHH ≠ Centro Documental (tablas/
buckets separados); RRHH no referencia tablas de ERP-A, ERP-B ni CRM. (v1.2 §5; verificado: sin
artefactos `rrhh` en migraciones/código.)

---

## 4. Hallazgos

### 🔴 Críticos
**Ninguno.** La fuga crítica de la auditoría de cierre (H-C1) está **resuelta** por v1.2.

### 🟠 Mayores (bloquean READY)
**FA-1 · Capa RPC de recibos sin blindaje fail-closed + precedente contradictorio (F4).**
La RPC de signed URL —único acceso al PDF del recibo— puede quedar fail-open por el comportamiento
NULL de `has_permission` (`0055`), y v1.2 manda espejar una RPC (`emit_custody_signed_url`) que
autoriza con `current_role()`, en contra de su propia regla. Riesgo: emisión de URLs de recibos a
usuarios sin rol o vía dependencia legacy. **Es el mismo tipo de bug ya hotfixeado en Tesorería.**

### 🟡 Menores (no bloquean; cerrar en implementación)
- m-F1: extender "prohibido `current_role()`" a tablas de PII estructurada (empleados/bancario).
- m-F5a: estado de entrada de OT cargada por supervisor.
- m-F5b: semántica de `cantidad_dias` en subtipo `hora_extra`.
- m-F6: turnos rotativos en `rrhh_jornada`.
- m-F7: etiqueta de dependencia R3 (`0058`, no `0061`).
- (Heredado) vector de grant de `rrhh:solicitud.approve_l1` a jefes de línea.

---

## 5. Riesgos residuales (reales, verificables)

| # | Riesgo | Evidencia | Severidad |
|---|--------|-----------|-----------|
| FR1 | Signed URL de recibo emitida a usuario sin rol por guard fail-open | `0055:7-12` (NULL de has_permission); v1.2 sin mandato coalesce | Mayor |
| FR2 | Reintroducción de `current_role()` al "espejar" custody | `0037:141-167` usa current_role; v1.2 §4.1 lo prohíbe | Mayor |
| FR3 | PII estructurada (CBU/CUIL) sin regla explícita anti-`current_role` | v1.2 §4 enfoca documentos | Menor |
| FR4 | Personal de turno rotativo sin denominador de ausentismo | `rrhh_jornada` solo días fijos | Menor |

> No se listan riesgos especulativos. FR1/FR2 son code-grounded sobre la ruta de acceso al PDF.

---

## 6. Veredicto Final

> ## OPTION B — `REQUIRES ADDITIONAL DESIGN WORK`

Con **1 hallazgo mayor abierto (FA-1 / F4)**, la regla de aprobación obliga a este resultado. **No**
se otorga `ARCHITECTURE READY`.

**Importante (contexto justo):** la distancia al cierre es mínima. v1.2 corrigió el problema de
fondo (aislamiento de PII) correctamente y con un patrón probado. Lo que resta es **endurecer
explícitamente la capa de autorización RPC** — una corrección de redacción/diseño acotada, no un
rediseño. No es razonable otorgar READY con un fail-open posible en el único portón del recibo,
justo después de que Tesorería necesitara un hotfix por el mismo bug.

### Corrección requerida para el próximo (y previsiblemente último) gate
Emitir una nota/adenda v1.2.1 que, sin implementar:
1. **Mandate fail-closed:** todo guard de RPC RRHH usa `coalesce(public.has_permission('rrhh:…'),
   false)`; referencia explícita a `0055_treasury_security_fix.sql`.
2. **Corrija la guía de reúso:** "mirror custody" aplica a la **estructura** (security definer →
   autoriza → audita lectura en `rrhh_document_audit` → devuelve grant), **no** a la expresión de
   autorización. La autorización RRHH es `coalesce(has_permission, false)` **+** propiedad
   (`empleado.profile_id = auth.uid()`), **sin** `current_role()` (salvo el bypass admin que ya
   vive dentro de `has_permission`).
3. **Provea el snippet canónico** del guard RRHH (no hay precedente in-repo correcto que copiar).
4. Cierre los menores (m-F1, m-F5a/b, m-F6, m-F7, approve_l1).

### Criterio objetivo para `ARCHITECTURE READY`
F4 pasa cuando el diseño demuestre, por escrito y verificable, que **ninguna RPC RRHH puede emitir
acceso a un recibo/documento ante un `has_permission` NULL** (guard `coalesce(...,false)`) y que la
autorización **no** depende de `current_role()`. Con F4 en PASS y sin mayores, el dominio RRHH
quedará en condiciones de declararse `ARCHITECTURE READY`.

---

## 7. Tabla resumen

| Control | Estado | Bloqueante |
|---------|--------|-----------|
| F1 PII | PASS | — |
| F2 RBAC | PASS | — |
| F3 Storage | PASS | — |
| **F4 RPC** | **FAIL** | **Sí (FA-1)** |
| F5 Workflow | PASS | — |
| F6 KPI | PASS | — |
| F7 Roadmap | PASS | — |
| F8 Dominios | PASS | — |
| **Veredicto** | **REQUIRES ADDITIONAL DESIGN WORK** | — |

---

*Fin de la auditoría final. Solo lectura — no se modificó diseño/addenda ni se tocó producción.*
*Un mayor abierto (F4). Remediación acotada en §6; tras v1.2.1 corresponde un último gate de F4.*

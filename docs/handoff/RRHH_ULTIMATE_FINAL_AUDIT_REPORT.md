# TOPS NEXUS — RRHH · ULTIMATE FINAL AUDIT REPORT (ARCHITECTURE READY GATE)

> **Tipo:** auditoría documental definitiva, adversarial, solo lectura. Última auditoría antes de
> congelar arquitectura.
> **No** se modificó documentación, no se crearon addenda, no se implementó, no se migró, no se
> commiteó, sin impacto en producción.
> **Corpus auditado:** v1.0 + v1.1 + v1.2 + v1.2.1 y las tres auditorías previas, cruzados contra
> código real, patrones Nexus, el incidente `0055` y el precedente Custody `0037`.
> **Fuente de verdad:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07. **Auditor:** Claude Code.

---

## 1. Executive Summary

El dominio RRHH atravesó un ciclo completo de diseño → auditoría → corrección → re-auditoría que
expuso y **resolvió** dos defectos reales: (a) una fuga crítica de PII por reutilizar la
infraestructura `documents` (cerrada en v1.2 con almacén dedicado, espejando el aislamiento de PII
de Custody), y (b) un *fail-open* potencial en la RPC de signed URLs (cerrado en v1.2.1 con guards
`coalesce(has_permission(...), false)`, prohibición de `current_role()` y acceso RPC-only auditado).

Esta auditoría verifica el diseño **consolidado** contra los 8 controles obligatorios. **Los ocho
pasan.** No quedan hallazgos **críticos** ni **mayores** abiertos. Los ítems remanentes son
**menores y de implementación**, no bloqueantes.

Por la regla de aprobación (críticos = 0 **y** mayores = 0 ⇒ READY), el resultado es:

> **`ARCHITECTURE READY`**

con la salvedad explícita (honesta, no bloqueante) de que los mandatos de seguridad de v1.2.1
(guards fail-closed, RPC-only) son **mandatos de diseño** cuya correcta materialización deberá
verificarse en la auditoría de **implementación** del primer gate (R1+) — fase distinta de este
gate de arquitectura.

---

## 2. Resultado A1–A8

| Control | Estado |
|---------|--------|
| A1 — PII | **PASS** |
| A2 — Storage | **PASS** |
| A3 — Seguridad (sin `current_role()`) | **PASS** |
| A4 — Guards (`coalesce`, sin `if not has_permission`) | **PASS** |
| A5 — Signed URLs (RPC-only, auditadas, grant temporal) | **PASS** |
| A6 — Workflow | **PASS** |
| A7 — Arquitectura (separación / no duplicación) | **PASS** |
| A8 — Roadmap | **PASS** |

### A1 — PII · PASS
Recibos, CUIL, CBU, documentación médica y legajos residen en almacén RRHH dedicado
(`rrhh_documents`/`rrhh_receipts`/`rrhh_empleados`/`rrhh_empleado_bancario`, buckets `rrhh-*`), fuera
de `documents`. Acceso por propiedad (`empleado.profile_id = auth.uid()`) **o** RBAC fail-closed.
Rutas de exposición previas — reuse de `documents` (`0010:313-323`), fail-open de RPC (`0055`),
`current_role()` — **todas cerradas** (v1.2 §2/§4; v1.2.1 R1–R4, §5). Salud aislada en `rrhh-health`
con gating `rrhh.salud.read`. **Sin ruta de exposición indebida en el diseño.**

### A2 — Storage · PASS
Buckets `rrhh-receipts`/`rrhh-legajo`/`rrhh-health` dedicados (nombres libres: verificado contra
`documents`/`custody-pii`/`treasury`/…). Aislamiento total de `documents` (sin reuse de tabla,
bucket ni policies) y del Centro Documental (`listDocs` consulta `documents`; no alcanza tablas
`rrhh_*`). (v1.2 §2/§3/§5.)

### A3 — Seguridad · PASS
La autorización RRHH es **RBAC + propiedad**, exclusivamente. `current_role()` está prohibido como
mecanismo de autorización (v1.2.1 R2). El único `current_role()` presente es el bypass de admin
**interno** a `has_permission` (`0009:174`) — superusuario por diseño, universal en Nexus,
aceptable; no expone a `operaciones`/`supervisor`.

### A4 — Guards · PASS
v1.2.1 fija el guard canónico `coalesce(public.has_permission('<slug>'), false)` (R1, §4.1–4.3) y
**prohíbe** `if not has_permission(...)` sin `coalesce` (lección de `0055_treasury_security_fix.sql`).
El documento provee guard y esqueleto de RPC listos para implementar.

### A5 — Signed URLs · PASS
Emisión **solo** vía RPC `emit_rrhh_signed_url` (R4, §4.3); auditoría obligatoria en
`rrhh_document_audit` (append-only) **antes** del grant; grant temporal (la app firma con el SDK);
acceso directo imposible (buckets `rrhh-*` sin policy de lectura `authenticated`). Estructura
heredada de `emit_custody_signed_url` (`0037`), autorización **no** (RBAC, no `current_role()`).

### A6 — Workflow · PASS
Vacaciones/permisos/licencias: máquina de estados completa con `cancelada` (pre-aprobación) y
`anulada` (post-aprobación con contrapartida) — sin estados huérfanos ni transiciones imposibles
(v1.1 §M6). Horas extra: subtipo `hora_extra` + `rrhh_horas_extra_detalle` + vínculo a novedades,
sin liquidar (v1.1 §M4). Menores no bloqueantes documentados.

### A7 — Arquitectura · PASS
Separación de dominios explícita (RRHH ≠ Compliance / Centro Documental / ERP-A / ERP-B / CRM —
v1.2 §5; sin referencias de RRHH a tablas de esos dominios). Sin duplicación (reuse de helpers de
código, no de capas de seguridad). Consistente con ERP-A (append-only `tg_forbid_delete_*`,
RPC-first `security definer` + `via_rpc`, RLS≤RBAC, `public_id`, auditoría por dominio) y con el
patrón de aislamiento PII de Custody.

### A8 — Roadmap · PASS
Secuencia `0056`→`0061` estrictamente monotónica; cada `ALTER TYPE` de enum aislado y committeado
antes de uso; `0061` redefinida a storage dedicado sin tocar `document_type_t` (v1.1 §M3; v1.2 §6.2).
Dependencias coherentes e implementables (R0→R10). Etiqueta de dependencia R3 (debería citar `0058`,
no `0061`) es un menor documental no bloqueante.

---

## 3. Hallazgos críticos

**Ninguno.** (La fuga crítica histórica H-C1 fue resuelta por v1.2 y reverificada aquí.)

## 4. Hallazgos mayores

**Ninguno.** (El mayor histórico FA-1 fue cerrado por v1.2.1 y reverificado aquí.)

## 5. Hallazgos menores (no bloqueantes — cerrar durante implementación)

| # | Menor | Acción en implementación |
|---|-------|--------------------------|
| n1 | OT cargada por supervisor: estado de entrada no mapeado | Definir si salta L1 (cargada por el propio jefe) |
| n2 | `rrhh_solicitudes.cantidad_dias` no aplica al subtipo `hora_extra` | Definir uso/valor para ese subtipo |
| n3 | Turnos rotativos no representables en `rrhh_jornada.dias_semana[]` | Modelar patrón rotativo o excluir explícitamente |
| n4 | Etiqueta de dependencia R3 cita `0061` (debería `0058`) | Corregir anotación del roadmap |
| n5 | Vector de grant de `rrhh.solicitud.approve_l1` a jefes de línea | Definir mecanismo (rol o grant nominal) |
| n6 | Deuda documental: v1.1 §M1 contiene texto ya superado por v1.2 | Consolidar diseño final tras congelar (marcar superseded) |
| n7 | Slugs `rrhh:*` (colon) en addenda previas vs punto en v1.2.1 | Usar notación con punto al consolidar |

> Ninguno afecta PII, seguridad, integridad de datos ni separación de dominios.

## 6. Riesgos residuales (reales, no especulativos)

| # | Riesgo | Naturaleza | Mitigación |
|---|--------|-----------|-----------|
| RR1 | Los guards fail-closed y la RPC-only son **mandatos de diseño**; su correcta escritura SQL recién se prueba al implementar | Implementación | Auditoría de implementación obligatoria en R1+ con el checklist de v1.2.1 §6 |
| RR2 | `has_permission` con fail-open en TS (route-layer, RBAC dormido — `src/lib/rbac/check.ts`) | Infra preexistente | RRHH accede a PII solo por RPC/RLS fail-closed (DB); no depender del check de ruta para PII |
| RR3 | Turnos rotativos sin denominador de ausentismo | Funcional menor | n3 |
| RR4 | Deuda documental entre versiones (M1 superado, slugs) | Documental | n6/n7 al consolidar |

> RR1/RR2 son la frontera natural arquitectura↔implementación: el diseño ahora **mandata** lo
> correcto; la implementación deberá **demostrarlo**. No son hallazgos abiertos de diseño.

---

## 7. Veredicto final

> ## OPTION A — `ARCHITECTURE READY`

**Críticos = 0 · Mayores = 0.** Los ocho controles (A1–A8) pasan. El ciclo de auditoría adversarial
cumplió su función: detectó defectos reales (exposición de PII vía `documents`; fail-open de
autorización) y verificó su corrección con patrones ya probados en producción (aislamiento PII de
Custody `0037`; guard fail-closed de Tesorería `0055`). Los ítems remanentes son menores y de
implementación.

El diseño del dominio RRHH es **completo, coherente con la arquitectura de TOPS Nexus, no invasivo
de los dominios existentes y conforme con la Ley 25.326**.

---

```text
RRHH STATUS:
ARCHITECTURE FROZEN
READY FOR IMPLEMENTATION
```

**Ciclo de diseño del dominio RRHH para TOPS Nexus: CERRADO.**

### Condiciones de arranque de implementación (R1+)
1. Implementar bajo el diseño congelado (v1.0 + v1.1 + v1.2 + v1.2.1); ante conflicto, prevalece la
   versión más alta.
2. Migración `0056` (enum `rrhh`) aislada y committeada antes de `0057`.
3. Auditoría de **implementación** por gate, verificando el checklist de seguridad de v1.2.1 §6
   contra el SQL real (guards `coalesce`, RPC-only, auditoría, sin `current_role()`).
4. Cerrar los menores n1–n7 en sus gates correspondientes.
5. Aprobación explícita de Dirección antes de tocar producción (`arsksytgdnzukbmfgkju`).

---

*Fin de la auditoría definitiva. Solo lectura — no se modificó documentación ni se tocó producción.*
*Veredicto: `ARCHITECTURE READY` · arquitectura congelada · ciclo de diseño cerrado.*

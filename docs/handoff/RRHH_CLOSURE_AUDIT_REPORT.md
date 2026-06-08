# TOPS NEXUS — RRHH · CLOSURE RE-AUDIT REPORT (FINAL GATE)

> **Tipo:** auditoría de cierre adversarial (solo lectura). Metodología: asumir el diseño
> equivocado hasta demostrar lo contrario, verificando **contra el código real**, no contra
> los documentos.
> **No** se implementó, modificó, migró ni commiteó nada. Sin impacto en producción.
> **Insumos:** `RRHH_ARCHITECTURE_DESIGN.md` (v1.0), `RRHH_ARCHITECTURE_ADDENDUM_V1_1.md`,
> `RRHH_AUDIT_REPORT.md`, `RRHH_EXECUTIVE_SUMMARY.md`.
> **Fuente de verdad:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07. **Auditor:** Claude Code.

---

## 1. Executive Summary

La re-auditoría **no** puede otorgar `ARCHITECTURE READY`. La verificación contra el código
real descubrió que la corrección **M1 del Addendum v1.1 (reutilizar `documents`) introduce una
fuga crítica de PII** y **entra en contradicción directa con la corrección M2** (RRHH usa solo
RBAC). Cinco de los siete criterios pasan; **C2 (integración documental) falla con un hallazgo
crítico**, y la regla de cierre es explícita: ningún hallazgo mayor abierto → no hay READY.

**Hallazgo central (evidencia en código):**
- `current_role()` devuelve el enum **legacy** `user_role_t` desde `profiles.role`
  (`0001_init.sql:180`, `0005_fix_rls_recursion.sql:23`). **No** conoce los roles de la tabla RBAC.
- La RLS de lectura de `documents` concede **lectura total** a
  `current_role() in ('admin','operaciones','supervisor')` **sin filtrar por `client_id`**
  (`0010_documents.sql:313-323`). Idéntico para el bucket en `storage.objects` (`:382-390`).
- La UI del Centro Documental (`src/lib/documental/data.ts` → `listDocs()`) hace
  `select … from documents where deleted_at is null limit 500` **sin filtro de tipo**.

**Consecuencia:** si los recibos de sueldo (y DNI/CBU/documentación de salud) se almacenan como
filas de `documents`, **cualquier usuario con rol `operaciones` o `supervisor` puede leer y listar
todos los recibos de todos los empleados** (nombre en el título, CUIL, importes, y el PDF mismo
desde el bucket) — **eludiendo por completo** la RPC de RRHH que el addendum presentaba como
control de acceso. Esto es una violación grave de la Ley 25.326.

**Contradicción M1 ↔ M2:** `documents` se gobierna por `current_role()`/`user_role_t` (sistema
legacy); RRHH (M2) declara usar **solo** `has_permission`/RBAC. Ambos no componen: el gate
`has_permission('rrhh:recibo.upload')` es **inaplicable** en la capa de `documents`, y los roles
RRHH son **invisibles** para `current_role()`.

**Veredicto:** `REQUIRES ADDITIONAL DESIGN WORK` (OPTION B). Detalle y remediación en §3/§5.

---

## 2. Resultado C1–C7

| Criterio | Estado |
|----------|--------|
| C1 — No duplicación | **PASS** |
| C2 — Integración documental | **FAIL** 🔴 |
| C3 — Roles | **PASS** (con observación) |
| C4 — Roadmap | **PASS** (con observación menor) |
| C5 — Horas extra | **PASS** |
| C6 — Ausentismo | **PASS** (con observación) |
| C7 — Workflow | **PASS** |

### C1 — No duplicación · **PASS**
El Addendum v1.1 elimina `rrhh_documentos`, `rrhh_recibos` y los buckets propios; sustituye
`rrhh_recibo_accesos` por `documents_audit`. No duplica `drive` (`src/lib/drive/client.ts`, no
referenciado), ni CRM, ni ERP. `rrhh_audit_log` es coherente con el patrón de auditoría por
dominio de Nexus (`documents_audit`, `crm_sync_audit` 0045), no una duplicación de Compliance.
> Observación: la corrección **sobre-reutiliza** (ver C2). "No duplicar" se cumple; el problema
> es que reutilizar `documents` para PII de empleado es inseguro.

### C2 — Integración documental · **FAIL** 🔴
La reutilización **no es técnicamente consistente** para documentos privados del empleado.
Evidencia (código real):
- **Lectura abierta a roles operativos:** `0010_documents.sql:313-323`
  ```
  create policy "documents read scoped" … using (
    (deleted_at is null or current_role()='admin')
    and ( current_role() in ('admin','operaciones','supervisor')
          or client_id = (select client_id from profiles where id=auth.uid()) ))
  ```
  → `operaciones` y `supervisor` leen **todas** las filas (incluidos recibos), sin importar
  `client_id` (que para un recibo sería NULL).
- **Bucket abierto a roles operativos:** `0010_documents.sql:382-390` (misma lógica en
  `storage.objects`) → el PDF del recibo es descargable directo del bucket, **sin pasar por la
  RPC de RRHH**.
- **Escritura no reconoce roles RRHH:** `0010_documents.sql:325-335` exige
  `current_role() in ('admin','operaciones','supervisor')`. Como `current_role()` lee
  `user_role_t` (`0001_init.sql:180`), los roles RRHH de la tabla RBAC (`rrhh_admin`, etc.) **no
  habilitan** insert/update en `documents`. El gate del addendum (`has_permission('rrhh:recibo.upload')`)
  **no se aplica** en esta capa.
- **Exposición en UI:** `listDocs()` no filtra por tipo (`src/lib/documental/data.ts`), por lo que
  los recibos aparecerían en el Centro Documental para cualquier usuario interno.

→ **Crítico:** PII de haberes accesible por roles operativos amplios. La RPC de RRHH es un control
**ilusorio** porque la tabla y el bucket subyacentes tienen su propia RLS legacy más permisiva.

### C3 — Roles · **PASS** (con observación)
Sobre los criterios literales: no se extiende `user_role_t` (intacto); los slugs RRHH
(`rrhh_admin`/`rrhh_manager`/`rrhh_viewer`/`employee_self_service`) **no colisionan** con los 7
roles RBAC sembrados en `0009_rbac.sql`; el rol `supervisor` se elimina y la jefatura se resuelve
por `supervisor_id`. ✅
> Observación (menor): el vector para conceder `rrhh:solicitud.approve_l1` a un jefe de línea (que
> es un empleado, no necesariamente con rol RRHH) queda como "grant puntual si se desea" — sin
> mecanismo definido. Además, el valor legacy `user_role_t.supervisor` sigue existiendo y otorga
> lectura amplia en varias RLS (ver C2); debe garantizarse que la aprobación L1 use `supervisor_id`
> y **no** `current_role()='supervisor'`.

### C4 — Roadmap · **PASS** (con observación menor)
Numeración `0056`→`0061` estrictamente creciente; cada `ALTER TYPE` aislado; sin ciclos duros.
> Observación (menor): la fila **R3** referencia la migración `0061` ("usa 0057/0061"), pero `0061`
> se entrega en **R8**, que a su vez depende de R3. Es una anotación de dependencia incorrecta (los
> documentos de legajo viven en el vínculo de `0058`, no en `0061`). No es un ciclo real, pero la
> dependencia está mal etiquetada.

### C5 — Horas extra · **PASS**
Captura (`rrhh_horas_extra_detalle`: fecha, `cantidad_horas`, `recargo` al_50/al_100, origen),
workflow y aprobación reutilizados del motor de solicitudes, y al aprobar → `rrhh_novedades`
(`tipo='hora_extra'`). El recargo es **metadato**, no cálculo de importe → no invade liquidación. ✅
> Observación (menor): `rrhh_solicitudes.cantidad_dias` no aplica al subtipo `hora_extra` (la
> magnitud son horas, en el detalle); definir su valor/uso para ese subtipo.

### C6 — Ausentismo · **PASS** (con observación)
KPI ahora calculable con denominador definido y fuente clara:
`días_esperados = Σ días en rrhh_jornada.dias_semana − feriados`; `numerador = ausencias aprobadas
con computa_ausentismo`; exclusión explícita de empleados sin jornada. ✅
> Observación (menor/residual): `rrhh_jornada.dias_semana[]` no expresa **turnos rotativos** (p.ej.
> 4x3), frecuentes en flota/depósito 3PL. Para ese personal el denominador queda indefinido pese a
> que `tipo_turno='rotativo'` existe como bandera. Debe modelarse el patrón rotativo o documentar el
> tratamiento.

### C7 — Workflow · **PASS**
Estados: `borrador, pendiente_supervisor, pendiente_rrhh, aprobada, rechazada, cancelada, anulada`.
Todos alcanzables; terminales correctos (`rechazada/cancelada/anulada`); `cancelada` (pre-aprobación,
sin efectos) y `anulada` (post-aprobación, con contrapartida + restitución de saldo) bien
diferenciados; transiciones solo por RPC con `via_rpc`+`FOR UPDATE`+evento. Sin estados huérfanos
ni transiciones imposibles. ✅
> Observación (menor): para horas extra con `origen='carga_supervisor'`, el estado de entrada (¿salta
> L1 porque lo carga el propio jefe?) no está mapeado en la máquina.

---

## 3. Hallazgos

### 🔴 Críticos (bloquean READY)

**H-C1 · Fuga de PII por reutilización de `documents`/bucket para documentos privados del empleado**
Recibos de sueldo, DNI, CBU y documentación de salud almacenados en la tabla/bucket `documents`
quedan bajo su RLS legacy, que concede lectura total a `current_role() in ('admin','operaciones',
'supervisor')` (`0010_documents.sql:313-323`, `:382-390`) y se listan sin filtro en el Centro
Documental (`documental/data.ts`). La RPC de RRHH no protege nada porque el acceso directo a tabla y
bucket la elude. **Violación de Ley 25.326** (datos personales y categoría especial de salud).

### 🟠 Mayores (bloquean READY)

**H-M1 · Contradicción arquitectónica M1 ↔ M2 (dos sistemas de seguridad que no componen)**
`documents` se gobierna por `current_role()`/`user_role_t` (legacy); RRHH (M2) declara usar
**solo** RBAC `has_permission`. Como `current_role()` lee `profiles.role` (`0001_init.sql:180`) y no
la tabla RBAC, los roles RRHH son invisibles para las RLS de `documents`: el gate
`has_permission('rrhh:recibo.upload')` **no es aplicable** en esa capa, y RRHH no puede expresar
"dueño-o-RRHH" sobre `documents`. La reutilización propuesta es **funcionalmente inconsistente**:
o se cae al modelo legacy (perdiendo M2 y filtrando PII), o no se puede operar `documents` con
roles RRHH.

### 🟡 Menores (no bloquean, recomendados antes de implementar)

- **H-m1 (C3):** mecanismo para otorgar `rrhh:solicitud.approve_l1` a jefes de línea no definido;
  asegurar que L1 use `supervisor_id`, no el legacy `current_role()='supervisor'`.
- **H-m2 (C4):** dependencia mal etiquetada (R3 referencia `0061`/R8). Corregir a `0058`.
- **H-m3 (C6):** turnos rotativos no representables en `rrhh_jornada.dias_semana[]`.
- **H-m4 (C5):** semántica de `cantidad_dias` para el subtipo `hora_extra`.
- **H-m5 (C7):** estado de entrada de horas extra cargadas por el supervisor.

---

## 4. Riesgos residuales (reales, no hipotéticos)

| # | Riesgo | Evidencia | Severidad |
|---|--------|-----------|-----------|
| R1 | Exposición de haberes/PII a roles operativos amplios vía `documents` | `0010_documents.sql:313-323/382-390`; `documental/data.ts` sin filtro | Crítica (legal) |
| R2 | Control de acceso RRHH eludible (acceso directo a tabla/bucket) | RPC RRHH no intercepta lecturas de `documents`/storage | Crítica |
| R3 | RRHH no puede escribir en `documents` si su `profiles.role` no es admin/operaciones/supervisor | `0010_documents.sql:325-335` + `current_role()` legacy | Mayor (funcional) |
| R4 | Personal de turno rotativo sin denominador de ausentismo | `rrhh_jornada` solo modela días fijos | Media |
| R5 | Si RRHH adopta el modelo legacy para poder usar `documents`, se pierde la disambiguación de roles de M2 | contradicción M1↔M2 | Mayor (arquitectónico) |

> No se listan riesgos especulativos. Los anteriores son verificables en el código citado.

---

## 5. Veredicto Final

> ## OPTION B — `REQUIRES ADDITIONAL DESIGN WORK`

Con **1 hallazgo crítico (H-C1)** y **1 mayor (H-M1)** abiertos sobre C2, la regla de cierre
("no otorgar READY con un solo mayor abierto") impide declarar `ARCHITECTURE READY`. Los demás
criterios (C1, C3, C4, C5, C6, C7) pasan, varios con observaciones menores.

### Remediación requerida (orientación, no implementación)
El Addendum v1.1 **sobre-corrigió M1**. La integración correcta separa *reutilizar código* de
*reutilizar el almacén de PII*:

1. **Reutilizar los helpers y patrones** de `documental` (código): `fileHashSha256`, `buildDocPath`,
   `uploadDocument`, `getSignedUrl`, y el patrón append-only de auditoría. (Evita duplicar lógica.)
2. **No** almacenar documentos privados del empleado (recibos, DNI, CBU, salud) en la tabla/bucket
   `documents` compartidos. Usar un **almacén RRHH dedicado** (tabla + bucket privado propios) cuya
   **RLS se exprese en términos RRHH**: `dueño (empleado.profile_id = auth.uid())` **o**
   `has_permission('rrhh:recibo.read.all')` — sin la cláusula legacy `current_role() in
   ('operaciones','supervisor')`. (Esto era, de hecho, lo que proponía v1.0; el error fue
   descartarlo por completo en M1.)
3. **Resolver la contradicción M1↔M2:** definir explícitamente que la seguridad de los documentos
   RRHH se gobierna por RBAC (`has_permission`) y propiedad, no por `current_role()`. Documentos de
   negocio no sensibles (si los hubiera) podrían ir a `documents`; los privados del empleado, no.
4. Cerrar los menores H-m1…H-m5.

> Nota: H-C1/H-M1 **no** existían en v1.0 (que usaba bucket dedicado con RLS dueño-o-RRHH); fueron
> **introducidos** por la corrección M1 del addendum. La auditoría original acertó el problema de
> duplicación, pero la corrección pendular creó un riesgo peor. La solución es el punto medio (1–3).

### Criterio para un eventual READY (próxima iteración)
`ARCHITECTURE READY` solo cuando C2 pase con evidencia de que **ningún rol distinto de RRHH (o el
empleado dueño) pueda leer/listar/descargar recibos ni documentación personal**, y que la
seguridad de esos documentos se exprese en RBAC/propiedad — sin depender de `current_role()`.

---

*Fin de la auditoría de cierre. Solo lectura — no se modificó diseño/addendum ni se tocó producción.*
*Veredicto: `REQUIRES ADDITIONAL DESIGN WORK`. Se requiere Addendum v1.2 (M1 re-corregido) y nueva re-auditoría.*

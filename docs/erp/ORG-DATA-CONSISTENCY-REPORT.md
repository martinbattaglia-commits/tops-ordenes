# ORG-DATA-CONSISTENCY-REPORT

**Fecha:** 2026-05-29
**Autor:** asistencia documental TOPS NEXUS (ETAPA 0B)
**Scope:** inventario exhaustivo de inconsistencias de **nombres, cargos y emails** del staff de Verotin S.A. en el sistema TOPS NEXUS.
**Estado:** documental · **diagnóstico, NO corrección**.
**Restricciones honradas:** 🛑 NO MODIFICAR código · NO COMMIT · NO PR · NO DEPLOY. Este documento solo inventaría.

---

## 0 · Fuente de verdad declarada (decisión del presidente · 2026-05-29)

Martín Battaglia (presidente, Logística TOPS / Verotin S.A.) declaró como **datos válidos** los siguientes. Esta es la **fuente de verdad autoritativa** contra la cual se mide toda inconsistencia en este reporte:

| Persona | Nombre completo autoritativo | Email autoritativo | Rol RBAC | Cargo |
|---------|------------------------------|--------------------|----------|-------|
| Director | **José Luis Rodríguez** | `joseluis@logisticatops.com` | `director` | Director de Operaciones |
| Administración | **Ruth Carrasquero** | `ruth@logisticatops.com` | `administracion` | Administración · Verotin S.A. |

> **Nota:** los apellidos **Battaglia** (Director) y **Cardozo** (Administración) que hoy aparecen en el código se consideran **DESACTUALIZADOS**. No se corrigen en esta etapa — este reporte solo los inventaría para una futura tarea de corrección autorizada por separado.

---

## 1 · Resumen ejecutivo

- **Apellido del Director:** el código tiene **dos valores distintos coexistiendo** — `Battaglia` (mayoría de archivos) y `Rodríguez` (solo mock-data). El autoritativo es **Rodríguez**. ⇒ los `Battaglia` están mal; el `Rodríguez` del mock coincide por casualidad con el dato correcto.
- **Apellido de Administración:** el código usa **`Cardozo`** de forma uniforme. El autoritativo es **`Carrasquero`**. **`Carrasquero` no aparece en ningún archivo del código.** ⇒ todos los `Cardozo` están mal.
- **Emails:** **consistentes y correctos** en todo el código (`joseluis@` y `ruth@logisticatops.com`), con override por variable de entorno. ✅ Sin acción.
- **Cargos:** consistentes (`Director de Operaciones`; `Administración · Verotin S.A.`). ✅ Sin acción.
- **Iniciales/avatar:** `JL` (Director) y `RC` (Ruth Cardozo) en `org.ts`; `JR` (José Rodríguez) en mock-data. ⇒ si se adopta el apellido autoritativo, `RC` (Ruth **C**arrasquero) sigue siendo válido por coincidencia de inicial; `JR` del mock seguiría válido; `JL` (basado en nombre, no apellido) no se ve afectado.

**Severidad global:** 🟡 **media** — son datos de presentación (footers, PDF, headers, mocks). No afectan autenticación ni RBAC (que opera por email/UUID, no por apellido). Pero sí afectan documentos legales generados (PDF de OC firmadas) → corregir antes de emitir comprobantes con el apellido equivocado.

---

## 2 · Inventario completo — Director (José Luis)

| # | Archivo:línea | Valor actual | Tipo | ¿Coincide con autoritativo (`Rodríguez`)? |
|---|---------------|--------------|------|--------------------------------------------|
| D1 | `src/lib/org.ts:16` | `name: "José Luis Battaglia"` | constante org (SSOT declarada) | ❌ NO — dice Battaglia |
| D2 | `src/lib/org.ts:17` | `role: "Director de Operaciones"` | cargo | ✅ cargo correcto |
| D3 | `src/lib/org.ts:18` | `email: "joseluis@logisticatops.com"` | email | ✅ correcto |
| D4 | `src/lib/org.ts:19` | `initials: "JL"` | iniciales | ✅ (basado en nombre, no apellido) |
| D5 | `src/app/(app)/compras/ordenes/page.tsx:63` | `...comprobantes firmados por José Luis Battaglia.` | copy UI | ❌ NO — dice Battaglia |
| D6 | `src/app/(app)/compras/nueva/NewPoWizard.tsx:268` | `Único habilitado: José Luis Battaglia, Director de Operaciones...` | copy UI (firma OC) | ❌ NO — dice Battaglia |
| D7 | `src/lib/compras/compras-mock.ts:401` | `message: "José Luis Battaglia · Pallets Sur S.R.L."` | **mock data** | ❌ NO — dice Battaglia |
| D8 | `src/lib/mock-data.ts:92` | `full_name: "José Luis Rodríguez", role: "Director de Operaciones", avatar: "JR"` | **mock data** | ✅ SÍ — único lugar con el apellido correcto |
| D9 | `src/app/(app)/compras/page.tsx:22` | `Buen día, José Luis.` | copy UI | ⚪ neutro (solo nombre) |
| D10 | `src/components/compras/PdfPreview.tsx:173` | `José Luis` | bloque firma PDF (preview) | ⚪ neutro (solo nombre) |
| D11 | `src/lib/compras/pdf/PoPdfDocument.tsx:218` | `José Luis` | bloque firma PDF (documento legal) | ⚪ neutro (solo nombre) |
| D12 | `src/lib/email.ts:6` | `Siempre Ruth + José Luis (administración)` | comentario | ⚪ neutro (solo nombre) |
| D13 | `src/lib/env.ts:39` | `joseluis: ... ?? "joseluis@logisticatops.com"` | email (env override `EMAIL_ADMIN_JOSELUIS`) | ✅ correcto |

**Conflictos del Director:**
- **Apellido Battaglia ↔ Rodríguez coexisten en el código** (D1/D5/D6/D7 = Battaglia; D8 = Rodríguez). Esto ya era una inconsistencia interna **antes** de este reporte.
- Lugares a corregir si se adopta `Rodríguez`: **D1, D5, D6, D7** (4 ocurrencias de "Battaglia").
- D8 (mock) ya está correcto.

---

## 3 · Inventario completo — Administración (Ruth)

| # | Archivo:línea | Valor actual | Tipo | ¿Coincide con autoritativo (`Carrasquero`)? |
|---|---------------|--------------|------|----------------------------------------------|
| A1 | `src/lib/org.ts:22` | `name: "Ruth Cardozo"` | constante org (SSOT declarada) | ❌ NO — dice Cardozo |
| A2 | `src/lib/org.ts:23` | `role: "Administración · Verotin S.A."` | cargo | ✅ cargo correcto |
| A3 | `src/lib/org.ts:24` | `email: "ruth@logisticatops.com"` | email | ✅ correcto |
| A4 | `src/lib/org.ts:25` | `initials: "RC"` | iniciales | ✅ (Ruth **C**arrasquero → RC sigue válido) |
| A5 | `src/app/(app)/layout.tsx:9` | `name: "Ruth Cardozo"` | header/sesión UI | ❌ NO — dice Cardozo |
| A6 | `src/app/(app)/compras/nueva/actions.ts:331` | `// ...notificación al admin TOPS (Ruth/JL)` | comentario | ⚪ neutro (solo nombre) |
| A7 | `src/app/api/clientify/webhook/route.ts:15` | `// ...notificar a Ruth/JL si un deal pasa a "Ganado"` | comentario | ⚪ neutro (solo nombre) |
| A8 | `src/lib/email.ts:6` | `Siempre Ruth + José Luis (administración)` | comentario | ⚪ neutro (solo nombre) |
| A9 | `src/lib/env.ts:38` | `ruth: ... ?? "ruth@logisticatops.com"` | email (env override `EMAIL_ADMIN_RUTH`) | ✅ correcto |

**Conflictos de Administración:**
- **`Carrasquero` no aparece en NINGÚN archivo del código.** El código usa `Cardozo` de forma uniforme.
- Lugares a corregir si se adopta `Carrasquero`: **A1, A5** (2 ocurrencias de "Cardozo").
- Iniciales `RC` siguen siendo correctas (coincidencia de inicial de apellido).

---

## 4 · Emails — estado consolidado ✅

| Email | Ocurrencias | ¿Override por env? | Estado |
|-------|-------------|--------------------|--------|
| `joseluis@logisticatops.com` | `org.ts:18`, `env.ts:39` | sí — `EMAIL_ADMIN_JOSELUIS` | ✅ consistente y correcto |
| `ruth@logisticatops.com` | `org.ts:24`, `env.ts:38` | sí — `EMAIL_ADMIN_RUTH` | ✅ consistente y correcto |

**Conclusión emails:** sin inconsistencias. El RBAC seed (que identifica por email) **no se ve afectado** por la discrepancia de apellidos. ✅

---

## 5 · Cargos — estado consolidado ✅

| Cargo | Ocurrencias | Estado |
|-------|-------------|--------|
| `Director de Operaciones` | `org.ts:17`, `NewPoWizard.tsx:268`, `mock-data.ts:92` | ✅ consistente |
| `Administración · Verotin S.A.` | `org.ts:23` | ✅ consistente |

**Conclusión cargos:** sin inconsistencias. ✅

---

## 6 · Matriz de impacto por tipo de superficie

| Superficie | Afectada por apellido erróneo | Severidad | Razón |
|------------|-------------------------------|-----------|-------|
| **PDF de OC firmada** (documento legal) | parcial | 🔴 alta | `PoPdfDocument.tsx:218` solo usa "José Luis" (nombre), pero `NewPoWizard.tsx:268` muestra "José Luis Battaglia" en el flujo de firma. Un comprobante legal con apellido equivocado es un problema. |
| **Headers / sesión UI** | sí | 🟡 media | `layout.tsx:9` muestra "Ruth Cardozo" al usuario logueado |
| **Copy de pantallas compras** | sí | 🟡 media | `ordenes/page.tsx:63`, `NewPoWizard.tsx:268` |
| **Mock data** (no producción real) | sí (inconsistente entre sí) | 🟢 baja | `mock-data.ts` (Rodríguez) vs `compras-mock.ts` (Battaglia) |
| **Comentarios de código** | no (solo nombre) | 🟢 nula | neutros |
| **Autenticación / RBAC** | **no** | ✅ nula | opera por email/UUID, no por apellido |

---

## 7 · Plan de corrección propuesto (NO ejecutar — requiere autorización separada)

> Este reporte **NO corrige nada**. La corrección es una tarea futura, autorizada por separado, fuera de ETAPA 0B.

Cuando se autorice, la corrección debería:

1. **Confirmar definitivamente** los apellidos con el presidente (Rodríguez / Carrasquero) — ya declarado, pero el cambio de documentos legales amerita doble confirmación escrita.
2. Editar **6 ocurrencias** en total:
   - Director `Battaglia → Rodríguez`: D1 (`org.ts:16`), D5 (`compras/ordenes/page.tsx:63`), D6 (`NewPoWizard.tsx:268`), D7 (`compras-mock.ts:401`).
   - Administración `Cardozo → Carrasquero`: A1 (`org.ts:22`), A5 (`layout.tsx:9`).
3. Revisar iniciales: `RC` permanece válido; `JR`/`JL` permanecen válidos. Sin cambio.
4. Decidir si los **mocks** (`mock-data.ts`, `compras-mock.ts`) deben usar nombres reales o ficticios neutros (recomendado: nombres ficticios en mocks para no mezclar datos reales con datos de prueba).
5. Hacerlo en un **PR único y atómico** titulado p.ej. `fix(org): alinear apellidos staff Verotin (Rodríguez/Carrasquero)`, con revisión del presidente antes de merge.
6. Verificar que no haya cachés (PDF pre-generados, etc.) con el apellido viejo.

**Estimación:** ~30 min de edición + revisión. **Bloqueante de:** emisión de comprobantes legales con apellido correcto (no bloquea RBAC ni backup).

---

## 8 · Hallazgos colaterales (fuera de scope, registrados)

- **H1 — Inconsistencia interna pre-existente:** `mock-data.ts:92` (Rodríguez) vs el resto (Battaglia) ya divergían entre sí antes de este reporte. Señal de que el dato nunca tuvo una única fuente de verdad efectiva pese a que `org.ts` se declara "Single source of truth" (línea 3).
- **H2 — `org.ts` se autodeclara SSOT pero no se consume universalmente:** varias superficies (`layout.tsx:9`, copys de compras) hardcodean el nombre en vez de leer `ORG.emitter.name` / `ORG.admin.name`. Recomendación futura: refactor para que todas las superficies lean de `ORG`, eliminando la posibilidad de divergencia.
- **H3 — Mocks con datos reales:** mezclar nombres reales de staff en archivos `*-mock.ts` dificulta distinguir datos de prueba de datos productivos.

---

## 9 · Restricciones honradas

- 🛑 NO MODIFICAR `src/lib/org.ts` ni ningún archivo de código
- 🛑 NO COMMIT · NO PR · NO DEPLOY
- 🛑 NO corregir apellidos todavía (solo inventariar)
- 🛑 NO INVENTAR — cada fila trazada a `grep` real sobre `src/` (2026-05-29). Las ocurrencias neutras (solo "José Luis" / "Ruth") se marcan ⚪ y no requieren acción.

---

## 10 · Conclusión

El sistema tiene **6 ocurrencias de apellido desactualizado** (4 "Battaglia", 2 "Cardozo") repartidas entre la constante SSOT, headers, copys de compras y mocks. Los **emails y cargos están correctos y consistentes**, por lo que **ni el RBAC seed ni el backup se ven afectados** por esta discrepancia. La corrección es de baja complejidad pero **debe preceder a la emisión de comprobantes legales** con el apellido correcto, y se ejecutará como tarea separada bajo autorización propia.

**Estado:** 🟢 inventario completo · corrección diferida y autorizable por separado.

---

## 11 · AMENDA (2026-05-30) — Documento institucional como fuente de verdad

> **Naturaleza:** enmienda **aditiva**. No altera ninguna sección anterior ni corrige código. Solo eleva el respaldo documental de la decisión registrada en §0.

El presidente entregó el **organigrama institucional oficial** — *"Organigrama_Logistica_TOPS_2026_FINAL"*, **Edición 2026, actualizado 12/05/2026** (Verotin S.A. · CUIT 33-60489698-9 · Inscripta IGJ 04/12/1984). Este documento **confirma por escrito** los datos declarados verbalmente en §0 y los promueve de "declaración del presidente" a **fuente documental autoritativa**:

| Persona | Nombre completo (PDF oficial) | Cargo (PDF oficial) | Email | Refina dato previo |
|---------|-------------------------------|---------------------|-------|--------------------|
| Director | **José Luis Rodríguez Silva** | Director de Operaciones **y Apoderado** | `joseluis@logisticatops.com` | §0 decía "Rodríguez"; el PDF añade segundo apellido **Silva** y el rol de **Apoderado** |
| Administración | **Ruth Carrasquero** | Asistente Ejecutiva · **Responsable de Administración** | `ruth@logisticatops.com` | confirma "Carrasquero"; precisa el cargo |

**Implicancias sobre el inventario previo (sin cambiar las filas existentes):**

- Las 4 ocurrencias de "Battaglia" del Director (D1, D5, D6, D7) siguen **incorrectas**; el apellido oficial completo es **Rodríguez Silva**. El mock D8 (`mock-data.ts:92`, "José Luis Rodríguez") está **parcialmente** correcto (le falta "Silva").
- Las 2 ocurrencias de "Cardozo" (A1, A5) siguen **incorrectas**; el apellido oficial es **Carrasquero**, ahora respaldado por documento (antes "no aparecía en ningún archivo" — sigue sin aparecer en código, pero ya está en el PDF oficial y en `src/lib/orgchart.ts`).
- El **cargo del Director** se amplía: además de "Director de Operaciones" es **Apoderado**. El cargo de Ruth se precisa a **"Asistente Ejecutiva · Responsable de Administración"** (antes el código decía genéricamente "Administración · Verotin S.A.").

**Nuevo artefacto en el sistema (no es corrección de los datos inventariados):**

- `src/lib/orgchart.ts` — módulo de datos que codifica el organigrama completo del PDF (asamblea, dirección, gerencia, áreas, encargados, asesores externos) **con los apellidos correctos** (`Rodríguez Silva` / `Carrasquero`). Es una **estructura nueva e independiente**, no toca `src/lib/org.ts` ni resuelve las 6 ocurrencias desactualizadas listadas en §2–§3.
- `src/app/(app)/organigrama/page.tsx` + entrada en el sidebar (dominio *Sistema*) — vista institucional navegable, con PDF oficial descargable y badges de mapeo RBAC.

**El plan de corrección de §7 sigue vigente y diferido.** Esta enmienda **no lo ejecuta**; solo añade que el cambio de Director debe usar **"Rodríguez Silva"** (no solo "Rodríguez") y, si se desea, reflejar el rol de **Apoderado**. Sigue requiriendo autorización separada y PR atómico con revisión del presidente.

**Restricciones honradas (sin cambios):** 🛑 NO MODIFICAR `src/lib/org.ts` · NO COMMIT · NO PR · NO DEPLOY · corrección de apellidos aún diferida.

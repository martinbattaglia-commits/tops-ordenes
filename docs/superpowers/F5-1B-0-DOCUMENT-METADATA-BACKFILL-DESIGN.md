# F5.1-b.0 — Backfill de metadata documental a `searchable_items` — DISEÑO DETALLADO

> **Estado: ✅ CERRADO — IMPLEMENTADO, APLICADO Y VALIDADO EN PROD 2026-07-03.**
> Migraciones 0176/0177 aplicadas · `ai_docs_backfill_apply()` ejecutado (797 fichas) · smoke vivo PASS.
> Código en prod `dd17483`. Cierre formal en `F5-1B-0-CLOSURE-REPORT.md`; mejoras en
> `F5-1B-0-1-DOCS-RETRIEVAL-BACKLOG.md`. Este documento se conserva como diseño de referencia
> (la implementación siguió este diseño + los fixes adversariales que aquí se detallan).
> Fecha diseño original: 2026-07-03 · Gobernanza G1–G11. Columnas y funciones verificadas en vivo (§3).

---

## 1. Resumen ejecutivo

F5.1-b.0 proyecta la **metadata ya existente** de 569 documentos de compliance + 228 contratos
(todos con `drive_file_id`) hacia `searchable_items`, la tabla FTS que el Copilot F5.2-lite ya
consulta vía `ai_search_knowledge`. Resultado: el Copilot **encuentra documentos reales** por
título/categoría/tipo/vencimiento/cliente **de inmediato**, sin leer Drive, sin extraer texto, sin
PII de contenido, ~$0, idempotente y reversible con un `delete`.

Límite explícito: **b.0 NO resume contenido de PDFs.** Corrección del hallazgo A4 (el guard "cero
citas" NO alcanza para garantizar esto): como b.0 **sí** proyecta un `body` textual, una pregunta
por contenido *sí* matchea una ficha de metadata y produce citas — el guard de F5.2-lite solo
degrada con **cero** citas, así que el modelo podría resumir la metadata y presentarla como "el
contenido del contrato". **Defensas de b.0 para el límite metadata-vs-contenido:**
1. El `body` se **prefija** con un marcador explícito `[FICHA DE METADATA — no es el contenido del
   documento]` en cada fila proyectada.
2. El **system prompt** se extiende: "las fuentes `compliance_documento`/`contrato` son FICHAS DE
   METADATA (título, categoría, fechas), NO el contenido del documento. Si te piden el contenido
   interno, qué dice, cláusulas o texto del documento, respondé la frase de sin-evidencia; solo
   podés afirmar sobre los campos de la ficha."
3. QA §24 valida explícitamente que "resumime/qué dice el contrato X" → frase de sin-evidencia,
   incluso para los 2 contratos que hoy tienen `extracted_text` (b.0 NO proyecta ese texto).

Recomendación: **GO a implementación LOCAL de b.0** tras resolver 5 decisiones de §27 (la principal:
política de `visibility_key` de compliance/contratos).

## 2. Objetivo de F5.1-b.0

Que el Copilot responda con datos reales y citados a: "buscame documentos de Compliance", "qué
documentación de Compliance hay para X", "qué contratos existen para tal cliente", "qué documentos
están por vencer" — **por metadata**, no por contenido. Read-only, con RLS del usuario, con cita.

## 3. Estado actual verificado (read-only, 2026-07-03, EN EL MOMENTO)

| # | Ítem | Valor |
|---|------|-------|
| 1 | `/api/version` | `ccd9063` (production) |
| 2 | Deploy | `6a476090946ef1abe8a1322a` · **locked** |
| 3 | Copilot | `AI_ENABLED=1`, `AI_PROVIDER=gemini` |
| 4 | Última migración | `0175_ai_rbac_seed` |
| 5 | Próxima libre | **0176** |
| 6 | `searchable_items` | **0** filas |
| 7 | `knowledge_events` | 306 (spine operativo, no documental) |
| 8 | `compliance_documents` | **569**, 569/569 con `drive_file_id`; `estado` **vacío en todas** (el estado vive en `compliance_cases`) |
| 9 | `contract_documents` | **228**, 228/228 con `drive_file_id`; 2 con `extracted_text` |
| 10 | `contract_documents.contract_id` | FK → **`contracts`** (con `client_id`, `razon_social`, `cuit`, `public_id`, `estado`) |
| 11 | compliance `sede` | LUJAN / MAGALDI / null → **sedes de TOPS, no clientes** (interno) |
| 12 | `knowledge_visibility_for(entity,id)` | **EXISTE** (SECURITY DEFINER); `contract`→`'staff'`, compliance/PO→`'staff'` (D-1=B, Dirección 2026-06-29), default `'staff'` |
| 13 | Permisos RBAC | `compliance.view/edit`, `documental.view/create/delete/export/admin`, `knowledge.view/create/edit/delete/admin` |
| 14 | Knowledge drain | `knowledge-drain.yml` NO en default branch (inerte) — **no se toca** |
| 15 | Drive sync | `compliance/contratos/caja-chica-drive-sync` activos — **no se tocan** |
| 16 | pgvector | disponible, no instalado — **no se toca** (es b.2) |
| 17 | Nada modificado | solo SELECT / introspección / `curl` / `netlify api` (lecturas) |

**Worktree:** el diseño se escribe en `~/CODE/tops-ordenes` (worktree principal, junto al master
plan). La sesión corre desde `~/CODE/tops-ordenes-f5-copilot` (rama `feat/f5-ai-copilot-readonly`).
**Para implementación local futura** se creará un worktree limpio desde el baseline productivo
`ccd9063` (Copilot Gemini activo, deploy locked). No se toca `main` ni el deploy lock.

## 4. Tablas fuente exactas

- **`public.compliance_documents`** (569 filas) — fuente 1.
- **`public.contract_documents`** (228 filas) — fuente 2, con join a **`public.contracts`** por
  `contract_id` para razón social / cliente / estado.
- Destino: **`public.searchable_items`** (0 filas).

## 5. Columnas fuente exactas (verificadas)

`compliance_documents`: `id, item_id, sede, categoria, tipo_doc, organismo, titulo, drive_file_id,
url, mime_type, size_bytes, md5_checksum, sha256, drive_modified_at, fecha_emision,
fecha_vencimiento, estado(∅), riesgo, sync_status, sync_error, last_synced_at, created_at`.

`contract_documents`: `id, contract_id, tipo_doc, titulo, drive_file_id, url, fecha, firmado,
hash_firma, created_at, created_by, md5_checksum, drive_modified_at, size_bytes, mime_type,
extracted_text, text_source, quality, sync_status, last_synced_at, sync_error`.

`contracts` (join): `id, public_id, client_id, tipo, razon_social, cuit, deposito, estado, riesgo,
semaforo, fecha_firma, fecha_inicio, fecha_fin, …`.

`searchable_items` (destino): `id, entity_type, entity_id, title, body, public_id, status,
entity_date, visibility_key, tsv(GENERATED), updated_at` + `unique(entity_type, entity_id)`.

## 6. Mapping hacia `searchable_items`

### 6.1 Compliance documento

| destino | origen | nota |
|---|---|---|
| `entity_type` | `'compliance_documento'` | constante |
| `entity_id` | `cd.id::text` | 1:1 con la fila fuente (unicidad) |
| `public_id` | `cd.item_id \|\| '#' \|\| left(cd.id::text,8)` | **M1:** `item_id` (p.ej. MAG-04) agrupa N documentos → se sufija con el id corto para que la cita sea 1:1 con el documento (trazabilidad §21) |
| `title` | `cd.titulo` | pasa por redacción PII en escritura (§9) |
| `body` | `redact(concat_ws(' · ', cd.titulo, cd.categoria, cd.tipo_doc, cd.organismo, cd.sede, cd.riesgo, to_char(cd.fecha_vencimiento,'YYYY-MM-DD')))` | metadata textual indexable; **sin `estado`** (∅); **redactada en escritura** (§9/A3); prefijo "[ficha metadata]" (A4) |
| `status` | `cd.riesgo` | (estado real está vacío) |
| `entity_date` | `(coalesce(cd.fecha_vencimiento, cd.fecha_emision) at time zone 'America/Argentina/Buenos_Aires')` | **M4:** TZ canónica fija (no la de sesión) para "por vencer" determinista entre bulk y trigger |
| `visibility_key` | §8 | |

### 6.2 Contrato documento (join `contracts`)

| destino | origen | nota |
|---|---|---|
| `entity_type` | `'contrato'` | constante |
| `entity_id` | `cd.id::text` | 1:1 |
| `public_id` | `coalesce(c.public_id, cd.id::text)` | id del contrato si existe |
| `title` | `redact(concat_ws(' — ', cd.titulo, c.razon_social))` | nombre del doc + razón social; redactado en escritura |
| `body` | `redact(concat_ws(' · ', cd.titulo, cd.tipo_doc::text, c.razon_social, c.tipo::text, c.estado, c.deposito, to_char(c.fecha_fin,'YYYY-MM-DD')))` | **razón social** para "contratos de tal cliente" (mitigado por `perm:comercial.view`, A1/M8); **NO `cuit`** (PII); redactada en escritura (§9); prefijo "[ficha metadata]" (A4) |
| `status` | `c.estado` | estado del contrato |
| `entity_date` | `(c.fecha_fin at time zone 'America/Argentina/Buenos_Aires')` | **M6:** solo `fecha_fin` (vencimiento real); **NO** usar `cd.fecha` (firma) como fallback — presentaría una firma como vencimiento. Si `fecha_fin` es NULL → `entity_date` NULL y el dry-run lo reporta (§12) |
| `visibility_key` | §8 | |

`tsv` no se mapea: es `GENERATED` (español, title+body) — se calcula solo.

## 7. `source_type` / `entity_type` / `entity_id`

- `entity_type` (= source_type funcional): `'compliance_documento'` | `'contrato'`. Nombres nuevos,
  no colisionan con los del spine de eventos.
- `entity_id`: `id::text` de la fila fuente → 1:1, estable, permite upsert por
  `unique(entity_type, entity_id)`.
- **Deep-links (corregido A5 — requiere cambio de código, NO es cero-código):** verificado en
  `src/lib/ai/tools.ts` (`entityUrl`): hoy resuelve `incident`/`task`/`compliance` pero **NO tiene
  rama para `contrato`** → las 228 citas de contrato saldrían **sin deep-link** (`null`).
  `compliance_documento` sí matchea (`entityType.includes('compliance')` → `/compliance`).
  **b.0 incluye un cambio menor en `tools.ts`**: agregar `contrato` → `/comercial/contratos` (y
  confirmar `compliance_documento` → `/compliance`). Es código del Copilot, entra en el paquete de
  implementación con sus tests.

## 8. Estrategia de `visibility_key` (corregida tras revisión adversarial)

**Policy RLS de `searchable_items` verificada EN VIVO (cierra el hallazgo A2):**
```
searchable_items_select: has_permission('knowledge.view') AND (
  visibility_key='public_auth'
  OR (visibility_key='staff' AND is_staff())
  OR (visibility_key ~~ 'client:%' AND split_part(...,2)=profiles.client_id de auth.uid())
  OR (visibility_key ~~ 'perm:%' AND has_permission(split_part(visibility_key,':',2)))
  OR is_admin())
```
La rama `perm:%` **funciona y es segura**: `has_permission(slug)` valida contra `user_roles`/
`role_permissions` (o admin). No matchea a cualquier `authenticated`. A2 resuelto.

**⚠️ Gate previo crítico (hallazgo nuevo): TODA la tabla exige `knowledge.view`.** Un piloto sin
ese permiso (ni admin) **no ve ningún documento** aunque el backfill esté hecho. Verificado sobre
los 6 pilotos: Cynthia/Ruth/Martín Rinas (supervisor) tienen `knowledge.view`+`comercial.view`+
`compliance.view`; José Luis y `martin@` son **admin** (ven todo por `current_role()='admin'`);
**`martin.battaglia@` (rol `operaciones`) NO tiene ninguno ni es admin → NO vería documentos.**
Decisión §27.6.

**`visibility_key` corregido (A1 — contratos no van por el módulo documental):**
- **Compliance documentos → `'perm:compliance.view'`** — su módulo real; los pilotos habilitados lo tienen.
- **Contratos → `'perm:comercial.view'`** — **corregido**: los contratos viven en `/comercial/contratos`;
  la frontera es **comercial/legal**, no `documental.view` (que es carga/export documental general y
  ensancharía el privilegio — un titular de `documental.view` vería toda la cartera de contratos y
  podría enumerar clientes, hallazgos A1/M8). `comercial.view` es la frontera correcta.

Se mantiene la coherencia con `knowledge_visibility_for` como **fallback**, pero el backfill usa la
política de arriba (canal de búsqueda documental, distinto del spine de eventos).

**Fail-safe endurecido (M3):** columna `visibility_key` es `NOT NULL`; el mapping usa
`coalesce(<derivado>, 'perm:compliance.admin')` (permiso administrativo restrictivo) para que un
`entity_type` inesperado o una derivación NULL caiga a lo **más restrictivo**, nunca `public_auth`.

**Tightening = riesgo de seguridad, no chore (M2):** si Dirección **endurece** la política sin tocar
las filas fuente, las filas ya proyectadas conservan la clave más permisiva → ventana de sobre-
exposición. Regla: **todo cambio de la política de visibilidad dispara re-backfill INMEDIATO**
(`ai_docs_backfill_apply()` recomputa `visibility_key` de todas las filas), no diferido. Documentado
como acción obligatoria, no como limitación benigna.

## 9. Política PII

- **Se incluye** (metadata no sensible, necesaria para las consultas): título, categoría, tipo,
  organismo, sede, riesgo, fechas, **razón social** del cliente (nombre de empresa, no persona),
  estado del contrato, depósito.
- **Se excluye** (PII / sensible / contenido): **`cuit`** (dato fiscal de la contraparte),
  `extracted_text` / contenido de PDF, `hash_firma`, `md5/sha256`, `drive_file_id` en el índice
  (§10), datos personales de firmantes, cualquier campo de RRHH/caja chica/legajos.
- **Redacción PII en el WRITE path (corregido A3 — no solo en salida):** el hallazgo real es que
  `redactPii()` de F5.2-lite corre en **retrieval** (antes de Gemini), pero el backfill/trigger
  insertan `title`/`body` **crudos** y `tsv` es GENERATED sobre lo almacenado → un DNI/CUIT en un
  `titulo` quedaría persistido en claro, tokenizado y buscable, y podría volver como snippet antes
  de la redacción de salida. **Corrección:** el mapping aplica una **función de redacción SQL**
  (`ai_docs_redact(text)` — patrones CUIT/CUIL/CBU/DNI/email/teléfono, espejo de `guardrails.ts`)
  **al escribir** `title` y `body`. Doble red real: redactado en escritura **y** en salida.
- Validación §22 (grep de patrones PII en `body`) pasa a ser confirmación, no la única defensa.
- Regla: **mínimo dato necesario; ante duda, excluir.**

## 10. Qué metadata se incluye / 11. Qué metadata se excluye

**Incluye:** título, categoría, tipo documental, organismo, sede/depósito, riesgo, estado
(contrato), vencimiento, fecha, razón social del cliente, `public_id`, `entity_id`.

**Excluye (b.0):** texto completo/OCR de PDF, contenido contractual/ANMAT, adjuntos binarios,
imágenes, legajos RRHH, datos fiscales sensibles (`cuit`/CBU/DNI), tokens/secrets, `drive_file_id`
y `url` **en el índice** (el deep-link va al módulo `/compliance` `/comercial/contratos`, no al
binario de Drive — evita exponer identificadores de Drive en el retrieval), hashes.

## 12. Diseño de backfill DRY-RUN (obligatorio, sin escribir)

RPC `ai_docs_backfill_dryrun()` (SECURITY DEFINER, solo lectura) que corre **exactamente el mismo
SELECT que el apply** (M5 — no una condición distinta como "con `drive_file_id`") y devuelve un JSON:
`compliance_total`/`contratos_total`, `proyectados` (filas que el apply insertaría), `con_title_null`
y `con_entity_date_null` (campos clave faltantes — M5/M6, filas que igual se insertarían pero sin
fecha/título), `distribucion_visibility_key` (cuántos por clave; **0 esperado en `public_auth`**),
`pii_detectada_en_body` (patrón CUIT/DNI tras redacción — debe ser 0), `duplicados` (ya en
`searchable_items`), `footprint` (filas + bytes de body). **No escribe una sola fila.** Dirección
revisa el dry-run **antes** de autorizar el apply.

## 13. Diseño de backfill REAL

RPC/migración `ai_docs_backfill_apply()` (o la proyección dentro de la migración 0176) que hace el
`insert … select … on conflict (entity_type, entity_id) do update` para las dos fuentes, con el
mapping §6 y `visibility_key` §8. Ejecutada a mano por Dirección (G3) **después** del dry-run
aprobado. Sin lotes obligatorios (es SQL puro sobre 797 filas, una transacción es viable), pero con
opción de `limit`/`offset` por si Dirección prefiere por tanda.

## 14. Idempotencia

`unique(entity_type, entity_id)` (ya existe en `searchable_items`) + `on conflict do update` →
re-correr el backfill **actualiza** las filas existentes, no duplica. El `tsv` se recalcula solo.

## 15. Batch size

Por defecto: **una transacción** (797 filas es trivial). Opción `p_limit`/`p_offset` para tandas si
Dirección lo prefiere. El dry-run reporta el footprint para decidir.

## 16. Límites de tamaño

`body` truncado a **8 KB** (`left(body, 8192)`) antes de escribir — defensa contra metadata anómala
(hallazgo del panel adversarial). `title` a 512 chars.

## 17. Re-proyección

- **Automática por documento:** trigger incremental (§18) recomputa la fila al cambiar la fuente.
- **Del mapa de visibilidad:** si Dirección cambia la política §8 (p.ej. compliance de
  `perm:compliance.view` a `staff`), **no es retroactivo** sobre filas ya proyectadas cuyo documento
  no cambió → requiere **re-backfill dedicado** (`ai_docs_backfill_apply()` recomputa `visibility_key`
  de todas). Documentado como limitación conocida (decisión §27.1).

## 18. Trigger incremental

`after insert or update on compliance_documents` y `on contract_documents` → llama a una función
`ai_docs_project_row(id)` que hace el upsert de esa fila a `searchable_items`. También `after delete`
→ borra la fila proyectada (§ estrategia de delete). Alternativa: extender los Drive sync existentes
para llamar la proyección tras cada sync (menos triggers, más acoplado). **Recomendación:** trigger
(desacoplado, robusto). Decisión §27.4.

## 19. Qué pasa si cambia la clasificación o visibilidad

- Cambia un **campo del documento** (categoría, riesgo, vencimiento, estado del contrato) → el
  trigger re-proyecta la fila, incluido `visibility_key` recomputado → **no queda stale**. Es la
  ventaja de la proyección incremental sobre un backfill único.
- Cambia el **mapa de visibilidad** (la regla) sin cambiar el documento → §17 (re-backfill dedicado).
- Fail-safe siempre al valor más restrictivo (§8).

## 20. Rollback

- Nivel 0: `delete from searchable_items where entity_type in ('compliance_documento','contrato')`
  → el Copilot vuelve a "sin evidencia" documental; **cero efecto en datos de negocio** (son
  derivados).
- Nivel 1: drop de los triggers + funciones `ai_docs_*`.
- `ROLLBACK_0176.md` en la misma ventana.

## 21. Auditoría

- El backfill (dry-run y apply) se ejecuta a mano por Dirección → queda en el historial del SQL
  Editor. La RPC apply puede registrar un evento resumen (conteo proyectado) sin PII.
- Las **consultas** documentales del Copilot usan la auditoría de F5.2-lite (`ai_messages`/
  `ai_sources`): `ai_sources.entity_type='compliance_documento'|'contrato'` + `public_id` → cada
  respuesta documental es trazable a los documentos que citó.

## 22. Validación SQL (kit read-only)

- Conteo proyectado = esperado (569 + 228 con `drive_file_id`).
- `visibility_key` distribución (cuántos `perm:compliance.view`, `perm:documental.view`, fail-safe).
- 0 filas con `visibility_key='public_auth'` (regla dura).
- 0 `cuit`/DNI en `body` (grep de patrón).
- RLS: `set role authenticated` con dos JWT (uno con `documental.view`, uno sin) → el segundo no ve
  contratos vía `searchable_items`.
- Idempotencia: re-correr apply → conteo estable, sin duplicados.

## 23. QA

TDD sobre las funciones de mapping (unit: fila fuente → fila `searchable_items` correcta +
`visibility_key`); integración (dry-run devuelve conteos correctos; RLS con dos sesiones);
regresión (searchable_items sigue sirviendo `ai_search_knowledge` sin romper). Gates típecheck/lint/
tests/build del repo. Todo en el worktree limpio de implementación (no ahora).

## 24. Smoke con Copilot (post-backfill, autenticado)

Con un piloto real (patrón F5.2-lite): "buscame documentos de Compliance" → answered con citas
`[S#]` a documentos reales + **deep-link vivo** (verificar `/compliance` y `/comercial/contratos`
tras el fix A5); "qué contratos hay para <cliente>" → filtra por razón social; "qué documentos están
por vencer" → usa `entity_date`; **"resumime/qué dice el contrato X"** (incluidos los 2 con
`extracted_text`) → **frase exacta de sin-evidencia** (M7 — confirma que b.0 no proyecta contenido);
RLS cruzada: un piloto con `comercial.view` ve contratos, uno sin (p.ej. rol `operaciones`) **no**;
un piloto sin `knowledge.view` (ni admin) no ve **ningún** documento (gate §8). Verificar auditoría
en `ai_sources` con `public_id` 1:1 al documento (M1).

## 25. Riesgos

| Riesgo | Mitigación |
|---|---|
| `visibility_key` demasiado permisivo (fuga) | fail-safe al `perm:*` más restrictivo; 0 `public_auth`; validación SQL §22; dry-run reporta dudosos |
| PII en body (cuit, DNI en títulos) | exclusión de `cuit`; `redactPii()` antes de Gemini; validación §22 |
| Confundir metadata con contenido | límite explícito §1; sin `extracted_text`; smoke §24 confirma "sin evidencia" para contenido |
| Stale visibility al cambiar el mapa | §17 re-backfill dedicado; documentado |
| Duplicados | `unique(entity_type,entity_id)` + `on conflict` |
| Impacto en Copilot | aditivo; `ai_search_knowledge` ya existe; rollback con un delete |
| Prompt injection documental (futuro) | b.0 es metadata (bajo riesgo); el vector real es b.1 (contenido) — cubierto en el master plan |
| Costo | ~$0 (SQL, sin IA, sin Drive) |

## 26. Revisión adversarial — EJECUTADA sobre este archivo (resultado)

**Corrección de proceso (transparente):** el panel del *master plan* falló por colisión de path
(revisó un archivo distinto). Este diseño se sometió a un **panel nuevo por path absoluto**, con las
3 lentes confirmando `read_ok=true` (verificado por el sintetizador contra el archivo real y contra
`tools.ts`). Resultado: **5 ALTO + varios MEDIO reales, todos incorporados** a este documento:

| # | Hallazgo | Estado | Dónde se corrigió |
|---|---|---|---|
| A1 | contratos con `perm:documental.view` sobre-exponen | ✅ corregido | §8 → `perm:comercial.view` |
| A2 | rama `perm:%` del RLS no verificada (bloqueante) | ✅ verificado en vivo | §8 (policy real + gate `knowledge.view`) |
| A3 | redacción PII solo en salida, `body` crudo persistido | ✅ corregido | §9 → redacción en WRITE path (`ai_docs_redact`) |
| A4 | guard "cero citas" no distingue metadata de contenido | ✅ corregido | §1 → prefijo `[ficha]` + system prompt + QA |
| A5 | deep-link de contrato falta en `entityUrl` (verificado en código) | ✅ corregido | §7 → cambio en `tools.ts` en el paquete |
| M1 | `public_id`=`item_id` no es 1:1 con el documento | ✅ corregido | §6.1 → `item_id#<id8>` |
| M2 | tightening = fail-open silencioso | ✅ corregido | §8 → re-backfill inmediato obligatorio |
| M3 | `visibility_key` sin NOT NULL / fail-safe NULL | ✅ corregido | §8 → NOT NULL + `coalesce` restrictivo |
| M4 | `date::timestamptz` depende del TZ de sesión | ✅ corregido | §6 → TZ canónica fija |
| M5 | dry-run mide condición distinta del apply | ✅ corregido | §12 → mismo SELECT + NULLs |
| M6 | `entity_date` de contrato mezcla firma/vencimiento | ✅ corregido | §6.2 → solo `fecha_fin` |
| M7 | smoke no cubre contratos con texto ni deep-link | ✅ corregido | §24 |
| M8 | razón social permite enumerar cartera | ✅ mitigado | §8 (A1: `comercial.view` acota) |

Hallazgo nuevo de la verificación en vivo: el gate `knowledge.view` deja a **`martin.battaglia@`
(rol `operaciones`) sin acceso documental** — decisión §27.6.

## 27. Decisiones pendientes antes de implementar

1. **`visibility_key` de compliance/contratos** — (A) `perm:compliance.view`/`perm:documental.view`
   (propuesta, fail-safe), (B) `'staff'`, (C) `client:%` para contratos (no recomendado). Y política
   de re-proyección al cambiar el mapa (§17).
2. **`entity_date` de compliance** — ¿`fecha_vencimiento` (propuesta, útil para "por vencer") o
   `fecha_emision`?
3. **Razón social en el body** — confirmar que incluir el nombre de la empresa cliente (no el cuit)
   es aceptable para búsqueda ("contratos de tal cliente").
4. **Mecanismo incremental** — trigger (propuesta) vs extender los Drive sync.
5. **Deep-link** — al módulo (`/compliance`, `/comercial/contratos`) sin exponer `drive_file_id`
   (propuesta) vs deep-link directo al binario de Drive (más exposición). Requiere el fix de
   `tools.ts` (§7/A5).
6. **Permisos de los pilotos (nuevo, del gate `knowledge.view`)** — `martin.battaglia@` (rol
   `operaciones`) no vería ningún documento. Opciones: (a) aceptar que solo los pilotos con
   `knowledge.view`/admin vean documentos en b.0 (5/6); (b) asignarle `knowledge.view` +
   `comercial.view`/`compliance.view` por el flujo normal; (c) revisar su rol. **No lo resuelve
   esta fase** (no se toca RBAC); es decisión de Dirección.

## 28. Criterio GO / NO GO para implementación local

**GO a implementación LOCAL de b.0 cuando:** Dirección resuelva §27 (principalmente 27.1); se cree el
worktree limpio desde `ccd9063`; y se apruebe el spec de la migración 0176 (dry-run + apply + trigger
+ rollback). Es aditivo, idempotente, reversible, ~$0, sin Drive/embeddings/cron.

**NO GO (sigue vigente):** extracción de texto (b.1), embeddings/pgvector (b.2), fuentes sensibles,
backfill real sin dry-run aprobado, tocar Drive/Knowledge drain, `RBAC_ENFORCE`, `main`, deploy.

**Hoy: NO GO a implementación. GO solo a las decisiones §27 y a la revisión adversarial de este diseño.**

---

*Nada implementado. Verificación read-only (columnas, funciones, conteos, permisos). Sin migraciones,
sin backfill, sin tocar Drive/Knowledge drain/RBAC/producción/main. Detenerse tras el informe.*

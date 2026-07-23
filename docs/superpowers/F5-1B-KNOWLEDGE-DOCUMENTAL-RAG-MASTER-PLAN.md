# F5.1-b — Knowledge documental / Drive / RAG — MASTER PLAN

> **Estado: 🟢 F5.1-b.0 CERRADA (EN PROD 2026-07-03) · b.1/b.2 siguen NO-GO.**
> Fecha: 2026-07-03 · Deriva de F5.2-lite (CERRADA, Gemini live). Gobernanza G1–G11.
> **b.0 (backfill de METADATA): implementado, aplicado y validado en prod** (migs 0176/0177,
> 797 fichas, smoke vivo PASS) — ver `F5-1B-0-CLOSURE-REPORT.md`. **b.1 (extracción de texto)
> y b.2 (embeddings/pgvector): NO-GO** hasta plan propio de cada uno. Mejoras de retrieval de b.0
> en `F5-1B-0-1-DOCS-RETRIEVAL-BACKLOG.md`. Estado base verificado en vivo (read-only) — §5.

---

## 1. Resumen ejecutivo

F5.2-lite dejó al Copilot respondiendo sobre datos **estructurados** con citas, auditoría y
presupuesto, servido por Gemini para 6 pilotos. F5.1-b lo extiende a **documentos**: buscar, leer,
resumir y citar el contenido real de compliance, contratos, ANMAT, clientes, propuestas y
documentación operativa que hoy vive en Drive.

Hallazgo central de la verificación (§5): **la metadata documental ya existe y es rica** —
569 documentos de compliance + 228 contratos, **todos con `drive_file_id`**, sincronizados por
workflows de Drive que ya corren— pero **el contenido casi no está extraído** (2/228 contratos con
texto) y el spine documental de búsqueda (`searchable_items`, `knowledge_documents`,
`knowledge_chunks`) está **vacío**. Existe un módulo RBAC `documental.*`/`knowledge.*` reutilizable.

Esto ordena una secuencia de **bajo-a-alto riesgo**, cada una entregable por separado:

- **F5.1-b.0 — Backfill de METADATA** (proyectar los 797 docs ya existentes a `searchable_items`):
  el Copilot busca documentos por título/categoría/estado/vencimiento **de inmediato**, sin tocar
  Drive, sin extracción, sin PII de contenido, ~$0, idempotente, reversible. **Máximo valor / mínimo
  riesgo.** Convierte "buscame documentos de compliance" de "sin evidencia" a respuesta real.
- **F5.1-b.1 — Extracción de TEXTO (Document Intelligence)**: pipeline Drive→texto→chunks para
  buscar *dentro* del contenido y citar pasajes. Trabajo pesado, PII real, por lotes acotados.
- **F5.1-b.2 — Búsqueda semántica (embeddings + pgvector)**: solo si el FTS léxico no alcanza.

**Recomendación:** GO a diseño detallado de **F5.1-b.0**; NO GO a extracción masiva y embeddings
hasta plan propio + decisiones de PII/costo/Drive/proveedor.

## 2. Objetivo de F5.1-b

Que el Copilot pueda, respetando permisos y con cita de fuente: (a) **encontrar** documentos por su
metadata; (b) **leer y buscar dentro** del contenido; (c) **resumir** contratos/certificados y
detectar vencimientos/inconsistencias; (d) **citar** el documento y, cuando haya texto, el pasaje.
Todo read-only, sin escribir sobre documentos, sin agentes, sin acciones automáticas.

## 3. Alcance incluido

1. **F5.1-b.0**: proyección de metadata de `compliance_documents` + `contract_documents` a
   `searchable_items` (con `visibility_key`), mantenida incremental por el sync existente.
2. **F5.1-b.1**: pipeline de extracción de texto (PDF con capa de texto, gdoc/gsheet export, OCR
   para escaneados) → `extracted_text` + `knowledge_chunks`; búsqueda FTS sobre contenido; resumen
   de documentos vía Gemini; citas de pasaje.
3. **F5.1-b.2** (condicional): embeddings de chunks + pgvector para búsqueda semántica.
4. Reuso del Copilot F5.2-lite (gate de piloto, RLS, guardrails PII, citas validadas, presupuesto).

## 4. Alcance excluido

- Escritura sobre documentos (renombrar, borrar, mover en Drive) — **nunca**.
- Agentes autónomos, acciones automáticas, creación de tareas/incidentes.
- WhatsApp y Email productivo.
- Fuentes sensibles iniciales: **RRHH/legajos, caja chica** (financiera), documentos sin clasificar.
- Imágenes/planos DWG/videos MP4 como fuente de texto (no son texto; fuera de alcance inicial).
- Backfill masivo a ciegas, embeddings, pgvector e indexación productiva **hasta plan aprobado**.
- Tocar el Knowledge drain o los Drive sync existentes hasta plan aprobado (`MAIN-RECONCILIATION`).

## 5. Estado actual verificado (read-only, 2026-07-03, EN EL MOMENTO)

| # | Ítem | Valor |
|---|------|-------|
| 1 | `/api/version` | `ccd9063` (environment production) |
| 2 | Deploy publicado | `6a476090946ef1abe8a1322a` · **locked** |
| 3 | Env Copilot | `AI_ENABLED=1`, `AI_PROVIDER=gemini` (`gemini-2.5-pro`) |
| 4 | Última migración | `0175_ai_rbac_seed` (F5.2-lite) |
| 5 | `searchable_items` | **0** (proyección FTS vacía) |
| 6 | `knowledge_events` | **306**, todos `processed`, último hoy (spine operativo activo) |
| 7 | Knowledge drain | workflow `knowledge-drain.yml` existe pero **NO en la default branch** (inerte, como el outbox — depende de `MAIN-RECONCILIATION`) |
| 8 | Drive sync | workflows `compliance-drive-sync`, `contratos-drive-sync`, `caja-chica-drive-sync` **activos**; compliance último sync `2026-07-02` |
| 9 | `compliance_documents` | **569**, 569/569 con `drive_file_id`; mimes: pdf, msword, gdoc, gsheet, xls, jpg, png, dwg, email, md, mp4 |
| 10 | `contract_documents` | **228**, 228/228 con `drive_file_id`; **2 con `extracted_text`** (`text_source` ∈ gdoc/pdf_text/none) |
| 11 | spine documental | `knowledge_documents`=0, `knowledge_chunks`=0, `knowledge_entities`=0, `knowledge_annotations`=0; `knowledge_sources`=11 |
| 12 | pgvector | **disponible, NO instalado** (`create extension vector` posible) |
| 13 | Permisos RBAC documentales | `compliance.view/edit`, `documental.view/create/delete/export/admin`, `knowledge.view/create/edit/delete/admin` (ya existen) |
| 14 | Nada modificado | solo `curl`, `netlify api`, `list_migrations`, `execute_sql` SELECT, `gh run list`, `ls` |

## 6. Estado de `searchable_items`

Tabla de proyección plana con `tsv tsvector GENERATED` (español, título+body), `visibility_key`,
`entity_type/entity_id`, `public_id`, `status`, `entity_date`, `unique(entity_type, entity_id)`,
GIN sobre `tsv` + índice por `visibility_key`. **Vacía (0 filas)** — el backfill nunca corrió.
Es la tabla que `ai_search_knowledge` (F5.2-lite) ya consulta → poblarla habilita la búsqueda
documental por metadata **sin código nuevo en el Copilot**.

## 7. Estado de `knowledge_events`

306 eventos, todos `processed`, último hoy — el spine **operativo** (incidentes/tareas/etc.) está
vivo y se alimenta. Pero son eventos de módulos, **no documentales**: no hay proyección de
documentos al spine todavía. F5.1-b agrega la vía documental.

## 8. Estado del Knowledge drain

El endpoint `/api/knowledge/drain` existe (fail-closed por `CRON_SECRET`) y el workflow
`knowledge-drain.yml` existe en la rama pero **no en la default branch** → operativamente **apagado**
(mismo patrón que el outbox: los schedules de GH Actions solo corren desde la default branch). No se
toca hasta plan aprobado; su activación depende de `MAIN-RECONCILIATION`.

## 9. Estado de Drive / Compliance / contratos

Los Drive sync ya funcionan y son la fuente de la metadata: `compliance-drive-sync` mantiene los
569 docs de compliance (último `2026-07-02`), `contratos-drive-sync` los 228 contratos. La SA de
Google Drive está configurada (incidente Drive 2026-07 cerrado; carpeta compliance nueva verde).
**F5.1-b.0 no necesita tocar Drive** — reusa la metadata que estos syncs ya traen. F5.1-b.1 sí
leería los binarios vía `drive_file_id`, reusando la SA existente (sin nuevo sync).

## 10. Fuentes documentales autorizadas (propuesta)

| Fuente | Origen | b.0 (metadata) | b.1 (texto) | Sensibilidad |
|---|---|---|---|---|
| Compliance (habilitaciones, certificados) | `compliance_documents` (569) | ✅ | según doc | media |
| Contratos | `contract_documents` (228) | ✅ | ⚠️ PII alta | alta |
| ANMAT (dentro de compliance) | `compliance_documents` | ✅ | según doc | media (habilitación = del cliente, no TOPS) |
| Clientes (documentación) | Drive / vínculos | fase posterior | fase posterior | alta |
| Propuestas / comercial | Drive | fase posterior | fase posterior | media |
| Documentación operativa / manuales | repo / Drive | fase posterior | fase posterior | baja |

Regla: **allowlist explícita** — una fuente no listada no es consultable aunque exista.
Candidatos de b.0: compliance-metadata + contratos-metadata.

## 11. Fuentes excluidas

RRHH/legajos, caja chica (financiera), documentos sin clasificar, WhatsApp/Email productivo,
binarios no-texto (imágenes, DWG, MP4). Si algo aparece como necesario → fase futura documentada,
no implementado.

## 12. Política PII documental

- **b.0 (metadata):** riesgo bajo (títulos/categorías/fechas). Redacción defensiva sobre el body.
- **b.1 (texto):** riesgo ALTO (contratos: DNI/CUIT/domicilios/firmas). Requisitos previos:
  - Política PII documental **aprobada por Dirección**: qué se indexa, qué se redacta, qué se
    excluye (RRHH fuera, como en F5.2-lite).
  - Redacción en el **pipeline de extracción** (no solo en el prompt): enmascarar PII **antes** de
    persistir en `knowledge_chunks` y antes de que viaje a Gemini.
  - Términos de datos de **Google AI** confirmados (no-training/retención) para contenido documental.
- La redacción reusa `guardrails.ts` de F5.2-lite (CUIT/CBU/DNI/email/teléfono), extendida a
  patrones documentales.

## 13. Permisos / RLS / RBAC

- `searchable_items` ya tiene RLS por `visibility_key` (`public_auth`/`staff`/`client:%`/`perm:%`).
  El backfill **debe setear el `visibility_key` correcto por documento**, reusando los permisos
  existentes: compliance → `perm:compliance.view` (o `staff`); contratos → `perm:documental.view`
  (o `perm:contratos.*` si se crea). **No se crea ni activa RBAC nuevo** en b.0 (los permisos ya
  existen); no se toca `RBAC_ENFORCE`.
- El Copilot ya consulta con la sesión RLS del usuario → hereda estas policies sin código de
  permisos nuevo. Documento que el usuario no puede ver → no aparece en el retrieval.
- `knowledge_chunks` (b.1) nace con RLS espejo del documento origen; la ACL por fila se aplica
  **antes** del ranking (léxico o vectorial).

## 14. Diseño de backfill seguro

Principio: **incremental, idempotente, auditado, con dry-run — nunca masivo a ciegas** (G3/G5).

**b.0 (metadata):**
- RPC/migración de proyección: `compliance_documents` + `contract_documents` → `searchable_items`
  (`entity_type='compliance_documento'|'contrato'`, `title`, `body`=metadata textual concatenada,
  `public_id`=item_id/id, `entity_date`=vencimiento/fecha, `visibility_key` por §13).
- **Dry-run primero:** una función que devuelve el conteo y una muestra de lo que proyectaría, sin
  escribir — Dirección revisa antes del insert real.
- Idempotente por `unique(entity_type, entity_id)`.
- Mantenimiento incremental: trigger `after insert/update` en las tablas fuente (o extensión del
  sync existente), no un backfill único que se desactualiza.
- **Semántica de `visibility_key` (crítica para no filtrar):**
  - El trigger incremental **recomputa el `visibility_key` en cada update del documento fuente**
    → si un documento cambia de clasificación/propiedad, su fila proyectada se actualiza sola. Es
    la ventaja de la proyección incremental sobre un backfill único (que quedaría *stale*).
  - **Limitación conocida:** un cambio en el **mapa de visibilidad** (la regla que traduce
    fuente→`visibility_key`, p.ej. si compliance pasa de `staff` a `perm:compliance.view`) **no es
    retroactivo** sobre filas ya proyectadas cuyo documento fuente no cambió — requiere una
    **re-proyección dedicada** (no la idempotencia normal). El mapa vive en un único punto (función
    `knowledge_visibility_for(...)`) con comentario de versión; cambiarlo exige re-backfill
    explícito. Registrar como decisión §30.7.
  - Fail-safe: ante duda en la derivación, `visibility_key` cae al valor **más restrictivo**
    (`staff` o el `perm:*` correspondiente), nunca a `public_auth`.
- **Cap de tamaño defensivo:** el `body` proyectado (metadata concatenada) se trunca a un máximo
  (p.ej. 8 KB) antes de escribir — evita filas patológicas si un documento tiene metadata anómala.
- Rollback: `delete from searchable_items where entity_type in ('compliance_documento','contrato')`.

**b.1 (texto):** por lote acotado (p.ej. 20 docs) con checkpoint + reintento; nunca en una
transacción única; empezar por el subconjunto de menor sensibilidad.

## 15. Diseño de extracción de texto (b.1)

- Por tipo: PDF con capa de texto → parser (pdf-parse/pdfjs); PDF escaneado → OCR; gdoc/gsheet →
  export de Drive API; el resto (imágenes/DWG/MP4) fuera de alcance.
- OCR: decisión entre **Gemini vision** (coherente con el proveedor) vs la **integración OpenAI ya
  existente para OCR de compras** (reuso). Recomendación: evaluar Gemini vision para unificar.
- El texto extraído se guarda en `extracted_text` (ya existe la columna) + se chunkea (§16).
- Pipeline server-side, disparado por lote (no cron hasta `MAIN-RECONCILIATION`), auditado.

## 16. Diseño de chunks

- `knowledge_chunks` (tabla del spine, hoy vacía): `document_id`, `entity_type/entity_id` origen,
  `chunk_index`, `content` (texto redactado de PII), `page`/`char_offset` (para citar el pasaje),
  `tsv` español (GIN), `visibility_key` espejo del documento, `content_hash`.
- Chunking por tamaño (~800–1200 tokens) con solape leve; metadata de página para reconstruir cita.
- Columna `embedding vector(N)` **NULLABLE**, poblada solo en b.2 si hay GO.

## 17. Citas documentales

- Reusa el mecanismo endurecido de F5.2-lite (chips `[S#]` validados; parser tolera simples/grupos/
  rangos tras el hallazgo del piloto Gemini).
- Cita documental = deep-link a la entidad (`/compliance`, `/comercial/contratos`) **y**, con texto,
  referencia de pasaje (`page`/offset del chunk). El chunk lleva lo necesario para reconstruirla.
- Anti-alucinación intacta: cita válida o "No tengo evidencia suficiente en Nexus para afirmarlo";
  el guard "evidencia recuperada pero 0 citas → degradar" ya aplica.

## 18. Resumen de PDFs (Document Intelligence)

- "resumime este contrato", "qué dice el certificado X", "detectá vencimientos". Pipeline: recuperar
  chunks del doc (RLS) → Gemini resume/extrae → resultado como **metadata sugerida** con estado
  `pending_review` (nunca pisa metadata validada, G2/G10). Read-only sobre el documento.
- ANMAT: la habilitación es del **cliente**, no de TOPS — respetar en todo copy.

## 19. Estrategia embeddings — ¿sí o no?

**DIFERIR (evaluar en b.2 con evidencia).** El FTS español ya cubre búsqueda léxica de metadata y
de texto con costo cero de indexación y sin proveedor externo. Embeddings agregan semántica
(paráfrasis/sinónimos/lenguaje natural) pero suman costo (generar embeddings de 797+ docs y chunks),
complejidad (pgvector, refresh, ACL por fila) y dependencia de proveedor. **Criterio de decisión:**
medir en b.1 la tasa de "sin evidencia"/recall del FTS sobre contenido real; si el léxico falla en
consultas naturales frecuentes → GO a embeddings. Proveedor coherente: **Gemini `gemini-embedding`**.

## 20. pgvector — ¿sí o no?

Disponible, no instalado. `create extension vector` es decisión de **b.2**, no de b.0/b.1 — no se
instala hasta que embeddings tengan GO. Al activar: índice `hnsw`; **ACL por fila ANTES del vector
search** (la seguridad no depende del ranking); refresh incremental colgado del pipeline.

## 21. Costos estimados

| Concepto | Cuándo | Estimación / contención |
|---|---|---|
| Backfill metadata | b.0 | **~$0** (SQL, sin IA, sin Drive) |
| Extracción de texto | b.1 | Drive API (gratis) + OCR solo escaneados (costo/página) — acotar por lote |
| Resumen/consulta Gemini | b.1+ | presupuesto F5.2-lite (`AI_MONTHLY_BUDGET_USD`, ~$0.005–0.012/consulta; más contexto documental = más tokens_in) — monitorear `ai_monthly_spend()` |
| Embeddings | b.2 | costo único de indexar (~797 docs + chunks) + refresh; presupuesto propio |
| pgvector | b.2 | sin licencia; cómputo del índice |

## 22. Retención y limpieza

- `searchable_items`/`knowledge_chunks` son **derivados** (regenerables desde la fuente) →
  retención flexible; se pueden truncar y reproyectar. No son fuente de verdad.
- Auditoría IA (`ai_messages`, §23) hereda la política de F5.2-lite: texto pleno 180d (propuesta,
  job de depuración manual pendiente), metadata/hash indefinida.
- El texto extraído (`extracted_text`) es cache del documento; se re-extrae si cambia el `sha256`.

## 23. Auditoría

- Toda consulta documental usa la misma auditoría de F5.2-lite (`ai_sessions`/`ai_messages`/
  `ai_sources`): provider, model, tokens, costo, outcome, y **fuentes citadas = documentos/pasajes**
  (`ai_sources.entity_type='compliance_documento'|'contrato'`, `public_id`, `excerpt_hash`).
- Trazabilidad completa: de una respuesta se reconstruye qué documentos/chunks vio el Copilot.

## 24. Seguridad / prompt injection documental

- **Riesgo nuevo:** el contenido de un documento (contrato, PDF de un tercero) es **untrusted
  input** y podría contener instrucciones ("ignorá tus reglas…"). Defensa: mismos bloques
  `<nexus_source>` delimitados de F5.2-lite; el system prompt trata el contenido documental como
  datos, nunca instrucciones. El catálogo sigue read-only → un injection no puede ejecutar nada.
- **Exfiltración cross-usuario:** RLS por `visibility_key` en `searchable_items`/`knowledge_chunks`
  → un documento que el usuario no puede ver no entra al retrieval. Test con dos cuentas.
- **PII a Gemini:** redacción en el pipeline antes de persistir/enviar (§12).
- Sin `service_role` en retrieval (regla F5.2-lite, test estructural).

## 25. Plan de TDD

- Unit: proyección metadata → filas correctas + `visibility_key` correcto; redacción PII documental
  (fixtures de contratos con DNI/CUIT); chunking (tamaño/solape/offset de página); parser de citas
  de pasaje.
- Integración (DB local/staging): dry-run de backfill (conteo sin escribir); RLS con dos sesiones
  (usuario sin `documental.view` no recupera contratos); idempotencia (re-proyectar no duplica);
  extracción por tipo (pdf/gdoc) sobre fixtures.
- E2E (provider mock): "buscá documentos de compliance" → answered con citas documentales; "sin
  evidencia" cuando el documento no es visible.

## 26. Plan de QA

Smoke autenticado por Dirección/piloto (patrón F4/F5.2-lite): buscar documento por título/categoría
→ resultado con cita; RLS cruzada (piloto sin permiso de contratos no ve contratos); resumen de un
contrato (b.1) → correcto y read-only; pregunta-trampa de PII → redactada; presupuesto/kill-switch.
Con evidencia real (G5), checklist 10 entregables + GO/NO GO.

## 27. Revisión adversarial

Red-team pre-deploy de cada sub-fase (estándar F4.4/F5.2-lite: 0 bloqueantes): (1) injection vía
contenido de PDF/gdoc; (2) exfiltración cross-usuario con dos cuentas reales; (3) cita/pasaje
falsificado; (4) fuga de PII a Gemini o a la auditoría; (5) backfill que proyecta un documento con
`visibility_key` incorrecto (más permisivo de lo debido); (6) OCR/extracción que introduce contenido
malicioso. Criterio: ALTOs corregidos antes de GO.

## 28. Rollback

- **b.0:** `delete from searchable_items where entity_type in ('compliance_documento','contrato')`
  → Copilot vuelve a "sin evidencia" documental; sin efecto en negocio.
- **b.1:** `extracted_text`/`knowledge_chunks` derivados → truncar sin pérdida; `AI_ENABLED=0` apaga
  el Copilot si hiciera falta.
- **b.2:** `drop extension vector cascade` (o columna sin usar); revertir a FTS.
- Cada sub-fase con `ROLLBACK_*.md`.

## 29. Migraciones previstas (si hicieran falta — NO creadas)

- **b.0:** `0176_knowledge_docs_projection` (RPC/función de proyección + trigger incremental +
  dry-run) + `ROLLBACK_0176.md`. Números tentativos; confirmar el siguiente libre al momento (hoy
  última = `0175`; siguiente libre `0176`).
- **b.1:** `017x_knowledge_chunks_docs` (esquema de chunks documentales + RLS + FTS) + pipeline
  (código, no migración).
- **b.2:** `017x_knowledge_embeddings_pgvector` (extensión + columna + índice) — solo con GO.
- Aplicación: a mano por Dirección (G3), previa entrega, dry-run y OK.

## 30. Decisiones pendientes de Dirección

1. **¿GO a diseño detallado de F5.1-b.0** (backfill de metadata)? — recomendado.
2. **Política de PII documental** (qué se indexa/redacta/excluye) — prerrequisito de b.1.
3. **Términos de datos de Google AI** para contenido documental (no-training/retención) — gobernanza.
4. **Orden de extracción** (compliance no-sensible antes que contratos).
5. **Embeddings:** diferir hasta medir FTS (recomendado) o adelantar; y **proveedor de embeddings**
   (`gemini-embedding` recomendado).
6. **`MAIN-RECONCILIATION`:** resolver antes de cualquier cron/drain de F5.1-b.
7. **`visibility_key` de contratos:** ¿`perm:documental.view`, un nuevo `perm:contratos.view`, o
   `client:%`? — define quién ve qué en el retrieval documental. **Y política de re-proyección**
   cuando cambie el mapa de visibilidad (no es retroactivo por diseño; §14).
8. **Retención** del texto extraído y de la auditoría documental.

## 31. Criterios GO / NO GO para implementación local

**GO a implementación LOCAL de F5.1-b.0 cuando:** Dirección apruebe el diseño detallado (spec de la
proyección + `visibility_key` por fuente + migración 0176 dry-run); QA definido; sin dependencia de
Drive/embeddings/cron. Es aditivo, idempotente y reversible.

**NO GO (hasta plan y decisiones propias):**
- Extracción de texto (b.1) — requiere política PII documental + términos Google AI + orden +
  estrategia OCR.
- Embeddings/pgvector (b.2) — requiere evidencia de que el FTS no alcanza + presupuesto +
  `MAIN-RECONCILIATION`.
- Fuentes sensibles (clientes/caja chica/RRHH), backfill masivo sin dry-run, tocar Drive/Knowledge
  drain, `RBAC_ENFORCE`, `main`, deploy.

**Hoy: NO GO a implementación. GO solo a la fase de decisión (§30) y al diseño detallado de b.0.**

---

*Nada implementado. Verificación read-only (conteos + extensiones + workflows + permisos). Sin
migraciones, sin backfill, sin tocar Drive, Knowledge drain, RBAC ni producción. Detenerse tras el
informe; esperar aprobación de Dirección.*

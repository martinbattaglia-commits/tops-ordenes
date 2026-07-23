# Nexus Copilot · Slice C — Plan formal de capas de conocimiento (2/3/4)

> **Estado del documento:** DISEÑO / SCOPE FORMAL. **Nada implementado.** Sin código, sin migraciones creadas ni aplicadas, sin ingesta, sin backfill, sin reproyección, sin tocar Supabase/Netlify/prod, sin push/commit/merge/deploy.
> **Autor de la decisión ejecutiva:** Martín Battaglia (Dirección).
> **Fecha:** 2026-07-07 · **Rama base:** `fix/f5-2-copilot-context-retrieval` @ `b8b7c33`.
> **Principio rector (decisión de Dirección):** **NotebookLM investiga · Drive conserva · Nexus indexa · Copilot responde.**

> ⚠️ **CORRECCIÓN 2026-07-07 (post-preflight, ver `COPILOT_C0_SPINE_PREFLIGHT_REPORT.md`):** dos supuestos de este plan quedaron **FALSADOS** por verificación read-only en prod:
> 1. **El spine NO está dormido — está ENCENDIDO.** `searchable_items` = **800 filas**, 0176-0179 **aplicadas**, backfill **corrido**, en sync 1:1. **⇒ C0 se ELIMINA (ya hecho); queda como health-check.**
> 2. **"Próxima migración libre 0185" es INCORRECTA.** Prod registra hasta 0179, pero objetos de 0183/0184 **existen sin registrar** y 0180/0181/0182 **faltan** (deriva de trazabilidad). **La numeración de C1 se define tras reconciliar esa deriva.**
> El resto del plan (arquitectura Drive→spine, capas 2/3/4, roadmap C1/C2/C4/C5) sigue vigente.

---

## 1. Resumen ejecutivo

Los Slices A/B/Pirámide construyeron el **esqueleto** del Copilot: ruteo por capa (intent-classifier), prioridad de lo interno (veto global), trazabilidad (citas `S#`) y honestidad (declara brechas, no inventa). Hoy **solo la Capa 1 (Nexus OS) tiene fuentes reales conectadas**; las Capas 2, 3 y la mitad "actualidad" de la 4 están **ruteadas pero sin fuente**.

**Slice C conecta las fuentes.** Su objetivo es que el Copilot pase de *"entiendo a qué capa pertenece esta pregunta"* a *"tengo la fuente real para responderla con profundidad y citarla"*.

Tres hallazgos de la auditoría que ordenan todo el plan:

1. **~~El spine documental está DORMIDO~~ → CORREGIDO: está ENCENDIDO** (ver banner arriba + preflight). Verificación read-only en prod: **0176–0179 aplicadas, backfill corrido, `searchable_items` = 800 filas** (569 compliance + 231 contratos), FTS 100%, 0 duplicados, en sync 1:1 con `ai_docs_projection`; `ai_search_knowledge`/`ai_docs_browse` **vivos**. El supuesto original (dormido/vacío) venía de comentarios stale del repo (`0174_ai_core.sql:136-138`). *Los módulos de Capa 1 además leen sus tablas de dominio directo.*
2. **No hay embeddings ni pgvector en ningún lado.** El retrieval es 100% full-text (`tsvector` español) + `pg_trgm`/ILIKE + metadata. Las tablas `knowledge_documents` / `knowledge_chunks` existen como **scaffold vacío** (sin columna vector, sin writers).
3. **Tu decisión ejecutiva unifica Capa 2 y Capa 3 en un solo pipeline.** Institucional (Capa 2) y research/NotebookLM (Capa 3) se ingieren por el **mismo camino**: Drive como biblioteca canónica → proyección al spine de Nexus → Copilot. NotebookLM **no** se conecta al runtime productivo; queda como laboratorio humano upstream y lo valioso se exporta a Drive.

**Recomendación de orden:** `C0 (encender el spine existente) → C1 (institucional) → C2 (research vía Drive) → C4 (actualidad/oficiales) → C3 (semántico/pgvector, opcional) → C5 (reportes mixtos)`.

---

## 2. Estado actual de la pirámide (verificado en código)

| Capa | Ruteo | Fuente conectada | Evidencia |
|------|:---:|:---:|-----------|
| **1 · Nexus OS** | ✅ default + veto global | ✅ **12 módulos vivos** (vía RPCs de dominio) | `coverage-source.ts:26-37` |
| **1 · búsqueda full-text general** | ✅ `search_knowledge`/`docs_browse` | 🟠 **construida pero DORMIDA** (`searchable_items`=0) | `0174_ai_core.sql:136-138` |
| **2 · Institucional TOPS** | ✅ `company_institutional` | 🔴 sin ingesta | `coverage-source.ts:45` |
| **3 · NotebookLM / research** | ✅ `internal_research` | 🔴 sin conector | `coverage-source.ts:46` |
| **4 · Gemini general/web** | ✅ static→Gemini / current→limitación | 🟡 **estático SÍ / actualidad NO** | `coverage-source.ts:47` + `providers/gemini.ts:154` (sin grounding) |

**Rectores respetados hoy:** Prioridad ✅ (veto global `intent-classifier.ts:104-109`) · Trazabilidad ✅ (`S#`) · Honestidad ✅ (declara brechas).

### 2.1 Clasificación por tipo de trabajo (tu aclaración #6)

| # | Ítem | Categoría | Detalle |
|---|------|-----------|---------|
| A | 12 módulos de dominio (facturación, contratos, tesorería, compliance, vacancia, compras, operación, organigrama…) | **Ya existe** | RPCs `ai_*` sobre tablas de dominio, RLS por sesión |
| B | Comparaciones m/m (Slice B) | **Ya existe** (matriz de cobertura desactualizada: fila la declara "brecha" — corregir) | `spend_comparison`, billing m/m |
| C | `searchable_items` / `ai_docs_projection` / `ai_docs_backfill_apply` | **Existe, requiere aplicar migración + backfill** | 0176–0179 entregadas NO aplicadas |
| D | Capa 2 institucional | **Requiere ingesta** (Drive→Nexus) | sin fuente |
| E | Capa 3 research | **Requiere ingesta** (NotebookLM→Drive→Nexus) | sin fuente; inventario real pendiente |
| F | Nuevas tablas/vistas/entity_types de KB | **Requiere migración** (desde 0185) | idempotente, entregada NO aplicada |
| G | Inventario real de cuadernos NotebookLM · re-auth · export a Drive · carpetas Drive KB | **Requiere permisos/intervención tuya** | operativo, humano |
| H | Grounding / FX / news / normativa oficial | **Requiere integración externa** | env keys + proveedor + política PII |
| I | pgvector / embeddings | **Requiere integración externa + migración** | hoy no existe; opcional C3 |

---

## 3. Auditoría Capa 2 — Conocimiento institucional (Fase 1)

**Modelo elegido (tu aclaración #4):** *Drive = biblioteca canónica / staging documental · Nexus = índice consultable · Copilot = capa de respuesta.* Nada se scrapea ni ingiere en este documento; solo se inventaria y diseña.

### 3.1 Fuentes web institucionales

| Fuente | URL | Estado URL | Contenido | Unidad de negocio | Prioridad | Frecuencia cambio | Método sugerido |
|--------|-----|-----------|-----------|-------------------|:---:|:---:|-----------------|
| Sitio principal | `logisticatops.com` | ✅ confirmada | Servicios, propuesta de valor, quiénes somos | Corporativo | Alta | Baja/media | Export curado → Drive (no crawler auto) |
| Cargas Generales (institucional) | `logisticatops.com/cargas-generales` | ✅ confirmada | Servicio Cargas Generales institucional | Cargas Generales | Alta | Baja | Export → Drive |
| Cargas Generales (landing campañas) | `cargasgenerales.logisticatops.com` | ✅ confirmada (repo separado) | Landing de captación (NO duplicado del institucional) | Cargas Generales | Media | Media | Export → Drive (marcar como copy comercial) |
| ANMAT / Regulados (landing) | `tops-anmat-regulados.netlify.app` | ✅ confirmada (sitio dedicado) | Almacenamiento regulado, cubículos, RNE | Regulados/ANMAT | Alta | Baja | Export → Drive |
| Nexus (landing de producto) | `main.logisticatops.com` / `tops-nexus-landing` | 🟡 a confirmar relevancia | Venta del producto Nexus (¿institucional TOPS?) | Producto | Baja | Media | Decisión: ¿incluir? |
| Otros landings/microsites | — | 🔴 a confirmar | Posibles landings de marketing/campañas | Varias | ? | ? | Pedir URLs a Martín |

> **Datos validados a preservar (memoria):** ANMAT — cubículos **22 y 16 m²** (NUNCA 25), **26 totales**; **Pedro Luján 3159** vs **Magaldi 1765**; **RNE del cliente**, no de TOPS. La habilitación ANMAT/RNE es del **cliente**. Estos hechos son clave para el copy y deben viajar como metadata de la fuente.

### 3.2 Documentos corporativos (Drive)

| Documento | Dónde vive hoy | Estado | Prioridad | Método |
|-----------|----------------|--------|:---:|--------|
| Dossier comercial | Drive corporativo | 🔴 no ingerido | Alta | Carpeta Drive KB → Nexus |
| Propuestas / propuesta de valor | Drive | 🔴 no ingerido | Alta | Drive KB → Nexus |
| Código de ética | Drive | 🔴 no ingerido | Media | Drive KB → Nexus |
| Habilitaciones / RNE / certificados | Parcial en Nexus (compliance) | 🟠 parcial | Alta | Reusar compliance + KB institucional |
| Presentaciones institucionales | Drive | 🔴 no ingerido | Media | Drive KB → Nexus |
| Identidad / marca / servicios | Drive / web | 🔴 no ingerido | Media | Drive KB → Nexus |
| `tops-todo-en-uno-deliverables` | `~/CODE/tops-todo-en-uno-deliverables/` | 🔴 no ingerido | Media | Curar → Drive KB |

**Entregable Capa 2:** carpeta Drive **"Nexus Knowledge Base — Institucional"** con subcarpetas por unidad de negocio; cada documento con metadata mínima (título, unidad, tipo, fecha, confiabilidad, fuente/URL). Nexus la ingiere por el pipeline común (§5).

---

## 4. Auditoría Capa 3 — NotebookLM / Research (Fase 2)

**Modelo elegido (tu aclaración #5 + decisión ejecutiva):**
*NotebookLM = laboratorio de investigación · Drive Knowledge Base = versión productiva y curada · Nexus = ingesta, índice, trazabilidad y fuentes · Copilot = respuesta final.*
**NotebookLM NO es dependencia directa del Copilot productivo.** Se usa como fuente de investigación; lo valioso se **exporta a Drive** y desde ahí Nexus lo ingiere (mismo pipeline que Capa 2).

### 4.1 Estado del acceso desde Claude Code (skill `notebooklm`)
- Acceso: **autenticado**, pero el estado del browser tiene **~51 días** → puede requerir re-login (browser visible). **NO se corrieron queries en vivo** (evita re-auth colgado en sesión no-interactiva). *Pendiente operativo con intervención tuya (tu aclaración #3).*
- **Librería registrada en la skill = solo 2 cuadernos** (NO es el inventario real):

| Cuaderno | ID | Topics |
|----------|-----|--------|
| Plan Despegue 2026 | `plan-despegue-2026` | logística, 3PL, WMS, ERP, client-portal, B2B, CRM, videovigilancia, arquitectura, seguridad, ANMAT, roadmap |
| TOPS — Activos todo-en-uno 2026 | `tops-—-activos-todo-en-uno-2026` | logística-tops, 3pl, anmat, plataforma-b2b, transporte-amba, marketing, entregables |

> ⚠️ **Estos 2 cuadernos NO representan tu inventario completo** (tu aclaración #1). Tenés "muchos" cuadernos de años de campo que **no están registrados** en la skill.

### 4.2 Fase previa OBLIGATORIA de inventario real (tu aclaración #2)
La Capa 3 **no puede diseñarse ni ingerirse a ciegas**. Antes de cualquier ingesta:
1. **Listar/registrar** todos los cuadernos reales de NotebookLM (URLs), o
2. **Exportarlos** (PDF/Doc/Markdown), o
3. **Moverlos a Drive** como fuente canónica, o
4. **Armar una carpeta Drive "Knowledge Base — Research"** para que Nexus ingiera.

**Metadata propuesta por documento/cuaderno:** `notebook_name`, `topic`, `source_type`, `author`, `date`, `reliability`, `business_unit`, `regulatory_area`.

**Clasificación temática objetivo:** ANMAT · logística 3PL · productos regulados · FDA · competencia · capacitaciones · investigación de campo · comercial · operaciones · compliance · otros.

### 4.3 Por qué NotebookLM no va conectado directo (confirmación técnica)
- NotebookLM **no tiene API oficial pública** → un conector directo sería browser automation (frágil, auth).
- La skill `notebooklm` es **herramienta de Claude Code (mi runtime)**, no de la app. La app en Netlify no puede usarla. → Runtimes distintos.
- Por eso el camino productivo es **export → Drive → Nexus**, y NotebookLM queda como laboratorio humano. Coincide con tu decisión.

---

## 5. Propuesta técnica — Ingesta documental común (Capas 2 y 3) (Fase 3)

**Reusar el spine existente. No inventar infraestructura nueva.** El spine ya está construido; solo hay que encenderlo y extenderlo.

### 5.1 Infraestructura existente (auditada, con `file:line`)
- **`searchable_items`** — índice universal FTS (`tsv` español GENERATED + GIN + trigram). Lee el Copilot vía `ai_search_knowledge` (SECURITY INVOKER, RLS heredada). `0126_knowledge_core.sql:92-115`. **Vacía en prod.**
- **`ai_docs_projection`** (VIEW) — proyecta `compliance_documents` (569) + `contract_documents` (228) a la forma de `searchable_items`, **solo metadata**, con redacción PII (`ai_docs_redact`) y `visibility_key` (`perm:compliance.view` / `perm:comercial.view`). `0176_knowledge_docs_projection.sql:88-148`.
- **`ai_docs_backfill_apply(p_limit,p_offset)`** — upsert de la vista al índice (SECURITY DEFINER, `service_role`). `0176:237-290`. **Nunca ejecutada.**
- **`knowledge_documents` / `knowledge_chunks`** — scaffold RAG **vacío, sin vector**. `0126:187-207`.
- **Drive links** — no están en el spine; se re-joinean en la capa de app (`tools.ts` `enrich`) desde `compliance_documents.url` / `contract_documents.url` / `contracts.drive_folder_id`.
- **Sin pgvector/embeddings en todo el repo.** Retrieval = FTS + trigram + metadata.
- **Próxima migración libre: `0185`** (última = `0184_ai_revenue_by_category.sql`).

### 5.2 Opciones evaluadas

| Opción | Veredicto |
|--------|-----------|
| 1. Reusar `searchable_items` + patrón `ai_docs_projection` | ✅ **ELEGIDA** — el spine ya existe; extender el contrato `visibility_key` con nuevos `entity_type` |
| 2. Nueva tabla `company_knowledge_documents` | Parcial: **sí** una tabla-fuente de KB (staging del contenido curado), **pero** se proyecta al `searchable_items` existente, no un índice paralelo |
| 3. Drive como staging documental | ✅ **ELEGIDA** — biblioteca canónica (tu decisión); sync tipo compliance/contratos ya existe como patrón |
| 4. Embeddings / pgvector | ⏸️ **Diferida a C3** — solo si el FTS no alcanza para Q&A profundo sobre prosa larga |
| 5. Metadata-only fase inicial, full-text después | ✅ **ELEGIDA** — arranca metadata+FTS (como el spine actual); texto completo/chunking en fase posterior |

### 5.3 Arquitectura elegida (respeta patrón de capas + RPC-first + RLS)

```
NotebookLM (lab humano)  ─┐
Web institucional        ─┼─►  Drive "Nexus Knowledge Base"  ─►  sync (patrón Drive existente)
Docs corporativos        ─┘        (biblioteca canónica)              │
                                                                      ▼
                                          tabla-fuente  kb_documents (nueva, 0185)  ── metadata + texto curado
                                                                      │  proyección (vista/func, patrón ai_docs_projection)
                                                                      ▼
                                          searchable_items  (índice FTS español EXISTENTE)  + nuevos entity_type
                                                                      │  ai_search_knowledge / ai_kb_browse (SECURITY INVOKER, RLS)
                                                                      ▼
                                          Copilot (engine → tools.ts → data.ts sesión/RLS → enrich Drive url)
                                                                      ▼
                                          Respuesta con cita real (documento + link Drive) + capa/fuente declarada
```

- **Nuevos `entity_type`:** `institucional_web`, `institucional_doc`, `kb_research`, `kb_capacitacion` (proyectados a `searchable_items` con `visibility_key` = `perm:knowledge.view` o `public_auth`/`staff` según sensibilidad).
- **Nueva tool de Copilot:** `institutional_browse` / `research_browse` (o extender el filtro `entity_type` de `docs_browse`), + actualizar `intent-classifier` para que `company_institutional`/`internal_research` **encuentren fuente** en vez de declarar brecha.
- **Trazabilidad:** cada chunk cita el documento + link Drive (mismo patrón `enrich`).
- **Versionado/refresh:** re-sync incremental desde Drive (triggers/cron), como compliance/contratos.
- **RLS:** política SELECT por `has_permission('knowledge.view')` + `visibility_key` (ya existe en `searchable_items`); escrituras SOLO por RPC/trigger `SECURITY DEFINER` (el spine no tiene policy de INSERT/UPDATE por diseño).

### 5.4 ¿Alcanza el spine actual? (análisis honesto)
- **Metadata + FTS español:** ✅ alcanza para "qué servicios ofrece TOPS", "propuesta de valor", "qué dice la web", "qué capacitación di sobre almacenamiento regulado" (búsqueda por título/keywords/cuerpo curado).
- **Texto completo / chunking:** 🟠 necesario si querés Q&A profundo sobre documentos largos (prosa de investigaciones). Fase C3.
- **Embeddings / semántica:** 🔴 no existe. Solo si el FTS se queda corto en preguntas parafraseadas. Fase C3, opcional, mayor costo/complejidad.

---

## 6. Capa 4 — Actualidad / Gemini / web externa (Fase 4)

**Decisión ejecutiva:** solo para **actualidad y fuentes oficiales que cambian**: ANMAT, Boletín Oficial, dólar, noticias, normativa vigente, contexto económico.

### 6.1 Diseño por proveedor

| Caso | Proveedor propuesto | Tipo | Cita | Costo/latencia |
|------|--------------------|------|------|----------------|
| Dólar / FX | API BCRA (oficial) o proveedor FX | REST | fuente + timestamp | bajo / bajo |
| Inflación | INDEC (oficial) | REST/scrape controlado | fuente + período | bajo / bajo |
| Noticias | News API confiable | REST | titular + medio + fecha | medio / medio |
| Normativa vigente | ANMAT / Boletín Oficial / InfoLEG / argentina.gob.ar | fuente oficial | organismo + norma + fecha | medio / medio |
| Actualidad general / web | **Gemini grounding (Google Search)** | tool en `generateContent` | citas del grounding | por búsqueda / medio |

### 6.2 Política (obligatoria antes de activar)
- **Cuándo usar externa:** solo si la pregunta es `general_current` y ninguna capa interna resuelve.
- **Cuándo declarar limitación:** si no hay proveedor confiable para ese tema → mantener el comportamiento honesto actual (no inventar).
- **Cómo citar:** siempre fuente + fecha/timestamp; nunca presentar dato externo como dato Nexus.
- **PII / qué NO sale de Nexus:** **jamás** enviar datos internos (facturación, clientes, saldos, contratos, PII) al proveedor externo/grounding. La consulta externa se arma **solo** con el término genérico del usuario, sin contexto interno. Para preguntas **mixtas**, se separa: parte Nexus (interna, sin salir) + parte externa (término genérico) → se combinan en la respuesta, no en la query.
- **Env vars previstas:** `AI_GROUNDING_ENABLED`, `FX_PROVIDER_URL`, `NEWS_API_KEY`, etc. (ninguna se configura ahora).

### 6.3 MVP recomendado Capa 4
**Gemini grounding** (un flag en el request `generateContent`, sin infra nueva) para actualidad general con citas, + **BCRA** para dólar (oficial, gratis). Noticias/normativa como fase siguiente. **No activar nada sin OK** (env + costo + revisión de seguridad).

---

## 7. Matriz de clasificación de preguntas por capa (Fase 5)

| # | Pregunta | Capa esperada | Fuente (post-Slice C) | Estado actual | Estado deseado | Slice |
|---|----------|:---:|-----------------------|---------------|----------------|:---:|
| 1 | ¿Qué servicios ofrece TOPS para ANMAT? | 2 | KB institucional (web/dossier) | 🔴 brecha | responde con cita Drive/web | C1 |
| 2 | ¿Cómo vendemos Cargas Generales? | 2 | KB institucional (propuesta/landing) | 🔴 brecha | responde con cita | C1 |
| 3 | Armame una capacitación sobre almacenamiento regulado ANMAT | 3 | KB research (tus capacitaciones vía Drive) | 🔴 brecha | responde citando tu material | C2 |
| 4 | ¿Qué aprendimos de los trabajos de campo sobre 3PL? | 3 | KB research (Drive) | 🔴 brecha | responde citando research | C2 |
| 5 | Compará nuestra propuesta con mejores prácticas logísticas | 2+3 mixto | KB institucional + research | 🔴 brecha | cruza ambas + cita | C2/C5 |
| 6 | ¿Qué es RNE? | 4 (static) | Gemini conocimiento general | ✅ ya responde | igual | — |
| 7 | ¿Qué normativa vigente aplica para almacenamiento regulado? | 4 (current) | ANMAT/Boletín Oficial (oficial) | ⚠️ limitación honesta | responde con fuente oficial | C4 |
| 8 | ¿Cuánto cotiza el dólar? | 4 (current) | BCRA / FX / grounding | ⚠️ limitación honesta | responde con fuente + timestamp | C4 |
| 9 | Con el dólar actual, convertí facturación ANMAT a USD | 1+4 mixto | Nexus (interno) + FX (externo) | ⚠️ mitad (Nexus) + brecha FX | cálculo completo con fuentes separadas | C4/C5 |
| 10 | ¿Cómo impacta el contexto económico actual en nuestros costos? | 1+4 mixto | Nexus (costos) + actualidad (externa) | 🔴/⚠️ | cruce interno + contexto externo citado | C4/C5 |

> Preguntas 6/8 confirman el diseño actual: **static ya funciona**; **current queda en limitación honesta** hasta C4. Ninguna debe inventar.

---

## 8. Roadmap por slices (Fase 6)

> Cada slice: idempotente, SQL **entregado NO aplicado** (G3), `typecheck` 0, tests + smoke, rollback, y **decisión tuya** explícita antes de construir (G7).

### Slice C0 — Encender el spine existente *(prerrequisito, alto ROI)*
- **Objetivo:** poblar `searchable_items` con lo que YA existe (compliance 569 + contratos 228) → prende `search_knowledge` y `docs_browse` (hoy dormidos).
- **Archivos/acciones:** aplicar migraciones **existentes 0176–0179** (ya escritas) + ejecutar `ai_docs_backfill_apply()`.
- **Migraciones:** ninguna nueva (aplicar entregadas).
- **Riesgos:** backfill corre como `service_role`; verificar `visibility_key`/RLS antes; volumen ~800 filas (bajo).
- **Tests/smoke:** `search_knowledge` devuelve compliance/contratos; RLS respeta rol piloto.
- **Rollback:** `ROLLBACK_0176_0177…md`, `…0178…`, `…0179…` ya existen.
- **Estimación:** S (chico). **Decisión requerida:** OK para aplicar migración + backfill en prod.

### Slice C1 — Capa institucional básica
> ✅ **IMPLEMENTADO LOCAL 2026-07-07** (código + tests verdes; migración `0185` entregada NO aplicada; SIN ingesta). Detalle: `COPILOT_C1_INSTITUTIONAL_KB_DESIGN.md`. Tabla `company_knowledge_documents` + RPC `ai_company_knowledge_search` (INVOKER) + tool `company_knowledge_search` + ruteo engine + brecha honesta cuando no hay ingesta. **Pendiente ejecución:** aplicar 0185, armar Drive KB, ingerir.
- **Objetivo:** ingerir web institucional + docs corporativos (Drive KB) → responder servicios/propuesta/ANMAT/Cargas.
- **Archivos probables:** `supabase/migrations/0185_kb_institutional.sql` (tabla `kb_documents` + entity_types + proyección); `src/lib/ai/tools.ts` (tool `institutional_browse`); `src/lib/ai/intent-classifier.ts` (institutional → fuente); `src/lib/ai/coverage-source.ts` (brecha→conectado); sync Drive KB (patrón compliance/contratos).
- **Migraciones:** `0185` (idempotente, RLS `knowledge.view`, sin DROP).
- **Riesgos:** curaduría de contenido (calidad del copy); marcar copy comercial vs institucional; datos ANMAT validados (22/16 m², RNE del cliente).
- **Tests/smoke:** preguntas 1,2 de §7 responden con cita Drive/web.
- **Rollback:** `ROLLBACK_0185…md`.
- **Estimación:** M. **Decisión:** armar carpeta Drive KB institucional + confirmar URLs dudosas.

### Slice C2 — Research vía export/Drive (NotebookLM upstream)
- **Objetivo:** ingerir tu research/capacitaciones (exportadas de NotebookLM a Drive) → responder preguntas 3,4.
- **Prerrequisito (tu intervención):** **inventario real de cuadernos** + export/curaduría a carpeta Drive "KB — Research" (§4.2).
- **Archivos probables:** reusar `kb_documents` (entity_type `kb_research`/`kb_capacitacion`) + metadata research; tool `research_browse`.
- **Migraciones:** extiende 0185 o `0186_kb_research.sql`.
- **Riesgos:** volumen/curaduría; confiabilidad por documento (`reliability`); versionado.
- **Tests/smoke:** preguntas 3,4 responden citando tu material.
- **Rollback:** `ROLLBACK_0186…md`.
- **Estimación:** M (depende del inventario). **Decisión:** completar inventario + export a Drive.

### Slice C4 — Actualidad / FX / normativa oficial
- **Objetivo:** responder dólar/normativa/actualidad con fuente citada (no inventar).
- **Archivos probables:** `src/lib/ai/general-source.ts` (de limitación → proveedor); `providers/gemini.ts` (habilitar grounding tool); adaptadores FX/news/normativa; política PII.
- **Migraciones:** ninguna o mínima (config).
- **Riesgos:** **seguridad/PII (que no salga dato interno)**; costo por búsqueda; latencia; confiabilidad de fuente.
- **Tests/smoke:** preguntas 7,8 con fuente+timestamp; verificar que NO se filtra contexto interno.
- **Rollback:** flag `AI_GROUNDING_ENABLED=0`.
- **Estimación:** M. **Decisión:** OK grounding + keys + política PII.

### Slice C3 — Texto completo / RAG semántico *(opcional, solo si FTS no alcanza)*
- **Objetivo:** chunking + embeddings + `pgvector` para Q&A profundo sobre prosa larga.
- **Archivos probables:** `create extension vector`; columna embedding en `knowledge_chunks`; pipeline de embeddings; búsqueda híbrida FTS+vector.
- **Migraciones:** `0187_pgvector_embeddings.sql`.
- **Riesgos:** costo de embeddings, mantenimiento, complejidad; solo justificado si el FTS falla en preguntas parafraseadas.
- **Estimación:** L. **Decisión:** evaluar recién con métricas reales de C1/C2.

### Slice C5 — Reportes mixtos (multi-capa)
- **Objetivo:** combinar Nexus + institucional + research + externa en una respuesta (ej. pregunta 10).
- **Archivos probables:** `management-brief.ts` / `engine.ts` (orquestación multi-capa), citas por capa.
- **Migraciones:** ninguna.
- **Riesgos:** complejidad de orquestación; no mezclar interno con externo en queries.
- **Estimación:** M. **Decisión:** al cierre de C1–C4.

---

## 9. Migraciones previstas (Fase 3/6)

| Migración | Slice | Qué crea | Estado |
|-----------|:---:|----------|--------|
| 0176–0179 (existentes) | C0 | proyección docs + backfill + FTS docs_browse | **entregadas, aplicar** |
| `0185_kb_institutional.sql` | C1 | `kb_documents` + entity_types + proyección a `searchable_items` + RLS `knowledge.view` | a diseñar (idempotente, NO aplicar) |
| `0186_kb_research.sql` | C2 | entity_types research + metadata | a diseñar |
| `0187_pgvector_embeddings.sql` | C3 | `extension vector` + embeddings (opcional) | a diseñar |
| (config C4) | C4 | flags/config de proveedores | mínima/ninguna |

**Reglas (skill arquitectura):** idempotentes, numeradas al siguiente libre (**desde 0185**, sin reusar), sin DROP/rollback de schema, RLS por `current_role()`/`visibility_key`, escrituras vía `SECURITY DEFINER`. **Entregadas, no aplicadas.**

---

## 10. Riesgos

| Riesgo | Capa | Mitigación |
|--------|------|------------|
| Aplicar 0176–0179 + backfill en prod (C0) toca datos | C0 | Dry-run (`ai_docs_backfill_dryrun`), verificar `visibility_key`/RLS, volumen bajo, rollback listo |
| Curaduría de contenido institucional (calidad/copy) | C1 | Drive KB curada por humano; marcar comercial vs institucional; datos ANMAT validados |
| Inventario NotebookLM incompleto / a ciegas | C3-app | Fase previa obligatoria de inventario (§4.2); no ingerir sin índice real |
| Fuga de PII a proveedor externo | C4 | Política dura: query externa solo con término genérico; nunca contexto interno |
| Costo/latencia de grounding/news/embeddings | C3/C4 | MVP con fuentes gratis (BCRA); grounding on-demand; embeddings solo si hace falta |
| Duplicar infraestructura (índice paralelo) | todas | Reusar `searchable_items` + patrón existente; no crear índice nuevo |
| Re-auth NotebookLM colgando sesión | C2-prep | No queries en vivo; export manual a Drive con tu intervención |
| Matriz de cobertura desactualizada (under-claim) | — | Corregir fila "Comparaciones = brecha" (Slice B ya la entregó) |

---

## 11. Costos / latencias

- **C0/C1/C2 (FTS + Drive):** costo ~0 (infra propia); latencia de query baja (índice GIN).
- **C3 (embeddings):** costo por token de embedding (ingesta + queries); latencia media. Solo si se justifica.
- **C4 (externa):** BCRA/INDEC gratis; news API y grounding con costo por request; latencia media (llamada externa).
- **Presupuesto Copilot:** respetar `AI_DAILY_LIMIT` (40/día) y el guard existente.

---

## 12. Decisiones requeridas del usuario

1. **C0:** ¿OK para aplicar migraciones 0176–0179 + backfill en prod (enciende el spine)?
2. **C1:** armar carpeta Drive **"Nexus KB — Institucional"** + confirmar URLs dudosas (Nexus landing, otros microsites).
3. **C2:** completar **inventario real de NotebookLM** + exportar lo valioso a Drive **"KB — Research"** (tu intervención; re-auth si hace falta).
4. **C4:** ¿OK activar grounding + proveedores (BCRA/news/normativa) + aprobar política PII? ¿Qué env keys?
5. **C3:** diferir hasta tener métricas de C1/C2 (¿el FTS alcanza?).
6. **Alcance/orden:** ¿confirmás el orden `C0→C1→C2→C4→(C3)→C5`?

---

## 13. Recomendación de orden (ejecutiva)

**`C0 → C1 → C2 → C4 → (C3 opcional) → C5`.**
- **C0 primero** porque es alto ROI y bajo riesgo: enciende búsqueda documental que YA está construida (beneficia también a Capa 1).
- **C1+C2 comparten pipeline** (Drive → spine): construir el camino una vez sirve a institucional y research.
- **C4** en paralelo posible (independiente del spine): grounding + BCRA como MVP.
- **C3 (pgvector)** solo si el FTS se queda corto — decisión basada en evidencia, no en "parece mejor".
- **C5** al final, cuando hay fuentes que cruzar.

---

## 14. Criterio de aceptación (por qué se aprueba cada slice)

- **C0:** `search_knowledge`/`docs_browse` devuelven compliance/contratos reales con RLS correcta; `searchable_items > 0`.
- **C1:** preguntas 1,2 de §7 responden con **cita Drive/web real**, no brecha; sin inventar.
- **C2:** preguntas 3,4 responden citando **tu material de campo**; confiabilidad declarada por fuente.
- **C4:** preguntas 7,8 responden con **fuente oficial + timestamp**; verificado que NO se filtra dato interno; si no hay fuente, limitación honesta.
- **C5:** pregunta 10 cruza capas con citas separadas por origen.
- **Transversal:** prioridad interna respetada, trazabilidad (cita por fuente), honestidad (brecha declarada si falta), 0 invención, `typecheck` 0, tests + acceptance sin regresión (≥87/100).

---

## 15. Qué NO se implementó todavía (explícito)

**Nada.** Este documento es diseño y scope. No se creó ni aplicó ninguna migración, no se ingirió ni proyectó nada, no se tocó Supabase/Netlify/prod, no se activó grounding ni proveedores, no se conectó NotebookLM a la app, no se corrió crawler, no hubo push/commit/merge/deploy. Toda construcción queda sujeta a tu OK por slice (G7).

---

### Anexo · Principio rector
> **NotebookLM investiga · Drive conserva · Nexus indexa · Copilot responde.**
> No es sexy, pero funciona. En sistemas de gestión, "funciona" le gana a "parece magia" todos los días.

# Convenciones canónicas (normalización transversal)

> Esta sección fija las convenciones que **prevalecen** sobre cualquier redacción puntual de los capítulos. Resuelve los solapamientos detectados en la revisión de consistencia. **Es normativa.**

## CC-1 — Numeración canónica de migraciones de F0
Donde algún capítulo diga "0088 como portadora del esquema de eventos", **léase según esta tabla** (fuente de verdad = capítulo de Persistencia):

| Migración | Contenido | Por qué |
|---|---|---|
| `0088_prospeccion_module_enum.sql` | **Solo** `alter type permission_module_t add value if not exists 'prospeccion'` + `pg_notify('pgrst','reload schema')` | Postgres exige commitear el nuevo valor de enum antes de usarlo (molde `0086`→`0087`). |
| `0089_prospeccion_core.sql` | **Núcleo**: enum `prospeccion_status_t`, tablas (`prospeccion_sources`, `prospeccion_prospects`, `prospeccion_events` [outbox], `prospeccion_import_jobs`), RLS, trigger, RPC `prospeccion_ingest`, seed RBAC | Todo el esquema de datos + eventos vive acá. |
| `0091_prospeccion_rollback.sql` | Espejo de rollback (`drop ... if exists`, `delete` de permisos) | Un valor de enum NO se puede quitar (documentado). |

**Regla:** `0088 = enum de módulo`; `0089 = núcleo y outbox de eventos`; `0091 = rollback`. La próxima migración libre verificada en prod es `0088`.

## CC-2 — Tabla de Outbox: nombre físico vs lógico
El nombre **físico canónico** de la tabla de eventos es **`prospeccion_events`**. Donde los capítulos la llamen `prospeccion_outbox`, es el **nombre lógico del patrón** (Transactional Outbox), no otra tabla.

## CC-3 — Vocabulario de estados (enum canónico en español + espejo en inglés)
La **fuente de verdad** es el enum SQL `prospeccion_status_t` (español). Los nombres en inglés del capítulo de Event Storming son su **espejo conceptual 1:1**:

| Evento (Event Storming, inglés) | Estado SQL canónico (`prospeccion_status_t`) |
|---|---|
| Prospect Created | `raw` |
| Prospect Imported | `imported` |
| Prospect Enriched | `enriquecido` |
| Score Calculated | `scoreado` |
| AI Analysis Completed | `con_ia` |
| Human Approved | `aprobado` |
| CRM Sync Requested / Completed | `sincronizado` |
| Customer Created | `cliente_creado` |
| (caminos alternos) | `rechazado`, `duplicado` |

## CC-4 — Dedup en F0 vs dedup de persona
En **F0**, la cadena de dedup de fila de import es `cuit → lower(email) → linkedin_url` (acotada a evitar reimportar la misma fila). La **dedup fina de persona** (`clientify_id → email → phone`) es responsabilidad de `crm_ingest_lead` en **F5** (cruce de frontera al CRM). CUIT identifica la **cuenta/empresa**, no la persona: esto no contradice el Event Storming, lo complementa por fase.

## CC-5 — Permisos: estado real de F0 vs estado-objetivo
`permission_action_t` en prod = `{view, create, edit, delete, sign, export, admin}` — **no existe `sync`**. Por lo tanto:
- **F0** crea únicamente `prospeccion.{view, create, edit, delete, admin}`.
- `prospeccion.approve` y `prospeccion.sync`, mencionados en capítulos de fases futuras, son **permisos de F1/F5**; `prospeccion.sync` usará `action='export'` o requerirá extender el enum (decisión de esa fase). **No inventar `action='sync'` en F0.**

## CC-6 — IDs de CRM externo fuera de la fila raíz
Los IDs de CRM externo (`clientify_contact_id`, `clientify_deal_id`, etc.) **NUNCA** viven en `prospeccion_prospects`. Viven en `prospeccion_crm_refs(crm_provider, crm_contact_id, crm_deal_id)` (provider-agnostic). El consolidado/ER/Row types **NO DEBEN** reintroducirlos en la tabla raíz (PII). Violación = rechazo en Architecture Review. (Esta convención ya estaba enunciada en Persistencia; se eleva aquí a CC para que el linter y todo capítulo la citen por número.)

## CC-7 — Correspondencia canónica de estados (dominio ↔ Event Storming ↔ enum SQL ↔ UI)
Resuelve la divergencia de **nombres de estado** entre la Parte II (dominio, inglés), el Event Storming (`15`, alias) y el enum SQL (`35`, español, **fuente de verdad de persistencia**). La máquina de estados es **una sola**; estas son tres vistas del mismo continuo. Donde un capítulo use un alias, **léase según esta tabla**:

| # | Estado dominio (Parte II §1.1, inglés) | Alias Event Storming (`15` §15.4) | Enum SQL canónico (`prospeccion_status_t`) | Label UI sugerido |
|---|---|---|---|---|
| 1 | `created` | `created` | `raw` | Capturado |
| 2 | `imported` | `imported` | `imported` | Importado |
| 3 | `enriched` | `enriched` | `enriquecido` | Enriquecido |
| 4 | `scored` | `scored` | `scoreado` | Calificado |
| 5 | `ai_analyzed` | `analyzed` **=** `pending_approval` | `con_ia` | En revisión (pendiente de aprobación) |
| 6 | `approved` | `approved` | `aprobado` | Aprobado |
| 7 | `crm_sync_requested` | `sync_requested` | `sincronizado` ¹ | Sync solicitado |
| 8 | `crm_sync_completed` | `sync_completed` | `sincronizado` ¹ | Sincronizado |
| 9 | `customer_created` | `customer_created` | `cliente_creado` | Cliente creado |
| T | `rejected` (terminal) | `rejected` | `rechazado` | Rechazado |
| D | (clasificación dedup) | `duplicate` | `duplicado` | Duplicado |

**Reconciliaciones normativas:**
- **`pending_approval` NO es un valor del enum SQL.** Es el **rótulo operativo/UI** del estado `ai_analyzed`/`con_ia` mientras espera la decisión humana (el prospecto descansa en `con_ia` hasta `aprobado`/`rechazado`). El Event Storming lo nombra aparte para visibilizar el gate; el dominio y el enum lo representan como un único estado.
- **El enum SQL colapsa `crm_sync_requested` + `crm_sync_completed` en un solo valor `sincronizado` ¹.** La distinción *requested vs completed* vive en los **eventos del Outbox** (`crm.sync.requested` / `crm.sync.completed`), no en el enum de estado persistido. Esto es deliberado: el enum modela el estado estable del agregado; el progreso intra-sync es event-sourced.
- **El nombre de estado canónico para citar entre capítulos es el del dominio (columna 1).** El enum SQL es la fuente de verdad de **persistencia**; los alias de `15` son conceptuales. CC-3 (eventos→enum) y CC-7 (estados→estados) son complementarias.

---

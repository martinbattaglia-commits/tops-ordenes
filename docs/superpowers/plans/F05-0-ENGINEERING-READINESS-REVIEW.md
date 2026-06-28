# F0.5.0 — Engineering Readiness Review

> Revisión final de rama completa (8 commits, `origin/main`→`d4793b0`). Revisor: modelo final whole-branch.
> Superficie de implementación: `src/lib/rbac/types.ts`, `src/lib/knowledge/{visibility.ts,visibility.test.ts,types.ts,data.ts}`, `vitest.config.ts`, `supabase/migrations/{0106,0107,0110}`. Todo lo demás del diff son docs aprobados (fuente de verdad).

## 1. Correctitud

Coincide **exactamente** con la arquitectura aprobada (Parte II §B). Comparación campo-a-campo:

- `0107_knowledge_core.sql` es **idéntico verbatim** al SQL canónico del spec (§5.2, líneas 3838–4131): 9 tablas `knowledge_*`, todos los tipos/checks/UNIQUE/índices coinciden (`knowledge_events` §2.1, `searchable_items` §2.2 con `tsv GENERATED ... STORED` sin `unaccent`, vocabulario/grafo/scaffold §2.3–2.9). La policy `visibility_key` (§2.10) es idéntica en `knowledge_events` y `searchable_items`.
- `0106_knowledge_module_enum.sql` = §5.1 verbatim (`ADD VALUE IF NOT EXISTS 'knowledge'` en transacción propia, con `pg_notify`).
- `0110_knowledge_rbac_seed.sql` respeta el molde 0087/0089: 5 permisos `knowledge.{view,create,edit,delete,admin}` (`permission_action_t` es cerrado y solo se usan acciones válidas), `view` a todo rol interno excluyendo `cliente_b2b`, `create/edit` a roles operativos, `delete/admin` solo a `director_ops`/`admin`. Todos los `INSERT` con `ON CONFLICT DO NOTHING`.
- TS: `requiredVisibilityKeys` implementa la regla del mínimo común (Parte III §4.1 / ADR-MACL-5) con fail-closed a `["staff"]`, descarte de `public_auth` en AND y orden determinístico; 5 tests verdes. `types.ts`/`data.ts` espejan `knowledge_events` y devuelven `[]` hasta F0.5.1 (la vista `v_knowledge_timeline` llega en 0111).
- RBAC: la unión `PermissionModule` y `MODULE_LABELS` reciben `"knowledge"` (label "Conocimiento · Memoria corporativa"); el `Record` exhaustivo garantiza fallo de build si faltara — es el test de la tarea.

**Desviaciones:** ninguna. El recorte de entrega (0106/0107/0110 ahora; 0108/0109/0111 en F0.5.1) coincide con el roadmap del spec (§5.4) y está documentado en la apply-checklist.

## 2. Gobernanza

G1–G11 respetadas.
- **Entregadas-no-aplicadas (G3):** las 3 migraciones llevan el header "ENTREGADA, NO APLICADA"; `git status` no muestra ningún efecto contra prod; la apply-checklist deja el orden manual para Dirección. **Nada fue aplicado a ninguna DB.** Verificado.
- **100% aditiva:** cero `ALTER TABLE` sobre tablas existentes (grep confirmado). El único `ALTER TYPE ... ADD VALUE` es aditivo sobre el enum y está aislado en su propia transacción (Postgres no permite usar el valor recién agregado en la misma tx → seed separado en 0110).
- **RLS como frontera** reusando `has_permission` (0009:164), `is_staff` (0005:36), `is_admin` (0005:53) — los tres existen en el repo en las líneas citadas. `client_id::text` sigue el precedente 0013:57; `profiles.client_id` existe (0001:32).
- **`tsv` GENERATED** usa solo `to_tsvector('spanish', …)` (immutable); `unaccent` queda como wrapper `f_unaccent` IMMUTABLE de terreno, NO usado en la columna materializada (caveat §3 respetado).
- **Idempotencia:** `create ... if not exists`, `drop policy if exists`, `on conflict do nothing`, UNIQUE de idempotencia en `knowledge_events`/`searchable_items`. Re-ejecución segura.
- **RBAC roles reales:** seed usa solo roles de 0009; `cliente_b2b` excluido de `knowledge.*`. Sin push/deploy; commits locales.

## 3. Compatibilidad

- **F0.5.1 (sin refactor):** el read-model, el índice de dispatch parcial `(available_at, seq) where status in ('pending','failed')` y las columnas outbox (`status`/`retry_count`/`available_at`) ya están listos para los `project_*`/RPCs/vistas de 0108/0109/0111. `data.ts` ya tiene la firma `listTimeline(scope)` que solo necesitará la query. Sin cambios de DDL pendientes sobre lo entregado.
- **Connect (F1+):** prefijos de migración corridos +6 según el spec; `knowledge_edges` preparado para `connect_conversation_links`; triggers `project_connect_message` previstos. No hay acople hacia Connect.
- **Knowledge Intelligence (KIL):** dependencia unidireccional preservada — la KIL consumirá `knowledge_events` (con `correlation_id` y `seq` causal ya presentes) sin tocar internals. Nada en F0.5.0 la bloquea.
- **MACL:** `requiredVisibilityKeys` ya implementa la regla del mínimo común que MACL exige para artefactos derivados de múltiples fuentes.

## 4. Riesgo

**Muy Bajo.** Justificación: (a) cero código aplicado a prod; (b) 100% aditivo, rollback trivial (`drop table` de objetos nuevos); (c) la superficie ejecutable es un helper puro determinístico (5 tests) + un read-model que devuelve `[]`; (d) la frontera de seguridad reusa helpers ya probados en prod, sin lógica de permisos nueva; (e) escritura cerrada (ninguna policy INSERT/UPDATE/DELETE para `authenticated`). El único punto a vigilar (heredado del spec, no introducido aquí): si se endurece la RLS de `role_permissions`/`permissions`, conviene convertir `has_permission` a `security definer` — está documentado en §2.10 del spec.

## 5. Calidad del diseño

- **Simplicidad:** la pieza ejecutable es un helper de 16 líneas + read-model placeholder; el grueso es SQL declarativo. No hay maquinaria prematura.
- **Cohesión:** todo vive en el bounded context `knowledge` (esquema `public` con prefijo `knowledge_*` + `src/lib/knowledge/`); responsabilidades claras por tabla.
- **Desacoplamiento:** fuentes intactas; el timeline es proyección read-model; RLS por `visibility_key` denormalizado (O(1)/fila) evita JOINs de visibilidad.
- **Extensibilidad:** outbox-ready, scaffold RAG (`knowledge_documents/chunks`) y grafo (`nodes/edges`) ya presentes; embedding diferido a 0119 sin reescribir nada.
- **Mantenibilidad:** SQL idempotente con molde citado por línea; DRY (reusa `tg_touch_updated_at` global y helpers RLS); tipos TS exhaustivos que fallan el build ante omisiones.

## 6. Deuda técnica

No se identifica deuda técnica introducida por este incremento. Deuda **aceptada/diferida** (de diseño aprobado, no de esta implementación): `data.ts` devuelve `[]` hasta que 0111 cree `v_knowledge_timeline` (declarado en el código y el plan); `f_unaccent` queda como terreno sin uso; embeddings diferidos a 0119. La deuda preexistente de "roles definitivos" (documentada en `rbac/types.ts:104-112`) es ajena a este increment.

## 7. Observabilidad

La EOL (Parte V) **no fue violada**: F0.5.0 es explícitamente el único alcance que la EOL no obliga (criterio obligatorio desde F0.5.1+), y el código entregado no implementa observabilidad — correcto. Más aún, el read-model **facilita** la incorporación futura: `knowledge_events` ya trae `correlation_id` (base que la EOL §3 formalizará), `seq` causal, `status`/`retry_count`/`error` y `actor_kind` — los insumos para responder las 8 preguntas y para el canal técnico separado. Nada en la implementación dificulta agregar eventos técnicos, structured logging o auditoría de replay después.

## 8. Escalabilidad

Válida para el crecimiento previsto. `seq bigint generated always as identity` da orden causal total sin contención de `created_at`; índices GIN (FTS + `pg_trgm`) e índice parcial de dispatch están dimensionados para búsqueda cross-entidad y drenado outbox. RLS O(1) por fila (sin JOINs). Posibles cuellos a futuro (no bloqueantes, esperados): proyección síncrona por trigger en F0.5.1 — mitigada por el worker `/api/knowledge/drain` previsto en F0.5.2; y el índice GIN de `tsv` requerirá `maintenance_work_mem` adecuado en backfills masivos (operativo, no de diseño).

## 9. Definition of Done

Se confirman explícitamente los criterios de cierre de F0.5.0 (spec Parte II §5 / plan Task 8 Step 5):
- [x] Módulo `knowledge` registrado en RBAC (unión `PermissionModule` + `MODULE_LABELS` + seed 0110 entregado).
- [x] Tablas read-model + RLS `visibility_key` entregadas (0107) — **no aplicadas**.
- [x] Scaffold TS con `isMock` (`data.ts`) + helper puro testeado (`requiredVisibilityKeys`, 5 tests).
- [x] Gates verdes (reportados por el implementador): typecheck 0 · `npm test` 249/249 · lint 0 errores (5 warnings preexistentes de alt-text en PDFs) · build exit 0.
- [x] NADA aplicado a prod; apply-checklist entregado (`F05-0-APPLY-CHECKLIST.md`).

DoD cumplida.

## 10. Recomendación

**APROBADO PARA CONTINUAR.** La implementación coincide verbatim con la arquitectura aprobada (Parte II §B), es 100% aditiva y entregada-no-aplicada (G3 verificado: cero efectos sobre cualquier DB), reusa la frontera de seguridad existente sin introducir lógica de permisos nueva, no viola la EOL y deja la base lista para F0.5.1/Connect/KIL/MACL sin refactor. Riesgo Muy Bajo, sin deuda técnica introducida, sin hallazgos Critical/Important.

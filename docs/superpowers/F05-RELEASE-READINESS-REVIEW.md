# F0.5 Release Readiness Review

## 1. Resumen ejecutivo

**Veredicto: LISTO-CON-CONDICIONES (GO para F0.5.2).**

El bloque F0.5 (F0.5.0 migs 0106/0107/0110 + F0.5.1 migs 0108/0109/0111 + `src/lib/knowledge`) es una base **arquitectónicamente sólida y segura** para construir F0.5.2 y el resto de Nexus Connect. La respuesta a la pregunta central —¿está realmente listo como base?— es **sí, con condiciones acotadas**, ninguna de las cuales es de código bloqueante en F0.5.1/F0.5.2.

- **No hay bloqueantes reales.** Seis de siete dimensiones dictaminaron `blocks_f052=false`. La única que declaró bloqueo (Seguridad) está sobre-escalada: el meta-crítico verificó empíricamente que la "fuga public_auth" es **inerte en F0.5.1** —ningún migration escribe entity `purchase_order`/`supplier_invoice`/`vendor` a `audit_log` (los reales son `order`/`shipment`/`stock_allocation`/`custody`/`recon`), la única fuente es `audit_log`, y `has_permission` exige `user_roles` poblado (RBAC dormido, 0 filas) o admin. Triple inertness. El propio reporte de Seguridad se autocontradice ("hoy mitigado solo por el accidente de que casi nadie tiene knowledge.view"). El veredicto correcto es deuda a saldar **pre-F0.5.3**, no blocker.
- **El pipeline cumple OCP y es genuinamente agnóstico de fuente.** Emisor único (`knowledge_emit_event`) sin ramas por `source_table`, registry desacoplado, adapter pattern con mapeo DRY reusado entre trigger y backfill, superficie de escritura cerrada (solo `service_role` + triggers DEFINER), append-only enforced por trigger. Verificado por lectura de cuerpos.
- **Un pre-requisito recomendado antes de F0.5.2:** decidir el contrato `p_status` del emisor. El worker async de F0.5.2 NO puede arrancar sin reabrir 0108 porque ninguna fila nace `pending` (default `processed`); el índice de dispatch queda estructuralmente muerto para lectura. Esto **contradice spec:3286** y debe resolverse como overload aditivo **antes** de arrancar, no a mitad de fase.
- **Dos deudas a saldar pre-F0.5.3:** (a) endurecer `public_auth`→`staff` para compras/proveedores/flota/compliance antes de que `orders`/compras pueblen `searchable_items`; (b) alinear el catálogo único de nombres de eventos técnicos EOL (ADR vs `observability.ts` vs SQL no coinciden en ningún par).
- **Riesgo procedimental #1 (no de código):** el cuerpo del spec §5.3/§5.4 sigue mostrando la Alternativa A RECHAZADA (emisor 13-params + INSERT directo). Un dev que aplique "el SQL del spec" reconstruye la arquitectura rechazada. Debe reconciliarse antes de G7.
- **Dos defectos de calidad de datos reales (no bloqueantes, pero a corregir):** el sentinel `'∅'` corrompe la identidad en `entity_360`, y no existe índice que sirva el camino caliente `ORDER BY seq desc` global del timeline.

---

## 2. Hallazgos por dimensión

### Dimensión 1 — Arquitectura
**Veredicto: OK CON OBSERVACIONES.**

**Fortalezas confirmadas (evidencia):**
- Sin dependencias circulares; dirección estrictamente unidireccional adaptador→emisor→`knowledge_events`. `knowledge_emit_event` no referencia ninguna tabla-fuente (`0108:66-122`); registry sin FK (`0107:212-220`).
- Pipeline 100% agnóstico: cero IF/CASE sobre `source_table` en el emisor; vistas son SELECT planos (`0111`).
- Adapter pattern DRY real: el mismo mapeo `knowledge_audit_log_to_canonical` (`0109:20-41`) se reusa en trigger y backfill (`0109:115`).
- Superficie de escritura cerrada; trigger defensivo G11 (`0109:54-64`) nunca aborta la tx de negocio.

**Hallazgos:**
- **[Alto] Spec ↔ implementación no reconciliados.** El cuerpo del spec (`4144-4179`, `4264-4312`, `4410-4439`) presenta como canónica la Alternativa A rechazada. Riesgo procedimental, no de código. (Ver §3 R-1.)
- **[Medio] Etiquetas de eventos EOL desalineadas 3-vías** (ADR vs `observability.ts:47-53` vs SQL `0108:111`/`0109:59,121,134`). Ningún par coincide.
- **[Medio] Fuga de alcance KIL/MACL:** `visibility.ts` implementa regla de mínimo común citando Parte III §4.1 / ADR-MACL-5, sin consumidor real, prohibido por D19. El meta-crítico agrega que **existe `visibility.test.ts`** (test verde → falsa señal aún mayor de "feature lista").
- **[Bajo] Spec lista contenido fuera de alcance** en 0108/0109 (funciones de F0.5.2/0.5.3/0.5.4); los archivos entregados correctamente las omiten.
- **[Bajo] `knowledge_visibility_for` es SECURITY DEFINER** invocada dentro del path del adaptador; correcto funcionalmente, default conservador `'staff'`.

*Matiz del meta-crítico:* "emisor único" es invariante **convencional, no enforced** — no hay trigger BEFORE INSERT que rechace inserts directos del owner/`service_role`, solo BEFORE DELETE. Cierto para `authenticated`/`anon`; el "único escritor" es disciplina, no garantía del motor.

### Dimensión 2 — Contratos
**Veredicto: OK CON OBSERVACIONES.**

**Fortalezas confirmadas:**
- Coherencia read-side campo por campo: 15 columnas de `v_knowledge_timeline` (`0111:11-15`) ↔ `KnowledgeEvent` (`types.ts:7-23`) ↔ `mapTimelineRow` (`data.ts:33-51`). Sin huérfanos.
- Composite type ↔ INSERT consistentes 1:1 en 13 campos (`0108:14-27` / `0108:98-106`).
- Idempotencia extremo-a-extremo: `UNIQUE(source_table,source_pk,event_type)` (`0107:72`) ↔ `ON CONFLICT DO NOTHING` (`0108:107`) ↔ `source_pk=p.id::text` (`0109:38`).

**Hallazgos:**
- **[Medio] Contrato de emisión acoplado al modo síncrono.** El composite type no tiene `status`/`available_at`; el emisor siempre cae a DEFAULT `processed`. La máquina de estados e índice de dispatch existen pero el emisor no los alimenta. (Convergente con Roadmap; ver §3 R-2.)
- **[Medio] Ampliación del contrato es costosa y riesgosa:** `row()` posicional de 13 elementos (`0109:26-40`) sin `schema_version`; un campo nuevo desordenado compila pero corrompe datos en silencio.
- **[Bajo] Dos contratos paralelos no documentados** (emisión 13 campos / lectura 15: `source_pk` solo-escritura, `seq`/`ingested_at` solo-lectura).
- **[Bajo] Desajuste de vocabulario `entity_type`:** el CASE espera `order`/`client`/...; la fuente real emite `stock_allocation` etc. → casi todo cae a default `'staff'`.
- **[Bajo] `knowledge_visibility_for` puede devolver NULL** (`entity='client'` + `entity_id` NULL) → emisor rechaza → evento perdido silenciosamente por el trigger defensivo.

*Matiz del meta-crítico:* la "idempotencia robusta" generalizada a fuentes futuras está sobre-extendida — para pk compuesto o múltiples eventos por fila la clave de 3 campos puede colisionar/sub-deduplicar. No es defecto de F0.5.1.

### Dimensión 3 — SQL / Migraciones
**Veredicto: OK CON OBSERVACIONES.**

**Fortalezas confirmadas:**
- Orden 0106→0111 aplica limpio; cada dependencia inter-migración verificada; sin referencias adelantadas rotas. Numeración secuencial sin colisión (no timestamps en este rango).
- Split de `ALTER TYPE ADD VALUE` (0106) en su propia tx siguiendo el molde validado en prod 0086→0087 / 0088→0089.
- Idempotencia real en TODAS las migs (`if not exists`, `on conflict do nothing`, `to_regclass` guard, `pg_publication_tables` guard).
- Tipos verificados contra esquema real (`audit_log` `0001:154`, `profiles.client_id`, `orders.client_id`, `documents.client_id`).
- Vistas `security_invoker=true` respetan RLS del consumidor.

**Hallazgos:**
- **[Medio] Doble modelo de rol en RLS:** mezcla RBAC (`has_permission`) con legacy (`is_staff`/`is_admin` sobre `profiles.role`). Deuda heredada de 0005/0009, amplificada por knowledge.
- **[Medio] `visibility_key='perm:%'` sin whitelist** (`0107:245-247`): cualquier slug tras `perm:` se evalúa como permiso. No explotable hoy (escritura cerrada).
- **[Bajo] `public_auth` demasiado abierto** para compras/proveedores/flota/compliance (`0108:55-56`).
- **[Bajo] Idempotencia enum cruzada 0106↔0110:** si un operador envuelve el rango en UNA transacción, 0110 falla por uso de enum value creado en la misma tx. El SQL no se autoprotege. (Ver §3 R-3; gap operativo abierto.)
- **[Muy Bajo] Sentinel `'∅'`** y **grant faltante** en `knowledge_audit_log_to_canonical` (rompe simetría revoke/grant).

### Dimensión 4 — RLS / Seguridad
**Veredicto: OK CON OBSERVACIONES** (corregido desde el "PROBLEMA / blocks_f052=true" del reviewer, refutado por el meta-crítico con verificación empírica).

**Fortalezas confirmadas:**
- Superficie de escritura cerrada y verificada: NINGUNA policy INSERT/UPDATE/DELETE para `authenticated`/`anon` (`0107:288`); solo FOR SELECT.
- Las 5 funciones sensibles tienen `search_path` fijo (verificado una por una).
- Grants restringidos: emisor/backfill/visibility solo `service_role` (`0108:62-63,123-124`, `0109:146-147`).
- Ambas vistas `security_invoker=true` (no son canal de fuga — era el riesgo #1 del encargo).
- Append-only real por trigger BEFORE DELETE; lado TS estrictamente solo-lectura.

**Hallazgos:**
- **[Alto, pero INERTE en F0.5.1] Mapeo `public_auth` de compras/facturas-proveedor.** Real en diseño; el meta-crítico verificó que **no hay exposición hoy** (esos entity no se escriben a `audit_log`; RBAC dormido). **Deuda a saldar pre-F0.5.3.**
- **[Medio] Bomba de tiempo de permisos:** al poblar `user_roles` (RBAC futuro), todo rol interno gana `knowledge.view` de golpe sin gate por módulo. Es fail-closed hoy; el riesgo es la activación big-bang futura.
- **[Medio] `has_permission` sin `set search_path` fijo** (`0009:164-175`), a diferencia del resto de helpers de auth; F0.5 la convierte en frontera de seguridad del módulo.
- **[Medio] Incoherencia `is_staff` (enum) vs roles granulares del seed** produce sets de visibilidad difíciles de razonar.
- **[Bajo] Payload sin allowlist/minimización** viaja con la visibilidad del `entity_type`.

*Corrección del veredicto:* el reviewer marcó bloqueante; el meta-crítico demostró triple inertness. **No bloquea F0.5.2.**

### Dimensión 5 — Timeline
**Veredicto: OK CON OBSERVACIONES.**

**Fortaleza confirmada (descarta supuesto del prompt):** `knowledge_visibility_for` (caro, con subqueries a `orders`/`documents`) corre SOLO en escritura/proyección (`0109:36`); el read-path consume el `visibility_key` ya materializado. Buena denormalización: la visibilidad se "congela" al emitir.

**Hallazgos:**
- **[Alto] No existe índice para el camino caliente `ORDER BY seq desc` global.** `data.ts:70` ordena por `seq desc` siempre; ningún índice lo sirve (`dispatch_idx` excluye `processed` = TODA fila emitida; PK es sobre `id` uuid). El timeline home hace sort completo de la tabla en cada carga. El meta-crítico lo confirma como **cuello de botella #1**, peor que lo descrito. Solución mínima: índice `(status, seq desc) WHERE status='processed'`, o alinear el cliente a `occurred_at desc` para reusar `entity_idx`.
- **[Alto] Mismatch índice vs clave de orden** (`entity_idx` por `occurred_at desc` vs cliente por `seq`).
- **[Alto] Paginación = offset, no keyset**, pese a que `seq` es monótono e indexable. Scroll profundo → O(offset).
- **[Medio] Doble ORDER BY** (vista embebido `0111:17` + `.order('seq')` cliente).
- **[Medio] `v_knowledge_entity_360` sin filtro empotrado + 2 LEFT JOIN + fan-out por anotaciones.** El meta-crítico lo eleva a **Alto** por la intersección RLS×rendimiento (ver Dim 7).

### Dimensión 6 — Observabilidad (EOL)
**Veredicto: OK CON OBSERVACIONES.**

**Fortalezas confirmadas:**
- Canal técnico EOL separado del read-model: ninguna ruta escribe logs/métricas en `knowledge_events`; salen por `raise log`.
- Contrato `correlation_id` end-to-end bien diseñado: `KNOWLEDGE_CORRELATION_GUC` (`observability.ts:74`) ↔ `current_setting('knowledge.correlation_id',true)` en emisor y backfill. Nombre coincide literalmente en los 3 archivos.
- `structuredLog()` builder puro y testeado exhaustivamente.

**Hallazgos:**
- **[Medio] Nombres de eventos técnicos divergen** (ningún nombre TS coincide con SQL). Colectores cableados contra constantes TS no verán los logs reales. (Convergente con Arquitectura Dim 1.)
- **[Bajo] Forma del payload SQL** no sigue `StructuredLogEvent` (faltan `timestamp`/`operation`/`durationMs`/`actor`; status fuera del enum).
- **[Bajo] cast `actor_kind` sin guard runtime** (`data.ts:40`); CHECK lo protege en reposo.
- **[Bajo] ORDER BY en vistas; DEFAULT_VERSION hardcodeado.**
- **[Muy Bajo] `KNOWLEDGE_METRICS` no cubre `ProjectionFailed`** pese a que el SQL ya lo emite.

### Dimensión 7 — Escalabilidad / Rendimiento
**Veredicto: OK CON OBSERVACIONES.**

Comparte los hallazgos de la Dim 5. Énfasis del meta-crítico en la **intersección que el encargo pedía explícitamente y quedó sub-analizada**:

- **[Alto] `v_knowledge_entity_360` + `security_invoker` recalcula la policy sobre el producto cartesiano con fan-out.** Bajo `security_invoker`, `knowledge_events_select` (que invoca `has_permission`+`is_staff`+`is_admin`+`split_part` por fila) se aplica a CADA fila del join eventos×anotaciones, sin WHERE empotrado ni wrapper TS que fuerce el filtro. Costo = RLS×(eventos×anotaciones) + sort global.
- **[Bajo] `has_permission` no leak-proof + sin índice de sort** → se evalúa el join de 3 tablas sobre muchas filas pre-LIMIT.
- **[Bajo] Coherencia de `visibility_key` materializado:** si cambia el `client_id` de un order/document, los eventos viejos quedan obsoletos (sin re-proyección). Riesgo de fuga futura, no de rendimiento.

**Gaps de cobertura señalados por el meta-crítico (no auditados por nadie):**
- **Realtime×RLS×Rendimiento:** `0111:47` agrega `knowledge_events` a `supabase_realtime`; cada suscriptor paga evaluación de policy por evento en tiempo real. Totalmente ausente en los 7 reportes.
- **Utilidad funcional:** como el default mayoritario es `'staff'`, un usuario con `knowledge.view` por RBAC pero `profiles.role` no-staff verá **casi nada**. El feature queda mayormente vacío para no-staff-enum aun con permiso.

### Dimensión 8 — Calidad
**Veredicto: OK CON OBSERVACIONES.**

**Fortalezas:** `data.ts` read-only puro, degrada a `[]` en error y mock; `mapTimelineRow` puro y testeable; tests de `observability` exhaustivos.

**Hallazgos:**
- **[Alto — intersección no detectada por ningún reviewer individual] Sentinel `'∅'` corrompe `entity_360`.** `coalesce(p.entity_id::text,'∅')` (`0109:33`) se materializa y fluye crudo a `v_knowledge_timeline.entity_id` → `TimelineRow.entity_id: string` → UI. En `entity_360`, el JOIN `a.source_id=e.entity_id` (`0111:32`) jamás matchea y **agrupa TODAS las filas NULL bajo una pseudo-entidad `'∅'`** (colisión de identidad). La UI recibe `'∅'` como id navegable. Mín: usar el id de la fila origen como `entity_id`, o excluir esos eventos del 360.
- **[Bajo] cast `actor_kind` sin guard**; `'integration'` declarado pero nunca emitido por la fuente #1.

### Dimensión 9 — Deuda técnica

**Clasificación consolidada:**

*Existente (heredada o ya en el árbol):*
- Spec maestro con la versión RECHAZADA del SQL (deuda documental pre-G7).
- Doble modelo de rol (`profiles.role` legacy vs RBAC) heredado de 0005/0009, amplificado por knowledge.
- `has_permission` sin `set search_path` fijo.
- Divergencia de nombres y forma de eventos EOL (TS vs SQL) — no catalogada en backlog.
- `row()` posicional sin `schema_version`.
- `visibility.ts`/`visibility.test.ts` (MACL prematuro) viviendo en la capa actual.

*Aceptada (decisión consciente documentada):*
- Backfill fila-a-fila vía emisor en vez de `INSERT...SELECT` bulk (a cambio de idempotencia+observabilidad).
- Emisor limitado a modo síncrono (`processed`); máquina de estados como "terreno listo".
- `public_auth` para compras/proveedores/flota/compliance, endurecimiento diferido (decisión Dirección documentada).
- ORDER BY embebido en vistas; cast `actor_kind`; `DEFAULT_VERSION` hardcodeado; boilerplate de backfill por fuente.

*Diferida (a fases posteriores):*
- Eventos técnicos EOL `Started/Finished/Completed` declarados pero no emitidos.
- `v_knowledge_search` diferida a F0.5.2 (índice FTS GIN ya existe sin consumidor).
- pgvector/embeddings (scaffold sin columna).
- `f_unaccent` creado pero inerte.
- `correlation_id` en vivo (wiring SQL listo; falta emisor app — NO requiere reabrir 0108/0109).
- `TimelineScope` sin cursor de paginación.

### Dimensión 10 — Riesgos
Ver tabla en §3.

### Dimensión 11 — ADR
**Veredicto: OK.** Los 3 ADR (REGISTRY, CONTRACT, ADAPTER) son **coherentes entre sí**: reparto de responsabilidades sin contradicción, frontera dura, descartan las mismas alternativas (insert directo, dispatch dinámico, JSONB sin schema) con la misma justificación. Reconocen la desviación R-A (emisor único) que el código entregado efectivamente implementa.

**Hallazgos:**
- **[Medio] ADR vs realidad en visibilidad delegada:** los ADR afirman que "cada adaptador resuelve su propia visibilidad", pero `knowledge_visibility_for` la **centraliza** con CASE hardcodeado en 0108. Una fuente futura con visibilidad no-staff obliga a editar 0108 (código compartido por todas las fuentes). Acoplamiento real que contradice el discurso del ADR.
- **[Bajo] ADR-CONTRACT asigna el cálculo de `visibility_key` al adaptador sin advertir su naturaleza DEFINER.**
- **Pregunta abierta:** no se auditó si ADR-KNW-CONTRACT congela los 13 campos y fija política de `schema_version`.

### Dimensión 12 — Roadmap / Extensibilidad-forward
**Veredicto: OK CON OBSERVACIONES.**

**¿F0.5.2 puede empezar SIN modificar F0.5? — Respuesta: PARCIALMENTE NO.**
- El **path del timeline SÍ** es forward-safe: sumar ReconAdapter/OrdersAdapter = adaptador nuevo + fila en `knowledge_sources`, sin tocar emisor ni vistas. `v_knowledge_search` se crea en mig nueva. `searchable_items` y el índice de dispatch ya existen sin ALTER. Permiso `knowledge.admin` ya existe.
- **PERO el worker async de F0.5.2 NO puede arrancar sin reabrir 0108.** El composite type no tiene `status`; el emisor no acepta `p_status`; toda fila nace `processed`; el índice de dispatch (`WHERE status in ('pending','failed')`) **nunca matchea nada**. El soporte async es solo estructural, no funcional. **Esto contradice spec:3286** ("el índice ya lo soporta"). El meta-crítico lo confirma como el pre-requisito más concreto.

**Hallazgos:**
- **[Alto] Worker async obliga a reabrir 0108** (type+emisor). Resolver AHORA como overload aditivo (`p_status` default `processed`) para no recompilar el composite type ni romper `project_audit_log`.
- **[Medio] Fuga de OCP en visibilidad centralizada** (ver Dim 11).
- **[Bajo] Boilerplate de backfill por fuente no consolidado** (~50 líneas/fuente; riesgo de drift EOL).

---

## 3. Riesgos

| ID | Riesgo | Nivel | Por qué |
|----|--------|-------|---------|
| R-1 | Aplicar el SQL del cuerpo del spec (Alternativa A) en vez de los archivos 0108/0109 reconstruye la arquitectura rechazada | **Alto** | El spec pendiente de G7 muestra la versión rechazada como canónica, sin banner de override. Procedimental, no de código. Es el riesgo más importante del paquete. |
| R-2 | F0.5.2 arranca el worker async y descubre tarde que ninguna fila nace `pending`, obligando a reabrir 0108 a mitad de fase | **Alto** | Emisor no expone `p_status`; default `processed`; índice de dispatch muerto para lectura. Contradice spec:3286. Mitigable resolviéndolo ANTES de arrancar. |
| R-3 | Aplicar las 6 migs envueltas en UNA transacción → 0110 falla por enum value creado en la misma tx | **Medio** | El SQL no se autoprotege; depende del runner file-por-file. El runner real de prod no fue confirmado (gap operativo). |
| R-4 | `entity_360` con identidad corrupta por sentinel `'∅'` y costo RLS×producto cartesiano | **Medio** | `'∅'` colisiona todas las filas NULL; `security_invoker` reevalúa la policy sobre el join con fan-out. Defecto real de datos + rendimiento. |
| R-5 | Timeline global sin índice para `ORDER BY seq desc` se degrada linealmente con la tabla a 10x | **Medio** | Camino caliente (home) hace sort completo en cada carga; paginación por offset agrava el scroll profundo. |
| R-6 | Activación futura de `user_roles` abre el read-model corporativo de golpe (incluye `public_auth` de compras) | **Medio** | No hay gate por módulo; el RBAC granular se activa big-bang. Hoy fail-closed (inerte). Saldar pre-F0.5.3. |
| R-7 | Fuga de compras/facturas-proveedor a cualquier autenticado con `knowledge.view` | **Bajo (hoy inerte)** | Esos entity no se escriben a `audit_log`; RBAC dormido. Real en diseño; saldar pre-F0.5.3, antes de poblar `searchable_items`. |
| R-8 | Catálogo de eventos EOL desalineado (TS/SQL/ADR) rompe trazabilidad end-to-end | **Bajo** | No hay colector aún; debe consolidarse antes de cablear cualquier sink. |
| R-9 | `visibility.ts` (MACL) con test verde tomado como "feature lista" y consumido antes de su fase | **Bajo** | Viola invariante unidireccional D16/D19. Mitigar re-etiquetando o removiendo. |
| R-10 | Realtime×RLS: cada suscriptor paga evaluación de policy por evento | **Bajo** | `knowledge_events` en `supabase_realtime`; no auditado. Verificar al activar realtime en UI. |
| R-11 | `visibility_key` materializado queda obsoleto si cambia el dueño de la entidad de origen | **Bajo** | Sin re-proyección de eventos históricos; coherencia eventual no garantizada (fuga futura, no rendimiento). |

---

## 4. Recomendaciones

**Antes de F0.5.2 (pre-requisitos recomendados):**
1. **Decidir el contrato `p_status` del emisor** (R-2). Definir explícitamente que se hará por **overload aditivo** de `knowledge_emit_event` con `p_status default 'processed'`, sin tocar el composite type ni la firma usada por `project_audit_log`. Es la decisión que evita reabrir 0108 a mitad de fase.
2. **Reconciliar el spec §5.3/§5.4 con los ADR** (R-1): reemplazar el SQL de Alternativa A por el contrato+emisor, o añadir un banner de override visible. Responsabilidad de quien presente a G7.
3. **Confirmar el runner de migraciones de prod** (R-3): garantizar aplicación archivo-por-archivo en transacciones separadas. Gap operativo a cerrar dado el landmine documentado ("prod usa timestamps", deploy semi-manual).

**Durante F0.5.2:**
4. **Crear índice para el camino caliente del timeline** (R-5): `(status, seq desc) WHERE status='processed'`, o alinear el orden del cliente a `occurred_at desc` para reusar `entity_idx`. Decidir primero si `seq` es el reloj lógico intencional.
5. **Corregir el sentinel `'∅'`** (R-4): usar el id de la fila origen como `entity_id` cuando es NULL, o excluir esos eventos de `entity_360`.
6. **Introducir keyset pagination** (cursor por `seq`) en `TimelineScope`; eliminar el ORDER BY embebido en vistas o el `.order` redundante del cliente.
7. **Asegurar wrapper TS para `v_knowledge_entity_360`** que SIEMPRE inyecte `WHERE entity_type+entity_id`, evitando el join+RLS sobre producto cartesiano.
8. **Fijar `set search_path` en `has_permission`** dado que pasa a ser frontera de seguridad del módulo.
9. **Consolidar el catálogo único de nombres/forma de eventos EOL** (R-8) antes de cablear colectores.

**Antes de F0.5.3 (deudas a saldar):**
10. **Endurecer `public_auth`→`staff`** para compras/proveedores/flota/compliance (R-7) antes de que `orders`/compras pueblen `searchable_items`. Requiere decisión D-1 de Dirección.
11. **Definir el plan de activación de `user_roles`** con gate por módulo (R-6), no big-bang.

**Opcional / mejora continua:**
12. Re-etiquetar o remover `visibility.ts`/`visibility.test.ts` como scaffolding inerte (R-9).
13. Extraer helper genérico de backfill para evitar drift de boilerplate entre fuentes.
14. Auditar la intersección Realtime×RLS antes de exponer suscripciones en UI (R-10).
15. Reconciliar el vocabulario `entity_type` del CASE con los valores reales de la fuente.

---

## 5. Cambios sugeridos (no se implementan en esta sesión)

**Ninguno bloqueante.** Sugerencias concretas, en orden de prioridad:

- **`docs/superpowers/specs/2026-06-28-nexus-connect-design.md` §5.3/§5.4** — reemplazar el SQL de Alternativa A (emisor 13-params + INSERT directo) por el contrato composite + emisor único, o añadir banner de override apuntando a los ADR. *(Pre-G7, alta prioridad.)*
- **`migrations/0108_knowledge_rpc.sql`** — preparar overload de `knowledge_emit_event` con `p_status default 'processed'` (no aplicar aún; decidir el contrato). *(Pre-F0.5.2.)*
- **`migrations/0109_knowledge_projection_triggers.sql:33`** — reemplazar `coalesce(p.entity_id::text,'∅')` por el id de la fila origen, o excluir esos eventos de `entity_360`.
- **Nueva migración (F0.5.2)** — índice `knowledge_events (status, seq desc) WHERE status='processed'` para el timeline home.
- **`migrations/0009_rbac.sql:164`** — agregar `set search_path = public, pg_temp` a `has_permission`.
- **`migrations/0108_knowledge_rpc.sql:55-56`** — endurecer `public_auth`→`staff` para compras/proveedores/flota/compliance. *(Pre-F0.5.3, requiere D-1.)*
- **`src/lib/knowledge/observability.ts:47-53`** y SQL — alinear el catálogo de nombres de eventos técnicos EOL.
- **`src/lib/knowledge/visibility.ts` + `visibility.test.ts`** — re-etiquetar como scaffolding inerte o remover del scope.

---

## 6. Veredicto final y condiciones de arranque de F0.5.2

**Decisión: LISTO-CON-CONDICIONES — GO para F0.5.2.**

El bloque F0.5.0 + F0.5.1 está demostradamente sólido como base: pipeline agnóstico con OCP real, superficie de escritura cerrada, append-only enforced, contratos read-side coherentes campo por campo, migraciones que aplican limpio, y ADR consistentes entre sí. La única dimensión que declaró bloqueo (Seguridad) fue **refutada con verificación empírica**: la fuga es inerte en F0.5.1. No hay bloqueantes de código.

**Condiciones exactas antes de arrancar F0.5.2:**

*Responsabilidad de Dirección (Martín):*
1. **Decisión D-1:** confirmar `public_auth` vs `staff` para `purchase_order`/`supplier_invoice`/`vendor`/`fleet_vehicle`/`warehouse`/`compliance_item`. No bloquea F0.5.2 pero **debe resolverse antes de F0.5.3** (cuando `orders`/compras pueblen `searchable_items`).
2. **Aplicación manual de migraciones 0106-0111** garantizando ejecución archivo-por-archivo en transacciones separadas (defensa única contra el fallo enum-value-in-same-tx de 0106→0110). Confirmar el comportamiento del runner de prod.
3. **Aprobación G7 del spec** solo después de reconciliar §5.3/§5.4 con los ADR (evitar que se aplique el SQL obsoleto).

*Responsabilidad técnica (recomendado antes de F0.5.2, no estrictamente bloqueante):*
4. **Decidir el contrato `p_status`** del emisor (overload aditivo) para que el worker async no obligue a reabrir 0108 a mitad de fase.

*Diferible a durante F0.5.2 / antes de F0.5.3:* índice del timeline, sentinel `'∅'`, keyset pagination, `search_path` de `has_permission`, catálogo EOL, endurecimiento de `public_auth`, plan de activación de `user_roles`.

**Resumen de la respuesta a la pregunta central:** sí, F0.5 está listo como base para construir F0.5.2 y el resto de Nexus Connect, con un pre-requisito técnico recomendado (contrato `p_status`), un saneamiento documental pre-G7 (spec↔ADR), y dos deudas con fecha límite clara en F0.5.3 (endurecer `public_auth`, alinear EOL). Ninguna condición exige rehacer el bloque entregado.
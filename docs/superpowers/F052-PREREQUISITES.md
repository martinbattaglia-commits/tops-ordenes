# F0.5.2 — Prerrequisitos priorizados

**Fecha:** 2026-06-28 · **Responsable de revisión:** Dirección (Martín Battaglia) · **Contexto:** condiciones y decisiones a resolver antes o durante F0.5.2, derivadas del Release Readiness Review de F0.5.

---

## ANTES DE ARRANCAR F0.5.2

### 1. OBLIGATORIO — Resolver el contrato `p_status` del emisor (R-2)

**Problema:** el worker asíncrono de F0.5.2 no puede arrancar sin que ninguna fila nazca `pending`. Hoy `knowledge_emit_event` siempre escribe `status = DEFAULT 'processed'` (hardcodeado en `0108`). El índice de dispatch `dispatch_idx` filtra `WHERE status IN ('pending','failed')` — ese índice nunca matchea nada. El soporte async existe como estructura, no como funcionalidad. Esto contradice `spec:3286` ("el índice ya lo soporta").

**Mecanismo de resolución (aditivo, backward-compatible):**

Agregar `p_status text default 'processed'` como nuevo parámetro **al final** de la firma de `knowledge_emit_event`, en una migración nueva de F0.5.2. Las llamadas actuales (desde trigger + backfill + `project_audit_log`) siguen funcionando sin cambios porque el parámetro tiene default.

```sql
-- Esquema conceptual — NO implementar hasta inicio de F0.5.2
-- El composite type knowledge_event_canonical NO cambia
-- La firma pública actual: knowledge_emit_event(p_event knowledge_event_canonical)
-- Nueva firma: knowledge_emit_event(p_event knowledge_event_canonical, p_status text default 'processed')
```

**Qué NO se modifica:**
- `knowledge_event_canonical` (composite type — NO cambia, ni se reabre `0108`)
- Source Registry (`knowledge_sources`)
- Adapter Pattern ni AuditLogAdapter
- Contratos públicos de lectura (`v_knowledge_timeline`, `KnowledgeEvent`, `mapTimelineRow`)
- Ninguna migración ya entregada (0106–0111)

**Resultado esperado:** el worker de F0.5.2 puede llamar `knowledge_emit_event(event, 'pending')` y el `dispatch_idx` comienza a ser útil. Los adaptadores síncronos existentes no requieren cambios.

**Responsable:** Engineering (a diseñar y acordar al inicio de F0.5.2, antes de escribir código del worker).

---

### 2. OBLIGATORIO — Confirmar el runner de migraciones prod (R-3)

**Problema:** las migraciones 0106–0111 no pueden aplicarse envueltas en una única transacción. Si lo hacen, 0110 falla porque intenta usar un valor de enum (`event_type`) que 0106 creó en la misma transacción — comportamiento definido de Postgres. El SQL no se autoprotege.

**Requerimiento:** el runner de prod debe aplicar cada archivo en su propia transacción separada. La memoria operativa indica que "prod usa timestamps" y deploy es semi-manual (`netlify deploy --prod`); el runner real no fue confirmado.

**Acción de Dirección:**
- Confirmar que el runner ejecuta archivo-por-archivo con transacciones separadas.
- Documentar el paso en `docs/runbooks/RELEASE.md` (si no existe aún la sección para migraciones knowledge).
- Ejecutar en el orden exacto: 0106 → 0107 → 0108 → 0109 → 0110 → 0111.

**Nota:** 0110 puede aplicarse después de 0109 sin problema; lo que no puede hacer es compartir la misma transacción que 0106.

---

### 3. RECOMENDADO — Aprobación G7 del spec con el banner verificado (R-1)

**Problema:** el spec `2026-06-28-nexus-connect-design.md` §5.3/§5.4 mostraba la Alternativa A RECHAZADA. Se aplicó un banner de override en esta sesión. Antes de presentar a G7, Dirección debe verificar que el banner es suficientemente visible para que ningún desarrollador aplique el SQL obsoleto.

**Acción de Dirección:** leer §5.3 del spec, confirmar que el aviso de reconciliación es claro, y recién entonces proceder con G7.

**Trazabilidad:** `docs/superpowers/F05-DOC-RECONCILIATION-CHECKLIST.md` ítem I-1.

---

## DURANTE F0.5.2

Las siguientes acciones no bloquean el arranque de F0.5.2 pero deben completarse dentro de la fase para no generar deuda que complique F0.5.3.

### 4. Índice del timeline — camino caliente (R-5)

**Problema:** `data.ts:70` ordena siempre por `seq desc`; ningún índice lo sirve hoy. El `dispatch_idx` excluye filas `processed` (que son todas las actuales). La PK es sobre `id` (uuid). El home del timeline hace sort completo en cada carga, y la paginación por offset agrava el scroll profundo de manera lineal.

**Acción:** crear índice en migración nueva:
```sql
CREATE INDEX IF NOT EXISTS knowledge_events_timeline_idx
  ON knowledge_events (status, seq DESC)
  WHERE status = 'processed';
```
O bien: alinear el cliente a `occurred_at desc` para reusar `entity_idx` (decidir cuál es el reloj lógico intencional antes de implementar).

### 5. Corregir sentinel `'∅'` en `entity_360` (R-4)

**Problema:** `coalesce(p.entity_id::text,'∅')` en `0109:33` hace que todas las filas de `audit_log` sin `entity_id` se materialicen con el sentinel y fluyan como `entity_id: '∅'` al cliente. En `v_knowledge_entity_360`, el JOIN agrupa todas esas filas bajo una pseudo-entidad navegable `'∅'`, colisionando identidades distintas y contaminando el 360 de entidades con datos de otras.

**Acción:** usar el `id` de la fila origen como `entity_id` cuando es NULL, o filtrar esas filas de `entity_360` (más conservador).

### 6. Keyset pagination en `TimelineScope`

**Problema:** la paginación actual usa offset. Con `seq` monótono indexable, el scroll profundo debería usar cursor.

**Acción:** reemplazar `offset` por cursor basado en `seq` en `listTimeline`; eliminar el ORDER BY embebido en vistas o el `.order('seq')` redundante del cliente (hoy existe doble ORDER BY).

### 7. Wrapper TS que fuerce filtro en `entity_360` (R-4)

**Problema:** `v_knowledge_entity_360` sin `WHERE entity_type + entity_id` empotrado hace el join completo + RLS×producto cartesiano sobre el fan-out de anotaciones. El `security_invoker` reevalúa la policy (`has_permission` + `is_staff` + `is_admin` + `split_part`) por cada fila del producto.

**Acción:** asegurar que el wrapper TS siempre inyecte `WHERE entity_type = $1 AND entity_id = $2` antes de ejecutar la vista. Nunca exponer la vista sin filtro.

### 8. `set search_path` en `has_permission` (R-4, Dim 4)

**Problema:** `has_permission` (`0009:164-175`) es la única función del stack auth de knowledge sin `set search_path` fijo, a diferencia del resto de helpers. F0.5 la convierte en frontera de seguridad del módulo.

**Acción:** agregar `SECURITY DEFINER SET search_path = public, pg_temp` a `has_permission` en migración nueva.

### 9. Catálogo único de nombres/forma de eventos EOL (R-8)

**Problema:** los nombres de eventos técnicos divergen en 3 direcciones: `observability.ts:47-53`, SQL `0108/0109`, y ADR. Ningún par coincide. Colectores cableados contra constantes TS no verán los logs reales del motor SQL.

**Acción:** definir una tabla exhaustiva `nombre → capa → emisor → receptor` como fuente de verdad única. Reconciliar los literales en TS y SQL con esa tabla. Implementar antes de cablear cualquier sink de observabilidad.

**Trazabilidad:** `docs/superpowers/F05-DOC-RECONCILIATION-CHECKLIST.md` ítem I-2.

---

## ANTES DE F0.5.3

Estas deudas tienen fecha límite hard en F0.5.3 porque coinciden con el momento en que `orders`/compras populan `searchable_items` y el read-model se vuelve relevante para datos sensibles.

### 10. Endurecer `public_auth` → `staff` para compras/proveedores/flota/compliance (R-7)

**Problema:** la función `knowledge_visibility_for` en `0108:55-56` mapea `purchase_order`/`supplier_invoice`/`vendor`/`fleet_vehicle`/`warehouse`/`compliance_item` a `public_auth`, lo que significa que cualquier usuario autenticado con `knowledge.view` puede ver esos eventos. Hoy es **inerte** (esos entity no se escriben a `audit_log`; RBAC dormido). Deja de serlo cuando F0.5.2 conecte ReconAdapter/OrdersAdapter.

**Requiere:** decisión D-1 de Dirección confirmando el endurecimiento (ver `docs/superpowers/F05-MILESTONE-CLOSURE-REPORT.md` §5).

**Acción:** `public_auth` → `'staff'` en el CASE de `knowledge_visibility_for`, en migración nueva antes de activar los adaptadores que emiten esas entidades.

### 11. Plan de activación de `user_roles` con gate por módulo (R-6)

**Problema:** al poblar `user_roles` (RBAC futuro), todo rol interno que tenga `knowledge.view` asignado ganará acceso al read-model de golpe, sin distinción por módulo. Hoy RBAC está dormido (0 filas en `user_roles`), por lo que es inerte. El riesgo es la activación big-bang en el futuro.

**Acción de Dirección:** definir el plan de activación módulo a módulo (ej: activar `knowledge.view` primero solo para `staff` → luego por rol granular → nunca de golpe para todos). Documentar en el runbook de activación de RBAC.

---

## OPCIONAL / MEJORA CONTINUA

Sin fecha límite fija. Recomendado pero no bloquea ninguna fase.

### 12. Re-etiquetar o remover `visibility.ts` / `visibility.test.ts` (R-9)

**Problema:** implementa reglas MACL (F7-F11) con test verde; da señal falsa de "feature lista".

**Acción:** agregar comentario `// SCAFFOLDING INERTE — MACL (F7+). No consumir. Ver ADR-MACL y D19.` al inicio de ambos archivos, o removerlos del scope activo. Silenciar o marcar el test como `skip`.

**Trazabilidad:** `docs/superpowers/F05-DOC-RECONCILIATION-CHECKLIST.md` ítem I-5.

### 13. Helper genérico de backfill

Consolidar el boilerplate de ~50 líneas que se repite por fuente (backfill loop + logs EOL + registro en `knowledge_sources`). Evita drift de observabilidad entre adaptadores. A diseñar al incorporar la segunda fuente en F0.5.2.

### 14. Auditar Realtime×RLS (R-10)

`knowledge_events` está en `supabase_realtime` (`0111:47`). Cada suscriptor paga evaluación de policy por evento en tiempo real. Auditar el costo antes de exponer suscripciones en la UI.

### 15. Reconciliar vocabulario `entity_type` del CASE con la fuente real (I-4)

**Problema:** el CASE en `knowledge_visibility_for` lista entidades que no coinciden con los valores reales emitidos por `audit_log`, haciendo que casi todo caiga al default `'staff'`. El feature queda vacío para entidades no listadas.

**Acción:** relevar los valores activos de `event_type`/`entity_type` en la DB de prod y reconciliarlos con el CASE. No rompe contratos; es corrección de configuración.

**Trazabilidad:** `docs/superpowers/F05-DOC-RECONCILIATION-CHECKLIST.md` ítem I-4.

---

## Resumen de prioridades

| Prioridad | Momento | Ítem | Responsable |
|-----------|---------|------|-------------|
| 🔴 OBLIGATORIO | Antes de F0.5.2 | 1. Contrato `p_status` del emisor | Engineering |
| 🔴 OBLIGATORIO | Antes de F0.5.2 | 2. Confirmar runner de migraciones prod | Dirección |
| 🟠 RECOMENDADO | Antes de F0.5.2 | 3. Aprobación G7 con banner verificado | Dirección |
| 🟡 DURANTE | F0.5.2 | 4. Índice timeline `(status, seq desc) WHERE processed` | Engineering |
| 🟡 DURANTE | F0.5.2 | 5. Corregir sentinel `'∅'` en `entity_360` | Engineering |
| 🟡 DURANTE | F0.5.2 | 6. Keyset pagination en `TimelineScope` | Engineering |
| 🟡 DURANTE | F0.5.2 | 7. Wrapper TS con filtro obligatorio en `entity_360` | Engineering |
| 🟡 DURANTE | F0.5.2 | 8. `set search_path` en `has_permission` | Engineering |
| 🟡 DURANTE | F0.5.2 | 9. Catálogo único EOL | Engineering |
| 🔴 HARD DEADLINE | Antes de F0.5.3 | 10. `public_auth` → `staff` (requiere D-1) | Dirección + Engineering |
| 🔴 HARD DEADLINE | Antes de F0.5.3 | 11. Plan de activación `user_roles` con gate | Dirección |
| ⚪ OPCIONAL | Cuando convenga | 12. Re-etiquetar `visibility.ts` | Engineering |
| ⚪ OPCIONAL | Cuando convenga | 13. Helper genérico de backfill | Engineering |
| ⚪ OPCIONAL | Antes de activar realtime | 14. Auditar Realtime×RLS | Engineering |
| ⚪ OPCIONAL | Durante F0.5.2 | 15. Reconciliar vocabulario `entity_type` | Engineering |

---

## Trazabilidad

- Fuente: `docs/superpowers/F05-RELEASE-READINESS-REVIEW.md` §3 (R-1..R-11) y §4 (Rec 1..15)
- Estado del worktree en el cierre de F0.5: `284b5fb` · rama `worktree-feat+f05-knowledge-foundation` · NADA pusheado/mergeado/aplicado a DB
- Punto de restauración entre fases: commit `284b5fb`

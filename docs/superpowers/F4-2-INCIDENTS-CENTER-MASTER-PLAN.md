# F4.2 · Nexus Link — Centro de Incidentes · Master Plan

> **Estado: PROPUESTA — pendiente de aprobación de Dirección (GO §12).**
> Fecha: 2026-07-02. Autor: sesión de planificación F4.2 (habilitada por cierre formal de F4.1).
> **Solo planificación: en esta sesión NO se implementó código, NO se crearon/aplicaron migraciones,
> NO se tocó producción, NO hubo deploy/push/merge/commit.**
> Fuentes: spec `specs/2026-06-28-nexus-connect-design.md` (**Addendum A2**, §A4, §A10),
> `F4-KICKOFF-SCOPE-PLAN.md` (Master Plan F4 aprobado, §3 ítem 5 y §5 bloque 1),
> `F4-1-COLLABORATION-FOUNDATION-*` (plan/execution log/validation pack),
> `F4-1-SCHEDULING-OPS-FINDING.md` (deuda OPS abierta), verificación read-only en vivo (§2).

---

## 1. Resumen ejecutivo

F4.1 cerró formalmente con la fundación colaborativa viva en producción (fan-out crítico síncrono,
menciones, notificaciones accionables, higiene F3). F4.2 implementa el **Centro de Incidentes**
según el diseño ya aprobado en el **Addendum A2 del spec**: el flujo de ticket operativo
(sector → avería → fotos → comentarios → asignación → estado → resolución) modelado como **entidad
de primera clase vinculada 1:1 a una conversación** `kind='incident'`, reusando todo el motor de
chat, adjuntos, notificaciones y RBAC construido en F3/F4.1.

No hay diseño nuevo que inventar: A2 define modelo de datos, RPCs de ciclo de vida y wireframe.
Este Master Plan baja A2 a plan ejecutable: migraciones concretas (desde **`0164`**, verificado
libre), decisiones de integración con la fundación F4.1 (fan-out de incidentes **síncrono** para
lo crítico, dado que el scheduler del worker sigue en deuda OPS), adapter Knowledge, UI, validación
y entregables.

## 2. Verificación de estado real (read-only, 2026-07-02 ~01:05Z)

| # | Ítem | Resultado | Evidencia |
|---|---|---|---|
| 1 | `/api/version` | **`bef2f78`** · environment=`production` · builtAt 2026-07-01T23:33:20Z | curl en vivo |
| 2 | Última migración aplicada en prod | **`0163_connect_archived_guards`** (version `20260701230222`) | `supabase_migrations.schema_migrations` vía MCP |
| 3 | Migs F4.1 | `0160_connect_outbox_worker` · `0161_connect_mentions_fanout` · `0162_connect_notification_actions` · `0163_connect_archived_guards` — **todas aplicadas** | ídem |
| 4 | Próxima migración libre | **`0164`** — sin colisiones en `schema_migrations`, en `supabase/migrations/` de ningún worktree, ni en el historial de ninguna rama (`git log --all -- 'supabase/migrations/0164*'` vacío) | verificación en vivo |
| 5 | Worktree de trabajo F4 | `~/CODE/tops-ordenes-f41-foundation` · rama `feat/connect-f4-1-collaboration-foundation` · HEAD `698ce80` = `bef2f78` (prod) + 4 commits de docs de cierre F4.1 | `git log` |
| 6 | Reservas F3 para incidentes | Enum conversación incluye `'incident'` (`0143:20`); catálogo de kinds de notificación reserva `'connect_incident'` (`0147:13`) | grep migraciones |
| 7 | Fundación F4.1 disponible | `connect_worker_runs` + worker outbox (0160), fan-out síncrono de menciones/DM (0161), RPCs snooze/delegar/prioridad (0162), guardas de archivado (0163) | migraciones aplicadas + smoke PASS Dirección |
| 8 | Deuda OPS vigente | Scheduler Netlify `connect-dispatch-outbox` registrado `*/5` pero **nunca invocado**; backlog outbox 34+ `pending` inerte; finding ABIERTO, no bloqueante por directiva de Dirección | `F4-1-SCHEDULING-OPS-FINDING.md` §6 |
| 9 | Addendum A2 | Presente en spec (líneas 2898-2932): DDL de `connect_incidents`, enums, RPCs de ciclo, decisión `sla_due_at` informativo | lectura directa |
| 10 | Checkout `~/CODE/tops-ordenes` | En rama `release/fiscal-f1-unified` @ `f3b3688` (desactualizado, migs hasta 0124) — **NO usar para F4.2** | `git worktree list` |

**Delta vs Master Plan F4 (kickoff):** el kickoff estimaba F4.2 en migs `0163`–`0165`; F4.1 consumió
hasta `0163`, por lo que F4.2 numera desde **`0164`** (re-verificar contra `schema_migrations` al
momento de autorar cada migración — prod numera por timestamp, gotcha conocido).

## 3. Objetivo de F4.2

Que un incidente operativo de TOPS (avería en depósito, falla de equipo, corte de servicio, problema
de flota) se **reporte, asigne, siga y resuelva dentro de Nexus** con: identificador público
(`INC-AAAA-NNNN`), severidad, estado con transiciones validadas, sector/ubicación, hilo de
comentarios y fotos (motor de chat existente), notificaciones a reportante/asignado, trazabilidad
completa (audit_log append-only + evento Knowledge) y una vista de gestión (lista filtrable +
detalle con hilo). Reemplaza la coordinación de incidentes que hoy vive en WhatsApp personal
(Regla de Decisión del programa: PASA).

## 4. Alcance

### Incluido

| # | Ítem | Detalle |
|---|---|---|
| 1 | Modelo de datos A2 | `connect_incidents` (+ enums `connect_incident_status_t`, `connect_incident_severity_t`), FK 1:1 a `connect_conversations`, `public_id` `INC-AAAA-NNNN` por sequence+trigger (patrón OS-/PROS-), RLS |
| 2 | RPCs de ciclo de vida | `connect_incident_open` / `connect_incident_assign` / `connect_incident_set_status` / `connect_incident_resolve` — SECDEF, transiciones validadas, audit append-only, P-1 |
| 3 | Notificaciones | Kind `connect_incident` (ya reservado): apertura→sector/rol responsable, asignación→asignado, cambio estado/resolución→reportante+asignado. **Camino crítico síncrono** (ver §6-D2) |
| 4 | Hilo del incidente | Conversación `kind='incident'` creada por `connect_incident_open`; comentarios/fotos = `connect_messages`/`connect_attachments` existentes (cero código nuevo de chat) |
| 5 | UI Centro de Incidentes | Lista filtrable (estado/severidad/sector/asignado) + panel de detalle con hilo + formulario de reporte; ruta bajo `/connect` (bounded context `connect`) |
| 6 | Knowledge | Adapter nuevo `source_table='connect_incidents'` vía `knowledge_emit_event` + fila en `knowledge_sources` (patrón 0149; prohibido INSERT directo) |
| 7 | RBAC | Reuso de `connect.view`; permiso nuevo `connect.incident_admin` (asignar/cerrar cross-sector) solo por migración idempotente de catálogo |
| 8 | Card básica | Contador/lista mínima de incidentes abiertos donde el Master Plan F4 la ubicó (card básica en F4.2; el cockpit colaborativo completo es F4.3) |
| 9 | ADR-TASKS (paralelo) | Redacción del ADR de Tareas colaborativas durante F4.1–F4.2 según Master Plan F4 §3.6 — es diseño, no implementación |

### Excluido (explícito)

| Ítem | Motivo | Cuándo |
|---|---|---|
| Motor de SLA / escalamiento automático | Decisión A2: `sla_due_at` queda **informativo** (se muestra, no dispara nada) | Fase propia post-F4 |
| Tareas colaborativas (implementación) | Requiere ADR-TASKS aprobado | F4.3 |
| Workflows entre áreas / cockpit colaborativo completo | Dependen de tareas | F4.3 |
| Incidentes reportados por externos (clientes/proveedores) | F4 es 100% interno; RBAC dormido (RS-2) y landmine `handle_new_user` bloquean exposición externa | F5 |
| Automatizaciones sobre incidentes ("crítico → notificar rol X" vía outbox) | MVP de automatizaciones es F4.4; además el scheduler del worker está en deuda OPS | F4.4 |
| FK de `sector` a `wms.warehouse_sectors` | A2 lo deja como texto libre con FK futura; el modelo físico WMS (migs 0020-0022) NO está aplicado | Cuando WMS aterrice |
| Resolver la deuda OPS del scheduler | Directiva de Dirección: no investigar/no ticket/no redeploy por ahora; F4.2 se diseña para NO depender del worker | Backlog OPS |
| Centro de Monitoreo / CCTV | Excluido de F4 por gobernanza del Dossier | Post-F4 + ADR |

## 5. Diseño técnico (baja a tierra del Addendum A2)

### 5.1 Modelo de datos (mig `0164`)

DDL base = A2 textual (spec:2902-2930): enums `connect_incident_status_t`
(`abierto|en_progreso|en_espera|resuelto|cerrado`) y `connect_incident_severity_t`
(`baja|media|alta|critica`); tabla `connect_incidents` con `public_id` único, `conversation_id`
NOT NULL → `connect_conversations(id)` ON DELETE RESTRICT, `titulo`, `sector`, `ubicacion`,
`tipo_averia`, `severidad` (default media), `estado` (default abierto), `reportado_por`,
`asignado_a`, `sla_due_at`, `resuelto_at`, `resolucion_text`, timestamps.

Adiciones de implementación (no contradicen A2, lo completan):
- Sequence + trigger para `public_id` `INC-AAAA-NNNN` (patrón existente OS-/PROS-; reset anual por año en el prefijo).
- Índices: `(estado, severidad)`, `(asignado_a) where estado not in ('resuelto','cerrado')`, `(sector)`, `(created_at desc)`.
- Trigger `updated_at` (patrón repo).
- Constraint de unicidad 1:1: `unique(conversation_id)`.
- RLS: SELECT = `has_permission('connect.view') AND _connect_is_member(conversation_id)`; sin INSERT/UPDATE/DELETE directo por policy (solo RPC SECDEF). Vistas, si las hay, `security_invoker`.

### 5.2 RPCs de ciclo de vida (mig `0165`)

Todas SECURITY DEFINER + `search_path` fijo + guards NULL-safe (política P-1) + gate
`has_permission('connect.*')` + revoke `anon`/`authenticated` según patrón H-E1-1 + registro
append-only en `audit_log`:

| RPC | Efecto | Reglas |
|---|---|---|
| `connect_incident_open(titulo, sector, ubicacion, tipo_averia, severidad, descripcion)` | Crea conversación `kind='incident'` + participante reportante + fila `connect_incidents` + primer mensaje con la descripción + notificación | Cualquier usuario interno con `connect.view` puede reportar |
| `connect_incident_assign(p_id, p_to)` | Setea `asignado_a`, agrega asignado como participante del hilo, notifica al asignado | Asignar requiere `connect.incident_admin` (o auto-asignación) |
| `connect_incident_set_status(p_id, p_status)` | Transición validada por máquina de estados | `abierto→en_progreso→en_espera↔en_progreso→resuelto→cerrado`; reabrir `resuelto→en_progreso` permitido; `cerrado` terminal |
| `connect_incident_resolve(p_id, p_resolucion)` | `estado='resuelto'`, `resuelto_at=now()`, `resolucion_text` obligatorio, notifica reportante | Asignado o `incident_admin` |

Nota: la matriz exacta de transiciones y quién puede ejecutar cada una se congela en la revisión
de diseño detallado de la Etapa 1 (§7) — A2 valida transiciones pero no fija la matriz; la
propuesta de arriba es el default a aprobar.

### 5.3 Notificaciones e integración con la fundación F4.1

- Kind `connect_incident` (reservado en 0147) con payload **sin PII ni contenido**: `{incident_id, public_id, event: opened|assigned|status_changed|resolved, estado, severidad}` (RS-3).
- **Camino crítico SÍNCRONO** dentro de las RPCs (mismo patrón que menciones/DM de 0161): asignación → asignado; cambio de estado/resolución → reportante + asignado. Son 1-2 filas por evento; no depende del worker (decisión D2, §6).
- Fan-out masivo eventual (p.ej. avisar a todo un sector en apertura de crítico) → **se encola en `connect_outbox` pero NO se promete en F4.2** mientras el scheduler siga en deuda; queda listo para F4.4/resolución OPS.
- Prioridad de la notificación mapeada a severidad (`critica→high`), aprovechando `priority` de 0147 y las acciones de 0162 (snooze/delegar aplican gratis a incidentes).

### 5.4 Knowledge (mig `0166`)

Adapter `connect_incidents` según patrón 0149: función `knowledge_connect_incidents_to_canonical()`,
trigger AFTER INSERT/UPDATE OF estado/asignado_a que emite vía `knowledge_emit_event` **solo si**
`knowledge_sources.enabled`, función de backfill, INSERT idempotente en `knowledge_sources`
(`enabled=false` por default hasta validación, mismo criterio que F3/F4.1). Payload canónico con
IDs/estados, sin texto libre del hilo.

### 5.5 UI y capas

- Patrón invariante: Feature `src/app/(app)/connect/incidentes/*` → Server Actions → `src/lib/connect/{read,application,adapters}` → Supabase; guard `isMock()`.
- Vistas: lista (tabla filtrable por estado/severidad/sector/asignado, orden por severidad+antigüedad, `public_id` visible) + detalle (metadata + acciones de ciclo según permiso + hilo embebido reusando el componente de conversación existente) + formulario de reporte (título, sector, tipo avería, severidad, descripción, fotos vía `connect-files`).
- Dark mode: tokens del design system (gotcha conocido: nada de `/opacity` sobre tokens `var()`; card oficial = clase `.card`).
- Card básica de incidentes abiertos: read-only, patrón `src/lib/ejecutivo/command-center.ts`.

## 6. Decisiones de diseño a ratificar por Dirección

| # | Decisión | Propuesta (default) | Alternativa |
|---|---|---|---|
| D1 | Numeración | `0164`–`0166` (3 migs: schema / RPCs / Knowledge adapter) | Consolidar en 2 |
| D2 | Fan-out de incidentes con scheduler caído | **Síncrono en RPC** para reportante/asignado (patrón 0161); outbox solo para masivo futuro | Esperar resolución OPS del worker (bloquearía F4.2 — no recomendado) |
| D3 | Permiso nuevo | `connect.incident_admin` para asignar/cerrar cross-sector; reportar/ver = `connect.view` | Reusar solo roles existentes sin permiso nuevo |
| D4 | Máquina de estados | La matriz de §5.2 (reabrir permitido desde `resuelto`, `cerrado` terminal) | Sin reapertura (más rígida) |
| D5 | `knowledge_sources.enabled` inicial | `false` (activar tras validación piloto, como F3/F4.1) | `true` desde el apply |
| D6 | Ubicación UI | `/connect/incidentes` (bounded context connect, decisión de arquitectura del kickoff §9) | Ruta top-level `/incidentes` |

Si Dirección no objeta, los defaults quedan congelados con el GO.

## 7. Plan de implementación (etapas — post-GO)

| Etapa | Contenido | Salida |
|---|---|---|
| E0 | Setup: re-verificar `/api/version`, `schema_migrations`, `0164` libre; ramificar worktree/rama F4.2 desde la punta real de prod (`bef2f78`/`698ce80`) | Entorno congelado |
| E1 | Diseño detallado congelado: matriz de transiciones, payloads de notificación, contrato canónico Knowledge, wireframe de las 3 vistas | Mini-spec de ejecución (delta sobre A2) |
| E2 | Migraciones `0164`–`0166` idempotentes (2ª corrida = no-op) + `ROLLBACK_0164_0166.md` — **entregadas, NO aplicadas (G3)** | SQL + rollback |
| E3 | Capa lib/server actions (`src/lib/connect/*`) + tests | Código + tests verdes |
| E4 | UI (lista/detalle/reporte) + notificaciones en `NotificationCenter` + card básica | Feature completa local |
| E5 | Kit de validación SQL read-only + Validation Pack (smoke checklist) | Kit + pack |
| E6 | Revisión adversarial (0 critical/0 important) + Engineering Readiness Review | Informes |
| E7 | **Ventana autorizada por Dirección**: apply `0164`–`0166` → checkpoints DB → deploy draft-first (Node 22.23.1, checkout NO-worktree, procedimiento DEPLOY-1) → smoke 0 5xx → piloto por sector | Run Log |
| E8 | Cierre formal F4.2 + actualización de memoria/dossier + handoff F4.3 | Closure report |

Cada etapa reporta antes de pasar a la siguiente; E7 exige autorización expresa por ítem.

## 8. Dependencias y precondiciones (verificadas)

- ✅ Enum `kind='incident'` y kind `connect_incident` ya en prod (0143/0147) — **cero migración de enums**.
- ✅ Fan-out síncrono probado en prod (0161) — patrón a replicar.
- ✅ RPCs de acción de notificaciones (0162) — snooze/delegar/prioridad aplican a incidentes sin trabajo extra.
- ✅ Motor de chat/adjuntos/buckets (`connect-files*`, AV según diseño F3) — el hilo del incidente es una conversación más.
- ✅ Emisor único Knowledge + patrón adapter (0149) en prod.
- ✅ Patrón `public_id` (OS-/PROS-) en el repo.
- ⚠️ Scheduler worker en deuda OPS → cubierto por D2 (síncrono); **no es precondición**.
- ⚠️ `main` divergida / ramas F3-F4.1 sin merge → F4.2 se ramifica desde `bef2f78` (punta real de prod); la reconciliación de ramas sigue siendo tarea separada de Dirección (RO-3 del kickoff).
- ⚠️ Numeración por timestamp en prod → re-verificar `0164` libre en E0 y antes de E7.

## 9. Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | Colisión de numeración de migs (prod numera por timestamp) | Baja | Alto | Re-verificación doble (E0 + pre-E7) contra `schema_migrations` en vivo |
| R2 | Notificaciones de incidentes dependieran del worker caído | — | Alto | Eliminado por diseño (D2: crítico síncrono) |
| R3 | Scope creep hacia SLA/tareas/automatizaciones | Media | Medio | Exclusiones §4 explícitas; NO GO ante scope nuevo |
| R4 | Máquina de estados mal calibrada para la operación real | Media | Medio | Ratificación D4 + piloto por sector con feedback antes de ampliar |
| R5 | Deploy: repetir el outage del 30/06 | Baja | Crítico | Procedimiento DEPLOY-1 obligatorio (Node 22.23.1, NO-worktree, draft-first); desvío = STOP |
| R6 | PII en payloads (notificación/Knowledge) | Baja | Alto | Regla RS-3: solo IDs/estados; checklist de validación lo verifica |
| R7 | Fotos de incidentes: bucket `connect-files` con hallazgos de auditoría de storage (buckets públicos previos) | Media | Medio | Reusar buckets Connect (privados por diseño F3); no crear buckets nuevos; verificación en kit SQL |
| R8 | Adopción (reportar en Nexus vs WhatsApp) | Media | Alto | Piloto acotado a 1 sector con caso real; formulario de reporte mínimo (< 1 min) |

## 10. Entregables (10, contrato de la metodología)

1. Este Master Plan aprobado (`F4-2-INCIDENTS-CENTER-MASTER-PLAN.md`).
2. Mini-spec de ejecución E1 (matriz de estados + payloads + contrato Knowledge congelados).
3. Migraciones `0164`–`0166` idempotentes, entregadas-NO-aplicadas.
4. `ROLLBACK_0164_0166.md` (procedimiento de reversa por migración).
5. Código completo (lib + server actions + UI + card) con typecheck 0 / lint 0 / build OK / tests verdes sin bajar el conteo base (285+).
6. Kit de validación SQL read-only (RLS, grants, idempotencia, RBAC, payloads).
7. Validation Pack F4.2 (smoke funcional + checklist de piloto por sector).
8. Informe de revisión adversarial (0 critical / 0 important) + Engineering Readiness Review.
9. Execution/Run Log de la ventana apply+deploy (checkpoints DB, deploy id, smoke, `/api/version`).
10. Closure Report F4.2 + actualización de memoria institucional y handoff a F4.3.

## 11. Validación (criterios de cierre)

Checklist §13 del Master Plan F4 íntegro, más específicos de F4.2:
- [ ] Un incidente E2E en prod (piloto): reportar → notificación → asignar → notificación al asignado → comentario+foto en hilo → resolver → notificación al reportante → fila en `audit_log` por cada transición.
- [ ] `public_id` secuencial correcto (`INC-2026-0001`…), único, visible en UI.
- [ ] Transición inválida rechazada por RPC (probado con SQL directo, no solo UI).
- [ ] RLS: usuario no-miembro del hilo NO ve el incidente (kit SQL).
- [ ] Payloads de notificación y Knowledge sin PII/contenido.
- [ ] `knowledge_sources('connect_incidents')` presente; emisión verificada al habilitar (según D5).
- [ ] Smoke 0 5xx post-deploy; `/api/version` = commit esperado.

## 12. Criterios GO / NO GO

**GO para iniciar E0–E6 (desarrollo local, sin tocar prod) — todos requeridos:**
1. Este Master Plan aprobado por Dirección.
2. Decisiones D1–D6 ratificadas (o defaults aceptados).
3. Alcance §4 congelado.

**GO adicional para E7 (única etapa que toca prod):** autorización expresa de la ventana
apply+deploy por ítem, con re-verificación previa de `/api/version` y `schema_migrations`.

**NO GO / STOP inmediato si:**
- Cualquier paso exige tocar prod (DB/deploy/push/merge/env/RBAC) fuera de la ventana E7 autorizada.
- Aparece scope no listado en §4 (vuelve a planificación).
- El estado de prod difiere del verificado en §2 al momento de cualquier ventana.
- Un hallazgo de la revisión adversarial queda en critical/important sin resolver.
- El diseño contradice A2 o el Dossier sin ADR aprobado.

## 13. Roadmap estimado

| Hito | Estimación |
|---|---|
| Aprobación Master Plan + setup (E0–E1) | Días 0–2 |
| Migraciones + rollback (E2) | Días 2–4 |
| Lib + tests (E3) | Días 4–8 |
| UI + notificaciones + card (E4) | Días 7–13 |
| Kits + adversarial + readiness (E5–E6) | Días 12–15 |
| Ventana apply+deploy + smoke + piloto (E7) | Días 15–18 (según ventana de Dirección) |
| Cierre formal (E8) | Días 17–18 |

Total: **~12–18 días-dev**, consistente con la estimación del Master Plan F4 (§10).

## 14. Confirmación de no-implementación

En esta sesión de planificación **NO se implementó nada**: cero código de producto, cero
migraciones creadas o aplicadas, cero cambios de DB/RBAC/env/storage, cero deploy, cero push,
cero merge, cero commit. Todas las consultas a producción fueron read-only (`/api/version` por
HTTP GET y `schema_migrations` por SELECT vía MCP). Único artefacto producido: este documento,
escrito en el working tree del worktree `tops-ordenes-f41-foundation` y **dejado sin commitear**
conforme a G1 (el asistente prepara y muestra; commitea Martín).

---

**Próximo paso:** decisión de Dirección sobre §6 (D1–D6) y §12 (GO). Hasta entonces, STOP.

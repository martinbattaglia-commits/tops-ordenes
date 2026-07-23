# F4 · Nexus Link — Kickoff, Alcance y Master Plan

> **Estado: PROPUESTA — pendiente de aprobación de Dirección (G7).**
> Fecha: 2026-07-01. Autor: sesión de planificación F4 (kickoff autorizado por D8, cierre F3).
> **Solo planificación: en esta fase NO se implementó código, NO se tocó DB, NO hubo deploy/push/merge.**
> Fuentes: handoff F3→F4, `F3-FINAL-CLOSURE-REPORT.md`, spec `specs/2026-06-28-nexus-connect-design.md`
> (Addendums A2/A4/A10/A11), Master Dossier (`docs/nexus-link-master-dossier`), relevamiento read-only
> del código en `a6c23f9` (worktree `tops-ordenes-admin-surface-8-10`).

---

## 1. Resumen ejecutivo

F3 dejó Nexus Link (chat interno, canales, conversaciones contextuales ERP, búsqueda, notificaciones
básicas) **vivo y validado en producción** (`a6c23f9`, migs hasta `0159`). F4 lo convierte en el
**ecosistema colaborativo operativo de Nexus OS**: incidentes, tareas, menciones, notificaciones
avanzadas, workflows entre áreas y —de-riesgadas primero— integraciones externas.

El relevamiento read-only del código muestra que **F3 ya dejó construida más fundación de la
asumida**: `connect_outbox` encola cada mensaje (falta el consumidor), `connect_message_mentions`
existe (falta parser/notificación), `notifications` ya tiene `priority`/`remind_at`/`delegated_to`
(faltan las RPCs de acción), y el Centro de Incidentes tiene **diseño completo aprobado en el spec
(Addendum A2)**. En cambio, **Tareas colaborativas no existen en spec ni código** (gobernanza del
Dossier: capacidad nueva ⇒ ADR + diseño antes de construir) y el driver WhatsApp `src/lib/whatsapp/meta.ts`
que el spec asumía reutilizable **no existe** (el webhook actual es un stub sin HMAC).

**Recomendación:** ejecutar F4 en 4 subfases con validación incremental:
**F4.1 Fundación colaborativa** (worker de fan-out + menciones + notificaciones avanzadas + higiene F3)
→ **F4.2 Centro de Incidentes** (implementa Addendum A2) → **F4.3 Tareas + workflows + cockpit
colaborativo** (previo ADR-TASKS) → **F4.4 spikes de integraciones externas + automatizaciones MVP**.
Esto cubre el trío sugerido por Dirección (incidentes + tareas + notificaciones) pero **en orden de
dependencias**: los incidentes sin fan-out de notificaciones pierden la mitad de su valor, y las
tareas no pueden construirse sin diseño aprobado.

---

## 2. Objetivo de F4

Extender Nexus Link más allá del chat para que la operación diaria de TOPS (depósito, flota,
compliance, comercial, administración) **se coordine dentro de Nexus**: reportar y resolver
incidentes, asignar y seguir tareas, mencionar personas, recibir notificaciones priorizables y
accionables, y encadenar trabajo entre áreas — con trazabilidad completa (audit_log + Knowledge) y
sin abrir superficie externa hasta de-riesgarla. Pasa la Regla de Decisión: cada bloque reemplaza
coordinación que hoy vive en WhatsApp personal/planillas/Neuralsoft.

## 3. Alcance incluido

| # | Ítem | Subfase |
|---|---|---|
| 1 | Worker/consumidor de `connect_outbox` (fan-out mensaje→notificación; base de menciones, incidentes y automatizaciones) | F4.1 |
| 2 | Menciones `@usuario` end-to-end (parser en composer + autocomplete reutilizando `connect_search_profiles` de mig `0158` + fila en `connect_message_mentions` + notificación `connect_mention`) | F4.1 |
| 3 | Notificaciones avanzadas (RPCs A4: snooze `remind_at`, delegar `delegated_to`, prioridad; acciones en `NotificationCenter`) | F4.1 |
| 4 | Higiene F3: R-2 (filtro archivados en notificaciones, 1 línea) + R-3 (guarda server-side de archivado en `connect_post_message`) + F-1 (affordance "Unirme"); F-3 (RLS admin no-miembro) a evaluar | F4.1 |
| 5 | Centro de Incidentes según Addendum A2: `connect_incidents` (public_id `INC-AAAA-NNNN`, severidad, estado, sector, asignación, `sla_due_at` informativo), RPCs de ciclo (`open/assign/set_status/resolve`), conversación `kind='incident'` (enum ya reservado), UI lista+detalle+hilo, notificaciones `connect_incident`, fuente Knowledge nueva | F4.2 |
| 6 | ADR-TASKS (diseño de Tareas colaborativas: entidades, estados, asignación, vencimientos, relación con incidentes/conversaciones) — se redacta durante F4.1/F4.2 | F4.1–F4.2 (diseño) |
| 7 | Tareas colaborativas (implementación post-ADR aprobado) | F4.3 |
| 8 | Workflows operativos entre áreas (encadenamiento de tareas/estados entre sectores; sin motor genérico de workflows) | F4.3 |
| 9 | Cockpit colaborativo (card read-only de Connect/incidentes/tareas en el Cockpit Ejecutivo, patrón `src/lib/ejecutivo/command-center.ts`) | F4.3 |
| 10 | Spike/PoC WhatsApp Business (driver Meta Cloud API inexistente hoy + webhook con HMAC timing-safe + ventana 24h) — **solo de-risk, sin integración productiva** | F4.4 |
| 11 | Spike/PoC Email integrado (outbound ya vivo vía Resend `src/lib/email.ts`; evaluar inbound) — **solo de-risk** | F4.4 |
| 12 | Automatizaciones MVP: reglas acotadas sobre eventos del outbox (p.ej. "incidente crítico → notificar rol X") — **sin motor genérico** | F4.4 |

## 4. Alcance excluido (explícito)

| Ítem | Motivo | Cuándo |
|---|---|---|
| **Centro de Monitoreo / CCTV** | No existe en spec ni en el Master Dossier como diseño (solo concepto "diseñado-en-chat"). Gobernanza del Dossier: prohibido crear arquitectura paralela; requiere reconciliación + ADR propio + definición de hardware/ingesta | Post-F4, previa fase de arquitectura |
| Integración productiva WhatsApp Business | Driver inexistente, webhook stub sin HMAC, compliance Meta, secretos | F5± según resultado del spike F4.4 |
| Integración productiva Email inbound | Requiere diseño de ingesta/parsing/PII | Según spike F4.4 |
| Motor genérico de automatizaciones / SLA engine | `sla_due_at` queda informativo (decisión A2); motor = fase propia | Post-F4 |
| Portales externos / clientes / proveedores | F5 del roadmap Connect; bloqueado además por landmine `handle_new_user` y H-1 | F5 |
| IA conversacional, videollamadas | Roadmap Connect F3-bis+ (spec) | Post-F4 |
| Activación `RBAC_ENFORCE=1` | Proceso separado (`F3-H1-RBAC-DECISION-PACK.md`); obligatorio ANTES de cualquier exposición externa | Ventana propia |
| OIL / Memoria Operativa / KIL (F7-F11) | Solo visión en spec Parte III; no se implementa | Roadmap largo |

## 5. Bloques funcionales (análisis de los 10 candidatos)

| Bloque | Base existente (evidencia) | Falta | Veredicto |
|---|---|---|---|
| 1. Centro de Incidentes | Diseño completo Addendum A2 (spec:2898-2932); enum conversación `kind='incident'` reservado (0143:20); kind de notificación `connect_incident` reservado (0147:12-13) | Tabla+RPCs+UI+notifs (todo lo diseñado) | **F4.2** |
| 2. Tareas colaborativas | **Nada** (no está entre los 11 subsistemas del spec §1.4) | Todo, empezando por el diseño (ADR) | **F4.3** (ADR antes) |
| 3. Menciones | Tabla `connect_message_mentions` + índices + realtime (0143:206-215, 0147:28-39); autocomplete de perfiles ya en prod (0158) | Parser `@` en composer, escritura de menciones en `connect_post_message`, notificación | **F4.1** |
| 4. Notificaciones avanzadas | Columnas `priority`/`remind_at`/`delegated_to` en prod (0147:17-22); `NotificationCenter` agrupa por prioridad con realtime+polling; filtro snooze en read layer | RPCs `connect_notif_snooze/delegate/set_priority`; **fan-out** (hoy los mensajes NO generan notificación) | **F4.1** |
| 5. WhatsApp Business | Config env + webhook stub (`src/app/api/whatsapp/webhook/route.ts`) | Driver `meta.ts` (NO existe pese a que el spec lo asumía), HMAC timing-safe, inbound, ventana 24h, compliance | **F4.4 spike** |
| 6. Email integrado | Resend outbound vivo (`src/lib/email.ts`) para OC | Inbound, ruteo a conversaciones, PII | **F4.4 spike** |
| 7. Automatizaciones | `connect_outbox` con trigger que encola cada mensaje (0143:274-289, 0144:54-57); patrón worker probado (`/api/knowledge/drain` + CRON_SECRET + GH Actions, mig 0133) | Consumidor + reglas | **F4.4 MVP** (el worker en sí = F4.1) |
| 8. Centro de Monitoreo / CCTV | **Nada** en spec/dossier/código | Reconciliación con Dossier + ADR + hardware | **EXCLUIDO de F4** |
| 9. Cockpit colaborativo | Cockpit Ejecutivo vivo; patrón card read-only conocido | Card de Connect/incidentes/tareas | **F4.3** (chico) |
| 10. Workflows entre áreas | Primitivas de conversación/participantes/links polimórficos | Depende de Tareas (F4.3) | **F4.3** |

## 6. Priorización (criterios de Dirección aplicados)

Matriz sobre los bloques incluidos (escala alta/media/baja):

| Criterio | F4.1 Fundación | F4.2 Incidentes | F4.3 Tareas/Workflows | F4.4 Spikes ext. |
|---|---|---|---|---|
| Valor operativo | Alto (todo Connect empieza a "avisar") | **Muy alto** (dolor real 3PL) | Alto | Medio (de-risk) |
| Riesgo | **Bajo** (interno, diseño A4 listo) | Medio (módulo nuevo, diseño listo) | Medio-alto (greenfield) | Alto (externos) → por eso spike |
| Dependencia de F3 | Directa: reusa outbox/0158/A4 | Necesita fan-out de F4.1 | Necesita F4.1 + ADR | Independiente |
| Complejidad técnica | Media (worker = patrón 0133 reusado) | Media | Media-alta | Alta |
| Impacto en usuarios | Inmediato y visible | Muy alto | Alto | Nulo (interno) |
| Seguridad | Sin superficie nueva externa | Sin superficie externa | Sin superficie externa | **Crítica** (HMAC, secretos) |
| Trazabilidad | Eventos vía emisor Knowledge + audit | `INC-` public_id + audit append-only | Por diseño en ADR | N/A |
| Validación incremental | Piloto en días | Piloto por sector | Piloto por área | GO/NO-GO por spike |

**Orden propuesto: F4.1 → F4.2 → F4.3 → F4.4** (F4.4 puede solaparse con F4.3 al ser spikes).

## 7. Dependencias con F3 (verificadas en código)

- `connect_outbox` + trigger `trg_connect_messages_enqueue` (0143/0144) — **el fan-out F4.1 consume esto; no se rediseña**.
- `notifications` extendida A4 (0147) + `NotificationCenter`/`useRealtimeTable` — F4.1 completa las acciones.
- `connect_search_profiles` (0158, DEFECT-3) — se reutiliza para autocomplete de menciones (sin exponer email).
- Enum `kind='incident'` (0143) y kind `connect_incident` (0147) — F4.2 los activa sin migrar enums.
- RBAC `connect.*` (0146 + piloto 0155) — F4 agrega permisos nuevos solo si el ADR lo exige (p.ej. `connect.incident_admin`), por migración idempotente.
- Buckets `connect-files`/`connect-files-pii` (0148) — adjuntos de incidentes/tareas reusan.
- Emisor único Knowledge (`knowledge_emit_event`, ADR-KNW-ADAPTER) — incidentes/tareas = fuentes nuevas por adapter, prohibido INSERT directo.
- Política P-1 (SECDEF NULL-safe fail-closed) — vinculante para toda RPC nueva de F4.
- Procedimiento de deploy validado: Node 22.23.1 + checkout NO-worktree + draft-first (mitigación DEPLOY-1).
- Deudas F3 que F4.1 absorbe: R-2, R-3, F-1 (F-3 a decisión: requiere migración RLS).
- **Numeración de migraciones: próxima libre `0160`** (verificar con `ls supabase/migrations` y `schema_migrations` al momento de autorar; prod numera por timestamp).

## 8. Riesgos

**Técnicos**
- RT-1 · Worker de outbox: concurrencia/reintentos/dead-letter. *Mitigación:* replicar patrón probado de mig `0133` (claim FOR UPDATE SKIP LOCKED, backoff, dead@3) — ya operó en Knowledge.
- RT-2 · Volumen de notificaciones (1 notif por mensaje ahogaría el centro). *Mitigación:* fan-out selectivo (menciones, DM, incidentes, invitaciones), agregación "N no leídos", decisión explícita en diseño F4.1.
- RT-3 · Cuotas Realtime Supabase con más tablas/canales. *Mitigación:* mantener polling-fallback existente; medir antes de agregar Presence/Broadcast.
- RT-4 · Tareas greenfield sin diseño → scope creep. *Mitigación:* ADR-TASKS obligatorio con alcance cerrado antes de una línea de código (gobernanza Dossier).

**Operativos**
- RO-1 · Fatiga de notificaciones/adopción del piloto. *Mitigación:* prioridades A4 + snooze + validación por sector con feedback antes de ampliar.
- RO-2 · Deploy: el toolchain sano ya está documentado (DEPLOY-1); cualquier desvío (Node≠22, worktree, sin draft) reabre el riesgo de outage 30/06.
- RO-3 · Concurrencia con reconciliación pendiente de `main` (divergida) y ramas F3 sin merge. *Mitigación:* F4 se ramifica desde la punta real de prod (`a6c23f9`/`bdaedfb`); la reconciliación de ramas es tarea separada de Dirección.

**Seguridad**
- RS-1 · Webhook WhatsApp actual = stub **sin HMAC** (landmine conocida). *Mitigación:* NO exponer nada de WhatsApp hasta el spike F4.4 con verificación `X-Hub-Signature-256` timing-safe fail-closed.
- RS-2 · H-1 RBAC dormido (aceptado para piloto interno). *Regla:* F4 permanece 100% interno; `RBAC_ENFORCE=1` + seed de roles es precondición dura de cualquier exposición externa.
- RS-3 · PII en payloads de notificación/outbox. *Mitigación:* payloads con IDs y metadatos, nunca contenido del mensaje ni datos personales (patrón ya usado en Knowledge/rrhh).
- RS-4 · R-3 vigente: escritura a canal archivado bypasseable por RPC directa. *Mitigación:* guarda server-side en F4.1 (primera migración del bloque).

## 9. Arquitectura propuesta

- **Bounded context:** todo F4.1–F4.3 vive en `connect` (incidentes y tareas son conversación-céntricos, según A2). Si el ADR-TASKS concluyera que tareas ameritan contexto propio, se decide ahí — default: `connect`.
- **Patrón de capas invariante:** Feature `src/app/(app)/connect/*` → Server Action → `src/lib/connect/{read,adapters,application,domain}` → Supabase; guard `isMock()`.
- **RPC-first:** toda escritura por funciones `SECURITY DEFINER` con `search_path` fijo, guards NULL-safe (P-1), gate `has_permission('connect.*')` + `_connect_is_member()`.
- **RLS como frontera** en toda tabla nueva; vistas `security_invoker`.
- **Fan-out:** `connect_outbox` → worker (route handler `/api/connect/drain` + `CRON_SECRET` fail-closed + GitHub Actions cron, espejo de `knowledge-drain.yml`) → `notifications`. Decisión (a) síncrono vs (b) worker del spec §2564: **se resuelve como (b) worker** — ya hay egress futuro (WhatsApp/automatizaciones) que lo exige y el patrón está probado.
- **Knowledge:** incidentes (y luego tareas) emiten por adapter propio vía `knowledge_emit_event` + fila en `knowledge_sources` (OCP; sin condicionales en pipeline).
- **Migraciones:** idempotentes, numeradas desde `0160`, entregadas-NO-aplicadas (G3); catálogo RBAC solo por migración.
- **Observabilidad (EOL):** worker registra corridas (patrón `knowledge_worker_runs`); correlation_id propagado.

## 10. Subfases

| Subfase | Contenido | Migs estimadas | Esfuerzo dev |
|---|---|---|---|
| **F4.1 — Fundación colaborativa + higiene** | Worker outbox→notifications + RPCs A4 (snooze/delegar/prioridad) + menciones end-to-end + R-2/R-3/F-1 (+decisión F-3) + ADR-TASKS redactado | ~`0160`–`0162` | ~8–12 días |
| **F4.2 — Centro de Incidentes** | Addendum A2 completo: tablas+RPCs ciclo+UI+notifs+adapter Knowledge+card básica | ~`0163`–`0165` | ~12–18 días |
| **F4.3 — Tareas + workflows + cockpit colaborativo** | Implementación ADR-TASKS; encadenamiento entre áreas; card cockpit | ~`0166`–`0168` | ~12–18 días |
| **F4.4 — De-risk externos + automatizaciones MVP** | Spikes WhatsApp (driver+HMAC PoC) y Email inbound; 2–3 reglas de automatización sobre outbox | 0–1 mig | ~6–10 días (spikes acotados) |

Cada subfase cierra con: typecheck 0 / lint 0 / tests verdes / build OK / revisión adversarial /
Readiness Review / ventana de apply+deploy autorizada por ítem / smoke + validación piloto.

## 11. Primer bloque recomendado

**F4.1 — Fundación colaborativa** (worker de fan-out + menciones + notificaciones avanzadas + higiene F3).

**Evaluación honesta de la sugerencia de Dirección** ("F4.1 = Incidentes + tareas + notificaciones"):
la dirección del trío es correcta — es exactamente lo que F4.1+F4.2 entregan — pero como *primer
bloque único* tiene dos problemas verificados en código:
1. **Incidentes dependen del fan-out**: hoy ningún mensaje genera notificación (outbox sin consumidor).
   Un Centro de Incidentes cuyo "asignado" no se entera de la asignación no es usable. El fan-out es
   ~la mitad del valor y es prerequisito, no acompañante.
2. **Tareas no tienen diseño**: no están en el spec (§1.4) y la gobernanza del Dossier prohíbe
   construir capacidades nuevas sin ADR + fase de diseño. Meterlas en el primer bloque = empezar F4
   violando la regla que Dirección misma fijó.

Por eso la propuesta secuencia el mismo contenido: **F4.1 fundación (2 semanas, valor visible
inmediato: menciones + notificaciones que funcionan de verdad) → F4.2 incidentes (con diseño A2 ya
aprobado y la fundación lista) → F4.3 tareas (con ADR aprobado)**. Si Dirección prefiere priorizar
incidentes como primer entregable visible, la variante es viable: F4.1' = fan-out mínimo + incidentes,
difiriendo menciones/snooze — pero alarga el primer bloque (~15–20 días) y pospone higiene R-2/R-3.

## 12. Criterios GO / NO GO

**GO para iniciar desarrollo F4.1 (todos requeridos):**
1. Este Master Plan aprobado por Dirección (G7).
2. Alcance F4.1 congelado (lista de ítems del §3 filas 1–4).
3. Rama/worktree dedicado creado desde la punta real de prod (`a6c23f9`).
4. Numeración re-verificada (`0160` libre contra `schema_migrations` en vivo).
5. Decisión de Dirección sobre F-3 (incluir migración RLS en F4.1: sí/no).

**NO GO / STOP inmediato si:**
- Cualquier ítem exige tocar prod (DB/deploy/push/merge/permisos/env) sin ventana autorizada por ítem.
- El diseño de un bloque contradice el Dossier o el spec sin ADR aprobado.
- Aparece scope nuevo no listado (→ vuelve a planificación, no se improvisa).
- `main`/prod cambian de estado respecto de lo verificado (re-verificar antes de cada ventana).

**GO por subfase posterior:** cierre formal de la subfase anterior (checklist §13) + autorización expresa.

## 13. Checklist de validación (por subfase)

- [ ] typecheck 0 · lint 0 · tests verdes (sin bajar el conteo base) · build OK (Node 22).
- [ ] Toda RPC nueva: SECDEF + `search_path` fijo + guard NULL-safe (P-1) + revoke anon/authenticated según patrón H-E1-1.
- [ ] RLS habilitada en toda tabla nueva; kit de validación SQL read-only entregado.
- [ ] Migraciones idempotentes re-ejecutables (2ª corrida = no-op) numeradas al siguiente libre.
- [ ] Sin INSERT directo a `knowledge_events`/`notifications` fuera de los emisores/worker.
- [ ] Payloads sin PII ni contenido de mensajes.
- [ ] Revisión adversarial (0 critical / 0 important al cierre) + Engineering Readiness Review.
- [ ] Apply manual autorizado (G3) → checkpoints DB → deploy draft-first Node 22 NO-worktree → smoke 0 5xx → validación piloto documentada.
- [ ] Run Log + entregables archivados en `docs/superpowers/F4-*`.

## 14. Roadmap estimado

| Hito | Estimación (calendario, con ventanas y validación piloto) |
|---|---|
| Aprobación Master Plan + setup F4.1 | Semana 0 |
| F4.1 fundación (dev+apply+deploy+piloto) | Semanas 1–3 |
| F4.2 incidentes | Semanas 3–7 |
| ADR-TASKS aprobado | Durante F4.1–F4.2 |
| F4.3 tareas+workflows+cockpit | Semanas 7–11 |
| F4.4 spikes + automatizaciones MVP | Semanas 10–13 (solapable) |
| Cierre formal F4 | Semanas 12–14 |

Total estimado: **~38–58 días-dev / ~3 meses calendario**, con GO por subfase (Dirección puede cortar
en cualquier frontera de subfase con valor ya entregado).

## 15. Confirmación de no-implementación

En esta sesión de kickoff **NO se implementó nada**: cero código de producto, cero migraciones
creadas o aplicadas, cero cambios de DB/RBAC/env, cero deploy, cero push, cero merge, cero commit.
Único artefacto producido: este documento (`docs/superpowers/F4-KICKOFF-SCOPE-PLAN.md`), escrito en el
working tree del worktree `tops-ordenes-admin-surface-8-10` y **dejado sin commitear** conforme a G1
(el asistente prepara y muestra; commitea Martín). Verificación previa de estado: `/api/version` =
`a6c23f9` (production), última migración `0159`, worktrees y ramas coinciden con el handoff F3→F4.

---

**Próximo paso:** decisión de Dirección sobre §11 (primer bloque) y §12 (GO F4.1). Hasta entonces, STOP.

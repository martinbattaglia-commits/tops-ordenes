# F4.4 — INTEGRACIONES + AUTOMATIZACIONES MVP — MASTER PLAN

> **Estado: APROBADO POR DIRECCIÓN (GO 2026-07-03) — IMPLEMENTACIÓN LOCAL AUTORIZADA.**
> Decisiones ratificadas por mandato de Dirección (Anexo A1 — la numeración D-F44 del
> MANDATO es la autoritativa; la tabla §28 queda histórica). **Baseline vigente:**
> rama canónica `origin/feat/connect-f4-3-tasks-workflows-cockpit` @ **`4c19d38`**;
> producción = **`8a4b7bb`** (F4.3 + fix Drive + fix compliance env-id). El P0 "prod pisada"
> del Anexo B quedó RESUELTO; D-F44-9 (secuencia fix Drive) CUMPLIDA. Bases prohibidas:
> `f30f79d`, `bb07f9f`, `0cdb7c6`, `484a447`.
> NO autorizado aún: deploy, push, merge, aplicar migraciones, tocar DB/env productivos,
> `RBAC_ENFORCE`, WhatsApp/Email productivos, automatizaciones externas reales, Knowledge drain.
> Redactado originalmente 2026-07-02 (sesión de planificación pura). Gobernanza: G1–G11 +
> Metodología Nexus (análisis → plan → implementación → validación → GO/NO-GO).
> Documento de referencia superior: Nexus Link Master Dossier v1.2 y
> `docs/superpowers/F4-KICKOFF-SCOPE-PLAN.md` (Master Plan F4 aprobado).

---

## 1. Resumen ejecutivo

F4.4 es la fase de **de-risk de integraciones externas** (WhatsApp Business, Email) y de
**automatizaciones MVP internas** del bounded context `connect`. El Master Plan F4 la define
explícitamente como "solo de-risk, sin integración productiva" (F4-KICKOFF-SCOPE-PLAN.md §3,
ítems 10–12).

La verificación read-only de esta sesión (§5) arrojó **tres hechos que reordenan la fase**:

1. **El scheduler OPS de F4.1 sigue muerto**: `connect_outbox` tiene **39 eventos `pending`**
   (creció de 34 a 39 desde el 01-07; cero `processed` en la historia). Cualquier automatización
   asincrónica que dependa del worker nace muerta hasta resolverlo.
2. **El email outbound productivo está 100% caído en silencio**: `email_sends` tiene **56 filas,
   todas `failed`**, con error Resend `403 validation_error: "You can only send testing…"` —
   el dominio nunca se verificó en Resend. Los 4 correos por rol de OS (cliente, depósito,
   director, facturación) **no le llegan a nadie desde siempre**, y el flujo no lo reporta.
   Esto **contradice** la premisa del Master Plan F4 ("outbound ya vivo vía Resend").
3. **La superficie de seguridad tiene deuda conocida y medida**: 5 endpoints de cron
   **fail-open** con comparación no timing-safe, webhook WhatsApp **sin verificación HMAC**
   (acepta cualquier POST), `tracking/ingest` con comparación `!==`. Los únicos patrones
   correctos ya en prod son `clientify/webhook` (token timing-safe fail-closed) y
   `connect/cron/dispatch-outbox` (Bearer timing-safe fail-closed, F4.1).

Por eso este plan propone F4.4 en **cuatro rieles** (E1–E4): (1) destrabar el scheduler,
(2) hardening de la frontera de webhooks/crons, (3) spikes sandbox de WhatsApp y Email,
(4) automatizaciones MVP internas con aprobación humana. Nada sale a un tercero real sin
GO explícito por ítem.

**Esfuerzo estimado:** ~8–14 días-dev (vs. 6–10 del kickoff; el delta es el hardening y el
hallazgo de Resend). **Migraciones previstas:** `0171`–`0173` (condicionales, ver §17).

---

## 2. Objetivo de F4.4

Reducir el riesgo técnico y de seguridad **antes** de cualquier integración productiva externa:

- Probar (spike) el ciclo completo WhatsApp Business inbound/outbound **en sandbox**, con
  webhook verificado por HMAC y persistencia auditable.
- Probar (spike) el email integrado: **reparar y re-validar el outbound existente** (hoy caído)
  y evaluar inbound **solo en papel/sandbox**.
- Ejecutar 2–3 **automatizaciones MVP internas** (sin efectos hacia afuera), montadas sobre el
  outbox/worker de F4.1, con auditoría y fail-closed.
- Dejar la **base operativa** (scheduler resuelto o alternativa aprobada; frontera de
  webhooks endurecida) para que F5 pueda integrar canales reales sin heredar deuda.

**Principio rector:** F4.4 NO empieza conectando canales externos abiertos a producción.
Primero diseño → seguridad → spikes → sandbox → pruebas controladas → criterios GO/NO-GO.

---

## 3. Alcance incluido

| # | Ítem | Riel |
|---|------|------|
| 1 | Resolución (o decisión formal de alternativa) del scheduler OPS F4.1 — pasos §5 del finding | E1 |
| 2 | Helper `requireCronAuth()` fail-closed + `timingSafeEqual`, adoptado por los endpoints de F4.4 | E2 |
| 3 | Verificación HMAC `X-Hub-Signature-256` en `/api/whatsapp/webhook` (patrón timing-safe) | E2 |
| 4 | (Condicional D-F44-4) Hardening de los 5 crons fail-open existentes + `tracking/ingest` timing-safe | E2 |
| 5 | Spike WhatsApp sandbox: persistencia de eventos inbound + outbound SOLO a allowlist de números internos, vía número de prueba de Meta | E3 |
| 6 | Spike Email: diagnóstico y reparación del outbound Resend (verificación de dominio = acción de Dirección) + re-validación con envío real controlado; inbound SOLO evaluación documental | E3 |
| 7 | Automatizaciones MVP: 2–3 reglas internas sobre eventos del outbox (catálogo §10), con registro por corrida y kill-switch | E4 |
| 8 | Auditoría: toda automatización y todo webhook procesado/rechazado deja rastro (audit_log + tabla de telemetría) | E2/E4 |
| 9 | Documentación: ADR de automatizaciones (si aplica), Validation Pack, Rollback | Todos |

## 4. Alcance excluido (explícito)

Fuera de F4.4 — futuro o dependencia, según Restricciones del mandato:

- IA / F5 y agentes autónomos.
- Exposición a clientes/proveedores externos; portal externo.
- WhatsApp productivo abierto (número real conversando con terceros) — **F5, con GO propio**.
- Email productivo "integrado" (inbound, threading, casilla compartida) — **F5**; F4.4 solo
  repara el outbound transaccional ya existente y evalúa inbound en papel.
- Automatizaciones irreversibles, envío masivo, campañas comerciales.
- SLA automático dependiente del scheduler sin resolver (el `sla_due_at` de F4.2 sigue informativo).
- Integración con terceros sin sandbox.
- Cambios RBAC globales / activación de `RBAC_ENFORCE`.
- Knowledge drain (finding OPS propio, decisión de Dirección aparte — NO se toca).
- Motor genérico de reglas / event bus / BPM (los workflows F4.3 lineales son el sustrato).
- Monitoreo/CCTV (no existe en spec/dossier; regla del Master Dossier).

---

## 5. Estado actual verificado (read-only, 2026-07-02 ~16:15Z)

Toda la evidencia es de ejecución/lectura real (G5/G6), no teórica:

| Verificación | Resultado | Evidencia |
|---|---|---|
| `/api/version` prod | **`f30f79d`**, env `production`, builtAt 2026-07-02T03:37Z | curl live |
| Deploy productivo | `6a45dd06046d9f4002a59a18` (F4.3) | memoria de cierre F4.3 |
| Última migración prod | **`0170_connect_tasks_knowledge`** (`20260702033205`) | `schema_migrations` live |
| Próxima migración libre | **`0171`** (0171+ no existen ni en prod ni en rama F4.3) | `schema_migrations` + `git ls-tree` |
| Línea de código vigente | worktree `~/CODE/tops-ordenes-f43-tasks`, rama `feat/connect-f4-3-tasks-workflows-cockpit` @ `bb07f9f` (tree limpio, sin push) | `git worktree list` |
| Checkout principal `~/CODE/tops-ordenes` | en `release/fiscal-f1-unified` (migs hasta 0124) — **NO usar para F4** | `git status` |
| `connect_outbox` | **39 `pending`** (oldest 2026-07-01 02:29Z, newest 2026-07-02 15:36Z), único topic `connect.message.posted`, **0 processed jamás** | SQL live |
| Scheduler F4.1 | Function `connect-dispatch-outbox` registrada `*/5` en `netlify.toml:24-30`, **cero ejecuciones**; finding abierto | `F4-1-SCHEDULING-OPS-FINDING.md` + outbox live |
| `email_sends` | **56 filas, 100% `failed`**, error Resend 403 testing-mode; tags: cliente/depot/director/facturacion; `po_email_sends` = 0 filas | SQL live |
| Código WhatsApp | `src/lib/whatsapp/meta.ts` (cliente Meta Cloud API v22: sendText/sendTemplate/sendDocument), webhook GET verify OK, **POST sin HMAC (TODO en código)**, `/api/whatsapp/send` **fail-open** (`if (cronSecret)`) mitigado por NO estar en allowlist, `/api/whatsapp/ping` | lectura directa `route.ts` |
| Persistencia WhatsApp | **Ninguna** (inbound solo `console.info`, sin tabla) | webhook/route.ts:29-39 |
| Código Email | Resend outbound only: OS 4 mails por rol (`order-email.ts`, dedup UNIQUE `(order_id, tag)` mig 0075), OC 3 destinatarios (`compras/email.ts`); degradación elegante sin API key; **sin inbound** | agente explorador |
| Worker outbox F4.1 | Infra completa: claim/lease 5min/backoff 1-2-4/dead@3/prune/telemetría `connect_worker_runs`; endpoint fail-closed timing-safe; `governanceProcessor` = todo `skipped` (efectos críticos son síncronos por trigger) | 0160 + `dispatch.ts` |
| Frontera de seguridad | 5 crons **fail-open + `!==`** (`compliance/sync`, `contratos/sync`, `caja-chica/sync`, `clientify/sync-deals`, `knowledge/drain`); `tracking/ingest` `!==`; patrones correctos: `clientify/webhook.ts` y `dispatch-outbox` | agente auditor + skill security |
| Env vars | Bloques `META_WA_*`, `RESEND_*`/`EMAIL_*`, `CRON_SECRET`, `CLIENTIFY_WEBHOOK_SECRET` ya en `.env.example`; **falta `META_WA_APP_SECRET`** (necesario para HMAC) | `.env.example` |
| Netlify Blobs | dependencia presente, **sin uso** en F4.3; `src/lib/credentials/` solo existe en rama paralela `fix/drive-credentials-provider-f42` | grep |
| Automatizaciones previas | NO existe rules engine/event bus; automatizaciones actuales = triggers SQL + server actions síncronas + crons | agente explorador |
| Producción tocada | **NO** — solo `SELECT` y curl | esta sesión |

**Corrección al Master Plan F4:** donde el kickoff decía "Email outbound ya vivo vía Resend",
la realidad medida es outbound **configurado pero fallando el 100%** por dominio sin verificar.
El spike de Email cambia de "evaluar inbound" a "**reparar outbound primero**".

## 6. Dependencias con F4.1 / F4.2 / F4.3

- **F4.1 (cerrada)** aporta el sustrato de F4.4: `connect_outbox` + worker + telemetría +
  endpoint fail-closed + notificaciones avanzadas. **Hereda su única deuda: el scheduler** (§7).
- **F4.2 (cerrada)** aporta incidentes (`connect_incidents`, estados, `incident_admin`) — fuente
  de eventos candidata para automatizaciones ("incidente crítico → …"). Su fan-out crítico es
  síncrono por diseño (D2 de F4.2) justamente para NO depender del worker: F4.4 no lo cambia.
- **F4.3 (cerrada)** aporta tareas y workflows lineales — el ADR-F4-3 §20 anticipa exactamente
  el patrón F4.4: "reglas sobre el outbox ('incidente crítico → instanciar workflow X') SIN
  rediseñar tareas". Las plantillas seed y `connect_task_open`/workflow RPCs son los efectores
  naturales de las reglas MVP.
- **Coordinación vigente:** la rama paralela `fix/drive-credentials-provider-f42` (base
  `484a447`) debe **rebasarse sobre `f30f79d`** antes de su deploy o pisa F4.3. F4.4 no la toca,
  pero cualquier ventana de deploy F4.4 debe secuenciarse con ella (decisión D-F44-9).

## 7. Dependencia del scheduler / outbox (pregunta 1 del mandato)

**Respuesta: sí para el riel de automatizaciones; no para los spikes.**

- Los **spikes WhatsApp/Email (E3)** y el **hardening (E2)** NO dependen del scheduler: son
  request/response (webhook entrante, envío puntual, verificación).
- Las **automatizaciones MVP (E4)** SÍ: su consumidor natural es el worker del outbox, y hoy
  nada drena la cola. Ejecutar E4 sin scheduler = reglas que nunca corren (fantasía prohibida).

**Propuesta:** E1 = retomar el finding `F4-1-SCHEDULING-OPS-FINDING.md` como **primera etapa
de F4.4**, siguiendo su §5 al pie: (paso 1) leer la línea de log del panel del dashboard
Netlify de la function; según resultado → fix de env-scope (opción A), ticket Netlify (B), o
**cron externo tipo GH Actions sobre una rama publicada / servicio externo (C)**. Nota: el
mecanismo cron probado del proyecto es GH Actions, pero está bloqueado por la divergencia de
`origin/main` — si se elige C hay que decidir dónde vive el workflow (decisión D-F44-1).
**Gate:** el finding se cierra con ≥2 corridas programadas evidenciadas en
`connect_worker_runs`. Si Dirección decide NO resolverlo ahora, E4 se degrada a "reglas
síncronas en trigger/RPC" (patrón F4.2) o se difiere — pero eso se decide, no se improvisa.

---

## 8. WhatsApp Business — spike técnico (pregunta 2)

**Respuesta a la pregunta: arrancar por INBOUND EN SANDBOX + outbound restringido a allowlist
interna. Nada conversacional con terceros.**

Lo que ya existe (verificado): cliente Meta Cloud API completo (`meta.ts`), webhook con verify
GET funcionando, envío por template/text/document, `/api/whatsapp/ping`. Lo que falta: HMAC,
persistencia, y evidencia de que el ciclo completo funciona con la WABA real.

Spike propuesto (time-boxed, ~3-4 días):

1. **Seguridad primero (E2):** implementar `X-Hub-Signature-256` con `createHmac('sha256',
   META_WA_APP_SECRET)` + `timingSafeEqual`, **fail-closed** (sin secret → 503; firma inválida
   → 401 + auditoría del rechazo). Patrón espejo de `clientify/webhook.ts:16-35`.
2. **Persistencia sandbox:** tabla `wa_inbound_events` (mig 0171): payload crudo + headers de
   firma + resultado de verificación + `processed boolean` + timestamps. RLS deny-all
   (service_role). Append-only. Sin parsing de negocio todavía.
3. **Outbound controlado:** allowlist de números internos (env var o tabla seed) — el endpoint
   `/api/whatsapp/send` se endurece (fail-closed + timing-safe) y **rechaza destinos fuera de
   la allowlist** mientras `WHATSAPP_SANDBOX=1` (default). Prueba real: template a un número
   de la Dirección, status recibido por webhook, correlación evento↔envío.
4. **Ventana 24h:** documentar con evidencia real la mecánica template-vs-text (bloqueante de
   diseño para F5, hoy solo supuesta).

**Criterio de éxito del spike:** ciclo evidenciado inbound firmado→persistido y
outbound→status→persistido, con 0 mensajes a terceros. **Sin GO de Dirección no se configura
el webhook de Meta apuntando a prod** (hoy no se sabe si está configurado; verificar en el
panel Meta es acción de Dirección).

## 9. Email integrado — spike técnico (pregunta 3)

**Respuesta a la pregunta: primero REPARAR el outbound (hoy 100% caído), después sandbox; el
inbound queda en evaluación documental. Nada de threading en F4.4.**

1. **Reparación outbound (bloqueante descubierto):** la causa es externa al código — dominio
   sin verificar en Resend (error 403 testing-mode en las 56 filas de `email_sends`).
   Acción de Dirección: verificar dominio (DNS SPF/DKIM en el registrar de
   `logisticatops.com`) o decidir proveedor alternativo. Código: agregar **visibilidad de
   fallas** (hoy el fracaso es silencioso): contador en cockpit o notificación connect a
   admin cuando un send falla (candidata a regla MVP R3, §10).
2. **Re-validación:** con dominio verificado, re-disparar UN envío real controlado por tag y
   verificar `email_sends.status='sent'` + recepción. Evidencia en Validation Pack.
3. **Inbound (solo papel):** comparar opciones (Resend Inbound, Postmark, SendGrid Parse,
   Gmail API sobre la casilla corporativa) contra los requisitos del Dossier. Entregable =
   sección de análisis con recomendación para F5. **Sin código, sin webhook nuevo.**

## 10. Automatizaciones MVP internas (preguntas 4, 5 y 6)

**Qué es "seguro" (criterios):** una automatización MVP es elegible si (a) su efecto es 100%
interno (notificaciones connect / tareas), (b) es **idempotente** (re-ejecutar no duplica),
(c) es **reversible** (el efecto se puede cancelar/archivar), (d) queda auditada por corrida,
y (e) tiene **kill-switch** (flag `enabled` sin deploy).

**Catálogo propuesto (elegir 2–3, decisión D-F44-5):**

| Regla | Evento fuente | Efecto interno | Aprobación humana |
|---|---|---|---|
| R1 | `connect.incident.opened` con severidad crítica | Notificación connect a rol destino (patrón broadcast 0162/0169) | No (efecto = solo aviso) |
| R2 | Incidente crítico resuelto | Instanciar workflow seed "post-incidente" (F4.3) con paso 1 vacante | No (la tarea nace vacante; un humano la reclama) |
| R3 | `email_sends` insert con `status='failed'` | Notificación connect a admin ("email de OS falló") | No (aviso) |
| R4 | Tarea de workflow vencida (`due_at` pasado) | Recordatorio al asignado | No (aviso) — **requiere scheduler vivo** |

**Qué requiere aprobación humana SIEMPRE (pregunta 6):** todo efecto que salga del sistema
(mensaje WhatsApp/email a cualquier destinatario, incluso interno, disparado por regla),
toda escritura sobre datos de negocio (órdenes, stock, facturación — directamente excluida
en F4.4), y toda regla nueva (alta por seed/migración, no por UI).

**Arquitectura:** implementar los efectos como **processor del worker existente** (reemplazar
`governanceProcessor` por un dispatcher por topic que consulta reglas habilitadas), NO un
motor genérico. Requiere emitir al outbox los topics de incidentes/tareas (hoy solo se
encola `connect.message.posted`) → trigger adicional o enqueue en las RPCs (mig 0172).
Alternativa si el scheduler sigue muerto: reglas síncronas dentro de las RPCs (patrón D2 de
F4.2) — menos elegante, cero dependencia OPS (decisión D-F44-2).

## 11. Webhooks (pregunta 9)

- **Requieren HMAC:** `/api/whatsapp/webhook` (Meta firma con `X-Hub-Signature-256`; hoy no se
  verifica NADA — cualquiera puede POSTear payloads falsos que, cuando haya persistencia,
  envenenarían la tabla). Cualquier webhook futuro de proveedor de email inbound (F5).
- **Ya correctos:** `clientify/webhook/[token]` (token timing-safe fail-closed).
- **A endurecer (condicional D-F44-4):** los 5 crons fail-open (`compliance/sync`,
  `comercial/contratos/sync`, `tesoreria/caja-chica/sync`, `clientify/sync-deals`,
  `knowledge/drain` — este último SOLO el guard de auth, no su lógica) + `tracking/ingest`
  y `/api/whatsapp/send` a timing-safe. Es cambio de guard puro (~10 líneas por endpoint,
  helper común), pero **toca módulos validados → G2 exige OK explícito de Dirección**, y hay
  que setear `CRON_SECRET` consistente en GH Actions antes (si un cron externo real depende
  del fail-open actual, cerrarlo lo rompe → primero confirmar secrets en GitHub).
- **Allowlist middleware:** F4.4 no agrega rutas públicas nuevas (el webhook WA ya está).
  Cada alta hipotética futura = decisión de seguridad con guard propio.

## 12. Seguridad HMAC

Patrón único y obligatorio para F4.4 (espejo `clientify/webhook.ts` + skill security):

```
raw = await req.text()                       // cuerpo CRUDO, antes de JSON.parse
expected = 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex')
ok = timingSafeEqual(Buffer.from(expected), Buffer.from(header))  // longitudes iguales primero
sin APP_SECRET → 503 (fail-closed); firma inválida → 401 + fila de auditoría del rechazo
```

Reglas: nunca parsear antes de verificar; nunca loguear el secret ni la firma completa;
verificación cubierta por tests unitarios con vectores conocidos (TDD, §23).

## 13. Secrets y rotación (pregunta 8)

| Secret | Estado | Acción F4.4 |
|---|---|---|
| `META_WA_APP_SECRET` | **NO existe** (ni en `.env.example`) | Alta: obtenerlo del panel Meta (Dirección), setear en Netlify, documentar en `.env.example` (nombre solo) |
| `META_WA_TOKEN` | Existe | Verificar vigencia (tokens de sistema Meta expiran según tipo); plan de rotación documentado |
| `META_WA_WEBHOOK_VERIFY_TOKEN` | Existe, con **default hardcodeado** `"nexus-tops-verify"` en el GET | Quitar default (fail-closed) |
| `CRON_SECRET` | Existe (write-only en Netlify; solo Martín lo tiene) | NO rotar (decisión F4.1 vigente); confirmar que GH Actions lo tenga seteado antes del hardening D-F44-4 |
| `RESEND_API_KEY` | Existe; cuenta en testing-mode | Verificación de dominio (Dirección); considerar key por entorno |
| `WHATSAPP_SANDBOX` (flag, no secret) | Nuevo | Default `1`; pasarlo a `0` = decisión de Dirección en F5 |

Reglas G9 vigentes: nunca imprimir valores (solo nombres/PASS-FAIL); `netlify env:get`
devuelve máscara (gotcha F4.1); secret-scan de Netlify es bloqueante.

## 14. Auditoría (pregunta 7)

**Dónde se audita cada automatización:** doble registro, siguiendo el patrón existente:

1. **`audit_log`** (append-only, `entity`/`entity_id`/`action`/`payload`): una fila por efecto
   de regla ejecutado (`entity='connect_automation'`, action=`rule_fired`), y una por webhook
   rechazado por firma inválida (`entity='whatsapp_webhook'`, action=`signature_rejected`).
   Sin texto libre de usuarios (lección F4.2: audit sin contenido sensible).
2. **`automation_runs`** (telemetría, espejo de `connect_worker_runs`): por corrida del
   processor — regla, evento seq, resultado (fired/skipped/error), duración, correlation_id.
3. **`wa_inbound_events`**: el propio registro crudo del spike ES la auditoría del canal.

## 15. Fail-closed

Estándar F4.4 (heredado del endpoint 0160 y de la skill security, sin excepciones):

- Todo endpoint nuevo o tocado: sin secret configurado → **503**, credencial inválida → 401,
  siempre `timingSafeEqual`.
- Reglas de automatización: si la regla no puede evaluar (config faltante, RPC falla) →
  evento queda `failed` con backoff/dead-letter del worker, **nunca** efecto parcial ni
  "asumir que sí".
- Sandbox WhatsApp: destino fuera de allowlist → rechazo con auditoría (no "enviar igual").
- Email: falla de envío → `email_sends.failed` **más aviso** (fin del silencio actual).

## 16. Modelo de datos propuesto (si Dirección aprueba los rieles E3/E4)

Mínimo indispensable, RLS deny-all salvo indicación (detalle fino en la etapa de
implementación, patrón postgres-tops-nexus):

- **`wa_inbound_events`**: `seq bigserial PK`, `payload jsonb`, `signature_valid boolean`,
  `received_at`, `processed boolean default false`, `notes`. Deny-all (service_role).
- **`automation_rules`** (seed-only, sin UI): `key text unique`, `topic`, `enabled boolean`,
  `config jsonb`, timestamps. Lectura staff, escritura solo migración.
- **`automation_runs`**: telemetría por evaluación (regla, outbox_seq, result, error,
  correlation_id, duration_ms). Deny-all.
- **Extensión de emisión al outbox**: enqueue de `connect.incident.opened/status_changed` y
  `connect.task.created/completed` (trigger o dentro de RPCs 0165/0169 — sin cambiar firmas;
  cuidado con gotchas conocidos: OUT-params + ON CONFLICT `#variable_conflict use_column`,
  CASE→enum 42804, probar RPCs con ejecución real).

## 17. Migraciones previstas (desde `0171`)

Re-verificado: `0171` libre en `schema_migrations` y en todas las ramas. Propuesta (patrón
F4.2/F4.3; **entregadas NO aplicadas**, aplica Martín en ventana autorizada, G3):

| Mig | Contenido | Condición |
|---|---|---|
| `0171` | `wa_inbound_events` + RLS | Solo si GO al spike WhatsApp con persistencia |
| `0172` | `automation_rules` + `automation_runs` + enqueue de topics incidentes/tareas + seeds R1–R3 | Solo si GO al riel E4 |
| `0173` | RPCs del processor (`automation_claim/mark…` si no alcanzan las 0160) + grants | Solo si E4; puede fusionarse con 0172 si no hay enums |
| — | `ROLLBACK_0171_0173.md` | Siempre que haya migs |

Si Dirección aprueba solo E1+E2 (scheduler + hardening), **F4.4 puede ejecutarse SIN
migraciones** (los guards son código puro). E2-hardening y E3-WhatsApp tampoco requieren
tocar RBAC.

## 18. RPCs previstas

- Reuso directo: `connect_claim_batch/mark_processed/mark_failed/recover_stuck/prune`
  (0160), `connect_notify_*`/broadcast (0161/0162), `connect_task_open` + workflow RPCs
  (0169), `connect_incident_*` (0165).
- Nuevas (solo E4): registro de corrida de automatización (espejo `connect_record_worker_run`)
  y, si el enqueue va por RPC y no por trigger, extensión interna de 0165/0169 **sin cambiar
  firmas públicas** (lección F4.1: DROP+CREATE atómico si hiciera falta, jamás overload).

## 19. Cambios frontend previstos

Mínimos y opcionales (F4.4 es backend/ops-first):

- Card/indicador en cockpit: salud del canal email (fallas recientes) y contador outbox
  pending (visibilidad de la deuda OPS). Read-only, Suspense, auto-oculta (patrón F4.3).
- Sin UI de administración de reglas (seed-only por decisión).
- Sin pantallas WhatsApp (el spike se valida por SQL/logs, no por UI).

## 20. Cambios backend previstos

- Helper `requireCronAuth()` compartido (fail-closed + timing-safe) en `src/lib/` y adopción
  en endpoints según D-F44-4.
- Verificación HMAC en `whatsapp/webhook` + persistencia inbound (`src/lib/whatsapp/`).
- Allowlist sandbox en `whatsapp/send` + flag `WHATSAPP_SANDBOX`.
- Aviso de falla en el pipeline de email (hook post-`email_sends.failed`).
- Processor de automatizaciones en `src/lib/connect/worker/` (dispatcher por topic; reemplaza
  `governanceProcessor` manteniendo compat: topic sin regla → `skipped` como hoy).
- Capa `src/lib/<ctx>/data.ts` + `isMock()` donde aplique (patrón de capas, G-arquitectura).

## 21. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Scheduler no se destraba (dashboard opaco / limitación Netlify+CLI manual) | Media | E4 bloqueado | Rama de decisión C (cron externo) preparada; E4 degradable a síncrono; gate explícito |
| Hardening fail-closed rompe un cron real de GH Actions sin secret | Media | Syncs Drive/Clientify caen | Confirmar secrets en GitHub ANTES; ventana con smoke de crons; rollback = revert del guard |
| Meta: configurar webhook/HMAC en la WABA real afecta un flujo existente desconocido | Baja | Mensajes perdidos | Verificar en panel Meta el estado actual ANTES (Dirección); spike primero con número de prueba |
| Verificación de dominio Resend altera DNS del dominio corporativo | Baja | Email corporativo | Registros SPF/DKIM aditivos; los aplica Dirección; validar con herramienta DNS antes/después |
| Automatización crea efectos duplicados (re-entrega del outbox) | Media | Ruido interno | Idempotencia por `(rule, outbox_seq)` UNIQUE; coalescing de notifs ya existente |
| Enqueue nuevo en RPCs de incidentes/tareas introduce regresión en módulos validados (G2) | Media | Rotura F4.2/F4.3 | Cambios aditivos, tests de regresión 465+, ejecución REAL de RPCs pre-apply (lección 42804) |
| Payloads de webhook falsos previos al HMAC ya en logs | Baja | Ruido | HMAC cierra la puerta; `wa_inbound_events` nace después del guard |

## 22. Seguridad / PII

- Inbound WhatsApp contiene números de teléfono y texto libre de terceros → `wa_inbound_events`
  deny-all, sin exposición en UI en F4.4, retención a definir (propuesta: 90 días para el
  sandbox; purga documentada).
- `email_sends.to_email` ya existe (PII de contactos) — el aviso de falla NO incluye el
  cuerpo del mail, solo tag/orden.
- audit_log de automatizaciones sin texto libre (patrón F4.2).
- Ningún dato de negocio sale hacia Meta/Resend más allá del payload mínimo del template
  (igual que hoy). Sin nuevas superficies públicas.

## 23. Plan de TDD

Núcleo por TDD (superpowers:test-driven-development), objetivo +25–35 tests sobre los 465:

1. Verificación HMAC: firma válida/ inválida/ ausente/ secret ausente/ longitud distinta
   (vectores fijos, sin red).
2. `requireCronAuth()`: matriz fail-closed completa.
3. Allowlist sandbox WhatsApp: dentro/fuera/flag off.
4. Dispatcher de reglas: topic con regla on/off, idempotencia por seq, error → failed.
5. Aviso de email fallido: dispara con `failed`, no con `sent`.
6. SQL: kit read-only de validación (patrón C1–C7) + pruebas transaccionales con ROLLBACK
   para RPCs nuevas (ejecución real, lección F4.2/F4.3).

## 24. Plan de QA

Gates locales idénticos a F4.2/F4.3: `typecheck` 0 · `lint` 0 · tests 100% · `build` OK ·
preview demo OK. Revisión adversarial obligatoria (§27) antes de cualquier ventana.
Checklist skills: architecture (capas/RPC-first/no-duplicación), security (checklist de
cierre completo), postgres (idempotencia/RLS).

## 25. Smoke plan

Post-ventana (si la hay), guion tipo Validation Pack:

1. `/api/version` = commit esperado; 12 rutas core 200/307, 0 5xx.
2. Webhook WA: POST sin firma → 401 auditado; GET verify → 200 (con token real).
3. Cron endpoints endurecidos: sin Bearer → 401/503; con Bearer válido → 200 (evidencia
   de los 5 GH Actions verdes en la corrida siguiente).
4. Outbox: corrida programada visible en `connect_worker_runs` (≥2 para cerrar el finding);
   backlog 39 drenado (`processed`/`skipped`).
5. Email: 1 envío real controlado → `email_sends.status='sent'` + recepción confirmada.
6. Regla R1/R3 disparada con evento real de prueba → notificación visible + `automation_runs`.
7. Regresiones F4.1/F4.2/F4.3 intactas (mensajes, incidentes, tareas — smoke corto de 5 puntos).

## 26. Rollback

- **Código:** redeploy del deploy anterior (`6a45dd06046d9f4002a59a18` / commit `f30f79d`) —
  procedimiento validado en F4.1–F4.3; draft-first + Node 22 + checkout NO-worktree.
- **Migraciones:** `ROLLBACK_0171_0173.md` (tablas nuevas = drop limpio; enqueue = disable
  trigger / revert RPC a cuerpo 0165/0169 vigente; sin enums nuevos si se puede evitar —
  los enum values son irreversibles).
- **Secrets/config:** `WHATSAPP_SANDBOX` vuelve a `1`; quitar webhook de Meta = acción en
  panel Meta (documentar pasos); DNS Resend es aditivo (no requiere revert).
- **Kill-switch por regla:** `automation_rules.enabled=false` vía SQL (sin deploy).

## 27. Revisión adversarial esperada

Patrón F4.2/F4.3 (rindió: 1 bloqueante + 8 altos en F4.2; 2 bloqueantes + 5 altos en F4.3):
**2 revisores independientes** con lentes distintas (seguridad/correctness/repro) sobre el
paquete completo antes del pedido de ventana. Focos sugeridos para F4.4: bypass de HMAC
(firma sobre body re-serializado vs crudo), TOCTOU en allowlist sandbox, idempotencia real
del dispatcher bajo re-entrega, fail-open residual en guards migrados, RLS de las tablas
nuevas bajo rol `authenticated` real, y regresión de los 5 crons GH Actions tras el
fail-closed.

## 28. Decisiones que Dirección debe aprobar ANTES de implementar

| # | Decisión | Recomendación |
|---|---|---|
| D-F44-1 | Scheduler: retomar finding ahora como E1 (leer log dashboard → A/B/C) ¿y cuál rama ejecutar? | SÍ retomar; si el log no resuelve en 1 día-dev, ir a C (cron externo) |
| D-F44-2 | Si el scheduler no queda vivo: ¿E4 síncrono (patrón F4.2), diferido, o bloqueado? | Síncrono para R1/R3 (avisos); R2/R4 esperan worker |
| D-F44-3 | Spike WhatsApp: ¿GO al sandbox (HMAC + persistencia + allowlist interna, mig 0171)? Incluye verificar el panel Meta (acción Dirección) | GO — es el de-risk central de F5 |
| D-F44-4 | Hardening de los 5 crons fail-open + tracking/ingest + whatsapp/send (toca módulos validados, G2) | GO con precondición: confirmar `CRON_SECRET` seteado en GH Actions |
| D-F44-5 | Automatizaciones MVP: ¿cuáles del catálogo §10? | R1 + R3 (avisos puros); R2 opcional; R4 solo con scheduler vivo |
| D-F44-6 | Email: verificación de dominio en Resend (DNS) — acción exclusiva de Dirección | Hacerla temprano; sin ella el outbound sigue muerto |
| D-F44-7 | Alta de `META_WA_APP_SECRET` en Netlify + quitar default del verify token | GO |
| D-F44-8 | ¿ADR-AUTOMATIONS formal o alcanza este plan + seeds? (las automatizaciones no están en spec §1.4 — precedente ADR-F4-3) | ADR corto SÍ (gobernanza Dossier: capacidad nueva ⇒ ADR) |
| D-F44-9 | Secuencia con `fix/drive-credentials-provider-f42`: ¿rebase+deploy del fix Drive antes de la ventana F4.4, o después? | ANTES (el incidente Drive está abierto y su fix ya validado espera GO) |
| D-F44-10 | Ventana única apply+deploy (patrón F4.1–F4.3) vs. dos ventanas (E1/E2 primero; E3/E4 después) | DOS ventanas: hardening+scheduler primero (bajo riesgo, alto valor), spikes+reglas después |

## 29. Criterio GO / NO-GO para implementación local

**GO a implementar localmente (sin tocar prod) si y solo si:**

1. Dirección ratifica D-F44-1..10 (o sus variantes).
2. ADR-AUTOMATIONS aprobado si D-F44-8 = sí.
3. Re-verificación de `0171` libre al momento de arrancar (`ls` + `schema_migrations`).
4. Base de código = `f30f79d` (rama nueva `feat/connect-f4-4-integrations-automations`
   desde el estado actual de la línea F4.3), worktree propio.
5. Queda explícito qué riel se implementa (E1/E2/E3/E4 son separables).

**NO-GO / STOP inmediato si:** cualquier paso exige escribir en prod fuera de ventana
autorizada; el hardening no puede garantizar los crons GH Actions (secrets sin confirmar);
el spike WhatsApp requiere tocar la WABA productiva sin verificación previa del panel;
o aparece contradicción con el Master Dossier (prohibido crear arquitectura paralela).

**Aun con GO local: apply de migraciones + deploy + configuración de secrets siguen
requiriendo su propia ventana autorizada por ítem (G1/G3).**

---

## Anexo A — Respuestas directas a las 10 preguntas del mandato

1. **¿Resolver primero el scheduler?** Sí como E1 para el riel de automatizaciones; los spikes no lo necesitan (§7).
2. **¿WhatsApp inbound/outbound/sandbox?** Sandbox: inbound firmado+persistido + outbound solo allowlist interna (§8).
3. **¿Email lectura/envío/threading/sandbox?** Reparar envío (dominio Resend) + re-validar; inbound solo papel; threading F5 (§9).
4. **¿Qué automatizaciones MVP son seguras?** Las que cumplen los 5 criterios de §10 (internas, idempotentes, reversibles, auditadas, kill-switch).
5. **¿Qué eventos pueden automatizarse sin riesgo?** `incident.opened/resolved`, `task.*`, `email_send.failed` — solo con efectos de aviso/tarea interna (§10).
6. **¿Qué requiere aprobación humana?** Todo efecto que salga del sistema, toda escritura de negocio, toda alta de regla (§10).
7. **¿Dónde se audita?** `audit_log` + `automation_runs` + `wa_inbound_events` (§14).
8. **¿Qué secrets hacen falta?** `META_WA_APP_SECRET` (nuevo), vigencia `META_WA_TOKEN`, dominio Resend, `CRON_SECRET` en GH Actions, flag `WHATSAPP_SANDBOX` (§13).
9. **¿Qué webhooks requieren HMAC?** `whatsapp/webhook` (obligatorio); inbound email futuro; crons existentes → fail-closed timing-safe (§11).
10. **¿Qué se excluye hasta F5?** Canales productivos abiertos, inbound email real, threading, portal externo, IA/agentes, SLA engine, envío masivo (§4).

---

## Anexo B — Actualización de estado 2026-07-02 ~16:30Z (posterior a la redacción del plan)

**🔴 P0 NUEVO — Producción ya NO sirve `f30f79d`.** Verificación live posterior a la
redacción de este plan (curl + git):

- `/api/version` = **`0cdb7c6`**, builtAt 2026-07-02T16:24Z — es el commit de
  `fix/drive-credentials-provider-f42`.
- `git merge-base --is-ancestor f30f79d 0cdb7c6` → **falso**: el commit deployado desciende
  de `484a447` (F4.2) y **NO contiene F4.3**. Se materializó exactamente el riesgo advertido:
  el fix Drive se deployó **sin rebasar** sobre `f30f79d` y **pisó F4.3 en producción**
  (tareas, workflows y cockpit fuera del código servido).
- La base de datos **sí** conserva las migraciones F4.3 (`0167`–`0170` aplicadas, verificado
  en `schema_migrations`): schema adelantado respecto del código servido (aditivo; la línea
  F4.2 no las usa, no debería romper, pero es una divergencia código↔schema real).
- Outbox: 39 `pending` sin cambios; `email_sends`: 56/56 `failed` sin cambios.

**Impacto sobre este plan:** el baseline de §5 ("prod = `f30f79d`") y el criterio GO §29.4
quedan condicionados a la **remediación previa**: rebase de `fix/drive-credentials-provider-f42`
sobre `f30f79d` + redeploy (restaura F4.3 + fix Drive juntos), o decisión equivalente de
Dirección. **D-F44-9 deja de ser una decisión de secuencia y pasa a ser un incidente a
resolver ANTES de cualquier ventana F4.4.** La rama base de F4.4 sigue siendo la línea F4.3
(`bb07f9f`/`f30f79d`), que es la única que contiene todo.

*Ninguna acción sobre producción fue tomada por esta sesión (restricciones del mandato).*

### B.1 — RESOLUCIÓN (2026-07-03, pre-flight verificado)

El P0 fue remediado por Dirección el mismo día vía **línea canónica**: F4.3 (`bb07f9f`) +
merge del fix Drive (`50fdde3`) + fix compliance env-id (`8a4b7bb`, E12) + merge `4c19d38`,
**pusheada a `origin/feat/connect-f4-3-tasks-workflows-cockpit`**. Producción redeployada a
**`8a4b7bb`** (builtAt 22:17Z; contiene F4.3 — ancestría verificada; diff vs `4c19d38` =
docs-only). Incidente Drive **CERRADO** (Compliance sync `completed` 23:52Z vía cron, 363
docs, 0 errores, carpeta COMPLIANCE nueva `folderVia:"env-id"`; Contratos conectado; Caja
Chica auditada sana; cockpit 9/9). **Baseline F4.4 = `4c19d38`. Este Anexo B queda como
histórico del episodio.**

---

## Anexo A1 — Decisiones D-F44 RATIFICADAS por mandato de Dirección (numeración autoritativa)

| # | Decisión ratificada |
|---|---|
| D-F44-1 | **Orden de ejecución: E1 scheduler/outbox → E2 hardening → E3 spikes sandbox → E4 automatizaciones MVP.** Nunca empezar por canales productivos. |
| D-F44-2 | **Scheduler/outbox: primero diagnóstico con evidencia** de qué mecanismo cron corre hoy (los syncs registran `trigger:"cron"`); no asumir; luego el mínimo seguro para drenar el outbox. No implementar cron nuevo sin diagnóstico. |
| D-F44-3 | **WhatsApp solo sandbox/spike**: HMAC obligatorio, `META_WA_APP_SECRET` requerido, fail-closed sin secret, sin envíos reales a clientes, persistencia inbound solo si el diseño lo aprueba, logs sin PII sensible. |
| D-F44-4 | **Email solo spike/sandbox hasta verificar dominio Resend** (hoy 403 testing-mode). Sin silent failure: registrar y visibilizar errores. Sin envíos masivos ni respuestas externas automatizadas. |
| D-F44-5 | **Webhooks: timing-safe + fail-closed + HMAC (o equivalente) + auditoría**, sin payloads anónimos peligrosos, sin imprimir secrets. Referencia positiva: webhook Clientify. |
| D-F44-6 | **Automatizaciones MVP solo internas y reversibles** (sugerencias, creación interna controlada, tareas/alertas internas, acciones con aprobación humana). Prohibido: efectos externos irreversibles, WhatsApp/email automático a terceros, cambios masivos, ejecución sin auditoría. |
| D-F44-7 | **Seguridad/PII: mínimo dato necesario**, logs sin PII sensible, payloads auditables, secrets nunca impresos, errores visibles internamente sin filtrar al exterior. |
| D-F44-8 | **Migraciones `0171+` solo si necesarias**: verificar libre, justificar objeto, documentar rollback, no tocar datos productivos. |
| D-F44-9 | **CUMPLIDA/CERRADA** — Drive/F4.3 restaurados vía canónica `4c19d38`. No tocar Drive, Compliance, Caja Chica ni CRM/Contratos en F4.4. |
| D-F44-10 | **Deploy futuro (cuando se autorice): Netlify manual, Node 22, checkout limpio NO-worktree, DRAFT + smoke → PROD + smoke.** No esperar schedules para deployar. |

Correspondencia con la tabla histórica §28: sus filas quedan absorbidas por el mandato; en
particular, el alta de `META_WA_APP_SECRET` en Netlify y la verificación DNS del dominio
Resend siguen siendo **acciones exclusivas de Dirección** (no de la implementación local).

---

*Preparado en sesión de planificación 2026-07-02; aprobado y actualizado a baseline `4c19d38`
el 2026-07-03. Evidencia read-only citada en §5 y Anexo B. Producción NO fue modificada.*

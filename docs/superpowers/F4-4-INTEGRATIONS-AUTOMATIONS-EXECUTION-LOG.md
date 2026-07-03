# F4.4 — INTEGRACIONES + AUTOMATIZACIONES MVP — EXECUTION LOG

> Implementación LOCAL (GO de Dirección 2026-07-03). Worktree
> `~/CODE/tops-ordenes-f44-integrations`, rama `feat/connect-f4-4-integrations-automations`
> desde **`4c19d38`** (canónica `origin/feat/connect-f4-3-tasks-workflows-cockpit`).
> SIN push · SIN merge · SIN deploy · migraciones ENTREGADAS NO APLICADAS ·
> producción NO tocada (solo curl/SELECT/gh api read-only).

## 0. Baseline verificado al arranque

| Ítem | Valor |
|---|---|
| Prod `/api/version` | `8a4b7bb` (200; `/`→307; sin 5xx) |
| Canónica | `origin/feat/connect-f4-3-tasks-workflows-cockpit` @ `4c19d38` (diff vs prod = docs-only) |
| Última mig prod | `0170` · `0171` libre (verificado en schema_migrations + rama) |
| Outbox | 39→41 `pending` (solo `connect.message.posted`; worker jamás corrió programado) |
| email_sends | 56/56 `failed` (Resend 403 testing-mode) |

## 1. Etapa 0 — Master plan consolidado (`8cee1b4`)

Plan aprobado copiado a la rama, actualizado a baseline `4c19d38`, Anexo B con la
resolución del P0 (histórico) y **Anexo A1 = decisiones D-F44-1..10 del mandato
(numeración autoritativa; tabla §28 histórica — precedente F4.1)**.

## 2. E1 — Scheduler / outbox (`c3ef532`)

**Diagnóstico con evidencia (D-F44-2, sin asumir):**
- `gh api …/actions/runs?event=schedule` ⇒ los **5 workflows de `origin/main`
  SÍ corren programados** (Supabase Backup, Clientify, Compliance, Contratos,
  Caja Chica; corridas diarias reales, algunas failure durante el incidente
  Drive, verdes después).
- El `trigger:"cron"` de `compliance_sync_log`/`contract_sync_runs` es la
  etiqueta del endpoint para CUALQUIER llamada con Bearer `CRON_SECRET`: las
  corridas de la tarde del 02-07 fueron `workflow_dispatch` (manuales, sesión
  de cierre del incidente), no schedule.
- **Dato desbloqueante:** los workflows verdes prueban que `CRON_SECRET` está
  seteado en GitHub Secrets y coincide con Netlify ⇒ precondición del hardening
  E2 cumplida con evidencia (no hay cron legítimo sin Bearer).
- El outbox no drena porque su único scheduler era la Netlify Scheduled
  Function (nunca invocada en este sitio: deploys manuales CLI — finding F4.1)
  y NO existía workflow de GH Actions para el endpoint del worker.
- La nota de F4.1 "GH Actions descartado (cron solo corre desde default
  branch)" quedó obsoleta: la default branch SÍ ejecuta schedules hoy; lo que
  falta es EL ARCHIVO del workflow en `main`.

**Mínimo seguro implementado:** `.github/workflows/connect-dispatch-outbox.yml`
(espejo del de Compliance; `*/10` + `workflow_dispatch`; usa los MISMOS secrets
ya configurados). **INERTE hasta que Dirección lo lleve a `main`** (push/merge
fuera de este paquete). Gate de cierre del finding: ≥2 corridas programadas en
`connect_worker_runs`.

## 3. E2 — Hardening webhooks/crons (`6539540`)

- **`src/lib/cron-auth.ts`**: `requireCronAuth()`/`checkCronAuth()` fail-closed
  (503 sin secret · 401 Bearer inválido · `timingSafeEqual`; secret inyectable).
- Adoptado por los 4 crons fail-open: `compliance/sync`, `comercial/contratos/sync`,
  `tesoreria/caja-chica/sync`, `clientify/sync-deals` — **cambio de guard puro,
  cero lógica de negocio tocada**. ⚠️ Nota D-F44-9: compliance/contratos/caja
  chica son módulos "no tocar"; se interpretó que la prohibición cubre su
  LÓGICA/alcance Drive, y el mandato Etapa 3 ordena explícitamente el
  fail-closed de crons inseguros. Los hunks son separables si Dirección
  prefiere excluirlos.
- **`knowledge/drain` NO tocado** (regla explícita del mandato).
- **HMAC WhatsApp** (`src/lib/whatsapp/webhook.ts` + route): `X-Hub-Signature-256`
  = HMAC-SHA256 del body CRUDO con `META_WA_APP_SECRET`; sin secret → 503;
  firma ausente/mal formada/mismatch → 401 + fila `audit_log`
  (`whatsapp_webhook`/`signature_rejected`, solo la razón — sin body/firma/PII).
  GET handshake sin default hardcodeado (fail-closed) y timing-safe.
- `tracking/ingest`: comparación de token timing-safe (antes `!==`).
- Se eliminó el `console.info` del body del webhook (PII de terceros).

## 4. E3 — Spikes sandbox WhatsApp/Email (`bff1462`)

- **Mig `0171_wa_inbound_events.sql` (ENTREGADA NO APLICADA):** persistencia
  cruda append-only post-HMAC; RLS **deny-all** (PII); índices por recepción y
  no-procesados; retención propuesta 90 días (purga manual, sin cron nuevo).
- **`/api/whatsapp/send`**: Bearer obligatorio fail-closed (cambio declarado:
  antes "opcional si CRON_SECRET existía"; grep confirma que ningún módulo
  interno lo llama) + **sandbox default ON**: `WHATSAPP_SANDBOX != "0"` ⇒ solo
  destinos de `WHATSAPP_SANDBOX_ALLOWLIST`; fuera de lista → 403 + audit
  (`whatsapp_send`/`sandbox_rejected`, sin número ni contenido).
- **Email — fin del silent failure** (`src/lib/email-failure.ts` + hook en
  `orders/new/actions.ts`): cada `email_sends.status='failed'` emite
  notificación interna broadcast a `admin` enlazada a la orden (campana +
  Centro), SIN dirección ni cuerpo (D-F44-7); best-effort, jamás rompe la
  orden. La reparación del dominio Resend sigue siendo acción de Dirección.
- `.env.example`: bloque WhatsApp documentado (solo nombres, sin valores).

## 5. E4 — Automatizaciones MVP internas (`ef8c0b8`)

- **Mig `0172_connect_automations_mvp.sql` (ENTREGADA NO APLICADA):**
  `automation_rules` (seed-only, kill-switch `enabled` sin deploy, lectura
  `connect.view`, escritura solo migración/SQL) + `automation_runs`
  (telemetría por evaluación; **UNIQUE(rule_key, outbox_seq) = idempotencia
  dura**) + trigger **ADITIVO** en `connect_incidents` que encola
  `connect.incident.opened` (NO toca las RPCs 0165 — cero riesgo G2 sobre el
  ciclo validado de F4.2) + seed **R1**: severidad `critica` ⇒ broadcast
  `urgent` al rol `admin` (efecto 100% interno; broadcast ADICIONAL al fan-out
  síncrono de F4.2, que no se modifica).
- **Processor** (`src/lib/connect/worker/automations.ts` + módulo PURO
  `automation-rules.ts`): claim idempotente → evaluación declarativa
  (`when`/`effect`; solo `notify_role`; cualquier otro effect.type NO dispara,
  fail-closed) → efecto → telemetría; efecto fallido libera el claim para el
  retry con backoff del worker. Compat F4.1 preservada: topic sin reglas o mig
  0172 ausente ⇒ `skipped` (el backlog de 41 se drena igual que antes).
- Wiring: `dispatch-outbox` route pasa `automationProcessor`;
  `governanceProcessor` sigue exportado (default de la función y de los tests).
- **Decisión de alcance documentada:** R3 (aviso email fallido) se entregó
  SÍNCRONO en E3 (no depende del scheduler muerto) ⇒ el motor arranca con R1
  seedeada; R2/R4 quedan para cuando el scheduler esté evidenciado (gate E1).

## 6. QA

| Gate | Resultado |
|---|---|
| `tsc --noEmit` | 0 errores |
| `next lint` | 0 errores (3 warnings pre-existentes custody) |
| `vitest run` | **538/538** (487 baseline + 51 F4.4: cron-auth 12 · HMAC 11 · sandbox 13 · email-failure 4 · reglas 10 · caja-chica reescrito +2 — incluye la migración del test al guard fail-closed) |
| `next build` | OK |

## 7. Revisión adversarial

Dos revisores independientes (lentes seguridad y correctness/regresión) sobre
los 4 commits de código. **Resultado: 0 bloqueantes · 1 ALTO · 5 MEDIO · 7 BAJO.**
Núcleo validado por ambos: HMAC sin bypass (raw body, casing, formato, timing),
guards fail-closed sin residuos, PGRST205 verificado contra supabase-js 2.106.2
real, trigger AFTER correcto, migs idempotentes, backlog sigue drenando skipped.

### 7.1 Hallazgos y disposición (fixes en commit de hardening post-review)

| Sev | Hallazgo | Disposición |
|---|---|---|
| ALTO | Claim `'claimed'` huérfano (worker muerto entre claim y efecto) bloqueaba el re-fire para siempre → broadcast perdido en silencio | **CORREGIDO**: lease de 5 min + takeover con lock optimista (alineado al lease de 0160). Semántica final del efecto = at-least-once |
| MEDIO | Sandbox NO cubría el egress directo de compras (`sendText` desde `compras/nueva/actions.ts`, no pasa por el route) | **CORREGIDO**: guard movido al choke point `callMeta()` en `meta.ts` (todo egress). ⚠️ Operativo: `WHATSAPP_SANDBOX_ALLOWLIST` DEBE incluir `WHATSAPP_NOTIFY_DEFAULT` o el aviso de OC firmada dejará de salir post-deploy |
| MEDIO | `checkCronAuth` trimeaba el secret → riesgo de 401 masivo si `CRON_SECRET` tuviera whitespace (cambio semántico vs guards previos) | **CORREGIDO**: comparación EXACTA contra el valor raw (trim solo para decidir "configurado") |
| MEDIO | Flood de `audit_log` vía POSTs no autenticados al webhook (público por diseño) | **CORREGIDO**: auditoría muestreada 10/min por instancia (rate-limit in-memory); el 401 se responde siempre |
| MEDIO | `/api/whatsapp/send` compartía `CRON_SECRET` con los 5 syncs (privilegio mezclado) | **CORREGIDO** (opcional): soporta `WHATSAPP_SEND_SECRET` dedicado; sin la var usa `CRON_SECRET` (comportamiento actual) |
| MEDIO | Notificación duplicada si el insert del efecto commitea pero la respuesta se pierde | **RESIDUAL DOCUMENTADO**: at-least-once deliberado (peor perder un aviso crítico que duplicarlo); dedupe-key posible en F5 |
| BAJO | Valor validado ≠ valor enviado en send (y `to` numérico → 500) | **CORREGIDO**: se normaliza una vez y se envía exactamente lo validado; `to` sin dígitos → 400 |
| BAJO | 0172 sin revoke defensivo (inconsistente con 0171) | **CORREGIDO**: revoke de escrituras + secuencia |
| BAJO | Trigger de enqueue sin exception handler acoplaba el insert del outbox a `connect_incident_open` | **CORREGIDO**: bloque exception → `raise warning`, el incidente nunca se ve afectado |
| BAJO | Workflow: `partial` mal interpretado; dead-letter invisible (job verde) | **CORREGIDO**: `failed_dead>0` ⇒ run ROJO; backlog ⇒ notice; partial ⇒ warning de errores por-evento |
| BAJO | Updates de telemetría sin chequeo de error; valor `'error'` del CHECK sin uso; sin retención de `automation_runs` | **PARCIAL**: chequeo+log agregado; `'error'` queda reservado; retención → deuda menor (tabla crece 1 fila/regla×evento) |
| BAJO | Fuga de longitud del verify token por timing (length short-circuit) | **RESIDUAL ACEPTADO** (secretos de largo fijo; mismo criterio que clientify) |
| BAJO | `automation_rules.config`/`runs.detail` legibles por todo `connect.view` | **RESIDUAL ACEPTADO** (hoy sin datos sensibles; vigilar en reglas futuras) |

QA re-corrido tras los fixes: **tsc 0 · lint 0 (3 warns pre-existentes) ·
538/538 tests · build OK.**

## 8. Commits del paquete

| SHA | Commit |
|---|---|
| `8cee1b4` | docs(connect): approve F4.4 integrations automations master plan |
| `c3ef532` | feat(connect): diagnose and harden F4.4 scheduler outbox foundation |
| `6539540` | feat(connect): harden integration webhooks and cron guards |
| `bff1462` | feat(connect): add WhatsApp and email sandbox spikes |
| `ef8c0b8` | feat(connect): add internal automation MVP safeguards |

## 8b. Ventana 2026-07-03 ~01:00-01:10Z — ABORTADA EN ETAPA 2 (checklist de secrets)

Autorizada por Dirección con GO condicionado ("NO deployar si el checklist de
secrets no está claro"). Resultado: **STOP limpio, sin tocar nada.**

**Etapa 1 pre-flight: PASS 12/12** — prod `8a4b7bb` sana (307/200, 0 5xx), top
mig `0170`, `0171/0172` libres (`to_regclass` null), worktree @ `bc8868b` tree
limpio, package files = `4c19d38`, Netlify site `tops-ordenes` linkeado y CLI
autenticada, Node 22.23.1 disponible (Homebrew `node@22`), sin secretos
impresos, Drive/Compliance sin tocar, F5 no iniciada.

**Etapa 2 secrets (contexto production, 39 vars, solo nombres): FAIL — 2
stop-conditions del mandato:**

| Check | Resultado |
|---|---|
| `META_WA_TOKEN` / `META_WA_PHONE_NUMBER_ID` / `META_WA_BUSINESS_ACCOUNT_ID` / `META_WA_WEBHOOK_VERIFY_TOKEN` | ✔ presentes ⇒ el canal WA saliente ESTÁ configurado en prod (el aviso OC probablemente sale hoy) |
| `META_WA_APP_SECRET` | ✖ **AUSENTE** — no se puede descartar que la WABA apunte a prod (verificarlo en el panel Meta = Dirección) ⇒ stop-condition 1 |
| `WHATSAPP_NOTIFY_DEFAULT` | ✔ presente |
| `WHATSAPP_SANDBOX_ALLOWLIST` | ✖ **AUSENTE** ⇒ allowlist vacía NO incluye `WHATSAPP_NOTIFY_DEFAULT` ⇒ **stop-condition 2 explícita** (post-deploy el aviso OC quedaría bloqueado por el sandbox) |
| `WHATSAPP_SANDBOX` | ausente = default ON en código ✔ (correcto para F4.4) |
| `WHATSAPP_SEND_SECRET` | ausente (opcional; usa `CRON_SECRET`) ✔ |
| `RESEND_API_KEY` (scope production) + `RESEND_FROM_EMAIL` | ✔ presentes; dominio sigue sin verificar (403 testing-mode) — el cambio F4.4 solo VISIBILIZA fallas, no envía masivo ✔ |

Gotcha nuevo: `netlify env:list --json` sin `--context production` lista el
contexto DEV y **omite** vars scoped a production (`META_WA_TOKEN`,
`RESEND_API_KEY`, `OPENAI_API_KEY` no aparecían) — siempre pasar
`--context production` en pre-flights.

**Consecuencia:** Etapas 3–7 NO ejecutadas (migs NO aplicadas, cero deploys).
Producción intacta `8a4b7bb`. **Ajuste de env requerido (Dirección) antes de
re-intentar la ventana:** (1) alta `META_WA_APP_SECRET` (panel Meta → Settings
→ Basic), (2) alta `WHATSAPP_SANDBOX_ALLOWLIST` incluyendo el número de
`WHATSAPP_NOTIFY_DEFAULT` (+ números internos de prueba), (3) opcional
`WHATSAPP_SEND_SECRET`. Con eso, re-correr esta ventana desde la Etapa 1.

## 9. Confirmaciones del mandato

- Producción NO modificada (solo lecturas). Drive/Compliance/Caja Chica/CRM:
  lógica NO tocada (solo el guard de auth de sus endpoints, separable).
- WhatsApp/Email productivos NO activados (sandbox ON por default; dominio
  Resend sigue pendiente de Dirección). Knowledge drain NO tocado.
- `RBAC_ENFORCE` NO tocado. Sin push, sin merge, sin deploy, sin apply.

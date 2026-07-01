# F4.1 · Fundación Colaborativa — Execution Log (implementación LOCAL)

> Fecha: 2026-07-01. Worktree `~/CODE/tops-ordenes-f41-foundation`, branch
> `feat/connect-f4-1-collaboration-foundation` (base código = prod `a6c23f9`; commits previos
> de la rama = docs-only aprobados). **NADA aplicado a prod / NADA deployado / NADA pusheado.**
> Plan aprobado: `F4-1-COLLABORATION-FOUNDATION-PLAN.md` v1.1 + decisiones D-F41-1..10 de
> Dirección (mandato 2026-07-01, numeración del MANDATO = autoritativa, ver §5).

## 1. Verificación de aislamiento (Etapa 1)

- Prod `/api/version` = `a6c23f9` (production) al inicio; migraciones prod hasta `0159`; `0160` libre.
- Branch creada desde `8453ec3` (= código `a6c23f9` + 6 commits docs-only aprobados; diff vs
  `a6c23f9` = solo `docs/superpowers/*`, 862 inserciones). Working tree limpio; `package.json`/
  `package-lock.json` intactos; sin secretos en commits.
- `node_modules` + `.env.local` provisionados por copia local (CoW); `.env.local` jamás commiteado.

## 2. Commits del bloque

| Commit | Subetapa | Contenido |
|---|---|---|
| `8453ec3` | Etapa 0 | docs: aprobación plan F4.1 (autorizado) |
| `7d6cec7` | **F4.1A** | mig `0160` + worker TS + route + Netlify Scheduled Function + 12 tests |
| `348a2e7` | **F4.1B** | mig `0161` + dominio `resolveMentions` + composer @ + highlight + ruteo notif + 13 tests |
| `178de59` | **F4.1C** | mig `0162` + actions RPC (snooze/delegar/prioridad) + UI Centro + 4 tests |
| `7b3f7f7` | **F4.1D** | mig `0163` (14 RPCs) + R-2 + F-1 (`JoinChannelPrompt`) |
| `d44f104` | Etapa 7 | fixes de revisión adversarial (1 crítico + 4 importantes + menores) |
| (último) | Etapa 8 | paquete de documentación/validación |

## 3. Migraciones locales creadas (entregadas, NO aplicadas — G3)

- **`0160_connect_outbox_worker.sql`** — RPCs claim/mark/recover/prune + `connect_worker_runs`
  (con `skipped`/`pruned`) + `connect_record_worker_run`; H-E1-1 service_role-only.
  `recover_stuck` cuenta reintentos y dead-letterea (fix de revisión).
- **`0161_connect_mentions_fanout.sql`** — helper `_connect_assert_not_archived`;
  `connect_post_message` **DROP 5-args + CREATE 6-args** (+`p_mentions`, tope 20, menciones solo
  miembros por FK, guarda de archivado consolidada) + re-grants, batch atómico (D-F41-4);
  trigger `connect_message_mentions`→notif `connect_mention` high **con coalescing** (fix de
  revisión); rama DM síncrona con coalescing en `_connect_enqueue_message` (D-F41-2/3).
- **`0162_connect_notification_actions.sql`** — RPCs `connect_notif_snooze` (1min..30d) /
  `connect_notif_delegate` (audit_log A4:2972; destino staff criterio 0158; devolver=des-delegar) /
  `connect_notif_set_priority`; guard dueño-o-delegado NULL-safe; policies select/update de
  `notifications` extendidas con `delegated_to` (desvío declarado del plan §19) + **grant de
  UPDATE POR COLUMNA `(read_at, remind_at)`** (fix del hallazgo CRÍTICO: sin esto el UPDATE
  directo permitía forjar/transferir notificaciones y delegar sin auditoría).
- **`0163_connect_archived_guards.sql`** — guarda de archivado en 14 RPCs. **Regla de oro
  cumplida:** cuerpos base = vigentes (0151 ×6 fail-closed P-1 · 0150 join · 0144 ×7);
  `post_message` guarda desde 0161. Exentas (D-F41-5): mark_read, toggle_favorite,
  delete_message, archive, set_title.
- **Rollback:** `supabase/migrations/ROLLBACK_0160_0163.md` (restauración por fuentes vigentes;
  irreversibles declarados).
- **`0164` NO creada** (D-F41-6: SEC-1 se mantiene; sin fallback admin).

## 4. Decisiones D-F41 aplicadas (numeración del mandato de Dirección)

| D | Cumplimiento |
|---|---|
| 1 | 4 bloques A-D implementados; nada de incidentes/tareas/WhatsApp/email |
| 2 | Fan-out selectivo: menciones (high) + DM (normal, coalescing) ; canales sin notif por mensaje; coalescing también de menciones (fix Etapa 7) |
| 3 | Backlog: dry-run cuenta "antes" (persistido en `connect_worker_runs` con `dry=true`), drenaje sin efectos (`skipped`), conteo "después" = `pending_remaining`; batching+idempotencia+telemetría |
| 4 | DROP+CREATE atómico, sin overload (kit SQL verifica 1 sola función), re-grants, adapter compatible sin deploy simultáneo, prueba anti-PostgREST-300 y anti-regresión-0151 en el kit |
| 5 | Matriz 15 con guarda (1 en 0161 + 14 en 0163) / 5 exentas con motivo, documentada en 0163 header |
| 6 | F-3 NO implementado; sin `0164`; SEC-1 intacto (membresía = frontera de PII) |
| 7 | Snooze/delegar/prioridad + marcar leída; delegación con fila de auditoría; sin canales externos |
| 8 | Autocomplete existente reusado (miembros: `listParticipants`; delegación: 0158); FK fuerza miembros; `connect_message_mentions` poblada; notifs solo a mencionados; navegación al hilo vía `hrefFor` + Bell |
| 9 | Netlify Scheduled Function (`netlify/functions/connect-dispatch-outbox.mts`, */5); GH Actions NO usado; ejecución manual = route con `CRON_SECRET` timing-safe fail-closed ESTRICTO (503 sin secret); **la evidencia de ejecución programada REAL queda para la ventana** (requiere deploy); hallazgo Knowledge documentado aparte (`OPS-KNOWLEDGE-DRAIN-SCHEDULING-FINDING.md`), sin tocar |
| 10 | Worktree dedicado; commit local por subetapa; ventana única propuesta; procedimiento final = runbook del Validation Pack |

## 5. Desvíos declarados

1. **Numeración D-F41:** el mandato de aprobación de Dirección renumeró las decisiones respecto
   de la tabla del plan v1.1 (p.ej. mandato D-F41-4 = regla post_message; plan D-F41-4 = menciones
   a miembros). Código y docs citan la numeración del MANDATO (autoritativa). Addendum agregado al plan.
2. **Policies de notifications** (plan §19 decía "sin cambios"): extendidas con `delegated_to`
   + grant por columna — sin esto la delegación era inoperante y (hallazgo crítico) el camino
   directo era forjable. Aditivo, blast-radius interno.
3. **ADR-TASKS:** el plan lo listaba como transversal de F4.1; el mandato de implementación no lo
   incluyó en las etapas y explicitó "No implementar Tareas todavía" → **diferido a F4.2/F4.3
   (declarado)**; sigue siendo precondición de la implementación de Tareas.
4. **Worker dimensionado** a ~8s/corrida (timeout real Netlify) en vez de 50s del template
   knowledge; el backlog se drena por corridas repetidas (runbook).
5. **Snooze** = filtro de lectura (D-F41-10 aprobada) — ahora también en el Bell (fix Etapa 7).

## 6. QA (Etapa 6)

- `typecheck` **0** · `lint` **0 errores** (2 warnings pre-existentes de PDFs) · vitest
  **410/410** (**+29 nuevos**: 12 worker + 7 resolveMentions + 2 use-cases + 4 snooze + 4 dominio
  ajustes) · `build` **✓ Compiled successfully** (ruta `/api/connect/cron/dispatch-outbox`
  registrada; local node 26 — el build de release se hace con Node 22 según runbook).
- Dev server bootea con los cambios (preview local): login shell renderiza, **0 errores de
  consola**. La validación UI autenticada (menciones/notifs reales) queda para la ventana, como en F3.

## 7. Revisión adversarial (Etapa 7)

3 dimensiones (SQL/seguridad · TS/correctness · compatibilidad prod) con verificación:
**1 crítico / 4 importantes / 14 menores.** Corregidos en `d44f104`:
- **CRÍTICO:** forja/transferencia de notificaciones vía UPDATE directo con la policy ampliada →
  grant por columna (patrón SEC-PARTICIPANTS-1).
- Importantes: timeout real del worker (redimensionado); Bell sin filtro de snooze (filtrado);
  bypass de delegación por UPDATE directo (cerrado por el mismo grant); entregables faltantes
  (rollback + kit SQL + este log → entregados en Etapa 8).
- Menores corregidos: recover_stuck cuenta reintentos; coalescing de menciones; dedupe del Centro
  con query dedicada (incluye snoozeadas); timing-safe compare; telemetría de corridas dry;
  highlight con frontera de palabra y desempate; caret del autocomplete; refresh y copy de
  delegación. Menores ACEPTADOS (documentados): carrera improbable del coalescing DM (best-effort,
  sin unique parcial); doble notificación mención+DM en el MISMO mensaje de un DM (residual, la
  mide el piloto); degradaciones transitorias apply→deploy (runbook exige ventana única).

## 8. Confirmaciones

- **Prod NO modificada** (verificado `/api/version`=`a6c23f9` al inicio y al cierre).
- **Sin push / merge / deploy / migraciones aplicadas / cambios RBAC global / RBAC_ENFORCE.**
- **WhatsApp / email / incidentes / tareas / automatizaciones externas: NO implementados.**
- Knowledge drain: NO tocado (solo documentación del hallazgo).

---

# APÉNDICE — VENTANA ÚNICA APPLY+DEPLOY (2026-07-01, AUTORIZADA)

## A. Pre-flight (22:54Z) — PASS 26/26
Prod `a6c23f9` (login 200, /connect 307, 0 5xx) · Netlify `tops-ordenes`/`nexus.logisticatops.com`,
**rollback point = deploy `6a45820a7b7b7de8d59c6160`** · DB `arsksytgdnzukbmfgkju` top=`0159`,
`0160-0164` libres, `connect_post_message` = 1 función 5-args exacta, set_title/archived_at/search/
search_profiles OK · `CRON_SECRET` existe (valor no impreso) · worktree `080cbe3` limpio, pkg
intactos, Node 22.23.1, checkout NO-worktree creado (`~/CODE/deploy-f41-clean`).
Backlog `connect_outbox` pending = **34** (conteo "antes", D-F41-3).
Nota: `src/lib/whatsapp/meta.ts` SÍ existe (pre-existente en a6c23f9; el relevamiento F4 lo negó);
NO tocado por F4.1.

## B. Apply 0160–0163 (22:57–23:06Z) — vía MCP `apply_migration`, 4/4 success
| Mig | Resultado | Registro |
|---|---|---|
| 0160_connect_outbox_worker | success | schema_migrations ✔ |
| 0161_connect_mentions_fanout | success (batch atómico) | ✔ |
| 0162_connect_notification_actions | success | ✔ |
| 0163_connect_archived_guards | success | ✔ (top `20260701230222`, 4/4 nombradas) |

## C. Checkpoints C1–C4 — TODOS PASS (funcionales con ROLLBACK garantizado vía excepción)
- **C1:** 6 RPCs worker + tabla+RLS + H-E1-1 (auth NO claim / service_role SÍ) + backlog 34 intacto.
- **C2 estructura:** 1 SOLA `connect_post_message` (6-args), 2 triggers, grants OK. **C2 funcional
  (rollback):** compat 5-args nombrados PASS · mención→fila+notif high `entity=connect` SIN
  contenido PASS · coalescing mención (2ª = sigue 1) PASS · no-miembro ignorada PASS ·
  auto-mención 0 PASS · tope 21→check_violation PASS · **DM end-to-end** (create dm + 2 msgs → 1
  notif normal coalesced, autor sin notif) PASS · outbox encola (delta 2) PASS · post a archivado
  →check_violation PASS. Cero residuos (verificado post-rollback; pending sigue 34).
  Nota metodológica: el primer intento contó notifs con `role=authenticated` y la RLS filtró los
  SELECT del propio test (falsos ceros); re-ejecutado contando como postgres.
- **C3:** grant por columna EXACTO `[read_at, remind_at]` · snooze válido/inválido · prioridad
  válida/inválida · delegación → `delegated_to` + **1 fila audit_log** · delegado acciona ·
  tercero denegado · **FORJA title/delegated_to/user_id DENEGADA (3/3)** · markRead directo del
  dueño sigue OK. Todo rollback.
- **C4:** 14/14 con guarda `_connect_assert_not_archived` · P-1 vivo (`v_my_role is null` en
  add_member; set_member_role owner-only; auto-baja preservada) · exentas sin guarda (5/5=0) ·
  funcional: set_topic/add_member/react sobre ARCHIVADO rechazados · mark_read/favorite sobre
  archivado OK · no-miembro denegado · archive funciona · search_profiles ejecuta. Todo rollback.

## D. Deploy (D-F41-10: Node 22.23.1 · checkout NO-worktree `deploy-f41-clean` · draft-first)
- **DRAFT 1** `6a459cfdfbd0cf7f70371dbb` (commit `080cbe3`): version/rutas/fail-closed OK **pero
  el worker devolvía 401 CON Bearer válido** → 🔴 hallazgo: la ruta no estaba en la ALLOWLIST del
  middleware (mismo requisito que los 5 crons existentes). El draft-first hizo su trabajo.
- **Fix in-scope** commit **`8c44003`** (`fix(connect): allowlist worker cron route in middleware`,
  1 línea + comentario, patrón idéntico a compliance/contratos/caja-chica/clientify). QA re-verde
  (typecheck 0 / 410 tests / lint 0). **Desvío declarado: el commit de deploy pasa de `080cbe3` a
  `8c44003`** (docs+fix; autorizado por el espíritu de la ventana — sin el fix, el worker
  deployado quedaba inalcanzable y el criterio de éxito era incumplible).
- **DRAFT 2** `6a459e03efd74590791f8c5d` (`8c44003`): version=8c44003, login 200, 5 rutas 307,
  worker sin secret 401 (respuesta del handler), **0 5xx**. Limitación: el positivo remoto manual
  no fue verificable — `netlify env:get` NO entrega el valor runtime real de CRON_SECRET
  (write-only/masked). Aislamiento local (dev server con secret propio): SIN/MAL secret 401;
  CON secret `dry=1` → success con **pending_remaining=34 contra la DB de prod (read-only)** →
  lógica handler+dispatch+RPCs probada end-to-end. El scheduled function es AUTOCONSISTENTE
  (lee el mismo process.env que el route).
- **PROD** deploy **`6a459f4e9a96c5ccaf9fc3f2`** (23:14:17–23:15:38Z, exit 0, sin
  ENOENT/PLUGIN_DIR). Scheduled function `connect-dispatch-outbox.mts` bundleada.

## E. Smoke PROD base (23:15–23:16Z) — PASS
`/api/version`=**`8c44003`** env=production · /login 200 · /connect(+canales/notificaciones/
buscar)/dashboard 307 fail-closed · worker SIN secret 401 · MAL secret 401 · **0 5xx**.

## F. Worker / scheduling (Etapa 10)

- **Dry-run:** ejecutado vía aislamiento local contra la DB de prod (read-only):
  `pending_remaining=34` = conteo ANTES (D-F41-3), registrado como corrida `dry=true` en
  `connect_worker_runs` (23:13:55Z, corr `63262b95`). Cero notificaciones históricas emitidas
  (verificado: notifs connect_* = 0 en todo momento).
- **Manual real remoto:** NO ejecutable por el operador asistido — `netlify env:get` no entrega el
  valor runtime de `CRON_SECRET` (write-only/masked; el clasificador de seguridad además bloquea
  materializarlo). Negativos verificados en prod: sin secret 401 · mal secret 401. Positivo:
  probado en aislamiento local (secret propio) → success. Queda en checklist de Martín.
- **Scheduling — SAGA (2 fixes en ventana):**
  1. DRAFT 1: middleware sin allowlist → fix `8c44003` (ver §D).
  2. PROD 1 (`6a459f4e...`, commit 8c44003): function bundleada, pero **el `config.schedule`
     in-source NO quedó registrado** — ticks 23:20/23:25/23:30 sin ejecutar, logs vacíos,
     `searchSiteFunctions` sin schedule. → fix **`bef2f78`**: registro DECLARATIVO en
     `netlify.toml` (`[functions."connect-dispatch-outbox"] schedule = "*/5 * * * *"`).
  3. DRAFT 3 `6a45a34a99b977999679cdc7` (smoke OK) → **PROD 2 `6a45a3bdd89a6fe23d1994ab`**
     (23:33:12–23:34:44Z, commit `bef2f78`). Smoke PROD completo re-PASS (0 5xx).
     **`searchSiteFunctions` AHORA SÍ devuelve `schedule: "*/5 * * * *"`** (registro confirmado
     en la plataforma).
  4. Evidencia de EJECUCIÓN programada: ver resultado final abajo (ticks post-23:45).
- Estado del backlog durante toda la ventana: `pending=34`, INERTE (cero efectos, cero spam).
  El primer tick real lo drenará como `processed+skipped` (gobernanza D-F41-3/8).

## G. Resultado final de la ventana (23:57Z)

- **Scheduling: NO EVIDENCIADO.** Con el schedule REGISTRADO en la plataforma
  (`searchSiteFunctions` → `*/5 * * * *`), los ticks 23:40/23:45/23:50/23:55 NO ejecutaron
  (0 corridas reales; logs de function vacíos). Hipótesis principal: limitación de plataforma
  con deploys manuales CLI (sitio sin CI de Netlify) o lag de activación anómalo. **Per mandato
  Etapa 10: F4.1 queda DEPLOYADA pero NO CERRADA — "evidencia de scheduling real" = PENDIENTE
  BLOQUEANTE DE CIERRE.** Opciones (decisión Dirección, sin ejecutar): (a) verificar en el
  dashboard de Netlify (Functions → connect-dispatch-outbox: badge Scheduled/Next run) y esperar;
  (b) cron externo invocando el route con CRON_SECRET; (c) ticket a Netlify Support. Mientras
  tanto el sistema es SANO sin worker: el fan-out crítico es SÍNCRONO (triggers) y el backlog es
  inerte (34 pending, cero efectos); Martín puede drenarlo manualmente con el secret real.
- **Estado final:** prod **`bef2f78`** (deploy `6a45a3bdd89a6fe23d1994ab`), 0 5xx, rutas OK,
  worker fail-closed, migs 0160-0163 aplicadas y validadas C1-C4, notifs históricas emitidas = 0,
  backlog intacto (34 pending, se drenará en el primer tick real o corrida manual).
- **Rollback: NO requerido.** Puntos de restauración: deploy `6a45820a7b7b7de8d59c6160`
  (`a6c23f9`) + `ROLLBACK_0160_0163.md` (no usados).
- **Commits de la ventana** (desvío declarado del "commit exacto 080cbe3"): `8c44003` (middleware
  allowlist, hallazgo DRAFT 1) y `bef2f78` (schedule declarativo en netlify.toml, hallazgo PROD 1)
  — ambos fixes in-scope del entregable F4.1A, con QA re-verde (typecheck 0 / 410 tests / lint 0).
- **Cronología de deploys de la ventana:** DRAFT1 `6a459cfdfbd0cf7f70371dbb` (080cbe3) →
  DRAFT2 `6a459e03efd74590791f8c5d` (8c44003) → PROD1 `6a459f4e9a96c5ccaf9fc3f2` (8c44003) →
  DRAFT3 `6a45a34a99b977999679cdc7` (bef2f78) → **PROD2 `6a45a3bdd89a6fe23d1994ab` (bef2f78) =
  publicado**.
- **GO/NO-GO de cierre F4.1: NO-GO (todavía).** Pendientes bloqueantes: (1) evidencia de
  scheduling real (≥2 corridas en connect_worker_runs); (2) smoke funcional autenticado
  (checklist de 10 puntos en el Validation Pack, incluye worker manual con el secret real).
  Todo lo demás del criterio de éxito: CUMPLIDO.

## H. Confirmaciones de la ventana
`0164` NO creada/aplicada · Knowledge drain NO tocado (solo doc OPS previa) · WhatsApp/email/
incidentes/tareas NO implementados · sin push / sin merge · RBAC global intacto · Netlify site
correcto en todo momento.

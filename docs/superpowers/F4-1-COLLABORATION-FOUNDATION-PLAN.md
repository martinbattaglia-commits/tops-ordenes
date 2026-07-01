# F4.1 · Fundación Colaborativa — Plan Técnico y Operativo

> **Estado: PROPUESTA v1.1 — pendiente de aprobación de Dirección (G7). NO iniciar implementación sin GO.**
> Fecha: 2026-07-01. Deriva de `F4-KICKOFF-SCOPE-PLAN.md` (Master Plan F4 aprobado, commit `b5219cb`).
> v1.1 = v1.0 corregida tras **revisión adversarial de 3 lentes independientes (factual / gobernanza /
> completitud): 22 hallazgos incorporados**, incluidos 3 críticos (sobrecarga de `connect_post_message`,
> regresión potencial del hardening 0151, cron GH Actions inviable desde rama no-default).
> **En esta etapa NO se implementó código, NO se crearon migraciones, NO se tocó DB/prod.**
> Base verificada: prod `a6c23f9`; migraciones aplicadas hasta `0159`; relevamiento read-only en 6
> dimensiones + verificación adversarial sobre el worktree `tops-ordenes-admin-surface-8-10` (= prod).

---

## 1. Resumen ejecutivo

F4.1 completa la **fundación colaborativa** que F3 dejó a medias: hoy `connect_outbox` encola un
evento por cada mensaje **pero nadie lo consume** (crece sin límite en prod desde el apply de F3.2B),
la tabla de menciones existe **sin parser ni notificación**, y las columnas de notificaciones
avanzadas (`priority`/`remind_at`/`delegated_to`) existen **sin RPCs ni acciones de UI**. La higiene
F3 es más amplia de lo registrado al cierre: la matriz de archivado alcanza **15 RPCs de escritura
sin guarda** (§16), no 1.

El diseño sigue el **modelo híbrido que el spec ya aprobó** (Addendum A4, resolución NOTIF-1,
spec:777): fan-out **síncrono acotado** por trigger (menciones + contraparte de DM) y fan-out
**masivo/diferido** por worker `service_role` (`/api/connect/cron/dispatch-outbox`, `CRON_SECRET`
fail-closed) que era entregable F1.4 y nunca se construyó. El worker replica el patrón del worker de
Knowledge (mig `0133`) — con una salvedad operativa descubierta en la verificación: **el scheduling
por GitHub Actions NO es viable hoy** (los cron solo corren desde la rama default `main`, divergida
y sin el workflow; de hecho el drain de Knowledge tampoco está corriendo programado — ver §6). El
plan propone el mecanismo de activación como decisión D-F41-9 (recomendado: Netlify Scheduled
Function, que viaja con el deploy y no depende de GitHub).

Entregable F4.1 = 4 subetapas (A outbox/worker · B menciones + fan-out síncrono · C acciones de
notificación · D higiene F3) + ADR-TASKS en paralelo (docs-only), **4 migraciones (`0160`–`0163`) +
1 condicional (`0164`, F-3 — requiere resolución formal SEC-1 con ADR)**, ~10–14 días-dev, **una
sola ventana de apply+deploy al cierre** del bloque, piloto integral posterior.

## 2. Objetivo de F4.1

Que Nexus Link **avise**: toda mención genera notificación confiable que navega al hilo; los DM
avisan a la contraparte sin fatigar; el centro de notificaciones se vuelve accionable (prioridad,
snooze, delegación con auditoría); el outbox queda drenado y gobernado (base de incidentes F4.2 y de
egress futuro); y los residuales de F3 quedan cerrados (archivado consistente server-side, join en
`/c/[id]`; F-3 según decisión SEC-1).

## 3. Alcance incluido

| Subetapa | Contenido |
|---|---|
| **F4.1A** | Worker de `connect_outbox` (RPCs claim/mark/recover + `connect_worker_runs` + route `/api/connect/cron/dispatch-outbox` + **mecanismo de scheduling según D-F41-9**) · drenaje del backlog histórico · retención |
| **F4.1B** | Menciones end-to-end: `connect_post_message` con menciones (DROP+CREATE, §11) → filas en `connect_message_mentions` → trigger → notificación `connect_mention` · autocomplete de miembros en composer · highlight · **fan-out síncrono de DM con coalescing** (extensión `_connect_enqueue_message`) · **ruteo de notificaciones connect al hilo** (`hrefFor` + `NotificationsBell`) |
| **F4.1C** | RPCs `connect_notif_snooze` / `connect_notif_delegate` (con fila de auditoría, spec A4:2972) / `connect_notif_set_priority` · acciones en `NotificationCenter` · lectura incluye delegadas |
| **F4.1D** | Higiene F3: R-2 (filtro archivados) · R-3 ampliado (guarda de archivado en **15 RPCs** vía helper único, matriz §16) · F-1 (join en `/c/[id]`) · F-3 **condicional** (solo con SEC-1 resuelto + ADR) |
| **Transversal** | **ADR-TASKS** (diseño de Tareas colaborativas, docs-only, en paralelo — compromiso del Master Plan §3.6) · kit SQL de validación read-only para RPCs nuevas/modificadas |

## 4. Alcance excluido (explícito)

- Centro de Incidentes (F4.2), implementación de Tareas/workflows (F4.3, post ADR-TASKS), spikes
  WhatsApp/Email y automatizaciones (F4.4).
- Digest/resumen diferido de no-leídos de canales (el worker queda listo; el digest = F4.2+).
- Preferencias de usuario (`notif_freq_default` de 0154) — cablearlas queda fuera.
- Notificaciones push/email externas (egress = F4.4+).
- Menciones a NO-miembros (la FK lo impide por diseño; "mencionar-e-invitar" = futuro).
- Presence/typing; cambios a la publicación realtime (no se necesitan: las notificaciones viajan por
  la suscripción existente a `notifications`).
- Cambios de RBAC global, `RBAC_ENFORCE`, permisos nuevos (no se necesitan).
- **F-3 por defecto**: el fallback de lectura admin **contradice una decisión explícita del spec**
  (spec:610 y SEC-1 spec:1984: "no `is_admin()` blanket; la membresía es la frontera de PII; admin
  entra como miembro o vía vistas DEFINER auditadas"). Solo entra a F4.1 si Dirección/Compliance
  resuelve SEC-1 formalmente con ADR-CONNECT-ADMIN-READ (ver §16).

## 5. Dependencias con F3 (verificadas; estado real anotado)

- Trigger `_connect_enqueue_message` (0144:27-57): denormaliza `last_message_seq/at` + encola
  `connect.message.posted` con payload `{conversation_id, message_id, seq, author_profile_id, kind}`.
- `connect_outbox` (0143:274-289): estados `pending/processing/processed/failed/dead`, índice parcial
  de despacho, RLS deny-all (solo service_role).
- `notifications` base (0004:49-61) + extensión A4 (0147): `priority`, `remind_at`, `delegated_to`;
  kinds reservados `connect_message`/`connect_mention`/`connect_channel_invite`/`connect_incident`.
- `connect_message_mentions` (0143:206-215), FK `mentioned_participant_id → connect_participants(id)`.
- `connect_search_profiles` (0158) — picker de delegación sin exponer email.
- `connect_join_channel` (0150) — join fail-closed a canal público (⚠️ hoy sin chequeo de archivado;
  entra a la matriz §16).
- `connect_set_title` (0159) — plantilla de guarda de archivado ya en prod.
- **Cuerpos vigentes de RPCs de moderación = `0151`** (fail-closed P-1, posterior a 0144): add/remove
  member, set_member_role, set_topic, pin, unpin (+archive). **Toda modificación futura parte de 0151,
  NO de 0144** (crítico §16).
- Dominio TS: `parseMentions` y `canPost` (puras, testeadas en `src/lib/connect/domain/message.test.ts`).
- `useRealtimeTable` (src/lib/supabase/realtime.ts:21-29) ya incluye `notifications` y `connect_messages`.
- Patrón worker Knowledge: mig 0133 (claim FOR UPDATE SKIP LOCKED + lease, backoff `2^(n-1)` min,
  dead@3, `record_worker_run`), `src/lib/knowledge/drain.ts`, route con `CRON_SECRET` fail-closed.
  ⚠️ **Precisión post-verificación:** lo probado en prod es el **route + CRON_SECRET**; el
  *scheduling* (`knowledge-drain.yml`) NO está activo en GitHub (no vive en la default branch `main`;
  los cron de GH Actions solo corren desde ella). Ver §6 y D-F41-9.
- Política P-1 (guards NULL-safe) + hardening H-E1-1 (0131/0133:143-150).

## 6. Estado actual verificado (2026-07-01, read-only)

- Prod `/api/version` = `a6c23f9` (production). Migraciones aplicadas hasta `0159`
  (`schema_migrations` top `20260701195010`). **Próxima libre `0160`** (re-verificar al autorar).
- ⚠️ Headers de `0150`/`0159` dicen "ENTREGADA, NO APLICADA" — texto histórico de autoría; **ambas
  están aplicadas en prod**. El estado real lo da `schema_migrations`.
- **Backlog vivo:** cada mensaje de prod desde F3.2B inserta una fila `pending` en `connect_outbox`
  que nadie consume. Contingencia interina mientras no haya GO: medición read-only periódica
  (`select count(*) from connect_outbox where status='pending'`) con umbral de escalamiento a
  Dirección (propuesto: >10.000 filas → autorizar drenaje anticipado).
- **Hallazgo operativo nuevo (verificación en vivo con `gh api`):** GitHub registra solo 5 workflows
  activos (caja-chica, clientify, compliance, contratos, supabase-backup). `knowledge-drain.yml`
  existe en el árbol local pero **NO en `origin/main`** (default branch, divergida en `3ea0de1`) →
  **el drain de Knowledge NO está corriendo programado hoy** y su cola puede estar acumulando
  backlog. Además el secret `APP_URL` que ese workflow usa **no existe** en GitHub (secrets reales:
  `CRON_SECRET`, `GCP_SA_KEY`, `GCS_BUCKET`, `SUPABASE_DB_URL`). Se reporta a Dirección como
  observación fuera de alcance F4.1 (afecta Knowledge E2.1), pero condiciona el diseño del
  scheduling de F4.1A (D-F41-9).
- Hoy **ninguna notificación se genera desde Connect**; el `NotificationCenter` agrupa por prioridad
  y filtra snooze en lectura, pero sin acciones. El ruteo de click (`hrefFor`,
  src/lib/notifications/data.ts:18-25) no contempla conversaciones connect, y `NotificationsBell`
  (src/components/shell/NotificationsBell.tsx:120) solo rutea `orders` — **una notificación de
  mención hoy no navegaría al hilo** (se corrige en F4.1B, §12).

## 7. Objetos existentes a reutilizar

| Objeto | Dónde | Rol en F4.1 |
|---|---|---|
| `connect_outbox` + índice dispatch | 0143:274-289 | Cola del worker (sin cambios de DDL) |
| `_connect_enqueue_message` | 0144:27-57 | Se extiende (misma aridad → CREATE OR REPLACE válido) para fan-out síncrono DM |
| `connect_message_mentions` | 0143:206-215 | Destino de menciones (sin cambios de DDL) |
| `connect_search_profiles` | 0158 | Picker de **delegación** (F4.1C) |
| `listParticipants` + `MemberSearch` (DEFECT-3) | src/lib/connect + `_components` | Autocomplete de **menciones** (solo miembros; refinamiento declarado vs Master Plan §3.2, la FK obliga) |
| `notifications` + A4 | 0004 + 0147 | Destino del fan-out; RPCs C operan sobre ella |
| `NotificationCenter` | src/app/(app)/connect/_components | Acciones nuevas (C) |
| `NotificationsBell` | **src/components/shell/NotificationsBell.tsx** | Ruteo connect (B) — corregida ubicación v1.1 |
| `hrefFor` | src/lib/notifications/data.ts:18-25 | Se extiende para entidades connect (B) |
| `useRealtimeTable` | src/lib/supabase/realtime.ts | Sin cambios |
| RPCs worker Knowledge (0133) + `drain.ts` | migs + src/lib/knowledge | Template del worker connect |
| `connect_set_title` | 0159 | Template de guarda de archivado (D) |
| `connect_join_channel` + `joinChannelAction` + rama "Unirme" de `ChannelView` | 0150 + channel-actions.ts + ChannelView.tsx:57-73 | F-1: reuso en `/c/[id]` |
| `structuredLog` / `knowledge_worker_runs` | src/lib/knowledge/observability.ts · 0133:96-111 | Observabilidad del worker (EOL) |

## 8. Gaps actuales (lo que NO existe y F4.1 construye)

1. Consumidor del outbox (RPCs + route + scheduling + telemetría) — entregable F1.4 nunca construido.
2. Escritura de menciones (RPC + trigger de notificación).
3. Parsing/autocomplete de `@` en composer (dominio `parseMentions` existe; UI no lo usa).
4. RPCs de acción sobre notificaciones + acciones de UI.
5. Fan-out DM→notificación con coalescing.
6. **Ruteo de notificaciones connect al hilo** (`hrefFor` + `NotificationsBell`) — sin esto el click
   no navega (hallazgo v1.1).
7. Guarda de archivado server-side en 15 RPCs (matriz §16).
8. Filtro de archivados en `listNotificationCenter` (R-2).
9. Affordance "Unirme" en `/connect/c/[id]` (F-1).
10. (Condicional SEC-1+ADR) Fallback de lectura admin (F-3).
11. Kit de validación SQL read-only para RPCs connect (incluye casos de supervivencia P-1).
12. Mecanismo de scheduling de crons que no dependa de la rama default divergida (D-F41-9).

## 9. Diseño propuesto

**Principio rector: modelo híbrido del spec (A4/NOTIF-1, spec:777).** Nota de supersesión: el §9 del
Master Plan citaba el pasaje obsoleto del spec (§~2564, "DECISIÓN PENDIENTE") ya resuelto por A4;
la aprobación de D-F41-1 **supersede formalmente ese punto del Master Plan** (dejar constancia en el
run log; la ruta canónica es `/api/connect/cron/dispatch-outbox` según spec:777 — el Master Plan
decía `/api/connect/drain`; renombre declarado, sin impacto). No requiere ADR: es fidelidad al spec.

- **Síncrono acotado (en trigger):**
  - *Menciones:* trigger `AFTER INSERT` sobre `connect_message_mentions` → `notifications`
    (kind `connect_mention`, priority `high`, **`entity='connect'` + `entity_id=conversation_id`**,
    alineado a spec:776; título con autor y canal; **sin contenido del mensaje** — anti-PII).
  - *DM 1:1:* extensión de `_connect_enqueue_message` (misma aridad, CREATE OR REPLACE válido) → si
    la conversación es `dm`, notifica a la contraparte (kind `connect_message`, priority `normal`)
    con **coalescing**: no inserta si ya existe una no-leída del mismo `entity_id` para ese usuario.
- **Diferido (worker):** drena `connect_outbox`; en F4.1 su procesamiento es marcar y gobernar
  (backlog→processed, reintentos, dead-letter, telemetría, retención). Superficie OCP para
  F4.2/F4.4.
- **Ruteo:** `hrefFor` mapea `entity='connect'` → `/connect/c/${entity_id}`; `NotificationsBell`
  unifica su ruteo con `hrefFor` (hoy hard-codea orders).
- **Capas TS** y **seguridad transversal**: igual que v1.0 (P-1, H-E1-1, SECDEF, `isMock()`).

### Decisiones de diseño a confirmar por Dirección (D-F41)

| ID | Decisión propuesta |
|---|---|
| D-F41-1 | Fan-out híbrido según spec:777 (supersede Master Plan §9, ver nota) |
| D-F41-2 | Coalescing DM: máx. 1 notificación no-leída por conversación/usuario |
| D-F41-3 | Canales: sin notificación por mensaje (solo menciones); no-leídos = bandeja/Home |
| D-F41-4 | Menciones solo a miembros (la FK lo fuerza) |
| D-F41-5 | **Matriz de archivado por RPC (§16): 15 con guarda / 5 exentas-por-diseño** — confirmar cada exención |
| D-F41-6 | **F-3 = resolución formal de SEC-1** (spec:1984). Opciones: (a) mantener spec (admin se agrega como miembro; sin mig) — **recomendada por defecto**; (b) fallback `is_admin()` SOLO SELECT acotado a `channel`/`group` **público**, con registro de lectura en `audit_log`, vía ADR-CONNECT-ADMIN-READ + mig `0164`; (c) vista DEFINER de auditoría (diseño mayor, post-F4.1) |
| D-F41-7 | Retención outbox: prune de `processed` > 30 días |
| D-F41-8 | Backlog histórico → `processed` sin efectos retroactivos |
| D-F41-9 | **Scheduling del worker**: (a) push del workflow a `main` (requiere autorización de push + convivir con la divergencia de `main` — hoy NO viable); (b) **Netlify Scheduled Function** (viaja con el deploy CLI, no depende de GitHub — **recomendada**); (c) cron externo invocando el route con `CRON_SECRET` |
| D-F41-10 | Snooze por filtro de lectura (desviación declarada de A4:2972, que preveía re-emisión por cron; el worker puede re-marcar al vencer si Dirección prefiere fidelidad literal) |

## 10. Migraciones estimadas (desde `0160` — re-verificar numeración al autorar)

| Mig | Contenido | Subetapa |
|---|---|---|
| `0160_connect_outbox_worker.sql` | RPCs `connect_claim_batch` / `connect_mark_processed` / `connect_mark_failed` / `connect_recover_stuck` / `record_connect_worker_run` (espejo 0133, P-1, H-E1-1 service_role-only) + `connect_worker_runs` + retención | A |
| `0161_connect_mentions_fanout.sql` | **`DROP FUNCTION connect_post_message(uuid,text,uuid,text,uuid[])` + CREATE con firma nueva (+`p_mentions uuid[] default null`) + re-aplicar revoke/grant, en una transacción** (ver §11) + trigger `AFTER INSERT` en `connect_message_mentions` → `notifications` + extensión `_connect_enqueue_message` (fan-out DM con coalescing) | B |
| `0162_connect_notification_actions.sql` | RPCs `connect_notif_snooze` / `connect_notif_delegate` (**+fila de auditoría en `audit_log`**, A4:2972) / `connect_notif_set_priority` — SECDEF, guard de propiedad NULL-safe | C |
| `0163_connect_archived_guards.sql` | Helper `_connect_assert_not_archived(p_conversation_id)` + reemplazo de las **15 RPCs** de §16. **Base de cada cuerpo = versión VIGENTE en prod: `0151` para add/remove_member, set_member_role, set_topic, pin, unpin; `0150` para join_channel; `0144` para el resto** (jamás regresar los guards P-1 de 0151) | D (R-3) |
| `0164_connect_admin_read_rls.sql` **(condicional: SOLO si D-F41-6 = opción b, con ADR aprobado)** | DROP/CREATE de 4 policies SELECT (`connect_messages`, `connect_attachments`, `connect_pinned`, `connect_conversation_links`) con fallback acotado + registro de lectura | D (F-3) |

**Desvío declarado vs Master Plan §10:** el rango crece de ~`0160`–`0162` a `0160`–`0163`(+`0164`)
por R-3 ampliado y F-3; la estimación de F4.2 se corre a ~`0164`/`0165`+.
Todas idempotentes, entregadas-NO-aplicadas (G3), con kit SQL y rollback documentado.

## 11. RPCs nuevas o a extender

**Nuevas (worker, service_role only):** `connect_claim_batch`, `connect_mark_processed`,
`connect_mark_failed`, `connect_recover_stuck`, `record_connect_worker_run`.
**Nuevas (usuario, authenticated con guard de propiedad):** `connect_notif_snooze`,
`connect_notif_delegate` (audita), `connect_notif_set_priority`.
**Firma reemplazada (DROP + CREATE, hallazgo crítico v1.1):** `connect_post_message` — la firma
vigente es `(uuid, text, uuid, text, uuid[])` (0144:130-187); agregar `p_mentions` por
`CREATE OR REPLACE` crearía una **segunda función sobrecargada** y PostgREST fallaría con error 300
(ambigüedad) rompiendo la RPC más usada de Connect en el instante del apply. Procedimiento: DROP de
la firma vieja + CREATE de la nueva (con `p_mentions uuid[] default null`) + re-aplicar revoke/grant,
misma transacción. El adapter actual llama con parámetros nombrados → sigue resolviendo a la única
función nueva (default cubre `p_mentions`) **sin necesidad de deploy simultáneo**.
**Extendidas (misma aridad, CREATE OR REPLACE):** `_connect_enqueue_message` (+rama DM) y las 15
RPCs de §16 (+guarda). **Comportamiento previo intacto SOLO para conversaciones no archivadas; sobre
archivadas pasan a rechazar — cambio deliberado (D-F41-5), no un no-cambio.**
**Sin cambios:** `connect_set_title`, `connect_search_profiles`, búsqueda, `connect_search`.

## 12. Cambios frontend previstos

- **Composer (`ThreadView`):** autocomplete `@` con **miembros** (`listParticipants`/`MemberSearch`;
  refinamiento declarado vs Master Plan §3.2 — 0158 queda para delegación), chips, `mentions[]` en la
  action, highlight en mensajes.
- **Ruteo de notificaciones (nuevo en v1.1):** `hrefFor` (data.ts:18-25) mapea `entity='connect'` →
  `/connect/c/${entity_id}`; `NotificationsBell.tsx:120` deja de hard-codear orders y reusa `hrefFor`.
- **`NotificationCenter`:** marcar leída (existe) + snooze (presets) + delegar (picker 0158) +
  prioridad; sección "Delegadas a mí".
- **`src/lib/notifications/data.ts`:** lectura incluye delegadas; fix R-2.
- **`/connect/c/[id]`:** rama "Unirme" para canal público no-miembro no-admin (F-1).
- **Worker TS:** `src/lib/connect/worker/dispatch.ts` + route `/api/connect/cron/dispatch-outbox` +
  scheduling según D-F41-9 (si Netlify Scheduled Function: función programada en el mismo deploy).
- Sin cambios en Sidebar/Home/realtime hook.

## 13. Worker / fan-out del outbox (F4.1A — detalle)

- **Route:** `POST /api/connect/cron/dispatch-outbox` — `CRON_SECRET` timing-safe fail-closed;
  parámetros `dry`, `maxBatches`, `batchSize`.
- **Loop:** `recover_stuck` → `claim_batch(limit, lease 5min)` → por `topic` (F4.1: gobierno/no-op) →
  `mark_processed`/`mark_failed` (backoff 1/2/4 min, dead@3) → `record_connect_worker_run`
  (telemetría EOL) → prune (D-F41-7).
- **Scheduling (D-F41-9 — corregido en v1.1):** GH Actions NO es viable hoy (cron solo corre desde
  la default branch `main`, divergida; el secret de URL ni existe). **Recomendación: Netlify
  Scheduled Function** cada 5 min — se define en el repo, viaja con el deploy CLI manual (mismo
  pipeline validado), no toca GitHub ni `main`. Alternativas: cron externo o (futuro, post
  reconciliación de `main`) GH Actions.
- **Backlog inicial:** primera corrida procesa el histórico como `processed` sin efectos (D-F41-8);
  dry-run previo con conteo esperado; reporte en run log.
- **Idempotencia:** claim exclusivo + estados terminales; las notificaciones sync no pasan por acá.

## 14. Menciones end-to-end (F4.1B — detalle)

Composer detecta `@` → autocomplete de miembros → `mentions[]` (profile ids) → `postMessageAction` →
use case (dominio `parseMentions`, dedupe, límite 20, sin auto-mención) → `connect_post_message`
(firma nueva) resuelve profile→participant, valida membresía NULL-safe, inserta mensaje + menciones →
trigger sobre `connect_message_mentions` → `notifications` (`connect_mention`, high,
`entity='connect'`, sin contenido) → llega por la suscripción realtime existente → **click navega a
`/connect/c/[conversation_id]` gracias al ruteo nuevo de §12** (sin ese cambio, hoy caería en
`/connect/notificaciones`). Render: highlight de `@nombre` en el hilo.

## 15. Notificaciones avanzadas (F4.1C — detalle)

- **Snooze:** `remind_at` futuro; lectura ya lo oculta hasta vencer; presets UI. **Desviación
  declarada de A4** (D-F41-10): A4:2972 preveía que el cron re-emite/re-marca al vencer; F4.1 usa el
  filtro de lectura existente (más simple, mismo efecto visible). Si Dirección prefiere fidelidad
  literal, el worker re-marca al vencer (+0.5 d).
- **Delegar:** `delegated_to`; visible para el delegado (cambio de lectura); **registra fila de
  auditoría en `audit_log`** (exigencia A4:2972); re-delegar solo dueño o delegado actual; picker 0158.
- **Prioridad:** cambia `priority` de una notificación propia.
- **Origen de prioridades:** menciones=high, DM=normal (urgent reservado a incidentes F4.2).
- Guards de propiedad NULL-safe; errores accionables (lección DEFECT-4).
- El fan-out síncrono DM (SQL) se entrega en F4.1B/0161; F4.1C es acciones + lectura (consistencia
  §3/§10/§26 corregida en v1.1).

## 16. Higiene F3 incluida (F4.1D — detalle)

- **R-2:** `src/lib/notifications/data.ts:49-52` — la query sobre `v_connect_inbox`
  (`.gt('unread_count',0)`) no filtra archivados → agregar `.is("archived_at", null)`. La vista
  expone `archived_at` **desde 0145** (0145:26; 0159 se la agregó a `v_connect_channels` — cita
  corregida en v1.1).
- **R-3 (matriz completa v1.1 — decisión D-F41-5):**

  **CON guarda (15):** `connect_post_message` (0144:130-187), `connect_edit_message` (0144:190-213),
  `connect_react` (0144:238-256), `connect_unreact` (0144:258-271), `connect_flag_message`
  (0144:522-538), `connect_unflag_message` (0144:540-549), `connect_link_entity` /
  `connect_unlink_entity` (0144:382-437), `connect_add_member` (**0151:17**), `connect_remove_member`
  (**0151:38**), `connect_set_member_role` (**0151:59**), `connect_set_topic` (**0151:97**),
  `connect_pin_message` (**0151:115**), `connect_unpin_message` (**0151:136**), `connect_join_channel`
  (**0150** — hoy permite unirse a un canal público archivado).

  **EXENTAS por diseño (5, confirmar en D-F41-5):** `connect_mark_read` y `connect_toggle_favorite`
  (estado por-usuario; operar sobre archivados es legítimo), `connect_delete_message` (moderación
  debe poder actuar sobre archivados), `connect_archive_conversation`/unarchive (obvio),
  `connect_set_title` (ya tiene guarda, 0159).

  **Regla de oro (hallazgo crítico v1.1):** los cuerpos base para `0163` son los **VIGENTES en
  prod** — 0151 para las 6 de moderación (guards fail-closed P-1), 0150 para join, 0144 para el
  resto. Partir de 0144 en las de moderación **regresionaría RC12-008** (escalada corregida). El kit
  SQL incluye casos "actor no-miembro (rol NULL) → deniega" para TODAS las reemplazadas, y la
  revisión adversarial verifica el diff cuerpo-vigente→0163.
- **F-1 (acotado):** "Unirme" ya existe en `/connect/canales/[slug]` (0150/RC1.2); el residual es
  `/connect/c/[id]`. Fix: rama de join para canal público (reuso `joinChannelAction`).
- **F-3 (condicional — reformulado en v1.1):** el spec decidió explícitamente NO tener fallback
  blanket de admin (spec:610; SEC-1 spec:1984 = "DECISIÓN PENDIENTE de Dirección/Compliance" con
  mecanismo sugerido = vista DEFINER auditada o rol auditor). La v1.0 de este plan recomendaba lo
  contrario sin declararlo — corregido. **Recomendación v1.1 = opción (a) de D-F41-6: mantener el
  spec (el admin se agrega como miembro cuando necesita ver; sin migración).** Si Dirección quiere el
  fallback, es la opción (b): ADR-CONNECT-ADMIN-READ + `0164` acotada a channel/group **público** +
  registro de lectura en `audit_log`. Nunca DM/privados por policy.

## 17. Riesgos

| ID | Riesgo | Mitigación |
|---|---|---|
| R-F41-1 | Fatiga de notificaciones | D-F41-2/3; piloto mide notifs/usuario/día antes de ampliar |
| R-F41-2 | Doble entrega o pérdida en fan-out | Sync en la transacción del mensaje; worker con claim exclusivo + dead-letter + telemetría |
| R-F41-3 | Backlog histórico dispara efectos retroactivos | D-F41-8: drenaje no-op, dry-run validado |
| R-F41-4 | **Regresión de `connect_post_message` por cambio de firma** | DROP+CREATE transaccional + re-grants; adapter con named-params verificado compatible; caso PostgREST en kit SQL; smoke inmediato post-apply |
| R-F41-5 | **Regresión del hardening 0151 al reemplazar cuerpos** | Regla de oro §16 (base = cuerpo vigente); kit SQL P-1; diff obligatorio en revisión adversarial |
| R-F41-6 | Guarda de archivado rompe flujos legítimos | Matriz D-F41-5 explícita con exenciones deliberadas |
| R-F41-7 | Cron/scheduling no corre (lección knowledge-drain inactivo) | D-F41-9 resuelto ANTES de construir; smoke post-deploy verifica ejecución real programada + `connect_worker_runs` |
| R-F41-8 | F-3 abre lectura admin de privados | Recomendación = opción (a) sin cambio; (b) solo con ADR + acotado a público + audit |
| R-F41-9 | Deploy | Solo procedimiento validado (Node 22 + NO-worktree + draft-first) |

## 18. Seguridad

- RPCs worker: revoke public/anon/authenticated + grant service_role (H-E1-1, template 0133:143-150).
- RPCs usuario (notif_*): guard interno de propiedad NULL-safe; sin exposición de emails.
- Payloads de notificación sin PII ni contenido de mensajes.
- Route del cron: server-only, fail-closed, sin loguear secrets (G9).
- `connect_post_message` nueva firma: re-aplicar revoke/grant explícitos tras el DROP+CREATE.
- Delegación auditada en `audit_log` (sink único).
- Ninguna superficie externa nueva; sin cambios RBAC/`RBAC_ENFORCE`.
- P-1 en todo guard nuevo Y verificación de que los guards existentes (0151) sobreviven a 0163.

## 19. RLS / RBAC

- **Sin permisos nuevos**: `connect.view`/`connect.create` cubren F4.1 (matriz 0146+0155 verificada:
  los 9 roles del piloto tienen ambos).
- `connect_worker_runs`: RLS select-only `has_permission('connect.view')`; escritura solo RPC
  service_role.
- `notifications`: sin cambios de policies.
- Única alteración de policies posible = `0164` (condicional D-F41-6 opción b, con ADR).

## 20. Plan de TDD

- **Dominio (puro, primero):** coalescing DM; menciones (límite 20, dedupe, auto-mención); reglas
  snooze/delegación; matriz archivado×acción (las 15+5).
- **Application (FakeWritePort):** `PostMessageUseCase` con menciones (ok / no-miembro / >20 /
  archivado); use cases de notif (propiedad, NULL-safe); `DispatchOutboxUseCase` (claim→process→mark,
  retry→dead, dry-run, backlog no-op).
- **Read layer:** `listNotificationCenter` (excluye archivados; incluye delegadas); `hrefFor` con
  `entity='connect'`.
- **SQL (kit read-only, nuevo):** por RPC nueva/reemplazada — actor anon/authenticated/service_role,
  no-miembro (**supervivencia P-1 post-0163**), archivado, resolución PostgREST de la firma nueva de
  `post_message`, idempotencia de re-run.
- Test rojo antes del código en el núcleo; no bajar el conteo base (~385 + ~118 connect).

## 21. Plan de QA

Gates por subetapa y al cierre: `typecheck` 0 · `lint` 0 · vitest ≥ base · `build` OK (Node 22).
**Kit SQL:** casos no-mutantes = read-only contra prod (único entorno; no existe staging — G4);
casos mutantes = SOLO dentro de la ventana de apply autorizada, con checkpoints y rollback
(patrón F3.2B C1-C11). QA manual guiado: mención→campana→click→**hilo** (ruteo nuevo); DM→coalescing;
snooze/delegación (con fila de audit) /prioridad; escritura a archivado rechazada con mensaje
accionable; join desde `/c/[id]`.
**Piloto (nuevo en v1.1):** al deploy, anuncio a los usuarios del piloto en un canal de Connect +
mini-guía (mención, snooze, delegación) + canal de feedback con plazo (1 semana) y métrica de fatiga
(notifs/usuario/día) que alimenta D-F41-2/3.

## 22. Revisión adversarial

Al cierre de cada subetapa: revisión multi-dimensión (correctness, seguridad/P-1/H-E1-1, RLS,
regresión) con verificación adversarial; **0 critical / 0 important** para avanzar. **Checklist
obligatorio v1.1:** diff cuerpo-vigente-en-prod → cuerpo-0163 por cada RPC reemplazada (anti-regresión
0151); resolución PostgREST de `connect_post_message`; ruteo de notificación end-to-end. Al cierre
del bloque: whole-branch review + Engineering Readiness Review. Este plan ya pasó una ronda (v1.1 =
22 hallazgos incorporados: 3 critical, 7 important, 12 minor).

## 23. Smoke plan (post-apply + post-deploy, ventana autorizada)

1. Apply `0160`–`0163` (+`0164` si D-F41-6=b) en orden, checkpoint SQL tras cada una: objetos,
   grants/revokes, re-run idempotente, **una sola `connect_post_message` en catálogo** (firma nueva),
   guards P-1 vigentes (caso no-miembro deniega).
2. Backlog: dry-run del worker (conteo esperado) → corrida real → `connect_worker_runs` registra;
   sin `pending` vencidos.
3. Cron negativo: sin/mal `CRON_SECRET` → 401/403, 0 efectos. Cron positivo: **verificar ejecución
   programada real** del mecanismo D-F41-9 (lección knowledge-drain).
4. Deploy draft-first: 0 5xx; `/api/version` correcto.
5. Funcional autenticado: mención→notificación high→**click navega al hilo**; DM coalescing;
   snooze/delegar (audit visible)/prioridad; R-2; R-3 (RPC directa a archivado → excepción; matriz
   muestral); F-1; F-3 solo si aplica.
6. Regresión: post/edit/react/pin/moderación/búsqueda/archivar/renombrar intactos.

## 24. Rollback

- **Migs:** `ROLLBACK_0160_0164.md` con: drops de RPCs worker + `connect_worker_runs` + trigger de
  menciones; **restauración de `connect_post_message` firma 5-args (cuerpo 0144 vigente) dropeando la
  6-args**; restauración de los cuerpos vigentes pre-0163 (0151/0150/0144 según RPC, guardados
  textualmente en el archivo de rollback); restauración de las 4 policies si hubo `0164`.
  `connect_outbox` y datos no se tocan.
- **Worker:** deshabilitar según mecanismo D-F41-9 (Netlify Scheduled Function → re-deploy del
  artefacto previo la quita; cron externo → apagarlo); el route sin scheduler es inerte.
- **Deploy:** re-publish del deploy previo (1-click, procedimiento F3).
- **Notificaciones emitidas:** no se borran; el rollback detiene emisión.

## 25. Criterios GO / NO GO

**GO para implementar F4.1 (todos requeridos):**
1. Este plan v1.1 aprobado por Dirección (G7).
2. **Las 10 decisiones D-F41-1..10 resueltas.** D-F41-6 admite resolución "(a) mantener spec" (se
   omite `0164`) sin bloquear el resto; **cualquier D-F41 sin resolver = NO GO**.
3. **Mecanismo de scheduling (D-F41-9) definido y autorizado** — sin esto el worker nacería muerto
   (lección knowledge-drain).
4. Worktree dedicado nuevo desde `a6c23f9` (tip actual `b5219cb`).
5. `0160` re-verificada libre (`ls supabase/migrations` + `schema_migrations` en vivo).
6. `CRON_SECRET` confirmado vigente y accesible para el mecanismo elegido.

**NO GO / STOP:** tocar prod fuera de la ventana final autorizada; desviación de spec/dossier sin
ADR; scope nuevo no listado; cambio del estado verificado de prod/`main`.

## 26. Subetapas sugeridas

- **F4.1A — Outbox/worker** (mig 0160 + worker TS + route + scheduling D-F41-9 + backlog +
  telemetría) — ~3–4 d.
- **F4.1B — Menciones + fan-out síncrono** (mig 0161: post_message DROP+CREATE, trigger de mención,
  DM coalescing + composer + highlight + **ruteo hrefFor/Bell**) — ~3–4 d.
- **F4.1C — Acciones de notificación** (mig 0162 + snooze/delegar-con-audit/prioridad + delegadas en
  lectura + UI) — ~2–3 d.
- **F4.1D — Higiene F3** (mig 0163 matriz 15 RPCs + R-2 + F-1; `0164` solo si D-F41-6=b) — ~2–3 d.
- **Transversal:** ADR-TASKS (docs-only, no bloquea A–D) + kit SQL (crece con cada subetapa).

## 27. Recomendación de secuencia

**A → B → C → D**, desarrollo continuo en un único worktree con commit local por subetapa (gates +
revisión adversarial por subetapa), y **UNA sola ventana de apply+deploy al cierre del bloque**
(migs `0160`–`0163`[+`0164`] juntas, orden numérico, patrón F3.2B con checkpoints) seguida del piloto
integral con el plan de comunicación de §21. Alternativa: ventana intermedia tras A+D y segunda para
B+C (más costo operativo, menor riesgo por paso). **Recomendada: ventana única.**

Esfuerzo total F4.1: **~10–14 días-dev** (desvíos declarados vs Master Plan: esfuerzo 8–12→10–14;
migs 0160–0162→0160–0163+0164 condicional; R-3 1→15 RPCs; autocomplete de menciones por
`listParticipants`; ruta del worker renombrada; ADR-TASKS incluido como transversal).

## 28. Confirmación de no-implementación

En esta etapa **NO se implementó nada**: cero código de producto, cero migraciones creadas o
aplicadas, cero cambios en DB/RBAC/env/policies, cero deploy, cero push, cero merge. Producción
intacta (`a6c23f9`). Artefactos de la etapa: el commit docs-only autorizado del Master Plan
(`b5219cb`) y este documento (sin commitear, a la espera de aprobación). Todo el relevamiento y la
verificación adversarial fueron read-only (la verificación usó además `gh api` de solo-lectura para
constatar el estado real de workflows/secrets en GitHub).

---

**Próximo paso:** decisión de Dirección — aprobar este plan v1.1 + resolver D-F41-1..10 → recién
entonces autorizar implementación F4.1. Hasta entonces, STOP.

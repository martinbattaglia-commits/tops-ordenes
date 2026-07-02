# F4.1 · Fundación Colaborativa — Validation Pack (kit SQL · smoke · rollback · GO/NO-GO)

> Para la FUTURA ventana de apply/deploy (requiere autorización expresa de Dirección, D-F41-10).
> Estado actual: TODO local (`feat/connect-f4-1-collaboration-foundation`); prod intacta `a6c23f9`.

## 1. Runbook de la ventana (D-F41-10 · ventana ÚNICA)

1. **Pre-flight:** re-verificar `/api/version`=commit esperado de prod; `schema_migrations` top
   = `0159`-equivalente; `0160` libre; `CRON_SECRET` vigente en Netlify env; branch limpia.
2. **Apply (Martín, SQL Editor, un batch por archivo, orden numérico):** `0160` → checkpoint C1 →
   `0161` (batch ÚNICO, atómico) → C2 → `0162` → C3 → `0163` → C4. Checkpoints abajo (§2).
3. **Deploy inmediato en la MISMA ventana** (minimiza la degradación transitoria documentada:
   entre apply y deploy los DM ya notifican pero el Bell viejo rutea a `#`):
   checkout NO-worktree + Node 22.23.1 + `netlify deploy --build` (draft) → smoke draft → `--prod`.
4. **Smoke post-deploy** (§3) + drenaje del backlog (§4) + evidencia de scheduling (§5).
5. **Piloto** (§6). Rollback si algo crítico: §7.

## 2. Kit SQL de validación (checkpoints del apply)

**C1 (post-0160):**
```sql
-- Objetos y grants del worker
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where proname like 'connect_%' and proname in
 ('connect_claim_batch','connect_mark_processed','connect_mark_failed',
  'connect_recover_stuck','connect_prune_outbox','connect_record_worker_run');
select has_function_privilege('authenticated','public.connect_claim_batch(int, interval)','execute'); -- f
select relrowsecurity from pg_class where relname='connect_worker_runs';                               -- t
```
**C2 (post-0161) — anti-PostgREST-300 (D-F41-4):**
```sql
-- EXACTAMENTE UNA connect_post_message (6 args con default):
select count(*) from pg_proc where proname='connect_post_message';                                    -- 1
select pg_get_function_identity_arguments(oid) from pg_proc where proname='connect_post_message';
-- Triggers vivos:
select tgname from pg_trigger where tgname in ('trg_connect_messages_enqueue','trg_connect_mentions_notify');
-- Re-run de 0161 completo = mismo estado (idempotencia).
```
**C3 (post-0162):**
```sql
select polname, pg_get_expr(polqual, polrelid) from pg_policy
 where polrelid='public.notifications'::regclass;               -- select/update incluyen delegated_to
-- Grant POR COLUMNA (hallazgo crítico): UPDATE solo read_at/remind_at para authenticated
select column_name from information_schema.column_privileges
 where table_name='notifications' and grantee='authenticated' and privilege_type='UPDATE';
--  → exactamente: read_at, remind_at
select has_function_privilege('authenticated','public.connect_notif_delegate(uuid, uuid)','execute'); -- t
```
**C4 (post-0163) — anti-regresión 0151 (P-1) + guarda:**
```sql
-- Guard NULL-safe sobrevive (muestra de una función endurecida por 0151):
select prosrc like '%v_my_role is null%' from pg_proc where proname='connect_add_member';             -- t
-- Guarda de archivado presente en las 14:
select count(*) from pg_proc p
 where proname in ('connect_edit_message','connect_react','connect_unreact','connect_flag_message',
   'connect_unflag_message','connect_link_entity','connect_unlink_entity','connect_add_member',
   'connect_remove_member','connect_set_member_role','connect_set_topic','connect_pin_message',
   'connect_unpin_message','connect_join_channel')
   and prosrc like '%_connect_assert_not_archived%';                                                  -- 14
```
**Casos mutantes** (solo en ventana, con datos de prueba efímeros + rollback de datos):
actor no-miembro → deniega (P-1) en add_member/set_topic/pin; post a conversación archivada →
`check_violation`; mención a no-miembro → ignorada en silencio; delegar a usuario no-staff →
`check_violation` + SIN fila audit; delegar válido → fila `audit_log` action
`connect.notification.delegate`; UPDATE directo de `delegated_to`/`title` como authenticated →
**denegado por privilegios de columna**.

## 3. Smoke post-deploy

0 5xx en rutas core + `/connect*`; `/api/version` correcto. Funcional autenticado:
mención → campana high → **click navega al hilo**; DM → 1 notif (coalescing: 2º mensaje sin leer
NO duplica); snooze (desaparece de Centro **y Bell**, reaparece al vencer); delegar (audit +
visible al delegado + chip); prioridad; R-2 (archivado con no-leídos no cuenta); R-3 (RPC directa
a archivado → error claro); F-1 (canal público por `/c/[id]` → "Unirme" → hilo). Regresión:
post/edit/react/pin/moderación/búsqueda/archivar/renombrar intactos.

## 4. Backlog de connect_outbox (D-F41-3, conteos antes/después)

1. `GET /api/connect/cron/dispatch-outbox?dry=1` (Bearer CRON_SECRET) → registra corrida `dry`
   con `pending_remaining` = **conteo ANTES** (persiste en `connect_worker_runs`).
2. Corridas reales repetidas `?maxBatches=3` hasta `pending_remaining=0` (cada corrida ~8s,
   dimensionada al timeout de Netlify; el backlog completo puede requerir varias invocaciones).
3. Verificar: `select status, count(*) from connect_outbox group by 1` → sin `pending` vencidos;
   `connect_worker_runs` con `skipped` = drenado sin efectos (CERO notificaciones históricas).

## 5. Evidencia de scheduling (D-F41-9, exigida antes de cerrar F4.1)

- Ejecución manual: respuesta 200 del route con Bearer + corrida en `connect_worker_runs`.
- Negativo: sin/mal secret → 401; sin CRON_SECRET configurado → 503 (fail-closed estricto).
- **Programada real:** tras el deploy, esperar ≥10 min y verificar ≥2 corridas nuevas en
  `connect_worker_runs` (cadencia */5) + logs de la function en Netlify (`connect-dispatch-outbox`).
- Idempotencia: corrida sobre cola vacía = `claimed 0`, sin efectos.

## 6. Piloto (comunicación)

Al deploy: anuncio en un canal de Connect a los usuarios del piloto + mini-guía (mencionar con @,
posponer, delegar, prioridad) + canal de feedback 1 semana. Métrica anti-fatiga: notifs/usuario/día
(consulta sobre `notifications`), alimenta el ajuste de D-F41-2/3.

## 7. Rollback

`supabase/migrations/ROLLBACK_0160_0163.md` (restauración por fuentes vigentes, orden 0163→0160,
irreversibles declarados). Deploy: re-publish del deploy previo (1-click). Rollback point de deploy
a registrar en la ventana.

## 8. Riesgos remanentes (aceptados/documentados)

| # | Riesgo | Estado |
|---|---|---|
| 1 | Carrera improbable del coalescing DM (2 notifs en concurrencia exacta) | Aceptado (best-effort; sin unique parcial) |
| 2 | Mención dentro de un DM en el MISMO mensaje → mención high + DM normal (2 avisos por 1 mensaje) | Residual; lo mide el piloto (R-F41-1) |
| 3 | Degradación transitoria apply→deploy (DM notifican con ruteo viejo `#`) | Mitigada: ventana única, deploy inmediato post-apply |
| 4 | Backlog grande requiere varias corridas manuales | Documentado (§4); schedule converge solo |
| 5 | Evidencia de scheduling programado solo verificable post-deploy | Criterio de cierre de la ventana (§5) |
| 6 | Admin no-miembro sigue sin leer hilos (SEC-1, por diseño) | Decisión D-F41-6 (sin cambio) |

## 9. GO / NO-GO para la ventana de apply/deploy

**GO si:** paquete local aprobado por Dirección + ventana autorizada por ítem (apply 0160-0163 +
deploy) + pre-flight §1.1 verde + `CRON_SECRET` confirmado + toolchain Node 22/NO-worktree/draft-first.
**NO-GO / ABORT si:** cualquier checkpoint C1-C4 falla (abortar y NO continuar con la siguiente
mig; evaluar rollback parcial según §7) · prod cambió respecto de lo verificado · draft con 5xx.
**Cierre de F4.1** exige además: smoke §3 verde + backlog §4 drenado + evidencia §5 + piloto §6
iniciado + informe de ventana.

---

# RESULTADO DE LA VENTANA (2026-07-01, 22:54–23:3xZ) — registro

- **Apply:** 0160/0161/0162/0163 = 4/4 success (22:57–23:06Z); `schema_migrations` top
  `20260701230222`, 4 nombradas. `0164` NO creada/aplicada.
- **C1–C4:** PASS (ver Execution Log Apéndice C — funcionales con rollback: compat 5-args,
  mención+notif+coalescing, DM end-to-end, anti-forja 3/3 denegadas, guardas archivado,
  P-1/0151 vivo, exentas OK, archive/search intactos).
- **DRAFT 1** `6a459cfdfbd0cf7f70371dbb` (080cbe3) → detectó middleware sin allowlist del worker
  (401 con Bearer válido) → fix `8c44003` → **DRAFT 2** `6a459e03efd74590791f8c5d` PASS.
- **PROD:** deploy **`6a459f4e9a96c5ccaf9fc3f2`** commit **`8c44003`** (23:14–23:15Z). Smoke base
  PASS (version 8c44003, login 200, 5 rutas 307, worker 401 sin/mal secret, 0 5xx).
- **Rollback:** NO requerido. Rollback point previo: `6a45820a7b7b7de8d59c6160` (`a6c23f9`).
- **Worker manual:** positivo remoto NO verificable por el operador asistido (netlify env:get no
  entrega el valor runtime del secret — write-only). Aislamiento LOCAL con secret propio: 401/401
  negativos + dry=1 success con `pending_remaining=34` contra prod (read-only) → handler+RPCs OK.
  El positivo remoto manual queda en el checklist de Martín (tiene el secret real).
- **Scheduling:** ver sección de evidencia al final (ticks */5 post-deploy).

## Checklist smoke funcional autenticado (PENDIENTE — Martín, sin credenciales en sesión asistida)

1. Mención: en un canal, tipear `@` → autocomplete de miembros → enviar → el mencionado ve
   campana high "Te mencionaron en …" → click navega AL HILO. Verificar que el texto de la
   notificación NO incluye el contenido del mensaje.
2. Mención repetida al mismo usuario con la 1ª sin leer → NO genera 2ª notificación.
3. DM: primer mensaje → contraparte recibe 1 notif normal; 2º y 3º mensaje sin leer → sigue 1.
4. Snooze 1h/Mañana/1 semana → desaparece del CENTRO y del BELL; (opcional) verificar reaparición.
5. Delegar a otro usuario interno → el delegado la ve (chip "Delegada a mí"); en Administración/
   audit consta `connect.notification.delegate`. Delegar de vuelta al dueño la des-delega.
6. Prioridad: cambiar a Urgente → reordena a la sección Urgente.
7. Archivados: canal archivado con no-leídos NO cuenta en el Centro; intentar reaccionar/editar
   en archivado → error claro.
8. F-1: entrar por URL `/connect/c/<id>` a un canal público del que NO sos miembro (con un usuario
   no-admin) → pantalla "Unirme" → unirse → hilo visible.
9. SEC-1: admin NO-miembro de un canal → puede administrar pero el hilo se ve vacío (por diseño).
10. Worker manual (con el CRON_SECRET real):
    `curl -X POST -H "Authorization: Bearer <secret>" https://nexus.logisticatops.com/api/connect/cron/dispatch-outbox?dry=1`
    → `success:true` y conteo.

## Evidencia de scheduling — RESULTADO (23:57Z)

Schedule REGISTRADO en la plataforma (`searchSiteFunctions` → `*/5 * * * *`, tras el fix
declarativo `bef2f78`) pero **ejecución programada NO evidenciada** (ticks 23:40-23:55 sin
corridas; logs vacíos). **PENDIENTE BLOQUEANTE DE CIERRE F4.1** (mandato Etapa 10). Verificación
para Martín: dashboard Netlify → Functions → `connect-dispatch-outbox` (badge "Scheduled" / Next
run) y `select * from connect_worker_runs order by started_at desc` — si aparecen corridas */5,
el pendiente se cierra sin más cambios. Si no: decidir (b) cron externo o (c) Netlify Support.

---

# 🏁 CIERRE (2026-07-02)

**Smoke funcional autenticado: PASS por Dirección** (validación visual: composer + menciones +
notificaciones OK en prod `bef2f78`). El punto 10 del checklist (worker manual) queda absorbido
por la deuda OPS del scheduler. **Scheduler = deuda OPS no bloqueante**
(ver `F4-1-SCHEDULING-OPS-FINDING.md` §6). Rollback no requerido; producción no tocada en el
cierre. **F4.1 CERRADA FORMALMENTE.**

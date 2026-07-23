# F4.4 — VALIDATION PACK (runbook de ventana apply + deploy + activación)

> Ejecuta **Martín** en ventana autorizada por ítem (G1/G3). Nada de esto fue
> aplicado: migs `0171`–`0172` ENTREGADAS NO APLICADAS; código SIN deploy;
> workflow del outbox SIN push. Los ítems son SEPARABLES por riel.

## 0. Pre-flight (repetir EN EL MOMENTO — lección stale-GO del incidente Drive)

```bash
curl -s https://nexus.logisticatops.com/api/version   # commit esperado ANTES de la ventana
```
```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 1; -- 0170
select to_regclass('public.wa_inbound_events'), to_regclass('public.automation_rules');        -- null,null
```

## 1. Secrets/env (Netlify · acción exclusiva de Dirección · ANTES del deploy)

| Var | Acción |
|---|---|
| `META_WA_APP_SECRET` | ALTA (App Secret del panel Meta → Settings → Basic). Sin ella el webhook responde 503 a todo POST — si la WABA ya apunta a prod, setearla ANTES de deployar este código |
| `META_WA_WEBHOOK_VERIFY_TOKEN` | Confirmar que está seteada (el default hardcodeado se eliminó; sin ella el handshake GET devuelve 503) |
| `WHATSAPP_SANDBOX` | Opcional (default ON sin la var). NO setear "0" en F4.4 |
| `WHATSAPP_SANDBOX_ALLOWLIST` | Números internos E.164 coma-separados (ej. el de Dirección). ⚠️ **DEBE incluir el valor de `WHATSAPP_NOTIFY_DEFAULT`**: el sandbox ahora vive en el choke point (`meta.ts`) y también gobierna el aviso de OC firmada de compras — sin allowlistearlo, ese aviso deja de salir post-deploy |
| `WHATSAPP_SEND_SECRET` | Opcional: secreto dedicado de `/api/whatsapp/send` (separación de privilegios vs `CRON_SECRET`). Sin la var, se usa `CRON_SECRET` |
| `CRON_SECRET` | Ya existe y coincide con GH Actions (evidenciado E1) — NO tocar. La comparación del guard nuevo es EXACTA (raw), misma semántica que los guards previos |

Recordatorios: `netlify env:get` enmascara; env-only redeploy requiere
`--skip-functions-cache`; nunca imprimir valores.

## 2. Apply de migraciones (SQL Editor prod, en este orden)

1. `0171_wa_inbound_events.sql` — verificación: `select to_regclass('public.wa_inbound_events');` no nulo; `select count(*) from wa_inbound_events;` = 0.
2. `0172_connect_automations_mvp.sql` — verificación kit C:

```sql
-- C1: objetos
select to_regclass('public.automation_rules') rules, to_regclass('public.automation_runs') runs;
-- C2: seed R1 presente y habilitada
select key, topic, enabled from automation_rules;
-- C3: trigger colgado de connect_incidents
select tgname from pg_trigger where tgrelid = 'public.connect_incidents'::regclass and tgname = 'connect_incidents_enqueue_opened';
-- C4: RLS activo y deny-all de escritura (0 policies de write)
select relname, relrowsecurity from pg_class where relname in ('wa_inbound_events','automation_rules','automation_runs');
select polname, polcmd from pg_policy where polrelid in ('public.automation_rules'::regclass,'public.automation_runs'::regclass);
-- C5 (bajo rol authenticated real, patrón F4.2/F4.3): select a wa_inbound_events debe DENEGAR;
--    select a automation_rules/runs debe permitir solo con connect.view.
-- C6 (funcional 0-footprint, transacción con ROLLBACK): insertar un incidente severidad
--    'critica' vía connect_incident_open y verificar que aparece la fila en connect_outbox
--    topic 'connect.incident.opened' con payload {incident_id, public_id, severidad}. ROLLBACK.
begin;
  -- usar el guion funcional de F4.2 para abrir incidente de prueba __QA_ROLLBACK__
  -- select public.connect_incident_open(...);  -- según firma vigente 0165
  select topic, payload from connect_outbox order by seq desc limit 2;
rollback;
-- C7: outbox intacto (el backlog previo no cambió de estado)
select status, count(*) from connect_outbox group by status;
```

## 3. Deploy (D-F44-10 · procedimiento validado F4.1–F4.3)

Netlify manual: **Node 22 + checkout limpio NO-worktree + CLI pineada 26.0.2** →
DRAFT → smoke DRAFT → PROD → smoke PROD. No esperar schedules.

## 4. Smoke post-deploy

1. `/api/version` = commit F4.4 esperado; 12 rutas core 200/307; 0 5xx.
2. **Webhook WA**: `curl -X POST .../api/whatsapp/webhook -d '{}'` sin firma →
   **401** + fila en `audit_log` (`whatsapp_webhook`/`signature_rejected`);
   con `META_WA_APP_SECRET` ausente → 503 (no debería, si §1 se hizo).
   GET handshake con token real → 200 challenge.
3. **Crons endurecidos**: sin Bearer → 401 (`compliance/sync`,
   `comercial/contratos/sync`, `tesoreria/caja-chica/sync`,
   `clientify/sync-deals`, `whatsapp/send`); con Bearer válido → 200.
   **Verificar la corrida siguiente de los 5 GH Actions en verde** (regresión).
4. **Worker/outbox**: `workflow_dispatch` del nuevo workflow (cuando esté en
   `main`) o curl manual con Bearer → 200; backlog drena (`processed`/`skipped`);
   corrida visible en `connect_worker_runs`. **Gate cierre finding E1: ≥2
   corridas PROGRAMADAS.**
5. **R1**: abrir incidente de prueba severidad crítica → notificación `urgent`
   a rol admin visible en campana → fila `automation_runs` result `fired`;
   repetir re-entrega (re-disparar worker) → SIN duplicado (UNIQUE).
   Kill-switch: `update automation_rules set enabled=false…` → siguiente evento
   no dispara. Limpiar incidente de prueba.
6. **Email**: con dominio Resend verificado (acción Dirección) crear OS de
   prueba → `email_sends.status='sent'` + recepción; si aún falla → DEBE
   aparecer la notificación "Email de orden FALLÓ" (fin del silencio).
7. **WhatsApp sandbox**: `POST /api/whatsapp/send` con Bearer a número FUERA de
   la allowlist → 403 + audit; a número interno allowlisted → template recibido;
   status de Meta persiste en `wa_inbound_events` (ciclo completo del spike).
8. **Regresiones F4.1/F4.2/F4.3**: smoke corto 5 puntos (mensaje + mención,
   incidente ciclo, tarea/claim, cockpit, notifs→detalle).

## 5. Activación del scheduler (aparte, decisión Dirección)

Llevar `.github/workflows/connect-dispatch-outbox.yml` a la default branch
(`main` está divergida — opciones: cherry-pick del archivo solo, o commit
directo a main vía UI de GitHub). Sin esto el outbox sigue drenándose solo
on-demand.

## 6. Rollback

`supabase/migrations/ROLLBACK_0171_0172.md` (kill-switch primero; drops limpios;
el código tolera tablas ausentes) + redeploy del deploy anterior (point actual:
`8a4b7bb`).

## 7. GO/NO-GO de la ventana

**GO** si: pre-flight §0 coincide, secrets §1 seteados, C1–C7 PASS, smoke §4
completo sin rojos. **NO-GO/STOP** si: `/api/version` inesperado en el momento,
cualquier GH Action de sync falla post-hardening (revert guard = 1 hunk), o el
handshake/HMAC de Meta no valida con la WABA real.

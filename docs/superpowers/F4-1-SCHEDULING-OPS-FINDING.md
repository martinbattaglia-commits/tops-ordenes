# OPS · F4.1 — Scheduled Function registrada pero SIN ejecuciones (pendiente de cierre F4.1)

> Abierto: 2026-07-02. Estado: **PENDIENTE — decisión de Dirección entre opciones A/B/C.**
> No bloquea la operación: el fan-out crítico de F4.1 (menciones/DM) es SÍNCRONO por triggers;
> el worker solo gobierna la cola (backlog inerte de 34 `pending`, cero efectos).

## 1. Hechos (evidencia de la ventana 2026-07-01)

| # | Ítem | Valor |
|---|---|---|
| 1 | Deploy productivo | **`6a45a3bdd89a6fe23d1994ab`** (publicado 23:34:44Z) |
| 2 | Commit | **`bef2f78`** (`/api/version` lo confirma, environment=production) |
| 3 | Scheduled function | `connect-dispatch-outbox` — bundleada en el deploy (`netlify/functions/connect-dispatch-outbox.mts`, runtime nodejs22.x) |
| 4 | Cron registrado | **`*/5 * * * *`** — confirmado vía API `searchSiteFunctions` (tras el registro DECLARATIVO en `netlify.toml`, commit `bef2f78`; el `config.schedule` in-source NO registró — commit `8c44003` tampoco lo logró solo) |
| 5 | Ejecuciones observadas | **0** — ticks 23:20/23:25/23:30 (deploy 1) y 23:40/23:45/23:50/23:55 (deploy 2 con registro confirmado) sin invocación |
| 6 | Logs de la function | **Vacíos** (`netlify logs --source functions --function connect-dispatch-outbox --since 40m` → "No logs found") — ni siquiera invocaciones con error |
| 7 | `connect_worker_runs` | Sin corridas programadas; única fila = dry-run manual local (23:13:55Z, corr `63262b95`, `pending=34` = conteo "antes" D-F41-3) |
| 8 | Endpoint manual | `POST /api/connect/cron/dispatch-outbox` — **protegido y fail-closed** (sin secret → 401; mal secret → 401; sin CRON_SECRET configurado → 503; comparación timing-safe). Lógica probada end-to-end en aislamiento local (dry read-only contra prod: success, `pending_remaining=34`) |

## 2. Hipótesis (ordenadas por probabilidad)

1. **Limitación de plataforma con deploys manuales CLI**: el sitio `tops-ordenes` NO tiene CI de
   Netlify (deploys `netlify deploy` manuales; `commit_ref` = manual). Los schedulers de Netlify
   podrían no engancharse a functions de deploys manuales, aunque la API reporte el schedule.
2. Lag de activación anómalo del scheduler (> 20 min) — poco probable a esta altura.
3. Fallo silencioso del scheduler ante funciones `.mts` + runtime v2 en este plan/sitio — solo
   Netlify Support puede confirmarlo.

Nota relacionada (precedente): `knowledge-drain.yml` (GH Actions) tampoco corre — ver
`OPS-KNOWLEDGE-DRAIN-SCHEDULING-FINDING.md`. Ninguno de los dos mecanismos de cron del proyecto
está ejecutando hoy; los 4 crons que SÍ corren (compliance/contratos/caja-chica/clientify) usan
GH Actions desde... ⚠️ verificar: esos 4 workflows SÍ están activos en GitHub (los únicos 5
registrados) — es decir, **el único mecanismo de cron probado y operativo del proyecto hoy es
GH Actions sobre la default branch**, que para F4.1 está bloqueado por la divergencia de `main`.

## 3. Opciones para Dirección

### Opción A — Verificación manual en el dashboard de Netlify (sin costo, primero)
En https://app.netlify.com → proyecto `tops-ordenes` → **Functions** → `connect-dispatch-outbox`:
- ¿Aparece badge **"Scheduled"** y **Next run**?
- ¿Hay invocaciones/errores en el log del panel (a veces el panel muestra lo que el CLI no)?
- ¿La función figura asociada al deploy publicado `6a45a3bdd89a6fe23d1994ab`?
Si muestra Next run y luego ejecuta: el pendiente se cierra solo (verificar con
`select * from connect_worker_runs order by started_at desc` — deben aparecer corridas */5).

### Opción B — Ticket a Netlify Support (borrador listo, NO enviado)
> **Subject:** Scheduled Function registered but never invoked (manual CLI deploys)
> **Site:** tops-ordenes (`d84a7d34-b90c-4e61-aff6-678abf1ac432`) · Production URL:
> `https://nexus.logisticatops.com` · Published deploy: `6a45a3bdd89a6fe23d1994ab`.
> **Function:** `connect-dispatch-outbox` (TypeScript `.mts`, runtime API v2, nodejs22.x),
> schedule `*/5 * * * *` declared in `netlify.toml` (`[functions."connect-dispatch-outbox"]`).
> `searchSiteFunctions` API returns the schedule correctly, and the function bundles fine in the
> deploy. However it is **never invoked**: no executions at :00/:05/... ticks for 25+ minutes
> after publish (expected first runs 2026-07-01 23:40Z onward), and
> `netlify logs --source functions --function connect-dispatch-outbox` returns "No logs found".
> Manual invocation of our internal endpoint works, so the function body is not the issue.
> The site deploys via **manual CLI deploys** (`netlify deploy --build --prod`), not Git CI.
> **Question:** are scheduled functions supported/triggered for manual CLI deploys? If yes, why is
> the scheduler not invoking this function despite the registered schedule?

### Opción C — Cron externo temporal (propuesta, NO implementar sin autorización)
Un scheduler externo (p.ej. cron-job.org, GitHub Actions de OTRO repo, o un cron del propio
equipo) que invoque cada 5 minutos:
`POST https://nexus.logisticatops.com/api/connect/cron/dispatch-outbox`
con header `Authorization: Bearer <CRON_SECRET>`.
**Riesgos a aceptar explícitamente:** custodia del secret fuera de Netlify (¿dónde vive?, ¿quién
accede?); dependencia de un tercero para una función interna; rotación del secret (hoy manual,
habría que rotar en 2 lugares); monitoreo del cron externo (¿quién detecta si deja de llamar?);
auditoría (las corridas quedan en `connect_worker_runs`, el ORIGEN no); el endpoint ya es
fail-closed y rate-acotado por diseño (claim exclusivo + batches), lo que mitiga abuso.

**Recomendación:** **A primero** (5 minutos de Martín en el dashboard; costo cero y puede cerrar
el pendiente solo). Si el panel muestra la función SIN badge Scheduled o sin Next run → **B**
(limitación/bug de plataforma; el borrador está listo). **C** solo como puente temporal si B
tarda y Dirección quiere el worker activo ya — con los riesgos aceptados por escrito.

## 4. Mientras tanto (sin acción requerida)

- El sistema opera completo sin el worker: notificaciones de menciones y DM salen síncronas.
- El backlog (34 `pending`) es inerte y se drenará en la primera corrida (programada o manual).
- Martín puede drenar manualmente cuando quiera (checklist §10 del Validation Pack, requiere el
  CRON_SECRET real — no recuperable vía CLI por diseño write-only).

**Cierre de este finding** = evidencia de ≥2 corridas programadas en `connect_worker_runs`
(opción A exitosa) O mecanismo alternativo aprobado y operando (B/C).

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

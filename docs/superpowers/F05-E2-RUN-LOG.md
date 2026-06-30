# F0.5.2 / E2 — Run Log de Ejecución Controlada

**Plan Global aprobado (G7):** `docs/superpowers/plans/2026-06-29-f05-2-global-plan.md` (2026-06-29).
**Decisiones Dirección (G7):** cron worker = 5 min · `MAX_RETRIES=3` (backoff 1→2→4 min) · orden fuentes = Recon→Compras→Tesorería→Custody→RRHH · EOL = solo reconciliación TS↔SQL (sin tabla por ahora).
**Proyecto:** prod `arsksytgdnzukbmfgkju` (verificado por operación) · aplicación vía MCP `apply_migration` · una migración por vez · validación read-only automática · STOP ante inconsistencia. (Estándar E1.)
**Base:** worktree `feat+f05-knowledge-foundation` @ `3e0418e` (E1 sincronizada y aplicada en prod).

---

## E2.0 — Contrato `p_status` del emisor + índice de timeline

**Objetivo:** que un evento pueda nacer `pending` sin romper a los emisores síncronos actuales; habilitar `dispatch_idx` para el worker (E2.1).

**Migración:** `0132_knowledge_emit_status` — `create or replace` del emisor con `p_status text default 'processed'` + re-hardening + `drop` del overload de 1 arg (queda UNA función) + índice `knowledge_events_timeline_idx (status, seq desc) where status='processed'`.

**Tareas:**
1. [x] Autorar `0132` (worktree). 
2. [x] Verificar project_id = `arsksytgdnzukbmfgkju`.
3. [x] Aplicar `0132` vía MCP.
4. [x] Validar (read-only): firma 2 args + default; 1-arg eliminada; ACL `{postgres, service_role}`; índice presente.
5. [x] Smoke regresión (no contaminante): re-backfill audit_log → 0 (path legacy intacto vía nueva función).
6. [x] Smoke `pending` (tx + rollback, no contaminante).
7. [x] Run Log + declarar ✅ + cerrar E2.0.

| Paso | Estado | Evidencia |
|---|---|---|
| Aplicación 0132 | ✅ | `apply_migration` success |
| Validación firma/ACL/índice | ✅ | 1 sola fn `(canonical, text DEFAULT 'processed')` · anon/auth sin execute · `timeline_idx` presente · registrada |
| Smoke regresión legacy | ✅ | `knowledge_backfill_audit_log(null)` = **0** (path 1-arg resuelve a la nueva fn) |
| Smoke pending | ✅ | en tx+rollback: `status='pending'`, `en_cola_dispatch=true`; anti-leak: eventos=152, residuo=0, no-processed=0 |

**Definition of Done E2.0:** `knowledge_emit_event(event,'pending')` materializa `status='pending'` (aparece en `dispatch_idx`); llamadas legacy de 1 arg siguen insertando `processed`; existe UNA sola función (2 args, default); ACL = `{postgres, service_role}`; `knowledge_event_canonical` sin cambios; backfill audit_log idempotente (2ª corrida = 0); índice de timeline presente.

**✅ E2.0 CERRADA (2026-06-29).** DoD cumplida 8/8. Sin incidencias. Prod: `0132` aplicada, `knowledge_events`=152 intacto, emisor listo para que el worker (E2.1) emita `pending`. **E2.1 NO iniciada** (espera autorización de Dirección). Repo: `0132` + Run Log E2 + Plan Global **sin commitear** (pendiente de sincronización).

---

## E2.1 — Worker + Cola + Estados + Automatización

**Plan detallado (G7 aprobado):** `docs/superpowers/plans/2026-06-29-f05-2-1-worker.md`. Decisiones G7: estado terminal `processed` · procesador no-op · lease 5 min (sin columnas nuevas) · `batchSize=50`/`maxBatches=20`/`maxDuration=50s` · **+ métricas internas** (tabla `knowledge_worker_runs`).

**Migración `0133_knowledge_dispatch`** — aplicada vía MCP y validada:
- 5 RPCs SECDEF hardened: `knowledge_claim_batch` (FOR UPDATE SKIP LOCKED + lease), `knowledge_mark_processed`, `knowledge_mark_failed` (backoff), `knowledge_recover_stuck`, `knowledge_record_worker_run`.
- Tabla `knowledge_worker_runs` (telemetría G7) + RLS (`has_permission('knowledge.view')`) + índice.

**Smokes SQL (tx+rollback, sin residuo):**
| Smoke | Resultado |
|---|---|
| A — ciclo feliz | pending→processing→processed ✅ |
| B — retry/backoff/dead | fail1=+1m, fail2=+2m, fail3=+4m, fail4=dead ✅ |
| C — recover_stuck | processing+lease vencido → failed (recovered=1) ✅ |
| D — telemetría | `record_worker_run` registra contadores ✅ |
| Idempotencia | re-mark = no-op, `mark_failed` sobre processed = NULL ✅ |
| Re-claim | processed no se reclama (=0) ✅ |
| Anti-leak | `knowledge_events`=152, 0 residuo, `worker_runs`=0 ✅ |

**Código TS/CI:**
- `src/lib/knowledge/drain.ts` (orquestador + `noopProcessor` + `KnowledgeEventProcessor`).
- `src/app/api/knowledge/drain/route.ts` (endpoint GET/POST fail-closed `CRON_SECRET`, `?dry`).
- `.github/workflows/knowledge-drain.yml` (cron `*/5`, mirror de caja-chica).
- `src/lib/knowledge/drain.test.ts` (6 tests).
- **Validación:** typecheck **0** · lint limpio (mis archivos) · tests **285/285** (44 files, +6 drain).

**DoD E2.1:** ciclo completo (claim→processing→processed | failed+backoff | dead tras 3) ✅ · lock SKIP LOCKED + re-claim safe ✅ · recover_stuck por lease ✅ · idempotente ✅ · telemetría ✅ · endpoint fail-closed (401 sin Bearer; lógica probada por construcción + unit tests) ✅ · cron `*/5` ✅ · E1/E2.0 intactos ✅.

**Caveat de deploy:** el endpoint y el cron quedan **vivos solo tras el deploy** (Netlify manual; el worktree ni siquiera está mergeado a `main`). La parte activa en prod es la migración `0133`. El `?dry` live se valida post-deploy (fuera del "no deploy" de E2.1).

**Repo (pendiente de sync):** `0133` + `drain.ts` + `drain.test.ts` + `route.ts` + `knowledge-drain.yml` + plan E2.1 — **sin commitear**. **E2.2 no iniciada.**

## E2.2 — Adaptadores (G7 aprobado 2026-06-29)

**Plan:** `docs/superpowers/plans/2026-06-29-f05-2-2-adapters.md`. Decisiones G7: visibilidad `staff` · treasury=`treasury_movement` (payload mínimo) · custody=`shipment` (packing_unit en payload) · rrhh `enabled=false` (sin PII, `perm:rrhh.view`) · `knowledge_nodes` diferido · emisión `processed`. **Una fuente por vez; cada adaptador cerrado antes del siguiente.** Emisor/worker/E1-E2.1 congelados.

| Migración | Fuente | Estado |
|---|---|---|
| `0134_knowledge_sentinel_fix` | (fundación) | ✅ **CERRADA** — mapeo audit_log usa `id` fallback (no `'∅'`); test: null entity_id → entity_id=id; regresión backfill=0; forward-only |
| `0135_knowledge_adapter_recon` | `recon_events` | ✅ **CERRADA** — 3 fns + trigger `tg_project_recon_events` + seed; ACL hardened (corrección: faltaba `revoke all from public`); mapeo OK; backfill **7** (idempotente); trigger en vivo OK; visibility `staff`. Timeline 152→159 |
| `0136_knowledge_adapter_po` | `po_events` | ✅ **CERRADA** — 3 fns + trigger `tg_project_po_events` + seed; ACL hardened (completo desde el inicio); mapeo OK (`po.created`/`po.signed`); backfill **46** (idempotente); visibility `staff`; `knowledge_nodes` diferido. Timeline 159→205 |
| `0137_knowledge_adapter_treasury` | `treasury_movements` | ✅ **CERRADA** — 3 fns + trigger `tg_project_treasury_movements` + seed; ACL hardened; mapeo OK (3 tipos); **payload SIN `amount`** (D-E2.2-2); backfill **25** (idempotente); visibility `staff`. Timeline 205→230 |
| `0138_knowledge_adapter_custody` | `custody_events` | ✅ **CERRADA** — 3 fns + trigger + seed; ACL hardened; D-E2.2-3 (entidad `shipment`, packing_unit en payload); backfill **3** (idempotente); visibility `staff`. Timeline 230→233 |
| `0139_knowledge_adapter_rrhh` | `rrhh_*` (3 fuentes) | ✅ **CERRADA (DORMIDA)** — 9 fns + 3 triggers + 3 seeds `enabled=false` (D-E2.2-4); ACL hardened; gate OFF (0 proyección/0 backfill); payload **sin PII**; `perm:rrhh.view`. Espera autorización Dirección para activar |

**E2.2 funcionalmente completa (2026-06-29).** 6 migraciones `0134-0139`. Timeline multi-fuente: **233 eventos** (audit_log 152 + recon 7 + po 46 + treasury 25 + custody 3) + rrhh dormido. Source Registry: 8 fuentes (5 activas + 3 rrhh dormidas). Hardening: todas las funciones SECDEF locked (`revoke all from public` + `revoke from anon, authenticated`); **lección reforzada: ambos revokes son necesarios** (corrección detectada en 0135). knowledge_nodes diferido. Emisor/worker/E1/E2.0/E2.1 intactos. **Es 100% DB → vivo en prod sin deploy.**

**Definition of Done E2.2:** cada fuente proyecta en vivo vía el emisor único (sin INSERT directo) · backfill idempotente (2ª corrida = 0) · gate `enabled` respetado (rrhh OFF ⇒ 0 proyección) · degradación si la tabla fuente falta · visibility correcta (`staff` activas / `perm:rrhh.view` dormidas) · sentinel `'∅'` corregido a `id` fallback (forward-only) · SECDEF hardened (anon/authenticated/public sin execute) · emisor/worker/E1/E2.0/E2.1 intactos · 100% aditivo, sin deploy.

**✅ E2.2 CERRADA (2026-06-29).** Verificación de paridad repo↔prod (read-only, proyecto `arsksytgdnzukbmfgkju`, 2026-06-29):

| Verificación | Esperado (Run Log) | Prod (medido) | OK |
|---|---|---|---|
| Migraciones aplicadas | `0134`–`0139` | las 6 aplicadas (name idéntico al archivo; versión = timestamp por convención del remoto) | ✅ |
| `knowledge_events` | 233 (audit 152 · recon 7 · po 46 · treasury 25 · custody 3 · rrhh 0) | 233 (152 · 7 · 46 · 25 · 3 · 0) | ✅ |
| `knowledge_sources` | 8 (5 activas backfilled + 3 rrhh `enabled=false`) | 8 (5 activas backfilled + 3 rrhh off, sin backfill) | ✅ |
| Triggers `tg_project_*` | 8 (audit_log + 4 activas E2.2 + 3 rrhh gateadas) | 8 vivos | ✅ |
| ACL adaptadores | sin execute para anon/authenticated/public | 21/21 funciones sin grantees expuestos | ✅ |

Sin diferencias repo↔prod. Sync local en el commit de cierre (`0134-0139` + plan E2.2 + este Run Log). **Sin push/merge/deploy.** **E2.3 NO iniciada** — espera autorización expresa de Dirección.

## E2.3 — KPIs + Panel · E2.4 — EOL
*(pendientes, secuenciales)*

---

*Run Log E2 iniciado: 2026-06-29 · subfase activa: E2.0.*

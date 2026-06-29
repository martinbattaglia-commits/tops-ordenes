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
*(NO iniciar hasta cerrar E2.0 — pendiente)*

## E2.2 — Adaptadores · E2.3 — KPIs + Panel · E2.4 — EOL
*(pendientes, secuenciales)*

---

*Run Log E2 iniciado: 2026-06-29 · subfase activa: E2.0.*

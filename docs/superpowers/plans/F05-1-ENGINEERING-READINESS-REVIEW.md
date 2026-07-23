# F0.5.1 — Engineering Readiness Review

> Revisión final de rama completa (8 commits, base F0.5.0 `5803fa9`→`feat+f05-knowledge-foundation`). Proceso: subagent-driven, worktree aislado; 7 tasks, cada una con reviewer de máxima capacidad por checkpoint; modalidad autónoma-por-checkpoint autorizada por Dirección.
> Superficie de implementación: `supabase/migrations/{0108,0109,0111}`, `src/lib/knowledge/{data.ts,observability.ts}`, `docs/superpowers/F05-1-APPLY-CHECKLIST.md`, ADRs. Commits locales. **NO mergeado, NO pusheado, NADA aplicado a la DB.**

## 1. Correctitud

Coincide con la arquitectura aprobada (Adapter Pattern + Source Registry + contrato canónico). Validación campo a campo:

- **0108 (`knowledge_event_canonical`):** tipo compuesto de 13 campos coherente extremo a extremo — el mismo contrato aparece en la firma del `TYPE`, en el `INSERT INTO knowledge_events` dentro de `knowledge_emit_event`, en la proyección de `v_knowledge_timeline` y en los tipos TS. Sin divergencia detectada.
- **0108 (`knowledge_visibility_for`):** función `SECURITY DEFINER` con `search_path = public`, grants a `service_role`. `CASE` exacto contra literales de `entity`; default conservador `'staff'` para entidades no mapeadas. Sin condicionales por fuente (el Adapter Pattern no discrimina fuente en esta función).
- **0108 (`knowledge_emit_event`):** emisor único punto de escritura; `ON CONFLICT DO NOTHING` sobre `knowledge_events_idem_uq` (`source_table, source_pk, event_type`); idempotente por diseño.
- **0109 (`knowledge_audit_log_to_canonical`):** Adapter puro — mapea `audit_log` → `knowledge_event_canonical`; llama `knowledge_visibility_for`; sin lógica de routing. `INSERT INTO knowledge_sources` (Source Registry) con `ON CONFLICT DO NOTHING`.
- **0109 (trigger `tg_project_audit_log`):** defensivo — verifica `enabled` antes de proyectar; llama `project_audit_log()` que llama al Adapter y luego al emisor. Un solo punto de escritura confirmado (R-A).
- **0109 (`knowledge_backfill_audit_log(int)`):** acepta `p_limit` opcional (`DEFAULT NULL`); idempotente vía `ON CONFLICT DO NOTHING`; retorna conteo de filas insertadas.
- **0111 (`v_knowledge_timeline`, `v_knowledge_entity_360`):** vistas `security_invoker`; RLS de `knowledge_events` aplica por invocador. `ALTER PUBLICATION supabase_realtime ADD TABLE knowledge_events` incluido.
- **TS (`data.ts`):** `listTimeline(scope)` retorna array; `getRecentFacts` para read-model factual. Capa solo lectura (D12).
- **TS (`observability.ts`):** canal técnico separado; structured logging tipado; `correlation_id` end-to-end vía GUC `knowledge.correlation_id` (nombre idéntico a 0108/0109); contratos de métricas preparados; auditoría de backfill.

**Desviaciones de alcance:** ninguna introducida. Diferimiento explícito confirmado: `v_knowledge_search`, recon/po/orders/searchable, worker y embeddings → F0.5.2+; KIL → F7-F11.

## 2. Gobernanza

G2/G3/G10/G11/D12 respetadas; revisores de máxima capacidad en cada checkpoint.

- **Entregadas-no-aplicadas (G3):** los 3 archivos SQL llevan header "ENTREGADA, NO APLICADA". `git status` no muestra ningún efecto contra prod. La apply-checklist (`F05-1-APPLY-CHECKLIST.md`) deja el orden de aplicación manual para Dirección. **Nada fue aplicado a ninguna DB.** Verificado.
- **100% aditiva (G2):** cero `ALTER TABLE` sobre tablas de negocio existentes. Solo objetos nuevos (`TYPE`, `FUNCTION`, `TRIGGER`, `VIEW`, `INSERT` en Source Registry). `audit_log` intacto (G2 confirmado).
- **SECURITY DEFINER + search_path + grants service_role (G10):** todas las funciones SECURITY DEFINER tienen `search_path = public` explícito y `GRANT EXECUTE TO service_role`. Vistas en `security_invoker` (no agregan warnings de Advisors).
- **Trigger defensivo (G11):** `project_audit_log()` verifica `enabled` en `knowledge_sources` antes de emitir. Disrupción nula si la fuente está deshabilitada.
- **RLS por `visibility_key` + vistas `security_invoker`:** policy `knowledge_events_select` reusa `has_permission('knowledge.view')` (0009:164). Frontera de seguridad no introduce lógica de permisos nueva.
- **Capa TS solo lectura (D12):** `data.ts` y `observability.ts` son read-only; no hay escritura TS hacia `knowledge_events`.
- **Idempotencia:** `CREATE ... IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP ... IF EXISTS`. Re-ejecución segura en cualquier orden (dentro del orden de dependencias DDL).
- **Sin push/deploy/merge:** commits locales únicamente. No se realizó ninguna operación hacia `origin` ni hacia prod.

## 3. Conformidad arquitectónica — Architectural Health Check (VERDE)

Siete invariantes confirmados por el reviewer whole-branch:

| Invariante | Estado |
|------------|--------|
| R-A: emisor único punto de escritura | ✅ Solo `knowledge_emit_event` escribe en `knowledge_events` |
| Pipeline 100% agnóstico (sin ramas por fuente en emisor/vistas) | ✅ Confirmado; discriminación solo en Adapters |
| Source Registry (`knowledge_sources`) sin condicionales por fuente | ✅ Solo `enabled` flag como gate |
| Contrato canónico (`knowledge_event_canonical`) coherente extremo a extremo | ✅ type↔INSERT↔vista↔TS alineados (13 campos) |
| DRY — mapeo `audit_log` único | ✅ Un solo Adapter (`knowledge_audit_log_to_canonical`) |
| OCP — sumar fuente = adaptador + fila en Source Registry | ✅ Ningún cambio a emisor/vistas/tipos para nueva fuente |
| `audit_log` intacto (G2) | ✅ Sin ALTER sobre tabla fuente |

## 4. EOL (D20/ADR-ENG-1) — primera fase obligada, conforme

La EOL es obligatoria desde F0.5.1. Cumplimiento verificado:

- Canal técnico separado (`observability.ts`): nunca escribe en `knowledge_events`.
- `correlation_id` end-to-end vía GUC `knowledge.correlation_id`: nombre idéntico en `0108_knowledge_rpc.sql`, `0109_knowledge_projection_triggers.sql` y `observability.ts`.
- Structured logging tipado: contratos de tipos en `observability.ts`.
- Contratos de métricas preparados: interfaces definidas, instrumentación diferida.
- Auditoría de backfill: `knowledge_backfill_audit_log` retorna conteo; cobertura en-vivo de `correlation_id` diferida hasta instrumentar las fuentes (F0.5.2+).

## 5. Gates técnicos

| Gate | Resultado |
|------|-----------|
| TypeScript typecheck | 0 errores |
| Lint | 0 errores |
| Vitest | **279/279** (264 previos de F0.5.0 + 15 nuevos de F0.5.1) |
| Build Next.js | Requiere env vars de Next.js — lo corre Dirección en su entorno; el cambio TS está cubierto por typecheck/lint/test |

## 6. Proceso de revisión

| Task | Scope | Resultado |
|------|-------|-----------|
| Task 1 — SPEC | Arquitectura + ADRs (ADAPTER/REGISTRY/CONTRACT) + plan | SPEC ✅ / Aprobado (3 Minor corregidos en iteración) |
| Task 2 — 0108 | `knowledge_event_canonical` + RPC pipeline agnóstico | SPEC ✅ / Aprobado (0 Critical/Important) |
| Task 3 — 0109 | `AuditLogAdapter` + trigger + backfill | SPEC ✅ / Aprobado (0 Critical/Important) |
| Task 4 — 0111 | Vistas `security_invoker` + publicación Realtime | SPEC ✅ / Aprobado (0 hallazgos) |
| Task 5 — Read-model TS | `data.ts` (R-F + `listTimeline`) | SPEC ✅ / Aprobado (0 Critical/Important, 1 Minor) |
| Task 6 — EOL `observability.ts` | Canal técnico separado D20/ADR-ENG-1 | SPEC ✅ / Aprobado (0 Critical/Important, 3 Minor) |
| Task 7a — Checklist | `F05-1-APPLY-CHECKLIST.md` + smoke tests | ✅ LISTO PARA DIRECCIÓN (0 Critical/Important) |
| **Whole-branch final** | Revisión completa de rama (8 commits) | **LISTO PARA CIERRE — 0 Critical / 0 Important** |

## 7. Riesgo y deuda técnica

**Riesgo: Bajo.** Justificación: (a) cero código aplicado a prod; (b) 100% aditivo, rollback trivial (ver checklist §5); (c) frontera de seguridad reusa helpers ya probados en prod; (d) escritura cerrada (ninguna policy INSERT/UPDATE/DELETE para `authenticated`); (e) proyección síncrona por trigger es la única presión de latencia — mitigada por worker `/api/knowledge/drain` previsto en F0.5.2.

**Minor backlog → F0.5.2** (ninguno bloquea):

- Cast `actor_kind` sin guard runtime (cosmético).
- `DEFAULT_VERSION` hardcodeado en `observability.ts`.
- `ORDER BY` embebido en vistas (debería vivir en la query del consumidor).
- Test `readonly` cosmético en read-model.

## 8. Riesgos / pendientes para Dirección

**(a) Decisión D-1 PRE-backfill** — `visibility_key` `public_auth` vs `staff` para entidades `purchase_order`, `supplier_invoice`, `vendor`, `fleet_vehicle`, `warehouse`, `compliance_item`. Documentado en checklist §2; confirmar ANTES de aplicar 0108.

**(b) Aplicación manual (G3)** — Las migraciones 0108/0109/0111 requieren aplicación manual por Dirección en el SQL Editor de Supabase prod (`arsksytgdnzukbmfgkju`). Verificar numeración vs prod (timestamps) antes de pegar (checklist §1.4).

## 9. Alcance respetado

Solo `audit_log` como fuente en F0.5.1. Diferidos a F0.5.2+: `v_knowledge_search`, toda fuente recon/po/orders/searchable/worker. Diferidos a F7-F11: KIL / Knowledge Intelligence Layer.

## 10. Recomendación

**APROBADO PARA CONTINUAR** (a F0.5.2, en sesión separada). La implementación es 100% aditiva, entregada-no-aplicada (G3 verificado), Adapter Pattern confirmado como load-bearing (R-A), EOL conforme, 279/279 tests verdes, 0 Critical/0 Important en revisión whole-branch. Riesgo Bajo. Sin deuda técnica innecesaria introducida. **NO mergeado, NO pusheado, NADA aplicado a la DB.** Próximo paso lo decide Dirección: aplicación manual de migraciones (checklist) y/o autorización de F0.5.2.

---

*Readiness Review generado: 2026-06-28 · F0.5.1 · TOPS Nexus Knowledge Layer*

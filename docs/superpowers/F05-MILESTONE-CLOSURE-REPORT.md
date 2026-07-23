# F0.5 Milestone Closure Report

**Fecha:** 2026-06-28 · **Estado del worktree:** entregado-NO-aplicado · **NADA pusheado/mergeado/deployado/aplicado a la DB** · **Punto de restauración:** `284b5fb`

---

## 1. Qué se completó

### F0.5.0 — Foundation (migs 0106 / 0107 / 0110)

| Artefacto | Descripción |
|-----------|-------------|
| `0106_knowledge_enum.sql` | `ALTER TYPE` de `event_type`; split en tx propia (mismo molde 0086/0087 validado en prod) |
| `0107_knowledge_registry.sql` | `knowledge_sources` (Source Registry), `knowledge_events` (append-only, BEFORE DELETE), índices `entity_idx` / `dispatch_idx` / `source_idx`, permisos RLS, `supabase_realtime` |
| `0110_knowledge_permissions.sql` | Permisos `knowledge.view` / `knowledge.admin` en la tabla `permissions` |
| Engineering Readiness Review | APROBADO; 9 commits incluidos |

### F0.5.1 — Timeline Projection (migs 0108 / 0109 / 0111 · 8 commits `d90c41a..284b5fb`)

| Artefacto | Descripción |
|-----------|-------------|
| `0108_knowledge_rpc.sql` | Composite type `knowledge_event_canonical` (13 campos), emisor único `knowledge_emit_event`, helper `knowledge_visibility_for` — pipeline agnóstico, cero ramas por `source_table` |
| `0109_knowledge_projection_triggers.sql` | AuditLogAdapter: mapeo DRY `knowledge_audit_log_to_canonical` reutilizado en trigger defensivo (G11: nunca aborta tx de negocio) y backfill `knowledge_backfill_audit_log`; gate `enabled`; registro fila fuente en `knowledge_sources` |
| `0111_knowledge_views.sql` | `v_knowledge_timeline` + `v_knowledge_entity_360` (`security_invoker=true`); `v_knowledge_search` **diferida a F0.5.2** |
| Read-model TS | `listTimeline`, tipos `R`/`F`, `mapTimelineRow` en `src/lib/knowledge/` |
| EOL `observability.ts` | `structuredLog()`, `KNOWLEDGE_CORRELATION_GUC`, `KNOWLEDGE_METRICS`; contrato `correlation_id` end-to-end |
| 3 ADR | `ADR-KNW-REGISTRY` / `ADR-KNW-CONTRACT` / `ADR-KNW-ADAPTER` — coherentes entre sí, aprobados por Dirección |
| Gates CI | `typecheck 0 errores` / `lint 0 errores` / `vitest 279/279` — build de Next.js lo corre Dirección (requiere env) |
| Release Readiness Review | Veredicto **LISTO-CON-CONDICIONES — GO para F0.5.2** |

---

## 2. Qué queda pendiente

### Acciones de Dirección (no son código)

1. **Aplicación manual de migraciones 0106–0111** — archivo por archivo, transacciones separadas. Landmine crítico: 0106 y 0110 no pueden correr en la misma tx (enum value + uso en la misma tx falla en Postgres). Runner prod no fue confirmado; ver R-3 y prerrequisito en `docs/superpowers/F052-PREREQUISITES.md`.
2. **Aprobación G7 del spec** — solo tras confirmar que el banner de §5.3/§5.4 es suficiente para evitar que se aplique el SQL obsoleto de Alternativa A.
3. **Decisión D-1** — confirmar si `public_auth` se endurece a `staff` para `purchase_order` / `supplier_invoice` / `vendor` / `fleet_vehicle` / `warehouse` / `compliance_item` (R-7); debe resolverse antes de F0.5.3, no bloquea F0.5.2.

### Diferido a F0.5.2 (técnico)

- `v_knowledge_search` (índice FTS GIN ya existe, sin consumidor)
- ReconAdapter / OrdersAdapter / PoAdapter / WorkerAdapter
- Worker asíncrono (pendiente decisión del contrato `p_status` — ver prerrequisito #1 en `F052-PREREQUISITES.md`)
- `correlation_id` en vivo (wiring SQL listo en 0108/0109; falta emisor app — NO requiere reabrir migraciones)
- Índice camino caliente `(status, seq desc) WHERE status='processed'`
- Corrección sentinel `'∅'` en `entity_360`
- Keyset pagination (cursor por `seq`)
- Wrapper TS que fuerce `WHERE entity_type+entity_id` en `entity_360`
- `set search_path` en `has_permission`
- Catálogo único EOL (TS / SQL / ADR)

### Diferido a F0.5.3 (deuda con fecha límite)

- Endurecer `public_auth` → `staff` (R-7; requiere D-1)
- Plan de activación de `user_roles` con gate por módulo (R-6; evitar big-bang)

### Opcional / mejora continua

- Re-etiquetar o remover `visibility.ts` / `visibility.test.ts` (MACL prematuro, R-9)
- Helper genérico de backfill para evitar drift de boilerplate entre fuentes
- Auditar Realtime×RLS antes de exponer suscripciones en UI (R-10)

---

## 3. Riesgos que permanecen abiertos

### Nivel ALTO

| ID | Descripción | Estado de mitigación |
|----|-------------|---------------------|
| R-1 | Spec §5.3/§5.4 mostraba Alternativa A RECHAZADA como canónica | **MITIGADO:** banner de override aplicado en esta sesión (ver `F05-DOC-RECONCILIATION-CHECKLIST.md`) |
| R-2 | Worker async de F0.5.2 no puede arrancar sin `p_status` en el emisor; toda fila nace `processed`; índice de dispatch muerto | **PENDIENTE:** resolver como overload aditivo antes de arrancar F0.5.2 |

### Nivel MEDIO

| ID | Descripción | Estado de mitigación |
|----|-------------|---------------------|
| R-3 | Migraciones envueltas en UNA transacción → 0110 falla por enum value creado en la misma tx | **PENDIENTE:** confirmar runner prod (archivo-por-archivo, tx separadas) — responsabilidad Dirección |
| R-4 | Sentinel `'∅'` corrompe identidad en `entity_360`; `security_invoker` reevalúa policy sobre join con fan-out | **PENDIENTE:** durante F0.5.2 |
| R-5 | Timeline global sin índice `ORDER BY seq desc`; sort completo en cada carga | **PENDIENTE:** durante F0.5.2 |
| R-6 | Activación futura de `user_roles` abre read-model corporativo de golpe (incluye `public_auth` de compras) | **PENDIENTE:** plan pre-F0.5.3 |

### Nivel BAJO (pero con fecha límite)

| ID | Descripción | Fecha límite |
|----|-------------|-------------|
| R-7 | `public_auth` de compras/facturas expuesto a cualquier autenticado con `knowledge.view` — inerte hoy | pre-F0.5.3 |
| R-8 | Catálogo EOL desalineado (TS/SQL/ADR); colectores no verán logs reales | pre-cableo de colectores en F0.5.2 |
| R-9 | `visibility.ts` con test verde → falsa señal de "feature lista" (MACL prematuro) | opcional |
| R-10 | Realtime×RLS no auditado | antes de exponer suscripciones en UI |
| R-11 | `visibility_key` materializado queda obsoleto si cambia el dueño de la entidad | deuda de coherencia eventual |

---

## 4. Decisiones aprobadas y consolidadas por Dirección

Las siguientes decisiones fueron aprobadas y no están sujetas a re-discusión:

- **Knowledge Layer** — capa corporativa de eventos canónicos sobre el ERP
- **Knowledge Intelligence Layer (KIL)** — visión SoR→SoK→SoI→SoX unidireccional; NO se implementa hasta F7-F11
- **Multi-Agent Coordination Layer (MACL)** — visión de largo plazo; NO se implementa, no reserva migraciones
- **Engineering Observability Layer (EOL)** — observabilidad nace con el código; requisito arquitectónico permanente desde F0.5.1+
- **Adapter Pattern** — toda fuente implementa su propio adaptador; sin lógica de fuente en el emisor
- **Source Registry** — `knowledge_sources` como contrato de registro de fuentes; desacoplado por FK
- **`KnowledgeEventCanonical`** — composite type de 13 campos como contrato único de emisión
- **Knowledge Projection Pipeline** — emisor único (`knowledge_emit_event`), append-only, agnóstico de fuente
- **Engineering Readiness Review** — proceso de validación técnica previo al Release Readiness Review
- **Release Readiness Review** — proceso de validación multidimensional (12 dimensiones) previo al arranque de sub-fase

---

## 5. Precondiciones para F0.5.2

Ver `docs/superpowers/F052-PREREQUISITES.md` para la lista priorizada completa.

Resumen ejecutivo de las condiciones de arranque:

1. **Técnico recomendado (no estrictamente bloqueante):** decidir el contrato `p_status` del emisor como overload aditivo (`p_status text default 'processed'`) — evita reabrir 0108 a mitad de fase (R-2).
2. **Responsabilidad Dirección (bloqueante operativo):** confirmar runner de migraciones prod (archivo-por-archivo, tx separadas) — defensa única contra landmine R-3.
3. **Responsabilidad Dirección (bloqueante de comunicación):** aprobación G7 del spec solo después de verificar que el banner de §5.3/§5.4 es suficiente.
4. **Decisión D-1 (no bloquea F0.5.2, fecha límite F0.5.3):** `public_auth` → `staff` para compras/proveedores/flota/compliance.

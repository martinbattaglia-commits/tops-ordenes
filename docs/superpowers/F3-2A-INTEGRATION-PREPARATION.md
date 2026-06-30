# Fase 3.2A — Preparación para la Integración (read-only) · Reporte completo

> Release Engineer · 2026-06-30. **Read-only**: solo inspección/planificación/simulación/documentación. Nada aplicado/modificado en prod/código/migraciones. Evidencia: Supabase MCP (`arsksytgdnzukbmfgkju`) + repo + preflight multi-agente.

## 1. Migration Preflight Report — qué produce cada migración (inventario exacto)
| Mig | Objetos que produce (resumen del inventario) | Idemp. | Reversibilidad |
|---|---|---|---|
| **0142** enum | `permission_module_t` += `'connect'` (ALTER TYPE ADD VALUE IF NOT EXISTS) | ✅ | **IRREVERSIBLE** (no se dropea valor de enum) — *único punto sin rollback*. Benigno: queda inerte |
| **0143** schema | **11 tablas** (conversations, participants, messages, message_edits, message_reactions, message_mentions, attachments, conversation_links, outbox, pinned, message_flags) · **4 enums** connect · **~26 índices** (incl. GIN FTS) · **3 funciones** helper (`_connect_set/guard_context_id`, `_connect_is_member`) · **5 triggers** · **RLS en 11 tablas + ~25 policies** · 2 cols (`meta`, `is_favorite`) | ✅ | Reversible (drop tablas/tipos/funciones) — sin datos al aplicar (greenfield) |
| **0144** rpc | **~22 RPCs SECDEF** (create_conversation, post_message, mark_read, add/remove/set_member, archive, set_topic, link_entity, pin/unpin, toggle_favorite, react, A1…) · **1 trigger** enqueue→outbox | ✅ | Reversible (drop functions/trigger) |
| **0145** views | **3 vistas** `security_invoker`: `v_connect_inbox`, `v_connect_channels`, `v_connect_unread_total` | ✅ | Reversible (drop views) |
| **0146** rbac seed | **5 permisos** `connect.view/create/edit/delete/admin` + **grants por rol** (ver §4) | ✅ | Reversible (delete perms/grants) |
| **0147** notif ext | `notifications` **+3 cols** (`priority` CHECK, `remind_at`, `delegated_to` FK) · **+ tablas a `supabase_realtime`** (connect_conversations/participants/messages…) | ✅ | Reversible (drop cols + publication drop table) |
| **0148** storage | **2 buckets** (`connect-files`, `connect-files-pii`) + 4 storage policies | ✅ | Reversible (delete buckets) — sin binarios al aplicar |
| **0149** knowledge adapter | **3 funciones** (`knowledge_backfill_connect_links`, `project_connect_links`, `…_to_canonical`) · **1 trigger** on `connect_conversation_links` · backfill | ✅ | Reversible (drop fn/trigger); backfill = **no-op** (links vacíos al aplicar) |
| **0150** join | **1 RPC** `connect_join_channel` | ✅ | Reversible |
| **0151** failclose | **7 RPCs** moderación recreadas (NULL-safe P-1) | ✅ | Reversible (re-aplicar guardas 0144) |
| **0152** ctx conv | **1 RPC** `connect_get_or_create_entity_conversation` | ✅ | Reversible |
| **0153** search | **1 RPC** `connect_search` (FTS) | ✅ | Reversible |
| **0154** profile | `profiles` **+5 cols** (`avatar_url`, `presence_status` CHECK, `profile_meta`, `notif_freq_default` CHECK, `last_activity_at`) + **2 RPCs** (`set_my_presence`, `update_my_profile`) | ✅ | Reversible (drop cols/fns) |

## 2. Matriz de impacto (objetos NUEVOS vs objetos EXISTENTES modificados)
- **Objetos NUEVOS (greenfield, 0 riesgo de regresión):** 11 tablas + 4 enums connect + 3 vistas + ~36 funciones/RPC + 7 triggers + 5 permisos + 2 buckets + ~26 índices.
- **Objetos EXISTENTES tocados (todo ADITIVO):** únicamente **4**:
  1. `permission_module_t` (+valor `connect`, 0142) — irreversible benigno.
  2. `notifications` (+3 cols, 0147) — ADD COLUMN constante = metadata-only.
  3. `profiles` (+5 cols, 0154) — ADD COLUMN constante = metadata-only.
  4. `supabase_realtime` (publicación, +tablas connect, 0147) — fast.
- **Conclusión:** la superficie de modificación de objetos existentes es mínima (4) y 100% aditiva. **Cero ALTER destructivo, cero DROP de objetos vivos, cero rewrite de tablas con datos.** Consistente con el cierre de IR-1 (disjunto de Compliance/0141).

## 3. Análisis operacional
- **Tiempo de ejecución total:** **segundos** (operaciones de metadata sobre tablas vacías/pequeñas). No requiere ventana de downtime.
- **Locks / operaciones bloqueantes:** prácticamente nulas. (a) GIN FTS en `connect_messages` SIN CONCURRENTLY → **instantáneo** (tabla vacía). (b) `ADD COLUMN` en `notifications`/`profiles` con default constante → metadata-only, lock ACCESS EXCLUSIVE de **milisegundos** (tablas chicas: profiles=10 filas). (c) `ALTER PUBLICATION ADD TABLE` → rápido. (d) backfill 0149 → **no-op** (links vacíos).
- **Impacto esperado sobre prod:** nulo para módulos existentes (aditivo/disjunto). El único cambio observable: nuevas tablas/permisos/columnas. Las páginas/nav de connect viven **post-deploy** (no por el apply).
- **Puntos sin rollback:** solo `0142` (valor de enum) — permanente, inerte si se revierte el resto.
- **Orden óptimo:** el numérico `0142→0154` respeta dependencias (0142 enum en su **propia transacción** antes de 0146; 0143 antes de 0144/0145; 0146 tras 0142; 0149 tras Knowledge —✅ vivo en prod—; 0150-0154 features). No alterar el orden.

## 4. Plan definitivo RBAC (`connect.*`)
- **Permisos (0146):** `connect.view`, `connect.create`, `connect.edit`, `connect.delete`, `connect.admin`. Acción enum `permission_action_t` ya existe.
- **Grants que aplica 0146 (por slug de rol):**
  - view+create → `director_ops, admin, operaciones, compliance, comercial, seguridad`
  - edit → `director_ops, admin, operaciones, compliance, comercial`
  - admin+delete → `admin, director_ops`
  - externos/`cliente_b2b` → **nada** (RC posterior).
- **🔴 GAP CRÍTICO detectado (evidencia prod):** los 6 slugs objetivo **existen** en prod, pero las asignaciones reales de usuarios (`user_roles`) usan **`director_ops, gerencia, jefe_deposito, rrhh_admin`**. Intersección con los grants de 0146 = **solo `director_ops`**. → Aplicar 0146 tal cual habilitaría Nexus Link a **solo 2 de 10 usuarios internos**; **`gerencia` (management) y `jefe_deposito` (operativo) quedarían SIN acceso**, + **3 usuarios sin ningún rol**.
- **Estrategia de activación progresiva (recomendada) — requiere DECISIÓN de Dirección antes de F3.2B:**
  - **Fase 0 (decisión):** ampliar el set de grants para incluir **`gerencia`** y **`jefe_deposito`** en `connect.view/create/edit` (son los roles operativos/management realmente asignados), **o** reasignar usuarios a roles ya cubiertos. Sin esto, la integración queda funcionalmente inerte para el 80% del staff.
  - **Fase 1 (piloto):** `admin` + `director_ops` (full). Ya cubiertos.
  - **Fase 2 (operativo):** `gerencia, jefe_deposito, operaciones, comercial, compliance, seguridad` → view/create/edit.
  - **Fase 3:** resolver los 3 usuarios sin rol (asignar rol o confirmar `isLegacyAdmin`).
- **Fail-closed (verificado por diseño):** sin filas `connect.*`, el módulo no se renderiza y los RPC niegan. La activación es **opt-in por rol**, reversible (delete grants).

## 5. Plan de ventana G3 (secuencia, checkpoints, abort, rollback)
**Pre-apply (gate):** (1) re-verificar `schema_migrations` (M-2, prod móvil); (2) confirmar PITR + marcar LSN/timestamp previo; (3) rama `feat/nexus-link-integration` creada; (4) decisión RBAC tomada (§4).
**Secuencia (un statement por vez, en orden):**
1. `0142` (tx aislada) → **CHECKPOINT C1:** verificar valor enum presente.
2. `0143`,`0144`,`0145` → **C2:** 11 tablas + RPCs + vistas existen; `get_advisors security` sin críticos; smoke RLS negativo (no-miembro = 0 filas).
3. `0146` → **C3:** 5 perms + grants; verificar nº de usuarios que reciben `connect.view` (§4).
4. `0147`,`0148` → **C4:** cols notifications + buckets + publicación realtime.
5. `0149` → **C5:** trigger/funciones; backfill no-op confirmado.
6. `0150`–`0154` → **C6:** RPCs features + cols profiles; smoke `set_my_presence`/`connect_search`.
**Criterios de abortar:** cualquier migración con error · advisor `security` crítico nuevo · smoke RLS/permiso falla · divergencia inesperada en `schema_migrations`.
**GO/NO GO entre pasos:** cada checkpoint debe pasar antes de avanzar; ante NO GO → detener y rollback del paso.
**Rollback paso a paso (orden inverso, `if exists`):** `0154→0153→…→0143` drops; `0146` delete grants/perms; `0147` drop cols + publication drop; `0148` delete buckets; **`0142` permanece** (enum inerte). Red de seguridad final: **PITR restore** al timestamp pre-apply.

## 6. Backup (verificación read-only)
- **PITR / WAL archiving:** ✅ **VERIFICADO operativo** — `pg_stat_archiver`: `archived_count=10537`, `failed_count=0`, último archivado **hoy 23:13**. Continuo y sano.
- **Backup lógico (daily):** feature de plataforma Supabase Pro — **no verificable por SQL** → confirmar retención en el dashboard antes de G3. *(Pendiente, no ejecuto backups sin autorización.)*
- **Backup de buckets:** storage NO está en PITR; pero RC1 **solo agrega** buckets nuevos (vacíos), no toca los existentes → **sin riesgo de pérdida** en este apply.
- **Procedimiento de recuperación:** PITR restore a timestamp previo (cubre cualquier escenario de apply). Marcar el timestamp/LSN antes de la ventana.

## 7. Riesgos remanentes
- 🔴 **RBAC-1 (decisión):** sin ampliar grants/reasignar, solo 2/10 usuarios ven Nexus Link → integración funcionalmente inerte. **Bloqueante de F3.2B.**
- 🟠 **OP-1 (prod móvil):** re-verificar `schema_migrations` al inicio de la ventana.
- 🟠 **GIT-1 (housekeeping):** al mergear RC1, traer `0141` de `feat/compliance-integration` (secuencia repo).
- 🟢 **ENUM-1:** `0142` irreversible (benigno, decisión permanente aceptada).
- 🟢 **BK-1:** confirmar backup lógico en dashboard (PITR ya cubre).

## 8. Estrategia de rollback (consolidada)
Lógico (preferido): delete grants `connect.*` / drop fns-trigger / desactivar fuente Knowledge / drop cols notifications-profiles / delete buckets / drop tablas connect — todo `if exists`, orden inverso. `0142` queda inerte. Datos de runtime: no existen al aplicar (greenfield). Red final: **PITR restore** al marcador pre-apply. Código/UI: revertible por git en la rama dedicada (sin deploy aún).

## 9. Recomendación GO / NO GO para F3.2B
**🟡 NO GO TODAVÍA — con camino claro.** La **preparación técnica está COMPLETA** y el apply es de **bajo riesgo** (greenfield, aditivo, segundos, PITR vivo, IR-1 cerrado). Pero el entorno **no queda "completamente preparado"** hasta cerrar **4 condiciones** (1 decisión-bloqueante + 3 procedimentales):
1. 🔴 **Decisión RBAC** (§4): definir grants reales (incluir `gerencia`/`jefe_deposito` o reasignar) — sin esto la integración es inerte para el 80% del staff.
2. ⏳ Crear rama `feat/nexus-link-integration`.
3. ⏳ Confirmar backup lógico en dashboard (PITR ya verificado).
4. ⏳ Autorización G3 de Dirección + re-verificar `schema_migrations` en la ventana.

## 10. Confirmación explícita
La **preparación técnica de F3.2A está completa y documentada** (preflight, matriz, operacional, plan G3, PITR verificado, rollback). **El proyecto NO queda aún completamente preparado para la integración real**: resta la **decisión RBAC** (bloqueante de usabilidad) y 3 condiciones procedimentales. **No se inicia F3.2B** hasta resolver esas condiciones y recibir autorización explícita. Checklist de precondiciones abajo.

### Checklist de precondiciones (Completo / Pendiente / Bloqueado)
| Precondición | Estado |
|---|---|
| IR-1 resuelto (sin conflicto con 0141) | ✅ Completo |
| Preflight + matriz de impacto 0142-0154 | ✅ Completo |
| Análisis operacional (locks/timing/orden) | ✅ Completo |
| Plan G3 (secuencia/checkpoints/abort/rollback) | ✅ Completo |
| PITR / WAL archiving verificado | ✅ Completo |
| Plan RBAC diseñado | ✅ Completo |
| **Decisión RBAC (scope de grants real)** | 🔴 **Bloqueado (requiere Dirección)** |
| Rama dedicada `feat/nexus-link-integration` | ⏳ Pendiente |
| Backup lógico confirmado (dashboard) | ⏳ Pendiente |
| Autorización G3 + re-verificación `schema_migrations` | ⏳ Pendiente |

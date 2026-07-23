# Run Log — Nexus Link RC1.0 (Fundación DB + RBAC + Integración Knowledge)

> **Base:** `release/nexus-base` (`55b7530`). **Proyecto:** `tops-ordenes-prod` / `arsksytgdnzukbmfgkju`.
> **Estado global:** **entregado-NO-aplicado** (G3). Nada aplicado a prod, nada mergeado a main, nada deployado.
> **Estándar:** mismo formato que `F05-E2-RUN-LOG.md`. Una entrada por hito; restore point entre hitos.

---

## Hito 0 — Materialización del paquete RC1.0 (diseño G7 aprobado)

| Campo | Valor |
|---|---|
| **Fecha** | 2026-06-29 |
| **G7** | Diseño RC1.0 aprobado por Dirección (D-RC1-1..7). |
| **Objetivo** | Materializar las migraciones `0142`–`0149` + ROLLBACK + kit de validación (entregado-no-aplicado). |
| **Decisiones nuevas incorporadas** | D-RC1-5 (contexto como principio: `create_conversation` con vínculo opcional; links polimórficos) · D-RC1-6 (`context_id` permanente `CTX-AAAA-NNNNNN`, secuencia + trigger + guard de inmutabilidad) · D-RC1-7 (AI-ready: `meta jsonb` en conversaciones/mensajes, historial append-only, `context_id` ancla RAG; **sin IA**). |
| **Archivos** | `supabase/migrations/0142_connect_module_enum.sql` · `0143_connect_schema.sql` · `0144_connect_rpc.sql` · `0145_connect_views.sql` · `0146_connect_rbac_seed.sql` · `0147_connect_notifications_ext.sql` · `0148_connect_storage.sql` · `0149_connect_knowledge_adapter.sql` · `ROLLBACK_0142_0149.md` · `docs/superpowers/RC1-0-VALIDATION-KIT.sql` · `docs/superpowers/plans/2026-06-29-nexus-link-rc1-0-foundation.md` |
| **Numeración** | Verificada contra base (`max=0140`) y prod en vivo (`max=0140`, `20260630004647`); `0141`=Compliance (paralelo). RC1 = `0142`–`0149`. Re-verificar `schema_migrations` al aplicar. |
| **Gates (código)** | typecheck/build/tests NO afectados por archivos `.sql` (no se importan en TS). La base ya estaba verde (typecheck 0 / build 0 / 337 tests). |
| **Aplicación a prod** | ⛔ PENDIENTE — requiere autorización expresa de Dirección. Aplicar a mano (G3) en orden `0142→0143→0144→0145→0146→0147→0148→0149`, luego correr el kit de validación read-only. |
| **Commit local** | ⛔ PENDIENTE — esperar autorización (igual que la consolidación). |
| **Restore point** | base de consolidación `55b7530` (sin tocar). Los archivos RC1.0 están **untracked** en el worktree `~/CODE/tops-ordenes-nexus-base`. |

**Notas / hazards:**
- `0142` (enum) DEBE aplicarse y commitearse en su propia transacción antes de `0146` (usa el valor `'connect'`).
- `0148` storage: backup propio de binarios OBLIGATORIO antes de operar adjuntos (no hay PITR de Storage).
- `0149` depende de Knowledge en prod (`knowledge_event_canonical`/`knowledge_emit_event`/`knowledge_visibility_for`/`knowledge_sources`) — verificado vivo (migs 0125-0140).

### Engineering Readiness Review (estándar E1/E2) — APROBADO PARA CIERRE

**Revisión adversarial multi-agente (read-only)** sobre las 8 migraciones + rollback + kit: 6 dimensiones (idempotencia/gobernanza, seguridad/RLS/hardening, fidelidad al spec, adapter Knowledge, Context ID/decisiones nuevas, consistencia cruzada), cada hallazgo verificado adversarialmente. **16 hallazgos · 8 confirmados (0 critical · 4 important · 4 minor).**

**Important — corregidos:**
1. `SEC-PARTICIPANTS-1` (0143): la policy RLS "update self" no acota columnas → un miembro podía `update … set member_role='owner'` directo (escalada). **Fix:** `revoke update on connect_participants from authenticated` + `grant update (last_read_seq, muted_until, notif_pref, is_favorite)` (privilegio por-columna; las RPC SECDEF corren como owner y no se afectan). *(defecto presente también en el spec aprobado)*.
2. `VIS-MAP` (0149): pasaba `entity_type` plural a `knowledge_visibility_for` (singular) → CRM caía a `'staff'` en vez de `'perm:comercial.view'`. **Fix:** normalizar plural→singular **solo** para la visibility; el `entity_type` almacenado queda en forma Connect (plural) para co-locar con los eventos audit-sourced en Entity360. *(2ª iteración: la 1ª versión normalizaba también el entity_type almacenado y rompía la co-locación — detectado por la verificación de fixes y corregido)*.
3. `RC1-6-NULLABLE-RERUN` (0143): `add column if not exists context_id text` (nullable) divergía del `not null`. **Fix:** eliminado (apply fresco; el unique index nombrado es la única fuente de unicidad).
4. `VK-CHECK4` (kit): el check SECDEF marcaba FALLO falso en 3 funciones que por diseño no son SECDEF. **Fix:** check (4) las excluye; nuevo check (4b) las valida por search_path.

**Minor:** índice unique duplicado sobre context_id → **eliminado** (se quitó el `unique` inline). `SEC-STORAGE-1` (scoping coarse de escritura PII) → **documentado** como flag aceptado (fiel al spec, sin fuga de lectura). `FID-2` (comentarios de gobernanza perdidos) → aceptado (cosmético; las policies son byte-idénticas al spec).

**Verificación de fixes (2º pase adversarial):** 4/4 fixes confirmados resueltos; 1 regresión de co-locación introducida por VIS-MAP detectada y **corregida**; re-verificado. **Estado al cierre: 0 Critical / 0 Important abiertos.** Flags residuales documentados: `FLAG-RC1-ENTITY360-VOCAB` (co-locación con entidades de adaptador dedicado, validar en RC1.3), `SEC-STORAGE-1`, nota operativa (no correr `GRANT UPDATE ON ALL TABLES` blanket post-0143).

**Veredicto:** **LISTO PARA CIERRE** (GO a aplicación de RC1.0 cuando Dirección autorice).

---

## Hito 1 — (PENDIENTE) Aplicación a prod + smoke
*(A completar cuando Dirección autorice la ejecución de RC1.0.)*

---

## Hito 2+ — (PENDIENTE) Implementación funcional RC1.1+
*(scaffolding `src/lib/connect/`, bandeja, hilo, etc. — espera autorización expresa, G7 por sub-fase.)*

# F3 · DEFECT-8 / DEFECT-9 / DEFECT-10 — Hotfix Plan (Admin surface from conversation view)

> Implementación **local** del hotfix DEFECT-8/9/10 (administración de canales/grupos inconsistente), autorizada por Dirección (2026-07-01).
> **Frontend, SIN migración. NO deploy/push/merge. NO tocar DB/RBAC/env. Prod intacta `18f3ae6`. F4 BLOQUEADA.**

---

## 0. Contexto

| Ítem | Valor |
|---|---|
| Worktree | `~/CODE/tops-ordenes-admin-surface-8-10` (sibling, aislado) |
| Branch | `hotfix/connect-admin-surface-defects-8-10` |
| Commit base | **`18f3ae6`** (= producción actual) |
| Migración | **NINGUNA** (frontend puro; `is_admin` y datos ya existen) |
| QA local | typecheck **0** · lint **0** (solo warnings pre-existentes ajenos) · tests **385** · build **exit 0** |
| Revisión adversarial | Workflow 3 dimensiones + verificación → **GO** (0 bloqueantes; 3 hallazgos BAJO, 1 corregido) |

---

## 1. Causa raíz (común)

La UI de administración de canal vivía **solo en `ChannelView`**, renderizado **solo en `/connect/canales/[slug]`** (kind=`channel`), con gate `canModerateActive = canModerate(myRole) && !archived` que consideraba **solo el `member_role` del canal** (owner/moderator), **ignorando `is_admin()`/superadmin**. La navegación principal (sidebar `ConversationList`) enruta **todo** a `/connect/c/[conversationId]`, que renderizaba **solo `ThreadView`** (sin controles). Los **grupos** (kind=`group`, `slug=null`) **no tenían ninguna superficie de administración**.

- **DEFECT-8:** `/connect/c/[id]` (destino del sidebar) sin controles de administración.
- **DEFECT-9:** `canModerate` ignora `is_admin` → superadmin no-owner no ve controles (los RPCs SÍ permiten `is_admin()`); grupos sin superficie.
- **DEFECT-10:** directorio = `v_connect_channels` (kind=channel, activo) vs sidebar = `v_connect_inbox` (participante) → grupos + archivados sin superficie de admin.

## 2. Cambios implementados (frontend, sin migración)

| Capa | Archivo | Cambio |
|---|---|---|
| Dominio | `domain/channel.ts` | **`canAdminister(myRole, isAdmin) = isAdmin || canModerate(role)`** (+3 tests TDD) |
| Componente | **`_components/ConversationAdmin.tsx`** (NUEVO) | Superficie de administración **compartida** para channel **y** group: extraída del "member view" de `ChannelView`, generalizada (opera por `conversationId`; sin slug/visibility para grupos; noun-aware "canal"/"grupo"; gate `canAdminister`; `archiveRedirectTo` parametrizado; prop opcional `links` para chips ERP). Incluye edición de nombre/tema, panel de miembros (add/remove/set-role), archivar, read-only si archivado. |
| Componente | `_components/ChannelView.tsx` | Refactor: conserva solo ramas específicas de canal (no-miembro **join** / archivado card), **delega** el member view a `ConversationAdmin` (`archiveRedirectTo="/connect/canales"`). Recibe `isAdmin`. (−237 líneas → extracción, no duplicación.) |
| Componente | `_components/ThreadView.tsx` | Banner archivado genérico ("Esta conversación está archivada…") — noun-agnóstico (fix hallazgo BAJO). |
| Ruta | `c/[conversationId]/page.tsx` | **DEFECT-8/9/10:** para kind channel/group → renderiza `ConversationAdmin` (carga `myRole`, `isAdmin`, `members`, `pinned`, `links`, `archiveRedirectTo="/connect"`). Para otras kinds (dm/erp/incident/whatsapp/ai) → header + `ThreadView` (comportamiento actual, intacto). |
| Ruta | `canales/[slug]/page.tsx` | Calcula `isAdmin=getProfileRole()==='admin'`; no-miembro **no-admin** → join view; miembro **o admin** → carga y pasa `isAdmin` a `ChannelView`. |

**Fuente de `isAdmin`:** `getProfileRole()` (ya existente en `rbac/boot-permissions.ts`, cache por request) → `=== "admin"`. Espeja `is_admin()` = `profiles.role='admin'`. **No** toca RBAC global ni `RBAC_ENFORCE`.

## 3. QA local
typecheck **0** · lint **0** nuevos · tests **385** (382 + 3 `canAdminister`) · build **exit 0**.

## 4. Revisión adversarial (workflow 3 dim + verificación)
**GO — 0 bloqueantes.** Constraint #1 (ningún control admin se filtra a no-autorizados) **verificada firme** en todas las affordances. 3 hallazgos, todos **BAJO / CONFIRMED**:

| # | Hallazgo | Sev. | Resolución |
|---|---|---|---|
| F-2 | `ThreadView` banner archivado hardcodeado a "canal" → grupo mostraba palabra incorrecta | BAJO | **CORREGIDO** (banner genérico "conversación"). |
| F-1 | No-miembro **no-admin** que abre un canal público por `/c/[id]` ve el shell de admin (todo deshabilitado, sin fuga) pero **sin botón "Unirme"** (el join solo vive en `/canales/[slug]`) | BAJO | **Residual documentado** — divergencia de UX, NO regresión (`/c/[id]` nunca tuvo join), NO fuga de permisos. Agregar join = scope creep. |
| F-3 | Admin **no-miembro** ve la superficie de admin con **hilo vacío** (`connect_messages` RLS exige membresía, sin fallback `is_admin()`) | BAJO | **Residual documentado** — arreglarlo requiere **cambio de RLS/migración = fuera de alcance/prohibido**; propiedad RLS preexistente, consistente entre rutas; el objetivo DEFECT-9 (administrar sin ser miembro) igual se cumple. |

## 5. Riesgos remanentes
- **F-1 (BAJO):** falta "Unirme" en `/c/[id]` para no-miembro no-admin de canal público (edge case: navegación manual por URL). Follow-up UX opcional.
- **F-3 (BAJO):** hilo vacío para admin no-miembro (RLS `connect_messages` sin `is_admin()` fallback). Follow-up requiere migración de RLS (fuera de alcance de este hotfix).
- Refactor de `ChannelView`: mitigado por extracción a componente compartido (sin duplicación) + QA + review; DEFECT-6/7 preservado.

## 6. Rollback
100% frontend, reversible por Netlify (re-publish del deploy previo `6a457264c194441f9a79c62f` / `18f3ae6`). Sin datos ni migración que revertir.

## 7. Smoke plan (ventana posterior — requiere sesión con login = Martín)
**Admin desde sidebar** (canal): abrir canal desde sidebar (`/connect/c/{id}`) → **controles visibles** (owner/mod/admin) → editar nombre / agregar miembro / archivar → confirmar cambios.
**Admin de grupo:** abrir grupo desde sidebar → controles visibles → editar nombre / agregar miembro / archivar → **funciona aunque no tenga slug**.
**Permisos:** superadmin administra cualquier canal/grupo; owner administra el suyo; moderator administra; **member NO ve acciones**; usuario sin permiso NO ve acciones.
**Archivado:** archivar → desaparece de activo → URL directa read-only → composer deshabilitado → sin acciones activas.
**Rename:** cambia nombre visible; slug estable si existe; reload persiste.
**Regresión:** `/connect/canales/[slug]` (editar/miembros/archivar/read-only/redirect/slug); `/c/[id]` para DM/ERP (header + hilo intactos); búsqueda/notificaciones/mensajes sin cambios; 0 errores consola; 0 5xx.

## 8. Recomendación GO / NO-GO
🟢 **GO** para ventana de deploy controlado (frontend, sin migración) — desbloquea DEFECT-8/9 (Alto) y mitiga DEFECT-10. Deploy con el procedimiento validado (Node 22 + checkout NO-worktree + draft-first → smoke → prod). Smoke UI autenticada de DEFECT-8/9/10 = Martín.

## 9. Confirmaciones
- ❌ deploy · push · merge · migración · cambios DB/RBAC/permisos/env/`RBAC_ENFORCE`. ✅ Prod intacta `18f3ae6`. 🚫 **F4 BLOQUEADA.**

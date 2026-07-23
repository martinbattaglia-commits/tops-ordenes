# F3 · DEFECT-6 & DEFECT-7 — Hotfix Plan (Archive + Rename)

> Implementación **local** del hotfix para los defects 6 y 7 del piloto Nexus Link F3, autorizada por Dirección (2026-07-01).
> **Producción NO modificada. `0159` NO aplicada. Sin deploy/push/merge. F4 BLOQUEADA.**
> Referencias: `F3-PILOT-DEFECTS-TRIAGE.md` (§DEFECT-6/§DEFECT-7), `F3-PILOT-VALIDATION-LOG.md`.

---

## 0. Contexto de trabajo

| Ítem | Valor |
|---|---|
| Worktree | `~/CODE/tops-ordenes-hotfix-defects-6-7` (sibling, aislado) |
| Branch | `hotfix/connect-archive-rename-defects-6-7` |
| Commit base | **`be405ba`** (prod intacta) |
| Migración | `supabase/migrations/0159_connect_archive_rename_hotfix.sql` (siguiente número libre; **ENTREGADA, NO APLICADA**) |
| QA local | typecheck **0** · lint **0** (solo warnings pre-existentes ajenos) · tests **382/382** · build **exit 0** |
| Metodología | worktree aislado + TDD en el núcleo testeable + revisión adversarial independiente |

---

## 1. Causa raíz

### DEFECT-6 — Archivar canal no se reflejaba en la UI
La DB archivaba correctamente (`connect_archive_conversation` → `archived_at = now()`, mig 0144), pero:
- **`v_connect_channels` (0145) NO exponía `archived_at`** → el directorio no podía saber ni filtrar el estado archivado.
- Los loaders **no filtraban** archivados: `listChannels` (directorio/Home) y `listInbox` (sidebar/favoritos/Home) traían todo.
- **`ChannelItem` no tenía `archivedAt`**, `ChannelView` no conocía el estado, no había badge/redirect/deshabilitación de composer.

Resultado: el canal archivado seguía apareciendo como activo. (`v_connect_inbox` **sí** exponía `archived_at` desde 0145 — solo faltaba usarlo.)

### DEFECT-7 — Editar canal cambiaba el tema, no el nombre
El nombre visible vive en `connect_conversations.title`; el slug en `.slug`; el tema en `.topic`. El botón "editar" del header llamaba a `connect_set_topic` → modificaba **`topic`**. **No existía RPC para renombrar** (`title`). El rename efectivamente no estaba implementado.

---

## 2. Cambios implementados

### DB (entregada, no aplicada)
**`supabase/migrations/0159_connect_archive_rename_hotfix.sql`** — idempotente, aditiva, sin borrar datos, sin tocar slugs, sin cambiar RLS:
- **DEFECT-6:** `create or replace view public.v_connect_channels` agregando `c.archived_at` (append al final → preserva columnas/orden/grants; mantiene `security_invoker=true`). Re-aserción idempotente `grant select … to authenticated`.
- **DEFECT-7:** `create or replace function public.connect_set_title(p_conversation_id uuid, p_title text)`:
  - `SECURITY DEFINER` · `set search_path = public, pg_temp` · `revoke all … from public, anon, authenticated` + `grant execute … to authenticated` (espejo exacto del envelope de `connect_set_topic`).
  - **Gate owner/moderator/admin NULL-safe** (`is distinct from` → un no-miembro con `member_role` NULL queda **rechazado**; endurece, no ensancha).
  - Validación: no vacío + `btrim` + `left(...,120)`.
  - **Bloquea renombrar canales archivados.**
  - **`update … set title` — NUNCA slug ni topic.**

### Frontend / capa de datos (16 archivos)
| Capa | Archivo | Cambio |
|---|---|---|
| Dominio | `domain/channel.ts` | `MAX_TITLE_LENGTH=120` + `normalizeTitle()` (TDD) |
| Aplicación | `application/channel-use-cases.ts` | `SetTitleUseCase` + `channelOps.title` (TDD) |
| Puerto | `ports/channel-ops-port.ts` | `setTitle()` en `ChannelOpsPort` |
| Adapter | `adapters/supabase/connect-ops.adapter.ts` | `setTitle` → RPC `connect_set_title` |
| Action | `adapters/driving/channel-actions.ts` | `setTitleAction` (zod `min(1).max(120)`, guard `connect.edit`, revalidate) |
| Tipos | `types.ts` | `ChannelItem.archivedAt: string \| null` |
| Loader | `read/inbox-data.ts` | `listInbox` filtra `archived_at is null`; `listChannels` selecciona/filtra/mapea `archivedAt`; `mapChannel` + `CHANNEL_VIEW_COLS` compartidos |
| Loader | `read/channel-data.ts` | `listChannelDirectory` excluye archivados; nuevo **`getChannelBySlug`** (incluye archivados → vista read-only por URL) |
| Componente | `_components/ChannelView.tsx` | edición de **título** (DEFECT-7) · badge "Archivado" + banner · toda moderación deshabilitada si archivado (`canModerateActive`) · **redirect a `/connect/canales` tras archivar** · `readOnly` al hilo |
| Componente | `_components/ThreadView.tsx` | prop `readOnly` → composer reemplazado por aviso "solo lectura" + guard en `send()` |
| Ruta | `canales/[slug]/page.tsx` | usa `getChannelBySlug` (resuelve archivados → read-only) |
| Ruta | `c/[conversationId]/page.tsx` | chip "Archivado" + `readOnly={!!archivedAt}` |
| Mocks | `mock.ts`, `channel-mock.ts` | `archivedAt` en los builders demo |
| Tests | `domain/channel.test.ts`, `application/channel-use-cases.test.ts` | +4 tests (normalizeTitle, SetTitleUseCase) |

**Separación conceptual respetada:** `title` (nombre visible) · `topic` (tema/descripción) · `slug` (URL estable). El rename cambia solo `title`; el slug/URL no cambia.

---

## 3. QA local (Etapa 4)

| Check | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ 0 errores |
| Lint | `npm run lint` | ✅ 0 nuevos (solo warnings `alt-text` pre-existentes en `PoPdfDocument`/`PodPdfDocument`, ajenos) |
| Tests | `npm test` | ✅ **382 passed** (378 baseline + 4 nuevos) / 57 files |
| Build | `npm run build` | ✅ exit 0 (route table + middleware emitidos) |

---

## 4. Validación SQL (Etapa 5 — estática/local, sin tocar prod)

- **Compatibilidad `CREATE OR REPLACE VIEW`:** `v_connect_channels` **no se redefine** en ninguna migración entre 0146–0158 (solo 0145 y ahora 0159) → la definición viva = 0145 (8 columnas en el orden preservado); 0159 solo **agrega `archived_at` al final** → compatible; grants preservados.
- **`connect_conversations.archived_at`** existe (0143:78, `timestamptz`) con **índice parcial `where archived_at is null`** (0143:98) → respalda los filtros `.is("archived_at", null)`.
- **`slug` único** (`unique index on lower(slug) where slug is not null`, 0143:93) → `getChannelBySlug(...).maybeSingle()` seguro.
- **`connect_set_title`** libre (solo en 0159); `is_admin()` y `connect_member_role_t` existen (0143/0144).

**Kit de validación read-only post-apply** (para correr en el SQL Editor DESPUÉS de aplicar 0159; entregado, lo corre Martín) — ver §8.

---

## 5. Revisión adversarial (Etapa 6 — Code Reviewer independiente)

**Veredicto: GO.** Las 5 restricciones duras verificadas limpias (sin hard delete; rename solo `title`; envelope SECDEF correcto; RLS intacta `security_invoker`; vista append-only + grants). El gate NULL-safe de `connect_set_title` confirmado como **más robusto** que `connect_set_topic`.

| # | Hallazgo | Sev. | Resolución |
|---|---|---|---|
| R-1 | **Deploy-ordering:** el frontend selecciona/filtra `archived_at` de `v_connect_channels`; si se deploya antes de aplicar 0159, el **directorio** y **canal-por-slug** quedan vacíos/"no existe" (degrada con gracia, **sin 5xx**). Sidebar/Home/favoritos **no** afectados (leen `v_connect_inbox.archived_at`, que ya existía). | **Alto** (operacional) | **Condición GO/NO-GO:** aplicar 0159 **antes** del deploy. No es bug de código. Ver §9. |
| R-3 | **Sin bloqueo server-side de envío a archivados:** `connect_post_message` (0144) no chequea `archived_at`; el read-only es solo de UI (bypass vía RPC directa o carrera optimista). | **Medio** | **Residual — NO corregido** (tocar `connect_post_message`, RPC hot-path de todos los envíos, viola "no tocar otros módulos / cambios mínimos"). Para el piloto, la deshabilitación de UI cumple "no se puede enviar mensaje" (staff-only, 0 clientes). **Follow-up recomendado:** guarda `archived_at is null` en `connect_post_message` (+ pin/react/edit). |
| R-2 | Archived leak en Centro de Notificaciones: `notifications/data.ts:50` lee `v_connect_inbox` con `.gt("unread_count",0)` sin filtrar archivados → un canal archivado con no-leídos puede aparecer como notificación. | Medio/Bajo | **Residual — NO corregido** (módulo `notifications`, fuera de alcance). Fix exacto de 1 línea: agregar `.is("archived_at", null)` (la vista ya expone la columna, sin dependencia de 0159). Recomendado a Dirección. |
| — | Gate NULL-safe; asimetría longitud DB-trunca vs app-rechaza; empty triple-guardado | Bajo | Verificados correctos/cosméticos → sin acción. |

---

## 6. Riesgos remanentes

1. **R-1 (Alto, operacional):** orden de aplicación migración→deploy. Mitigación: aplicar `0159` primero, verificar con el kit §8, luego deploy. **Es la condición central del GO.**
2. **R-3 (Medio):** envío a archivado no bloqueado server-side (residual, follow-up).
3. **R-2 (Medio/Bajo):** notificaciones de canales archivados (residual, otro módulo).
4. **DEPLOY-1 (Alto, conocido):** outage por toolchain/worktree en deploys Netlify (histórico F3). Mitigación: procedimiento validado — **Node 22 + checkout NO-worktree + draft-first**.
5. **Numeración de migración:** local usa `0159`; **prod usa timestamps** (landmine conocido) → al aplicar, el nombre en `schema_migrations` se reconcilia (como 0156/0157/0158). No bloqueante.

---

## 7. Rollback

- **Migración 0159 (si se aplica):** reversible/idempotente.
  - Vista: `create or replace view public.v_connect_channels … (sin la columna archived_at)` = restaurar la definición de 0145. **Ojo:** si el frontend ya está deployado, quitar la columna rompe los loaders → revertir **frontend primero, luego vista**.
  - RPC: `drop function if exists public.connect_set_title(uuid, text);`.
- **Frontend:** reversible por Netlify (re-publish del deploy sano previo). Sin datos que revertir.
- **Datos:** nada que revertir (archive es lógico; rename solo cambia `title`, sin destruir slug/topic).

---

## 8. Kit de validación read-only (post-apply 0159 — lo corre Martín)

```sql
-- 1. La vista expone archived_at
select case when exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='v_connect_channels' and column_name='archived_at'
) then 'OK' else 'FALLO' end as chk_view_archived_at;

-- 2. authenticated conserva SELECT sobre la vista
select case when exists (
  select 1 from information_schema.role_table_grants
  where table_schema='public' and table_name='v_connect_channels'
    and grantee='authenticated' and privilege_type='SELECT'
) then 'OK' else 'FALLO' end as chk_view_grant;

-- 3. connect_set_title: existe, SECURITY DEFINER, search_path fijo, firma
select p.proname, p.prosecdef as is_secdef, p.proconfig as settings,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='connect_set_title';

-- 4. Grants de EXECUTE (esperado: authenticated=true; anon=false)
select r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     (values ('anon'),('authenticated'),('service_role')) as r(rolname)
where n.nspname='public' and p.proname='connect_set_title';

-- 5. Smoke de lectura como sesión real (NO SQL Editor, que es BYPASSRLS):
--    desde la app autenticada → select archived_at from v_connect_channels limit 1;  → sin error 42703.
```

---

## 9. Smoke plan (Etapa 7 — ventana posterior, tras aplicar 0159 + deploy controlado)

> **No ejecutable en esta sesión:** el dev local apunta al Supabase **prod**, y `listChannels`/`getChannelBySlug` requieren `0159` aplicada (que NO estoy autorizado a aplicar). Se entrega para la ventana. Usar canal de prueba `[PRUEBA-F3]`.

**DEFECT-6 — Archivar:**
- [ ] Archivar canal desde el header → confirmación → confirmar.
- [ ] DB: `select archived_at from connect_conversations where id=…` → seteado.
- [ ] **Redirige** fuera del canal (al directorio `/connect/canales`).
- [ ] Desaparece del **directorio**.
- [ ] Desaparece del **sidebar** (bandeja) y de Home/Favoritos.
- [ ] Reload → **no** reaparece como activo.
- [ ] URL directa a `/connect/canales/<slug-archivado>` → vista **"Archivado" read-only**: composer deshabilitado, sin acciones activas, **no** se puede enviar mensaje.
- [ ] 0 errores de consola · 0 500/502.

**DEFECT-7 — Renombrar:**
- [ ] Abrir canal → header → "editar" (junto al nombre) → cambiar nombre → guardar (✓).
- [ ] Cambia en **header**, **sidebar/directorio** (tras revalidate/refresh).
- [ ] DB: `select title, slug, topic from connect_conversations where id=…` → **`title` cambió**, **`slug` intacto**, **`topic` intacto**.
- [ ] URL/`slug` sigue funcionando (no cambió).
- [ ] Reload → conserva el nuevo nombre.
- [ ] Nombre vacío → error claro; canal archivado → no permite renombrar.
- [ ] 0 errores de consola · 0 500/502.

---

## 10. Recomendación GO / NO-GO

**🟢 GO** para la ventana de aplicación + deploy controlado, **con la secuencia obligatoria**:

1. **Aplicar `0159` a prod PRIMERO** (SQL Editor / `apply_migration`) — es aditiva y **backward-compatible** (el frontend viejo ignora la columna nueva).
2. **Correr el kit §8** → confirmar vista + RPC + grants.
3. **Deploy controlado del frontend** (Node 22 + NO-worktree + draft-first → smoke draft → `--prod` → smoke prod → rollback a deploy sano ante fallo).
4. **Smoke §9** (DEFECT-6 + DEFECT-7).

**NO GO** desplegar el frontend antes de aplicar `0159` (R-1: blanquea directorio/canal-por-slug).

Follow-ups recomendados (NO bloquean el piloto, decisión de Dirección): R-3 (guarda archived en `connect_post_message`), R-2 (`.is("archived_at",null)` en `notifications/data.ts`).

---

## 11. Estado / confirmaciones

- ❌ **Deploy productivo NO realizado.**
- ❌ **Migración `0159` NO aplicada a Supabase prod** (`arsksytgdnzukbmfgkju`).
- ❌ Sin push · sin merge · sin cambios directos en prod · sin cambios de RBAC/env · `RBAC_ENFORCE` intacto.
- ✅ Producción intacta en `be405ba`.
- 🚫 **F4 sigue BLOQUEADA** hasta el cierre formal de F3.

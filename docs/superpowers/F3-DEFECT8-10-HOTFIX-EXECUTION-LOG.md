# F3 · DEFECT-8/9/10 — Hotfix Execution Log (ventana de deploy)

> Ventana de deploy controlado autorizada por Dirección (2026-07-01). Frontend puro, **SIN migración**.
> Resultado: **frontend `a6c23f9` PUBLICADO EN PROD, 0 5xx.** Pendiente: smoke UI autenticada (Martín). **F4 BLOQUEADA.**

---

## Resumen

| Fase | Resultado |
|---|---|
| Pre-flight (Etapa 1) | ✅ prod `18f3ae6` sana · `0159` sigue aplicada · worktree `a6c23f9` limpio sin package/migración · Node 22 · Netlify auth OK |
| Checkout deploy (Etapa 2) | ✅ `deploy-f3-nexus-clean` NO-worktree @ `a6c23f9`, limpio, deps válidas |
| Deploy DRAFT (Etapa 3) | ✅ `6a45817a2599675689109206` |
| Smoke DRAFT (Etapa 4) | ✅ `/api/version`=`a6c23f9`, 0 5xx |
| Deploy PROD (Etapa 5) | ✅ `6a45820a7b7b7de8d59c6160` |
| Smoke PROD base (Etapa 6) | ✅ `a6c23f9` live, 0 5xx (10 rutas) |
| Smoke UI autenticada (Etapa 7) | ⏳ **pendiente — Martín** (requiere login; no se piden credenciales; no se suplantan usuarios) |
| Rollback | **NO requerido** |

## Detalle

### Etapa 1 — Pre-flight (✅)
- Prod: `/api/version`=`18f3ae6` env=production; `/login` 200; `/connect` 307 fail-closed.
- DB (read-only): `v_connect_channels.archived_at`=true, `connect_set_title` existe, `connect_search` ok, `schema_migrations`=`20260701195010` (`0159` sigue). **Sin cambios de DB en esta ventana** (frontend puro).
- Worktree `tops-ordenes-admin-surface-8-10` @ `a6c23f9`, limpio; diff `18f3ae6..a6c23f9` **sin package/env/migration**.
- Node v22.23.1; Netlify auth = Martin Battaglia, site `tops-ordenes` (`d84a7d34-b90c-4e61-aff6-678abf1ac432`).

### Etapas 2-5 — Deploy controlado (✅)
- Checkout NO-worktree `~/CODE/deploy-f3-nexus-clean` → `fetch` + `checkout a6c23f9`, tree limpio; `package-lock` idéntico → `node_modules` reutilizado (sin `npm ci`).
- **Rollback point** capturado: deploy publicado `6a457264c194441f9a79c62f` (`18f3ae6`).
- **DRAFT** `netlify deploy --build` → `6a45817a2599675689109206`, URL `https://6a45817a2599675689109206--tops-ordenes.netlify.app` (build 1m22s).
  - Smoke DRAFT: `/api/version`=`a6c23f9`; `/login` 200; `/connect*`+`/dashboard` 307 fail-closed; `/api/today` 401; **5xx=0**.
- **PROD** `netlify deploy --build --prod` → deploy **`6a45820a7b7b7de8d59c6160`**, `https://nexus.logisticatops.com` ("Deploy is live!").

### Etapa 6 — Smoke PROD base (✅)
`/api/version`=**`a6c23f9`** env=production; 10 rutas (`/`,`/login`,`/dashboard`,`/connect`,`/connect/canales`,`/connect/buscar`,`/connect/notificaciones`,`/connect/actividad`,`/connect/favoritos`,`/api/today`): `/login` 200, resto 307/401; **5xx=0**.

### Etapa 7 — Smoke UI autenticada (⏳ PENDIENTE — Martín)
DEFECT-8/9/10 es **frontend puro** (gating de UI + routing); no hay comportamiento de capa de datos nuevo que validar por SQL. La validación es de UI y requiere sesión con login. **Checklist exacto:**
- **Admin desde sidebar (canal):** abrir canal desde el sidebar (`/connect/c/{id}`) → aparecen controles (editar nombre/tema, miembros, archivar) → editar nombre cambia el header, slug estable, persiste al recargar.
- **Admin de grupo:** abrir grupo desde el sidebar → aparecen controles → editar nombre / agregar miembro / archivar → funciona **aunque no tenga slug**.
- **Permisos:** superadmin (martin) administra cualquier canal/grupo; owner administra el suyo; moderator administra; **member común NO ve acciones**; usuario sin permiso NO ve acciones.
- **Archivado:** archivar canal/grupo de prueba → redirect + read-only + composer deshabilitado + desaparece de activo.
- **Regresión:** `/connect/canales/[slug]` sigue OK; `/c/[id]` de DM/ERP sin cambios; búsqueda/notificaciones/mensajes OK; 0 errores consola.

## Riesgos remanentes (residuales BAJO — follow-up, fuera de alcance de esta ventana)
- **F-1:** `/c/[id]` sin botón "Unirme" para no-miembro **no-admin** de canal público (edge case; no regresión, no fuga).
- **F-3:** hilo vacío para admin **no-miembro** (RLS `connect_messages` sin fallback `is_admin`); arreglo requiere migración RLS.

## Estado
- ✅ frontend `a6c23f9` publicado (deploy `6a45820a7b7b7de8d59c6160`), **0 5xx**, rollback NO usado (point `6a457264c194441f9a79c62f`).
- Sin migración/DB/RBAC/env. Migs prod: 0156/0157/0158/0159 (inalteradas).
- ⏳ Smoke UI autenticada = Martín. 🚫 **F4 BLOQUEADA.**

## Recomendación
🟢 **GO condicional para continuar la validación manual de 7 usuarios**, sujeto a la smoke UI autenticada de DEFECT-8/9/10 (Martín) confirmando controles de admin desde sidebar (canales y grupos), gating de permisos (superadmin/owner/moderator sí; member/no-autorizado no), y rename/archivado. Si la smoke UI falla → frontend reversible (re-publish de `6a457264c194441f9a79c62f`).

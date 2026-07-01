# F3 · Pilot Defects — Hotfix Execution Log

> Registro de la ventana de aplicación del hotfix de defects piloto (A+B+C+D), autorizada por Dirección.
> **2026-07-01. Resultado: ✅ ÉXITO — hotfix aplicado y publicado; los 4 defects corregidos y validados en producción; sin rollback.**
> Referencias: `F3-PILOT-DEFECTS-TRIAGE.md`, `F3-PILOT-DEFECTS-HOTFIX-PLAN.md`, `F3-PILOT-VALIDATION-LOG.md`.

---

## Etapa 1 — Pre-flight (✅)
Prod `88add4b` · `0158` NO aplicada (rpc inexistente) · `0156`/`0157` aplicadas · `connect_search('mensaje')`→1 · working tree = 9 archivos del hotfix, sin package/secretos. Topología: `W`=worktree (no deploy), `D` (deploy-f3-nexus-clean)=clon NO-worktree, origin local.

## Etapa 2 — Commit local (✅)
`6131248` `fix(connect): repair pilot defects before F3 closure` (9 files, +552/-25). Working tree limpio. Sin push/merge.

## Etapa 3 — Migración `0158` (✅)
`apply_migration(0158_connect_member_profile_search)` → `{"success": true}`. En `schema_migrations`. RPC `connect_search_profiles`: `returns (profile_id, full_name)` **sin email**, SECDEF, `search_path` público, gate `connect.view`, grants a `authenticated`.

## Etapa 4 — Smoke RPC (✅)
| Término | Resultado |
|---|---|
| returns_cols | `TABLE(profile_id uuid, full_name text)` → **NO devuelve email** ✅ |
| jose / ruth / cynthia | 1 c/u (joseluis / Ruth Carrasquero / Cynthia Alba) ✅ |
| `@logisticatops` (email parcial) | 8, devuelve **nombres** (busca por email sin enumerarlo) ✅ |
| `%` / `_` (1 char) | 0 (mínimo 2 chars) ✅ |
| `%e` (escape wildcard) | 0 (**escape LIKE OK**, sin barrido) ✅ |
| externos | excluidos ✅ · sin error SQL/5xx ✅ |

## Etapa 5 — Deploy DRAFT (✅)
Sync de `D` al hotfix `6131248` (ff-only, sin push a github). `netlify deploy --build` (Node 22, NO-worktree, sin `--prod`) → **Deploy is live** 1m24s, exit 0, **sin outage/502**. Draft URL: `https://6a4494d969bd560573ad1c52--tops-ordenes.netlify.app` (deploy `6a4494d969bd560573ad1c52`).

## Etapa 6 — Smoke DRAFT (✅)
`/api/version` del draft = **`6131248`** (corresponde al hotfix) · `/login` 200 · `/connect`, `/connect/notificaciones`, `/connect/canales`, `/dashboard`, +preexistentes → 307→login · `/api/today` 401 · **0 5xx**. Build sano (95 páginas). *(Checks autenticados diferidos a PROD: el subdominio draft no comparte la cookie de sesión.)*

## Etapa 7 — Deploy PROD (✅)
`netlify deploy --build --prod` (mismo Node 22 / checkout / commit `6131248`) → **Deploy is live** 1m15s, exit 0. Production URL `https://nexus.logisticatops.com` · deploy **`6a4495b871ec7a0dfd2490bf`**. Rollback point = deploy `6a446ca4aa6e4e9f3b21711f` (`88add4b`) — **NO usado**.

## Etapa 8 — Smoke PROD (✅ — los 4 defects validados autenticados)
- **Salud base:** `/api/version`=**`6131248`** · `/login` 200 · protegidas 307→login · `/api/today` 401 · **0 5xx**.
- **DEFECT-1 (notificaciones):** `/connect/notificaciones` (sesión `martin@`) → **renderiza el Centro de Notificaciones, SIN error boundary, 0 errores de consola** (antes: error boundary + error realtime). ✅
- **DEFECT-2 (identidad):** panel de miembros muestra **"martin@logisticatops.com"** y **"Ruth Carrasquero"** (full_name vía `profiles_public`), **NO el UUID**. ✅
- **DEFECT-3 (autocomplete):** tipear "rut" → sugiere **"Ruth Carrasquero"** (nombre, **sin email**); agregar → Ruth aparece como miembro por su nombre (add end-to-end OK); **NO auto-add** (tipear "cynthia" sin cliquear → DB sigue en 1 miembro). ✅
- **DEFECT-4 (mensajes):** el autocomplete reemplaza el flujo del genérico "Datos inválidos"; ayuda clara "Solo usuarios internos…". ✅
- **Regresión búsqueda:** `/connect/buscar?q=mensaje` → **"1 resultado"** (connect_search 0156/0157 sigue OK). ✅
- **Cleanup:** Ruth removida (`Miembros · 1`); sin datos nuevos persistidos por el smoke (el canal `[PRUEBA-F3]` y su mensaje son de una ventana previa).
- **0 500/502 · 0 errores críticos de consola · rollback NO requerido.**

## Etapa 9 — Estado / criterio de éxito (CUMPLIDO)
`0158` aplicada ✅ · `connect_search_profiles` funciona y **no expone email** ✅ · DRAFT pasó ✅ · PROD pasó ✅ · notificaciones no rompen ✅ · miembros no muestran UUID ✅ · autocomplete funciona ✅ · 0 500/502 ✅ · rollback no requerido ✅.

**Producción: `6131248` (deploy `6a4495b871ec7a0dfd2490bf`).** Migraciones aplicadas: `0156`/`0157`/`0158`. **F4 sigue BLOQUEADA.** Docs post-deploy sin commitear (pendiente autorización).

## Próximo paso
Los 4 defects bloqueantes están corregidos y validados → **F3 en condiciones reales para la validación manual de los 7 usuarios** (`F3-PILOT-MANUAL-VALIDATION-PACK.md`). Tras el piloto aprobado + aceptación de deudas + aprobación de Dirección → cierre formal de F3 → recién F4.

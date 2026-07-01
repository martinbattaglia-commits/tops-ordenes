# Reporte de Deploy DRAFT — Nexus Link RC1 / F3 (Opción D, draft-first)

> Release Engineer · 2026-07-01. **Ejecutado SOLO hasta DRAFT.** Producción NO tocada. Sin `--prod`, sin promover, sin push/merge.

## 1. URL del draft
**`https://6a4466e2096418cbe00716e0--tops-ordenes.netlify.app`** (preview aislada del sitio `tops-ordenes`; NO afecta nexus.logisticatops.com).
- Build logs: `https://app.netlify.com/projects/tops-ordenes/deploys/6a4466e2096418cbe00716e0`.

## 2. Commit exacto desplegado
**`88add4b`** (rama `feat/nexus-link-integration`) — verificado en vivo: `GET <draft>/api/version` → `{"version":"88add4b",...}`.

## 3. Versiones del toolchain (endurecido)
| Componente | Versión | Nota |
|---|---|---|
| Node | **v22.23.1** (keg `@22`) | ✅ el requerido (no el default v26.4.0) |
| npm | 10.9.8 | |
| netlify-cli | 26.0.2 | corrió bajo node-v22.23.1 |
| @netlify/plugin-nextjs | resuelto por `netlify build` (NO pinneado) | pinnearlo exige tocar el repo → **regla #4: no lo hice**; el draft valida el artefacto igual |
| Checkout | `~/CODE/deploy-f3-nexus-clean` | **NO-worktree** (`.git` es dir REAL) — neutraliza el factor worktree del outage |

## 4. Resultado del build
- Build local (node 22): typecheck **0** · lint **0 err / 0 warnings RC1** · tests **verdes** · `next build` **Compiled successfully** (banner `sha=88add4b`).
- `netlify deploy --build` (draft): **Netlify Build Complete en 1m 31.7s** · **Deploy is live** · **SIN** `ENOENT run-config.json` / `PLUGIN_DIR` / `Failed` / 502. → **El toolchain que rompió prod el 30/06 funcionó** bajo node 22 + no-worktree.
- *(Workaround transparente: `npm ci` falló por lockfile pre-existente desincronizado (`picomatch`); usé `npm install` en el CLON DESECHABLE — el lockfile del repo real quedó intacto (0 cambios).)*

## 5. Resultado de los smoke tests (sobre el DRAFT)
- **Trazabilidad:** `/api/version` = `88add4b` ✅.
- **Health matrix (unauth):** `/login` 200 · `/api/version` 200 · `/` 307 · **10 rutas `/connect` → 307** (redirect a login = middleware + fail-closed) · pre-existentes (ejecutivo/orders/compras/anmat/knowledge) 307 (**sin regresión**). **0 respuestas 5xx.** ✅
- **Cliente:** `/login` renderiza ("Acceso corporativo · TOPS NEXUS"), **0 errores de consola**. ✅
- *No se probó la UI AUTENTICADA (Nexus Link visible / RBAC por usuario): requiere login de usuarios reales = fase de validación PILOTO, post-deploy a prod.*

## 6. Errores encontrados
**Ninguno** en build ni deploy ni smoke. (El `npm ci` fue un desajuste de lockfile pre-existente, resuelto con workaround controlado; no es error del artefacto.)

## 7. Riesgos remanentes
- 🟢 **DEPLOY-1: mitigado y DEMOSTRADO** — el pipeline completo (plugin bajo node 22 + no-worktree) produjo un artefacto sano en el draft. El outage NO se reprodujo.
- 🟠 **Plugin sin pinnear:** el draft funcionó con la versión que `netlify build` resolvió; para máxima repetibilidad convendría pinnear `@netlify/plugin-nextjs` a esa versión antes de prod — **requiere cambio de repo → pediría autorización** (regla #4). Sin pin, el draft-first sigue siendo la red.
- 🟠 **`next@14.2.18`** con aviso de seguridad (deprecation) — **pre-existente** (el mismo Next que corre en prod `c310589`); fuera del alcance de connect, a tratar por separado.
- 🟢 UI autenticada/RBAC → validación piloto (post-prod).

## 8. Recomendación GO / NO GO para PRODUCCIÓN
**🟢 GO (condicionado a tu autorización explícita).** El draft **prueba** que el toolchain endurecido genera un artefacto funcional y trazable, con producción intacta. La promoción a prod sería **la misma pipeline + `--prod`** desde el mismo checkout limpio (node 22), con rollback 1-click a `c310589` disponible. **No promuevo hasta tu autorización.**

---
## Confirmación (según lo pedido)
**B) El DRAFT PASÓ. Producción sigue INTACTA** (`nexus.logisticatops.com` = `c310589`, sin cambios). El sistema queda **listo para pedir la autorización final de deploy a producción**.

### Procedimiento exacto de promoción a prod (cuando se autorice)
Desde `~/CODE/deploy-f3-nexus-clean` con `PATH=/opt/homebrew/opt/node@22/bin:$PATH`:
1. (opcional, si se autoriza) pin de `@netlify/plugin-nextjs` a la versión que usó este draft.
2. `npx netlify deploy --build --prod --site d84a7d34-b90c-4e61-aff6-678abf1ac432`
3. `curl -s https://nexus.logisticatops.com/api/version` → debe devolver `88add4b`.
4. Smoke en prod (misma matriz) + validación piloto (7 usuarios).
5. Rollback si algo falla: dashboard Netlify → deploy `c310589` → **Publish deploy**.

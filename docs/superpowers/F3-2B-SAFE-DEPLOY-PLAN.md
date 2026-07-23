# Plan de Deploy Seguro — Nexus Link RC1 / F3 (cierre de DEPLOY-1)

> Release Engineer · 2026-07-01. **Read-only / solo preparación.** Nada ejecutado: sin deploy/push/merge/prod. A la espera de autorización posterior para publicar.
> Contexto: prod SANO hoy (`c310589`); capa DB de connect ya aplicada (G3); el outage del 30/06 se atribuyó al toolchain Netlify + deploy desde worktree.

## 1. Deploy Risk Mitigation Plan — anatomía de DEPLOY-1
**Causa raíz del outage 30/06 (3 factores concurrentes, según diagnóstico previo):**
1. **Toolchain local:** `@netlify/plugin-nextjs` (5.15.12) bundleado por `netlify-cli` (26.1.0) bajo **node local muy nuevo** (v25.8.1) → artefacto roto (`ENOENT run-config.json`, `PLUGIN_DIR`→`/`).
2. **Deploy desde WORKTREE:** el `.git` de un worktree es un archivo (no dir) → el plugin resolvió mal `PLUGIN_DIR` (lead de foros 164135/129530: correr el CLI desde la RAÍZ del repo).
3. **Rollback difícil:** artefactos pre-incidente purgados en ese caso puntual.
**Estado actual del toolchain (empeora factor 1 y 2):** node local **v26.4.0** (aún más nuevo), netlify-cli **26.0.2**, deploy saldría del **worktree** `tops-ordenes-nexus-base`. Método establecido (RELEASE.md) = **CLI manual con build local** → usa exactamente ese toolchain.
**Principio de mitigación:** neutralizar los 3 factores + **nunca tocar prod hasta validar el artefacto en un entorno de preview.**

## 2. Comparativa de alternativas
| Opción | Riesgo | Ventajas | Desventajas | Reversibilidad | Impacto prod | ¿push/merge? | Dep. toolchain local | vs incidente 30/06 |
|---|---|---|---|---|---|---|---|---|
| **A) Deploy desde raíz del repo (no worktree)** | Medio | Elimina factor 2 (worktree) | El código connect vive en el worktree; requiere checkout no-worktree del commit (clonar/copiar) | Re-publish deploy previo (dashboard) | Directo si va a --prod | No (si se copia local) | **Alta** (sigue node/cli local) | Cierra factor 2, NO 1 |
| **B) Git-based (Netlify buildea)** | **Bajo** | Netlify buildea en **node-22 controlado** (netlify.toml), repetible, **cero toolchain local**; historial de deploys → rollback 1-click | Requiere **push** de la rama + configurar el sitio para build git (hoy es CLI-only → cambia el modelo de deploy; posibles auto-deploys futuros) | **Excelente** (publish deploy anterior desde UI) | Controlado (build server-side) | **Sí (push)** | **Nula** | Cierra factores 1 y 2 |
| **C) Pin `@netlify/plugin-nextjs` a versión buena** | Medio | Fija el plugin (evita 5.15.12 roto) | No neutraliza node local ni worktree por sí solo; hay que saber la versión buena | Igual que el método base | Igual | No | Alta | Cierra factor 1 (parcial) |
| **D) CLI endurecido: node 22 (nvm) + pin plugin + no-worktree + DRAFT-first** | **Bajo** | Neutraliza los 3 factores SIN push; **draft deploy valida el artefacto en URL de preview antes de tocar prod** | Más pasos manuales; requiere disciplina del runbook | Muy buena (draft no toca prod; y rollback = re-publish previo) | **Nulo hasta promover** (draft primero) | **No** | Media (controlada por nvm/pin) | Cierra los 3 factores |

## 3. Estrategia recomendada — **Opción D (CLI endurecido con DRAFT-first)**; B como alternativa si Dirección autoriza push
**Por qué D (no por comodidad, por seguridad/control/repetibilidad/rollback):**
- **Estabilidad de prod:** el **draft deploy** (`netlify deploy` SIN `--prod`) publica a una **URL de preview temporal**; si el toolchain produce un artefacto roto, **rompe el draft (inocuo), NO prod**. Prod solo se toca al PROMOVER un draft ya validado.
- **Control del toolchain:** `nvm use 22` (matchea el target `nodejs22.x` y evita la novedad de node-26) + **pin de `@netlify/plugin-nextjs`** a versión conocida-buena.
- **Sin worktree:** ejecutar el deploy desde un checkout **no-worktree** (copia/clon del commit exacto).
- **Repetibilidad:** versiones fijas + runbook determinístico.
- **Rollback simple:** Netlify retiene el deploy sano `c310589`; "publish deploy" desde el dashboard lo restaura en 1 click.
- **Sin push/merge** (respeta la restricción actual y el modelo CLI-manual de gobernanza).
> **B (git-based)** es objetivamente el más controlado (build server-side node-22), pero requiere **push** y cambiar el modelo de deploy → recomendado SOLO si Dirección decide autorizar push y adoptar git-deploy. Para el objetivo inmediato (publicar F3 con mínimo cambio de gobernanza), **D**.

## 4. Runbook de Deploy Seguro (para ejecutar cuando se autorice)
**Sitio:** `tops-ordenes` (Id `d84a7d34-b90c-4e61-aff6-678abf1ac432`) → nexus.logisticatops.com. **STOP si el CLI apunta a otro sitio.**
### Pre-flight
- [ ] Autorización de deploy de Dirección.
- [ ] Prod sano AHORA: `curl -s https://nexus.logisticatops.com/api/version` → responde (anotar el `version` actual = el punto de rollback, hoy `c310589`).
- [ ] Confirmar deploy sano `c310589` disponible en el dashboard para "publish" (rollback).
- [ ] Toolchain controlado: `nvm use 22` → `node -v` = v22.x; `netlify --version` anotado.
- [ ] Pin del plugin aplicado (ver Anexo) y `npm ci` limpio.
- [ ] Checkout **no-worktree** del commit exacto (`88add4b` o el HEAD final de `feat/nexus-link-integration`) — copiar el repo a un dir regular o clonar; working tree LIMPIO.
- [ ] `netlify status` → project = tops-ordenes.
### Build (con versión inyectada)
- [ ] `npm run build` → banner `▶ BUILD VERSION sha=<commit> branch=feat/nexus-link-integration`. Debe **compilar OK** (verificado en DRR: Compiled successfully).
### Deploy DRAFT (NO toca prod)
- [ ] `npx netlify deploy` (SIN `--prod`) → devuelve **Draft URL** (preview única).
- [ ] Validaciones DURANTE: el comando termina sin error; se generan las functions Next; no `ENOENT run-config.json`.
### Smoke del DRAFT (§6) — sobre la Draft URL
- [ ] Ejecutar TODOS los smoke tests contra la Draft URL. Si algo falla → **ABORTAR** (prod intacto; descartar el draft).
### Promoción a PROD (solo si el draft pasó 100%)
- [ ] `npx netlify deploy --prod` (publica el artefacto ya validado) — o "promote" del draft desde el dashboard.
- [ ] `curl -s https://nexus.logisticatops.com/api/version` → `version` == commit deployado.
### Criterios de ABORTAR
Error en build/deploy · `ENOENT`/`PLUGIN_DIR` en el log · draft no valida · `/api/version` no coincide · cualquier 502/500 en el draft.

## 5. Plan de Rollback
- **Preferido (1 click):** en el dashboard de Netlify → Deploys → seleccionar el deploy sano previo (`c310589`) → **"Publish deploy"** → prod vuelve al estado anterior en segundos. (Netlify retiene el historial; este es el rollback que faltó en el incidente por artefactos purgados — por eso el **draft-first** es clave: evita llegar a ese escenario.)
- **DB:** NO se revierte (la capa connect es aditiva/greenfield y no afecta a los módulos existentes; el rollback de UI deja la DB connect intacta e invisible, sin impacto). Si se exigiera, aplica el rollback de la ventana G3 (Runbook G3 §4).
- **Evidencia:** guardar la Draft URL, el log de build/deploy, el `/api/version` pre y post.

## 6. Plan de Smoke Tests (sobre Draft URL primero; repetir en prod tras promover)
1. **Salud base:** `/` (200/307), `/login` (200), `/api/version` (== commit).
2. **Sin regresión (módulos existentes):** `/ejecutivo`, `/orders`, `/compras`, `/anmat`, `/knowledge/admin` responden 200 (no rompió nada previo).
3. **Nexus Link visible:** login como usuario piloto → sidebar muestra "Nexus Link" (Inicio/Actividad/Notificaciones/Búsqueda/Canales).
4. **Rutas connect:** `/connect`, `/connect/notificaciones`, `/connect/buscar`, `/connect/actividad`, `/connect/perfil`, `/connect/favoritos`, `/connect/canales`, `/connect/c/<id>`, `/connect/e/orders/<uuid>` → render sin error de consola/500.
5. **RBAC:** usuario piloto ve el módulo; usuario NO habilitado (o rol externo) → AccesoRestringido (fail-closed).
6. **0 errores 500/502** en toda la sesión.

## 7. Plan de Validación Piloto (post-deploy en prod, guiado con usuarios internos)
- **Usuarios:** los **7 habilitados** (roles director_ops/gerencia/jefe_deposito/rrhh_admin). Verificar que cada uno ve Nexus Link.
- **RBAC / fail-closed:** un externo/roleless NO ve el módulo; un no-miembro no lee una conversación ajena.
- **Mensajes:** crear conversación (DM) → postear mensaje → aparece; markRead; realtime (2 sesiones, mensaje aparece en vivo).
- **Canales:** ver directorio; unirse a canal público; moderación (owner cambia tema/rol); pinned.
- **Contexto ERP (Entity360):** desde una OS/cliente/OC real → botón "Conversación" → get-or-create → panel Entity360 con el evento "Conversación vinculada" (Knowledge/Timeline).
- **Perfil:** cambiar presencia (persiste); guardar firma/preferencias; avatar (fallback iniciales).
- **Notificaciones:** centro agrupa por prioridad; conversaciones no leídas aparecen.
- **Knowledge/Timeline/Actividad:** `/connect/actividad` muestra eventos reales; la vinculación de conversación emite a `knowledge_events`.
- **Búsqueda:** `/connect/buscar?q=...` devuelve conversaciones/contextos/mensajes.
- **Registrar** cada prueba con resultado (PASS/FAIL) en el informe de cierre.

## 8. Criterio formal de cierre de F3
F3 se declara CERRADA cuando **TODOS**:
- [ ] Deploy exitoso (`/api/version` == commit connect; sin 502/500).
- [ ] Smoke tests **verdes** (§6) en prod.
- [ ] **0 errores críticos**, **0 regresiones** (módulos existentes intactos).
- [ ] Los **7 usuarios internos habilitados** ven y usan Nexus Link; externos NO (fail-closed verificado en vivo).
- [ ] Nexus Link **visible y funcional** (mensajes/canales/perfil/notif/contexto ERP/actividad/búsqueda OK en el piloto).
- [ ] **Rollback NO requerido.**
- [ ] **Informe final de deploy** entregado (evidencia: logs, /api/version, resultados de smoke + piloto).
Cumplido esto → F3 cerrada; recién entonces se habilita F4.

## 9. Riesgos remanentes
- 🟠 **DEPLOY-1 residual:** aun con D, el build/deploy corre por CLI; el **draft-first** lo acota a "rompe el draft, no prod". Riesgo → **Bajo** con la mitigación.
- 🟠 **Pin del plugin:** hay que confirmar la versión buena (Anexo); si se desconoce, el draft-first la valida antes de prod.
- 🟢 **R-2 (isLegacyAdmin):** diferido (fuera de F3).
- 🟢 **Cobertura 7/10:** los 3 usuarios sin rol quedan fuera por diseño.

## 10. Recomendación GO / NO GO
**🟢 GO para PREPARAR y (cuando autorices) EJECUTAR el deploy con la Estrategia D (draft-first).** El plan neutraliza los 3 factores del outage y **no toca prod hasta validar el artefacto en un draft**, con rollback 1-click disponible. **NO ejecuto nada** hasta tu autorización explícita de la ventana de deploy; en esa ventana seguiré este runbook al pie.

---
### Anexo — Pin del plugin (a confirmar en la ventana)
Fijar en `netlify.toml`:
```toml
[[plugins]]
  package = "@netlify/plugin-nextjs"
  # pin a la versión que construyó el deploy sano actual (verificar en el build log de c310589);
  # si se desconoce, el draft-first valida el artefacto antes de promover a prod.
```
> Determinar la versión buena leyendo el log de build del deploy `c310589` en el dashboard de Netlify (o `netlify api listSiteDeploys`), antes de la ventana. El draft-first hace que un error de versión rompa solo el draft.

# HANDOFF TÉCNICO — Nexus Link F3 · Deploy a Producción (autocontenido)

> Generado 2026-07-01. **NO ejecutar deploy/push/merge/DB.** Este documento basta por sí solo; no depende de memoria previa. Sin secretos/tokens/vars sensibles.

## 1. Estado general del proyecto
- **Fase actual:** **Fase 3 — Integración Productiva de Nexus Link**, sub-etapa **F3.2B (deploy)**. Draft ejecutado y verde; **falta SOLO el deploy a producción** (pendiente de autorización de Dirección).
- **Completado:** desarrollo RC1 (RC1.0-1.4), hardening, UAR, auditoría de integración, IR-1, preparación F3.2A, modelo+cierre RBAC, ventana G3 (capa DB aplicada en prod), DRR, plan de deploy seguro, **draft deploy**.
- **Falta:** promover el draft a producción (`--prod`) + smoke en prod + validación piloto + cierre formal de F3. Luego, recién F4.
- **Próximo paso recomendado:** deploy final a prod con el toolchain endurecido (§8), SOLO si Dirección lo autoriza explícitamente.

## 2. Estado de F3 / Nexus Link
| Hito | Estado |
|---|---|
| UAR (demo) | ✅ APROBADA |
| Hardening RC1 | ✅ Completado (0 critical) |
| Integración DB (ventana G3) | ✅ Completada |
| Migraciones 0142–0155 | ✅ APLICADAS en prod |
| RBAC final (piloto) | ✅ Cerrado y aplicado |
| DRR (Deployment Readiness Review) | ✅ Completado |
| Draft deploy | ✅ Ejecutado y VERDE |
| **Producción** | 🟢 **INTACTA** (aún NO tiene la UI de connect) |

## 3. Estado de base de datos (prod `arsksytgdnzukbmfgkju`)
- **Migraciones `0142`–`0155` APLICADAS** (vía `apply_migration`), incremental. **Checkpoints C1–C11: TODOS PASS**, 0 FAIL, 0 rollback.
- **`schema_migrations` = 72** (58 previas + **14 del bloque RC1**). Prod numera por TIMESTAMP.
- **RLS:** habilitada en **11 tablas `connect_*`** (fail-closed por `has_permission` + membresía `_connect_is_member`). `connect_outbox` = RLS sin policy (deny-all, por diseño).
- **RPC:** ~40 funciones SECDEF (`connect_*`, `set_my_presence`, `update_my_profile`), revoke public/anon + grant authenticated, guards internos.
- **Realtime:** publicación `supabase_realtime` incluye 8 tablas connect + `notifications` + `knowledge_events`.
- **Buckets:** `connect-files`, `connect-files-pii` (privados) + 4 storage policies.
- **Profiles:** +5 columnas (`avatar_url`, `presence_status`, `profile_meta`, `notif_freq_default`, `last_activity_at`).
- **Notifications:** +3 columnas A4 (`priority`, `remind_at`, `delegated_to`).
- **Knowledge Adapter (0149):** VIVO — trigger `tg_project_connect_links` + fuente `connect_conversation_links` `enabled=true` en `knowledge_sources`; emite `connect.conversation_linked` a `knowledge_events` (unidireccional). Knowledge/emisor/worker intactos. Compliance (`0141`) intacto.
- **RBAC piloto:** 5 permisos `connect.*` (view/create/edit/delete/admin) seeded (0146) + ampliación piloto (0155). Niveles: `admin`/`director_ops`=full; `gerencia`/`jefe_deposito`/`operaciones`/`comercial`/`compliance`=view/create/edit; `seguridad`/`rrhh_admin`=view/create. Externos (`cliente_b2b`/`employee_self_service`/`rrhh_manager`/`rrhh_viewer`)=**0** (fail-closed).
- **Usuarios habilitados:** **7 de 10** (asignados a director_ops/gerencia/jefe_deposito/rrhh_admin).
- **Usuarios sin rol:** **3** (fuera del piloto, fail-closed): `martin@logisticatops.com` (legacy-admin — vería connect por el fallback sistémico `isLegacyAdmin`, R-2), `martin.battaglia@logisticatops.com` (legacy operaciones, posible duplicado), `martinferbat@gmail.com` (posible cuenta de prueba).
- **Advisors:** **0 criticals nuevos de RC1** (25 WARN = patrón RPC-first SECDEF intencional; 1 ERROR `security_definer_view`=`profiles_public` PRE-existente).
- **Riesgos DB remanentes:** R-2 (`isLegacyAdmin`, sistémico, diferido a hardening de seguridad del ecosistema, fuera de F3). Ninguno bloqueante.

## 4. Estado Git
- **Rama:** `feat/nexus-link-integration`.
- **Commit exacto (a desplegar):** **`88add4b`** (`88add4b92f64a8701f1effc885d8f4c0c120eb26`). Sobre `release/nexus-base` (`42ad20d`, intacta): 3 commits — `5093ecc` (RC1.1-1.4 + 0155), `e32f2cc` (runbook), `88add4b` (execution log).
- **Working tree (worktree `~/CODE/tops-ordenes-nexus-base`):** limpio salvo **3 docs untracked** de esta fase (DRR / Safe-Deploy-Plan / Draft-Deploy-Report) — NO commiteados (revisión read-only; no se commitean sin defecto crítico).
- **Push:** **NO.** **Merge:** **NO.** **Deploy a producción:** **NO.** 0 remotos contienen el HEAD.
- **Checkout de deploy (limpio, NO-worktree):** **`~/CODE/deploy-f3-nexus-clean`** — clon local (`.git` es dir REAL), HEAD `88add4b`, `.env.local` copiado, `node_modules` instalado (node 22), `.next` construido. **Listo para promover a prod.**

## 5. Estado Netlify
- **Sitio correcto:** `tops-ordenes` · **Site Id:** `d84a7d34-b90c-4e61-aff6-678abf1ac432` · URL prod: `https://nexus.logisticatops.com`. Deploy = **CLI manual** (no git-auto).
- **Producción actual (rollback point):** commit **`c310589`** (build 30/06 21:39). Verificado sano: `/api/version` responde, `/login` 200. **SIN connect** (es anterior).
- **Draft URL:** `https://6a4466e2096418cbe00716e0--tops-ordenes.netlify.app` · **commit del draft:** `88add4b` (verificado en `/api/version`).
- **Resultado del draft:** ✅ **Deploy is live en 1m 31.7s, EXIT 0, SIN `ENOENT`/`PLUGIN_DIR`/502.**
- **Toolchain usado:** Node **v22.23.1** (keg `/opt/homebrew/opt/node@22`), npm 10.9.8, netlify-cli **26.0.2**, `@netlify/plugin-nextjs` resuelto por `netlify build` (NO pinneado), **checkout NO-worktree**.
- **Smoke del draft:** `/api/version`=`88add4b`; `/login` 200 (0 errores consola); 10 rutas `/connect` → 307 (middleware/fail-closed); pre-existentes 307 (sin regresión); **0 respuestas 5xx**.
- **Estado de producción DESPUÉS del draft:** **INTACTA** (`c310589`, sin cambios; el draft es una preview aislada).

## 6. Riesgo DEPLOY-1
- **Qué fue:** outage de prod el **30/06** (nexus.logisticatops.com → 502) durante un deploy Netlify. Causa: `@netlify/plugin-nextjs` bundleado por `netlify-cli` bajo **node local muy nuevo** + deploy **desde un worktree** (`.git` archivo → `PLUGIN_DIR` mal resuelto: `ENOENT run-config.json`). Rollback fue difícil (artefactos purgados).
- **Cómo se mitigó:** Estrategia **D** — Node **22** (matchea el target, evita la novedad de node-26) + **checkout NO-worktree** (`.git` real) + `@netlify/plugin-nextjs` sin pinnear (regla: no modificar repo) + **draft-first**.
- **Por qué el draft-first redujo el riesgo:** `netlify deploy` **SIN `--prod`** publica a una **URL de preview**; si el toolchain fallara, **rompe el draft, NO producción**. El draft **corrió el pipeline completo (plugin bajo node 22) y salió OK** → el outage NO se reprodujo. Prod nunca se tocó.
- **Riesgo remanente antes del deploy productivo:** **Bajo.** (a) La promoción usa la MISMA pipeline validada + `--prod` (mismo checkout/node) → altísima probabilidad de éxito idéntico al draft. (b) Plugin sin pinnear: opcional pinnearlo a la versión que usó el draft (requiere cambio de repo → pedir autorización); sin pin, el resultado del draft ya es la evidencia. (c) `next@14.2.18` tiene un aviso de seguridad **pre-existente** (mismo Next que corre hoy en prod) — fuera del alcance de connect.

## 7. Restricciones vigentes (recordar SIEMPRE)
- **NO push · NO merge · NO cambios de código · NO cambios de DB · NO nuevas migraciones · NO F4.**
- **Deploy a producción SOLO si Dirección lo autoriza explícitamente.**
- No iniciar F4 hasta que F3 esté desplegada, validada y **formalmente cerrada**.
- Proyecto Supabase ÚNICO autorizado: `arsksytgdnzukbmfgkju` (STOP ante cualquier otro).

## 8. Próximo paso (cuando Dirección autorice)
**Deployment final a producción de Nexus Link F3:**
- Desde el checkout limpio **`~/CODE/deploy-f3-nexus-clean`** con `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` (**Node 22**), **NO-worktree**, commit **`88add4b`**.
- Comando: `npx netlify deploy --build --prod --site d84a7d34-b90c-4e61-aff6-678abf1ac432`.
- **Smoke inmediato:** `curl -s https://nexus.logisticatops.com/api/version` → debe devolver **`88add4b`**; matriz de rutas (0 respuestas 5xx); `/login` 200.
- **Rollback inmediato ante fallo crítico:** dashboard Netlify → Deploys → seleccionar **`c310589`** → **"Publish deploy"** (restaura prod en segundos).
- **Rollback point:** **`c310589`**.
- Luego: validación piloto (7 usuarios internos) + cierre formal de F3.

## 9. Documentos relevantes (en `docs/superpowers/`)
- `F3-INTEGRATION-READINESS-AND-MASTER-PLAN.md` — Integration Readiness Report + Master Plan.
- `F3-IR1-RESOLUTION-REPORT.md` — IR-1 (0141 Compliance vs 0142-0155, sin conflicto).
- `F3-2A-INTEGRATION-PREPARATION.md` — Preflight + operacional + RBAC + G3 plan.
- `F3-2A-RBAC-FINAL-MODEL.md` — Modelo RBAC definitivo.
- `F3-2A-RBAC-CLOSURE.md` — Cierre RBAC (decisiones de Dirección + 0155).
- `F3-2B-G3-RUNBOOK.md` — Runbook de la ventana G3 (DB).
- `F3-2B-EXECUTION-LOG.md` — Execution Log G3 (evidencia de aplicación DB).
- `F3-2B-DEPLOYMENT-READINESS-REVIEW.md` — DRR.
- `F3-2B-SAFE-DEPLOY-PLAN.md` — Plan de deploy seguro (Opción D).
- `F3-2B-DRAFT-DEPLOY-REPORT.md` — Reporte del draft.
- (Contexto RC1) `RC1-0..4-RUN-LOG.md`, `RC1-HARDENING-REPORT.md`, `NEXUS-LINK-RC1-README.md`, `adr/ADR-RC1-HARDENING-001-accepted-debt.md`, `NEXUS-ENGINEERING-POLICY.md` (P-1).

## 10. INSTRUCCIÓN PARA LA NUEVA VENTANA
Al recibir este handoff, la nueva ventana de Cloud Code debe:
1. **Verificación rápida (read-only):**
   - `curl -s https://nexus.logisticatops.com/api/version` → **confirmar que producción sigue en `c310589`** (aún SIN connect).
   - Confirmar draft: `curl -s https://6a4466e2096418cbe00716e0--tops-ordenes.netlify.app/api/version` → `88add4b` (el draft pasó). *(La preview puede haber expirado; no es bloqueante — la evidencia está en este handoff.)*
   - Confirmar Git: rama `feat/nexus-link-integration` @ `88add4b`; sin push/merge; checkout limpio en `~/CODE/deploy-f3-nexus-clean`.
2. **NO ejecutar nada** por defecto. Esperar a que Dirección pegue el **prompt de autorización final de deploy a producción**.
3. **Si Dirección autoriza el deploy:** ejecutar el procedimiento del §8 (Node 22, checkout no-worktree, commit `88add4b`, sitio `d84a7d34…`), smoke inmediato, rollback a `c310589` ante cualquier fallo crítico. Máxima cautela (recordar el outage del 30/06).
4. **NO iniciar F4** hasta que F3 esté desplegada, validada (piloto de 7 usuarios) y **formalmente cerrada** con informe final de deploy.
5. Mantener la metodología del proyecto: análisis → plan → validación → entregables → GO/NO GO; nunca push/merge/deploy/DB sin autorización explícita.

---
**FIN DEL HANDOFF.** Producción intacta (`c310589`). Draft OK (`88add4b`). Esperando autorización de deploy.

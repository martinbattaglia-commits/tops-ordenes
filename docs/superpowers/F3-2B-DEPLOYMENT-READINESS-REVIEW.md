# Deployment Readiness Review (DRR) — Nexus Link RC1 (previo al deploy de la app)

> Release/DevOps Engineer · 2026-07-01. **100% read-only.** Sin cambios de código/prod/commits. Deploy/push/merge NO ejecutados.
> Objetivo: confirmar que el código a publicar coincide con la infraestructura ya desplegada en la ventana G3.

## 1. Estado Git (ETAPA 1)
- Rama: **`feat/nexus-link-integration`** · HEAD **`88add4b`** · working tree **LIMPIO**.
- 3 commits sobre `release/nexus-base` (`42ad20d`, **intacta**): `5093ecc` (RC1+0155), `e32f2cc` (runbook), `88add4b` (execution log).
- **0 remotos** contienen HEAD (nada pusheado). Paquete = 101 archivos (código RC1.1-1.4 + migs `0142`–`0155` + docs).
- **Artefacto a desplegar = build de esta rama.** Prod actual sirve `c310589` (build 30/06, SIN connect) → el deploy publicaría connect por primera vez. ✅ **Paquete = exactamente el esperado.**

## 2. Estado Build (ETAPA 2)
| Check | Resultado |
|---|---|
| TypeScript | **0 errores** |
| ESLint | 0 errores · **0 warnings RC1** · 5 warnings totales (alt-text en PDFs `compras`/`custody`, **PRE-existentes, 0 nuevos**) |
| Tests | **378/378** |
| Build (`next build`) | **✅ Compiled successfully** — 10 rutas `/connect` compiladas (build OK incluso en node 26 local; Netlify usa node 22) |

## 3. Variables de entorno (ETAPA 3, solo presencia)
- `.env.local` (local): **presentes** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`.
- **Nexus Link NO requiere variables nuevas** (reusa el cliente Supabase existente). Las vars de prod ya están configuradas en Netlify (la app corre en prod).
- ⚠️ *Las env vars del entorno Netlify de prod no son legibles desde acá (solo dashboard); connect no agrega ninguna, así que las existentes bastan.*

## 4. Revisión de Integración (ETAPA 4) — code ↔ infra
**Alineación total (0 faltantes):** **17/17 RPCs** que invoca la UI presentes · **5/5 vistas** (v_connect_inbox/channels/unread_total + v_knowledge_timeline/entity_360) · **4 cols profiles** · **3 cols notifications (A4)** · **2 buckets**. Auth (middleware `updateSession`), RBAC (canAccess connect.*, 7 usuarios), RLS (fail-closed), Knowledge/Timeline/Entity360 (adapter vivo), Context IDs (trigger), Realtime (8 tablas publicadas): **todo desplegado y consumible.** ✅

## 5. Netlify (ETAPA 5)
- `netlify.toml`: build `npm run build` · publish `.next` · **Node 22** · heap 4096 · plugin `@netlify/plugin-nextjs` · headers de seguridad (X-Frame SAMEORIGIN, HSTS, nosniff, Referrer/Permissions-Policy) · PWA SW no-cache.
- `next.config.mjs`: inyección de versión (`/api/version`), `generateBuildId`=SHA, images avif/webp + `*.supabase.co`, headers, `serverComponentsExternalPackages` (pdf). **Sin config connect-específica requerida.** ✅
- Middleware: `src/middleware.ts` → `updateSession` (Supabase auth), matcher excluye estáticos. ✅

## 6. Riesgos remanentes (ETAPA 6)
- 🔴 **DEPLOY-1 (ALTO) — Toolchain de deploy + worktree:** el outage de prod del **30/06** (nexus.logisticatops.com → 502) se atribuyó al toolchain Netlify (`@netlify/plugin-nextjs` bundleado por `netlify-cli` bajo node nuevo) **y a deployar desde un worktree** (lead de foros 164135/129530: correr el CLI desde la RAÍZ del repo, no el worktree). Toolchain local actual: **node v26.4.0** (más nuevo que el v25.8.1 que rompió), **netlify-cli 26.0.2**; el deploy de connect saldría del **worktree** `tops-ordenes-nexus-base`. **Prod está sano AHORA** (`c310589`) → un deploy roto podría re-tumbarlo (y el rollback fue reportado como difícil). **Es el único riesgo serio y NO es de código.** Mitigación antes de deployar: (a) deployar desde la **raíz del repo principal**, no el worktree; y/o (b) **deploy git-based** (Netlify buildea en su entorno controlado node-22, evitando el toolchain local) — requiere push/merge (no autorizado aún); y/o (c) **pinnear `@netlify/plugin-nextjs`** a una versión conocida-buena + verificar compatibilidad netlify-cli/node.
- 🟠 **MEDIO — R-2 (isLegacyAdmin):** deuda sistémica diferida (fuera de F3).
- 🟢 **BAJO:** 3 usuarios sin rol (fail-closed, fuera) · 5 warnings lint pre-existentes (PDF, no-RC1).
> Ningún riesgo **crítico de código o infraestructura**. El riesgo alto es **operativo (mecanismo de deploy)**.

## 7. Deployment Readiness Score (ETAPA 7)
| Dimensión | Score | Nota |
|---|---|---|
| Arquitectura | 20/20 | aplicada, alineada, limpia |
| Backend (DB) | 20/20 | 14 migs aplicadas, advisors sin criticals RC1 |
| Frontend | 19/20 | build limpio, 10 rutas; warnings pre-existentes menores |
| Seguridad | 19/20 | fail-closed, RLS, RBAC piloto; R-2 diferido |
| Performance | 19/20 | greenfield, índices presentes; sin load-test |
| Integración | 20/20 | 17/17 RPCs, 5/5 vistas — alineación perfecta |
| **Operación (deploy)** | **13/20** | ⚠️ toolchain/worktree con historial de outage reciente |
| **GLOBAL** | **~90/100** | Código/infra listos; el mecanismo de deploy es el eslabón a asegurar |

## 8. Checklist final
- [x] Git: rama/commit/working-tree/paquete correctos; release/nexus-base intacta; 0 remotos.
- [x] Build: typecheck/lint/tests/build verdes; 0 warnings nuevos.
- [x] Env: vars requeridas presentes; connect sin vars nuevas.
- [x] Integración: 17/17 RPCs + 5/5 vistas + cols + buckets (0 faltantes).
- [x] Netlify: build/headers/middleware correctos.
- [x] Prod sano ahora (`c310589`, /api/version OK).
- [ ] **Mecanismo de deploy de-riesgado** (DEPLOY-1) — PENDIENTE.

## 9. Recomendación GO / NO GO
**🟡 GO condicional.** **Código e infraestructura: 100% listos** (build limpio, 17/17 objetos alineados, prod sano). **PERO NO recomiendo un deploy inmediato "a ciegas" desde el worktree con el toolchain actual**, dado el outage reciente atribuido a ese mismo mecanismo. **Antes de ejecutar el deploy**, de-riesgar DEPLOY-1 (deployar desde la raíz del repo / git-based build node-22 / pin del plugin). Con eso resuelto → **GO pleno**.

## 10. Confirmación explícita
El código que se publicará **coincide exactamente** con la infraestructura desplegada (verificado objeto por objeto). Desde la perspectiva de **código/build/integración, el deploy está listo**. Desde la perspectiva **operativa, el deploy NO debería ejecutarse inmediatamente sin de-riesgar el toolchain/worktree** (DEPLOY-1) para no re-tumbar un prod hoy sano. **No se ejecutó deploy/push/merge.** A la espera de tu decisión sobre el mecanismo de deploy y la autorización final.

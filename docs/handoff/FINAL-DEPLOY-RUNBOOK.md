# FINAL-DEPLOY-RUNBOOK — TOPS NEXUS

**Fecha:** 2026-06-08 · Runbook único de Deploy Productivo. Ejecución paso a paso, sin improvisación, con rollback.
**Ejecuta:** el usuario. El asistente dejó el RC commiteado; NO pushea/mergea/deploya/escribe en prod.

---

## 0. Estado validado (a la fecha)

| Item | Valor | OK |
|---|---|---|
| Commit RC | `1430204` — *feat(release): RC TOPS NEXUS …* | ✅ |
| Branch | `claude/gracious-pasteur-6efdde` | ✅ |
| Ahead/behind `main` | **8 adelante · 0 detrás** (merge limpio, sin conflictos) | ✅ |
| Working tree | **limpio** | ✅ |
| Pusheado | **No** (solo local) | ✅ esperado |
| Gates | tsc PASS · lint PASS · build PASS (79 páginas, 119 rutas) | ✅ |
| Secretos en commit | ninguno (env/bak/trash ignorados) | ✅ |
| Remote | `origin` = github.com/martinbattaglia-commits/tops-ordenes | ✅ |

> ⚠️ **Footgun de git:** el upstream de la branch es `origin/main`. Un `git push` "pelado"
> podría intentar empujar a `main`. **Usar siempre refspecs explícitos** (abajo).

---

## 1. PRE-DEPLOY — verificaciones del usuario (bloqueantes)

### 1.1 Supabase (`arsksytgdnzukbmfgkju`, SQL Editor) — confirmar aplicadas, EN ORDEN
**Obligatorias** (el código las requiere):
```
0052_crm_opportunity_clientify_mirror   → tabla espejo Clientify
0053_crm_ingest_deal                     → RPC upsert de deals
0056–0060  (RRHH R1–R5)                  → ya commiteadas antes; confirmar aplicadas
0061_mi_espacio_permission
0061a_rrhh_modalidad_real
0062_rrhh_carga_inicial
0063_rrhh_bancario_carga
0064_rrhh_doc_class_recibo
0065_compliance_core                     → Compliance Cockpit
0066_crm_units                           → tabla unidades (fuente única)
0067_crm_units_seed                      → 92 unidades  (DESPUÉS de 0066)
0068_crm_reserve_units                   → reserva atómica (DESPUÉS de 0066/0067)
```
**Opcional (NO bloquea):**
```
0069_crm_opportunities_deal_name         → nombre real del deal. El front degrada con fallback sin ella.
```
- [ ] Confirmar que 0052–0068 están aplicadas (memoria: 0066–0068 aplicadas; RRHH y Compliance validados).
- [ ] Regla de orden: **ascendente**; `0061a` después de `0061`; `0067` después de `0066`; `0068` después de `0066/0067`.
- [ ] Decidir 0069: aplicarla ahora **o** aplazar (no bloquea el deploy).
  ```sql
  -- si se aplica 0069:
  alter table public.crm_opportunities add column if not exists clientify_deal_name text;
  ```
- Aplicación = **manual por el usuario** en SQL Editor. Migraciones aditivas/idempotentes.

### 1.2 Netlify — variables y build
- [ ] `netlify.toml` ya fija: `command="npm run build"`, `publish=".next"`, `NODE_VERSION=22`, `NODE_OPTIONS="--max-old-space-size=4096"`. ✅
- [ ] Env vars presentes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `RESEND_*`, `OPENAI_*`, `META_WA_*`, `HIKVISION_*`, `ARCA_*`, `TRACKING_INGEST_TOKEN`.

### 1.3 Drive
- [ ] `GOOGLE_DRIVE_ROOT_FOLDER_ID` = folder root **correcto** de prod (no de prueba). *(Hubo backups `.env.local.pre-drive-root` → el root fue cambiado; confirmar el valor vigente.)*

### 1.4 Clientify
- [ ] `CLIENTIFY_API_KEY` **válida** en Netlify *(el token del MCP dio 401 en sesión — verificar la key de runtime de prod, es independiente)*. `CLIENTIFY_BASE_URL`, `CLIENTIFY_WEBHOOK_SECRET` presentes.

---

## 2. PUSH (comandos exactos)
```bash
cd /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/gracious-pasteur-6efdde

# 0) sanity
git status                      # debe decir working tree clean
git log --oneline -1            # 1430204 …

# 1) push de la BRANCH (refspec explícito — NO 'git push' pelado por el upstream=origin/main)
git push -u origin claude/gracious-pasteur-6efdde:claude/gracious-pasteur-6efdde
```

## 3. MERGE a `main` (comandos exactos)

**Opción A — vía Pull Request (recomendada, con review):**
```bash
gh pr create --base main --head claude/gracious-pasteur-6efdde \
  --title "Release: TOPS NEXUS — CRM360 + crm_units + Digital Twin + Compliance + RRHH" \
  --body "RC 1430204. Gates verdes. Ver docs/handoff/RELEASE-MANIFEST.md y GO-NO-GO.md."
# revisar el PR en GitHub y mergear (Squash o Merge commit).
```

**Opción B — merge local directo (sin divergencia, fast-forward posible):**
```bash
git checkout main
git pull origin main
git merge --no-ff claude/gracious-pasteur-6efdde -m "Release: TOPS NEXUS RC 1430204"
git push origin main
```

## 4. DEPLOY (comandos / acción exacta)
El deploy de Netlify se dispara por el **push a `main`** (auto-build).
```bash
# si hay Netlify CLI y se quiere disparar/seguir manualmente:
netlify deploy --build --prod      # (opcional; normalmente el push a main ya lo dispara)
netlify watch                      # seguir el build en curso
```
- [ ] Verificar en Netlify: log con `✓ Compiled successfully`, 79 páginas, sin errores.
- [ ] Estado final = **Published**.

## 5. SMOKE TEST post-deploy (dominio prod, sesión autenticada)
> Detalle completo en `POST-DEPLOY-SMOKE-TEST.md`. Resumen accionable:
- [ ] Dominio carga (no 502/504); consola sin errores ni hydration.
- [ ] Login OK → Cockpit.
- [ ] Sidebar: 1 ítem por módulo sin 404 (los 59 links resuelven).
- [ ] **CRM360:** abre en Kanban; buscador filtra en vivo; solo ANMAT/Cargas Generales/Oficinas; **ningún título es una URL** `api.clientify.net`; Ficha → Contrato muestra plantilla por servicio + estado documental.
- [ ] **Digital Twin:** mapas con color desde crm_units; "Reservar" → CRM360 precargado; 2º intento → "Unidad ya reservada".
- [ ] **RRHH / Compliance / Drive / Facturación:** listan datos, navegación OK; Drive lista desde el root correcto.
- [ ] Clientify: data CRM visible; sin 401 en logs.

**Criterio:** ítems 0–CRM360 OK + sin fallos críticos → **release confirmado**. Fallo crítico → §6.

## 6. ROLLBACK (procedimiento exacto)

**A — Republicar deploy previo (más rápido, sin git):**
1. Netlify → Deploys → seleccionar el último **Published** estable previo.
2. **Publish deploy** (rollback instantáneo, sin rebuild).
3. Verificar dominio en versión previa.

**B — Revertir el merge en `main` (revierte el código):**
```bash
git checkout main
git pull origin main
git revert -m 1 <SHA_DEL_MERGE>     # -m 1 conserva la línea previa de main
git push origin main                # dispara rebuild con el código anterior
```

**Base de datos:** NO se hace rollback de esquema. Migraciones 0052–0069 son aditivas/idempotentes; el código previo ignora 0069 y las columnas/tablas nuevas. Las reservas en `crm_units` son datos legítimos y persisten.

**Env var mal seteada:** corregir la variable en Netlify y **redeploy** (no revertir código).

| Falla | Acción |
|---|---|
| Build Netlify rojo | A (republicar) + corregir + reintentar |
| Bug crítico runtime | A inmediato; luego B si hay que revertir código |
| Env var mala (Clientify/Drive) | corregir variable + redeploy |
| Migración problemática | NO dropear; revertir código (B) |

---

## 7. Post-release
- [ ] Smoke test verde → registrar release OK.
- [ ] Backlog post-release: 5 warnings a11y en PDFs (falso positivo react-pdf); 0069 + populate del nombre real del deal si no se hizo.
- [ ] Conteos antes/después del filtro de pipelines (SQL read-only de `CRM360-KANBAN-DEFAULT-REPORT.md`).

---

## Referencias
`RELEASE-MANIFEST.md` · `RELEASE-FILE-INVENTORY.md` · `RELEASE-COMMIT-PLAN.md` · `PROD-CHECKLIST.md` · `GO-NO-GO.md` · `POST-DEPLOY-SMOKE-TEST.md` · `ROLLBACK-PLAN.md`.

**Nada de esto fue ejecutado por el asistente:** push, merge, deploy, migraciones y cambios de env son acciones del usuario.

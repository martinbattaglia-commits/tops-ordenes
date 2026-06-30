# Plan de Integración a Producción — Módulo Compliance

- **Fecha**: 2026-06-30
- **Estado**: 📋 **PLAN — NO EJECUTADO.** Requiere autorización expresa de Dirección antes de cualquier acción irreversible (rama/cherry-pick local NO es irreversible; merge/push/migración/deploy SÍ).
- **Proyecto Supabase ÚNICO autorizado**: `arsksytgdnzukbmfgkju` (`https://arsksytgdnzukbmfgkju.supabase.co`).

---

## 1. Commit base de producción (descubierto read-only, exacto)

| Dato | Valor |
|---|---|
| **Commit desplegado en prod** | **`f3b368887151f79b14e8be8c9016b8ce5184a4a5`** (`f3b3688`) |
| Subject | `style(prospeccion): Visual Polish Release — dark mode nivel Cockpit Ejecutivo` |
| Fecha commit | 2026-06-29T19:05:46-03:00 · Build: 2026-06-29T22:07:34Z |
| Fuente (read-only) | `/api/version` en `https://nexus.logisticatops.com` **y** `https://tops-ordenes.netlify.app` → ambos `version=f3b3688`, `environment=production` |
| Netlify | sitio `tops-ordenes` (siteId `d84a7d34-b90c-4e61-aff6-678abf1ac432`, dominio `nexus.logisticatops.com`); deploy actual `6a42eca33352e68fb4415711` (ready) |
| Contiene el commit | ramas locales `release/fiscal-f1-unified` y `release/nexus-base` |
| Relación con la rama Compliance | **`3ea0de1` (base de Compliance) ES ancestro de `f3b3688`** → historia compartida; prod adelanta **7 commits** sobre esa base (fiscal + prospección F2) |

> Verificación sin aproximaciones: el commit servido por prod es `f3b3688` confirmado por dos hosts independientes del mismo build.

---

## 2. Commits de Compliance a transplantar

Rama actual: `worktree-feat+compliance-cases-semaforo` @ `28cb101`, **23 commits** sobre `3ea0de1`. Todos pertenecen al módulo Compliance (feature + tests + regresión + docs + fixes + saneo). Lista (de base a HEAD):

```
6817db1 docs: spec + plan          edcf54f mig 0141(casos/config/dicc/evid)   1044954 tipos
2622eb5 diccionario                966e9e8 motor semáforo                     1e22f28 máquina de estados
e791d2c parser  04a12c4 fix parser 82242fa deriveComplianceStatus              7c245f6 regresión 12/12
3981664 KPIs    c510f34 env         d7db7f4 syncCasesFromSheet(D11+D12)         7ac26a2 join caso activo
c1913d9 cron Paso 0 + rebuildAlerts 5cd97c4 UI CaseChips                       f8821d4 fix lint
be7fe6c fix review final (nivel+info, idempotencia)  91e96ca/e1345ba renumera 0125→0139→0141
c73c4b9 runbook   fa42775 cierre/STATUS   6cb4548 D11/D12/D13   28cb101 saneo docs
```

---

## 3. Archivos afectados por el transplante (30)

**Nuevos** (sin conflicto posible): `src/lib/compliance/cases/{types,normalize,transitions,sheet,sync}.ts` (+ 5 `.test.ts`), `src/lib/compliance/semaforo.ts` (+ `.test.ts`), `src/lib/compliance/{derive.test,derive.regression.test,kpis.test}.ts`, `supabase/migrations/0141_compliance_cases.sql`, docs (`docs/superpowers/specs|plans|integration/...`, `COMPLIANCE_IMPLEMENTATION_STATUS.md`).

**Modificados** (sólo de compliance, NO tocados por los 7 commits de prod ⇒ sin conflicto): `src/lib/compliance/data.ts`, `src/lib/compliance/source.ts`, `src/lib/compliance/sync/engine.ts`, `src/components/compliance/ui.tsx`, `src/components/compliance/ComplianceMatrix.tsx`, `src/lib/env.ts`, `.env.example`, `.gitignore`.

**⚠️ Único solapamiento con prod**: `vitest.config.ts` (lo modificaron ambos). **Conflicto esperado: 1**, trivial — resolución: conservar la config de prod **+** incluir la ruta de tests de compliance (`src/lib/compliance/**`).

> El scratch `.superpowers/` está gitignored (commit `fa42775`); el transplante por rango lo deja destrackeado al final. No forma parte del entregable.

---

## 4. Verificación de NO regresión (Fiscal / Knowledge / Connect / resto)

- **Intersección de archivos** entre el diff de Compliance y los 7 commits de prod = **sólo `vitest.config.ts`**. El diff de Compliance **NO toca** `src/lib/fiscal/*`, `src/lib/erp/*`, `src/lib/prospeccion/*`, `src/lib/clientify/*`, ni nada de Knowledge/Connect (verificado por `grep`).
- Sobre la rama de integración (= `f3b3688` + Compliance) se corre la **suite COMPLETA** (incluye fiscal + prospección F2 + el resto que ya está en `f3b3688`): si queda 100% verde, **no hay regresión**. El conteo esperado = baseline de `f3b3688` + los tests nuevos de compliance (65). `typecheck` 0 y `lint` 0.
- **Hallazgo de integración** (no conflicto): prod tiene `src/app/(app)/anmat/layout.tsx` con guard **`compliance.view`** (`canAccess`, fail-open para rol no asignado). Mi diff NO lo toca → se preserva. **Implica que la validación de UI en prod requiere un usuario con `compliance.view`** (o rol no asignado/bootstrap).

---

## 5. Migración

- Prod (`list_migrations`, 2026-06-30) llega a **`0140_knowledge_kpis_admin`** → **`0141_compliance_cases.sql` = max+1 (correcto)**.
- La migración es **aditiva/quirúrgica**: crea `compliance_cases/evidence/anticipacion_config/normalizacion`; agrega `compliance_items.anticipacion_dias`; agrega a `compliance_alerts` las columnas `origen/confianza/case_id` y **extiende** los CHECK de `kind` (+`review`) y `nivel` (+`info`) vía bloque `do $$` introspectivo (nombre-agnóstico, robusto ante el nombre real del constraint en prod). Depende de `compliance_items/alerts/documents` que **ya existen en prod**.
- **REVALIDAR `max+1` con `list_migrations` justo antes de aplicar** (la cadena Knowledge crece en un worktree paralelo no mergeado; si aparece un `0141` ajeno, renumerar a `0142+`).

---

## 6. Plan de ejecución propuesto (NADA de esto se ejecutó)

> Local (rama/cherry-pick/verificación) es reversible. **Merge / push / migración / deploy son irreversibles → requieren tu autorización explícita.** Criterio: el asistente prepara y muestra; ejecuta Dirección (devops-tops-nexus).

1. **(local, reversible)** Crear rama de integración desde el commit de prod:
   `git switch -c feat/compliance-integration f3b3688`
2. **(local)** Transplantar Compliance: `git cherry-pick 3ea0de1..28cb101` → resolver el único conflicto en `vitest.config.ts` (incluir ruta de compliance). [alternativa: `git rebase --onto f3b3688 3ea0de1` sobre una copia]
3. **(local)** Verificación sin regresión: `npm ci` · `npm run typecheck` · `npm run lint` · `npx vitest run` → exigir verde total (incl. fiscal/prospección) + regresión compliance 12/12.
4. **(local)** Re-verificar numeración: `list_migrations` en prod = max+1 para `0141`.
5. **🔴 GATE — migración (irreversible)**: aplicar **sólo** `0141_compliance_cases.sql` a `arsksytgdnzukbmfgkju`. Smoke test (runbook §3): insertar alerta `nivel=info`/`kind=review` debe pasar; verificar CHECKs.
6. **🔴 GATE — deploy (irreversible)**: build + `netlify deploy --prod` (Netlify manual, runbook `docs/runbooks/RELEASE.md`) del commit de integración. Confirmar `/api/version` → nuevo commit.
7. **Validación post-deploy** (sobre prod, con usuario `compliance.view`): `/anmat` → MAG-04 (`EX-2023-116887453`) 🟠 "En trámite administrativo"; KPIs/semáforos/CaseChips; cron `?dry=1`. (Los casos reales se cargan vía la planilla `00_ESTADO_COMPLIANCE`.)

---

## 7. Riesgos

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| 1 | Conflicto en `vitest.config.ts` durante el transplante | Bajo | Resolución conocida (incluir ruta compliance); se verifica con la suite |
| 2 | `0141` superado por la cadena Knowledge antes del deploy | Bajo | Revalidar `max+1` con `list_migrations` inmediatamente antes de aplicar; renumerar si hace falta |
| 3 | Guard RBAC `compliance.view` en `/anmat` (prod) bloquea la validación con usuario sin permiso | Bajo | Validar con usuario autorizado (gerencia/admin) o rol no asignado (bootstrap) |
| 4 | La migración altera `compliance_alerts` (prod en vivo) | Medio | Es aditiva; el `do $$` es nombre-agnóstico; aplicar en ventana de bajo tráfico; rollback §8. La capa de alertas de compliance hoy no se escribe desde el cron en prod (cron de compliance no activo) → impacto mínimo |
| 5 | Datos: prod es real | Alto (siempre) | Sólo se aplica `0141` (DDL aditivo) + deploy de código; sin tocar datos. Backup nocturno de prod existe (mig de backup a Drive) |
| 6 | Divergencia futura si Knowledge/Connect se deployan en paralelo | Medio | El transplante es sobre el commit REALMENTE desplegado (`f3b3688`); re-descubrir `/api/version` si pasa tiempo antes del deploy |

---

## 8. Estrategia de rollback

**Código (inmediato)**: re-deploy del commit previo `f3b3688` por Netlify (`netlify deploy --prod` apuntando al build de `f3b3688`, o "Publish deploy" del deploy `6a42eca3...` en el dashboard). Restaura prod al estado actual en minutos. El código viejo NO usa `compliance_cases` → seguro aunque la migración haya quedado aplicada.

**Base de datos (opcional, sólo si se quiere revertir el schema)**: `0141` es aditivo; rollback SQL:
```sql
-- (orden inverso; sólo si Dirección lo pide — dejar las tablas vacías es inocuo)
drop table if exists public.compliance_evidence;
drop table if exists public.compliance_cases;          -- (FK case_id en alerts: ON DELETE SET NULL)
drop table if exists public.compliance_normalizacion;
drop table if exists public.compliance_anticipacion_config;
alter table public.compliance_items drop column if exists anticipacion_dias;
alter table public.compliance_alerts drop column if exists origen, drop column if exists confianza, drop column if exists case_id;
-- restaurar CHECKs originales (0081): kind sin 'review', nivel sin 'info'
-- (re-crear compliance_alerts_kind_chk y compliance_alerts_nivel_chk con los sets originales)
```
> Recomendado: **rollback de código primero** (resuelve el incidente); el rollback de DB es opcional porque los objetos de `0141` son aditivos e inertes para el código viejo.

---

## 9. Resumen para decisión

- ✅ Commit de prod exacto: `f3b3688` (verificado por 2 fuentes).
- ✅ Transplante limpio (1 conflicto trivial `vitest.config.ts`); sin regresión a Fiscal/Knowledge/Connect/resto.
- ✅ Migración `0141` = max+1 (revalidar al aplicar); aditiva; rollback definido.
- ⏸️ **Nada irreversible ejecutado.** Esperando autorización expresa de Dirección para los gates 5 (migración) y 6 (deploy).

# ERP-A · PLAN DE CONSOLIDACIÓN DE RELEASE

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A_RELEASE_CONSOLIDATION_PLAN.md`
**Contexto:** ERP-A CLOSED; producción `arsksytgdnzukbmfgkju` con `0052–0055` aplicadas. Resta consolidar el código en `main` y desplegar la UI.
**Naturaleza:** plan. **No se commitea, pushea, mergea ni despliega.**

> **Veredicto (adelanto):** 🟢 **READY FOR ERP-A CONSOLIDATION.** Los archivos de ERP-A y los 3 commits de drift de `main` son **disjuntos** ⇒ rebase sin conflicto esperado; la rama es **local** ⇒ rebase limpio sin force-push; los fixes de build ya están en `main`; la DB de prod ya está alineada.

---

## 1. Estado Git

| Ítem | Valor |
|---|---|
| Rama ERP | `feature/erp-a-tesoreria` — **LOCAL (no pusheada)** |
| Commits ERP-A (4, committeados) | `c6910af` (0052) · `67d1e08` (0053) · `70de44b` (0054) · `5390379` (0055) |
| merge-base con `main` | `710ae33` |
| `main` (= `origin/main`) | `42cb835` |
| Rama ↔ main | **4 adelante / 3 atrás** |
| **3 commits de drift** (en `main`, no en la rama) | `1630f70` Netlify Node 22 · `c4f353d` heap build 4096MB · `42cb835` fix tracking/map (height:0 + SSR) |
| Archivos del drift | `netlify.toml`, `FleetTable.tsx`, `VehiclePanel.tsx`, `MapboxFleetMap.tsx` (tracking/build) |

**Artefactos pendientes de commitear (working tree):**
- **Tracked modificado:** `src/components/shell/Sidebar.tsx` (M — edición ERP-A: grupo "Tesorería · Finanzas").
- **Untracked (ERP-A):** `src/lib/tesoreria/` (5), `src/components/tesoreria/` (5), `src/app/(app)/tesoreria/` (6 páginas), `docs/handoff/ERP_A*` (~28).
- **Untracked (AJENOS a ERP-A — NO incluir):** `docs/handoff/{INFRASTRUCTURE_AUDIT, DISASTER_RECOVERY, OPERATIONS_RUNBOOKS, PHASE_A_*, PRODUCTION_*, RESILIENCE_*, TARGET_INFRA_*, NEXUS_*, MAIN_*…}`, `docs/PRODUCTION_*`, `docs/TOPS_NEXUS_*` y otros.

**Análisis de conflicto:** los archivos de ERP-A (migraciones `0052–0055`, `src/{lib,components,app/(app)}/tesoreria/`, `Sidebar.tsx`) y los del drift (tracking/build) **no se solapan**. **`Sidebar.tsx` no fue tocado por ningún commit de drift** ⇒ rebase **sin conflicto esperado**.

---

## 2. Estrategia de consolidación

> Principio: **commitear ERP-A con `git add` dirigido** (jamás `git add .` — hay docs ajenos untracked), **rebasar antes de pushear** (rama local ⇒ sin force-push), validar, y mergear a `main`.

**Secuencia exacta (a ejecutar bajo autorización):**

```
0. Verificar rama = feature/erp-a-tesoreria y working tree (solo ERP-A pendiente).
   git switch feature/erp-a-tesoreria

1. COMMIT backend (C6) — git add DIRIGIDO:
   git add src/lib/tesoreria/
   git commit -m "feat(erp-a): backend Tesorería (data layer + server actions, RPC-First)"

2. COMMIT UI (C7):
   git add src/app/\(app\)/tesoreria/ src/components/tesoreria/ src/components/shell/Sidebar.tsx
   git commit -m "feat(erp-a): UI Tesorería (6 pantallas + componentes + nav)"

3. COMMIT docs (C8) — SOLO ERP-A:
   git add docs/handoff/ERP_A*.md
   git commit -m "docs(erp-a): dossier completo ERP-A (diseño→cierre)"

4. REBASE sobre main (42cb835) — esperado conflict-free (archivos disjuntos):
   git rebase main
   # si hubiera conflicto (no esperado): resolver SOLO el archivo en conflicto, git rebase --continue

5. VALIDAR (§3) sobre la rama rebasada.

6. PUSH de la rama (limpio, sin force porque nunca se pusheó):
   git push -u origin feature/erp-a-tesoreria

7. MERGE a main (PR o local):
   git switch main && git merge --no-ff feature/erp-a-tesoreria
   git push origin main      # FF de origin/main (rama rebasada sobre main) → sin force
```

> **Por qué rebase y no merge-into-feature:** la rama es local y los archivos son disjuntos ⇒ `git rebase main` da historia **lineal** (los 7 commits ERP-A sobre `42cb835`) sin force-push. **Squash NO** (perdería la trazabilidad de 0052–0055 y los hitos). **--no-ff** al integrar para un punto de merge claro.

> **DB:** prod ya tiene `0052–0055` aplicadas (manual). El merge solo alinea los **archivos** de migración con `main`; la tabla `schema_migrations` está vacía (patrón manual de la casa) ⇒ **no** se usa `db push`, **no** hay reaplicación. **Cero acción de DB en la consolidación.**

---

## 3. Estrategia de despliegue

| Paso | Acción | Criterio |
|---|---|---|
| V1 | `npm ci` | deps OK |
| V2 | `npm run typecheck` | EXIT 0 |
| V3 | `npm run lint` | EXIT 0 |
| V4 | `npm run build` | EXIT 0; rutas `/tesoreria*` presentes |
| D1 | Push a `main` → Netlify auto-deploy | la rama rebasada **incluye** los fixes de build de `main` (`1630f70` Node 22, `c4f353d` heap 4096) ⇒ build de Netlify pasa |
| D2 | Verificar deploy Netlify verde | sitio actualizado; `/tesoreria` accesible (tras login) |
| D3 | QA visual runtime (login real) | pantallas renderizan con datos de prod |

> **Clave:** el build de Netlify estaba roto (OOM/Node) y se arregló en `main` (`1630f70`/`c4f353d`). Al **rebasar sobre `42cb835`**, la rama ERP-A hereda esos fixes ⇒ el deploy debería pasar. **Validar `npm run build` local antes de mergear.**

---

## 4. Riesgos

### 🔴 P0
**Ninguno.** Archivos disjuntos; DB ya alineada; build fixes en main.

### 🟠 P1
- **R-CONS-1 — `git add .` accidental.** Hay **docs ajenos untracked** (`INFRASTRUCTURE_AUDIT`, `DISASTER_RECOVERY`, `PRODUCTION_*`, `MAIN_*`, etc.) y potencial trabajo de otras ramas. *Mitigación:* `git add` **dirigido** por path (backend/UI/Sidebar/ERP_A*); verificar cada commit con `git show --stat`.
- **R-CONS-2 — Rebase de rama local.** Seguro porque **no está pusheada**. *Regla:* rebasar **antes** del primer push. Nunca force-push sobre `main`/`origin` publicado.
- **R-CONS-3 — Higiene de rama (recurrente).** El working dir saltó de rama entre sesiones. *Mitigación:* verificar `git branch` antes de cada paso.

### 🟡 P2
- **R-CONS-4 — Build tras rebase.** Validar `typecheck`/`lint`/`build` **después** del rebase (la rama gana los fixes de Netlify, pero confirmar que no rompen las nuevas rutas).
- **R-CONS-5 — Conflicto inesperado en rebase.** No esperado (archivos disjuntos), pero si `main` tocara `Sidebar.tsx`/migraciones en un commit futuro, resolver el archivo puntual.
- **R-CONS-6 — Deploy Netlify.** Confirmar deploy verde post-merge; rollback = revert del merge si falla.

### ⚪ P3
- Docs ajenos untracked quedan sin commitear (decidir su destino aparte). UX polish de la UI; assignación de roles granulares; endurecer `has_permission` (P2 ya registrado).

---

## 5. Criterio GO — "ERP-A CONSOLIDADO"

Se considera **ERP-A CONSOLIDADO** cuando **todas**:
1. Backend (C6), UI (C7) y docs ERP-A (C8) **committeados** en la rama (con `git add` dirigido; verificado por `git show --stat` que no entró nada ajeno).
2. **Rebase sobre `42cb835`** completado **sin conflicto** (o resuelto puntualmente).
3. **V2/V3/V4 verdes** (typecheck/lint/build EXIT 0; rutas `/tesoreria*` en el build).
4. Rama **pusheada** y **mergeada a `main`** por **fast-forward o --no-ff sin force**.
5. `main` == `origin/main` con ERP-A integrado.
6. **Deploy Netlify verde**; `/tesoreria` accesible.
7. (DB) `0052–0055` ya aplicadas en prod (sin acción) — confirmado.

**NO-GO:** `git add .` contaminó un commit · rebase con conflicto no resuelto · build rojo · merge exigiría force · deploy Netlify rojo.

---

## 6. Recomendación ejecutiva

**¿Cuál es la forma más segura de consolidar ERP-A sin perder trabajo ni introducir regresiones?**

La situación es **favorable**: la rama es **local** (rebase limpio sin force-push), los archivos de ERP-A y los 3 commits de drift de `main` son **disjuntos** (rebase sin conflicto esperado), los **fixes de build de Netlify ya están en `main`** (la rama los hereda al rebasar), y la **DB de prod ya tiene `0052–0055`** (cero acción de DB).

**Procedimiento recomendado (seguro):**
1. **Commitear ERP-A con `git add` dirigido** (backend C6, UI+Sidebar C7, docs ERP-A C8) — nunca `git add .` (hay docs ajenos untracked).
2. **Rebasar la rama sobre `main` (`42cb835`)** mientras es local ⇒ historia lineal, sin force-push.
3. **Validar typecheck/lint/build** sobre la rama rebasada (hereda los fixes de Netlify).
4. **Push de la rama** (limpio) + **merge `--no-ff` a `main`** + push (FF de origin/main, sin force).
5. **Netlify auto-despliega** desde `main`; verificar deploy verde y `/tesoreria` accesible.

Garantías: **sin pérdida de trabajo** (todo committeado antes de rebasar; rama respaldada por push), **sin regresión** (archivos disjuntos; build validado; DB intacta), **sin force-push** (rebase pre-push).

---

## 7. Veredicto

> # 🟢 READY FOR ERP-A CONSOLIDATION
>
> El estado es apto para consolidar: rama `feature/erp-a-tesoreria` (4 commits `0052–0055`) **local**, 4 archivos de migración committeados + backend/UI/docs listos para commit dirigido; `main` (`42cb835`) drift de **3 commits de build/tracking disjuntos** de ERP-A ⇒ **rebase sin conflicto esperado**, sin force-push; los **fixes de build de Netlify ya en `main`** habilitan el deploy; la **DB de prod ya tiene `0052–0055`** (cero acción).
>
> Procedimiento seguro definido (§2/§6): commit dirigido → rebase sobre `42cb835` → validar (typecheck/lint/build) → push → merge `--no-ff` → deploy Netlify. **Sin P0/P1 bloqueantes** (los P1 son disciplinas de ejecución: `git add` dirigido, rebase pre-push, verificar rama).
>
> Pendiente: **autorización explícita** para ejecutar la consolidación. Este documento es solo el plan.

---

## Anexo — Evidencia

| Verificación | Resultado |
|---|---|
| Rama ERP local | sí (no pusheada) |
| Commits ERP-A | 4 (`c6910af`…`5390379`) |
| Drift de main | 3 commits (build/tracking) |
| Archivos drift ↔ ERP-A | **disjuntos** (sin solape) |
| `Sidebar.tsx` tocado por drift | **no** |
| Backend/UI/docs | untracked, listos para commit dirigido |
| DB prod | 0052–0055 aplicadas |
| Build fixes (Node22/heap) | en `main` (rama los hereda al rebasar) |

---

*Fin — Plan de Consolidación de Release ERP-A. Veredicto: READY FOR ERP-A CONSOLIDATION. No se commiteó, pusheó, mergeó ni desplegó.*

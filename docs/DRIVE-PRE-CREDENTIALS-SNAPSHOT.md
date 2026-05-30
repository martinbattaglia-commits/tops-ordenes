# DRIVE-PRE-CREDENTIALS-SNAPSHOT.md

**Fecha:** 2026-05-29
**Modo:** `NO ASUMIR · VERIFICAR` · sin deploy · sin merge · sin push · sin commit
**Propósito:** congelar el estado del repo antes de introducir credenciales reales.

---

## 1 · Commit base actual (verificado)

```bash
$ git rev-parse HEAD
4d1dbff03f6f690b828f348fb9dec3e36f5e9610

$ git rev-parse --short HEAD
4d1dbff

$ git rev-parse --abbrev-ref HEAD
feature/nexus-fullstack
```

**Hash exacto del commit base:** `4d1dbff03f6f690b828f348fb9dec3e36f5e9610` (corto: `4d1dbff`)
**Branch actual:** `feature/nexus-fullstack`
**Upstream:** `origin/feature/nexus-fullstack`
**Sincronización con upstream:** `0 ahead / 0 behind` (en sincronía)

### Corrección importante a la memoria persistente

La memoria sobre TOPS NEXUS indicaba `main intacto en a4b24e5`. **Eso ya no aplica.** El repo actual muestra:

```bash
$ git branch -vv
* feature/nexus-fullstack            4d1dbff [origin/feature/nexus-fullstack]
  main                                b82a5f2 [origin/main] merge(gate-a): cerrar PARIDAD-1 — migraciones 0008/0009/0010 a main
  fix/paridad-1-migraciones          4e20d62 [origin/fix/paridad-1-migraciones]
  feature/nexus-consolidation        222735f
  feature/documents-enterprise-ready 8c1f465
  feature/arca-production-fase-e     a3c4d63
  feature/ui-redesign                5daeb13
  docs/consolidacion-arquitectonica  181ee0b
  wip/erp-consolidation              ca17522
```

**main avanzó.** Hash actual: `b82a5f2` (no `a4b24e5`). Tiene merged el GATE A de PARIDAD-1.

### Divergencia con main

```bash
$ git rev-list --left-right --count HEAD...origin/main
31  2
```

Lectura:
- `feature/nexus-fullstack` está **31 commits ahead** de `main`
- `origin/main` está **2 commits ahead** de `feature/nexus-fullstack`
- → existe divergencia pendiente de reconciliar (no parte del scope Drive)

---

## 2 · Últimos 10 commits (verificado)

```bash
$ git log --oneline -10
4d1dbff docs(nexus): Quick Wins Fase 1 report
3c3f4c3 feat(nexus): QW Fase 1 — eliminar mocks visibles + 6 roles RBAC reales
38e320b docs(nexus): fullstack consolidation report
bc0dda7 feat(nexus): consolidacion fullstack — branding NEXUS + features completas
222735f docs(nexus): module map exhaustivo cross-branch
8a81476 docs(nexus): consolidation report — build verde + preview deploy
47125f4 chore(nexus): port src/lib/org.ts desde feature/arca-production-fase-e
a3c4d63 docs(arca): integration report tras recibir certificado de homologacion
4aeea7f docs(i7b): closure report formal — GATE 3 constatado en produccion
7dda6a8 docs(fase2/i7b): closure formal — GATE 3 + plan/runbook + pre-flight scripts
```

Ningún commit reciente toca el módulo Drive. El último trabajo Drive vive **en el working tree**, no commiteado.

---

## 3 · Working tree (verificado)

### `git status --short`

```bash
 M src/app/(app)/drive/DriveBrowser.tsx
 M src/app/api/drive/list/route.ts
 M src/app/api/drive/ping/route.ts
 M src/lib/drive/client.ts
 M src/lib/supabase/middleware.ts
?? ERP-FINANCE-ARCHITECTURE.md          ← NO parte de la sesión Drive (preexistente)
?? docs/DRIVE-FINAL-REDTEAM.md
?? docs/DRIVE-HARDENING-REPORT.md
?? docs/DRIVE-PREFLIGHT-AUDIT.md
?? docs/DRIVE-REMEDIATION-REPORT.md
?? src/lib/rbac/check.ts
```

| Categoría | Cantidad | Notas |
|-----------|----------|-------|
| Modified (tracked) | 5 | Todos parte del scope Drive |
| Untracked (nuevos) | 6 | 4 docs Drive + `check.ts` + `ERP-FINANCE-ARCHITECTURE.md` ajeno |
| Staged | 0 | Nada preparado para commit |

### `git diff --stat HEAD`

```
 src/app/(app)/drive/DriveBrowser.tsx | 224 +++++++++++++++++--
 src/app/api/drive/list/route.ts      | 143 +++++++++---
 src/app/api/drive/ping/route.ts      |  72 +++++-
 src/lib/drive/client.ts              | 423 +++++++++++++++++++++++++++--------
 src/lib/supabase/middleware.ts       |  31 ++-
 5 files changed, 734 insertions(+), 159 deletions(-)
```

### `git diff --numstat HEAD` (detalle por archivo)

| Archivo | Líneas + | Líneas − | Δ neto |
|---------|---------:|---------:|-------:|
| `src/lib/drive/client.ts` | 335 | 88 | +247 |
| `src/app/(app)/drive/DriveBrowser.tsx` | 201 | 23 | +178 |
| `src/app/api/drive/list/route.ts` | 111 | 32 | +79 |
| `src/app/api/drive/ping/route.ts` | 61 | 11 | +50 |
| `src/lib/supabase/middleware.ts` | 26 | 5 | +21 |
| **Subtotal modified** | **734** | **159** | **+575** |

### Líneas en archivos NUEVOS (verificado con `wc -l`)

| Archivo | Líneas |
|---------|-------:|
| `src/lib/rbac/check.ts` | 207 |
| `docs/DRIVE-PREFLIGHT-AUDIT.md` | 422 |
| `docs/DRIVE-HARDENING-REPORT.md` | 192 |
| `docs/DRIVE-FINAL-REDTEAM.md` | 483 |
| `docs/DRIVE-REMEDIATION-REPORT.md` | 367 |
| **Subtotal nuevos (sin doc ajeno)** | **1.671** |

### Total impacto Drive en working tree

- **Código:** +575 líneas netas en 5 archivos tracked + 207 líneas en 1 archivo nuevo (`check.ts`) = **+782 líneas de código**
- **Docs:** +1.464 líneas en 4 archivos nuevos
- **Total:** +2.246 líneas vs HEAD `4d1dbff`

---

## 4 · Status de build (verificado)

### Typecheck

```bash
$ npm run typecheck
> tops-ordenes@1.0.0 typecheck
> tsc --noEmit
(exit 0)
```

**Resultado:** ✅ PASS

### Build

```bash
$ npm run build
…
 ✓ Compiled successfully
 ✓ Generating static pages (35/35)
├ ƒ /api/drive/list                      0 B                0 B
├ ƒ /api/drive/ping                      0 B                0 B
├ ƒ /compras/drive                       174 B          87.5 kB
├ ƒ /drive                               4.94 kB        95.1 kB
ƒ Middleware                             82.1 kB
```

**Resultado:** ✅ PASS, 35 páginas generadas, sin errores, sin warnings.

---

## 5 · Cambios por hallazgo (matriz files × hallazgos)

| Archivo | H1 | H2 | H3 | H6 | H7 | H8 | H9 | H10 | H11 | H12 | R1 | R2 | R3 | R4 | R6 | R15 |
|---------|----|----|----|----|----|----|----|-----|-----|-----|----|----|----|----|----|-----|
| `src/lib/supabase/middleware.ts` | ✓ | | | | | | | | | | | | | | | |
| `src/lib/drive/client.ts` | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | ✓ | ✓ | | | | |
| `src/app/api/drive/list/route.ts` | | | ✓ | | ✓ | | ✓ | | | | | | ✓ | ✓ | ✓ | |
| `src/app/api/drive/ping/route.ts` | | | | | ✓ | | ✓ | | | | | | ✓ | ✓ | ✓ | |
| `src/app/(app)/drive/DriveBrowser.tsx` | | | ✓ | | | | | ✓ | | ✓ | | | | | | ✓ |
| `src/lib/rbac/check.ts` (nuevo) | | | | | | | | | | | | | | ✓ | | |

H1=middleware whitelist · H2=scopes mínimos · H3=paginación · H6=doc cleanup · H7=structured logs · H8=cache reset · H9=escape `\\` · H10=manejo 401 · H11=skeleton recientes · H12=requestId visible · R1/R2=isUnderRoot · R3=rate-limit · R4=RBAC · R6=sanitize requestId · R15=AbortController.

---

## 6 · Estrategia de commit propuesta

> **No ejecutar todavía** — sólo propuesta para tu revisión.

### Opción A — 3 commits secuenciales sobre `feature/nexus-fullstack` (recomendada)

Mantiene historia clara y permite revisar/revertir cada bloque por separado.

```bash
# Sin ejecutar — propuesta:

# Commit 1 — Hardening (H1-H12)
git add src/lib/supabase/middleware.ts
git add src/lib/drive/client.ts
git add src/app/api/drive/list/route.ts
git add src/app/api/drive/ping/route.ts
git add 'src/app/(app)/drive/DriveBrowser.tsx'
git add docs/DRIVE-PREFLIGHT-AUDIT.md docs/DRIVE-HARDENING-REPORT.md
git commit -m "feat(drive): preflight + hardening H1-H12

H1: middleware whitelist reducida a 5 rutas reales + 401 JSON en APIs
H2: scopes mínimos drive.readonly + drive.file
H3: paginación con pageToken / 50 default / 200 max
H6: doc cleanup GOOGLE_APPLICATION_CREDENTIALS
H7: structured logging JSON + timed() wrapper + x-request-id
H8: resetDriveCache() exportada
H9: escapeDriveQuery con backslash + quote
H10: 401 → mensaje 'Sesión expiró'
H11: skeleton mientras recentLoading
H12: requestId en ErrorPanel para soporte

Sin deploy, sin merge."

# Commit 2 — Red team remediation (R1, R2, R3, R4, R15)
git add src/lib/drive/client.ts
git add src/lib/rbac/check.ts
git add src/app/api/drive/list/route.ts
git add src/app/api/drive/ping/route.ts
git add 'src/app/(app)/drive/DriveBrowser.tsx'
git add docs/DRIVE-FINAL-REDTEAM.md docs/DRIVE-REMEDIATION-REPORT.md
git commit -m "fix(drive): red team remediation R1-R15

R1: isUnderRoot guard en listChildren
R2: isUnderRoot guard en getBreadcrumbs
R3: rate-limit 60/min /list y 20/min /ping con retry-after
R4: RBAC server-side compliance.view con fail-open documentado para FASE 1
R6 (bonus): safeRequestId() sanitiza header del cliente
R15: AbortController con identity-guard en DriveBrowser

Veredicto: READY FOR CREDENTIALS.
Build verde, typecheck verde. Sin deploy."

# Estado final
git log --oneline -3
```

**Pros:** 2 commits con scope claro; permite revertir hardening o remediation independientemente.
**Cons:** los archivos `client.ts`, `list/route.ts`, `ping/route.ts`, `DriveBrowser.tsx` aparecen modificados en ambos commits (no es problema técnico — git resuelve el diff acumulado).

### Opción B — 1 commit unificado (más simple)

```bash
git add src/lib/supabase/middleware.ts \
        src/lib/drive/client.ts \
        src/lib/rbac/check.ts \
        src/app/api/drive/list/route.ts \
        src/app/api/drive/ping/route.ts \
        'src/app/(app)/drive/DriveBrowser.tsx' \
        docs/DRIVE-PREFLIGHT-AUDIT.md \
        docs/DRIVE-HARDENING-REPORT.md \
        docs/DRIVE-FINAL-REDTEAM.md \
        docs/DRIVE-REMEDIATION-REPORT.md

git commit -m "feat(drive): pre-credentials hardening + redteam remediation

Cierre completo de auditoría Drive en 4 fases:
1. Preflight audit (H1 crítico + 7 medios/bajos)
2. Hardening H2-H12
3. Red team audit (R1-R2 críticos, R3-R4-R15 altos)
4. Remediation R1-R4-R15 + bonus R6

Files:
- middleware: whitelist reducida + 401 JSON
- drive/client: scopes mínimos, paginación, structured logs,
  guards isUnderRoot, escape mejorado, cache reset
- drive routes: rate-limit, RBAC, requestId sanitizado
- DriveBrowser: AbortController, paginación UI, mensajes específicos
- rbac/check (nuevo): helper server-side con fail-open documentado

Sin deploy. Sin merge. READY FOR CREDENTIALS."
```

**Pros:** 1 commit atómico, fácil de cherry-pick si hay que portar a otra branch.
**Cons:** scope grande; revisor tiene que digerir 782 LOC + 1464 líneas de docs en 1 diff.

### Opción C — Branch separado (más conservadora)

```bash
# Sin ejecutar — propuesta:
git switch -c feature/drive-hardening-redteam
# luego ejecutar Opción A o B sobre la nueva rama
```

**Pros:** aísla totalmente del scope nexus-fullstack; PR limpio sólo para Drive.
**Cons:** requiere planear el merge eventual a nexus-fullstack y a main.

### Recomendación

**Opción A sobre `feature/drive-hardening-redteam` (combina A + C).** Branch separada, 2 commits (hardening + remediation). Permite review focal y deja la integración del Drive como su propio merge gate.

Pero esto es decisión tuya — yo no ejecuto nada.

### Archivos NO incluidos en ninguna opción

| Archivo | Razón |
|---------|-------|
| `ERP-FINANCE-ARCHITECTURE.md` | No parte de la sesión Drive — preexistente, no toqué. Vos decidís cuándo y dónde commitearlo. |
| `.env.local` | Gitignored. Tiene credenciales sensibles. Nunca commitearlo (verificado: no aparece en `git status`). |

---

## 7 · Resumen del snapshot

| Métrica | Valor |
|---------|-------|
| Commit base verificado | `4d1dbff` |
| Branch actual | `feature/nexus-fullstack` |
| Upstream sync | 0 ahead / 0 behind |
| Divergencia con `origin/main` | 31 ahead / 2 behind (fuera de scope Drive) |
| Archivos tracked modificados | 5 |
| Archivos nuevos Drive | 5 (4 docs + check.ts) |
| Archivos nuevos NO Drive | 1 (ERP-FINANCE-ARCHITECTURE.md — preexistente) |
| Líneas de código añadidas | +782 |
| Líneas de docs añadidas | +1.464 |
| Typecheck | ✅ exit 0 |
| Build | ✅ Compiled successfully (35 pages) |
| `/drive` bundle | 4.94 kB |
| `/api/drive/list` | 0 B (handler runtime) |
| `/api/drive/ping` | 0 B (handler runtime) |
| Middleware | 82.1 kB |
| Veredicto remediation | 🟢 READY FOR CREDENTIALS |

---

## 8 · Restricciones honradas

- 🛑 NO DEPLOY — código intacto en producción
- 🛑 NO MERGE — branches sin tocar
- 🛑 NO PUSH — origin sin cambios
- 🛑 NO COMMIT — working tree sigue dirty con cambios sin stagear
- 🛑 NO PRODUCCIÓN — env vars sin tocar
- 🛑 NO CREDENCIALES — sin JSON / FOLDER_ID cargado
- 🛑 NO INVENTAR — todos los valores extraídos de `git` / `wc` / `npm run` directos

Snapshot listo para emparejar con `DRIVE-INTEGRATION-EXECUTION-PLAN.md`.

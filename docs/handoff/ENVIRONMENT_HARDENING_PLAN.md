# ENVIRONMENT HARDENING PLAN — TOPS NEXUS

**Fecha:** 2026-06-07
**Objetivo:** Eliminar definitivamente el problema "worktree sin `.env.local`" para que no reaparezca en futuras sesiones Claude Code.
**Alcance:** Solo tooling de entorno. NO modifica funcionalidad, lógica, RRHH, ERP, Login ni Sidebar.

---

## Componentes implementados

Archivo nuevo: **`scripts/env-check.mjs`** (sin dependencias; **nunca imprime valores**, solo nombres).
Cambios en **`package.json`** (solo `scripts`):
```json
"predev":    "node scripts/env-check.mjs --heal --guard",
"env:check": "node scripts/env-check.mjs"
```

> Estos cambios viven en `main` (working tree). **Para que apliquen en todos los worktrees futuros deben commitearse** (pendiente de tu autorización; ver "Propagación").

---

## H2 — Environment Guard (arranque)

- El hook **`predev`** corre automáticamente antes de `npm run dev`.
- Verifica las claves de gating y, si faltan, **muestra un warning claro en consola** (nombres, no valores) y **NO bloquea** el arranque (`exit 0`).
- Variables vigiladas:
  `CLIENTIFY_API_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `HIKVISION_HOST`, `HIKVISION_USER`, `HIKVISION_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`.
- Salida de ejemplo (worktree sin entorno):
  ```
  ⚠️  TOPS NEXUS — variables de entorno faltantes (runtime degradado)
       · No existe .env.local en: …/worktrees/<x>
       · Clientify: falta CLIENTIFY_API_KEY
       · Tracking: falta NEXT_PUBLIC_MAPBOX_TOKEN
       ...
       Fix: servir desde el worktree `main`, o `npm run env:check -- --heal`.
  ```

---

## H3 — Worktree Protection ("NINGÚN WORKTREE SIN ENTORNO")

- El mismo hook `predev` corre con **`--heal`**: si el worktree **no tiene `.env.local`**, lo **copia automáticamente** desde el worktree `main` (resuelto vía `git worktree list --porcelain`).
- Si ya existe, **no lo sobrescribe**. Si no encuentra `main`, **advierte** (no rompe).
- Resultado: cualquier worktree donde se ejecute `npm run dev` **auto-sana** su entorno desde `main`.

**Procedimiento manual (alternativa / primer arranque):**
```bash
# parado dentro del worktree nuevo:
npm run env:check -- --heal     # copia .env.local desde main si falta
# o explícito:
cp /Users/martinbattaglia/CODE/tops-ordenes/.env.local ./.env.local
```

> `.env.local` está gitignoreado: copiarlo a un worktree **no** lo expone al repo.

---

## H4 — Startup Audit (`npm run env:check`)

Comando único que informa PASS/FAIL por integración, **sin secretos**:
```bash
npm run env:check
```
Salida (estado actual en `main`):
```
  PASS  Clientify
  PASS  Tracking
  PASS  CCTV
  PASS  Supabase
  PASS  OCR
RESULT: PASS
```
- `exit 0` si todo PASS; `exit 1` si algo FAIL (apto para CI / pre-deploy).
- Modo CI: lee también `process.env` (variables inyectadas por Netlify), además de `.env.local`.

---

## Propagación (para que sea permanente)

1. **Commitear** `scripts/env-check.mjs` + el cambio de `package.json` a `main` (requiere tu OK — política actual: no commit sin autorización).
2. Al hacer merge/rebase, todos los worktrees `claude/*` heredan el `predev` → auto-heal + guard en cada `npm run dev`.
3. Estado intermedio ya mitigado: se copió `.env.local` al worktree activo (`magical-hopper-56b3dc`) como insurance.

---

## Garantía resultante

| Escenario | Antes | Después del hardening |
|---|---|---|
| `npm run dev` en worktree sin `.env.local` | Runtime sin entorno, módulos "no configurados", sin aviso | `predev` **auto-copia** `.env.local` desde `main` + **warning** si aún falta |
| Duda de configuración | Inspección manual | `npm run env:check` → PASS/FAIL |
| Pre-deploy | Sin verificación | Checklist con `env:check` obligatorio (ver `PRE_DEPLOY_ENVIRONMENT_CHECKLIST.md`) |

**No se modificó código de aplicación, ni lógica, ni módulos. Solo tooling de entorno.**

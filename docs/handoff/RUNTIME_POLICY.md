# RUNTIME POLICY — TOPS NEXUS (local dev)

**Fecha:** 2026-06-07
**Estado:** Vigente · hardening pre-producción

---

## Política oficial

```
SOURCE OF TRUTH = main   (/Users/martinbattaglia/CODE/tops-ordenes)
DEV SERVER      = main
```

- **`main`** es la **única fuente de verdad local**. Todo cambio de código y la configuración real (`.env.local`) viven en `main`.
- El **dev server (`localhost:3030`) debe correr desde `main`**, no desde worktrees `.claude/worktrees/*`.
- Los worktrees `claude/*` son **efímeros** (sesiones Claude Code). No son fuente de verdad ni runtime oficial.

---

## Por qué esta política existe (causa raíz histórica)

Incidente recurrente documentado en:
- `TREE_RESTRUCTURE_REGRESSION_AUDIT.md`
- `TRACKING_CCTV_RECURRING_INCIDENT.md`
- `ENVIRONMENT_AUDIT_REPORT.md`

**Causa raíz:** el dev server arrancaba desde un worktree (`magical-hopper-56b3dc`, etc.) que **no tenía `.env.local`** (archivo gitignoreado → no se copia al crear un worktree). Sin entorno → Clientify, Tracking, CCTV, OCR y Supabase aparecían "no configuradas". **Nunca fue un problema de código.**

---

## Reglas operativas

1. **Levantar el dev server siempre desde `main`:**
   ```bash
   cd /Users/martinbattaglia/CODE/tops-ordenes
   npm run dev      # corre predev (heal+guard) y luego next dev -p 3030
   ```
2. **Verificar el runtime** cuando algo "no se ve":
   ```bash
   # ¿quién sirve :3030 y desde qué cwd?
   lsof -nP -iTCP:3030 -sTCP:LISTEN
   ```
   El `cwd` del proceso debe ser `/Users/martinbattaglia/CODE/tops-ordenes`.
3. **Nunca confiar en un worktree para servir producción local.** Si la app de escritorio Claude relanza el server desde un worktree, ese worktree debe tener `.env.local` (ver `ENVIRONMENT_HARDENING_PLAN.md` → Worktree Protection).
4. **`.env.local` jamás se commitea** (está en `.gitignore`). Se aprovisiona por worktree (auto-heal) o se sirve desde `main`.

---

## Checklist rápido "edité pero no se ve"

| Síntoma | Verificar | Acción |
|---|---|---|
| Cambios de UI no aparecen | cwd del proceso `:3030` | Servir desde `main` |
| "No configurado" en módulos | `npm run env:check` | `--heal` o servir desde `main` |
| Mapa/CCTV vacíos | `.env.local` presente en el cwd servido | Auto-heal / `main` |

---

## Fuera de alcance de esta política
- Google Drive y ARCA: incidente/aprovisionamiento separado (variables no presentes ni en `main`).
- Despliegue a producción: regido por `PRE_DEPLOY_ENVIRONMENT_CHECKLIST.md`.

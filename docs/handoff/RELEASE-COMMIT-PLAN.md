# RELEASE-COMMIT-PLAN — TOPS NEXUS

**Fecha:** 2026-06-08 · Plan + ejecución del commit único del Release Candidate.
**Límite explícito:** NO push · NO merge · NO deploy. Solo dejar el RC commiteado en la branch.

---

## Pre-checks (ejecutados)
- ✅ `git add -A --dry-run` → 241 paths, 0 removes, **0** env/bak/trash/pem/log.
- ✅ `.gitignore` endurecido (env backups + `.next.trash-*/` ignorados).
- ✅ Scripts staged solo usan `process.env` (sin secretos hardcodeados).
- ✅ Branch `claude/gracious-pasteur-6efdde` (no es default) → no requiere crear branch nueva.

## Comandos
```bash
cd <worktree>
git add -A
git status            # confirmar: solo src/migraciones/docs/config/public/scripts; CERO .env*/.bak/.next.trash
git commit -m "feat(release): RC TOPS NEXUS — CRM360 + crm_units + Digital Twin + Compliance + RRHH + fase final QA"
# (sin push / sin merge / sin deploy)
```

## Mensaje de commit (propuesto)
```
feat(release): RC TOPS NEXUS — CRM360 + crm_units + Digital Twin + Compliance + RRHH + fase final QA

Release Candidate para deploy productivo. Incluye:
- CRM360: Kanban por defecto, buscador global, anti-URL (deal name), contratos por
  servicio + estado documental, deep links mapa→CRM360 (precarga de unidad).
- crm_units (fuente única) + reserva atómica (crm_reserve_units, UNIT_ALREADY_RESERVED).
- Digital Twin comercial: mapas Magaldi/Luján con color desde crm_units.
- Compliance Cockpit, RRHH (legajo/empleados/recibos), Facturación, Cockpit Ejecutivo,
  RBAC guard/visibility.
- Migraciones 0052–0069 (0069 clientify_deal_name OPCIONAL, no aplicada).
- Higiene: .gitignore endurecido (env backups + .next.trash-*), .eslintrc root:true.

Gates: tsc PASS · next lint PASS · next build PASS (79 páginas, 119 rutas).
NO push / NO merge / NO deploy en este paso.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## Post-commit (verificación)
```bash
git log --oneline -1          # ver el commit del RC
git status                    # working tree limpio (salvo .next/ y .bak ignorados)
git rev-list --left-right --count main...HEAD   # main 0 / HEAD 8 (7 RRHH + 1 release)
```

## Siguiente (acciones del usuario, fuera de este paso)
- Push de la branch, merge a `main`, build Netlify, smoke test → ver DEPLOY-RUNBOOK.md.
- Migraciones obligatorias confirmadas + decisión 0069 → ver PROD-CHECKLIST.md.

---

## Estado de ejecución
Ver al pie del resumen de la sesión: el commit del RC fue **creado** en la branch (sin push). Hash y resultado reportados al usuario.

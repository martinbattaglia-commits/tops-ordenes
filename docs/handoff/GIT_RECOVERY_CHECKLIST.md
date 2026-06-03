# TOPS NEXUS — Git Recovery Checklist (auditoría)

> Generado 2026-06-03. **Auditoría + estrategia. NO hace push, NO reescribe historia, NO squash.**

---

## 1. HEAD actual

```
Rama:   main
HEAD:   c5390bd  feat(wms): Gate 4B Packing
Estado: main … [ahead 22] de origin/main   (SIN PUSH)
Working tree: 43 entradas sin commitear (ver §5 / ENTREGABLE 5)
```

## 2. Commits críticos (cadena WMS reciente)

```
c5390bd  feat(wms): Gate 4B Packing            ◄── HEAD · Gate 4B (cierre)
17b0be5  feat(wms): Gate 4A Picking            ◄── Gate 4A (cierre)
7aa9e52  feat(wms): FASE 9A — Lotes y Vencimientos (lectura)
8108fb2  feat(comercial): herramientas comerciales V1
e1c29c9  feat(wms-digital-twin): complete phase 3-4-5-7
e895971  feat(tracking): módulo Tracking de Flota
fa1194e  feat(compras): migrate purchasing module to nx system
...
```

**Commits críticos a preservar:** `c5390bd` (4B), `17b0be5` (4A), `7aa9e52` (9A).

## 3. Ramas (locales/remotas)

| Rama | HEAD | Nota |
|---|---|---|
| `* main` | `c5390bd` | activa · ahead 22 · sin push |
| `backup/main-pre-fullmerge-20260530` | `c9e5ee6` | **backup previo** a esta fase |
| `deploy/safe-sections` | `c9e5ee6` | behind 43 |
| `docs/consolidacion-arquitectonica` | `181ee0b` | docs |
| `feature/arca-production-fase-e` | `a3c4d63` | ARCA |
| `feature/documents-enterprise-ready` | `8c1f465` | docs C1 |
| `feature/nexus-consolidation` | `222735f` | module map |
| `feature/nexus-fullstack` | `0e3510f` | organigrama/workspace |
| `feature/ui-redesign` | `5daeb13` | UI WIP |
| `fix/paridad-1-migraciones` | `4e20d62` | migraciones 0008-0010 |
| `wip/erp-consolidation` | `ca17522` | informe riesgos |

> El backup más reciente (`backup/main-pre-fullmerge-20260530`) **NO** contiene Gates 4A/4B. No hay respaldo remoto de la fase WMS actual hasta hacer push.

## 4. Estrategia de recuperación

### 4.1 Respaldo inmediato recomendado (NO ejecutado — sugerido)
```bash
# Crear una rama de respaldo local del estado actual (sin push, sin tocar main)
git branch backup/main-wms-gate4b-20260603        # apunta a c5390bd
# (opcional, cuando se autorice) respaldo remoto:
# git push origin main
# git push origin backup/main-wms-gate4b-20260603
```

### 4.2 Recuperar un commit "perdido" (reflog)
```bash
git reflog                       # localizar el hash (c5390bd / 17b0be5 / ...)
git branch rescue/<nombre> <hash>
```

### 4.3 Recuperar trabajo sin commitear (working tree)
```bash
git stash list                   # si se hubiera stasheado
git status --short               # 43 entradas vivas (Gates 1/2/3 + otros)
# El trabajo de Gates 1/2/3 está SOLO en working tree → respaldar antes de cualquier reset:
git diff > backups/worktree_$(date +%Y%m%d).patch
git status --porcelain > backups/worktree_status_$(date +%Y%m%d).txt
```

## 5. Estrategia de rollback

> Objetivo: poder volver al estado exacto del cierre de Gate 4B sin perder el trabajo no commiteado.

- **Rollback de Gate 4B (revertir el commit, conservando archivos):**
  ```bash
  git revert --no-commit c5390bd     # crea un revert; NO reescribe historia
  # o, para deshacer el commit dejando los cambios en el working tree:
  git reset --soft 17b0be5           # vuelve a Gate 4A, archivos quedan staged
  ```
  ⚠️ NO usar `git reset --hard` con 43 archivos vivos sin commitear (se perderían Gates 1/2/3).

- **Rollback de migración 0033/0032 (DB):** no se hace por git. Requiere DDL inverso manual (drop functions/tables) auditable — coordinar y respaldar antes (ver `SUPABASE_BACKUP_CHECKLIST.md`).

- **Punto de retorno seguro:** rama `backup/main-wms-gate4b-20260603` (§4.1) + patch del working tree (§4.3).

## 6. Reglas de esta auditoría
- ❌ NO push · ❌ NO reescribir historia · ❌ NO squash · ❌ NO `reset --hard` con worktree sucio.
- ✅ Solo creación de ramas de respaldo locales y patches (no ejecutados aquí; comandos sugeridos).

## 7. Checklist de respaldo git (pre-Gate 4C)
- [ ] `git branch backup/main-wms-gate4b-20260603`
- [ ] `git diff > backups/worktree_20260603.patch` (respaldo de Gates 1/2/3 sin commitear)
- [ ] (autorización pendiente) `git push origin main`
- [ ] Fase 0: commits aislados de Gates 1/2/3 para reparar cadena de migraciones

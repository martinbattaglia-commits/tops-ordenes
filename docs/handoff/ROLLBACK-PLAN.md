# ROLLBACK-PLAN — TOPS NEXUS

**Fecha:** 2026-06-08 · Plan de reversión del Deploy Productivo.
**Ejecuta:** el usuario. Objetivo: volver al último estado estable en minutos.

---

## Disparadores de rollback
- Build de Netlify falla tras el merge.
- Smoke test post-deploy con fallo **crítico** (login roto, módulo core caído, errores 500 generalizados).
- Regresión grave reportada en producción.

---

## Opción A — Rollback de deploy (más rápido, sin tocar git)
Netlify guarda deploys previos.
1. Netlify → Deploys → seleccionar el último deploy **Published** estable (anterior al release).
2. **Publish deploy** (rollback instantáneo, sin rebuild).
3. Verificar que el dominio sirve la versión previa.
> Recomendado como primera reacción: restablece el sitio en segundos.

## Opción B — Revertir el merge en `main` (revierte el código)
```bash
git checkout main
git pull origin main
git revert -m 1 <merge_commit_sha>     # revierte el merge del release
git push origin main                   # dispara rebuild con el código previo
```
- `-m 1` mantiene la línea de `main` previa al merge.
- Alternativa dura (si no hay commits posteriores): `git reset --hard <sha_previo> && git push --force-with-lease` (usar con cuidado; preferir `revert`).

## Migraciones / base de datos
- Las migraciones aplicadas (0052–0068) son **aditivas** (ADD COLUMN/TABLE/RPC) e **idempotentes**.
- **0069** (`clientify_deal_name`) es ADD COLUMN aditivo: aunque haya quedado aplicada, el código previo la **ignora** → no requiere rollback de esquema.
- **No** se hace `DROP` de columnas/tablas en un rollback de release: el front previo no las usa y dropear arriesga pérdida de datos. Dejar el esquema como está.
- crm_units / reservas: revertir el código no borra reservas ya hechas (datos legítimos). El estado de `crm_units` persiste y es consistente.

## Entornos / variables
- Si el rollback se debió a una env var mal seteada (Clientify key, Drive root), corregir la variable en Netlify y **redeploy** en vez de revertir código.

## Post-rollback
- [ ] Confirmar sitio estable (smoke test mínimo: login + 1 módulo core).
- [ ] Registrar causa raíz del fallo.
- [ ] Re-planificar el release corrigiendo el bloqueante antes de reintentar.

---

## Matriz rápida
| Falla | Acción |
|---|---|
| Build Netlify rojo | Opción A (republicar deploy previo) + arreglar y reintentar |
| Bug crítico runtime | Opción A inmediata; luego Opción B si se necesita revertir código |
| Env var mala | Corregir variable + redeploy (no revertir código) |
| Migración problemática | No dropear; revertir código (Opción B); el esquema aditivo no molesta |

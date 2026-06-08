# TOPS NEXUS — RRHH · R6 VISUAL E2E REPORT

> **Tipo:** ejecución del E2E visual de RRHH con la Claude Chrome Extension sobre el navegador local.
> Read-only — no se modificó código, no se aplicaron fixes, no se desplegó, no se tocó producción.
> **Resultado:** **NO EJECUTABLE — el dev server corriendo NO sirve la rama R6.** **No se declara PASS.**
> **Fecha:** 2026-06-07.

---

## 1. Qué se hizo (con evidencia)
1. **Navegador conectado:** Browser 1 (macOS, local) vía Claude Chrome Extension. ✅
2. **Pestaña Nexus logueada:** `localhost:3030/ejecutivo` ("Cockpit ejecutivo · TOPS NEXUS"). ✅
3. **Navegación a `/rrhh`:** resultado **404 · "Página no encontrada"** (404 de la app, ya autenticado).
   - Captura: pantalla "404 · Página no encontrada · Volver al panel".
   - `get_page_text` confirma `URL: http://localhost:3030/rrhh` → "404 Página no encontrada".

## 2. Causa raíz (demostrada, dura)
**El dev server en `:3030` está corriendo desde OTRO worktree, que no contiene el módulo R6.**

Evidencia (host, read-only):
```
lsof :3030 LISTEN → PID 53771  (next-server v14.2.18)
cwd del PID 53771 → /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/magical-hopper-56b3dc
```
El código R6 (con la ruta `/rrhh`) está en **este** worktree:
```
worktree R6 = .../.claude/worktrees/gracious-pasteur-6efdde   (rama claude/gracious-pasteur-6efdde)
src/app/(app)/rrhh/page.tsx → PRESENTE ✓
```
⇒ La app servida en `:3030` proviene de `magical-hopper-56b3dc` (otra rama, sin R6). Por eso `/rrhh`
devuelve **404**. **No es un defecto de R6**; el server simplemente **no está sirviendo el código de R6**
(el branch R6 no está mergeado ni desplegado, y el dev server apunta a otro checkout).

> Nota: el commit anterior de este informe reportó `ERR_CONNECTION_REFUSED` (server caído en ese
> momento). Ahora el server está arriba pero es **otro worktree** → 404. Ambos estados confirman lo
> mismo: **no hay una instancia sirviendo R6**.

## 3. Cobertura — estado real
| Área (Sidebar/Dashboard/Mi Espacio/Empleados/Solicitudes/Novedades/Documentación/Organigrama) | ⛔ **NO EJECUTADO** — `/rrhh` = 404 en el server activo |
| Matriz por rol (6 roles) | ⛔ **NO EJECUTADO** — además requeriría 6 logins distintos |
| Escenarios de escritura | ⛔ **NO EJECUTADO** — y prohibidos contra prod (append-only) |

No se observó ninguna pantalla de RRHH → **no hay evidencia para declarar PASS.**

## 4. Veredicto
> ## R6 VISUAL — **NO EJECUTADO (el server activo no es la rama R6)**
> No es `R6 VISUAL PASS` (sin evidencia de pantallas). No es defecto de R6 (`tsc`=0 errores, commit
> `043ae54`); es que **`:3030` sirve otro worktree** (`magical-hopper-56b3dc`).

## 5. Para ejecutar realmente el E2E visual (opciones)
1. **Servir esta rama R6:** levantar el dev server **desde** `.../worktrees/gracious-pasteur-6efdde`
   (`npm run dev` en un puerto libre, p.ej. 3031), o detener el server actual y levantarlo desde acá.
   - **Caveat env:** este worktree **no tiene `.env.local`** → sin Supabase, las páginas RRHH
     renderizarían el shell pero con datos no disponibles (demo/`ModuleUnavailable`). Para un E2E
     **con datos**, el server R6 debe tener env apuntando a **STAGING** (`vrxosunxlhohmqymxots`).
2. **Deploy preview** de la rama R6 (Netlify) contra **staging**, y validar ahí.
3. **Escritura** (crear/aprobar/anular): solo en staging, **nunca** prod (restricción de Dirección).
4. **Matriz por rol:** proveer logins de los 6 usuarios de prueba.

> Mientras tanto **R6 permanece `IMPLEMENTED · AWAITING E2E VALIDATION`**. No se desplegó ni promovió
> nada (la promoción queda para RELEASE REVIEW, gate separado).

---
*Reporte E2E visual — ejecución real con evidencia (404 + cwd del server). No ejecutable: el dev server activo sirve otro worktree, no R6. Sin fixes, sin deploy, sin tocar producción, sin abrir R7.*

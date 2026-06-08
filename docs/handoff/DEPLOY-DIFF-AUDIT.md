# DEPLOY-DIFF-AUDIT — TOPS NEXUS

**Fecha:** 2026-06-08 · Auditoría de divergencia navegación validada ↔ desplegada.
**Sin cambios implementados.** Solo evidencia por archivo y commit.

---

## TL;DR (conclusión)
**El merge NO sobrescribió el árbol aprobado.** `main` (`70a9944`) contiene la navegación validada **intacta** (diff contra la RC = **vacío**). La nav vieja que se ve en producción corresponde al deploy **anterior** (`86b54ca`), que **nunca tuvo** la reorganización de navegación (vivía solo en la rama RC). → **Es un problema de capa de DEPLOY/PUBLISH, no de código fuente.** Lo más probable: el build de `70a9944` no publicó (en curso / falló / caché / no disparó).

---

## Mapa de commits
| Commit | Qué es | Navegación |
|---|---|---|
| `a477354` | ancestro común (merge-base) | **vieja** (pre-reorg) |
| `2531768` | feat(nav): **reestructuración del árbol de navegación** (Cockpit + headers) | introduce **nav nueva** |
| `4665b83` | fix(nav): isActive exact-match /rrhh | ajuste nav nueva |
| `1430204` | **RC release** (tip de trabajo validado) | **nav nueva** ✅ |
| `891e337` | RC + doc runbook | nav nueva (sin tocar nav) |
| `86b54ca` | **main ANTERIOR** (PR #13 festive-blackburn + login) = **deploy previo en prod** | **vieja** (PR#13/login NO tocaron nav) |
| `70a9944` | **main ACTUAL** (merge RC + login) | **nav nueva** ✅ |

---

## Respuestas a las 4 preguntas

### 1. ¿Qué commit contiene la versión visual final validada?
La **RC `1430204`** (tip `891e337`), que incluye los commits de navegación `2531768` (reorganización) y `4665b83` (fix isActive). Esa es la nav que se validó visualmente en el dev de este worktree.

### 2. ¿Qué commit quedó en `main`?
**`70a9944`** — merge de la RC validada + la modernización de login (PR #13) que ya estaba en `main`. **Contiene la nav validada.**

### 3. ¿Qué archivos de navegación/layout/sidebar difieren?
**Entre el deploy viejo (`86b54ca`) y `main` nuevo (`70a9944`)** — esta es la diferencia que se ve:
```
src/app/(app)/layout.tsx                   | 12 ++++-
src/components/shell/AccesoRestringido.tsx | 19 +++++++   (nuevo)
src/components/shell/MobileBottomNav.tsx   |  9 ++--
src/components/shell/Shell.tsx             |  7 +--
src/components/shell/Sidebar.tsx           | 84 +++++++++++++++++-------------
src/components/shell/Topbar.tsx            |  4 --
```
Ejemplo concreto (Sidebar, viejo→nuevo): se agrega flag `exec?` (ítems ejecutivos/financieros ocultos por permiso `cockpit.view`), se **unifica Cockpit** y se **elimina el grupo "Google Workspace"**.

**Entre la RC validada (`1430204`/`891e337`) y `main` (`70a9944`):** **NINGUNO** — los archivos de nav/shell/layout son **idénticos**.

### 4. ¿El merge sobrescribió parte del árbol aprobado?
**NO.** Evidencia:
- `git diff --stat 891e337 70a9944 -- src/components/shell/ src/app/(app)/layout.tsx` → **vacío**.
- `git diff --stat 1430204 70a9944 -- src/components/shell/ ...` → **vacío**.
- Lo único que el merge **agregó** respecto de la RC fueron **10 archivos de login** (`LoginExperience.tsx`, `LoginForm.tsx`, `login-theme.css`, `login/page.tsx`, docs + 2 íconos): `2331 insertions, 164 deletions`, **todo login**.
- `git diff --stat a477354 86b54ca -- src/components/shell/ ...` → **vacío** (PR#13/login nunca tocaron nav).

---

## Evidencia (comandos reproducibles)
```bash
# nav commits presentes en main pero NO en el deploy viejo:
git merge-base --is-ancestor 2531768 70a9944   # SÍ
git merge-base --is-ancestor 2531768 86b54ca   # NO
git merge-base --is-ancestor 4665b83 70a9944   # SÍ / 86b54ca NO

# el merge no tocó nav (vacío):
git diff --stat 891e337 70a9944 -- src/components/shell/ 'src/app/(app)/layout.tsx'

# nav difiere entre deploy viejo y main nuevo:
git diff --stat 86b54ca 70a9944 -- src/components/shell/ 'src/app/(app)/layout.tsx'
```

---

## Diagnóstico
- **Código fuente en `main`:** ✅ correcto. `70a9944` = nav validada, sin alteración por el merge.
- **Producción muestra nav vieja:** ⇒ Netlify está sirviendo aún el artefacto de **`86b54ca`** (deploy previo). El build de `70a9944` **no está live**.

### Causas posibles (a verificar en el dashboard de Netlify — NO implementado aquí)
1. Build de `70a9944` **en curso** todavía (las capturas se tomaron antes de Published).
2. Build de `70a9944` **falló** → Netlify mantiene el último Published (`86b54ca`).
3. **Caché de build** sirviendo artefacto viejo → requiere "Clear cache and deploy".
4. El push a `main` **no disparó** auto-deploy (config de branch-to-deploy).
5. Branch-deploy vs production deploy apuntando a otro commit.

> No puedo confirmar el commit realmente publicado: no tengo acceso al dashboard de Netlify ni a sesión autenticada de prod (todas las rutas internas → 307 login). La evidencia de **código** es concluyente; la incógnita está **solo en la capa de publish**.

---

## Qué verificar antes de corregir (sin implementar aún)
- [ ] Netlify → Deploys: ¿cuál es el **Published** actual? ¿Es `70a9944` o `86b54ca`?
- [ ] Si hay un deploy de `70a9944` **Failed** → leer el log (causa del fallo).
- [ ] Si está `86b54ca` Published y `70a9944` no aparece → el push no disparó build (revisar repo/branch link de Netlify).
- [ ] Acción candidata (a aprobar): **Trigger deploy / Clear cache and deploy** del commit `70a9944`. (No ejecutado.)

---

## Conclusión
No hubo pérdida ni sobrescritura de la versión aprobada: **`main` @ `70a9944` tiene la navegación validada idéntica a la RC**. La divergencia visible es de **deploy/publish** (prod sirviendo `86b54ca`). El siguiente paso es **verificar el estado del deploy en Netlify**, no tocar el código.

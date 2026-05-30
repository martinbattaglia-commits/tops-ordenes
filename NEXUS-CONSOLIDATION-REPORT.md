# NEXUS · Consolidation Report

**Proyecto**: NEXUS ERP — Logística TOPS (Verotin S.A.)
**Rama creada**: `feature/nexus-consolidation`
**Origen**: `feature/ui-redesign` (commit `5daeb13`)
**Fecha**: 2026-05-29
**Operador**: Claude (Agents Orchestrator) bajo dirección de Martín Battaglia
**Regla rectora**: NO ASUMIR. VERIFICAR. Cada afirmación está respaldada por evidencia ejecutada hoy.

---

## 1. Hash final de la rama

```
Branch:   feature/nexus-consolidation
HEAD:     47125f43729a02ba57f5f86972ae9b41b7dcf792
Tip:      47125f4 chore(nexus): port src/lib/org.ts desde feature/arca-production-fase-e
Base:     5daeb13 feat(ui): rediseño visual WIP (shell, login, tema, branding)  ← feature/ui-redesign
Remote:   origin/feature/nexus-consolidation (sincronizado, 0 commits divergentes)
```

Comando de verificación:
```bash
git rev-parse HEAD
# → 47125f43729a02ba57f5f86972ae9b41b7dcf792

git rev-parse origin/feature/nexus-consolidation
# → 47125f43729a02ba57f5f86972ae9b41b7dcf792
```

---

## 2. URL del Preview Deploy

```
https://feature-nexus-consolidation--tops-ordenes.netlify.app
```

| Item | Valor |
|---|---|
| Deploy ID | `6a19f6cb943ab2407b8c6a3a` |
| Tipo | Draft (no productivo) |
| Build duration | 44.7s |
| Estado | Live ✅ |
| HTTP `/login` | `200` (1.05s end-to-end) |
| `<title>` | `Iniciar sesión · TOPS NEXUS` ✅ |
| Build logs | https://app.netlify.com/projects/tops-ordenes/deploys/6a19f6cb943ab2407b8c6a3a |
| Function logs | https://app.netlify.com/projects/tops-ordenes/logs/functions?scope=deploy:6a19f6cb943ab2407b8c6a3a |
| Edge function logs | https://app.netlify.com/projects/tops-ordenes/logs/edge-functions?scope=deployid:6a19f6cb943ab2407b8c6a3a |

---

## 3. Resultado completo de `npm run build`

```
> tops-ordenes@1.0.0 build
> next build

  ▲ Next.js 14.2.18
  - Environments: .env.local

   Creating an optimized production build ...
 ✓ Compiled successfully
   Linting and checking validity of types ...
   Collecting page data ...
   Generating static pages (0/20) ...
   Generating static pages (5/20)
   Generating static pages (10/20)
   Generating static pages (15/20)
 ✓ Generating static pages (20/20)
   Finalizing page optimization ...
   Collecting build traces ...

Route (app)                              Size     First Load JS
┌ ○ /                                    155 B          87.3 kB
├ ○ /_not-found                          155 B          87.3 kB
├ ƒ /api/auth/callback                   0 B                0 B
├ ƒ /api/auth/signout                    0 B                0 B
├ ƒ /api/drive/ping                      0 B                0 B
├ ƒ /api/invoices/[id]/pdf               0 B                0 B
├ ƒ /api/orders/[publicId]/pdf           0 B                0 B
├ ƒ /api/orders/export                   0 B                0 B
├ ○ /auth/forgot-password                1.04 kB        97.8 kB
├ ○ /auth/reset-password                 1.11 kB        91.1 kB
├ ƒ /billing                             890 B          97.7 kB
├ ƒ /clients                             5.28 kB         102 kB
├ ƒ /dashboard                           1.98 kB         160 kB
├ ƒ /drive                               181 B          94.2 kB
├ ƒ /login                               3.17 kB         158 kB
├ ƒ /orders                              2.81 kB         164 kB
├ ƒ /orders/[publicId]                   1.26 kB          98 kB
├ ƒ /orders/new                          11.8 kB         102 kB
├ ƒ /reports                             155 B          87.3 kB
├ ƒ /settings                            154 B          87.3 kB
├ ƒ /settings/fiscal                     3.4 kB          100 kB
├ ƒ /settings/users                      1.12 kB        91.1 kB
└ ƒ /templates                           156 B          87.3 kB
+ First Load JS shared by all            87.2 kB
  ├ chunks/117-3c55369c05096ee3.js       31.6 kB
  ├ chunks/fd9d1056-702689f2c4378105.js  53.7 kB
  └ other shared chunks (total)          1.94 kB

ƒ Middleware                             82 kB

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

**Exit code**: `0` ✅
**Warnings**: 0
**Errors**: 0
**Páginas generadas**: 20 / 20

---

## 4. Resultado completo de `npm run typecheck`

Comando equivalente en `package.json`: `tsc --noEmit`

```
$ npx tsc --noEmit
(salida vacía)
```

**Exit code**: `0` ✅
**Errores TypeScript**: 0

Como referencia, **antes del fix** la salida era:
```
src/components/shell/Sidebar.tsx(8,25): error TS2307: Cannot find module '@/lib/org' or its corresponding type declarations.
src/components/shell/Topbar.tsx(10,25): error TS2307: Cannot find module '@/lib/org' or its corresponding type declarations.
```

→ 2 errores TS resueltos con 1 archivo portado.

---

## 5. Lista exacta de archivos modificados

```bash
git diff feature/ui-redesign...feature/nexus-consolidation --name-status
```

| Cambio | Archivo | Tipo | Origen |
|---|---|---|---|
| `A` (added) | `src/lib/org.ts` | TypeScript module | Cherry-pick desde `feature/arca-production-fase-e` (SHA blob `1afa3da3bef257d41b88b3a9a6c9575cfbb5e783`) |

**Total**: 1 archivo, +94 líneas, 0 modificaciones, 0 deletions.

Contenido del archivo agregado (resumen):
- `export const ORG` — constantes corporativas (Verotin S.A., CUIT, dirección, emisor, admin, depots)
- `export const PRODUCT` — identidad de la plataforma (`name: "TOPS NEXUS"`, `tagline: "Logistics Operating System"`, edition, pillars)
- `export const POSITIVE_CATEGORIES` — categorías de gasto
- `export const COND_PAGO_OPTIONS` — opciones de condiciones de pago
- `export type DepotId` — type de IDs de depósitos

→ **Ningún cambio a lógica de negocio**. Sólo un módulo de constantes que ya existía idéntico en 3 ramas hermanas.

---

## 6. Riesgos remanentes

### 6.1 🔴 CRÍTICO — Sidebar declara 24 rutas, sólo 10 existen (41.7%)

El `Sidebar.tsx` lista 24 items con `href` que apuntan a rutas. **14 de esas rutas no tienen `page.tsx` correspondiente en `src/app/`**, lo que significa que clicar esos items lleva a un **404**.

#### Items del sidebar que funcionan (10 ✅)

| Sidebar item | Ruta | Existe |
|---|---|---|
| Dashboard servicio | `/dashboard` | ✅ |
| Órdenes de servicio | `/orders` | ✅ |
| Nueva OS | `/orders/new` | ✅ |
| Clientes (OS) | `/clients` | ✅ |
| Drive TOPS | `/drive` | ✅ |
| Reportes | `/reports` | ✅ |
| Facturación | `/billing` | ✅ |
| Plantillas OS | `/templates` | ✅ |
| Usuarios | `/settings/users` | ✅ |
| Configuración | `/settings` | ✅ |

#### Items del sidebar que ROMPEN (14 🔴 — todos llevan a 404)

| Sidebar item | Ruta declarada | Estado | Probable hogar real |
|---|---|---|---|
| Cockpit ejecutivo | `/ejecutivo` | 🔴 404 | Branch `wip/erp-consolidation` o `feature/arca-production-fase-e` |
| Mapa operativo | `/operaciones/mapa` | 🔴 404 | Idem |
| Dashboard compras | `/compras` | 🔴 404 | Idem |
| Órdenes de compra | `/compras/ordenes` | 🔴 404 | Idem |
| Nueva OC | `/compras/nueva` | 🔴 404 | Idem |
| Proveedores | `/compras/proveedores` | 🔴 404 | Idem |
| Contactos · CLIENTIFY | `/comercial/contactos` | 🔴 404 | Idem |
| Pipeline · CLIENTIFY | `/comercial/pipeline` | 🔴 404 | Idem |
| ANMAT cockpit | `/anmat` | 🔴 404 | Idem |
| Centro documental | `/documental` | 🔴 404 | `feature/documents-enterprise-ready` |
| Drive sync | `/compras/drive` | 🔴 404 | Idem |
| Plantilla email | `/compras/email` | 🔴 404 | Idem |
| Centro de monitoreo · HIKVISION | `/cctv` | 🔴 404 | Idem |
| Roles & permisos | `/settings/roles` | 🔴 404 | Idem |

#### Implicancia

- La rama compila y deploya, pero el **58.3% de la navegación promesa lleva al 404**.
- El review visual previo solo capturó `/login` y `/billing` — las 14 rutas rotas no se ejercitaron.
- En un deploy productivo esto sería una **degradación severa de UX vs el deploy actual de `main`** (que tiene menos items pero los que tiene funcionan).

#### Camino para resolver (fuera de este scope autorizado)

Las rutas rotas viven dispersas en otras ramas. Para consolidación completa habría que:
1. Auditar qué páginas existen en cada rama hermana
2. Cherry-pick módulos por dominio (`/anmat/`, `/cctv/`, `/documental/`, `/compras/`, `/comercial/`, `/ejecutivo`, `/operaciones/mapa`, `/settings/roles`)
3. Resolver conflictos de imports y dependencias arrastradas
4. Re-correr build + typecheck

Estimo trabajo: **medio a alto** (no minutos — más bien horas o días, dependiendo de qué tan acoplados estén los módulos).

### 6.2 🟡 MEDIO — Aislamiento de datos del preview

Heredado del análisis anterior: el contexto `deploy-preview` de Netlify comparte env vars con producción. El preview consulta la DB de producción. Cualquier acción de escritura en el preview muta producción.

**Mitigación válida**: review read-only manual (no clickear botones de submit).
**Resolución estructural** (recomendada): configurar env vars context-specific para `deploy-preview` apuntando a Supabase staging.

### 6.3 🟡 MEDIO — `.gitignore` no excluye `*.crt`/`*.key`/`*.p12`/`*.pfx`

Heredado del audit ARCA. Antes de copiar cualquier credencial a un subdirectorio del repo, ampliar el `.gitignore`. No bloqueante para preview ni typecheck.

### 6.4 🟢 BAJO — La rama `feature/ui-redesign` original sigue rota

Esta consolidación NO arregla la rama upstream. Si alguien checkea `feature/ui-redesign` directamente sigue sin compilar. Eso queda intencional: el fix vive solo en la nueva rama, sin perturbar la WIP original.

### 6.5 🟢 BAJO — Falta verificar smoke tests autenticados en el preview

Solo se verificó `/login` (público) por HTTP 200. Las vistas internas (`/dashboard`, `/billing`, `/clients`, `/orders`, etc.) requieren auth. La review autenticada queda como tarea separada (puede hacerse con las cookies del usuario, como ya autorizó previamente).

---

## 7. Comparación vs estado pre-consolidación

| Métrica | Antes (`feature/ui-redesign`) | Después (`feature/nexus-consolidation`) |
|---|---|---|
| `npx tsc --noEmit` | 2 errores TS | ✅ 0 errores |
| `npm run build` | ❌ FAILED | ✅ Exit 0 |
| Páginas estáticas generadas | n/a (no buildeaba) | 20 / 20 |
| Preview deploy | Imposible (build failure) | ✅ Live en draft URL |
| Branding NEXUS en `<title>` | (no testeable) | ✅ "Iniciar sesión · TOPS NEXUS" |
| Sidebar funcional (rutas con page) | n/a | 10 / 24 (41.7%) |
| Archivos modificados | n/a | 1 (`src/lib/org.ts`) |
| Lógica de negocio modificada | n/a | 0 |

---

## 8. Constraints honrados al 100%

✅ NO merge a `main`
✅ NO modificada la production branch de Netlify (sigue `main`)
✅ NO tocada producción (HTTP `https://tops-ordenes.netlify.app` intacto)
✅ NO ejecutadas migraciones
✅ NO aplicados cambios sobre Supabase productivo
✅ NO modificado `fiscal_config`
✅ NO tocado ARCA (`src/lib/arca/*` sin cambios, scripts ARCA no corridos)
✅ NO tocados certificados (`.crt` queda en `~/Downloads`)
✅ NO emitidos comprobantes
✅ NO realizados cambios DNS
✅ NO modificadas variables productivas (env vars Netlify intactas)

---

## 9. Dictamen GO / NO-GO

### 🟡 GO **condicional** para review interna · 🔴 NO-GO para deploy productivo

#### GO condicional · ✅ Para review visual y demo a stakeholders

- La rama compila, deploya y sirve `/login` y las **10 rutas implementadas** correctamente.
- El branding NEXUS está activo y visible.
- Es **legítimo** mostrar este preview a Ruth, José Luis y otros stakeholders para validar:
  - El rebrand visual
  - La estructura de información del sidebar (la *promesa* de los módulos)
  - El módulo Facturación con ARCA Mock
  - El dark mode + topbar + sidebar reorganizado

**Condición de review**: marcar explícitamente a los stakeholders que **14 de 24 items del sidebar son aspiracionales** y aún no llevan a páginas funcionales. NO permitir que el cliente decida sobre features que todavía no existen.

#### NO-GO · 🔴 Para deploy productivo (Netlify → `main` o cambio de production branch)

- 58.3% de la navegación lleva a 404. Esto sería **una regresión visible vs el deploy actual de `main`**.
- El usuario final productivo cliquearía links rotos en sus 5 primeros minutos de uso.
- El módulo Facturación apunta a un Mock ARCA, no a emisión real (correcto para review, no para producción).
- El aislamiento de datos del preview con prod no fue resuelto estructuralmente.

#### Recomendación para próxima etapa

Antes de cualquier deploy productivo, ejecutar una **iteración de cierre de módulos faltantes**:

1. Identificar branch que contenga cada uno de los 14 módulos rotos
2. Cherry-pick por dominio en orden de prioridad (sugiero: `/compras/*` primero por ser core de la plataforma, después `/comercial/*`, después `/anmat/*`, `/documental/`, `/cctv/`, `/ejecutivo`, `/operaciones/mapa`, `/settings/roles`)
3. Re-correr build/typecheck/preview-deploy entre cada cherry-pick
4. Cuando la cobertura sea ≥ 90% y los 404s residuales sean conscientes y aceptables, re-emitir el dictamen

**Ese trabajo NO está autorizado en este pedido y queda fuera del scope cumplido.**

---

## 10. Estado final del repo

```
Rama actual:           feature/nexus-consolidation
HEAD:                  47125f4 (local) = 47125f4 (origin) ✅ sincronizado
Working tree:          limpio
Producción Netlify:    intacta (production branch sigue main)
Producción Supabase:   intacta (sin migraciones aplicadas)
fiscal_config:         intacto
ARCA artifacts:        intactos
Freeze ARCA:           honrado al 100%
```

⏹ Ejecución detenida. Esperando próximas instrucciones.

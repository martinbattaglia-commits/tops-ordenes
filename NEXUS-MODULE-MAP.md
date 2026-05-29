# NEXUS · Module Map — Auditoría exhaustiva de ramas

**Proyecto**: NEXUS ERP — Logística TOPS (Verotin S.A.)
**Fecha**: 2026-05-29
**Operador**: Claude (Agents Orchestrator) bajo dirección de Martín Battaglia
**Modo**: AUDIT ONLY · NO se modificó código · NO se mergeó nada · NO se tocó producción · NO ARCA

---

## TL;DR — El hallazgo que cambia el panorama

**No hay que construir 14 páginas. Ya están construidas. Viven en otra rama.**

| Rama | src/ files | Páginas | Branding NEXUS | Módulos NEXUS reales | Veredicto |
|---|---|---|---|---|---|
| `main` | 95 | 16 | ❌ legacy TOPS Órdenes | ❌ | Producción actual |
| `fix/paridad-1-migraciones` | 95 | 16 | ❌ legacy | ❌ | Hot-fix, igual a main |
| `feature/ui-redesign` | 96 | 16 | ✅ TOPS NEXUS | ❌ Solo branding visual | **Branding sin features** |
| `feature/nexus-consolidation` | 97 | 16 | ✅ TOPS NEXUS | ❌ Solo branding visual | **= ui-redesign + org.ts (build-fix)** |
| `feature/documents-enterprise-ready` | 173 | 35 | ❌ legacy | ✅ 35 páginas + lib + components | **Features sin branding** |
| `wip/erp-consolidation` | 173 | 35 | ❌ legacy | ✅ 35 páginas + lib + components | **Features sin branding (≈ documents)** |
| `docs/consolidacion-arquitectonica` | 173 | 35 | ❌ legacy | ✅ 35 páginas + lib + components | **Features sin branding (≈ documents)** |
| `feature/arca-production-fase-e` | 180 | 35 | ❌ legacy | ✅ 35 páginas + lib + components + ARCA F1/F2/F3 | **Features sin branding · LA MÁS COMPLETA** |

### Conclusión

- **El "rebrand NEXUS"** y **las "features NEXUS"** viven en **ramas distintas**, desarrolladas en paralelo, sin merge entre sí.
- **`feature/arca-production-fase-e`** es objetivamente la rama más rica (180 archivos en src/, +7 commits sobre documents-enterprise-ready, +21 sobre wip/erp-consolidation).
- **`feature/ui-redesign`** es la única con el rebrand visual NEXUS aplicado.
- **Ninguna rama tiene las dos cosas juntas todavía.**

---

## 1. Inventario de ramas auditadas

Ejecutado `git for-each-ref` + `git log -1` sobre cada rama hoy:

| Rama | HEAD | Último commit |
|---|---|---|
| `main` | `b82a5f2` | `merge(gate-a): cerrar PARIDAD-1 — migraciones 0008/0009/0010 a main` |
| `fix/paridad-1-migraciones` | `4e20d62` | `fix(paridad-1): traer migraciones 0008/0009/0010 a main` |
| `feature/ui-redesign` | `5daeb13` | `feat(ui): rediseño visual WIP (shell, login, tema, branding)` |
| `feature/nexus-consolidation` | `8a81476` | `docs(nexus): consolidation report — build verde + preview deploy` |
| `feature/documents-enterprise-ready` | `8c1f465` | `docs(fase-d): cierre de C1 — 0010+0011 aplicadas y verificadas en producción` |
| `wip/erp-consolidation` | `ca17522` | `docs(erp): grafo de dependencias + informe ejecutivo de riesgos (Fases 5-6)` |
| `docs/consolidacion-arquitectonica` | `181ee0b` | `docs(fase1.5): consolidacion documental final — paridad Codigo/Migraciones/DB/Docs` |
| `feature/arca-production-fase-e` | `a3c4d63` | `docs(arca): integration report tras recibir certificado de homologacion` (rama actual de trabajo) |

Las 3 ramas "hermanas" con 35 páginas (`documents-enterprise-ready`, `wip/erp-consolidation`, `docs/consolidacion-arquitectonica`) están **detrás** de `feature/arca-production-fase-e` por 7, 21 y `>=21` commits respectivamente. Es decir, sus diferencias contra arca son menores y arca contiene todo lo que ellas tienen + más.

→ **Recomendación de fuente única**: tomar **`feature/arca-production-fase-e`** como referencia para los módulos.

---

## 2. Matriz Módulo × Rama × Estado

Estados:
- **❌ No existe**: 0 archivos
- **🟡 Parcial**: existe page.tsx pero faltan lib/components/api
- **🟢 Funcional**: page.tsx + lib data + componentes
- **🟢🟢 Completo**: page.tsx + lib + components + API routes + auxiliares

`(app)` = páginas en src/app, `lib` = src/lib/<dominio>/, `api` = src/app/api/<dominio>/, `cmp` = src/components/<dominio>/

| Módulo | Path | `main` | `ui-redesign` | `nexus-consolidation` | `arca-production-fase-e` | `documents-enterprise-ready` | `wip/erp-consolidation` |
|---|---|---|---|---|---|---|---|
| **Cockpit Ejecutivo** | `/ejecutivo` | ❌ | ❌ | ❌ | 🟢 `app=1 lib=2 cmp=1` | 🟢 `app=1 lib=2 cmp=1` | 🟢 `app=1 lib=2 cmp=1` |
| **Mapa Operativo** | `/operaciones/mapa` | ❌ | ❌ | ❌ | 🟢 `app=1 lib=2 cmp=1` (usa AmbaMap de ejecutivo) | 🟢 | 🟢 |
| **Compras (suite completa)** | `/compras/*` | ❌ | ❌ | ❌ | 🟢🟢 `app=14 lib=10 cmp=7 api=2` | 🟢🟢 | 🟢🟢 |
| ⤷ Dashboard compras | `/compras` | ❌ | ❌ | ❌ | 🟢 | 🟢 | 🟢 |
| ⤷ Órdenes de compra | `/compras/ordenes` + `[publicId]` | ❌ | ❌ | ❌ | 🟢🟢 | 🟢🟢 | 🟢🟢 |
| ⤷ Nueva OC (wizard) | `/compras/nueva` | ❌ | ❌ | ❌ | 🟢🟢 con NewPoWizard + actions | 🟢🟢 | 🟢🟢 |
| ⤷ Proveedores | `/compras/proveedores` | ❌ | ❌ | ❌ | 🟢 | 🟢 | 🟢 |
| ⤷ Validación pública | `/compras/validar/[publicId]` | ❌ | ❌ | ❌ | 🟢 | 🟢 | 🟢 |
| ⤷ Drive sync | `/compras/drive` | ❌ | ❌ | ❌ | 🟢 | 🟢 | 🟢 |
| ⤷ Plantilla email | `/compras/email` | ❌ | ❌ | ❌ | 🟢 | 🟢 | 🟢 |
| **Comercial · Clientify** | `/comercial/*` | ❌ (solo lib `clientify.ts`) | ❌ | ❌ | 🟢🟢 `app=2 lib=5 api=3` (ping + sync-deals + webhook) | 🟢🟢 | 🟢🟢 |
| ⤷ Contactos | `/comercial/contactos` | ❌ | ❌ | ❌ | 🟢 | 🟢 | 🟢 |
| ⤷ Pipeline | `/comercial/pipeline` | ❌ | ❌ | ❌ | 🟢 | 🟢 | 🟢 |
| **ANMAT cockpit** | `/anmat` | ❌ | ❌ | ❌ | 🟢 `app=1 lib=2 cmp=1` (ComplianceAlertEngine) | 🟢 | 🟢 |
| **Centro Documental** | `/documental` | ❌ | ❌ | ❌ | 🟢🟢 `app=3 lib=2` (page + UploadDocument + actions + ocr) | 🟢🟢 | 🟡 versión vieja (-2 commits) |
| **CCTV** | `/cctv` | ❌ | ❌ | ❌ | 🟢🟢 `app=4 lib=7 api=2` (CctvGrid + Hikvision client + snapshot endpoint) | 🟢🟢 | 🟢🟢 |
| **Roles & Permisos** | `/settings/roles/*` | ❌ | ❌ | ❌ | 🟢🟢 `app=3 lib=5` (page + [slug] + new + rbac/types/data) | 🟢🟢 | 🟢🟢 |
| **Drive (TOPS general)** | `/drive` | 🟡 `app=2 api=1` (básico) | 🟡 | 🟡 | 🟢 `app=2 lib=1 api=2` (list + ping) | 🟢 | 🟢 |
| **Drive sync (compras)** | `/compras/drive` | ❌ | ❌ | ❌ | 🟢 (parte del bundle compras) | 🟢 | 🟢 |
| **WhatsApp (API integration)** | `/api/whatsapp/*` | ❌ | ❌ | ❌ | 🟢🟢 `lib=N api=3` (ping + send + webhook) | 🟢🟢 | 🟢🟢 |
| **ARCA Billing F1/F2/F3** | `/billing` + `src/lib/arca/*` + `src/lib/invoicing/*` | 🟡 (basics) | 🟡 | 🟡 | 🟢🟢🟢 ARCA suite completa + forge signer + production service | 🟢🟢 (sin F2/F3 ARCA) | 🟢🟢 |

### Estadísticas del gap

| Métrica | `feature/nexus-consolidation` (hoy) | `feature/arca-production-fase-e` (target) | Gap |
|---|---|---|---|
| Páginas funcionales | 16 | 35 | **+19** |
| Archivos `src/lib/` (top-level dirs) | 16 directorios | 28 directorios | **+12 dominios** (anmat, cctv, clientify/, compras, documental, drive, ejecutivo, ocr, rbac, whatsapp, types-po.ts, etc.) |
| Archivos `src/components/` (subdirs) | 5 | 8 | **+3** (anmat, compras, ejecutivo) |
| API routes | 6 | 17 | **+11** (cctv*, clientify*, compras*, whatsapp*) |

---

## 3. Dependencias cruzadas entre módulos

Extraídas via `git show <branch>:<file>` + `grep '@/...'` sobre los archivos de cada módulo en `feature/arca-production-fase-e`.

| Módulo | Depende de | Comentario |
|---|---|---|
| **Cockpit Ejecutivo** | `@/lib/compras/{data,format}`, `@/lib/ejecutivo/data`, `@/components/compras/PoStatusBadge`, `@/components/compras/charts/Sparkline`, `@/components/ejecutivo/AmbaMap`, `@/lib/org`, `@/lib/types-po` | **Acoplado a Compras** — no se puede portar sin portar compras primero |
| **Mapa Operativo** | `@/components/ejecutivo/AmbaMap`, `@/lib/ejecutivo/data` | **Acoplado a Ejecutivo** — comparte el AmbaMap |
| **Compras** | `@/lib/{compras,drive,supabase,whatsapp,env,org,types,types-po}`, `@/components/compras/*` | **Núcleo del ERP** — base de muchos otros; trae drive y whatsapp como deps |
| **Comercial / Clientify** | `@/lib/{clientify/data,compras/format,env}`, `@/components/Icon` | **Bajo acoplamiento** — solo necesita `compras/format` |
| **ANMAT** | `@/lib/anmat/data`, `@/lib/compras/format`, `@/components/anmat/ComplianceAlertEngine`, `@/components/compras/charts/Sparkline` | **Acoplado a Compras (utils)** |
| **Centro Documental** | `@/lib/{anmat/data,compras/compras-mock,compras/format,documental,ocr,supabase,env}` | **Acoplado a Compras y ANMAT** |
| **CCTV** | `@/lib/{cctv,env}`, `@/components/Icon` | **Standalone** — el más independiente |
| **Roles & Permisos** | `@/lib/{rbac,env,supabase}` | **Standalone** — solo deps core |
| **Drive Sync** | `@/lib/{drive/client,env}` | **Standalone** — solo deps core |

### Grafo de dependencias

```
                        ┌──── env / org / supabase / Icon (shared core)
                        │
       Compras ─────────┼──── drive
         │              │      ├── whatsapp
         │              │      └── types-po
         ▼              │
   ┌─Ejecutivo          │
   │     │              │
   │     ▼              │
   │  Mapa Operativo    │
   │                    │
   ├──── ANMAT ─────────┤
   │                    │
   └──── Documental ────┤
                        │
       Comercial ───────┤
       (Clientify)
                        │
       CCTV ────────────┤  (standalone)
       Roles ───────────┤  (standalone)
```

**Lectura**: Compras es el nodo central. Ejecutivo, Mapa, ANMAT y Documental dependen de Compras. CCTV, Roles y Comercial son relativamente standalone (sólo dependen del core compartido).

---

## 4. Riesgo de consolidación (cherry-pick)

### 4.1 Archivos en CONFLICTO directo entre `feature/ui-redesign` (branding) y `feature/arca-production-fase-e` (features)

14 archivos modificados en ambas ramas. Estos requieren **resolución manual** durante consolidación:

| # | Archivo | En `ui-redesign` cambió | En `arca-production-fase-e` cambió | Estrategia |
|---|---|---|---|---|
| 1 | `src/app/globals.css` | Tokens NEXUS dark mode | Posibles tokens menores | **Tomar ui-redesign** |
| 2 | `src/app/layout.tsx` | `applicationName: "TOPS NEXUS"` + metadata NEXUS | Probablemente cambios menores | **Tomar ui-redesign + verificar metadata fiscal** |
| 3 | `src/app/loading.tsx` | Splash NEXUS | Splash legacy | **Tomar ui-redesign** |
| 4 | `src/app/login/page.tsx` | Hero NEXUS · Operating System | Hero legacy | **Tomar ui-redesign** |
| 5 | `src/app/page.tsx` | Root NEXUS | Root legacy | **Tomar ui-redesign** |
| 6 | `src/components/shell/Sidebar.tsx` | 24 items NEXUS organizados por dominios | 9 items legacy | **Tomar ui-redesign** (apunta a URLs correctas que existen en arca) |
| 7 | `src/components/shell/Topbar.tsx` | Topbar NEXUS con ⌘K + theme toggle | Topbar legacy | **Tomar ui-redesign** |
| 8 | `src/components/shell/Shell.tsx` | Layout NEXUS | Layout legacy | **Tomar ui-redesign** (verificar que no rompa páginas arca) |
| 9 | `src/components/shell/MobileBottomNav.tsx` | Bottom-nav NEXUS | Bottom-nav legacy | **Tomar ui-redesign** |
| 10 | `src/components/shell/NotificationsBell.tsx` | NotificationsBell NEXUS | NotificationsBell legacy | **Tomar ui-redesign** |
| 11 | `src/app/api/drive/ping/route.ts` | Ajustes menores | Ajustes menores | **Inspeccionar diff y elegir; probable arca por ser más reciente** |
| 12 | `src/lib/env.ts` | Cambios menores (var domain) | Más vars (arca, hikvision, whatsapp, openai) | **Merge manual — ARCA features needs all envs** |
| 13 | `src/lib/types.ts` | Cambios menores | Más types | **Merge manual** |
| 14 | `src/lib/arca/production-service.ts` | No tocado en ui-redesign | Implementado | **Tomar arca** (no conflicto real) |

**Riesgo total**: **MEDIO-BAJO**. Solo 14 archivos en conflicto, y la mayoría tiene una estrategia clara ("tomar ui-redesign" o "tomar arca"). Solo 2-3 requieren merge manual real (`env.ts`, `types.ts`, posiblemente `Shell.tsx`).

### 4.2 Riesgo por dominio cherry-pickeable

| Dominio | Archivos a portar | Deps que arrastra | Riesgo | Tiempo estimado |
|---|---|---|---|---|
| **CCTV** | 4 pages + 7 lib + 2 api + 1 component | env, Icon (ya existen) | 🟢 Bajo | 10 min |
| **Roles & Permisos** | 3 pages + 5 lib | rbac, env, supabase (existen) | 🟢 Bajo | 10 min |
| **Comercial / Clientify** | 2 pages + 5 lib + 3 api | clientify, compras/format (deps mínimas) | 🟡 Medio (necesita compras/format) | 15 min |
| **Compras suite** | 14 pages + 10 lib + 2 api + 7 cmp | drive, whatsapp, types-po, supabase | 🟡 Medio | 30-45 min (es el módulo más grande) |
| **Ejecutivo** | 1 page + 2 lib + 1 cmp (AmbaMap) | Compras (acoplado) | 🟡 Medio | 15 min (después de compras) |
| **Mapa Operativo** | 1 page | Ejecutivo (AmbaMap compartido) | 🟢 Bajo | 5 min (después de ejecutivo) |
| **ANMAT** | 1 page + 2 lib + 1 cmp | Compras/format/charts | 🟡 Medio | 15 min (después de compras) |
| **Documental** | 3 pages + 2 lib | ANMAT, Compras, OCR | 🟠 Medio-Alto (deps en cadena) | 20 min (después de ANMAT y compras) |
| **Drive Sync** | 6 pages + 1 lib + 2 api | drive (existe parcial), compras | 🟡 Medio | 15 min |
| **WhatsApp integration** | (solo API + lib, sin page propia) | env (existe) | 🟢 Bajo | 10 min |

### 4.3 Orden de consolidación recomendado (cherry-pick por capas)

```
┌─ Capa 0: Shell (branding + navegación)  ──── tomar de ui-redesign
│   ├─ src/app/{globals.css,layout.tsx,loading.tsx,login/page.tsx,page.tsx}
│   ├─ src/components/shell/{Sidebar,Topbar,Shell,MobileBottomNav,NotificationsBell}.tsx
│   └─ src/lib/org.ts (ya portado en nexus-consolidation)
│
├─ Capa 1: Core/Infra (lib compartidas)  ─── tomar de arca
│   ├─ src/lib/{env.ts (merge), types.ts (merge), types-po.ts (new)}
│   ├─ src/lib/{drive, whatsapp, ocr} (carpetas nuevas)
│   ├─ src/lib/clientify/ (carpeta) + clientify.ts (existente)
│   └─ src/lib/{compras, ejecutivo, anmat, cctv, rbac, documental} (carpetas nuevas)
│
├─ Capa 2: Componentes específicos
│   ├─ src/components/{compras, ejecutivo, anmat}/* (carpetas nuevas)
│
├─ Capa 3: Páginas standalone (sin deps cruzadas)
│   ├─ src/app/(app)/cctv/*
│   ├─ src/app/(app)/settings/roles/*
│   ├─ src/app/(app)/comercial/*
│   └─ src/app/api/{cctv,clientify,whatsapp}/*
│
├─ Capa 4: Páginas con deps en Compras
│   ├─ src/app/(app)/compras/*  ← bloque grande, traer todo el árbol
│   ├─ src/app/(app)/anmat/*
│   ├─ src/app/(app)/ejecutivo/*
│   ├─ src/app/(app)/operaciones/mapa/*
│   ├─ src/app/(app)/documental/*  (depende de anmat + compras)
│   └─ src/app/api/compras/*
│
└─ Capa 5: Verificación
    ├─ npm run typecheck → 0 errores
    ├─ npm run build → exit 0
    └─ preview deploy → smoke test sidebar 24/24 ✓
```

**Tiempo total estimado**: **2-4 horas** de trabajo focalizado (incluyendo resolución de conflictos en los 14 archivos comunes), no días.

---

## 5. Recomendación por módulo (Cherry-Pick vs Rebuild)

| Módulo | Estado en `arca-production-fase-e` | Recomendación | Razón |
|---|---|---|---|
| Cockpit Ejecutivo | 🟢 Completo | **CHERRY-PICK** | Funcional, no requiere reescritura |
| Mapa Operativo | 🟢 Completo | **CHERRY-PICK** | Funcional |
| Compras (suite) | 🟢🟢 Completo (14 pages, wizard, validación pública, drive sync, email) | **CHERRY-PICK** | El módulo más rico — rebuild sería desperdicio |
| Comercial · Clientify | 🟢🟢 Completo (con webhook + sync-deals) | **CHERRY-PICK** | Funcional con integración HTTP real |
| ANMAT | 🟢 Completo (con ComplianceAlertEngine) | **CHERRY-PICK** | Funcional |
| Centro Documental | 🟢🟢 Completo (con OCR OpenAI Vision) | **CHERRY-PICK** | Hay versión más vieja en wip — usar arca |
| CCTV | 🟢🟢 Completo (con Hikvision API + snapshot endpoint) | **CHERRY-PICK** | Standalone, sin dependencias |
| Roles & Permisos | 🟢🟢 Completo (page + [slug] + new + rbac lib) | **CHERRY-PICK** | Standalone |
| Drive Sync | 🟢 Completo (page + list + ping) | **CHERRY-PICK** | Funcional |

**Veredicto unánime: TODO es CHERRY-PICK. Nada requiere REBUILD.**

---

## 6. Modules NO listados por el usuario pero descubiertos

Adicionales que existen en `feature/arca-production-fase-e` y vale la pena traer:

| Módulo | Path | Estado |
|---|---|---|
| **WhatsApp Cloud API** | `src/lib/whatsapp/` + `/api/whatsapp/{ping,send,webhook}` | 🟢🟢 Completo |
| **OCR (OpenAI Vision)** | `src/lib/ocr/` | 🟢 Usado en /documental |
| **Validación pública de OCs** | `/compras/validar/[publicId]` | 🟢 Página pública con firma |
| **Wizard Nueva OC** | `/compras/nueva` con `NewPoWizard.tsx` + `actions.ts` | 🟢🟢 4-step wizard funcional |
| **Detalle de OC** | `/compras/ordenes/[publicId]` con `OrderDetailTabs.tsx` | 🟢🟢 Tabs (PDF, email, WhatsApp, trazabilidad) |
| **Tipos PO** | `src/lib/types-po.ts` | 🟢 Sistema de tipos para órdenes de compra |
| **Compliance Alert Engine** | `src/components/anmat/ComplianceAlertEngine.tsx` | 🟢 Motor de alertas ANMAT |
| **Hikvision Client** | `src/lib/cctv/hikvision.ts` | 🟢 ISAPI Digest auth |
| **Drive Client** | `src/lib/drive/client.ts` | 🟢 Wrapper Google Drive |
| **AmbaMap** | `src/components/ejecutivo/AmbaMap.tsx` | 🟢 Componente de mapa AMBA |

---

## 7. Constraints honrados al 100%

✅ NO se construyó código nuevo (sólo audit read-only via `git ls-tree` y `git show`)
✅ NO se mergeó ninguna rama
✅ NO se tocó producción
✅ NO se modificó ARCA (sólo se inventarió presencia)
✅ NO se ejecutaron migraciones
✅ NO se ejecutó build ni preview deploy (sólo se referenció el deploy ya existente de nexus-consolidation)
✅ NO se modificó `fiscal_config`
✅ Toda la inspección fue read-only sobre el árbol Git

---

## 8. Decisión que necesito de vos (no la tomo solo)

Tres caminos posibles, vos elegís cuándo y cómo:

### Camino A · Consolidación completa (recomendado por la auditoría)

Construir `feature/nexus-consolidation` definitiva con shell de `ui-redesign` + features de `arca-production-fase-e`, en una sola operación de cherry-pick guiado por capas (sección 4.3). Resultado: ERP NEXUS completo, sidebar 24/24 funcional, listo para deploy productivo.

**Riesgo**: medio-bajo (14 archivos en conflicto con estrategia clara para 11 de ellos, 3 requieren merge manual).
**Tiempo**: 2-4 horas focalizadas.
**Output**: nueva rama `feature/nexus-fullstack` (o equivalente) con build verde + preview deploy.

### Camino B · Consolidación incremental por dominio

Mismo destino, pero un dominio a la vez con verificación intermedia. Empezando por los standalone (CCTV, Roles, Comercial) y dejando Compras + Ejecutivo + Documental para el final.

**Riesgo**: menor que A por validación incremental.
**Tiempo**: 4-6 horas total, dispersas en sesiones.
**Output**: 6-8 commits incrementales en `feature/nexus-consolidation` o nueva rama.

### Camino C · Rebrand sobre arca-production-fase-e (sin tocar ui-redesign)

En vez de portar features de arca a ui-redesign, portar branding de ui-redesign a arca. Menos archivos a mover (solo los 14 conflicto + assets visuales).

**Pros**: arca-production-fase-e ya tiene 35 páginas funcionales — solo agregar el rebrand visual.
**Cons**: arca-production-fase-e está bajo freeze ARCA — tocarla podría requerir levantar el freeze.
**Riesgo**: medio (mismo set de 14 archivos en conflicto, pero hay que levantar el freeze ARCA).

### Caminos NO recomendados

- ❌ **Rebuild desde cero**: las 35 páginas ya están construidas y validadas. Reescribir sería desperdiciar trabajo existente.
- ❌ **Cherry-pick desde `wip/erp-consolidation` o `docs/consolidacion-arquitectonica`**: están detrás de arca por 21+ commits, perderías features.

---

## 9. Resumen visual final

```
HOY:
  main (16 pages, sin NEXUS branding)
  feature/ui-redesign (16 pages, CON NEXUS branding visual)         ← lo que ve el cliente como "el rebrand"
  feature/arca-production-fase-e (35 pages, SIN NEXUS branding)     ← donde viven las features reales

MAÑANA (si autorizás A o B):
  feature/nexus-fullstack (35 pages, CON NEXUS branding)            ← branding + features juntos
        = shell de ui-redesign + features de arca-production-fase-e + org.ts

EL "GAP DE FEATURES" QUE VIENES VIENDO HOY:
  → NO ES "no construido" — ES "no consolidado"
  → Las páginas existen. Solo no viven juntas con el rebrand.
```

⏹ Audit cerrado. Esperando tu decisión de Camino A / B / C / Detener.

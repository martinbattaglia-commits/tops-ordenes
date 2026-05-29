# TOPS NEXUS — ERP-MODULE-MAP

> **Estado:** auditoría · **Fecha:** 2026-05-29
> Mapa definitivo de módulos del ERP y su estado real en cada capa
> (Producción/DB remoto · `origin/main` · branches · WIP local · untracked).
> Generado tras auditoría con `git ls-tree`, `git status` y diagnóstico
> read-only contra Supabase remoto (`scripts/supabase-check.mjs`).
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md).

---

## 0. Las tres capas de la verdad (y su divergencia)

El ERP vive hoy en **tres planos que no coinciden**:

| Plano | Qué es | Cómo se verifica |
|-------|--------|------------------|
| **A. Código desplegado** | `origin/main` → Netlify (`tops-ordenes.netlify.app`) | `git ls-tree -r origin/main` |
| **B. DB remoto** | Supabase `arsksytgdnzukbmfgkju` (schema realmente aplicado) | `node scripts/supabase-check.mjs` (read-only) |
| **C. WIP local** | disco de trabajo (untracked + branches locales) | `git status`, `git branch` |

> **Actualización 2026-05-29 (post FASE 1):** la divergencia central de
> migraciones quedó **resuelta**. El SQL de `0008`/`0009`/`0010` se mergeó a
> `main` (HEAD `b82a5f2`, **PARIDAD-1 cerrada**) y el tracker se reconcilió a
> `0001–0009` vía `migration repair` (**PARIDAD-3 cerrada**). El diagrama y las
> consecuencias de abajo se conservan como **registro histórico** del estado
> previo. Ver [ERP-FASE1-PARIDAD.md](./ERP-FASE1-PARIDAD.md).

**Divergencia central detectada (estado HISTÓRICO previo a FASE 1):**

```
            CÓDIGO (origin/main)        DB REMOTO              WIP LOCAL
            ────────────────────        ──────────             ─────────
0001-0007   ✅ versionado               ✅ aplicado            ✅
0008 (OC)   ❌ NO versionado            ✅ aplicado (datos!)   ✅ untracked  ← DB adelante del código
0009 (RBAC) ❌ NO versionado            ✅ aplicado (datos!)   ✅ untracked  ← DB adelante del código
0010 (docs) ❌ NO versionado            ❌ NO aplicado         ✅ untracked  ← solo local
0011 (ARCA) ✅ versionado + desplegado  ❌ NO aplicado         ✅            ← código adelante de la DB
```

**Estado vigente (post FASE 1, 2026-05-29):**

```
            CÓDIGO (origin/main)        DB REMOTO              TRACKER
            ────────────────────        ──────────             ───────
0001-0007   ✅ versionado               ✅ aplicado            ✅ registrado
0008 (OC)   ✅ versionado (b82a5f2)     ✅ aplicado (datos!)   ✅ registrado
0009 (RBAC) ✅ versionado (b82a5f2)     ✅ aplicado (datos!)   ✅ registrado
0010 (docs) ✅ versionado (b82a5f2)     ❌ NO aplicado         ❌ no registrado
0011 (ARCA) ✅ versionado + desplegado  ❌ NO aplicado         ❌ no registrado
```

**Consecuencias inmediatas (HISTÓRICAS — 1 y 3 ya mitigadas):**
1. ~~**Riesgo de pérdida (CRÍTICO):** el SQL que creó las tablas productivas
   `vendors`, `purchase_orders`, `roles`, `permissions` (0008/0009) **no está
   versionado**.~~ **MITIGADO:** 0008/0009 ya están en `main` (`b82a5f2`).
2. **`/billing` y `/settings/fiscal` fallan en runtime:** el código de 0011 está
   desplegado pero sus tablas no existen en la DB (0011 sin aplicar). (No bloquea
   el resto de la app.) **VIGENTE.**
3. ~~**Módulos productivos sin desplegar:** `compras` (que usa tablas 0008 con
   datos reales) existe solo como WIP local untracked.~~ **MITIGADO:** el SQL de
   0008 está versionado en `main`.

---

## 1. Inventario por estado (resumen)

| Estado | # archivos aprox. | Qué incluye |
|--------|:-----------------:|-------------|
| Desplegado (`origin/main`) | — | dashboard, clients, orders, billing, reports, settings, templates + infra |
| DB remoto sin código versionado | — | tablas 0008 (OC) + 0009 (RBAC) con datos |
| WIP local / untracked | **93** | compras, anmat, cctv, comercial, documental, ejecutivo, operaciones, settings/roles, libs e integraciones, migraciones 0008-0010 |
| Branch local `feature/ui-redesign` | 53 (commit `5daeb13`) | rediseño visual + branding |
| Stash `stash@{0}` | 21 | design-overhaul viejo (superseded por la branch) |

---

## 2. Módulos DESPLEGADOS (en `origin/main` + Netlify)

| Módulo | Ruta | lib / servicios | Tablas que usa | Estado DB |
|--------|------|-----------------|----------------|-----------|
| **Dashboard** | `src/app/(app)/dashboard` | `lib/data`, `lib/mock-data` | orders, clients, operators | ✅ |
| **Clientes** | `src/app/(app)/clients` | `lib/data`, `lib/validation` | clients | ✅ |
| **Órdenes (OS)** | `src/app/(app)/orders` | `lib/data`, `lib/pricing`, `lib/services-catalog` | orders, order_services, operators | ✅ |
| **Facturación ARCA** | `src/app/(app)/billing` | `lib/arca`, `lib/invoicing`, `lib/pdf` | customer_invoices, invoice_items, fiscal_config, puntos_venta | ⚠️ **código sí, tablas NO** (0011 sin aplicar) |
| **Reportes** | `src/app/(app)/reports` | `lib/data` | orders, clients | ✅ |
| **Settings (fiscal)** | `src/app/(app)/settings` | `lib/arca`, `lib/env` | fiscal_config, puntos_venta | ⚠️ idem 0011 |
| **Templates** | `src/app/(app)/templates` | `lib/services-catalog` | services_catalog | ✅ |

**Infra desplegada (`src/lib`):** `arca/`, `invoicing/`, `pdf/`, `pricing/`,
`validation/`, `data/`, `supabase/`, `env.ts`, `email.ts`, `clientify.ts`
(monolito viejo), `google-drive.ts` (monolito viejo), `rate-limit.ts`,
`services-catalog.ts`, `types.ts`, `utils.ts`, `mock-data.ts`.

**APIs desplegadas:** `api/auth`, `api/drive`, `api/invoices`, `api/orders`.

**Componentes desplegados:** `Icon.tsx`, `RealtimeRefresher.tsx`,
`StatusBadge.tsx`, `charts/`, `shell/`.

---

## 3. Módulos EN DESARROLLO (no desplegados)

Leyenda estado DB: ✅ tablas en remoto · ❌ sin tablas · n/a no usa DB.

| Módulo | Ruta (untracked) | lib (untracked) | Tablas | DB remoto | Migración | Valor ERP |
|--------|------------------|-----------------|--------|:---------:|-----------|:---------:|
| **Compras / OC** | `app/(app)/compras/*` (11 archivos: page, ordenes, proveedores, nueva/wizard, email, drive, detalle) | `lib/compras/*` (10: data, validation, totals, storage, email, format, products-catalog, pdf, mock) + `components/compras/*` (6) | vendors, products, purchase_orders, po_items, po_events, po_email_sends | ✅ **con datos** | 0008 (untracked) | **Estratégico** |
| **Proveedores** | dentro de compras (`compras/proveedores`) | `lib/compras/data` | vendors, products | ✅ | 0008 | **Estratégico (Fase 3)** |
| **RBAC / Roles** | `app/(app)/settings/roles/*` (3) | `lib/rbac/*` (data, types) | roles, permissions, role_permissions, user_roles | ✅ **con datos** | 0009 (untracked) | **Estratégico (gobernanza)** |
| **ANMAT** | `app/(app)/anmat/page.tsx` | `lib/anmat/*` (data, alert-engine) | — (mock/local) | n/a | — | Medio (compliance) |
| **CCTV** | `app/(app)/cctv/*` (grid, page) + `api/cctv/*` | `lib/cctv/*` (data, hikvision, digest) | — | n/a | — | Medio (integración Hikvision) |
| **Comercial / CRM** | `app/(app)/comercial/*` (pipeline, contactos) + `api/clientify/*` | `lib/clientify/*` (data, mappers, types, client) | — (Clientify externo) | n/a | — | Medio (integración Clientify) |
| **Documental** | `app/(app)/documental/*` (page, upload, actions) | `lib/documental/*` (data, storage) | documents, attachments | ❌ **sin tabla documents** | 0010 (untracked) | Medio |
| **Ejecutivo / Cockpit** | `app/(app)/ejecutivo/page.tsx` | `lib/ejecutivo/*` (data, locations) + `components/ejecutivo` | agregados de varias | parcial | — | Alto (BI, Fase 6) |
| **Operaciones (mapa)** | `app/(app)/operaciones/mapa/page.tsx` | `lib/ejecutivo/locations` | orders, operators | ✅ | — | Medio |
| **Drive** | `app/(app)/drive`, `api/drive/list` | `lib/drive/client.ts` (vs `google-drive.ts` desplegado) | — | n/a | — | Bajo (ya hay versión desplegada) |
| **WhatsApp** | `api/whatsapp/*` (3) | `lib/whatsapp/*` (meta, types) | — | n/a | — | Medio (notificaciones) |
| **OCR** | — | `lib/ocr/*` (openai, types) | — | n/a | — | Soporte (compras OCR) |
| **Validación pública OC** | `app/compras/validar/[publicId]/page.tsx` | `lib/compras` | purchase_orders | ✅ | 0008 | Alto (ruta pública firmada) |

**Módulos del roadmap todavía INEXISTENTES (ni código ni tablas):**
Tesorería (Fase 4), Cuentas Corrientes (Fase 5), Contabilidad/Balance (Fase 6).

---

## 4. Conflictos de evolución (mismo concepto, dos versiones)

| Concepto | Versión desplegada (`origin/main`) | Versión WIP (untracked) | Acción sugerida |
|----------|-----------------------------------|-------------------------|-----------------|
| Clientify | `src/lib/clientify.ts` (monolito) | `src/lib/clientify/` (data, mappers, types, client) | Decidir cuál gana antes de versionar; no duplicar |
| Google Drive | `src/lib/google-drive.ts` (monolito) | `src/lib/drive/client.ts` | idem |
| `drive/ping` API | versión en `origin/main` | versión local modificada (working tree) | Conciliar diff |
| types | `src/lib/types.ts` (estable) | `types.ts` del rediseño (branch) + `types-po.ts` (untracked) | `types-po.ts` es nuevo; el de la branch es UI |

> Estos conflictos deben resolverse **antes** de cualquier merge a main, para no
> reintroducir lógica duplicada (no-negociable del rector).

---

## 5. Branches y stash

| Ref | Commit | Contenido | Riesgo |
|-----|--------|-----------|--------|
| `main` | `b82a5f2` | Producción estable + ARCA + docs + SQL 0008/0009/0010 (PARIDAD-1 cerrada) | OK (pusheado) |
| `feature/ui-redesign` | `5daeb13` | Rediseño visual + branding (53 archivos) | ⚠️ **solo local** → preservar |
| `stash@{0}` | `ea295c9` | `wip-design-overhaul` viejo (21 archivos, superseded) | Redundante; evaluar `git stash drop` |

---

## 6. Storage buckets (DB remoto)

| Bucket | Visibilidad | Migración | Estado |
|--------|-------------|-----------|--------|
| `signatures` | 🌍 público | 0003 | ✅ |
| `pdfs` | 🌍 público | 0003 | ✅ |
| `attachments` | 🔒 privado | 0004 | ✅ |
| `po-pdfs` | 🌍 público | 0008 | ✅ |
| `po-signatures` | 🔒 privado | 0008 | ✅ |
| `invoices` | 🔒 privado | 0011 | ❌ **no existe** (0011 sin aplicar) |

---

## 7. Conclusión del mapa

- **Lo desplegado y estable** es el núcleo OS (dashboard/clientes/órdenes/
  reportes/templates). Sólido.
- **Lo desplegado pero roto en runtime** es Facturación ARCA (código sin tablas).
- **Lo productivo pero sin versionar** (riesgo de pérdida real) es Compras+RBAC:
  tienen **datos en la DB** y su SQL/código vive solo en disco.
- **Lo estratégico en WIP** (Compras, Proveedores, RBAC, Ejecutivo, validación
  pública de OC) debe versionarse y preservarse antes de seguir.

Próximo documento: [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) ·
[ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md).

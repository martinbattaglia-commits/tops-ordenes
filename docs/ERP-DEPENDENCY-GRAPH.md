# TOPS NEXUS — ERP-DEPENDENCY-GRAPH

> **Estado:** auditoría · **Fecha:** 2026-05-29
> Grafo de dependencias del ERP en dos planos: **funcional** (qué módulo
> necesita a qué otro para tener sentido de negocio) y **técnico** (tablas,
> servicios, APIs, componentes, funciones SQL y cadena de migraciones).
> Verificado leyendo imports reales (`@/lib/...`) y accesos a tablas (`.from(...)`)
> en `origin/main` (desplegado) y en `wip/erp-consolidation` (WIP versionado).
> **No** crea tablas ni migraciones. Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md).

---

## 0. Cómo leer este documento

- **Dependencia funcional** = "B no puede existir como negocio sin A". Ej.: una
  factura necesita un cliente y (casi siempre) una orden de servicio.
- **Dependencia técnica** = acoplamiento de código/datos: imports de TS, tablas
  consultadas, funciones SQL (RLS), APIs, componentes compartidos.
- Estado de cada nodo según [ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md):
  ✅ desplegado · 🟢 WIP versionado (branch) · 🔵 futuro (roadmap).

---

## 1. Grafo funcional (negocio)

```
                         ┌─────────────┐
                         │   RBAC /     │  transversal: gobierna acceso a TODO
                         │ current_role │  (ningún módulo funciona sin auth+rol)
                         └──────┬───────┘
                                │ (autoriza)
        ┌───────────────┬───────┴────────┬───────────────┐
        ▼               ▼                ▼               ▼
  ┌──────────┐    ┌──────────┐     ┌──────────┐    ┌──────────┐
  │ Clientes │    │ Órdenes  │     │Proveedores│   │ Comercial│
  │  ✅      │    │ (OS) ✅  │     │ (vendors)│    │ Clientify│
  └────┬─────┘    └────┬─────┘     └────┬─────┘    └────┬─────┘
       │   ┌───────────┘                │  🟢            │ 🟢
       │   │                            ▼                │ (alimenta
       ▼   ▼                       ┌──────────┐          │  Clientes)
  ┌──────────────┐                 │ Compras  │          │
  │ Facturación  │                 │  (OC) 🟢 │          ▼
  │  ARCA ✅(*)  │                 └────┬─────┘     ┌──────────┐
  └──────┬───────┘                      │           │  (CRM)   │
         │                              │           └──────────┘
         │   ┌──────────────────────────┘
         ▼   ▼
   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
   │  Tesorería   │◄─────┤   Cuentas    │◄─────┤  Contabilidad│
   │   🔵 Fase 4  │      │ Corrientes 🔵│      │ / Balance 🔵 │
   └──────┬───────┘      └──────────────┘      └──────┬───────┘
          │                                           ▲
          └───────────────────────────────────────────┘
                    (todos los subledgers asientan en el GL)

   ┌──────────────┐   Cockpit/BI consume agregados de OS, OC y (futuro) finanzas
   │  Ejecutivo   │◄── depende HOY de Compras (lib/compras/data) + Órdenes
   │  / Cockpit 🟢│
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │ Operaciones  │  mapa AMBA — consume lib/ejecutivo/data
   │  / mapa 🟢   │
   └──────────────┘

   Módulos satélite (sin dependencia funcional dura con el core):
   Documental 🟢 (adjunta a OS/OC/factura) · CCTV 🟢 (Hikvision) ·
   ANMAT 🟢 (compliance, datos mock) · Drive 🟢 · WhatsApp 🟢 (notificación)
```

(*) Facturación ARCA: **código desplegado**, pero sus tablas (0011) **no están
aplicadas** en la DB remota → falla en runtime hasta aplicar la migración.

### 1.1 Reglas de dependencia funcional (las pedidas + las reales)

| Módulo | Depende de | Naturaleza | Verificado en |
|--------|-----------|------------|---------------|
| **Facturación** | Clientes, Órdenes (OS) | factura referencia `client_id` + `order_id` | `lib/invoicing/*` (campos `client_id`/`order_id`) |
| **Compras (OC)** | Proveedores, Productos | OC referencia vendor + ítems de catálogo | `lib/compras/data` → `vendors`,`products`,`purchase_orders` |
| **Tesorería** 🔵 | Facturación, Proveedores | un pago salda una factura (cliente o proveedor) | roadmap (no existe aún) |
| **Cuentas Corrientes** 🔵 | Facturación, Tesorería | saldo = facturado − cobrado/pagado | roadmap |
| **Contabilidad/Balance** 🔵 | **Todos** | el GL recibe asientos de cada subledger | roadmap |
| **Ejecutivo/Cockpit** | Compras + Órdenes (hoy) | agrega KPIs | `lib/ejecutivo/data` → `@/lib/compras/data` |
| **Operaciones/mapa** | Ejecutivo (locations) | reusa data de ejecutivo | `operaciones/mapa` → `@/lib/ejecutivo/data` |
| **Comercial** | Clientes | el pipeline alimenta altas de cliente | Clientify (API externa) |
| **Documental** | OS/OC/Factura (referencia opcional) | adjunta comprobantes a entidades | `lib/documental` → `documents` |
| **RBAC** | — (raíz) | gobierna a todos | `current_role()` en toda la RLS |

---

## 2. Grafo técnico — tablas

### 2.1 Tabla → módulos que la consumen (grounded)

| Tabla | Migración | Consumido por (código real) | Estado DB |
|-------|:---------:|------------------------------|:---------:|
| `profiles` | 0001 | **todos** (vía `current_role()`/`auth.uid()`) | ✅ |
| `clients` | 0001 | Clientes, Órdenes, Facturación | ✅ |
| `operators` | 0001 | Órdenes, Dashboard, Operaciones | ✅ |
| `orders` + `order_services` | 0001 | Órdenes, Dashboard, Reportes, Facturación, Ejecutivo | ✅ |
| `services_catalog` | 0001 | Órdenes, Templates | ✅ |
| `customer_invoices` | 0011 | Facturación (`lib/invoicing`) | ⚠️ **NO aplicada** |
| `invoice_items` | 0011 | Facturación | ⚠️ NO aplicada |
| `fiscal_config` | 0011 | Facturación, Settings/fiscal | ⚠️ NO aplicada |
| `puntos_venta` | 0011 | Facturación, Settings/fiscal | ⚠️ NO aplicada |
| `invoice_audit` | 0011 | Facturación (auditoría) | ⚠️ NO aplicada |
| `vendors` | 0008 | Compras (`lib/compras/data`) | ✅ **con datos** |
| `products` | 0008 | Compras | ✅ con datos |
| `purchase_orders` | 0008 | Compras, validación pública OC | ✅ con datos |
| `po_items` | 0008 | Compras (join de OC) | ✅ |
| `po_events` | 0008 | Compras (timeline OC) | ✅ |
| `po_email_sends` | 0008 | Compras (envío email) | ✅ |
| `roles` | 0009 | RBAC (`lib/rbac/data`) | ✅ con datos (7) |
| `permissions` | 0009 | RBAC | ✅ con datos (22) |
| `role_permissions` | 0009 | RBAC (join) | ✅ con datos (64) |
| `user_roles` | 0009 | RBAC, `has_permission()` | ⚠️ **0 filas** |
| `documents` | 0010 | Documental (`lib/documental`) | ❌ **sin tabla** |
| `attachments` | 0004 | Documental, adjuntos | ✅ |
| `audit_log` | (genérica) | auditoría transversal | ✅ |
| `notifications` | — | notificaciones | ✅ |
| `email_sends` | — | envío de email (OS) | ✅ |

### 2.2 Función SQL crítica — `current_role()` (el hub de RLS)

```
                 current_role()  [SECURITY DEFINER, 0001+0005]
                       │  lee profiles.role saltando RLS (corta recursión)
   ┌──────────┬────────┼────────┬──────────┬───────────┐
   ▼          ▼        ▼        ▼          ▼           ▼
 RLS de    RLS de   RLS de   RLS de    RLS de      RLS de
 orders   clients  invoices  po_*     roles/perm  documents…
```

> **Nodo de máximo blast radius:** si `current_role()` se rompe o pierde
> `SECURITY DEFINER`/`search_path`, **toda** la autorización del ERP cae
> (recursión RLS PG 54001). Helpers `is_staff()`/`is_admin()` cuelgan del mismo
> patrón. Ver [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) §1.

---

## 3. Grafo técnico — servicios / libs

```
  lib/supabase ──────────────► (cliente DB usado por TODOS los data layers)
  lib/env ───────────────────► (flags isMock, config ARCA, credenciales)
        ▲                              ▲
        │                              │
  lib/arca ──► lib/invoicing ──► api/invoices ──► (app)/billing
   (WSAA/         (emit/calc/        │
    WSFEv1/QR)     data)             └─► usa lib/pdf (PDF fiscal + QR)

  lib/data ──► (app)/dashboard, clients, orders, reports   [desplegado]

  lib/compras/data ──┬──► (app)/compras/*  +  api/compras/*
                     ├──► lib/ejecutivo/data ──► (app)/ejecutivo
                     │                              └─► (app)/operaciones/mapa
                     └──► usa lib/compras/{totals,validation,pdf,storage,email}

  lib/rbac/data ─────► (app)/settings/roles/*
  lib/clientify ─────► (app)/comercial/* + api/clientify/*   (API externa)
  lib/cctv ──────────► (app)/cctv/* + api/cctv/*             (Hikvision)
  lib/documental ────► (app)/documental/*                    (tabla documents ❌)
  lib/anmat ─────────► (app)/anmat                           (mock/local)
  lib/whatsapp ──────► api/whatsapp/*                        (Meta API)
  lib/ocr ───────────► (soporte de carga en compras)         (OpenAI)
```

**Acoplamientos a vigilar (deuda):**
- **Ejecutivo → Compras** es un acoplamiento directo (`lib/ejecutivo/data`
  importa `@/lib/compras/data` y `@/lib/types-po`). Si Compras cambia su shape,
  rompe el Cockpit. Es la única dependencia cruzada *entre módulos de feature*
  (lo demás cuelga de libs base).
- **Duplicados sin resolver** (ver ERP-MODULE-MAP §4): `lib/clientify.ts`
  (monolito, en main) vs `lib/clientify/` (modular, en branch); `lib/google-drive.ts`
  vs `lib/drive/client.ts`; `lib/types.ts` vs `lib/types-po.ts`. **No fusionar
  aún** — preservados tal cual en `wip/erp-consolidation`.

---

## 4. Grafo técnico — APIs (route handlers)

| API | Lee/escribe | Depende de | Estado |
|-----|-------------|-----------|:------:|
| `api/auth/*` | profiles, Supabase Auth | lib/supabase | ✅ |
| `api/orders/*` | orders, order_services | lib/data | ✅ |
| `api/invoices/*` | customer_invoices, invoice_items, fiscal_config | lib/invoicing, lib/arca | ⚠️ tablas 0011 NO aplicadas |
| `api/drive/*` | Google Drive (externo) | lib/drive / google-drive | ✅ (main) / 🟢 (branch) |
| `api/compras/*` | purchase_orders, po_items | lib/compras | 🟢 branch |
| `api/cctv/*` | Hikvision (externo) | lib/cctv | 🟢 branch |
| `api/clientify/*` | Clientify (externo) | lib/clientify | 🟢 branch |
| `api/whatsapp/*` | Meta WhatsApp (externo) | lib/whatsapp | 🟢 branch |

---

## 5. Grafo técnico — cadena de migraciones

```
0001_init ──► 0002 ──► 0003(buckets) ──► 0004(attachments) ──► 0005(fix RLS)
   │                                                              │ endurece
   │  define: profiles, clients, orders, services_catalog,        │ current_role()
   │  user_role_t, current_role()                                 ▼
   │                                              ┌── 0008_purchase_orders ──┐
   ├──────────────────────────────────────────────┤   (vendors/po_*)        │
   │                                              ├── 0009_rbac ─────────────┤
   │                                              │   (roles/permissions)    │
   │                                              └── 0010_documents ────────┘
   │                                                       │ (todas dependen
   │                                                       │  de 0001 + current_role)
   ▼                                                       ▼
 0011_arca_billing  ──── depende de: current_role() (0001/0005),
   (customer_invoices,        clients + orders (0001), profiles.client_id
    invoice_items,            → self-sufficient salvo esos prerequisitos
    fiscal_config,
    puntos_venta,
    invoice_audit)
```

**Orden de aplicación seguro en DB remota (estado real, post FASE 1 2026-05-29):**
- Aplicadas y **registradas en el tracker** `schema_migrations`: `0001`–`0009`
  (reconciliado vía `migration repair`, PARIDAD-3 cerrada).
- **Faltan aplicar:** `0010` (documents) y `0011` (ARCA). Ninguna rompe a las ya
  aplicadas; ambas dependen solo de objetos de `0001`/`0005` ya presentes.
- ✅ `0008`/`0009`/`0010` ya están **versionadas en `main`** (HEAD `b82a5f2`,
  PARIDAD-1 cerrada). El SQL de 0008/0009 coincide con lo que ya corre en
  producción.
- ⚠️ **Prohibido `supabase db push`:** con el tracker en `0001–0009`, un push
  intentaría aplicar `0010`/`0011` como DDL real. Solo aplicar con backup +
  diagnóstico + rollback aprobados (gate explícito).

---

## 6. Análisis de blast radius (qué pasa si X cambia)

| Si cambia… | Impacta a… | Severidad |
|------------|-----------|:---------:|
| `current_role()` / RLS helpers | **TODA** la autorización del ERP | 🔴 crítica |
| `profiles` (schema/role) | auth + todos los data layers | 🔴 crítica |
| `clients` | Clientes, Órdenes, Facturación, Comercial | 🟠 alta |
| `orders`/`order_services` | Órdenes, Dashboard, Reportes, Facturación, Ejecutivo | 🟠 alta |
| `lib/compras/data` (shape) | Compras **y** Ejecutivo **y** Operaciones/mapa | 🟠 alta |
| `vendors`/`purchase_orders` | Compras + validación pública OC | 🟡 media |
| tablas 0011 (ARCA) | solo Facturación/Settings (aislado) | 🟡 media |
| `lib/clientify`/`drive` (duplicado) | Comercial / Drive (resolver antes de merge) | 🟡 media |
| CCTV / ANMAT / WhatsApp | aislados (externos/mock) | 🟢 baja |

---

## 7. Conclusión del grafo

1. **Dos raíces de dependencia:** `current_role()` (autorización) y `profiles`
   (identidad). Todo lo demás cuelga de ahí — son intocables sin plan.
2. **El core transaccional** (clients ↔ orders ↔ invoices) está sólido y
   desplegado, salvo que **Facturación corre sin sus tablas** (0011 pendiente).
3. **Compras es un hub secundario:** además de su propio dominio, alimenta a
   Ejecutivo y Operaciones. Versionarlo (hecho) era prioritario.
4. **Las finanzas futuras** (Tesorería → Cuentas Corrientes → Balance) forman
   una cadena lineal sobre Facturación + Proveedores: no se puede empezar
   Tesorería sin cerrar Proveedores (supplier_invoices) primero.
5. **Satélites desacoplados** (CCTV, ANMAT, Documental, WhatsApp, Drive) pueden
   evolucionar sin riesgo para el core.

Documentos relacionados: [ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) ·
[RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) ·
[erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md).

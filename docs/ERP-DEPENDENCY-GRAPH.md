# TOPS NEXUS — ERP-DEPENDENCY-GRAPH

> **Estado:** auditoría · **Fecha:** 2026-05-29 · **Revisión FASE 3**
> Grafo de dependencias del ERP en dos planos: **funcional** (qué módulo necesita
> a qué otro para tener sentido de negocio) y **técnico** (tablas, servicios, APIs,
> funciones SQL y cadena de migraciones). Verificado leyendo imports reales
> (`@/lib/...`) y accesos a tablas (`.from(...)`). **No** crea tablas ni migraciones.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md).
>
> **Corrección FASE 3:** se eliminó el framing "WIP versionado en branch /
> untracked". Todo el código y las 11 migraciones están **trackeadas** en
> `feature/documents-enterprise-ready`. La nueva leyenda de estado refleja
> **madurez real** (desplegado / bloqueado-por-migración / mock / futuro).

---

## 0. Cómo leer este documento

- **Dependencia funcional** = "B no puede existir como negocio sin A". Ej.: una
  factura necesita un cliente y (casi siempre) una orden de servicio.
- **Dependencia técnica** = acoplamiento de código/datos: imports TS, tablas
  consultadas, funciones SQL (RLS), APIs.
- **Leyenda de estado:** ✅ producción · 🟡 código real **bloqueado por migración
  no aplicada** o incompleto por diseño · 🟠 mock/demo · 🔵 futuro (roadmap).

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
  │   ✅     │    │ (OS) ✅  │     │(vendors)✅│   │Clientify✅│
  └────┬─────┘    └────┬─────┘     └────┬─────┘    └────┬─────┘
       │   ┌───────────┘                │               │ (alimenta
       │   │                            ▼               │  Clientes)
       ▼   ▼                       ┌──────────┐         │
  ┌──────────────┐                 │ Compras  │         ▼
  │ Facturación  │                 │  (OC) ✅ │    ┌──────────┐
  │  ARCA 🟡(*)  │                 └────┬─────┘    │  (CRM)   │
  └──────┬───────┘                      │          └──────────┘
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
   │ / Cockpit 🟡 │   (KPIs aún hardcodeados)
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │ Operaciones  │  mapa AMBA — fleet mock; consume lib/ejecutivo/locations
   │ / mapa 🟠    │
   └──────────────┘

   Satélites (sin dependencia funcional dura con el core):
   Documental 🟡 (adjunta a OS/OC/factura; 0010 sin aplicar) ·
   CCTV ✅/🟠 (Hikvision live / eventos mock) · ANMAT 🟠 (mock) ·
   Drive ✅ · WhatsApp 🟡 (webhook inbound TODO)
```

(*) **Facturación ARCA:** código completo, pero (a) tablas 0011 **no aplicadas** y
(b) cliente ARCA productivo es **stub** (solo Mock sin validez fiscal funciona) →
no factura electrónicamente de verdad hasta cerrar ambos.

### 1.1 Reglas de dependencia funcional

| Módulo | Depende de | Naturaleza | Verificado en |
|--------|-----------|------------|---------------|
| **Facturación** | Clientes, Órdenes (OS) | factura referencia `client_id` + `order_id` | `lib/invoicing/*` |
| **Compras (OC)** | Proveedores, Productos | OC referencia vendor + ítems de catálogo | `lib/compras/data` → `vendors`,`products`,`purchase_orders` |
| **Proveedores (AP)** 🔵 | Compras, Facturación-recibida | factura de proveedor salda contra OC | roadmap (no existe `supplier_invoices`) |
| **Tesorería** 🔵 | Facturación, Proveedores | un pago salda una factura (cliente o proveedor) | roadmap |
| **Cuentas Corrientes** 🔵 | Facturación, Tesorería | saldo = facturado − cobrado/pagado | roadmap |
| **Contabilidad/Balance** 🔵 | **Todos** | el GL recibe asientos de cada subledger | roadmap |
| **Cost Centers** 🔵 | transversal | dimensiona asientos/gastos por centro | roadmap |
| **Ejecutivo/Cockpit** | Compras + Órdenes (hoy) | agrega KPIs | `lib/ejecutivo/data` → `@/lib/compras/data` |
| **Operaciones/mapa** | Ejecutivo (locations) | reusa data de ejecutivo | `operaciones/mapa` → `@/lib/ejecutivo/locations` |
| **Comercial** | Clientes | el pipeline alimenta altas de cliente | Clientify (API externa) |
| **Documental** | OS/OC/Factura (opcional) | adjunta comprobantes a entidades | `lib/documental` → `documents` |
| **RBAC** | — (raíz) | gobierna a todos | `current_role()` en toda la RLS |

---

## 2. Grafo técnico — tablas

### 2.1 Tabla → módulos que la consumen (grounded)

| Tabla | Migración | Consumido por | Estado DB |
|-------|:---------:|---------------|:---------:|
| `profiles` | 0001 | **todos** (vía `current_role()`/`auth.uid()`) | ✅ |
| `clients` | 0001 | Clientes, Órdenes, Facturación, Comercial | ✅ |
| `operators` | 0001/0006 | Órdenes, Dashboard, Operaciones | ✅ |
| `orders` + `order_services` | 0001/0004 | Órdenes, Dashboard, Reportes, Facturación, Ejecutivo | ✅ |
| `services_catalog` | 0001 | Órdenes, Templates | ✅ |
| `attachments` | 0004 | Documental, adjuntos | ✅ |
| `audit_log` | 0001/genérica | auditoría transversal (invitación de usuarios) | ✅ |
| `vendors` | 0008 | Compras (`lib/compras/data`) | ✅ con datos |
| `products` | 0008 | Compras | ✅ con datos |
| `purchase_orders` | 0008 | Compras, validación pública OC | ✅ con datos |
| `po_items` / `po_events` / `po_email_sends` | 0008 | Compras (join/timeline/email) | ✅ |
| `roles` | 0009 | RBAC (`lib/rbac/data`) | ✅ con datos (7) |
| `permissions` | 0009 (+0010) | RBAC | ✅ **24** (22 en 0009 + 2 en 0010) |
| `role_permissions` | 0009 (+0010) | RBAC (join) | ✅ con datos |
| `user_roles` | 0009 | RBAC, `has_permission()` | ⚠️ **0 filas (dormido)** |
| `documents` | 0010 | Documental (upload real; lista mock) | ❌ **sin tabla** (0010 sin aplicar) |
| `documents_audit` | 0010 | Auditoría documental (append-only) | ❌ sin tabla |
| `customer_invoices` | 0011 | Facturación (`lib/invoicing`) | ⚠️ **NO aplicada** |
| `invoice_items` | 0011 | Facturación | ⚠️ NO aplicada |
| `fiscal_config` (singleton) | 0011 | Facturación, Settings/fiscal | ⚠️ NO aplicada |
| `puntos_venta` | 0011 | Facturación, Settings/fiscal | ⚠️ NO aplicada |
| `invoice_audit` | 0011 | Facturación (auditoría) | ⚠️ NO aplicada |

### 2.2 Función SQL crítica — `current_role()` (el hub de RLS)

```
                 current_role()  [SECURITY DEFINER, 0001+0005]
                       │  lee profiles.role saltando RLS (corta recursión)
   ┌──────────┬────────┼────────┬──────────┬───────────┐
   ▼          ▼        ▼        ▼          ▼           ▼
 RLS de    RLS de   RLS de   RLS de    RLS de      RLS de
 orders   clients  invoices  po_*     roles/perm  documents…
```

> **Nodo de máximo blast radius:** si `current_role()` pierde
> `SECURITY DEFINER`/`search_path`, **toda** la autorización del ERP cae
> (recursión RLS PG 54001). `is_staff()`/`is_admin()` cuelgan del mismo patrón.
> Invocaciones por migración: 0001:22 · 0004:8 · 0008:18 · 0010:13 · 0011:13.
> Ver [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) §1.

---

## 3. Grafo técnico — servicios / libs

```
  lib/supabase ──────────────► (cliente DB usado por TODOS los data layers)
  lib/env ───────────────────► (flags isMock, config ARCA, credenciales)
        ▲                              ▲
        │                              │
  lib/arca ──► lib/invoicing ──► api/invoices ──► (app)/billing
   (Mock OK /     (emit/calc/        │
    Prod STUB)     data)             └─► usa lib/pdf (PDF fiscal + QR RG 4892)

  lib/data ──► (app)/dashboard, clients, orders, reports

  lib/compras/data ──┬──► (app)/compras/*  +  api/compras/*
                     ├──► lib/ejecutivo/data ──► (app)/ejecutivo
                     │                              └─► (app)/operaciones/mapa
                     └──► usa lib/compras/{totals,validation,pdf,storage,email}

  lib/rbac/data ─────► (app)/settings/roles/*        (solo lectura)
  lib/clientify/ ────► (app)/comercial/* + api/clientify/*   (API externa)
  lib/cctv ──────────► (app)/cctv/* + api/cctv/*             (Hikvision)
  lib/documental ────► (app)/documental/*  (lista mock + storage.ts real + ocr)
  lib/anmat ─────────► (app)/anmat                           (mock)
  lib/whatsapp ──────► api/whatsapp/*                        (Meta API)
  lib/ocr ───────────► (app)/documental + soporte compras    (OpenAI)
  lib/drive/client ──► (app)/drive + (app)/compras/drive     (Google Drive)
```

**Acoplamientos a vigilar (deuda):**
- **Ejecutivo → Compras** es acoplamiento directo (`lib/ejecutivo/data` importa
  `@/lib/compras/data` y `@/lib/types-po`). Si Compras cambia su shape, rompe el
  Cockpit. Única dependencia cruzada *entre módulos de feature*.
- **Duplicados de librería sin resolver** (ver MODULE-MAP §4): `lib/clientify.ts`
  (monolito) vs `lib/clientify/` (modular); `lib/google-drive.ts` vs
  `lib/drive/client.ts`; `lib/types.ts` vs `lib/types-po.ts`. Consolidación
  propuesta (refactor, no ejecutado en esta fase).

---

## 4. Grafo técnico — APIs (route handlers)

| API | Lee/escribe | Depende de | Estado |
|-----|-------------|-----------|:------:|
| `api/auth/*` | profiles, Supabase Auth | lib/supabase | ✅ |
| `api/orders/*` | orders, order_services | lib/data | ✅ |
| `api/compras/*` | purchase_orders, po_items | lib/compras | ✅ |
| `api/drive/*` | Google Drive (externo) | lib/drive/client | ✅ |
| `api/cctv/*` | Hikvision (externo) | lib/cctv | ✅ (live) |
| `api/clientify/*` | Clientify (externo) | lib/clientify | 🟡 webhook inbound TODO (F2.7) |
| `api/whatsapp/*` | Meta WhatsApp (externo) | lib/whatsapp | 🟡 webhook inbound TODO (F3) |
| `api/invoices/*` | customer_invoices, invoice_items, fiscal_config | lib/invoicing, lib/arca | 🟡 tablas 0011 NO aplicadas |

---

## 5. Grafo técnico — cadena de migraciones

```
0001_init ──► 0002 ──► 0003(buckets) ──► 0004(attachments) ──► 0005(fix RLS)
   │                                                              │ endurece
   │  define: profiles, clients, orders, services_catalog,        │ current_role()
   │  user_role_t, current_role()                                 ▼
   │                                              ┌── 0006 ── 0007
   │                                              ├── 0008_purchase_orders (vendors/po_*)
   │                                              ├── 0009_rbac (roles/permissions)
   │                                              └── 0010_documents (documents/_audit)
   │                                                       │ (todas dependen
   ▼                                                       │  de 0001 + current_role)
 0011_arca_billing  ──── depende de: current_role() (0001/0005),
   (customer_invoices,        clients + orders (0001), profiles.client_id
    invoice_items, fiscal_config, puntos_venta, invoice_audit)
```

**Estado de aplicación en DB (según audit read-only previo):**
- **Aplicadas y registradas** en `schema_migrations`: `0001`–`0009`.
- **Faltan aplicar:** `0010` (documents) y `0011` (ARCA). Ninguna rompe a las ya
  aplicadas; ambas dependen solo de objetos de `0001`/`0005` ya presentes.
- **Las 11 migraciones están versionadas** en `main` y en la rama actual.
- ⚠️ **Prohibido `supabase db push`:** con el tracker en `0001–0009`, un push
  intentaría aplicar `0010`/`0011` como DDL real **contra producción**. Solo aplicar
  con backup + diagnóstico + rollback aprobados en **staging aislado** (GATE 2/3).
  **Bloqueado por infraestructura — GATE 2 PENDIENTE.**

> **Nota de dependencia (FASE 3):** "aplicar únicamente 0010" en una base vacía
> **fallaría** — 0010 referencia `clients`(0001), `vendors`(0008), `depot_t`(0001),
> `current_role()`(0001/0005), `profiles`(0001) y RBAC(0009). El orden correcto de
> validación es baseline `0001`–`0009` + la migración bajo prueba.

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
| tablas 0011 (ARCA) / 0010 (documents) | solo Facturación / Documental (aislado) | 🟡 media |
| `lib/clientify`/`drive` (duplicado) | Comercial / Drive (resolver antes de merge) | 🟡 media |
| CCTV / ANMAT / WhatsApp | aislados (externos/mock) | 🟢 baja |

---

## 7. Conclusión del grafo

1. **Dos raíces de dependencia:** `current_role()` (autorización) y `profiles`
   (identidad). Todo cuelga de ahí — intocables sin plan.
2. **El core transaccional** (clients ↔ orders ↔ invoices) está sólido y desplegado,
   salvo que **Facturación corre sin sus tablas** (0011) y **sin cliente ARCA real**.
3. **Compras es un hub secundario:** alimenta a Ejecutivo y Operaciones.
4. **Las finanzas futuras** (Proveedores-AP → Tesorería → Cuentas Corrientes →
   Balance) forman una cadena lineal sobre Facturación + Proveedores: no se puede
   empezar Tesorería sin cerrar **supplier_invoices** primero. **Cost Centers** es
   una dimensión transversal que debe diseñarse antes del GL.
5. **Satélites desacoplados** (CCTV, ANMAT, Documental, WhatsApp, Drive) evolucionan
   sin riesgo para el core.

Documentos relacionados: [ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) ·
[RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) ·
[erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) ·
[ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md).

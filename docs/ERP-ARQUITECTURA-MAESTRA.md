# TOPS NEXUS — Arquitectura Maestra (10 Módulos)

> **Estado:** arquitectura · **Fecha:** 2026-05-29
> Vista única y oficial de los **10 módulos** de TOPS Nexus ERP, cada uno mapeado
> a su código real, tablas, estado, RBAC, dependencias y fase de roadmap. Es la
> capa "ancha" que enumera **todos** los módulos; el backbone **financiero** en
> profundidad vive en [erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md)
> (4 capas: documentos → subledgers → tesorería → GL).
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md). **No** crea tablas ni
> migraciones.

---

## 0. Principios de arquitectura (no-negociables del rector)

1. **Una sola fuente de verdad.** Sin apps paralelas, sin tablas duplicadas, sin
   lógica redundante. Todo se integra dentro de Nexus.
2. **Inmutabilidad documental.** Nada se borra físicamente: solo Anular/Archivar.
3. **Auditoría total.** Toda acción registra usuario/fecha/acción/cambio/IP.
4. **Un solo sistema de autorización** (objetivo): RLS sobre RBAC granular.
5. **Datos fiscales no hardcodeados; clave X.509 solo en host.**
6. **Centro de costo en todo documento** → rentabilidad por unidad de negocio.

**Stack:** Next.js 14 (App Router) · React 18 · TypeScript · Tailwind · Supabase
(PostgreSQL + RLS + Auth SSR) · Netlify. **Patrón de capas:** Feature Module
(`src/app/(app)/<m>`) → Server Action / Route Handler → Data Layer
(`src/lib/<m>/data.ts`) → Supabase, con `isMock()` para demo en memoria.

---

## 1. Mapa de los 10 módulos

```
┌──────────────────────────── TOPS NEXUS ERP ────────────────────────────┐
│ TRANSVERSAL: RBAC/Seguridad · Auditoría (audit_log+*_audit) · Storage   │
│              · Integraciones (ARCA, Clientify, Drive, WhatsApp, Hikvision)│
├─────────────────────────────────────────────────────────────────────────┤
│  1 CRM/Clientes ─┐                                                        │
│  2 Operaciones ──┼─► 5 Facturación ARCA ─┐                               │
│  3 Compras ──────┘                        ├─► 6 Tesorería ─► 7 Cuentas    │
│  4 Documentos/Drive (adjunta a 1·2·3·5)   │      Corrientes              │
│  8 Centros de Costo (atraviesa 3·5·6·7) ──┘                               │
│  9 ANMAT (compliance sobre 2·4·10)                                        │
│ 10 CCTV/Monitoreo (evidencia sobre 2·3·9)                                 │
└───────────────────────────────────────────────────────────────────────────┘
   Todo desemboca, vía subledgers + tesorería, en el GL (Balance) — ver
   erp-arquitectura-objetivo.md §10.
```

---

## 2. Ficha por módulo

### Módulo 1 — CRM y Clientes
- **Código:** `app/(app)/clients` (✅ main) · `app/(app)/comercial/*` + `api/clientify/*` (🟢 branch) · `lib/clientify/*` (modular, branch) vs `lib/clientify.ts` (monolito, main — **duplicado a resolver**).
- **Tablas:** `clients` (✅). Clientify es externo (pipeline/contactos/oportunidades).
- **RBAC:** `comercial.view/edit`; rol `comercial`.
- **Depende de:** RBAC. Alimenta: Facturación (client_id), CC.
- **Estado:** core ✅ + CRM 🟢. **Roadmap:** Fase 7 (integración Clientify).

### Módulo 2 — Operaciones
- **Código:** `app/(app)/orders` (✅), `app/(app)/operaciones/mapa` (🟢), `app/(app)/dashboard`, `reports`, `templates` (✅). `lib/data`, `lib/pricing`, `lib/services-catalog`.
- **Tablas:** `orders`, `order_services`, `operators`, `services_catalog` (✅).
- **Faltan (formalizar):** `warehouses`, `storage_contracts`, `transport_orders`.
- **RBAC:** `servicios.view/create/sign`; roles `operaciones`, `director_ops`.
- **Depende de:** RBAC, Clientes. Alimenta: Facturación, Ejecutivo/BI.
- **Estado:** ✅ desplegado. **Roadmap:** Fase 1 (optimizar + tablas formales).

### Módulo 3 — Compras y Abastecimiento
- **Código:** `app/(app)/compras/*` (11) + `app/compras/validar/[publicId]` (pública) + `api/compras/*` · `lib/compras/*` (10) + `components/compras/*` (6) — 🟢 branch.
- **Tablas:** `vendors`, `products`, `purchase_orders`, `po_items`, `po_events`, `po_email_sends` (✅ **con datos**, migración 0008 — **sin SQL en main**).
- **RBAC:** `compras.view/create/edit/sign/export/delete`; firma OC aislada a `director_ops`.
- **Depende de:** RBAC, Proveedores, Productos. Alimenta: Ejecutivo, Proveedores/IVA Crédito.
- **Estado:** 🟢 maduro (máxima prioridad de promoción). **Roadmap:** Fase 3.

### Módulo 4 — Documentos y Drive
- **Código:** `app/(app)/documental/*`, `api/drive/*` · `lib/documental/*`, `lib/drive/client.ts` (branch) vs `lib/google-drive.ts` (main — **duplicado a resolver**).
- **Tablas:** `documents` (❌ **0010 sin aplicar**), `attachments` (✅).
- **RBAC:** `documental.view/create/delete`.
- **Depende de:** RBAC; adjunta a OS/OC/Factura (opcional). Integra Google Drive.
- **Estado:** 🟢 branch (tabla pendiente). **Roadmap:** Fase 4 / 7.

### Módulo 5 — Facturación Electrónica ARCA
- **Código:** `app/(app)/billing`, `app/(app)/settings` (fiscal), `api/invoices/*` · `lib/arca`, `lib/invoicing`, `lib/pdf` — ✅ **desplegado en main**.
- **Tablas:** `customer_invoices`, `invoice_items`, `fiscal_config`, `puntos_venta`, `invoice_audit` (⚠️ **0011 NO aplicada** → roto en runtime).
- **RBAC:** escritura `admin`/`operaciones`; config `admin`; auditoría read `admin`/`supervisor`.
- **Inmutabilidad:** trigger `customer_invoices_lock` (bloquea cambios tras `AUTORIZADO_ARCA`). **Gap:** sin guard de DELETE (riesgo C2).
- **Depende de:** Clientes, Órdenes, `current_role()`. Alimenta: IVA Débito, CC, GL.
- **Estado:** ⚠️ código sí / tablas no. **Roadmap:** Fase 2 (completo en SANDBOX; PRODUCCIÓN bloqueada sin cert X.509).

### Módulo 6 — Tesorería
- **Código:** 🔵 inexistente.
- **Tablas futuras:** `accounts`, `payment_methods`, `treasury_movements`, `payments`, `collections`, `checks` (e-cheq).
- **Depende de:** Facturación + Proveedores (un pago salda una factura).
- **Estado:** 🔵 futuro. **Roadmap:** Fase 4 (migración 0015). Detalle: erp-arquitectura-objetivo.md §8.3.

### Módulo 7 — Cuentas Corrientes
- **Código:** 🔵 inexistente.
- **Tablas futuras:** subledger AR/AP (`current_accounts`/`account_statements`, allocations).
- **Depende de:** Facturación + Tesorería (saldo = facturado − cobrado/pagado).
- **Estado:** 🔵 futuro. **Roadmap:** Fase 5.

### Módulo 8 — Centros de Costo
- **Código:** 🔵 inexistente.
- **Tablas futuras:** `cost_centers` (jerárquico). FK nullable en `customer_invoices`/`purchase_orders`/`supplier_invoices`.
- **Rentabilidad por:** ANMAT · Cargas Generales · Oficinas/Coworking · Transporte · Servicios adicionales.
- **Estado:** 🔵 futuro. **Roadmap:** Fase 3 (migración 0012, base de todo el backbone financiero).

### Módulo 9 — ANMAT
- **Código:** `app/(app)/anmat/page.tsx` · `lib/anmat/*` (data, alert-engine), `components/anmat/ComplianceAlertEngine.tsx` — 🟢 branch (datos **mock**).
- **Tablas:** ninguna aún (clientes regulados, RNE/RNPA, vencimientos, cadena de frío, trazabilidad → futuras).
- **RBAC:** `compliance.view/edit`; rol `compliance` (DT).
- **Depende de:** Operaciones, Documentos, CCTV (evidencia).
- **Estado:** 🟢 mock. **Roadmap:** Fase 8 (ANMAT avanzado, ver roadmap 12 meses).

### Módulo 10 — CCTV y Monitoreo Operativo
- **Código:** `app/(app)/cctv/*`, `api/cctv/{ping,snapshot}` · `lib/cctv/{hikvision,digest,data}` — 🟢 branch. **Fase 1 (snapshots) implementada.**
- **Tablas:** ninguna aún (`cctv_devices`/`cctv_events`/`cctv_evidence` futuras).
- **RBAC:** `cctv.view/admin`; rol `seguridad`.
- **Depende de:** RBAC; provee evidencia a Operaciones, Compras, ANMAT.
- **Estado:** 🟢 Fase 1 OK. **Roadmap:** 5 fases — ver [ERP-MODULO-CCTV.md](./ERP-MODULO-CCTV.md).

---

## 3. Capa transversal (plataforma)

| Transversal | Implementación | Estado |
|-------------|----------------|:------:|
| **RBAC / Seguridad** | `current_role()` (enum, en uso) + `roles`/`permissions`/`role_permissions`/`user_roles` (granular, **dormido**) | 🟡 unificar (P4) |
| **Auditoría** | `audit_log` (genérica) + `invoice_audit`/`po_events` (por módulo) | 🟡 inmutabilidad incompleta (C2) |
| **Storage** | buckets `signatures`, `pdfs`, `attachments`, `po-pdfs`, `po-signatures` (✅); `invoices` (❌ 0011) | 🟡 |
| **Integraciones** | ARCA (WSAA/WSFEv1), Clientify, Google Drive, WhatsApp (Meta), Hikvision, OCR (OpenAI) | 🟡 código presente, parcial en main |

---

## 4. Matriz módulo ↔ fase ↔ estado (resumen ejecutivo)

| # | Módulo | Estado | Fase rector | Migración clave |
|:-:|--------|:------:|:-----------:|-----------------|
| 1 | CRM/Clientes | ✅/🟢 | 1/7 | 0001 |
| 2 | Operaciones | ✅ | 1 | 0001 (+`warehouses`/`transport_orders` futuras) |
| 3 | Compras | 🟢 | 3 | 0008 |
| 4 | Documentos/Drive | 🟢 | 4/7 | 0010 (sin aplicar) |
| 5 | Facturación ARCA | ⚠️ | 2 | 0011 (sin aplicar) |
| 6 | Tesorería | 🔵 | 4 | 0015 |
| 7 | Cuentas Corrientes | 🔵 | 5 | 0015 |
| 8 | Centros de Costo | 🔵 | 3 | 0012 |
| 9 | ANMAT | 🟢 mock | 8 | (futuras) |
| 10 | CCTV | 🟢 F1 | 7→Core | (futuras) |

> El detalle de la secuencia de migraciones 0012→0017 (catálogos → supplier_invoices
> → withholdings → tesorería/CC → GL → ETL Neuralsoft) está en
> [erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) §9–10.
> El cronograma temporal en [ERP-ROADMAP-12-MESES.md](./ERP-ROADMAP-12-MESES.md).

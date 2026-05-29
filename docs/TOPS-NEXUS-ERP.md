# TOPS NEXUS — Documento Rector del ERP

> **Estado:** vivo · **Última actualización:** 2026-05-29
> Este documento gobierna todo el desarrollo de TOPS Nexus. Antes de implementar
> cualquier feature, validar contra la **Regla de Decisión** y el **Roadmap**.

---

## 1. Visión

TOPS Nexus es el **ERP vertical único de Logística TOPS (VEROTIN S.A.)**. Su
objetivo es reemplazar progresivamente Neuralsoft/Deonics, Clientify, Excel y los
procesos manuales con una única plataforma operativa, fiscal y financiera.

No es "una app con pantallas". Es un sistema de gestión integral 3PL: operaciones,
facturación ARCA, proveedores, tesorería, cuentas corrientes e inteligencia de
negocio, sobre una base de datos coherente y auditable.

## 2. Regla de Decisión (gate de toda feature)

> **¿Esto acerca a TOPS Nexus a convertirse en el ERP único de Logística TOPS y
> permitir eliminar Neuralsoft?**
> Si la respuesta es **NO** → **no se implementa.**

Corolario (primer principio): **antes de escribir una línea de código**, analizar
la arquitectura existente (rutas, DB, componentes, servicios, APIs, auth, diseño,
deploy). Toda mejora se integra armónicamente. Nunca crear funcionalidades
desconectadas ni lógica duplicada.

## 3. Reglas no negociables

- **Inmutabilidad documental.** Ningún documento se elimina físicamente. Solo se
  puede **Anular** o **Archivar** (baja lógica). Aplica a comprobantes, OC, facturas.
- **Auditoría total.** Toda acción registra: usuario, fecha/hora, acción, cambio,
  IP. Tabla `audit_log` (genérica) + auditorías por módulo (ej. `invoice_audit`).
- **Comprobantes fiscales.** No se modifican comprobantes autorizados por ARCA;
  solo Nota de Crédito, Nota de Débito o anulación lógica interna.
- **Datos fiscales no se hardcodean.** Se administran desde `/settings/fiscal`
  (tabla `fiscal_config`, singleton id=1).
- **Clave privada X.509.** Nunca en DB ni repo. Solo en el host vía
  `ARCA_CERT_PATH` / `ARCA_KEY_PATH`, referenciada por `cert_alias`.
- **PRODUCCIÓN fiscal** requiere credenciales montadas en el host; bloqueada por
  código si `!env.arca.configured`.

## 4. Stack & Arquitectura

- **Frontend/SSR:** Next.js 14 App Router · React 18 · TypeScript · Tailwind.
- **Datos:** Supabase (PostgreSQL + RLS + Auth SSR).
- **Deploy:** Netlify · https://tops-ordenes.netlify.app (custom domain previsto:
  nexus.logisticatops.com).
- **Capas:** Feature Modules (`src/app/(app)/<modulo>`) → Server Actions / Route
  Handlers → Services/Data Layer (`src/lib/<modulo>/data.ts`) → Supabase.
- **Patrón de datos:** `isMock()` (`env.app.demoMode || env.app.needsSupabase`)
  permite demo en memoria; producción consulta Supabase.
- **UX:** SaaS enterprise premium, responsive, mobile-first (referencias: Stripe,
  Linear, Notion, Ramp, Odoo Enterprise, SAP Fiori).

## 5. Modelo de datos — estado actual vs. objetivo

Tablas creadas (migraciones 0001–0011):

`attachments`, `audit_log`, `clients`, `customer_invoices`, `documents`,
`email_sends`, `fiscal_config`, `invoice_audit`, `invoice_items`, `notifications`,
`operators`, `order_services`, `orders`, `permissions`, `po_email_sends`,
`po_events`, `po_items`, `products`, `profiles`, `puntos_venta`,
`purchase_orders`, `role_permissions`, `roles`, `services_catalog`,
`user_roles`, `vendors`.

| Objetivo (charter)   | Estado | Mapea a |
|----------------------|--------|---------|
| clients              | ✅ | `clients` |
| providers            | ✅ | `vendors` |
| service_orders       | ✅ | `orders` + `order_services` |
| customer_invoices    | ✅ | `customer_invoices` + `invoice_items` |
| invoice_items        | ✅ | `invoice_items` |
| users / roles        | ✅ | `profiles` + `user_roles` + `roles` + `permissions` |
| audit_logs           | ✅ | `audit_log` (+ `invoice_audit`) |
| documents            | ✅ | `documents` + `attachments` |
| notifications        | ✅ | `notifications` |
| settings             | 🟡 | `fiscal_config` (falta settings general) |
| **supplier_invoices**| ❌ | — (Fase 3) |
| **cost_centers**     | ❌ | — (Fase 3) |
| **payments**         | ❌ | — (Fase 4) |
| **collections**      | ❌ | — (Fase 4) |
| **warehouses**       | ❌ | — (Fase 1/operaciones) |
| **storage_contracts**| ❌ | — (Fase 1/operaciones) |
| **transport_orders** | ❌ | — (Fase 1/operaciones) |

## 6. Roadmap (7 fases) — estado vivo

| Fase | Alcance | Estado |
|------|---------|--------|
| **1. Operaciones** | OC de servicio, operadores, catálogo de servicios | ✅ existe — optimizar; faltan `warehouses`/`storage_contracts`/`transport_orders` formales |
| **2. Facturación ARCA** | WSAA/WSFEv1, CAE, QR, PDF fiscal, config, puntos de venta | ✅ completo (SANDBOX/Mock; PRODUCCIÓN bloqueada sin cert) |
| **3. Proveedores** | Cargar/aprobar/pagar/auditar facturas; centro de costo, categoría contable, responsable | 🟡 parcial — `vendors` + `purchase_orders`/`po_items` ✓; **faltan `supplier_invoices` + `cost_centers`** |
| **4. Tesorería** | Caja, bancos, transferencias, cobranzas, pagos, cheques, flujo de fondos; KPIs saldo/proyección/deuda/cobranza | ❌ ausente |
| **5. Cuentas Corrientes** | Saldos y mora de clientes y proveedores | ❌ ausente |
| **6. Inteligencia de Negocio** | Dashboard corporativo | 🟡 parcial — `ejecutivo`/`reports` existen |
| **7. Integraciones** | Clientify, Google Workspace, WhatsApp, WMS, Hikvision, migración Neuralsoft | 🟡 parcial — código Clientify/Drive/WhatsApp/Hikvision presente; migración Neuralsoft pendiente |

> **Migración 0011 (ARCA):** pendiente de aplicar en producción. Revisión
> detallada de qué crea/modifica en [migracion-0011-arca-revision.md](./migracion-0011-arca-revision.md).

## 7. Próximo incremento recomendado

**Completar Fase 3 — Proveedores:** agregar `supplier_invoices` + `cost_centers`
(migración 0012) y el módulo asociado. Es el eslabón que conecta las
`purchase_orders` existentes con la Tesorería (Fase 4): una factura de proveedor
aprobada genera una obligación de pago. Cada factura se asocia a centro de costo,
categoría contable y responsable, con auditoría e inmutabilidad lógica.

## 8. Modo de trabajo

Autónomo: inspeccionar → diseñar → implementar → corregir → optimizar → probar →
build → resolver errores → verificar responsive → documentar → commit → push. No
pedir confirmación salvo bloqueo técnico real. **Excepción:** el `full push` a
producción / deploy con impacto fiscal real requiere confirmación explícita por
el blast radius (ERP en vivo). Migraciones nuevas no se aplican al Supabase remoto
sin confirmación.

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

> **Corrección 2026-05-29 (auditoría read-only en vivo):** esta sección fue
> rectificada contra la DB real. Versiones previas listaban `documents` y las 5
> tablas ARCA como creadas — **no existen** en la base. Detalle y evidencia en
> [ERP-AUDITORIA-SUPABASE-2026-05-29.md](./ERP-AUDITORIA-SUPABASE-2026-05-29.md).

**Tablas REALES en `public` (20, verificadas en DB al 2026-05-29):**

`attachments`, `audit_log`, `clients`, `email_sends`, `notifications`,
`operators`, `order_services`, `orders`, `permissions`, `po_email_sends`,
`po_events`, `po_items`, `products`, `profiles`, `purchase_orders`,
`role_permissions`, `roles`, `services_catalog`, `user_roles`, `vendors`.
**Vistas:** `my_permissions`, `v_orders_dashboard`, `vendor_stats`.

**Tablas que la documentación previa daba por creadas pero NO existen:**
`documents` (0010 sin aplicar) · `customer_invoices`, `invoice_items`,
`fiscal_config`, `puntos_venta`, `invoice_audit` (0011 sin aplicar).

**Migraciones — estado efectivo (al 2026-05-29, post FASE 1):** `0001–0009`
aplicadas y **registradas en el tracker** `schema_migrations` (reconciliado vía
`supabase migration repair`, **PARIDAD-3 cerrada**); **`0010` y `0011` NO
aplicadas**. El SQL de `0008`/`0009`/`0010` ya está en `main` (**PARIDAD-1
cerrada**, HEAD `b82a5f2`). Sigue **prohibido `supabase db push`**: ahora
intentaría aplicar `0010`/`0011` como DDL real (ver
[ERP-FASE1-PARIDAD.md](./ERP-FASE1-PARIDAD.md) §7.5).

| Objetivo (charter)   | Estado | Mapea a |
|----------------------|--------|---------|
| clients              | ✅ | `clients` |
| providers            | ✅ | `vendors` |
| service_orders       | ✅ | `orders` + `order_services` |
| customer_invoices    | ❌ | — (0011 **NO aplicada** en DB) |
| invoice_items        | ❌ | — (0011 **NO aplicada** en DB) |
| users / roles        | ✅ | `profiles` + `user_roles` (0 filas) + `roles` + `permissions` |
| audit_logs           | ✅ | `audit_log` (`invoice_audit` ausente, 0011) |
| documents            | ❌ | solo `attachments`; `documents` ausente (0010 **NO aplicada**) |
| notifications        | ✅ | `notifications` |
| settings             | ❌ | `fiscal_config` ausente (0011); sin settings general |
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
| **2. Facturación ARCA** | WSAA/WSFEv1, CAE, QR, PDF fiscal, config, puntos de venta | 🟡 **código completo, NO operativo** — migración `0011` **no aplicada**: las 5 tablas ARCA no existen en DB ⇒ `/billing` y `/settings/fiscal` fallan en runtime. PRODUCCIÓN además bloqueada sin cert. |
| **3. Proveedores** | Cargar/aprobar/pagar/auditar facturas; centro de costo, categoría contable, responsable | 🟡 parcial — `vendors` + `purchase_orders`/`po_items` ✓; **faltan `supplier_invoices` + `cost_centers`** |
| **4. Tesorería** | Caja, bancos, transferencias, cobranzas, pagos, cheques, flujo de fondos; KPIs saldo/proyección/deuda/cobranza | ❌ ausente |
| **5. Cuentas Corrientes** | Saldos y mora de clientes y proveedores | ❌ ausente |
| **6. Inteligencia de Negocio** | Dashboard corporativo | 🟡 parcial — `ejecutivo`/`reports` existen |
| **7. Integraciones** | Clientify, Google Workspace, WhatsApp, WMS, Hikvision, migración Neuralsoft | 🟡 parcial — código Clientify/Drive/WhatsApp/Hikvision presente; migración Neuralsoft pendiente |

> **Migraciones 0010 (documents) y 0011 (ARCA):** ambas **NO aplicadas** en la DB
> real (verificado 2026-05-29). `/documental` no persiste y `/billing` + `/settings/fiscal`
> fallan en runtime contra la DB. Revisión de 0011 en
> [migracion-0011-arca-revision.md](./migracion-0011-arca-revision.md); evidencia del
> estado real en [ERP-AUDITORIA-SUPABASE-2026-05-29.md](./ERP-AUDITORIA-SUPABASE-2026-05-29.md).

## 7. Próximo incremento recomendado

**FASE 2 — Módulo Documents (migración `0010`).** Prioridad estratégica vigente
(post FASE 1.5): el código y la migración `0010` ya están versionados en `main`
pero **NO aplicados** en DB. La próxima fase es **solo diagnóstico, arquitectura,
riesgos y plan de implementación** del Módulo Documents — sin ejecutar la migración,
sin `db push`, con backup previo (RP6) e idempotencia endurecida como pre-requisitos.
**ARCA (`0011`) no avanza hasta cerrar Documents.** Detalle en
[ERP-FASE15-CONSOLIDACION-DOCUMENTAL.md](./ERP-FASE15-CONSOLIDACION-DOCUMENTAL.md).

> _Diferido_ — Fase 3 Proveedores (`supplier_invoices` + `cost_centers`, migración
> `0012`): conecta las `purchase_orders` con Tesorería. Queda **postergada** detrás
> de Documents y ARCA según la prioridad estratégica del charter.

## 8. Modo de trabajo

Autónomo: inspeccionar → diseñar → implementar → corregir → optimizar → probar →
build → resolver errores → verificar responsive → documentar → commit → push. No
pedir confirmación salvo bloqueo técnico real. **Excepción:** el `full push` a
producción / deploy con impacto fiscal real requiere confirmación explícita por
el blast radius (ERP en vivo). Migraciones nuevas no se aplican al Supabase remoto
sin confirmación.

## 9. Módulos oficiales (10) y documentos de arquitectura

TOPS Nexus se compone de **10 módulos Core**: (1) CRM/Clientes, (2) Operaciones,
(3) Compras, (4) Documentos/Drive, (5) Facturación ARCA, (6) Tesorería,
(7) Cuentas Corrientes, (8) Centros de Costo, (9) ANMAT y **(10) CCTV y Monitoreo
Operativo** — este último **elevado oficialmente de integración satélite a módulo
nativo** (evidencia visual auditable + insumo de compliance ANMAT).

Documentación de arquitectura y consolidación (gobernada por este rector):

- [ERP-FASE0-GOBERNANZA-DB.md](./ERP-FASE0-GOBERNANZA-DB.md) — **FASE 0: gobernanza y trazabilidad de DB**: causa raíz de PARIDAD-3 (bootstrap sin tracker), matriz completa de migraciones (disco/tracker/manual/no-aplicada), estrategia de sincronización segura (`migration repair`) y riesgos de `db push`/migraciones/deploys.
- [ERP-FASE1-PARIDAD.md](./ERP-FASE1-PARIDAD.md) — **FASE 1: cierre de PARIDAD-1/2/3** con registro de ejecución de GATE A (merge a main + deploy) y GATE B (`migration repair`), verificación previa/posterior y rollback.
- [ERP-FASE15-CONSOLIDACION-DOCUMENTAL.md](./ERP-FASE15-CONSOLIDACION-DOCUMENTAL.md) — **FASE 1.5: consolidación documental final** — paridad Código↔Migraciones↔DB↔Documentación y módulos autorizados para FASE 2.
- [ERP-AUDITORIA-SUPABASE-2026-05-29.md](./ERP-AUDITORIA-SUPABASE-2026-05-29.md) — **auditoría read-only en vivo de la DB**: migraciones aplicadas, tablas/columnas reales, RBAC, buckets, paridad definitiva y plan de remediación PARIDAD-1.
- [ERP-CONSOLIDACION-DEFINITIVA.md](./ERP-CONSOLIDACION-DEFINITIVA.md) — informe capstone: paridad, divergencia y clasificación main/branch/eliminar/Core.
- [ERP-ARQUITECTURA-MAESTRA.md](./ERP-ARQUITECTURA-MAESTRA.md) — vista única de los 10 módulos.
- [ERP-MODULO-CCTV.md](./ERP-MODULO-CCTV.md) — incorporación oficial del módulo CCTV.
- [ERP-ROADMAP-12-MESES.md](./ERP-ROADMAP-12-MESES.md) — plan 2026-06 → 2027-05.
- Auditoría base: [ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) · [ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md) · [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) · [erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) · [ERP-INFORME-EJECUTIVO-RIESGOS.md](./ERP-INFORME-EJECUTIVO-RIESGOS.md).

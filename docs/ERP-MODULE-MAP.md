# TOPS NEXUS — ERP-MODULE-MAP

> **Estado:** auditoría · **Fecha:** 2026-05-29 · **Revisión FASE 3** (consolidación arquitectónica)
> Mapa definitivo de módulos del ERP y su estado real, verificado por auditoría
> estática del código y las migraciones en disco (`git ls-files`, lectura de
> imports y `.from(...)`), contrastado con el audit read-only de DB previo.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md). Base de evidencia:
> [ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md).
>
> **Corrección FASE 3:** las versiones previas de este mapa describían el código
> como *"WIP local / untracked / 93 archivos sin trackear"* y *"tres planos que no
> coinciden"*. Eso quedó **obsoleto**: todo `src/` y las 11 migraciones (0001–0011)
> están **trackeadas** en `feature/documents-enterprise-ready` (y las migraciones
> también en `main`). El único gap real es **Migraciones↔DB** (0010 y 0011 sin
> aplicar). El framing se reescribió a la realidad verificada.

---

## 0. Los dos planos que importan hoy

| Plano | Qué es | Estado |
|-------|--------|--------|
| **Código** | `feature/documents-enterprise-ready` (HEAD `2326559`, +12 vs `main`) — todo trackeado | ✅ coherente |
| **Base de datos** | Supabase PROD `arsksytgdnzukbmfgkju` | ⚠️ **gap de 2 migraciones**: 0010 (documents) y 0011 (ARCA) **no aplicadas** |

> **Restricción de infraestructura vigente:** sin Docker ni `psql`, CLI linkeada a
> producción → la aplicación de 0010/0011 está **bloqueada** y diferida a GATE 2/3
> en staging aislado. **GATE 2 PENDIENTE.**

**Consecuencia operativa única:** las vistas que consultan tablas de 0010/0011
contra Supabase real (**billing**, **settings/fiscal**, **documental**) fallan en
runtime hasta aplicar el DDL. Mitigado por guards `isMock()`/datos mock. No afecta
al resto de la app.

---

## 1. Inventario por madurez (resumen)

| Madurez | Módulos |
|---------|---------|
| **Producción-listo (9)** | dashboard · clients · orders (OS) · reports · compras (OC) · comercial (con key) · cctv (cámaras live) · settings/users · drive |
| **WIP — bloqueado por migración (3)** | billing · settings/fiscal (dependen de **0011**) · documental (depende de **0010**) |
| **WIP — incompleto por diseño (2)** | ARCA submission real (stub) · settings/roles (edición diferida "Fase 3") |
| **Demo-only / mock por diseño (3)** | anmat · operaciones/mapa · templates |

> Subcomponentes mock dentro de módulos por lo demás reales: **eventos CCTV**
> (las cámaras son live) y **KPIs Ejecutivo** (agregados hardcodeados).

---

## 2. Inventario detallado (verificado)

Leyenda fuente de datos: **Real** = lee Supabase/integración real cuando está
configurada (cae a mock sin ella) · **Mock** = datos estáticos hardcodeados.

| Módulo | Ruta | lib backing | Tablas | Integraciones | Fuente | Madurez |
|--------|------|-------------|--------|---------------|:------:|:------:|
| **Dashboard** | `(app)/dashboard` | `data/orders`, `mock-data` | orders, clients, operators | Supabase | Real | ✅ |
| **Clientes** | `(app)/clients` | `data/clients`, `validation` | clients | Clientify→Supabase | Real híbrido | ✅ |
| **Órdenes (OS)** | `(app)/orders` | `data/orders`, `pricing`, `services-catalog` | orders, order_services, operators | Supabase, Resend, PDF | Real | ✅ |
| **Reportes** | `(app)/reports` | `data/orders` | orders, clients | Supabase | Real | ✅ |
| **Compras (OC)** | `(app)/compras/*` | `compras/data`, `compras-mock`, `pdf`, `pricing` | vendors, products, purchase_orders, po_items, po_events, po_email_sends | Supabase, Resend, Drive, PDF | Real | ✅ |
| **Comercial / CRM** | `(app)/comercial/*` + `api/clientify/*` | `clientify/data` | — (CRM externo) | Clientify | Real (con key) | ✅ |
| **CCTV** | `(app)/cctv/*` + `api/cctv/*` | `cctv/hikvision` | — | Hikvision | Cámaras Real / eventos Mock | ✅/🟠 |
| **Drive** | `(app)/drive` + `api/drive/*` | `drive/client` | — | Google Drive | Real (con SA) | ✅ |
| **Settings/Usuarios** | `(app)/settings/users` | `lib/supabase` (directo) | profiles, audit_log | Supabase Auth | Real (invitación live) | ✅ |
| **Facturación ARCA** | `(app)/billing` + `api/invoices/*` | `invoicing/data`, `arca`, `pdf` | customer_invoices, invoice_items, fiscal_config, puntos_venta, invoice_audit | ARCA/AFIP (**stub**), Supabase | Real | 🟡 0011 sin aplicar |
| **Settings/Fiscal** | `(app)/settings/fiscal` | `invoicing/data` | fiscal_config, puntos_venta | ARCA | Real | 🟡 0011 sin aplicar |
| **Documental** | `(app)/documental/*` | `documental/data` (mock) + `storage.ts` (real) + `ocr/openai` | documents, **documents_audit** | Supabase Storage, OpenAI OCR | Lista Mock / upload Real | 🟡 0010 sin aplicar |
| **Settings/Roles** | `(app)/settings/roles/*` | `rbac/data` | roles, permissions, role_permissions, user_roles | Supabase | Real (solo lectura) | 🟡 edición "Fase 3" |
| **Ejecutivo / Cockpit** | `(app)/ejecutivo` | `ejecutivo/data`→`compras/data` | (vía compras) | Supabase | Real parcial / KPIs Mock | 🟡 |
| **ANMAT** | `(app)/anmat` | `anmat/data` | — | — | Mock | 🟠 demo |
| **Operaciones/mapa** | `(app)/operaciones/mapa` | `ejecutivo/locations` | — | — | Mock (fleet) | 🟠 demo |
| **Templates** | `(app)/templates` | `env` | — | — | Estático | 🟠 preview |
| **Validación pública OC** | `app/compras/validar/[publicId]` (fuera del shell) | `compras` | purchase_orders | Supabase | Real | ✅ ruta pública firmada |

**Libs base (transversales):** `supabase/`, `env.ts`, `data/`, `pricing/`,
`validation/`, `services-catalog.ts`, `pdf/`, `email.ts`, `utils.ts`, `types.ts`,
`types-po.ts`, `rate-limit.ts`, `org.ts`, `mock-data.ts`.

**APIs (route handlers):** `api/auth/*`, `api/orders/*`, `api/invoices/*`,
`api/compras/*`, `api/drive/*`, `api/cctv/*`, `api/clientify/*`, `api/whatsapp/*`.

---

## 3. Módulos del roadmap INEXISTENTES (ni código ni tablas — verificado 0 matches)

| Área | Fase | Estado |
|------|:----:|--------|
| **Proveedores (AP fiscal):** `supplier_invoices`, IVA Crédito, pagos | F3/F4 | ❌ no existe (hoy solo OC vía 0008) |
| **Tesorería** | F4 | ❌ no existe |
| **Cuentas Corrientes** | F5 | ❌ no existe |
| **Contabilidad / Balance / Libro Mayor** | F6 | ❌ no existe |
| **Cost Centers** | transversal | ❌ no existe |

> Diseño objetivo en [erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md);
> validación en [ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md) §6.

---

## 4. Deuda de consolidación — duplicación de librerías (Prioridad 2)

| Concepto | Monolito (legacy) | Modular (vigente) | Acción propuesta |
|----------|-------------------|-------------------|------------------|
| **Google Drive** | `lib/google-drive.ts` (usado por `src/app/drive`, página de diagnóstico/ping) | `lib/drive/client.ts` (usado por `(app)/drive` + compras) | Deprecar monolito; migrar el ping al cliente modular |
| **Clientify** | `lib/clientify.ts` (monolito) | `lib/clientify/` (modular — usado por comercial) | Migrar consumidores; deprecar monolito |
| **Tipos** | `lib/types.ts` | `lib/types-po.ts` | Revisar solapamiento; unificar nomenclatura |

> **No-duplicados (aclaración):** `(app)/orders` (órdenes de **servicio**) vs
> `(app)/compras/ordenes` (órdenes de **compra**) son dominios distintos.
> `app/compras/validar/*` es la ruta pública de validación de OC firmada,
> intencionalmente fuera del shell autenticado.

> La consolidación es **refactor de código**, no análisis: queda como propuesta
> priorizada; no se ejecuta en esta fase (solo documentación/diseño).

---

## 5. Storage buckets (según migraciones)

| Bucket | Visibilidad | Migración | Estado en DB |
|--------|-------------|-----------|--------------|
| `signatures` | 🌍 público | 0003 | ✅ |
| `pdfs` | 🌍 público | 0003 | ✅ |
| `attachments` | 🔒 privado | 0004 | ✅ |
| `po-pdfs` | 🌍 público | 0008 | ✅ |
| `po-signatures` | 🔒 privado | 0008 | ✅ |
| `documents` | 🔒 privado | 0010 | ❌ **no existe** (0010 sin aplicar) |
| `invoices` | 🔒 privado | 0011 | ❌ **no existe** (0011 sin aplicar) |

---

## 6. Conclusión del mapa

- **Núcleo OS sólido y desplegado:** dashboard / clientes / órdenes / reportes,
  más compras (OC) y settings/users en producción.
- **Tres módulos esperando DDL:** billing, settings/fiscal (0011) y documental
  (0010) — código real, bloqueados por migración no aplicada. Activación vía
  GATE 2/3 en staging (bloqueado por infraestructura).
- **Facturación electrónica real pendiente:** el cliente ARCA productivo es stub;
  hoy solo funciona el Mock (sin validez fiscal).
- **RBAC granular sembrado pero dormido** (ver [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md)).
- **Demo-only:** anmat, operaciones/mapa, templates — decidir conexión real vs
  etiquetado de demo por roadmap.

Documentos relacionados: [ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md) ·
[RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) ·
[ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md).

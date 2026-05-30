# NEXUS ERP LOGÍSTICA TOPS — FASE 3 · CONSOLIDACIÓN ARQUITECTÓNICA

## ERP-FASE3 · AUDITORÍA COMPLETA DEL REPOSITORIO (Prioridad 1)

> **Método:** auditoría estática del código fuente y de las migraciones en disco, contrastada contra los documentos rectores. Toda afirmación está anclada en evidencia `archivo:línea`. Principio de gobernanza: **NO ASUMIR. VERIFICAR.**
>
> **Restricción de infraestructura vigente (bloqueo declarado):** no hay Docker ni `psql` en el entorno, y la CLI de Supabase está linkeada a **PRODUCCIÓN** (`arsksytgdnzukbmfgkju`). Por eso **no se ejecutó SQL en vivo** ni se consultó la DB en esta auditoría. El estado de la base se toma del audit read-only previo `ERP-AUDITORIA-SUPABASE-2026-05-29.md`. **GATE 2 (Documents staging) queda PENDIENTE** hasta resolver el entorno (Docker local o Supabase Staging aislado).

- **Fecha:** 2026-05-29
- **Rama:** `feature/documents-enterprise-ready` · HEAD `2326559` (12 commits adelante de `main`)
- **Stack:** Next.js 14 (App Router) · React 18 · TypeScript · Supabase (PostgreSQL + RLS + Auth SSR) · Netlify
- **Alcance:** 172 archivos `.ts/.tsx`, 35 páginas, 10 `actions.ts`, 11 migraciones (0001–0011), 19 docs rectores.

---

## 1. Inventario verificado

### 1.1 Ramas
| Rama | Rol | Estado |
|---|---|---|
| `main` | Línea desplegada (Netlify) | HEAD `b82a5f2`; tiene 0001–0011 trackeadas; **NO** tiene los docs de consolidación ni el hardening de Documents |
| `feature/documents-enterprise-ready` | **Rama actual** — Documents Enterprise (GATE 1/1C/1D/2) | HEAD `2326559`, +12 / −2 vs `main` |
| `docs/consolidacion-arquitectonica` | Trabajo de consolidación previo | `181ee0b` — **contenida** en la rama actual (sin trabajo huérfano) |
| `feature/ui-redesign`, `wip/erp-consolidation`, `fix/paridad-1-migraciones` | Ramas históricas | No relevantes para esta fase |

### 1.2 Migraciones (disco) y estado en DB
| Mig | Líneas | Crea | Aplicada en PROD |
|---|---|---|---|
| 0001_init | 288 | enums base (`user_role_t`, `depot_t`), `profiles`, `clients`, `orders`, `current_role()` | ✅ |
| 0002_seed | 28 | seeds | ✅ |
| 0003_storage | 46 | buckets iniciales | ✅ |
| 0004_extended_schema | 200 | order_services, operators, etc. | ✅ |
| 0005_fix_rls_recursion | 159 | `current_role()`/`is_staff()`/`is_admin()` SECURITY DEFINER | ✅ |
| 0006_real_operators | 53 | operadores reales | ✅ |
| 0007_extend_service_units | 24 | unidades de servicio | ✅ |
| 0008_purchase_orders | 328 | `vendors`, `products`, `purchase_orders`, `po_items`, `po_events`, `po_email_sends`, vista `vendor_stats` | ✅ |
| 0009_rbac | 289 | RBAC granular: `permissions`, `roles`, `role_permissions`, `user_roles`, `has_permission()` | ✅ (tablas creadas, **dormido**) |
| **0010_documents** | 449 | Centro Documental endurecido (P1–P8) | 🔴 **NO aplicada** |
| **0011_arca_billing** | 367 | Facturación ARCA: 5 enums, 5 tablas, inmutabilidad, bucket `invoices` | 🔴 **NO aplicada** |

> **Paridad:** Código(rama) ↔ Migraciones(disco) están alineados; **Migraciones ↔ DB tiene un gap de 2 migraciones (0010, 0011)** pendientes de aplicar. Documentación ↔ realidad: corregida en esta fase (ver §4.4).

### 1.3 Modelo de fuente de datos (verificado `src/lib/env.ts:28-32`)
No hay "demo por defecto". `demoMode` es `true` **solo** si `NEXT_PUBLIC_DEMO_MODE=1`. Los módulos respaldados por Supabase usan `isMock()/shouldUseMock() = demoMode || needsSupabase`; con Supabase configurado leen datos **reales**, sin él caen a mock. Un subconjunto (ANMAT, eventos CCTV, fleet de Operaciones, lista Documental, KPIs Ejecutivo) usa **datos estáticos hardcodeados sin importar el entorno**.

---

## 2. Inventario de módulos (verificado)

| Módulo | Datos | Lib backing | Tablas | Integraciones | Estado |
|---|---|---|---|---|---|
| **dashboard** | Real / fallback mock | `data/orders`, `mock-data` | orders, clients, operators | Supabase | Producción |
| **clients** | Real híbrido (Clientify→Supabase→mock) | `data/clients` | clients | Clientify, Supabase | Producción |
| **orders** (O. Servicio) | Real / fallback | `data/orders`, `pricing`, `services-catalog`, `validation` | orders, order_services, operators | Supabase, Resend, PDF | Producción |
| **reports** | Real / fallback | `data/orders` | orders, clients | Supabase | Producción (básico) |
| **compras** (OC: ordenes/proveedores/nueva/email/drive) | Real / fallback | `compras/data`, `compras-mock`, `pdf`, `pricing` | vendors, products, purchase_orders, po_items, po_events, po_email_sends | Supabase, Resend, Drive, PDF | Producción-capaz |
| **comercial** (pipeline/contactos) | Real (Clientify API) | `clientify/data` | — (CRM externo) | Clientify | Producción si hay API key |
| **cctv** | Cámaras live reales; **eventos = mock** | `cctv/hikvision` | — | Hikvision | Live real / eventos demo |
| **drive** (`(app)/drive`) | Real | `drive/client` | — | Google Drive | Producción si SA configurada |
| **settings/users** | Real (Supabase Auth) | `lib/supabase` (directo `profiles`) | profiles, audit_log | Supabase | Producción (invitación live) |
| **billing** | Real / fallback | `invoicing/data`, `arca`, `pdf` | customer_invoices, invoice_items, fiscal_config, puntos_venta, invoice_audit | ARCA/AFIP (**stub**), Supabase | 🟡 **WIP** — 0011 sin aplicar; ARCA real = stub |
| **settings/fiscal** | Real / fallback | `invoicing/data` | fiscal_config, puntos_venta | ARCA, Supabase | 🟡 **WIP** — depende de 0011 |
| **documental** | **Mixto**: lista = mock (deriva de `MOCK_PURCHASE_ORDERS`+ANMAT); upload = Supabase Storage real | `documental/data` (mock) + `storage.ts` (real) + `ocr/openai` | documents, documents_audit | Supabase Storage, OpenAI OCR | 🟡 **WIP** — 0010 sin aplicar; lista aún mock |
| **settings/roles** | Real (lectura) / seed | `rbac/data` | roles, permissions, role_permissions, user_roles | Supabase | 🟡 **Parcial** — edición deshabilitada "Fase 3"; `user_roles`=0 |
| **ejecutivo** | Agrega compras / mock | `ejecutivo/data`→`compras/data` | (vía compras) | Supabase | 🟡 Parcial — KPIs hardcodeados |
| **anmat** | **Mock** (credenciales/temps/docs/audits hardcodeados) | `anmat/data` | — | — | 🟠 Demo-only |
| **operaciones/mapa** | **Mock** (fleet hardcodeada) | `ejecutivo/locations` | — | — | 🟠 Demo-only |
| **templates** | Estático (preview) | `env` | — | — | 🟠 Demo/preview |

---

## 3. Estado de madurez por módulo

- **Producción-listo (9):** dashboard, clients, orders (OS), reports, compras (OC), comercial (con key), cctv (cámaras live), settings/users, drive.
- **WIP — código real pero bloqueado por migración no aplicada (3):** billing, settings/fiscal (ambos dependen de **0011**), documental (depende de **0010**). En runtime contra Supabase real, estas vistas **fallan** hasta aplicar el DDL; en demo mode usan mocks.
- **WIP — funcionalidad incompleta por diseño (2):** ARCA submission real (stub `production-service.ts`), settings/roles (edición diferida a Fase 3).
- **Demo-only / mock por diseño (3):** anmat, operaciones/mapa, templates. (eventos CCTV y KPIs ejecutivo: subcomponentes mock dentro de módulos por lo demás reales.)

---

## 4. Deuda técnica verificada

### 4.1 Migraciones sin aplicar (riesgo de runtime)
`0010` (documents/documents_audit) y `0011` (5 tablas fiscales) están en disco pero **no en la DB**. Cualquier ruta que las consulte contra Supabase real rompe. Mitigación actual: guards `isMock()` + datos mock. **Acción:** aplicar vía GATE 2/GATE 3 en staging antes de habilitar producción (bloqueado por infraestructura).

### 4.2 Duplicación de librerías (consolidación pendiente — Prioridad 2)
| Duplicado | Monolito (legacy) | Modular (vigente) | Acción |
|---|---|---|---|
| Google Drive | `lib/google-drive.ts` (`getDriveClient`, `checkDriveEnv`, `pingDrive`) — usado por `src/app/drive` (página de diagnóstico) | `lib/drive/client.ts` (`ensureFolder`, `uploadPdf`, …) — usado por `(app)/drive` + compras | Unificar en `lib/drive/`; degradar `/drive` ping a usar el cliente modular; deprecar monolito |
| Clientify | `lib/clientify.ts` (monolito) | `lib/clientify/` (modular — usado por comercial) | Migrar consumidores al modular; deprecar `lib/clientify.ts` |
| Tipos | `lib/types.ts` | `lib/types-po.ts` | Revisar solapamiento; consolidar nomenclatura |

> **No-duplicados (aclaración):** `(app)/orders` (órdenes de **servicio**) vs `(app)/compras/ordenes` (órdenes de **compra**) son dominios distintos, no duplicados. `src/app/compras/validar/[publicId]` es la página pública de validación de OC firmada (fuera del shell autenticado), intencionalmente separada.

### 4.3 Marcadores reales de trabajo pendiente
- **`TODO` literales = 3** (verificado; los "~40" eran la palabra española "todo/todos"):
  - `api/clientify/webhook/route.ts:26` — verificar firma HMAC (F2.7)
  - `api/clientify/webhook/route.ts:37` — persistir evento + invalidar cache + automatizaciones (F2.7)
  - `api/whatsapp/webhook/route.ts:35` — persistir mensajes entrantes + status (F3)
- **Stubs/diferimientos documentados (no son TODO pero son WIP):** ARCA `production-service.ts` (WSAA/WSFE no implementados), OCR de PDF escaneado (`ocr/openai.ts` devuelve placeholder para PDF solo-imagen), CCTV streaming HLS/WebRTC (`cctv/hikvision.ts`), KPIs ejecutivo desde vistas materializadas (`ejecutivo/data.ts`).

### 4.4 Documentación desactualizada (corregida en esta fase)
- `ERP-MODULE-MAP.md` y `ERP-DEPENDENCY-GRAPH.md` describen el código como **"WIP untracked / 93 archivos sin trackear"**. **FALSO hoy:** todo el `src/` y las 11 migraciones están **trackeadas** en la rama actual (y las migraciones también en `main`). El framing "tres planos / untracked" quedó obsoleto. → **Reescritura en Prioridades 4 y 5.**
- Ambos docs referencian HEAD `b82a5f2` y ramas `feature/ui-redesign`/`wip/erp-consolidation`; el HEAD vigente es `2326559` en `feature/documents-enterprise-ready`.
- `documents_audit` (creada por 0010) no figura en MODULE-MAP (lista solo `documents`/`attachments`).
- Conteo de permisos RBAC desactualizado (ver §5).

---

## 5. RBAC — dos modelos en paralelo (Prioridad 3, base)

- **Modelo simple (ÚNICO que aplica hoy):** `profiles.role` (`user_role_t`: admin/operaciones/supervisor/cliente) vía `current_role()`/`is_staff()`/`is_admin()` (SECURITY DEFINER, `0005`). Lo usan TODAS las RLS (0001:22, 0004:8, 0008:18, 0010:13, 0011:13 invocaciones) y el gating de la app.
- **Modelo granular (SEMBRADO pero DORMIDO):** `0009` crea `permissions/roles/role_permissions/user_roles`, enums `permission_module_t` (9 valores) y `permission_action_t` (7: view/create/edit/delete/sign/export/admin), vista `my_permissions`, función `has_permission()`. **`has_permission()` no se referencia en ninguna RLS ni en la app** — el único match es su propia definición (`0009:164`). `user_roles` tiene **0 filas**.
- **Permisos sembrados:** 22 en `0009` **+2 en `0010`** (`documental.export`, `documental.admin`) = **24** en DB. La capa TS (`rbac/data.ts`, `types.ts`) y `RBAC-ARCHITECTURE.md` solo conocen 22 → **stale**.
- **Roles (7, `is_system`):** director_ops, admin, operaciones, compliance, comercial, seguridad, cliente_b2b.
- **UI:** `settings/roles` es **100% lectura** (sin `actions.ts`; botones `disabled` con banner "Fase 3"). `settings/users` **sí escribe** (invita vía `auth.admin.inviteUserByEmail` + upsert `profiles` + `audit_log`) pero **solo setea `profiles.role`**, nunca `user_roles`.
- **Versionado de RBAC: inexistente.** `role_permissions` no tiene `updated_at` ni historial; no hay auditoría de cambios de permisos (no podría haberla: no existe acción que los mute). → **Diseño en Prioridad 3.**

---

## 6. Arquitectura financiera — estado real (Prioridad 7, base)

| Área objetivo | Estado real verificado |
|---|---|
| **Facturación ARCA** | Schema + lógica **completos en disco** (0011, `invoicing/`, `arca/`), pero **0011 sin aplicar** y **ARCA productivo = STUB**: `production-service.ts:46,53` lanza `NOT_READY`; WSAA/WSFE no implementados; **sin dependencias SOAP/firma** en `package.json`. Solo el **Mock** (`mock-service.ts`) funciona, con CAE **fiscalmente falso** y contador en memoria. `calc.ts` (impuestos) y `qr.ts` (QR RG 4892) sí son reales. |
| **Proveedores** | `vendors` existe (0008, aplicada) + ciclo de **órdenes de compra**. **No hay AP fiscal:** cero `supplier_invoices`, cero IVA Crédito, cero pagos. |
| **Tesorería** | **No existe** — 0 código, 0 schema. |
| **Cuentas Corrientes** | **No existe** — 0 código, 0 schema. |
| **Balance / Libro Mayor** | **No existe** — 0 código, 0 schema (sin partida doble, sin plan de cuentas). |
| **Cost Centers** | **No existe** — 0 código, 0 schema. |

> `erp-arquitectura-objetivo.md` describe estas seis áreas con **precisión y honestidad** (se presenta explícitamente como diseño futuro y ya advierte que las tablas de 0011 no existen en DB). Validación detallada en Prioridad 7.

---

## 7. Hallazgos priorizados

| # | Sev. | Hallazgo | Acción / Prioridad |
|---|---|---|---|
| H-1 | 🔴 Alto | 0010 y 0011 sin aplicar → billing/fiscal/documental rompen contra Supabase real | Aplicar en staging (GATE 2/3) — bloqueado por infra |
| H-2 | 🟠 Medio | ARCA productivo es stub → no se puede facturar electrónicamente de verdad | Roadmap F-ARCA: cliente WSAA/WSFE + cert |
| H-3 | 🟠 Medio | RBAC granular dormido + sin versionado de permisos | Diseño P3; activación futura |
| H-4 | 🟡 Bajo | Duplicación de libs (drive, clientify, types) | Consolidación P2 |
| H-5 | 🟡 Bajo | Docs MODULE-MAP/DEPENDENCY-GRAPH con framing "untracked" obsoleto | Reescritura P4/P5 |
| H-6 | 🟡 Bajo | Módulos demo-only (anmat, operaciones/mapa, templates) presentados sin marca clara de "demo" en UI | Etiquetar / roadmap |
| H-7 | 🟢 Info | 3 TODO reales (webhooks clientify/whatsapp) | F2.7/F3 |

**No se detectaron hallazgos críticos de seguridad nuevos** en esta auditoría estática (los de Documents se cerraron en GATE 1C). RLS multi-tenant, append-only de auditoría y aislamiento de storage están correctos en diseño (pendiente validación en vivo — GATE 2).

---

## 8. Plan de consolidación de módulos WIP (Prioridad 2)

1. **Bloqueados por migración (billing, fiscal, documental):** no requieren cambio de código para "consolidar"; requieren **aplicar 0010/0011 en staging** (GATE 2/3). Hasta entonces, mantener los guards `isMock()` y **etiquetar la UI como "previo a activación de DB"**.
2. **Duplicados de librería:** plan de deprecación en 3 pasos — (a) marcar `lib/google-drive.ts` y `lib/clientify.ts` como `@deprecated` con apuntador al modular; (b) migrar el único consumidor de cada monolito; (c) eliminar el monolito en un commit dedicado. **No ejecutar ahora** (es refactor de código, no análisis) — queda como propuesta priorizada.
3. **Mock-only por diseño (anmat, operaciones/mapa, eventos cctv, kpis ejecutivo):** decidir por roadmap si se conectan a fuentes reales o se marcan explícitamente como demo en la UI.
4. **Webhooks (clientify/whatsapp):** completar persistencia + verificación de firma (F2.7/F3).

---

## 9. Próximos pasos (mapa de entregables de FASE 3)

| Prioridad | Entregable | Estado |
|---|---|---|
| 1 | **ERP-FASE3-AUDITORIA-REPOSITORIO.md** (este doc) | ✅ |
| 2 | Consolidación WIP (plan en §8) | ✅ plan; ejecución de refactor diferida |
| 3 | Versionado de RBAC — diseño en `RBAC-ARCHITECTURE.md` | ⏭️ siguiente |
| 4 | `ERP-MODULE-MAP.md` reescrito a realidad | ⏭️ |
| 5 | `ERP-DEPENDENCY-GRAPH.md` reescrito a realidad | ⏭️ |
| 6 | `ERP-INFORME-EJECUTIVO-RIESGOS.md` actualizado | ⏭️ |
| 7 | Validación arquitectura objetivo financiera | ⏭️ |

**Restricciones honradas:** sin ejecución de playbooks, sin infra cloud, sin Supabase Staging, sin migraciones nuevas, sin tocar producción. GATE 2 permanece **PENDIENTE**.

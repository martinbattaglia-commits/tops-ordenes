# TOPS NEXUS — Informe Definitivo de Consolidación Arquitectónica

> **Estado:** consolidación · **Fecha:** 2026-05-29
> Documento **capstone** de la fase de Consolidación Arquitectónica. Cierra los
> objetivos: (1) restaurar paridad código↔migraciones↔DB↔documentación,
> (2) resolver la divergencia `main` ↔ `wip/erp-consolidation` ↔ Supabase,
> (3) clasificar qué vive en `main`, qué permanece en branch, qué se elimina y
> qué es **Core ERP**, (4) incorporar CCTV como módulo nativo.
> **No** ejecuta migraciones, **no** fusiona ramas, **no** deploya: solo audita,
> consolida, documenta y propone.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md). Complementa
> [ERP-INFORME-EJECUTIVO-RIESGOS.md](./ERP-INFORME-EJECUTIVO-RIESGOS.md),
> [ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md),
> [ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md),
> [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) y
> [erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md).

---

## 0. TL;DR para dirección

La consolidación documental está **completa**. El ERP no estaba en riesgo de
operación, pero sí vivía en **tres planos que no coincidían**. Este informe deja
por escrito **la única foto canónica** de qué existe, dónde, y qué hacer con cada
cosa — **sin ejecutar** ninguno de esos cambios (eso requiere aprobación
explícita, fase por fase).

**Hallazgo de paridad más silencioso (y nuevo):** las migraciones
`0008`/`0009`/`0010` **no están en `main`**. La DB de producción corre con
`0008`/`0009` aplicadas (con datos), pero su SQL solo existe en
`wip/erp-consolidation`. Es decir: **producción no puede reconstruir su propio
schema desde su propia rama**. Es el riesgo de paridad #1 a saldar antes de
cualquier promoción.

---

## 1. Matriz de paridad (las 4 capas)

Verificado en esta sesión con `git ls-tree`, `git branch -vv`, lectura de los
docs de auditoría del 2026-05-29 y del código real de cada módulo. La capa **DB**
proviene del diagnóstico read-only documentado (no re-consultado hoy; ver §6).

| Artefacto | Código en `main` | Código en `wip` | Migración en `main` | Migración en `wip` | DB remota | Documentado | Paridad |
|-----------|:----------------:|:---------------:|:-------------------:|:------------------:|:---------:|:-----------:|:-------:|
| Core 0001–0007 (profiles/clients/orders/RLS) | ✅ | ✅ | ✅ | ✅ | ✅ aplicada | ✅ | ✅ **OK** |
| 0008 Compras/OC (vendors, purchase_orders, po_*) | ❌ | ✅ | ❌ | ✅ | ✅ **con datos** | ✅ | 🔴 **rota** (main sin SQL ni código) |
| 0009 RBAC (roles/permissions/role_permissions/user_roles) | ❌ | ✅ | ❌ | ✅ | ✅ con datos (`user_roles`=0) | ✅ | 🔴 **rota** (main sin SQL ni código) |
| 0010 Documents (`documents`) | ❌ | ✅ | ❌ | ✅ | ❌ **no aplicada** | ✅ | 🟠 desalineada |
| 0011 ARCA (customer_invoices, fiscal_config, …) | ✅ desplegado | ✅ | ✅ | ✅ | ❌ **no aplicada** | ✅ | 🟠 **invertida** (código adelante de la DB) |
| Módulos WIP (compras, cctv, anmat, comercial, documental, ejecutivo, operaciones, rbac UI, drive, whatsapp, ocr) | ❌ | ✅ | — | — | parcial | ✅ | 🟢 versionado (no en main) |
| Rediseño visual | ❌ | ❌ (`feature/ui-redesign`) | — | — | — | 🟡 | 🟢 preservado aparte |

**Lectura:** la paridad está rota en **tres sentidos**:
1. **DB adelante del código de `main`** (0008/0009 con datos, sin SQL en main).
2. **Código de `main` adelante de la DB** (0011 ARCA desplegado, tablas sin aplicar).
3. **Funcionalidad madura fuera de `main`** (todo el WIP estratégico en branch).

---

## 2. Divergencia `main` ↔ `wip` ↔ Supabase — plan de resolución (propuesta)

> **Regla:** este plan **no se ejecuta** en esta fase. Cada paso requiere
> aprobación explícita y respeta: no crear tablas, no migrar, no deployar, no
> fusionar hasta resolver duplicados.

| Paso | Acción propuesta | Toca | Reversible | Bloquea a |
|:----:|------------------|------|:----------:|-----------|
| P1 | **Llevar SQL 0008/0009/0010 a `main`** (solo archivos, sin re-aplicar; la DB ya los tiene salvo 0010) para restaurar paridad código↔DB de producción | repo `main` (vía merge controlado) | ✅ | toda promoción |
| P2 | **Resolver duplicados** `clientify.ts`↔`clientify/`, `google-drive.ts`↔`drive/`, conciliar `api/drive/ping`, ubicar `types.ts`↔`types-po.ts` | repo | ✅ | merge a `main` |
| P3 | **Gate de Facturación ARCA**: feature-flag de `/billing` + `/settings/fiscal` (no toca DB) **o** aplicar 0011 con confirmación | código (flag) o DB (0011) | ✅ flag / ⚠️ 0011 | runtime prod |
| P4 | **Poblar `user_roles`** (seed, no schema) mapeando los 6 usuarios al RBAC granular | DB (seed) | ✅ | gobernanza/SoD |
| P5 | **Promover Compras/OC a `main`** con tests (es lo más maduro y con datos reales) | repo + deploy | ✅ revert | Ejecutivo/BI |
| P6 | Recién entonces **migración 0012** (catálogos: cost_centers, plan de cuentas, tax_rates, tipos_cambio, fiscal_periods) con blindajes de inmutabilidad | DB (schema) | ⚠️ down-migration | Proveedores/Tesorería |

> **Secuencia de menor riesgo / mayor desbloqueo:** P1 + P2 (paridad y limpieza,
> solo repo) → P3 + P4 (baratos, reversibles, sacan ARCA roto de prod y activan
> RBAC) → P5 (promoción) → P6 (primera migración nueva). Detalle financiero en
> [erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) §9–10.

---

## 3. Clasificación definitiva

### 3.1 Qué debe vivir en `main` (producción)

Solo lo **estable, con paridad código↔DB, con tests, y sin duplicados**:

| Activo | Justificación | Prerrequisito para entrar |
|--------|---------------|---------------------------|
| Core OS (dashboard, clients, orders, reports, templates) | ya desplegado y sólido | — (ya está) |
| Facturación ARCA (código) | ya desplegado | resolver P3 (gate o aplicar 0011) |
| **SQL 0008/0009/0010** | paridad con DB productiva | P1 (merge controlado de archivos) |
| **Compras / OC + validación pública** | maduro, con datos reales en DB | P2 (duplicados) + P5 (tests) |
| **RBAC UI + `lib/rbac`** | gobierna acceso; habilita los 9 roles | P4 (seed) + tests |
| **Migración 0011 aplicada** (eventualmente) | activa Facturación real | cert X.509 en host + confirmación |

### 3.2 Qué debe permanecer en branch de trabajo

Hasta tener tests / decisión / dependencias resueltas:

| Activo | Branch | Por qué se queda |
|--------|--------|------------------|
| Ejecutivo/Cockpit + Operaciones/mapa | `wip/erp-consolidation` | depende de Compras; promover **después** de P5 |
| Documental | `wip/erp-consolidation` | requiere aplicar tabla `documents` (0010) primero |
| Integraciones (CCTV, Clientify, WhatsApp, Drive, OCR) | `wip/erp-consolidation` | valor medio, desacopladas; promover por lotes con tests |
| ANMAT (hoy mock) | `wip/erp-consolidation` | sin datos reales todavía; sin riesgo |
| Rediseño visual (53 archivos) | `feature/ui-redesign` | UX; preservado aparte hasta decisión de adopción |
| Estos 4 docs nuevos + los 5 previos | `docs/consolidacion-arquitectonica` / `wip` | documentación de consolidación, no producto |

### 3.3 Qué puede eliminarse

> **Eliminar = no promover / limpiar refs redundantes.** Nada se borra del
> historial; todo queda preservado en `origin`.

| Ítem | Acción | Motivo |
|------|--------|--------|
| `stash@{0}` (`ea295c9`, design-overhaul viejo, 21 archivos) | `git stash drop` **tras confirmar** | superseded por `feature/ui-redesign` |
| `lib/clientify.ts` **o** `lib/clientify/` | descartar **el perdedor** tras P2 | duplicado monolito vs modular |
| `lib/google-drive.ts` **o** `lib/drive/client.ts` | descartar el perdedor tras P2 | duplicado |
| Scripts `test-*.mjs` / diagnóstico | mantener en branch, **nunca** en runtime de prod | utilidades, no producto |

### 3.4 Módulos Core ERP (definición oficial)

**Core ERP** = módulos sin los cuales TOPS Nexus no puede reemplazar Neuralsoft;
gobiernan datos transaccionales y fiscales; máxima prioridad de paridad y tests.

| # | Módulo Core | Estado | Tablas núcleo |
|:-:|-------------|:------:|---------------|
| 1 | **CRM y Clientes** | ✅ core / 🟢 CRM en branch | `clients` (+ Clientify externo) |
| 2 | **Operaciones (OS/WMS/Transporte)** | ✅ desplegado | `orders`, `order_services`, `operators` |
| 3 | **Compras y Abastecimiento** | 🟢 branch, DB con datos | `vendors`, `purchase_orders`, `po_*`, `products` |
| 4 | **Documentos y Drive** | 🟢 branch (tabla `documents` sin aplicar) | `documents`, `attachments` |
| 5 | **Facturación ARCA** | ⚠️ código sí, tablas no | `customer_invoices`, `invoice_items`, `fiscal_config`, `puntos_venta`, `invoice_audit` |
| 6 | **Tesorería** | 🔵 futuro | (Fase 4) |
| 7 | **Cuentas Corrientes** | 🔵 futuro | (Fase 5) |
| 8 | **Centros de Costo** | 🔵 futuro | `cost_centers` (0012) |
| 9 | **ANMAT** | 🟢 branch (mock) | (compliance) |
| 10 | **CCTV y Monitoreo Operativo** | 🟢 branch (Fase 1 snapshots OK) | (sin tablas; ver [ERP-MODULO-CCTV.md](./ERP-MODULO-CCTV.md)) |

**Transversales (no módulos de feature, pero Core de plataforma):** RBAC/Seguridad
(`current_role()` + `roles`/`permissions`/`user_roles`), Auditoría
(`audit_log` + `*_audit`), Storage (buckets Supabase), Integraciones externas.

---

## 4. Estado de los objetivos de esta fase

| Objetivo | Entregable | Estado |
|----------|------------|:------:|
| 1. Restaurar paridad (documentar) | §1 matriz de paridad | ✅ documentado; ejecución en P1 (pendiente aprobación) |
| 2. Resolver divergencia (proponer) | §2 plan P1–P6 | ✅ propuesto; no ejecutado |
| 3. Informe definitivo (main/branch/eliminar/Core) | §3 | ✅ |
| 4. Incorporar CCTV como módulo nativo | [ERP-MODULO-CCTV.md](./ERP-MODULO-CCTV.md) + Core §3.4 + arquitectura maestra | ✅ |
| 5. Actualizar documentación arquitectónica (10 módulos) | [ERP-ARQUITECTURA-MAESTRA.md](./ERP-ARQUITECTURA-MAESTRA.md) | ✅ |
| 6. Roadmap 12 meses | [ERP-ROADMAP-12-MESES.md](./ERP-ROADMAP-12-MESES.md) | ✅ |

---

## 5. Riesgos vivos (heredados, sin resolver en esta fase por diseño)

| # | Riesgo | Severidad | Dónde se resuelve |
|:-:|--------|:---------:|-------------------|
| C1 | ARCA desplegado sin tablas (`/billing`, `/settings/fiscal` rotos en runtime) | 🔴 | P3 |
| C2 | Auditoría borrable por CASCADE (viola inmutabilidad) | 🟠 alto | migración 0012 (no ahora) |
| G3 | RBAC granular dormido (`user_roles`=0; RLS usa enum simple) | 🟠 | P4 |
| G6 | Duplicados clientify/drive/types sin resolver | 🟡 | P2 |
| **PARIDAD-1** | **SQL 0008/0009/0010 ausente en `main`** | 🟠 | P1 |

---

## 6. Honestidad de método (qué se verificó y qué no)

- ✅ **Verificado en esta sesión:** ramas, HEAD, archivos por rama (`git ls-tree`),
  migraciones en disco por rama, código real de CCTV (ISAPI Hikvision), contenido
  de los 5 docs de auditoría previos y del rector.
- ✅ **DB remota RE-VERIFICADA en vivo (2026-05-29):** auditoría read-only vía
  Supabase Management API (solo `SELECT`). Confirmado: `0001–0009` aplicadas
  (0006–0009 fuera del tracker), **`0010` y `0011` NO aplicadas**, RBAC dormido
  (`user_roles`=0; 7 roles/22 perms/64 mapeos), 5 buckets (sin `invoices`), 20 tablas
  reales. **Hallazgo nuevo:** tracker `schema_migrations` desincronizado (solo conoce
  0001–0005) → PARIDAD-3. Evidencia completa en
  [ERP-AUDITORIA-SUPABASE-2026-05-29.md](./ERP-AUDITORIA-SUPABASE-2026-05-29.md).
  Esta verificación **reemplaza** la advertencia previa de "no re-verificado".

---

## 7. Veredicto

La **Consolidación Arquitectónica está completa a nivel documental**: el ERP está
auditado, mapeado, su RBAC y arquitectura objetivo documentados, CCTV incorporado
como módulo nativo, los 10 módulos enumerados y un roadmap de 12 meses trazado.

**No se ejecutó** ninguna acción sobre producción, DB, migraciones o ramas. El
siguiente movimiento (cuando se apruebe) es **P1 + P2** (paridad y duplicados,
solo repo, reversibles), seguido de **P3 + P4** (gate ARCA + activar RBAC).

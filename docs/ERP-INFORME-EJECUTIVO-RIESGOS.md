# TOPS NEXUS — Informe Ejecutivo de Riesgos y Consolidación

> **Estado:** cierre de auditoría · **Fecha:** 2026-05-29
> Informe ejecutivo de la consolidación previa a la migración 0012. Sintetiza la
> auditoría (Fase 1), el mapa de módulos (Fase 2), el RBAC (Fase 3), la
> versionado de WIP (Fase 4) y el grafo de dependencias (Fase 5).
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md). **No** propone aplicar
> migraciones ni crear tablas: es el gate de decisión.

---

## Resumen para dirección (TL;DR)

El ERP **no estaba en riesgo de funcionamiento**, pero **sí de pérdida**: meses
de desarrollo estratégico (Compras, RBAC, Cockpit, integraciones) vivían **solo
en un disco**, sin versionar. **Eso ya se cerró**: todo el WIP crítico está hoy
preservado en `origin/wip/erp-consolidation` y el rediseño en
`origin/feature/ui-redesign`. Producción (`main`) quedó intacta.

Quedan **3 riesgos vivos** que decidir antes de seguir: (1) Facturación ARCA está
desplegada **sin sus tablas** (0011 sin aplicar); (2) el RBAC granular está
**dormido** (nadie asignado); (3) la auditoría es **borrable en cascada**. Ninguno
bloquea operar hoy, pero los tres deben resolverse antes de Tesorería.

---

## 1. Estado real del ERP (la foto honesta)

El ERP vive en **tres planos que no coinciden** (detalle en
[ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) §0):

| Plano | Qué tiene | Salud |
|-------|-----------|:-----:|
| **A — Código desplegado** (`main` → Netlify) | core OS (dashboard, clientes, órdenes, reportes, templates) + ARCA | ✅ sólido (ARCA roto en runtime) |
| **B — DB remoto** (Supabase `arsksytgdnzukbmfgkju`) | migraciones **0001–0009 aplicadas con datos**; **0010 y 0011 NO** | 🟡 adelantada al código en OC/RBAC, atrasada en ARCA |
| **C — WIP** (antes solo en disco) | Compras, RBAC UI, Cockpit, integraciones | 🟢 **ahora versionado en branch** |

**Datos reales en DB remota (read-only):** vendors=10, products=20, roles=7,
permissions=22, role_permissions=64, **user_roles=0**, profiles: admin=1,
operaciones=2, supervisor=3. Buckets: signatures, pdfs, attachments, po-pdfs,
po-signatures (no existe `invoices`).

**Módulos por estado** (detalle en ERP-MODULE-MAP §2–3):
- ✅ **Desplegados y estables:** Dashboard, Clientes, Órdenes (OS), Reportes, Templates.
- ⚠️ **Desplegado pero roto en runtime:** Facturación ARCA + Settings/fiscal (código sí, tablas 0011 no).
- 🟢 **Versionado en branch (antes en riesgo):** Compras/OC + validación pública, Proveedores, RBAC/roles UI, Ejecutivo/Cockpit, Operaciones/mapa, Documental, CCTV, Comercial/Clientify, Drive, WhatsApp, OCR, ANMAT.

---

## 2. Riesgos (panorama general)

| # | Riesgo | Prob. | Impacto | Estado |
|:-:|--------|:-----:|:-------:|:------:|
| G1 | WIP estratégico sin versionar (pérdida de disco) | — | — | ✅ **CERRADO** (Fase 4) |
| G2 | Facturación ARCA desplegada sin tablas (0011) | alta | medio | 🔴 vivo |
| G3 | RBAC granular dormido (`user_roles`=0; RLS usa enum) | cierta | medio | 🟠 vivo |
| G4 | Auditoría/comprobantes borrables por CASCADE | media | alto | 🟠 vivo |
| G5 | Bucket fiscal `invoices` sin scoping por cliente | media | alto | 🟡 latente (bucket no existe aún) |
| G6 | Duplicados sin resolver (clientify/drive/types) | alta | bajo | 🟡 vivo |
| G7 | DB adelantada al código (0008/0009) sin paridad de repo | — | — | ✅ mitigado (ya versionado) |
| G8 | Stash viejo `stash@{0}` redundante | baja | bajo | 🟢 menor |

---

## 3. Riesgos CRÍTICOS (los que deben decidirse ya)

**C1 — Facturación ARCA no operativa (G2).** El código de 0011 está desplegado y
referencia `customer_invoices`, `fiscal_config`, etc., pero esas tablas **no
existen** en la DB remota (verificado: *"Could not find the table
'public.fiscal_config'"* y *"column clients.condicion_iva does not exist"*).
**Consecuencia:** `/billing` y `/settings/fiscal` fallan en runtime. **No bloquea
el resto de la app.** Decisión requerida: aplicar 0011 (con confirmación) o
gatear las rutas hasta entonces.

**C2 — Auditoría borrable en cascada (G4).** `invoice_audit`, `po_events` y
`audit_log` son insert-only por RLS, **pero** un `DELETE` de la factura/OC padre
**arrastra la auditoría por CASCADE**. Esto viola la no-negociable de
**inmutabilidad documental** del charter. Decisión: `ON DELETE RESTRICT` +
trigger anti-borrado sobre comprobantes autorizados (es cambio de schema → entra
en 0012, no ahora).

> Estos dos son los únicos que tocan **integridad fiscal/legal**. El resto es
> deuda de gobernanza, no de cumplimiento.

---

## 4. Riesgos de PÉRDIDA DE INFORMACIÓN (el motivo de esta consolidación)

| Activo | Antes | Ahora |
|--------|-------|-------|
| SQL de 0008/0009 (tablas productivas **con datos**) | ❌ solo en disco | ✅ en `origin/wip/erp-consolidation` |
| Módulo Compras/OC (11 páginas + 10 libs + 6 componentes) | ❌ untracked | ✅ versionado |
| RBAC UI + `lib/rbac` | ❌ untracked | ✅ versionado |
| Cockpit/Ejecutivo + Operaciones/mapa | ❌ untracked | ✅ versionado |
| Integraciones (clientify, cctv, whatsapp, ocr, drive) | ❌ untracked | ✅ versionado |
| Rediseño visual (53 archivos) | ⚠️ branch solo local | ✅ en `origin/feature/ui-redesign` |
| `.env.local` (service_role, tokens) | 🔒 host only | 🔒 sigue gitignored (correcto) |

> **Riesgo de pérdida G1: cerrado.** Un fallo de disco hoy **ya no** borra meses
> de trabajo. Lo único que vive solo en disco a propósito es `.env.local`
> (secretos), que **no debe** versionarse.
>
> **Pérdida latente menor:** los **datos en producción** de 0008/0009 no tienen
> respaldo documentado fuera de Supabase. Recomendado: política de backup del
> proyecto Supabase (fuera del alcance de esta consolidación de código).

---

## 5. Módulos a PRESERVAR (versionar y mantener)

Todos ya preservados en `wip/erp-consolidation`. Prioridad de promoción futura a
`main` (cuando se decida, con tests):

1. **Compras / Proveedores / validación pública OC** — estratégico, con datos reales en DB. **Máxima prioridad.**
2. **RBAC / roles UI** — gobernanza; habilita los 9 roles objetivo.
3. **Ejecutivo / Cockpit + Operaciones/mapa** — BI; depende de Compras.
4. **Migraciones 0008/0009/0010** — paridad código↔DB.
5. **Documental** — falta aplicar tabla `documents` (0010).
6. **Integraciones** (Clientify, CCTV, WhatsApp, Drive, OCR) — valor medio, desacopladas.
7. **ANMAT** — compliance; hoy mock, sin riesgo.
8. **Rediseño visual** (`feature/ui-redesign`) — UX; preservado aparte.

---

## 6. Módulos a DESCARTAR / consolidar (no llevar a producción tal cual)

| Ítem | Acción | Motivo |
|------|--------|--------|
| `lib/clientify.ts` **o** `lib/clientify/` | elegir **uno** antes de merge | duplicado monolito vs modular |
| `lib/google-drive.ts` **o** `lib/drive/client.ts` | elegir uno | duplicado |
| `src/app/api/drive/ping/route.ts` (diff local) | conciliar diff | versión local vs main divergen |
| `stash@{0}` (`ea295c9`, design-overhaul viejo) | `git stash drop` tras confirmar | superseded por `feature/ui-redesign` |
| Scripts `test-*.mjs` | mantener en branch, **no** en runtime de prod | utilidades de diagnóstico, no producto |

> **Descartar = no promover a `main`**, no "borrar". Todo queda preservado en el
> branch. La resolución de duplicados es prerequisito de cualquier merge (regla
> no-negociable: no reintroducir lógica duplicada).

---

## 7. Roadmap técnico recomendado

**Secuencia segura (cada paso valida al anterior):**

1. **Gate de Facturación (C1).** Decidir: aplicar 0011 a la DB remota (con
   confirmación explícita) **o** gatear `/billing` y `/settings/fiscal` por
   feature-flag hasta tener cert ARCA. *Sin esto, ARCA es código muerto en prod.*
2. **Activar RBAC (G3).** Poblar `user_roles` para los 6 usuarios actuales
   (mapear `profiles.role` → rol granular). Es **seed**, no schema. Desbloquea SoD.
3. **Cubrir los 4 roles faltantes** (Facturación, Compras, Auditor, Super Admin
   vs Administración) vía seed en `roles`/`role_permissions` (tablas ya existen).
   Ver [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) §5.
4. **Resolver duplicados** (clientify/drive/types) y conciliar `drive/ping`.
   Prerequisito de cualquier merge a `main`.
5. **Promover Compras a `main`** (con tests) — es lo más maduro y con datos reales.
6. **Recién entonces: migración 0012** — Fase 3 financiera (`supplier_invoices`
   + `cost_centers`) **con** los blindajes de C2 incorporados (`ON DELETE
   RESTRICT` + trigger anti-borrado). Esto conecta OC → obligación de pago →
   habilita Tesorería (Fase 4).
7. **Tesorería → Cuentas Corrientes → Balance** (Fases 4–6), en ese orden, según
   la cadena lineal del grafo de dependencias.

---

## 8. Recomendación de siguiente paso (decisión única)

> **Antes de escribir una línea de la migración 0012**, ejecutar el paso 1 (gate
> de Facturación) y el paso 2 (poblar `user_roles`). Son los dos movimientos de
> **menor riesgo y mayor desbloqueo**: el #1 elimina el único módulo roto en
> producción; el #2 activa el RBAC ya sembrado sin tocar schema. Ambos son
> reversibles y no crean tablas.

**Checklist de validación previa a 0012 — estado:**

| Criterio (Fase 6) | Estado |
|-------------------|:------:|
| Todos los módulos versionados | ✅ (Fase 4) |
| Migraciones documentadas | ✅ (0008/0009/0010 versionadas + ERP-MODULE-MAP) |
| Sin dependencias ocultas | ✅ (Fase 5 — grafo explícito) |
| Sin módulos solo locales | ✅ (todo en `origin`) |
| Riesgos fiscales identificados | ✅ (C1, C2) |
| Decisión de gate Facturación tomada | ⏳ **pendiente del usuario** |
| `user_roles` poblado | ⏳ pendiente |

**Veredicto:** la **consolidación está completa**. El ERP está auditado,
mapeado, su RBAC documentado, su WIP preservado y sus dependencias trazadas.
**Se puede avanzar a la decisión de implementación** (Proveedores → 0012 →
Tesorería → Cuentas Corrientes), pero **recomiendo resolver C1 y G3 primero**
porque son baratos, reversibles y desbloquean todo lo demás.

---

**Entregables de esta consolidación:**
[ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) ·
[ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md) ·
[RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) ·
[erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) ·
este informe. Preservados en `origin/wip/erp-consolidation`.

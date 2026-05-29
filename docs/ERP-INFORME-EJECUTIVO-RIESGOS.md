# TOPS NEXUS — Informe Ejecutivo de Riesgos y Consolidación

> **Estado:** cierre de auditoría · **Fecha:** 2026-05-29 · **Revisión FASE 3**
> Informe ejecutivo de la consolidación previa a la migración 0012. Sintetiza la
> auditoría de repositorio, el mapa de módulos, el RBAC + su versionado, y el
> grafo de dependencias.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md). Base de evidencia:
> [ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md).
> **No** propone aplicar migraciones ni crear tablas: es el gate de decisión.
>
> **Corrección FASE 3 (importante).** Versiones previas describían *"tres planos
> que no coinciden"* y *"WIP solo en disco / untracked"*. Eso quedó **obsoleto**:
> todo `src/` y las 11 migraciones (0001–0011) están **trackeadas** en
> `feature/documents-enterprise-ready` (HEAD `2326559`, +12/−2 vs `main`). El
> riesgo de pérdida de disco (G1) está **cerrado**. El único gap real es
> **Migraciones↔DB**: 0010 (documents) y 0011 (ARCA) versionadas pero **no
> aplicadas**. El framing de abajo se reescribió a esa realidad verificada.

---

## Resumen para dirección (TL;DR)

El ERP **no está en riesgo de funcionamiento ni de pérdida**: todo el desarrollo
estratégico (Compras, RBAC, Cockpit, integraciones, Documental) está **trackeado
y versionado** en `feature/documents-enterprise-ready`. El riesgo histórico de
"código solo en disco" (G1) está **cerrado**. Producción (`main`) está intacta.

Quedan **4 riesgos vivos** que decidir antes de seguir: (1) Facturación ARCA está
desplegada **sin sus tablas** (0011 sin aplicar); (2) el RBAC granular está
**dormido** (nadie asignado); (3) la auditoría es **borrable en cascada**; (4) los
cambios de autorización RBAC **no se versionan** (sin `rbac_audit`, ver
[RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) §8). Ninguno bloquea operar hoy,
pero los cuatro deben resolverse antes de Tesorería.

---

## 1. Estado real del ERP (la foto honesta)

El ERP vive en **dos planos** (detalle en
[ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) §0). El plano de Código es coherente; el
único desfase es Código↔DB en 2 migraciones:

| Plano | Qué tiene | Salud |
|-------|-----------|:-----:|
| **Código** (`feature/documents-enterprise-ready`, todo trackeado) | core OS + Compras/OC + RBAC UI + Cockpit + integraciones + Documental + ARCA | ✅ coherente |
| **DB remoto** (Supabase `arsksytgdnzukbmfgkju`) | migraciones **0001–0009 aplicadas con datos**; **0010 y 0011 NO aplicadas** | ⚠️ gap de 2 migraciones (documents + ARCA) |

**Datos reales en DB remota (read-only, SELECT-only):** vendors=10, products=20,
roles=7, **permissions=22 en DB** (catálogo objetivo **24**: 0010 suma 2 sin
aplicar), role_permissions=64, **user_roles=0**, profiles: admin=1, operaciones=2,
supervisor=3. Buckets: signatures, pdfs, attachments, po-pdfs, po-signatures
(**no** existen `documents` ni `invoices` — dependen de 0010/0011).

**Módulos por estado** (detalle en ERP-MODULE-MAP §2–3):
- ✅ **Desplegados y estables (9):** Dashboard, Clientes, Órdenes (OS), Reportes, Compras (OC), Comercial, CCTV, Settings/users, Drive.
- 🟡 **WIP bloqueado por migración (3):** Facturación ARCA + Settings/fiscal (tablas 0011 no aplicadas), Documental (tabla `documents` 0010 no aplicada).
- 🟠 **Demo-only por diseño (3):** ANMAT, Operaciones/mapa, Templates.

> **Restricción de infraestructura vigente (FASE 3):** sin Docker ni `psql`, CLI
> linkeada a producción → aplicar 0010/0011 está **bloqueado** y diferido a
> GATE 2/3 en staging aislado. **GATE 2 PENDIENTE.** Consecuencia única: las
> rutas que consultan tablas de 0010/0011 fallan en runtime (mitigado por guards
> `isMock()`); no afecta al resto de la app.

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
| G7 | DB adelantada al código (0008/0009) sin paridad de repo | — | — | ✅ **CERRADO** (0008/0009/0010 en `main` `b82a5f2`; tracker `0001–0009`) |
| G8 | Stash viejo `stash@{0}` redundante | baja | bajo | 🟢 menor |
| G9 | **Cambios de autorización RBAC sin versionar** (`profiles.role` se pisa; sin `rbac_audit` ni triggers) | cierta | medio | 🟠 vivo (diseño en RBAC §8) |

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
> **Nota FASE 3 (branch consolidado):** la tabla anterior es el **registro
> histórico** del cierre de G1. Hoy todo ese trabajo está consolidado en
> `feature/documents-enterprise-ready` (que incluye Documental + las 11
> migraciones); `wip/erp-consolidation` y `feature/ui-redesign` se conservan como
> ramas previas en `origin`.
>
> **Pérdida latente menor:** los **datos en producción** de 0008/0009 no tienen
> respaldo documentado fuera de Supabase. Recomendado: política de backup del
> proyecto Supabase (fuera del alcance de esta consolidación de código).

---

## 5. Módulos a PRESERVAR (versionar y mantener)

Todos ya preservados y trackeados en `feature/documents-enterprise-ready`.
Prioridad de promoción futura a `main` (cuando se decida, con tests):

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

> **Re-priorización post FASE 1.5 (2026-05-29):** completada la PARIDAD (FASE 1), la
> prioridad estratégica del charter ordena la secuencia funcional así:
> **Módulo Documents (`0010`) → ARCA (`0011`) → Proveedores (`0012`)**. El paso de
> Documents adelanta a Proveedores; ARCA no avanza hasta cerrar Documents. La FASE 2
> es **solo diagnóstico/arquitectura/plan** del Módulo Documents (sin aplicar `0010`).

**Secuencia segura (cada paso valida al anterior):**

1. **Gate de Facturación (C1).** Decidir: aplicar 0011 a la DB remota (con
   confirmación explícita) **o** gatear `/billing` y `/settings/fiscal` por
   feature-flag hasta tener cert ARCA. *Sin esto, ARCA es código muerto en prod.*
2. **Activar RBAC (G3).** Poblar `user_roles` para los 6 usuarios actuales
   (mapear `profiles.role` → rol granular). Es **seed**, no schema. Desbloquea SoD.
3. **Cubrir los 4 roles faltantes** (Facturación, Compras, Auditor, Super Admin
   vs Administración) vía seed en `roles`/`role_permissions` (tablas ya existen).
   Ver [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) §5.
   **Versionar RBAC (G9)** en el mismo paquete: tabla `rbac_audit` append-only +
   triggers + server actions auditados (diseño en RBAC §8). Va atado a 0012 — no
   tiene sentido auditar tablas hoy vacías.
4. **Resolver duplicados** (clientify/drive/types) y conciliar `drive/ping`.
   Prerequisito de cualquier merge a `main`.
5. **FASE 2 — Módulo Documents (`0010`):** diagnóstico/arquitectura/riesgos/plan de
   aplicación de la tabla `documents` (SQL ya en `main`, NO aplicado). Sin `db push`,
   con backup (RP6) + idempotencia endurecida como pre-requisitos. **Es el próximo paso.**
6. **ARCA (`0011`):** aplicar tras cerrar Documents (gate de Facturación C1 + cert X.509).
7. **Recién entonces: migración 0012** — Fase 3 financiera (`supplier_invoices`
   + `cost_centers`) **con** los blindajes de C2 incorporados (`ON DELETE
   RESTRICT` + trigger anti-borrado). Esto conecta OC → obligación de pago →
   habilita Tesorería (Fase 4).
8. **Tesorería → Cuentas Corrientes → Balance** (Fases 4–6), en ese orden, según
   la cadena lineal del grafo de dependencias.

---

## 8. Recomendación de siguiente paso (decisión única)

> **Antes de avanzar a las migraciones financieras (`0011`/`0012`)**, ejecutar el
> paso 1 (gate de Facturación) y el paso 2 (poblar `user_roles`). Son los dos
> movimientos de **menor riesgo y mayor desbloqueo**: el #1 elimina el único módulo
> roto en producción; el #2 activa el RBAC ya sembrado sin tocar schema. Ambos son
> reversibles y no crean tablas. El paso funcional inmediato es **FASE 2 — Documents (`0010`)**.

**Checklist de validación previa a 0012 — estado:**

| Criterio (Fase 6) | Estado |
|-------------------|:------:|
| Todos los módulos versionados | ✅ (Fase 4) |
| Migraciones documentadas | ✅ (0008/0009/0010 versionadas + ERP-MODULE-MAP) |
| Sin dependencias ocultas | ✅ (Fase 5 — grafo explícito) |
| Sin módulos solo locales | ✅ (todo en `origin`) |
| Riesgos fiscales identificados | ✅ (C1, C2) |
| Versionado de RBAC diseñado (G9) | ✅ (RBAC §8 — diseño, sin aplicar) |
| Decisión de gate Facturación tomada | ⏳ **pendiente del usuario** |
| `user_roles` poblado | ⏳ pendiente |
| GATE 2 (staging 0010) | ⏳ **PENDIENTE** (bloqueo de infraestructura) |

**Veredicto:** la **consolidación está completa** y, tras FASE 1, la **paridad
Código↔Migraciones↔Tracker quedó cerrada** (`0001–0009`). El ERP está auditado,
mapeado, su RBAC documentado, su WIP preservado y sus dependencias trazadas.
**El próximo paso es FASE 2 — Módulo Documents (`0010`)** (diagnóstico/arquitectura/plan,
sin aplicar), seguido de ARCA (`0011`) y luego Proveedores (`0012`). **Recomiendo
resolver C1 y G3 primero** porque son baratos, reversibles y desbloquean lo demás.

---

**Entregables de esta consolidación:**
[ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) ·
[ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md) ·
[RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) ·
[erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) ·
este informe. Preservados en `origin/wip/erp-consolidation`.

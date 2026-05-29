# FASE 1.5 — Consolidación Documental Final

> **Estado:** ✅ completada · **Fecha:** 2026-05-29 · **Modo:** CTO / Governance-first
> **Autorización:** "AUTORIZACIÓN FASE 1.5 · Consolidación Documental Final" — auditoría
> documental + consolidación + referencias cruzadas + informe final. **Sin** ejecutar
> migraciones, `db push`, `migration repair`, ni modificar Supabase/producción.
> **Naturaleza:** documentación-only. Todo el trabajo vive en la rama
> `docs/consolidacion-arquitectonica`. **No** hay merge a `main` autorizado en esta fase.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md).

---

## 0. Objetivo y alcance

Lograr **paridad total** entre las cuatro fuentes de verdad —
**Código ↔ Migraciones ↔ Base de Datos ↔ Documentación** — tras el cierre de FASE 1
(PARIDAD-1/2/3). Esta fase **no toca el sistema**: solo alinea la documentación rectora
y satélite con la **realidad auditada en vivo** el 2026-05-29, e incorpora referencias
cruzadas entre auditorías, roadmap, arquitectura y gobernanza.

---

## 1. Diagnóstico (estado real verificado — baseline 2026-05-29)

Confirmado en vivo vía Supabase Management API (solo `SELECT`) + `git`:

| Dimensión | Estado real verificado |
|-----------|------------------------|
| **Migraciones (disco)** | `0001`–`0011` presentes. |
| **Migraciones en `main`** | `0001`–`0011` (SQL de `0008`/`0009`/`0010` mergeado en FASE 1, HEAD `b82a5f2`). |
| **Tracker `schema_migrations`** | `0001`–`0009` (reconciliado vía `migration repair`, GATE B). `0010`/`0011` **no registradas**. |
| **DB — tablas públicas** | **20**. `0008`/`0009` aplicadas con datos. |
| **DB — Documents (`0010`)** | **NO aplicada** — `documents` ausente, `document_type_t` ausente. |
| **DB — ARCA (`0011`)** | **NO aplicada** — `customer_invoices`, `invoice_items`, `fiscal_config`, `puntos_venta`, `invoice_audit` ausentes. |
| **RBAC granular** | **Presente pero inactivo** — 7 roles / 22 permisos / 64 mapeos / `user_roles` = **0**. RLS usa el enum `user_role_t` (4 valores). |
| **Storage buckets** | **5** — `signatures`, `pdfs`, `attachments`, `po-pdfs`, `po-signatures`. (`invoices` fiscal NO existe.) |
| **CCTV** | **Implementado y nativo** — Hikvision ISAPI, Snapshot API, Dashboard CCTV, NVR Hikvision ERI-K216-P16. |
| **Deploy** | `main` `b82a5f2` → Netlify verde. `/login` 200 · `/` 307. |

### Hallazgo documental
Antes de FASE 1.5, **9 documentos** afirmaban estados ya superados por FASE 1
(0008/0009/0010 "solo en `wip`", tracker "solo conoce 0001–0005", main HEAD `a4b24e5`,
GATE A "pendiente", roadmap saltando Documents). Ninguna afirmación describía un riesgo
de datos; eran **desfases de narrativa** respecto a la realidad auditada.

---

## 2. Qué fue corregido

| Documento | Corrección aplicada |
|-----------|---------------------|
| **TOPS-NEXUS-ERP.md** (rector) | §5 tracker reconciliado (`0001–0009`, PARIDAD-3 cerrada) + PARIDAD-1 cerrada (`b82a5f2`) + `db push` ahora más peligroso; §6 ARCA marcada 🟡 "código completo, NO operativo" (0011 sin aplicar); §7 próximo incremento = **FASE 2 Documents (`0010`)**, Proveedores diferido; §9 links a FASE1 y FASE1.5. |
| **ERP-FASE1-PARIDAD.md** | Estado → ✅ completada; PARIDAD-1 → CERRADO; GATE A/B → EJECUTADOS; impacto/§7.5/§1-conclusión actualizados al nuevo modo de falla de `db push`; **nuevo §8** con registro completo de ejecución de GATE A (pre-check, merge `b82a5f2`, auditoría posterior, rollback). |
| **ERP-MODULE-MAP.md** | Banner de cierre + diagrama "estado vigente post FASE 1"; consecuencias 1 y 3 marcadas MITIGADAS; main HEAD `a4b24e5` → `b82a5f2`. |
| **ERP-DEPENDENCY-GRAPH.md** | Orden de aplicación actualizado: tracker `0001–0009`, `0008/0009/0010` en `main`; advertencia reforzada de `db push`. |
| **ERP-FASE0-GOBERNANZA-DB.md** | Banner de cierre posterior (PARIDAD-1/3 resueltas; el cuerpo es diagnóstico histórico). |
| **ERP-AUDITORIA-SUPABASE-2026-05-29.md** | Banner "snapshot histórico" (tracker/main corregidos el mismo día; el esquema físico descrito sigue vigente). |
| **ERP-INFORME-EJECUTIVO-RIESGOS.md** | G7 → CERRADO; banner FASE 1; §7 re-priorizado (**Documents `0010` → ARCA `0011` → Proveedores `0012`**); veredicto/§8 actualizados. |
| **ERP-ROADMAP-12-MESES.md** | I1 + I7 → ✅ HECHO; **nuevo I7b** (FASE 2 Documents `0010`, diagnóstico); I8 (ARCA) depende de I7b; hito Q1 actualizado. |
| **ERP-CONSOLIDACION-DEFINITIVA.md** | Banner de cierre; matriz §1 (SQL 0008/0009/0010 en `main`); §2 P1 → EJECUTADO; §5 PARIDAD-1 → CERRADO; §6 cierre posterior; §7 veredicto = FASE 2 Documents. |
| **migracion-0011-arca-revision.md** | Corrección factual: `current_role()` se **crea en `0001`** y se **endurece en `0005`**; `0009_rbac` solo la usa (verificado en el SQL). |

**Sin contradicciones (no requirieron cambios):** ERP-ARQUITECTURA-MAESTRA.md,
ERP-MODULO-CCTV.md, RBAC-ARCHITECTURE.md, erp-arquitectura-objetivo.md (ya alineados con
la realidad auditada — la corrección de PARIDAD-2 de este último se aplicó en una fase previa).

---

## 3. Qué permanece pendiente

| Pendiente | Naturaleza | Gate requerido |
|-----------|-----------|----------------|
| **Aplicar `0010` (Documents)** | Migración DDL en DB | FASE 2+ con backup (RP6) + idempotencia endurecida + aprobación explícita. **Solo diagnóstico en FASE 2.** |
| **Aplicar `0011` (ARCA)** | Migración DDL + cert X.509 | Tras cerrar Documents. Gate de Facturación (C1) + cert en host. |
| **Activar RBAC granular** | Seed `user_roles` (no schema) | Decisión de gobernanza; reversible. |
| **Promover código de módulos a `main`** | Compras/Ejecutivo/Operaciones/etc. (hoy en `wip/erp-consolidation`) | Resolver duplicados (clientify/drive/types) + tests. |
| **Merge `docs/consolidacion-arquitectonica` → `main`** | Documentación | **Gate futuro** — FASE 1.5 no autoriza merge a `main`; los docs corregidos viven en la rama. |

---

## 4. Riesgos abiertos

| # | Riesgo | Severidad | Estado |
|:-:|--------|:---------:|--------|
| G2 / C1 | ARCA (`0011`) desplegado en código pero **sin tablas** → `/billing` y `/settings/fiscal` fallan en runtime | 🔴 | vivo (mitiga: feature-flag o aplicar 0011 con cert) |
| **RP-DBPUSH** | Con el tracker en `0001–0009`, un `supabase db push` **aplicaría `0010`/`0011` como DDL real** (antes fallaba en `0006`) | 🔴 | **vivo — prohibición de `db push` MÁS crítica que antes** |
| RP-IDEMP | `0008`–`0011` usan `create type ... as enum` **sin guard** → re-ejecución rompe con `type already exists` | 🟠 | vivo (endurecer antes de aplicar 0010/0011) |
| G3 | RBAC granular dormido (`user_roles` = 0; RLS usa enum simple) | 🟠 | vivo |
| G4 / C2 | Auditoría/comprobantes borrables por CASCADE (viola inmutabilidad) | 🟠 | a blindar en migración financiera (0012) |
| RP-DOCMERGE | Docs corregidos viven solo en `docs/consolidacion-arquitectonica`; `main` aún muestra la narrativa previa | 🟡 | latente (resolver con gate de merge de docs) |
| G6 | Duplicados clientify/drive/types sin resolver | 🟡 | vivo (prerequisito de merge de código) |

---

## 5. Impacto

- **Positivo:** la documentación deja de contradecir la realidad auditada. Cualquier
  decisión futura (aplicar `0010`/`0011`, activar RBAC, promover módulos) parte de una
  **foto canónica honesta** y consistente entre rector y satélites.
- **Trazabilidad:** se añadieron referencias cruzadas (FASE0 ↔ FASE1 ↔ FASE1.5 ↔ auditoría
  ↔ roadmap ↔ consolidación), de modo que cada afirmación de estado es rastreable a su
  evidencia.
- **Cero impacto en sistema:** no se tocó código de aplicación, migraciones, DB, datos,
  auth, storage ni `main`. Solo archivos `.md` en la rama de docs.

---

## 6. Plan (siguiente fase)

**FASE 2 — Módulo Documents (`0010`):** únicamente **diagnóstico, arquitectura, riesgos y
plan de implementación**. NO ejecutar la migración, NO `db push`. Pre-requisitos a dejar
documentados: backup externo/restore point (RP6), endurecimiento de idempotencia
(`create type ... if not exists` / guards), y revisión de RLS/dependencias (`current_role()`
de 0001/0005, `profiles.client_id`). **ARCA (`0011`) no avanza hasta cerrar Documents.**
Proveedores (`0012`) queda diferido detrás de Documents y ARCA.

---

## 7. Rollback

FASE 1.5 es documentación-only sobre `docs/consolidacion-arquitectonica`. Rollback trivial:
`git revert <commit>` o descartar la rama. **No** hay efecto sobre `main`, DB, datos ni deploy.

---

## 8. Recomendación profesional

1. **Aceptar la consolidación documental** como base canónica.
2. **Programar un gate de merge de docs → `main`** (futuro) para que la narrativa de `main`
   también refleje la realidad. Es aditivo y reversible (solo `.md`).
3. **Iniciar FASE 2 (Documents `0010`)** en modo diagnóstico/plan, con `db push` prohibido
   y RP6 + idempotencia como pre-requisitos explícitos antes de cualquier aplicación.
4. **Mantener vivas** las alertas G2/C1 (ARCA roto en runtime) y RP-DBPUSH hasta su cierre.

---

## 9. Conclusión — ¿Quedó todo alineado?

> **SÍ — la paridad documental es total para el rango `0001`–`0009`.**
>
> - **Código** (`main` `b82a5f2`): contiene el SQL de `0001`–`0011`. ✅
> - **Migraciones** (disco): `0001`–`0011`, idénticas a `main`. ✅
> - **Base de Datos** (Supabase): `0001`–`0009` aplicadas y registradas en el tracker;
>   `0010`/`0011` **versionadas pero NO aplicadas** (estado conocido y documentado). ✅
> - **Documentación**: rector + 9 satélites alineados con la realidad auditada, con
>   referencias cruzadas y banners de cierre donde corresponde. ✅
>
> La **única divergencia restante es intencional y documentada**: `0010`/`0011` existen en
> código/migraciones pero no en la DB. No es una inconsistencia oculta, es el límite
> explícito antes de FASE 2.

**Módulos autorizados para la siguiente fase (FASE 2):**
- ✅ **Módulo Documents (`0010`)** — *solo* diagnóstico, arquitectura, riesgos y plan. **Sin ejecutar.**

**Explícitamente NO autorizados todavía:** aplicar `0010`/`0011`, `db push`, activar
Documents/ARCA/RBAC, Proveedores (`0012`), merge de docs a `main` — cada uno requiere su
propio gate.

---

**Documentos consolidados en esta fase:**
[TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md) ·
[ERP-FASE0-GOBERNANZA-DB.md](./ERP-FASE0-GOBERNANZA-DB.md) ·
[ERP-FASE1-PARIDAD.md](./ERP-FASE1-PARIDAD.md) ·
[ERP-AUDITORIA-SUPABASE-2026-05-29.md](./ERP-AUDITORIA-SUPABASE-2026-05-29.md) ·
[ERP-CONSOLIDACION-DEFINITIVA.md](./ERP-CONSOLIDACION-DEFINITIVA.md) ·
[ERP-MODULE-MAP.md](./ERP-MODULE-MAP.md) ·
[ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md) ·
[ERP-INFORME-EJECUTIVO-RIESGOS.md](./ERP-INFORME-EJECUTIVO-RIESGOS.md) ·
[ERP-ROADMAP-12-MESES.md](./ERP-ROADMAP-12-MESES.md) ·
[migracion-0011-arca-revision.md](./migracion-0011-arca-revision.md)

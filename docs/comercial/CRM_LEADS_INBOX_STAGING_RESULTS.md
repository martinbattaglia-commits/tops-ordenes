# CRM_LEADS_INBOX_STAGING_RESULTS — F2.2-3 · Evidencia

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Entorno:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`**
**Harness:** `scripts/f223-leads-staging.mjs` · Build: `npm run build`

## Resultado

> ## ✅ GO — 7/7 PASS (DB) · tsc ✅ · lint ✅ · build ✅
> `0049` aplicada. Soporte DB de la bandeja (helper + reasignación + calificación + RLS) validado contra staging. ROLLBACK — sin residuos.

---

## 1. Compilación

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` (page, view, leads-data/supabase, lead-actions, crm-types) | ✅ sin warnings |
| `npm run build` | ✅ `Compiled successfully` · `ƒ /comercial/leads` 3.53 kB · 94.3 kB First Load |

---

## 2. QA — soporte DB (7/7 PASS, staging, BEGIN…ROLLBACK)

| # | Escenario | Resultado | Detalle |
|---|---|---|---|
| 1 | `crm_list_commercial_users` → comerciales activos (U1,U2; excluye sin-rol) | ✅ PASS | ids=2 |
| 2 | Helper PII-safe (solo `id` + `full_name`, sin email) | ✅ PASS | cols=id,full_name |
| 3 | `reassignLead`: UPDATE owner bajo RLS `comercial.edit` | ✅ PASS | rows=1 owner=U2 |
| 4 | `setLeadStatus`: nuevo→contactado→calificado | ✅ PASS | status=calificado |
| 5 | Guard: lead `promovido` no se modifica (neq) | ✅ PASS | 0 filas, sigue promovido |
| 6 | RLS: usuario sin `comercial.edit` → UPDATE bloqueado | ✅ PASS | 0 filas, sin fuga |
| 7 | Owner resolution vía `profiles_public` (sin email) | ✅ PASS | name=Aldo Comercial |

**TOTAL 7 · PASS 7 · FAIL 0.**

---

## 3. Método y limitación honesta

- **Cubierto:** las operaciones de base que ejecutan las server actions (`reassignLead`/`setLeadStatus`) se ejercitan vía `pg` impersonando comercial (mismas sentencias + RLS), el helper `0049`, los guards y la resolución PII-safe del owner. Build confirma que página + vista + acciones compilan y bundlean.
- **No ejercitado por navegador:** el render interactivo de `/comercial/leads` no se prueba contra staging — la ruta está protegida por auth (redirige a `/login`) y el runtime local apunta a **Supabase PROD** (sin `crm_*`/0049). Sin credenciales reales (criterio de seguridad). La verificación visual corresponde a un entorno autenticado con `crm_*`.
- **No destructivo:** `BEGIN…ROLLBACK`; fixtures (3 usuarios, 1 lead) no persisten.

---

## 4. Estado de producción

- **PROD / `main` / Netlify / Clientify PROD:** intactos.
- **Staging:** `0049` aplicada (función additiva PII-safe). Sin datos de prueba (rollback).

> **F2.2-3 GO.** Bandeja construida y validada. Próximo: F2.2-4 (promoción) o F2.2-5 (pull), **previa aprobación**.

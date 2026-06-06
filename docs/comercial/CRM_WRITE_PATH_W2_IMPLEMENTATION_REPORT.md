# CRM_WRITE_PATH_W2_IMPLEMENTATION_REPORT — W-2 · Server Actions

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** Write-Path (F2.1-8) · **Paso W-2** — server actions que envuelven las RPC de W-1
**Fuente de diseño:** `CRM_WRITE_PATH_ARCHITECTURE.md §6` · base RPC: `CRM_WRITE_PATH_IMPLEMENTATION_REPORT.md` (W-1)
**Estado:** ✅ **implementado y QA verde** — tsc/lint + 9/9 contrato en staging + integración de capacidad verificada

> Solo capa de aplicación (TypeScript). **No** se modificó la base, ni `0047`, ni RLS/RBAC. Producción, `main`, Netlify, Clientify y el Dashboard Corporativo: intactos (este último se consume vía revalidación, no se toca).

---

## 1. Entregable

`src/lib/comercial/stage-actions.ts` — módulo `"use server"` con 4 acciones. Patrón espejo de `capture-actions.ts`: `createClient()` de **sesión de usuario** (RLS aplica, `auth.uid()` puebla el ledger), resultado tipado `ActionResult`, resiliente si Supabase no está configurado o las tablas no existen (degrada suave en runtime contra PROD).

### 1.1 Acciones y firmas

```ts
type ActionResult =
  | { ok: true;  message: string; opportunity?: OpportunitySnapshot }
  | { ok: false; message: string };

advanceStage(opportunityId, toStage, note?)        → rpc crm_advance_stage
reserveCapacity(opportunityId, { site, units, m2? }) → motor + rpc crm_reserve_capacity
completeOnboarding(opportunityId, note?)           → rpc crm_complete_onboarding
updateOpportunityFields(opportunityId, patch)      → UPDATE directo (lista blanca)
```

`OpportunitySnapshot = { id, estado, committedState, assignedSite }` — proyección liviana de la fila devuelta por la RPC, para que la UI (W-3) refresque badges sin otra consulta.

### 1.2 Integración con el Capacity Engine (lo nuevo de W-2)
`reserveCapacity`:
1. Lee `service_type` + `m2` de la oportunidad (bajo RLS) → mapea a `CapacityCategory` (`anmat/general/oficina`).
2. Calcula el **presupuesto físico** con el motor puro: `getCommittedSnapshot()` + `findAvailability({ category, m2, siteCode, basis: 'proyectada' })`. La base **proyectada** (− comprometido − reservado) es la más conservadora → evita sobre-reservar.
3. Pasa ese número como `p_available_m2` a `crm_reserve_capacity`, que hace el **chequeo atómico final** dentro de la transacción (evita TOCTOU). El baseline físico vive en los modelos TS del Digital Twin, no en Postgres — por eso se calcula en la action, como define `0047 §reserve` y la arquitectura §4.1.

> Verificado: ANMAT@Luján proyectado = **401 m²** (factible 100 ✓), General@Magaldi = **0 m²** (factible 500 ✗, CG ocupado), tope 999.999 ✗. Cifras coherentes con la auditoría de capacidad.

### 1.3 `updateOpportunityFields` — lista blanca
Edita solo campos de negocio: `contacto, email, telefono, cuit, m2, monto, probabilidad, currency, expectedClose, deposito`. **Nunca** `estado`, `committed_state`, `assigned_site`, ids ni owner (esos solo cambian por las RPC). Valida `probabilidad ∈ [0,100]` y rechaza patch vacío. Mapea camelCase → columna por un `FIELD_MAP` explícito; cualquier clave fuera del mapa se ignora.

### 1.4 Revalidación → Dashboard automático
Tras cada escritura exitosa: `revalidatePath` de `/comercial/oportunidades/{id}`, `/comercial/oportunidades`, `/comercial/dashboard-vacancia` y `/comercial/pipeline`. Como el dashboard es `force-dynamic`, al navegar recalcula `getCommittedSnapshot()` → refleja la vacancia comercial/proyectada resultante. Cierra el lazo F2.1-4 ↔ CRM (la activación efectiva ocurre cuando la UI W-3 invoque las actions).

### 1.5 Errores legibles
`humanizeRpcError()` traduce los códigos de `0047` (`INVALID_TRANSITION`, `GANADO_REQUIRES_CAPACITY`, `INSUFFICIENT_CAPACITY`, `ONBOARDING_*`, `OPP_NOT_FOUND`, …) a mensajes de UI en español.

---

## 2. Integridad / no-duplicación

- **No reimplementa lógica de dominio:** la atomicidad, la máquina de estados, el bloqueo duro (D-2) y la derivación de `committed_state` viven en las RPC de W-1. Las actions solo orquestan (leer → calcular presupuesto → invocar RPC → revalidar).
- **Sesión de usuario, no service-role:** se reusa `createClient()`; `createAdminClient()` no se usa. RLS (R-G2) sigue gobernando.
- **Motor consumido, no modificado:** `findAvailability`/`getCommittedSnapshot` se usan tal cual.

---

## 3. QA (resumen — detalle en `CRM_WRITE_PATH_W2_QA_RESULTS.md`)

| Capa | Método | Resultado |
|---|---|---|
| Tipos/compilación | `npx tsc --noEmit` | ✅ verde |
| Lint | `npx next lint --file …/stage-actions.ts` | ✅ sin warnings |
| Integración capacidad | `findAvailability` (motor real) → presupuestos | ✅ 401 / 0 / tope |
| Contrato action↔RPC | `scripts/qa-w2-staging.mjs` (pg, tx+rollback, **named args**) | ✅ 9/9 |

**Por qué un harness y no test directo de las actions:** una server action `"use server"` usa `cookies()`/`revalidatePath()` y no se puede ejecutar fuera del runtime de Next; además staging no tiene claves supabase-js (solo `pg` crudo). El harness ejercita, vía `pg`, **las mismas operaciones de base con los mismos nombres de parámetro** que las actions invocan (`p_opp/p_to/p_site/p_units/p_available_m2/p_note`), bloqueando el contrato action↔función y la exposición PostgREST (grants a `authenticated`). La lógica transaccional ya se validó en W-1 (29/29).

---

## 4. Frontera del paso (lo que W-2 NO incluye)

- ❌ Wiring en `Opportunity360View.tsx` (botones → actions, `useTransition`, `lost_reason`) → **W-3**.
- ❌ Selector de unidades por sede en la UI → W-3.
- ❌ Producción, `main`, Netlify, Clientify, Dashboard Corporativo: intactos.

> **W-2 cerrado.** Listo para W-3 (wiring de la Ficha 360°) **previa aprobación**.

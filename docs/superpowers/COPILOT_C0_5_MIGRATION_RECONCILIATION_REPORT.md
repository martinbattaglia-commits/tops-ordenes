# Nexus Copilot · C0.5 — Reconciliación de migraciones 0180–0184 (READ-ONLY)

> **Naturaleza:** comparación **SQL real del repo ↔ objetos reales en Supabase PROD** (`arsksytgdnzukbmfgkju`). **Read-only.** Sin writes, sin aplicar/registrar migraciones, sin backfill, sin reprojection, sin deploy/push/merge.
> **Fecha:** 2026-07-07 · **Rama:** `fix/f5-2-copilot-context-retrieval` @ `b8b7c33`.
> **Método rector:** no inferir objetos por el nombre del archivo — usar el SQL real (`CREATE`) y `pg_proc`/`pg_class`.

---

## 1. Resumen ejecutivo

La "deriva 0180–0184" se **resuelve casi por completo** y en su mayoría era un **falso problema** creado por inferir objetos desde el nombre del archivo:

- **0181, 0182, 0183, 0184 están efectivamente APLICADAS** (sus 8 funciones existen en prod, `SECURITY INVOKER`, grant a `authenticated`, y el **cuerpo coincide** con el repo por markers distintivos) — solo **no figuran registradas** en la tabla `migrations`.
- **`ai_finance_overview` y `ai_analytics_overview` NO son objetos** — son **nombres de archivo** (`0181_ai_finance_overview.sql`, `0182_ai_analytics_overview.sql`) que crean funciones con **otros** nombres. **0 referencias en código.** → **falsos positivos** (los marqué mal antes; corregido).
- **Lo único genuinamente NO aplicado es 0180** (tabla `ai_budget_overrides` + fn `ai_daily_limit_for` + trigger). Y **degrada seguro**: `budget.ts` es **fail-closed** → si `ai_daily_limit_for` no existe, usa el default (40/día). Es una **feature pendiente** (override de límite por usuario), no una rotura.

**Veredicto:** no hay objetos "faltantes que la app necesite y no tenga". El Copilot funciona en prod con lo que hay. **C1 puede empezar** usando el **próximo número de archivo libre = `0185`** — condicionado solo a tu decisión sobre 0180 (activar o dejar pendiente) y a aceptar documentar la deriva.

---

## 2. Estado real de C0 (recordatorio)

Del preflight (`COPILOT_C0_SPINE_PREFLIGHT_REPORT.md`): **C0 ya está hecho** — `searchable_items` = 800 filas, 0176–0179 aplicadas, backfill corrido, en sync 1:1, FTS 100%, `ai_search_knowledge`/`ai_docs_browse` vivos. **C0 no se ejecuta.**

---

## 3. Tabla 0180–0184 por archivo (SQL real)

| Archivo | Objetos que crea (SQL real) | INSERT/UPD/DEL | ALTER destructivo | SECURITY DEFINER | Idempotente | Rollback |
|---------|-----------------------------|:---:|:---:|:---:|:---:|:---:|
| `0180_ai_budget_overrides.sql` | tabla `ai_budget_overrides` · fn `ai_budget_overrides_touch_updated_at` · trigger `ai_budget_overrides_touch` · fn `ai_daily_limit_for` · policy `ai_budget_overrides_admin_all` · grants | NO (seed superadmin es archivo MANUAL separado) | NO | **SÍ** (`ai_daily_limit_for`, `search_path` fijo) | SÍ (`create table if not exists` / `or replace`) | ✅ md |
| `0181_ai_finance_overview.sql` | `ai_customer_invoices_overview` · `ai_supplier_invoices_overview` · `ai_purchase_orders_overview` · `ai_suppliers_overview` | NO | NO | NO (INVOKER) | SÍ (`create or replace`) | ✅ md |
| `0182_ai_analytics_overview.sql` | `ai_billing_summary` · `ai_bank_balances_overview` · `ai_supplier_spend_overview` | NO | NO | NO (INVOKER) | SÍ | ✅ md |
| `0183_ai_customer_revenue.sql` | `ai_customer_revenue_overview` | NO | NO | NO (INVOKER) | SÍ | ✅ md |
| `0184_ai_revenue_by_category.sql` | `ai_revenue_by_category` | NO | NO | NO (INVOKER) | SÍ | ✅ md |

**Ninguna** de las 5 hace `INSERT/UPDATE/DELETE`, `DROP` ni `ALTER` destructivo. Todas idempotentes, con rollback hermano.

---

## 4. Tabla objeto por objeto (repo ↔ prod)

| Objeto (SQL real) | Mig | ¿Existe en prod? | Def. coincide | Seguridad | Grant | Usado en código | Clasificación |
|-------------------|:---:|:---:|:---:|:---:|:---:|:---:|---------------|
| `ai_customer_invoices_overview` | 0181 | ✅ | ✅ (`Factura emitida`) | INVOKER | authenticated | ✅ src (1) | **APLICADO_MANUALMENTE_COINCIDE** |
| `ai_supplier_invoices_overview` | 0181 | ✅ | ✅ (firma+sec) | INVOKER | authenticated | ✅ src (1) | **APLICADO_MANUALMENTE_COINCIDE** |
| `ai_purchase_orders_overview` | 0181 | ✅ | ✅ | INVOKER | authenticated | ✅ src (1) | **APLICADO_MANUALMENTE_COINCIDE** |
| `ai_suppliers_overview` | 0181 | ✅ | ✅ | INVOKER | authenticated | ✅ src (1) | **APLICADO_MANUALMENTE_COINCIDE** |
| `ai_billing_summary` | 0182 | ✅ | ✅ (`AUTORIZADO_ARCA`) | INVOKER | authenticated | ✅ src (1) | **APLICADO_MANUALMENTE_COINCIDE** |
| `ai_bank_balances_overview` | 0182 | ✅ | ✅ (firma+sec) | INVOKER | authenticated | ✅ src (3) | **APLICADO_MANUALMENTE_COINCIDE** |
| `ai_supplier_spend_overview` | 0182 | ✅ | ✅ (`compromiso`) | INVOKER | authenticated | ✅ src (3) | **APLICADO_MANUALMENTE_COINCIDE** |
| `ai_customer_revenue_overview` | 0183 | ✅ | ✅ (`Facturación por cliente`) | INVOKER | authenticated | ✅ src (1) | **APLICADO_MANUALMENTE_COINCIDE** |
| `ai_revenue_by_category` | 0184 | ✅ | ✅ (`Sin clasificar`) | INVOKER | authenticated | ✅ src (1) | **APLICADO_MANUALMENTE_COINCIDE** |
| tabla `ai_budget_overrides` | 0180 | ❌ | — | (RLS admin) | — | ❌ src · ✅ test (1) | **NO_EXISTE_PERO_NO_SE_USA** (crítico) |
| fn `ai_daily_limit_for` | 0180 | ❌ | — | DEFINER | — | ✅ src (2: `budget.ts`) · ✅ test (1) | **NO_EXISTE_Y_SE_USA → pero DEGRADA SEGURO** |
| trigger/`touch` fn | 0180 | ❌ | — | — | — | ❌ | **NO_EXISTE_PERO_NO_SE_USA** |
| `ai_finance_overview` | (nombre de archivo 0181) | ❌ (nunca fue objeto) | — | — | — | ❌ (0 refs) | **FALSO_POSITIVO** |
| `ai_analytics_overview` | (nombre de archivo 0182) | ❌ (nunca fue objeto) | — | — | — | ❌ (0 refs) | **FALSO_POSITIVO** |

> **Nota "def. coincide":** verificado por **markers distintivos** del cuerpo (`pg_get_functiondef` LIKE '%marker%') + firma + seguridad + grants. **No** se hizo diff byte-a-byte (opcional si querés certeza absoluta), pero al ser `create or replace` idempotentes y con markers presentes, la deriva de cuerpo es altamente improbable.

---

## 5. Qué objetos realmente faltan

**Solo los de 0180** (feature "override de límite diario por usuario"):
- tabla `ai_budget_overrides`
- fn `ai_daily_limit_for(integer)` (DEFINER)
- fn `ai_budget_overrides_touch_updated_at` + trigger

**Impacto real:** ninguno crítico. `budget.ts` (`checkBudget`) es **fail-closed** — al no existir la RPC, `limitError` se setea y queda el **default 40/día** para todos (incluidas las cuentas superadmin de Martín). La consecuencia es que **la feature de override no está activa** (Martín tiene 40/día como cualquier piloto, que era exactamente el dolor que 0180 buscaba resolver — el seed manual daría 300/día).

---

## 6. Qué objetos eran falsos positivos

- **`ai_finance_overview`** — no existe como objeto; es el nombre del archivo `0181_ai_finance_overview.sql`, que crea 4 funciones de facturas/OC/proveedores. **0 refs** en código.
- **`ai_analytics_overview`** — ídem; nombre de `0182_ai_analytics_overview.sql`, que crea billing/bank/spend. **0 refs** en código.

Ambos aparecían "faltantes" en mi preflight por **inferencia de nombre** — el error que advertiste. **Corregido acá y en el preflight/plan.**

---

## 7. Qué objetos están aplicados manualmente

**0181, 0182, 0183, 0184 → las 8 funciones**, todas `SECURITY INVOKER`, grant a `authenticated`, cuerpo coincidente, y **en uso por el Copilot** (referenciadas en `src/lib/ai/*`). Fueron aplicadas (probablemente por el SQL Editor a mano, patrón G3 documentado en los headers: *"APLICAR A MANO EN EL SQL EDITOR"*) **sin quedar registradas** en la tabla `migrations`. Empíricamente confirmadas también por el smoke real (Santander, facturación, contratos devolvieron datos).

---

## 8. Recomendación de numeración para la próxima migración (C1)

**Próximo número de archivo SEGURO = `0185`.**
- Los archivos `0180`–`0184` **existen en disco** → reusar cualquiera de ellos colisionaría. `0185` es el siguiente libre.
- La tabla `migrations` registra hasta `0179`, pero eso **no** habilita a reusar 0180–0184 (los archivos y —salvo 0180— los objetos ya existen).
- (Mi nota previa "no es simplemente 0185/0180" se refería a la ambigüedad de *registro*, no al número de archivo; el número de archivo **es 0185**.)

---

## 9. Riesgos de no reconciliar

| Riesgo | Nivel | Detalle |
|--------|:---:|---------|
| `supabase db push` intentaría aplicar 0180–0184 | 🟡 | 0181–0184 = `create or replace` idempotentes (no-op seguro). **0180 CREARÍA `ai_budget_overrides` → activaría la feature de override** (cambio de comportamiento, idempotente pero no trivial) |
| Confusión "qué está aplicado" | 🟡 | La tabla `migrations` (0179) no refleja los objetos reales (hasta 0184). Un dev nuevo puede aplicar 0180 sin querer |
| Deriva de cuerpo no detectada | 🟢 bajo | Markers coinciden; `create or replace` reduce riesgo. Diff byte-a-byte opcional si se quiere certeza |
| Feature budget override inactiva | 🟢 esperado | Martín queda con 40/día (no 300). Solo molesta en pruebas intensivas |

**El runtime NO está en riesgo.** El Copilot opera correctamente con el estado actual.

---

## 10. Qué NO hacer

- ❌ **NO** insertar filas manualmente en la tabla `migrations` (salvo procedimiento oficial del proyecto y con OK expreso).
- ❌ **NO** correr `supabase db push` a ciegas (aplicaría 0180 y activaría la feature de override sin decisión).
- ❌ **NO** aplicar 0180 "para emparejar" sin decidir antes si querés la feature de override.
- ❌ **NO** reusar los números 0180–0184 para C1 (colisión de archivos).

---

## 11. Decisión requerida del usuario

1. **Deriva 0181–0184:** ¿confirmás la **Opción 1** (documentar la deriva, no tocar `migrations`, C1 usa **0185**)? Es la de menor riesgo. *(Recomendada.)*
2. **0180 (budget override):** decisión **de producto**, no de reconciliación → ¿querés **activar** la feature (aplicar 0180 + seed manual → Martín 300/día) o **dejarla pendiente** (seguís con 40/día, degradación segura)? No la aplico sin OK.
3. **Diff byte-a-byte (opcional):** ¿querés que compare cuerpo completo prod↔repo de las 8 funciones, o alcanza con markers+firma+seguridad?
4. **C1:** con la Opción 1 confirmada, **C1 puede arrancar** (diseño, SQL idempotente `0185`, entregado NO aplicado). No arranco sin tu OK.

---

### Confirmación de reglas
No writes · no migrations applied · no migrations registered · no backfill · no reprojection · no deploy · no push · no merge · no Netlify · no NotebookLM · no crawler · no grounding. **100% read-only** (SELECT/catálogo + lectura de archivos del repo).

# P0.2 — Auto-creación de onboarding al pasar a Ganado

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Prioridad:** P0.2 (gap hallado en el E2E de escritura; cierra la cadena hasta "Ocupado")
**Estado:** ✅ **CERRADO** — validado en staging (9/9). Sin tocar PROD, sin desplegar.

> Objetivo: cerrar **Ganado → crm_onboarding → CompleteOnboarding → Ocupado** sin workarounds ni siembra manual.

---

## 1. Diagnóstico

- **Síntoma (E2E write):** desde la UI, tras "Ganado", el botón "Completar onboarding" fallaba con `ONBOARDING_NOT_FOUND`.
- **Causa:** ni `crm_advance_stage` ni `crm_promote_lead` creaban la fila `crm_onboarding`; `crm_complete_onboarding` la **exige**. El diseño (§ONBOARDING) preveía "crear onboarding al ganar" como side-effect, pero **no estaba implementado**.
- **Impacto:** la cadena no llegaba a "Ocupado" (paso 8 del E2E) sin sembrar onboarding a mano.

---

## 2. Implementación (mínima, sin reescribir advance_stage)

`supabase/migrations/0051_crm_onboarding_autocreate.sql` — **trigger** (no modifica `crm_advance_stage` → sin drift):

- **`crm_tg_create_onboarding_on_won()`** `SECURITY DEFINER`, `search_path` fijado: si **no existe** onboarding para la opp, crea `crm_onboarding` (`pendiente`, 0%, `started_at=now()`, `client_id` heredado) **+ checklist estándar de 5 tareas** (`rne, croquis, plancheta, accesos, documentacion`).
- **Trigger** `trg_crm_create_onboarding_on_won` `AFTER UPDATE OF estado ON crm_opportunities`, `WHEN (new.estado='ganado' AND old.estado IS DISTINCT FROM 'ganado')`.

### 2.1 Por qué un trigger (decisiones)
- **No reescribe `advance_stage`** → cero riesgo de drift con la función ya validada (W-1).
- **`UPDATE OF estado`**: solo se evalúa cuando la transición toca `estado` (advance_stage). `reserve`/`complete_onboarding`/`updateFields` no tocan `estado` → ni lo disparan.
- **`WHEN old IS DISTINCT FROM 'ganado'`**: solo en la transición *de entrada* a ganado (no en updates posteriores de un opp ya ganado).
- **Idempotente** (`if exists … return`): no duplica si ya hay onboarding (p. ej. el fixture de W-1).
- **`SECURITY DEFINER`**: la creación es un efecto de sistema; se ejecuta dentro de la tx de la transición.

> Aditivo (función + trigger). No toca tablas/enums/RLS/RBAC ni el resto de RPCs.

---

## 3. QA — 9/9 PASS (staging, BEGIN…ROLLBACK)

| # | Assert | Resultado |
|---|---|---|
| 0 | trigger `trg_crm_create_onboarding_on_won` existe | ✅ |
| 1 | antes de ganar: 0 onboarding | ✅ |
| 2 | **al ganar: onboarding auto-creado** (pendiente, 0%) | ✅ |
| 3 | al ganar: **checklist de 5 tareas** creado | ✅ |
| 4 | idempotencia: re-update a 'ganado' no duplica (sigue 1) | ✅ |
| 5 | **CADENA CERRADA**: `complete_onboarding` OK sin `ONBOARDING_NOT_FOUND` | ✅ |
| 6 | → `committed_state = ocupado` | ✅ |
| 7 | → onboarding `completado` / 100% | ✅ |
| 8 | negativo: transición a 'propuesta' NO crea onboarding | ✅ |

**Runner:** `scripts/f0_2-onboarding-staging.mjs`. ROLLBACK — sin datos residuales.
No hay cambios TS/UI (el botón "Completar onboarding" de la Ficha ya existe desde W-3; ahora la fila existe y funciona).

---

## 4. PASS / FAIL · GO / NO-GO

| Item | Veredicto |
|---|---|
| Auto-creación de onboarding al Ganar | ✅ PASS |
| Cadena Ganado → onboarding → complete → Ocupado | ✅ PASS |
| Idempotencia / no-duplicación | ✅ PASS |
| No dispara en otras transiciones | ✅ PASS |
| Regresión a advance_stage (W-1) | ✅ sin impacto (trigger separado, guard idempotente) |

> ## ✅ P0.2 — GO
> La cadena de escritura queda completa de punta a punta. **Se levanta el bloqueo #3 del E2E de escritura.**

---

## 5. Frontera

- Solo `0051` (función + trigger), aplicado **solo en staging**. PROD intacto.
- Sin desplegar, sin merge, sin tocar otras rutas.
- **Sin commitear** (igual que el flujo: commit cuando se autorice).

> **Próximo:** retomar el E2E de escritura (pasos 1–8 completos) una vez resueltos en paralelo los bloqueos #1 (claves supabase-js de staging) y #2 (usuario comercial de staging).

# CRM_WRITE_PATH_W4_RESULTS — W-4 · Evidencia, resultados e impacto en KPIs

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha de ejecución:** 2026-06-06
**Entorno:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`** · pooler `aws-1-sa-east-1`
**Harness:** `scripts/w4-loop-staging.mts` (guard de URL + `BEGIN…ROLLBACK`)
**Plan:** `W4_TEST_PLAN.md`

## Resultado

> ## ✅ GO — 12 / 12 PASS · 0 FAIL
> Circuito completo **Opportunity → Reserve → Committed → Onboarding → Occupied** verificado contra staging, con impacto correcto en las tres bandas de vacancia del **mismo motor que consume el Dashboard**. ROLLBACK ejecutado — sin datos residuales.

---

## 1. Evidencia de staging — impacto en la vacancia

### 1.1 ANMAT @ Pedro Luján 3159 (m²) — caso de prueba (200 m²)

| Paso | `committed_state` | Física | Comercial | Proyectada | (reserved/committed) |
|---|---|---:|---:|---:|---|
| 0 · baseline | none | 401 | 401 | 401 | (0 / 0) |
| 1 · reserve | **reservado** | 401 | 401 | **201** | (200 / 0) |
| 2 · won | **comprometido** | 401 | **201** | 201 | (0 / 200) |
| 3 · onboarding | **ocupado** | 401 | **401** | **401** | (0 / 0) |

### 1.2 Corporativo ANMAT (consolidado Luján + Magaldi, m²)

| Paso | Física | Comercial | Proyectada |
|---|---:|---:|---:|
| 0 · baseline | 508 | 508 | 508 |
| 1 · reserve | 508 | 508 | **308** |
| 2 · won | 508 | **308** | 308 |
| 3 · onboarding | 508 | 508 | 508 |

> Lectura: la **reserva** consume **vacancia proyectada** (futuro probable); el **gane** la convierte en consumo de **vacancia comercial** (compromiso firme); la **ocupación** la saca del committed (su m² pasa a la ocupación física del Twin → **anti-doble-conteo**). La banda **física** no se mueve por filas CRM.

---

## 2. Resultados — aserciones del lazo (12/12)

| # | Aserción | Resultado | Detalle |
|---|---|---|---|
| 1 | STEP1 `committed_state=reservado` | ✅ PASS | reservado |
| 2 | STEP1 proyectada −200 (Luján) | ✅ PASS | 401 → 201 |
| 3 | STEP1 comercial sin cambio | ✅ PASS | 401 → 401 |
| 4 | STEP1 física sin cambio | ✅ PASS | 401 → 401 |
| 5 | STEP2 `committed_state=comprometido` | ✅ PASS | comprometido |
| 6 | STEP2 comercial −200 (Luján) | ✅ PASS | 401 → 201 |
| 7 | STEP2 proyectada = comercial | ✅ PASS | proy=201 com=201 |
| 8 | STEP3 `committed_state=ocupado` | ✅ PASS | ocupado |
| 9 | STEP3 comercial vuelve al baseline (anti-doble-conteo) | ✅ PASS | 201 → 401 (base 401) |
| 10 | STEP3 proyectada vuelve al baseline | ✅ PASS | 201 → 401 (base 401) |
| 11 | Física constante en todo el lazo | ✅ PASS | física=401 |
| 12 | Corporativo ANMAT comercial −200 al ganar | ✅ PASS | 508 → 308 |

**TOTAL 12 · PASS 12 · FAIL 0.**

---

## 3. Impacto en KPIs (Dashboard de Vacancia)

Las cifras que vería Dirección en el Dashboard, por etapa del negocio, para este deal de 200 m² ANMAT en Luján:

| KPI (corporativo ANMAT) | Sin el deal | Reservado | Ganado | Ocupado |
|---|---:|---:|---:|---:|
| **Vacancia física** (m²) | 508 | 508 | 508 | 508 |
| **Vacancia comercial** (m²) | 508 | 508 | **308** | 508 |
| **Vacancia proyectada** (m²) | 508 | **308** | 308 | 508 |
| m² comprometidos (pipeline firme) | 0 | 0 | **200** | 0 |
| m² reservados (pipeline probable) | 0 | **200** | 0 | 0 |

**Interpretación ejecutiva:**
- **Pipeline temprano (reserva):** la **vacancia proyectada** anticipa el consumo futuro sin afectar la comercial → permite ver demanda en curso sin sobre-comprometer inventario.
- **Cierre (ganado):** el m² migra a **vacancia comercial** (compromiso real) → el inventario vendible baja de forma firme.
- **Alta (ocupado):** sale del committed; el m² ya cuenta como ocupación física del depósito. **No se cuenta dos veces.**
- El consolidado **corporativo** (Luján + Magaldi) refleja el mismo movimiento → un solo número de verdad para Dirección.

> Recordatorio: el inventario comercial total disponible hoy es **~3.770 m²** (≈38% de vacancia) + coworking 100%. El circuito permite ahora **descontar en vivo** lo que se reserva/gana/ocupa de ese stock.

---

## 4. Qué prueba este resultado

- El **circuito completo** persiste correctamente en cada paso (estados + ledger; consistencia ya validada en W-1).
- El **Capacity Engine** reacciona a los compromisos del CRM con la semántica correcta de las tres bandas.
- El **Dashboard** (que usa el mismo motor + el mismo snapshot) reflejaría exactamente estas cifras al navegar (revalidación ya cableada en W-2/W-3).
- La regla **anti-doble-conteo** (F2.1-4) se cumple: `ocupado` no infla el committed.

**Método de observabilidad (honesto):** como staging no expone claves supabase-js, el harness reconstruye el `CommittedSnapshot` con la **query idéntica** a `committed-capacity.ts` y lo alimenta al **motor real** (`getCorporateCapacity`). No se ejecutó el Dashboard renderizado (ruta con auth + runtime apuntando a PROD), pero el cálculo medido es el mismo que el Dashboard produce. La verificación visual del Dashboard corresponde a un entorno autenticado contra staging.

---

## 5. Estado de producción

- **PROD / `main` / Netlify / Clientify:** intactos.
- **Sin cambios de esquema ni de app en W-4** (solo el harness de observabilidad). Datos del harness revertidos (rollback).

> **W-4 GO.** El circuito completo Opportunity → Occupied está demostrado funcionando, con impacto correcto y medible en la vacancia física/comercial/proyectada.

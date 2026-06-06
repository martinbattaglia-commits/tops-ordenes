# W4_TEST_PLAN — Validación del lazo completo Opportunity → Occupied

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** Write-Path (F2.1-8) · **Paso W-4** — validación end-to-end del circuito y su impacto en la vacancia
**Naturaleza:** plan de prueba (sin código nuevo de app; solo un harness de observabilidad).

---

## 1. Objetivo

Demostrar, **contra staging**, que el circuito completo funciona y que cada transición impacta correctamente el **Motor Corporativo de Capacidad** y, por ende, el **Dashboard de Vacancia**:

```
Opportunity → Reserve → Committed(reservado) → Won(comprometido) → Onboarding → Occupied(ocupado)
```

Medir en cada paso las tres bandas de vacancia: **física**, **comercial** (− comprometido) y **proyectada** (− comprometido − reservado), por sede y corporativo.

---

## 2. Bajo prueba (sistema real, sin mocks)

| Componente | Rol en la prueba |
|---|---|
| RPC `0047` (`crm_reserve_capacity`, `crm_advance_stage`, `crm_complete_onboarding`) | ejecutan las transiciones (validadas W-1/W-2) |
| `crm_opportunities.committed_state` | estado de compromiso que alimenta el snapshot |
| Snapshot (lógica de `committed-capacity.ts`) | traduce las oportunidades a `CommittedSnapshot` |
| Motor `corporate-capacity.ts` (`getCorporateCapacity`) | **el mismo** que consume el Dashboard → calcula las bandas |

> El Dashboard (`/comercial/dashboard-vacancia`, `force-dynamic`) llama `getCommittedSnapshot()` + el motor en cada request. El harness reproduce ese mismo cálculo: arma el snapshot con la **query idéntica** a `committed-capacity.ts` y lo pasa al **motor real**. Así, lo que mide el harness es exactamente lo que mostraría el Dashboard.

---

## 3. Método

- **Entorno:** STAGING (`vrxosunxlhohmqymxots`). Guard de URL obligatorio (aborta si detecta PROD).
- **No destructivo:** todo en `BEGIN…ROLLBACK`. Las RPC ya están aplicadas (W-1); no se aplica nada nuevo.
- **Identidad:** las RPC se invocan impersonando al usuario **comercial** (RLS + `auth.uid()`); la medición del snapshot se lee como `postgres`.
- **Observabilidad:** el harness `scripts/w4-loop-staging.mts` importa el **motor real** (TS) y reconstruye el snapshot desde `crm_opportunities`. Es la única pieza "nueva", y es exclusivamente de medición (no toca la app).

### 3.1 Caso de prueba (determinista)
Una oportunidad **ANMAT · 200 m² · Pedro Luján 3159** (categoría con disponibilidad clara). Se eligió Luján/ANMAT porque su vacancia física es acotada y el efecto de ±200 m² es inequívoco.

### 3.2 Pasos y mediciones
| Paso | Acción (RPC) | `committed_state` esperado | Medición |
|---|---|---|---|
| 0 | — (baseline) | `none` | bandas iniciales |
| 1 | `crm_reserve_capacity` (sitio + unidades) | `reservado` | bandas tras reservar |
| 2 | `crm_advance_stage` ×3 → `ganado` | `comprometido` | bandas tras ganar |
| 3 | `crm_complete_onboarding` | `ocupado` | bandas tras ocupar |

---

## 4. Criterios de aceptación (aserciones)

| # | Criterio |
|---|---|
| A1 | STEP1 → `reservado`; **proyectada** baja en 200 m²; **comercial** y **física** sin cambio. |
| A2 | STEP2 → `comprometido`; **comercial** baja en 200 m²; **proyectada** = comercial (sin reservas residuales). |
| A3 | STEP3 → `ocupado`; **comercial** y **proyectada** vuelven al baseline (**anti-doble-conteo** F2.1-4). |
| A4 | **Física** constante en todo el lazo (su fuente es el modelo del Twin, no las filas CRM). |
| A5 | El consolidado **corporativo** ANMAT refleja el mismo −200 al ganar. |

**Éxito = todas PASS, 0 FAIL, y `crm_opportunities` consistente con `crm_stage_history`** (ya cubierto en W-1).

---

## 5. Alcance / fuera de alcance

- **En alcance:** el lazo completo y su impacto en las 3 bandas (sede + corporativo).
- **Fuera de alcance:** Clientify, webhook, despliegue, `main`, Netlify, edición de campos. La **vacancia física** del Twin no se altera con filas CRM sintéticas (es el supuesto anti-doble-conteo: al ocupar, el m² ya vive en la ocupación física del modelo).

---

## 6. Reproducción

```bash
npx tsx scripts/w4-loop-staging.mts   # guard incluido · BEGIN…ROLLBACK
```

Resultados y KPIs en `CRM_WRITE_PATH_W4_RESULTS.md`.

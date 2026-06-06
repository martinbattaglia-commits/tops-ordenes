# COMMERCIAL_KPI_DASHBOARD

**Módulo:** CRM Comercial — Dashboard Ejecutivo
**Fase:** 1 — Diseño (sin código)
**Fecha:** 2026-06-04
**Relacionado:** [MASTER_PLAN](./COMMERCIAL_MODULE_MASTER_PLAN.md) · [DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md) · [PIPELINE](./COMMERCIAL_PIPELINE_DESIGN.md) · [ONBOARDING](./ONBOARDING_AUTOMATION_DESIGN.md)

> **Estado actual:** no existe dashboard comercial. El pipeline calcula un snapshot **efímero en memoria** (`getPipelineSnapshot()` en `src/lib/clientify/data.ts`): `openCount`, `pipelineTotal` (suma de montos abiertos), `wonYtd` (ganados del año). No persiste, no pondera por probabilidad, no cruza con WMS ni facturación. Este documento define el set completo de KPIs, su fuente y su fórmula.

---

## 1. Audiencia y propósito

`/comercial/dashboard` — vista ejecutiva para dirección comercial y gerencia. Responde: ¿cuánto hay en el embudo, cuánto vamos a cerrar, qué tan rápido cerramos, cuánta capacidad (m²) tenemos libre, y cuánto facturaremos?

Acceso: rol `comercial` + `cockpit.view` (ya mapeados en `0009:266-272`) y `admin`.

---

## 2. KPIs — definición canónica

Cada KPI declara: fórmula, fuente (tabla), filtro y refresco.

### 2.1 Pipeline total
- **Qué:** valor total de oportunidades abiertas (no terminales).
- **Fórmula:** `Σ monto WHERE estado NOT IN ('ganado','perdido')`.
- **Fuente:** `crm_opportunities` (`monto`, `estado`).
- **Hoy existe parcialmente:** `pipelineTotal` en el snapshot, pero leído de Clientify, no de Nexus.

### 2.2 Forecast ponderado
- **Qué:** valor esperado de cierre, ponderado por probabilidad.
- **Fórmula:** `Σ (monto × probabilidad/100) WHERE estado activo`.
- **Fuente:** `crm_opportunities` (`monto`, `probabilidad`).
- **Nuevo:** el snapshot actual no pondera.
- **Variantes:** forecast del trimestre = mismo cálculo filtrando `expected_close` en el trimestre.

### 2.3 Tasa de cierre (win rate)
- **Qué:** proporción de oportunidades ganadas sobre las resueltas.
- **Fórmula:** `ganadas / (ganadas + perdidas)` en el período.
- **Fuente:** `crm_opportunities` (`estado`, `actual_close`).
- **Desglose:** por `service_type` (ANMAT vs General vs Oficinas) y por owner.

### 2.4 Ciclo de venta promedio
- **Qué:** días desde creación hasta cierre.
- **Fórmula:** `avg(actual_close − created_at) WHERE estado='ganado'`.
- **Fuente:** `crm_opportunities`; precisión por etapa vía `crm_stage_history` (tiempo en cada etapa).

### 2.5 m² potenciales
- **Qué:** metros cuadrados en negociación (capacidad comprometible si se gana todo el embudo).
- **Fórmula:** `Σ m2 WHERE estado activo`; ponderado: `Σ (m2 × probabilidad/100)`.
- **Fuente:** `crm_opportunities.m2`.
- **Nota:** Clientify **no modela m²** — este KPI solo es posible porque Nexus es SoR de la oportunidad estructurada (justifica la arquitectura híbrida).

### 2.6 Vacancia (m² disponibles) — ✅ fuente oficial definida
- **Qué:** capacidad física libre vs ocupada vs comprometida.
- **Fuente oficial (RATIFICADA 2026-06-04):** **Digital Twin (`warehouse_*`)**, granularidad **sector** (Opción A). Ver [VACANCY_SOURCE_OF_TRUTH_ANALYSIS](./VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md).
- **Fórmula:**
  - `capacidad_total = Σ warehouse_sectors.surface_m2` (por sede / tipo ANMAT·general).
  - `m2_ocupados` = m² de sectores con inventario presente (ocupación derivada del inventario, agregada a sector — patrón `src/lib/wms/twin.ts`).
  - `m2_comprometidos = Σ crm_opportunities.m2 (ganadas no onboardeadas) + contratos firmados`.
  - `m2_libres = capacidad_total − m2_ocupados − m2_reservados`.
  - `vacancia% = m2_libres / capacidad_total`; `vacancia_comercial% = (m2_libres − m2_comprometidos) / capacidad_total`.
- **Dependencias operativas pendientes (no bloquean F2.1):** G1 cargar m² de Luján (sede + sector D2); G6 confirmar con operaciones que la ocupación legacy no requiere import de Neuralsoft/Deonics. Hasta cerrarlas, el número de vacancia se muestra como "parcial (Magaldi)" — no se inventa la fuente, ya está decidida.
- **Nota:** granularidad de **posición (Opción B) diferida**; operación conserva la vista booleana por posición en el Mapa Inteligente.

### 2.7 Facturación proyectada
- **Qué:** ingreso esperado de las oportunidades por cerrar + recurrencia de contratos firmados.
- **Fórmula:**
  - Nuevos: `Σ (monto × probabilidad/100)` del forecast.
  - Recurrente: `Σ` valor mensual de contratos vigentes (`crm_contracts.status IN ('firmado','vigente')`).
- **Fuente:** `crm_opportunities`, `crm_contracts`; validación contra facturación real **ARCA** (productivo) para medir precisión del forecast.

### 2.8 Embudo por etapa (conversión)
- **Qué:** cantidad y valor por etapa + tasa de conversión entre etapas consecutivas.
- **Fórmula:** `count`/`Σ monto` por `estado`; conversión = `entran_etapa_n+1 / entran_etapa_n` (de `crm_stage_history`).
- **Fuente:** `crm_opportunities`, `crm_stage_history`.

### 2.9 KPIs de tope de embudo (Clientify)
- **Qué:** leads nuevos, contactados, calificados (origen Google Ads).
- **Fuente:** `crm_leads` (espejo) + cache de `clientify_sync_log`.
- **Métricas:** leads/semana por `source`, tasa lead→oportunidad (calificación).

---

## 3. Tabla resumen

| KPI | Fórmula | Fuente | ¿Existe hoy? |
|---|---|---|---|
| Pipeline total | Σ monto (abiertas) | `crm_opportunities` | Parcial (Clientify, efímero) |
| Forecast ponderado | Σ monto×prob | `crm_opportunities` | No |
| Tasa de cierre | ganadas/(ganadas+perdidas) | `crm_opportunities` | No |
| Ciclo de venta | avg(close−create) | `crm_opportunities`,`crm_stage_history` | No |
| m² potenciales | Σ m2 (abiertas) | `crm_opportunities` | No |
| Vacancia | cap_total − ocupados | **WMS (a definir)** | No |
| Facturación proyectada | forecast + recurrente | `crm_opportunities`,`crm_contracts`,ARCA | No |
| Embudo por etapa | count/Σ por estado | `crm_opportunities`,`crm_stage_history` | No |
| Leads (TOFU) | leads/sem por source | `crm_leads` | No |

---

## 4. Layout propuesto

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard Ejecutivo Comercial          [Período ▾] [Servicio ▾]│
├───────────────┬───────────────┬───────────────┬──────────────┤
│ Pipeline total│ Forecast pond.│ Tasa de cierre│ Ciclo venta  │  ← tarjetas (CountUp.tsx ya existe)
│  $ XX.XM      │  $ XX.XM      │   42%         │  38 días     │
├───────────────┴───────────────┴───────────────┴──────────────┤
│  Embudo por etapa (funnel)          │  Forecast por mes (barras)│
│  [Nuevo→Contactado→...→Ganado]      │  [trimestre]              │  ← charts/ ya existe
├─────────────────────────────────────┼───────────────────────────┤
│  m² potenciales vs Vacancia (gauge) │  Facturación proy. vs real│
│                                     │  (línea, cruce ARCA)      │
├─────────────────────────────────────┴───────────────────────────┤
│  Tabla: Top oportunidades abiertas (por monto/probabilidad)      │
└──────────────────────────────────────────────────────────────────┘
```

**Reutiliza componentes existentes:** `src/components/CountUp.tsx`, `src/components/charts/`, `src/components/dashboard/`, `StatusBadge.tsx`. No requiere librería nueva.

---

## 5. Estrategia de datos y refresco

- **Vistas materializadas** (`crm_dashboard_*`) para agregaciones costosas (embudo, conversión, ciclo), refrescadas:
  - On-demand al abrir el dashboard si `force-dynamic` (patrón del repo), o
  - Por `cron`/job tras cada cierre (transición a ganado/perdido) — más eficiente para datos casi-estáticos.
- **KPIs en vivo** (pipeline total, forecast): query directa sobre `crm_opportunities` (volumen bajo, no necesita materialización).
- **Vacancia:** vista que une capacidad WMS + ocupación; refresco al menos diario (la ocupación física cambia poco intra-día).
- **TOFU (leads):** desde `clientify_sync_log`/`crm_leads`, alimentado por el webhook (F2.4).

---

## 6. Seguridad

- RLS: todas las vistas materializadas se exponen solo a `is_staff()` con rol `comercial`/`admin`.
- PII: nombres de owner vía `profiles_public` (sin email), por mandato de `0040`.
- No exponer datos de cliente B2B cruzados entre cuentas.

---

## 7. Dependencias y brechas

| Dependencia | Estado | Bloquea |
|---|---|---|
| `crm_opportunities` poblada | No existe | Todos los KPIs salvo TOFU |
| `crm_stage_history` | No existe | Ciclo, conversión |
| Fuente de vacancia | ✅ **Definida: Digital Twin / sector** (ratificado 2026-06-04). Pendiente operativo: G1 m² Luján, G6 confirmar legacy | Encendido del número de vacancia (no el modelo) |
| `crm_contracts` (valor recurrente) | No existe | Facturación proyectada |
| Cruce con ARCA (facturación real) | ARCA productivo | Validación de precisión del forecast |
| Cache de leads (`clientify_sync_log`) | No existe (webhook stub) | KPIs TOFU |

---

## 8. Definición de "listo"

1. Todas las tarjetas leen de `crm_*` (no de un snapshot efímero de Clientify).
2. El forecast pondera por probabilidad y es desglosable por servicio/owner.
3. Vacancia usa la fuente oficial **Digital Twin / sector** (ratificada), no estimada.
4. Facturación proyectada es contrastable contra ARCA real.
5. El dashboard respeta RLS y el lockdown de PII de `0040`.
6. Refresco documentado por KPI (vivo vs materializado).

> **Fuente de vacancia: ✅ RESUELTA (2026-06-04).** Anclada al **Digital Twin (`warehouse_*`), granularidad sector** — ver [VACANCY_SOURCE_OF_TRUTH_ANALYSIS](./VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md). Restan solo dos tareas **operativas** que no bloquean F2.1: cargar m² de Luján (G1) y confirmar la ocupación legacy con operaciones (G6).

# COMMERCIAL_F2_1_ARCHITECTURE

**Módulo:** CRM Comercial Nexus — Arquitectura funcional F2.1 (integración end-to-end)
**Fase:** Diseño — **antes de escribir una sola tabla o migración**
**Fecha:** 2026-06-04
**Objetivo:** conectar el embudo completo
`Clientify → Oportunidades → Forecast → Motor Corporativo de Capacidad → Propuestas → Contratos → Onboarding`.

> Este documento es la **capa de integración** que une los 5 diseños base del CRM con el **Motor Corporativo de Capacidad** ya construido (`src/lib/wms/corporate-capacity.ts`).
> Diseños base (no se duplican aquí, se referencian):
> [MASTER_PLAN](./COMMERCIAL_MODULE_MASTER_PLAN.md) · [DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md) · [PIPELINE](./COMMERCIAL_PIPELINE_DESIGN.md) · [ONBOARDING](./ONBOARDING_AUTOMATION_DESIGN.md) · [KPI](./COMMERCIAL_KPI_DASHBOARD.md) · [VACANCY](./VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md)
> Motor: [CORPORATE_CAPACITY](../corporate/TOPS_CORPORATE_CAPACITY_ARCHITECTURE.md) · [ENGINE_REPORT](../corporate/CORPORATE_CAPACITY_ENGINE_REPORT.md)

---

## 0. Qué cambia respecto del diseño original del CRM

Cuando se diseñó el CRM (5 docs base), la **vacancia/capacidad era un placeholder**. Ahora existe el **Motor Corporativo de Capacidad** (`corporate-capacity.ts`) con:
- Capacidad consolidada de 2 sedes (10.049 m² comercializables, 3.770 disponibles).
- Selector `findAvailability({category, m2})` — matching demanda↔oferta.
- Hook `committedM2` (hoy `COMMITTED_M2_ENABLED = false`, todo en 0), **diseñado para que F2.1 lo active**.

**F2.1 cierra el lazo:** el CRM deja de ser un embudo "ciego" y pasa a validar cada oportunidad contra la capacidad física real, y a **devolver** sus compromisos (m² de deals) al motor para calcular vacancia comercial.

---

## 1. Flujo end-to-end (control + datos)

```
 [Google Ads] → Clientify (SoR tope de embudo: leads, contactos, empresas, marketing)
      │ webhook (HMAC) → crm_leads (espejo)
      ▼
 ┌──────────────────────── NEXUS (SoR del proceso comercial) ────────────────────────┐
 │  Lead calificado ──► OPORTUNIDAD (crm_opportunities: service_type, m², estado)      │
 │        │                                                                            │
 │        │  ┌──────────── integración capacidad (NUEVO F2.1) ───────────────┐        │
 │        ├─►│ findAvailability({category, m2}) → ¿entra? ¿en qué sede/sector?│        │
 │        │  └───────────────────────────────────────────────────────────────┘        │
 │        ▼                                                                            │
 │  FORECAST (Σ monto × prob)  ── valida feasibility de capacidad por oportunidad      │
 │        ▼                                                                            │
 │  COTIZACIÓN (crm_quotes) ──► PROPUESTA PDF (crm_proposals) ── sugiere sede/sector   │
 │        ▼                                                                            │
 │  NEGOCIACIÓN ──► GANADO ──► CONTRATO (crm_contracts, firma)                         │
 │        │                                                                            │
 │        │  committed_m2  ─────────────────────────────────────────┐                 │
 │        ▼                                                          ▼                 │
 │  ONBOARDING (checklist RNE/croquis/plancheta/accesos/docs)   Motor Corporativo      │
 │        │  alta cliente activo                                (vacancia comercial)    │
 │        ▼                                                          ▲                 │
 │  OPERACIÓN (WMS/Digital Twin: ocupación FÍSICA) ─────────────────┘                 │
 │        (al onboardear, committed → occupied; el motor deja de contarlo como         │
 │         compromiso y pasa a ocupación física — evita doble conteo)                  │
 └────────────────────────────────────────────────────────────────────────────────────┘
      ▼
 FACTURACIÓN (ARCA, productivo)
```

---

## 2. System of Record (recap ratificado)

Híbrido por etapa ([MASTER_PLAN §1.1](./COMMERCIAL_MODULE_MASTER_PLAN.md)):
- **Clientify:** leads, contactos, empresas, marketing, Google Ads, WhatsApp/Email SDR.
- **Nexus:** oportunidades, cotizaciones, propuestas, contratos, onboarding, cliente activo, operación, facturación, KPIs.
- **Frontera:** lead calificado en Clientify → crear oportunidad en Nexus.
- **Capacidad (oferta física):** Digital Twins + Motor Corporativo (Luján + Magaldi) — fuente única, ya construida.

---

## 3. Contrato de integración CRM ↔ Motor Corporativo (el corazón de F2.1)

### 3.1 Mapeo de servicio → categoría de capacidad
| `crm_opportunities.service_type` | `CapacityCategory` (motor) |
|---|---|
| `anmat` | `anmat` |
| `general` | `general` |
| `oficinas` | `oficina` |
| coworking (puestos) | — (se valida contra `coworking`, no `findAvailability`) |

### 3.2 Puntos de llamada al motor
| Etapa CRM | Llamada | Uso |
|---|---|---|
| Calificación / Oportunidad | `findAvailability({category, m2})` | marcar **feasibility** (¿hay capacidad?) → flag en la oportunidad |
| Forecast | `getCorporateVacancySummary()` + feasibility por deal | forecast ponderado **realista** (no cuenta lo que no entra) |
| Propuesta | `findAvailability(...).options` | sugerir **sede/sector** concreto en la propuesta |
| Onboarding | (lectura) | confirmar que el espacio asignado sigue disponible antes de comprometer |

### 3.3 Ciclo de vida de `committed_m2` (activación del hook)
F2.1 pone `COMMITTED_M2_ENABLED = true` y `committedFor(category, site)` lee de `crm_opportunities`. Dos capas:

| Capa | Origen | Resta a |
|---|---|---|
| **Reservado** | oportunidades en `propuesta`/`negociacion` (soft-hold) | vacancia **proyectada** |
| **Comprometido** | oportunidades en `ganado` **no onboardeadas** | vacancia **comercial** |
| **Ocupado** | onboardeadas → ocupación física del Digital Twin | ya está en `ocupadoM2` |

**Regla anti-doble-conteo (crítica):** al **onboardear**, el m² pasa de *comprometido* (CRM) a *ocupado* (Digital Twin). El motor debe excluir del `committedM2` las oportunidades cuyo onboarding está `completado` — su m² ya vive en la ocupación física. Sin esta regla, se contaría dos veces.

Fórmulas resultantes:
```
vacancia_fisica      = comercializable − ocupado_físico
vacancia_comercial   = comercializable − ocupado_físico − comprometido(ganado no onboardeado)
vacancia_proyectada  = vacancia_comercial − reservado(propuesta/negociacion)
```
Hasta F2.1: `comprometido = reservado = 0` → vacancia_comercial = vacancia_física (lo que muestra hoy el dashboard).

### 3.4 Dirección del flujo de datos
- **CRM → Motor:** `crm_opportunities` (m², estado, sede asignada) alimenta `committedFor()`.
- **Motor → CRM:** `findAvailability()` / `getCorporateVacancySummary()` alimentan feasibility, forecast y propuestas.
- **Onboarding → Digital Twin:** la asignación de espacio actualiza la ocupación física (futuro: escribir a la capa local del sede-map o a `warehouse_*` reconciliado).

---

## 4. Especificación por etapa (referencias + delta F2.1)

| Etapa | Diseño base | Delta F2.1 (integración capacidad) |
|---|---|---|
| **Clientify → Leads** | [DATA_MODEL §3.1](./CLIENTIFY_NEXUS_DATA_MODEL.md), [PIPELINE §3](./COMMERCIAL_PIPELINE_DESIGN.md) | webhook HMAC + `crm_leads` (sin cambios de capacidad) |
| **Oportunidades** | [DATA_MODEL §3.2](./CLIENTIFY_NEXUS_DATA_MODEL.md) | + campos `capacity_feasible bool`, `assigned_site`, `assigned_units` (resultado de `findAvailability`) |
| **Forecast** | [KPI §2.2](./COMMERCIAL_KPI_DASHBOARD.md) | forecast cruzado con feasibility; vacancia del KPI = motor corporativo (no placeholder) |
| **Propuestas** | [DATA_MODEL §3.3–3.4](./CLIENTIFY_NEXUS_DATA_MODEL.md) | la propuesta cita sede/sector sugeridos por el motor |
| **Contratos** | [DATA_MODEL §3.5](./CLIENTIFY_NEXUS_DATA_MODEL.md) | al firmar (ganado): m² pasa a `comprometido` |
| **Onboarding** | [ONBOARDING](./ONBOARDING_AUTOMATION_DESIGN.md) | al completar: `comprometido → ocupado` (regla anti-doble-conteo §3.3) |

---

## 5. Data model F2.1 — deltas sobre el diseño base

Tablas ya diseñadas en [CLIENTIFY_NEXUS_DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md) (10 tablas `crm_*`). F2.1 agrega **campos de integración de capacidad** a `crm_opportunities`:

| Campo nuevo | Tipo | Uso |
|---|---|---|
| `capacity_feasible` | bool | resultado de `findAvailability` al calificar |
| `assigned_site` | text | `PEDRO_LUJAN_3159` / `MAGALDI_1765` (sugerido/elegido) |
| `assigned_units` | jsonb | sectores/cubículos/islas reservados |
| `committed_state` | enum | `none` / `reservado` / `comprometido` / `ocupado` |

> Estos campos hacen que la oportunidad sea la **unidad de compromiso** que el motor lee. No requieren nuevas tablas, solo columnas en `crm_opportunities`.

El motor (`corporate-capacity.ts`) **no se modifica estructuralmente**: solo se activa `COMMITTED_M2_ENABLED` y se implementa `committedFor()` para leer `crm_opportunities` (vía una función de datos del lado servidor).

---

## 6. Estrategia de ramas y código (decisión)

El CRM F2.1 **necesita** `corporate-capacity.ts`, que vive en `feature/dashboard-vacancia-corporativo`. Opciones:

| Opción | Estrategia | Veredicto |
|---|---|---|
| **A (recomendada)** | Rama `feature/crm-comercial-f2-1` **desde `feature/dashboard-vacancia-corporativo`** (hereda motor + modelos + dashboard) | Coherente; el CRM construye sobre la capacidad ya consolidada; sin tocar main |
| B | Rama desde `main` + cherry-pick del motor | Duplica/drift |
| C | Esperar a graduar el motor a main (Opción C corporativa) y ramificar de main | Limpio pero **toca main** — excluido ahora |

**Recomendación: A.** La cadena de ramas queda: `main → …luján → …magaldi → dashboard-vacancia-corporativo → crm-comercial-f2-1`. Sin merge a main.

> Nota: esto implica que F2.1 **sí toca Supabase** (migraciones `crm_*`) — pero en **rama de feature, fuera de PROD**, con autorización explícita por migración (restricción del handoff maestro: no tocar Supabase PROD).

---

## 7. Secuencia de construcción F2.1 (descrita, NO ejecutada)

| Paso | Entregable | Toca |
|---|---|---|
| F2.1-0 | Esta arquitectura | — |
| F2.1-1 | Migraciones `crm_enums` + `crm_core` (`crm_leads`, `crm_opportunities` + campos capacidad) | Supabase (feature) |
| F2.1-2 | Migraciones `crm_quotes/proposals/contracts/onboarding` + `crm_stage_history` + `clientify_sync_log` | Supabase (feature) |
| F2.1-3 | RBAC seed (`comercial.create/delete/admin`) + vista `profiles_public` | Supabase (feature) |
| F2.1-4 | Activación del hook: `COMMITTED_M2_ENABLED=true` + `committedFor()` lee `crm_opportunities` | código |
| F2.1-5 | Webhook Clientify con HMAC + persistencia (`crm_leads`, `clientify_sync_log`) | código |
| F2.1-6 | UI: `/comercial/oportunidades` (CRUD + ficha 360° con feasibility) | código |
| F2.1-7 | Persistencia de cotizaciones/propuestas (capturar salida de los artefactos existentes) | código |

Cada paso = migración/PR aislado, en rama de feature, **nunca** sobre PROD sin autorización.

---

## 8. Decisiones (ratificadas 2026-06-04)

| # | Decisión | Estado |
|---|---|---|
| F-1 | Estrategia de ramas: **Opción A** — `feature/crm-comercial-f2-1` desde `feature/dashboard-vacancia-corporativo` | ✅ **Ratificada** |
| F-2/F-3 | Compromiso de capacidad en **2 capas**: `reservado` (propuesta/negociación, soft-hold) + `comprometido` (ganado, hard-commit) → habilita vacancia comercial **y** proyectada | ✅ **Ratificada** |
| F-5 | **Migraciones Supabase autorizadas en rama de feature** (fuera de PROD, sin deploy) | ✅ **Ratificada** |
| F-4 | ¿F2.1 escribe ocupación física al onboardear (capa local sede-map) o handoff manual? | ⏳ a definir en F2.1-6/7 |
| F-6 | Reconciliación seed `warehouse_*` (D/S → PB) — atada a F2.1 o aparte | ⏳ a definir (no bloquea) |

> El `committed_state` de `crm_opportunities` refleja las 2 capas: `none` → `reservado` (al pasar a propuesta/negociación) → `comprometido` (al ganar) → `ocupado` (al completar onboarding, sale del committed por la regla anti-doble-conteo §3.3).

---

## 9. Objetivo final F2.1

Que una oportunidad de Clientify se convierta, **con validación de capacidad real en cada paso**, en un cliente activo operando — cerrando el lazo oferta (Digital Twins) ↔ demanda (CRM) y alimentando el forecast y la vacancia comercial con datos reales de las dos sedes.

**Sin escribir tablas ni migraciones todavía.** Primero ratificar §8.

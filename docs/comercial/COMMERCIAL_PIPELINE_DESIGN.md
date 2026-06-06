# COMMERCIAL_PIPELINE_DESIGN

**Módulo:** CRM Comercial — Diseño del pipeline
**Fase:** 1 — Diseño (sin código)
**Fecha:** 2026-06-04
**Relacionado:** [MASTER_PLAN](./COMMERCIAL_MODULE_MASTER_PLAN.md) · [DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md) · [ONBOARDING](./ONBOARDING_AUTOMATION_DESIGN.md) · [KPI](./COMMERCIAL_KPI_DASHBOARD.md)

> **Estado actual:** el pipeline ya existe como UI (`src/app/(app)/comercial/pipeline/page.tsx`), pero es **solo lectura sobre Clientify**: arma un kanban dinámico con las etapas que devuelve cada pipeline de Clientify (`getPipelineSnapshot()` en `src/lib/clientify/data.ts`), filtrando a 3 pipelines visibles por nombre: `ANMAT`, `Alquiler de oficinas`, `Cargas Generales`. No hay persistencia ni transiciones controladas. Este documento define el pipeline **canónico unificado** de Nexus y cómo se sincroniza con esos pipelines de Clientify.

---

## 1. Pipeline canónico (objetivo)

El handoff maestro define 8 estados. Los adoptamos como el pipeline único de Nexus:

```
Nuevo Lead → Contactado → Calificado → Visita → Propuesta → Negociación → Ganado
                                                                            ↘ Perdido
```

`Ganado` y `Perdido` son estados terminales. `Perdido` puede alcanzarse desde cualquier etapa activa.

---

## 2. Definición de etapas (enum `crm_stage_t`)

| # | `crm_stage_t` | Etiqueta | SoR | Probabilidad base | Criterio de entrada (definition of done de la etapa anterior) |
|---|---|---|---|---|---|
| 1 | `nuevo_lead` | Nuevo Lead | Clientify | 5% | Lead capturado (Google Ads / web / referido) y espejado en `crm_leads` |
| 2 | `contactado` | Contactado | Clientify | 10% | Primer contacto registrado (llamada/mail/WhatsApp) |
| 3 | `calificado` | Calificado | **frontera** | 20% | Hay interés real + datos de negocio (servicio, m² aprox, CUIT) → **se promueve a `crm_opportunities`** |
| 4 | `visita` | Visita | Nexus | 40% | Visita técnica al depósito / relevamiento agendado o realizado |
| 5 | `propuesta` | Propuesta | Nexus | 60% | Cotización persistida (`crm_quotes`) + propuesta PDF enviada (`crm_proposals.status='enviada'`) |
| 6 | `negociacion` | Negociación | Nexus | 75% | Cliente respondió la propuesta; se ajustan precio/condiciones |
| 7 | `ganado` | Ganado | Nexus → Clientify | 100% | Contrato firmado (`crm_contracts.status='firmado'`) → dispara onboarding |
| 8 | `perdido` | Perdido | Nexus → Clientify | 0% | Registro de `lost_reason`; cierre del deal en Clientify |

> La **probabilidad base** es el default al entrar a la etapa; el vendedor puede ajustarla manualmente (`crm_opportunities.probabilidad`). Alimenta el forecast ponderado del [dashboard](./COMMERCIAL_KPI_DASHBOARD.md).

**Frontera Clientify↔Nexus (etapa 3):** al calificar, el lead se promueve a oportunidad estructurada en Nexus. Antes de la etapa 3, Nexus solo **espeja** lo que pasa en Clientify; desde la 3, Nexus es SoR y empuja cambios a Clientify.

---

## 3. Bandeja de Leads y promoción

```
Google Ads ──► Clientify ──webhook──► api/clientify/webhook
                                          │ (verifica HMAC — HOY AUSENTE)
                                          ▼
                                   upsert crm_leads (clientify_id unique)
                                          │ asigna owner (regla round-robin / por servicio)
                                          ▼
                                /comercial/leads  (bandeja)
                                          │ "Calificar" (acción comercial)
                                          ▼
                          crear crm_opportunities (estado='calificado')
                          + crm_leads.opportunity_id, status='promovido'
                          + outbound: crear/actualizar Deal en Clientify
```

**Brecha a cerrar (F2.4):** el webhook actual (`api/clientify/webhook/route.ts`) solo loguea y responde `{ ok: true }` — **sin HMAC, sin persistencia** (TODO en `:26` y `:37`). La promoción no existe porque `crm_opportunities` no existe.

**Reglas de asignación de owner (propuesta):**
- Por tipo de servicio: ANMAT → equipo farma; Cargas Generales → equipo general; Oficinas → equipo inmobiliario.
- Fallback: round-robin entre owners activos del rol `comercial`.
- Registrado en `crm_leads.owner_id` y heredado por la oportunidad.

---

## 4. Mapeo de etapas Nexus ↔ Clientify

Clientify hoy expone 3 pipelines visibles, cada uno con sus propias etapas (dinámicas). El pipeline canónico de Nexus debe mapearse a/desde ellas.

| Etapa Nexus (`crm_stage_t`) | Clientify (status / pipeline_stage) | Dirección |
|---|---|---|
| `nuevo_lead`, `contactado`, `calificado` | etapas tempranas del pipeline Clientify; `status=1` (Open) | Clientify → Nexus (espejo) |
| `visita`, `propuesta`, `negociacion` | etapas intermedias; `status=1` (Open) | Nexus → Clientify (mover `pipeline_stage`) |
| `ganado` | `status=2` (Won) + `actual_closed_date` | Nexus → Clientify |
| `perdido` | `status=4` (Lost) + `actual_closed_date` | Nexus → Clientify |

**Mapeo de `status` ya implementado** (verificado en `src/lib/clientify/mappers.ts:66-71`): `1=open, 2=won, 3=other, 4=lost`. Lo reutilizamos.

**Mapeo de pipeline por servicio:**
| `crm_opportunities.service_type` | Pipeline Clientify (`clientify_pipeline`) |
|---|---|
| `anmat` | `ANMAT` |
| `general` | `Cargas Generales` |
| `oficinas` | `Alquiler de oficinas` |

> Las etapas intermedias específicas de cada pipeline Clientify se resuelven con una tabla de mapeo `stage_map(service_type, crm_stage, clientify_stage_id)` configurable, porque los `stage_id` de Clientify son dinámicos (parseados de URLs en `mappers.ts:97-124`). Esto evita hardcodear IDs.

---

## 5. Transiciones y reglas de negocio

### 5.1 Máquina de estados
```
nuevo_lead → contactado → calificado → visita → propuesta → negociacion → ganado
     │            │            │           │          │            │
     └────────────┴────────────┴───────────┴──────────┴────────────┴──► perdido
```
- **Avance:** solo a la etapa siguiente, o a `perdido` desde cualquier activa.
- **Retroceso:** permitido (p. ej. `negociacion → propuesta` si se re-cotiza), registrado en `crm_stage_history`.
- **No-skip:** no se puede saltar de `calificado` a `ganado` sin pasar por propuesta (regla configurable; garantiza que exista cotización + propuesta + contrato).

### 5.2 Guardas por etapa (validaciones al transicionar)
| Transición | Guarda |
|---|---|
| → `calificado` | requiere `service_type` y `cuit` (o `client_id`) |
| → `propuesta` | requiere al menos una `crm_quotes` y una `crm_proposals` con `status='enviada'` |
| → `ganado` | requiere `crm_contracts.status='firmado'` |
| → `perdido` | requiere `lost_reason` |

### 5.3 Efectos secundarios (side-effects)
| Evento | Efecto |
|---|---|
| Cualquier cambio de etapa | insert en `crm_stage_history`; outbound sync a Clientify; log en `clientify_sync_log` |
| → `ganado` | crear `crm_onboarding` + tasks; `clients.activo = true`; alta operativa (ver [ONBOARDING](./ONBOARDING_AUTOMATION_DESIGN.md)) |
| → `perdido` | cerrar Deal en Clientify; liberar forecast |

Toda transición pasa por una **server action** validada con Zod (patrón del repo) que aplica guarda → escribe estado → registra historia → dispara sync, en una transacción.

---

## 6. UI del pipeline (evolución de lo existente)

| Aspecto | Hoy | Objetivo |
|---|---|---|
| Fuente | Clientify (lectura) | `crm_opportunities` (Nexus) + espejo de leads Clientify |
| Etapas | dinámicas de Clientify | 8 etapas canónicas fijas |
| Interacción | solo ver; link externo a Clientify | drag-and-drop entre etapas con guardas; ficha 360° en `/comercial/oportunidades/[id]` |
| Filtros | 3 pipelines por nombre | por servicio, owner, depósito, rango de fecha, monto |
| KPIs de cabecera | open count, pipeline total, won YTD (en memoria) | mismos + forecast ponderado + tasa de cierre (desde dashboard) |

La ficha 360° de la oportunidad reúne: contacto, historial de etapas, cotizaciones, propuestas, contrato, onboarding y actividades de Clientify (ya legibles vía `client.ts:195`).

---

## 7. Vista de oportunidad — campos (del data model)

De `crm_opportunities` ([DATA_MODEL §3.2](./CLIENTIFY_NEXUS_DATA_MODEL.md)): Empresa (`client_id`/`cuit`), Contacto, Servicio (`service_type`), m² (`m2`), Depósito, Estado (`estado`), Probabilidad, Monto, Owner, Cierre esperado, Deal Clientify (`clientify_deal_id`). Coincide con los campos que el handoff pide para "Oportunidades": Empresa, Contacto, Servicio, m², Estado, Probabilidad.

---

## 8. Brechas y orden de implementación

| Brecha | Severidad | Fase |
|---|---|---|
| `crm_opportunities` + `crm_stage_history` no existen | Bloqueante | F2.1 |
| Webhook sin HMAC ni persistencia | Alta (seguridad) | F2.4 |
| Promoción lead→oportunidad inexistente | Alta | F2.2 |
| Outbound sync (mover etapa en Clientify) — solo hay cliente de lectura | Media | F2.4 |
| Tabla de mapeo de stages dinámicos | Media | F2.4 |
| Drag-and-drop con guardas | Media | F2.2 |

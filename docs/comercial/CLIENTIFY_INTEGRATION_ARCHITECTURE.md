# CLIENTIFY_INTEGRATION_ARCHITECTURE — F2.2 · Integración Clientify ↔ Nexus

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1` (F2.2 abrirá rama propia al implementar)
**Fecha:** 2026-06-06
**Iniciativa:** F2.2 — Clientify Integration · **Primera tarea: arquitectura (sin código).**
**Objetivo:** conectar **leads reales** de Clientify al CRM ya construido (F2.1, CLOSED).

> **Estado base (F2.1 CLOSED):** dominio CRM, Capacity Engine, Dashboard, Capture Bridge, Ficha 360°, persistencia y **Write-Path (W-1…W-4)** funcionando y validados en staging. Esta fase **no rediseña** nada de eso: enchufa el tope de embudo.

> **Restricciones vigentes:** staging primero · sin producción · sin `main` · sin Netlify · **sin tocar Clientify PROD** (lectura/diseño sí, escritura no) hasta autorización. Sin código en este documento.

---

## 1. Lo que YA existe (grounding — no se rediseña)

Verificado en el repo hoy:

| Capa | Activo existente | Estado |
|---|---|---|
| **DB** | `crm_leads` (`clientify_id` unique = idempotencia, `raw jsonb`, `owner_id`, `status` enum, `opportunity_id`) | ✅ migrado (0042), validado en staging |
| **DB** | `crm_opportunities` (`clientify_deal_id` unique, `clientify_pipeline`, `lead_id`, `owner_id`) | ✅ migrado (0042) |
| **DB** | `clientify_sync_log` (`direction`, `entity`, `clientify_id`, `nexus_id`, `event`, `status`, `error`, `payload`) | ✅ migrado (0045), ledger |
| **Enum** | `crm_lead_status_t`: `nuevo, contactado, calificado, descartado, promovido` | ✅ (0041) |
| **Código** | `src/lib/clientify/client.ts` — API **solo lectura** (`ping, listContacts, getContact, listCompanies, listPipelines, listDeals, getDeal, listActivities`), auth `Token`, base `api.clientify.net/v1` | ✅ activo |
| **Código** | `src/lib/clientify/types.ts` (`ClientifyDeal/Contact/Pipeline`), `mappers.ts` (`mapDeal/Contact/Pipeline`, status `1=open,2=won,4=lost`), `data.ts` (`getPipelineSnapshot`) | ✅ activo |
| **Código** | `src/lib/clientify.ts` — cliente **huérfano con escritura** (`createContact`/`updateContact` POST/PATCH), **no usado** | ⚠️ deuda (consolidar) |
| **Rutas** | `/api/clientify/webhook` (placeholder: loguea, **sin HMAC, sin persistencia**), `/api/clientify/sync-deals` (pull, sin persistir), `/api/clientify/ping` (diagnóstico) | ⚠️ a completar |
| **Env** | `env.clientify {apiKey, baseUrl, configured}` · `CRON_SECRET` opcional · **`CLIENTIFY_WEBHOOK_SECRET` NO existe aún** | ⚠️ agregar |
| **Write-Path** | `stage-actions.ts` + RPC `0047` (advance/reserve/complete) | ✅ F2.1 W-1…W-4 |
| **Diseño previo** | `CLIENTIFY_NEXUS_DATA_MODEL.md §5` (contrato de sync), `COMMERCIAL_PIPELINE_DESIGN.md §3-§4` (bandeja, promoción, mapeo de etapas) | ✅ fuente de verdad |

**Regla de oro (ratificada):** *Clientify = quién es el lead y de dónde vino; Nexus = qué le cobramos, qué firmó, cómo opera.* **Frontera = etapa `calificado`** (al calificar, el lead se promueve a oportunidad y Nexus pasa a ser SoR).

---

## 2. Arquitectura de la integración (objetivo F2.2)

```
Google Ads / Web ─► Clientify (SoR tope de embudo)
                         │
          ┌──────────────┴───────────────┐
   (1) webhook push                 (2) pull programado (reconciliación)
   POST /api/clientify/webhook      GET /api/clientify/sync-deals (cron)
          │ verificar HMAC ✔               │
          ▼                                ▼
   crm_ingest_lead() ◄── dedup ──► resolución de identidad (cuit/email/phone)
          │  upsert crm_leads (clientify_id unique)
          │  asignación de owner (comercial)
          │  log → clientify_sync_log (inbound)
          ▼
   /comercial/leads  (bandeja)  ──"Calificar"──►  promoteLeadToOpportunity()
          │                                          │ crea crm_opportunities (calificado)
          │                                          │ crm_leads.status='promovido' + opportunity_id
          │                                          │ hereda owner · ledger · log
          ▼                                          ▼
   (3) outbound (Nexus → Clientify)  ◄── al avanzar etapa / ganar / perder
       push Deal stage/status (FASE POSTERIOR — requiere consolidar cliente de escritura)
```

**Tres canales de sync:**
1. **Inbound webhook** (tiempo real): `contact.created` / lead nuevo → upsert `crm_leads`; `deal.updated` (pre-calificación) → espejo de etapa si la opp existe.
2. **Pull de reconciliación** (`sync-deals`, cron): backfill / corrección de derivas; persiste en `clientify_sync_log` + espejo.
3. **Outbound** (Nexus → Clientify): al mover etapa desde Nexus (SoR post-calificación). **Se diseña acá pero se construye después** (depende de consolidar el cliente de escritura — §10, deuda F2.4).

---

## 3. Webhook entrante + verificación HMAC

### 3.1 Handler `POST /api/clientify/webhook` (a completar)
Pasos en orden estricto:
1. **Leer el cuerpo crudo** con `await req.text()` (no `req.json()`): la firma se calcula sobre los bytes exactos recibidos.
2. **Verificar la firma** antes de parsear:
   - Calcular `HMAC-SHA256(rawBody, CLIENTIFY_WEBHOOK_SECRET)` (hex/base64 según el esquema de Clientify).
   - Comparar **timing-safe** (`crypto.timingSafeEqual`) contra el header de firma.
   - Mismatch → **401** sin procesar.
3. **Anti-replay:** si el payload/headers traen timestamp, rechazar si difiere del `now()` más que una tolerancia (p. ej. 5 min). Idempotencia adicional por `event_id` (ver §3.3).
4. **Parsear** y despachar por tipo de evento (§4).
5. **Responder rápido:** `200` al aceptar; `5xx` solo en error transitorio (deja que Clientify reintente); `200 + log 'skipped'` en payload no procesable (evita tormenta de reintentos).
6. **Nunca** loguear el secret ni PII en claro más allá de lo mínimo.

### 3.2 Configuración / env (additivo)
- Nueva env var **`CLIENTIFY_WEBHOOK_SECRET`** (agregar a `env.ts` bajo `clientify`).
- En Clientify → Settings → Webhooks: URL `https://nexus.logisticatops.com/api/clientify/webhook`.

### 3.3 ✅ RESUELTO (F2.2-0) — Clientify NO firma → token-en-URL primario
Investigación oficial (`CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md`): **Clientify no firma sus webhooks** (sin HMAC, sin header de firma, sin secret de entrega). El placeholder `x-clientify-signature`+HMAC **no es implementable**. **Mecanismo adoptado (primario, no fallback):**
- **Token secreto en la URL (path)** `/api/clientify/webhook/<token>` comparado **timing-safe** contra `CLIENTIFY_WEBHOOK_SECRET` → `401` si no coincide.
- **+ HTTPS + idempotencia (`clientify_id`) + reconciliación por pull + IP-allowlist opcional.** El token-en-URL no prueba integridad → lo compensan idempotencia + el pull `sync-deals` como backbone. Degradación conocida y mitigada.
- **Gate pre-prod:** ticket a soporte Clientify (confirmar no-firma / rango de IPs / sandbox).

---

## 4. Ingesta de leads (inbound)

### 4.1 Mapeo Clientify `Contact` → `crm_leads`
| `crm_leads` | Origen Clientify | Nota |
|---|---|---|
| `clientify_id` | `contact.id` | **clave de idempotencia** (unique) |
| `source` | `contact.contact_source` / `contact_medium` | 'google_ads' \| 'web' \| … |
| `full_name`, `email`, `phone` | campos del contacto | |
| `cuit` | custom field si viene | enlaza a `clients` luego |
| `company_name` | `company_name` | |
| `tags` | tags de Clientify | alimenta asignación por servicio |
| `raw` | payload completo | trazabilidad total |
| `status` | default `nuevo` | |

### 4.2 Upsert idempotente
- **Insert-or-update por `clientify_id`** (unique). Reentrega del mismo evento → no duplica.
- **Orden fuera de secuencia:** no pisar datos más nuevos con más viejos → comparar timestamp de Clientify vs `updated_at` (descartar el más viejo, log `skipped`).
- Cada operación → fila en `clientify_sync_log` (`direction='inbound'`, `entity='lead'`, `status` ok/error/skipped, `payload`).

### 4.3 Superficie de escritura segura (sin sesión de usuario)
El webhook es tráfico de máquina sin `auth.uid()`. **No** exponer las tablas a service-role amplio. Diseño:
- **RPC `crm_ingest_lead(payload jsonb)` `SECURITY DEFINER`** (superficie controlada y atómica): hace dedup + upsert `crm_leads` + asignación de owner + `clientify_sync_log`, todo en una transacción. Invocada por el route con **service-role** (o key dedicada).
- `SECURITY DEFINER` acá **sí** está justificado (no hay usuario; la función es la única puerta y valida el payload). Contrasta con el Write-Path (W-1), que es `INVOKER` porque siempre hay usuario. Se documenta el motivo.

---

## 5. Deduplicación

Dos niveles, claves en orden de prioridad:

### 5.1 Lead-level (mismo contacto Clientify)
- **`clientify_id` unique** → reentrega = upsert, nunca duplica.

### 5.2 Identidad humana / cuenta (mismo prospecto por distinta vía)
Cuando llega un lead **sin** `clientify_id` previo pero que podría ser la misma persona/empresa ya conocida, resolución determinista en este orden:
1. **`cuit`** → clave canónica de cuenta (`clients.cuit` unique, `0001`). Si matchea un `clients` existente → enlazar (`crm_leads.cuit` + futura `client_id` en la opp).
2. **`email`** normalizado (lower/trim).
3. **`phone`** normalizado (E.164).
- **Match encontrado:** no crear lead duplicado; **enriquecer** el existente y registrar el cruce en `clientify_sync_log` (`status='skipped'`, nota "dedup: match por <clave>").
- **Sin match:** crear lead nuevo.
- **Cuenta:** `clients.cuit` sigue siendo la clave canónica de deduplicación de cuentas B2B (no se toca).

> **D-4 RESUELTO — crear y marcar.** La deduplicación **nunca** mergea silenciosamente datos en conflicto; ante ambigüedad, **crea el lead** y lo etiqueta "posible duplicado" para revisión humana en la bandeja. Nunca se pierde un lead real.

---

## 6. Ownership y asignación comercial

### 6.1 Universo de owners elegibles
Usuarios **activos** con rol RBAC **`comercial`**: `profiles.active = true` ∧ existe `user_roles(user_id, role_comercial)`. (Lectura segura de nombres vía `profiles_public`, sin email — mandato 0040.)

### 6.2 Reglas de asignación (al crear el lead)
1. **Por servicio/origen** (si es inferible de `tags`/`source`/pipeline): ANMAT → equipo farma; Cargas Generales → equipo general; Oficinas → equipo inmobiliario.
2. **Fallback — menor carga (least-loaded):** entre los owners elegibles, asignar al que **menos leads abiertos** tiene (`status in ('nuevo','contactado','calificado')`). Determinista, sin tabla de estado (a diferencia de round-robin, que requiere un puntero persistente). Empate → orden estable por `owner_id`.
3. Resultado en `crm_leads.owner_id`; **se hereda** a la oportunidad al promover.

> **D-2 RESUELTO — least-loaded.** Regla 1 (por servicio/origen) cuando es inferible; regla 2 (menor carga) como fallback determinista. No requiere tabla de puntero.

### 6.3 Reasignación
- Acción manual en la bandeja (`/comercial/leads`) bajo `comercial.edit` → `crm_leads.owner_id`, registrada en `clientify_sync_log` (o un audit liviano). No se inventa tabla nueva si no hace falta.

---

## 7. Promoción lead → oportunidad (la frontera)

En `calificado` (etapa 3), acción comercial "Calificar":
- **RPC `crm_promote_lead(p_lead uuid, p_fields jsonb)` `SECURITY INVOKER`** (hay usuario → mismo patrón que el Write-Path W-1), atómica:
  1. Valida que el lead no esté ya promovido (idempotencia por `crm_leads.opportunity_id`).
  2. Requiere datos de negocio mínimos (guarda PIPELINE §5.2: `service_type` + `cuit`/`client_id`).
  3. Crea `crm_opportunities` (`estado='calificado'`, hereda `owner_id`, `cuit`, contacto/email/phone del lead, `lead_id`).
  4. Setea `crm_leads.opportunity_id` + `status='promovido'`.
  5. Escribe `crm_stage_history` (alta en `calificado`) y `clientify_sync_log`.
- A partir de acá manda el **Write-Path existente** (advanceStage, reserveCapacity, …). **No se duplica** lógica de etapas.

---

## 8. Modelo de sincronización y resolución de conflictos

### 8.1 Direcciones
| Canal | Disparador | Acción | Idempotencia |
|---|---|---|---|
| Inbound webhook | `contact.created` | upsert `crm_leads` | `clientify_id` |
| Inbound webhook | `deal.updated` (pre-calificación) | espejo de etapa en opp si existe | `clientify_deal_id` |
| Pull (cron) | `sync-deals` | reconciliar deals abiertos/ganados → log + espejo | `clientify_deal_id` |
| **Outbound** (fase posterior) | etapa avanza / ganado / perdido en Nexus | mover `pipeline_stage` / cerrar Deal (`status` 2/4) | por `clientify_deal_id` |

### 8.2 Resolución de conflictos (de `DATA_MODEL §5.3`, ratificada)
- **Etapa:** gana el SoR de esa etapa — Clientify hasta `calificado`, Nexus de `calificado` en adelante.
- **Monto:** Nexus gana una vez hay `crm_quote` aceptada; antes espeja `amount` de Clientify.
- **Cuenta/CUIT:** `clients.cuit` canónico.

### 8.3 Mapeo de etapas (de `PIPELINE §4`, ratificado)
- Status: `1=open, 2=won, 4=lost` (ya en `mappers.ts`).
- Pipeline por servicio: `anmat→ANMAT`, `general→Cargas Generales`, `oficinas→Alquiler de oficinas`.
- Etapas intermedias de Clientify son **dinámicas** → tabla de mapeo configurable **`crm_clientify_stage_map(service_type, crm_stage, clientify_stage_id)`** (evita hardcodear IDs parseados de URLs). Additiva; se usa en el outbound.

---

## 9. Seguridad y RLS

- **Webhook:** HMAC (o fallback §3.3) + raw-body + timing-safe + anti-replay. Secret en env, nunca logueado.
- **Ingesta:** vía **RPC `SECURITY DEFINER`** con superficie mínima, invocada por service-role; **no** se abre service-role a las tablas directamente.
- **Promoción / bandeja:** bajo RLS de usuario (`comercial.edit`), `SECURITY INVOKER` (R-G2 intacto).
- **PII:** nombres de owner vía `profiles_public` (sin email). El `raw` del lead (que sí tiene PII) queda en `crm_leads.raw` bajo RLS `comercial.view`.
- **Cron `sync-deals`:** protegido por `CRON_SECRET` (ya soportado).

---

## 10. Deuda técnica a resolver dentro de F2.2 / borde F2.4

| # | Deuda | Acción |
|---|---|---|
| T-1 | **Dos clientes Clientify** (`clientify/client.ts` solo-lectura ✅ usado · `clientify.ts` escritura ⚠️ huérfano) | Consolidar en **uno** con auth `Token` + base `api.clientify.net/v1`, lectura+escritura. **Prerequisito del outbound.** |
| T-2 | `CLIENTIFY_WEBHOOK_SECRET` ausente en `env.ts` | Agregar (additivo) |
| T-3 | Confirmar capacidad de firma de webhooks de Clientify (§3.3) | Verificación previa a codear el handler |

---

## 11. Migraciones y env (additivo — NO ejecutado acá)

| Artefacto | Tipo | Nota |
|---|---|---|
| `crm_ingest_lead(jsonb)` | RPC `SECURITY DEFINER` | upsert+dedup+asignación+log atómico |
| `crm_promote_lead(uuid, jsonb)` | RPC `SECURITY INVOKER` | promoción a oportunidad |
| `crm_clientify_stage_map` | tabla config | mapeo de etapas dinámicas (outbound) |
| `CLIENTIFY_WEBHOOK_SECRET` | env var | secreto del webhook |

Todo additivo (no toca tablas/enums existentes). Numeración a partir de `0048`. Se aplica **solo en staging**, validado con el patrón `pg` + `BEGIN…ROLLBACK` (igual que F2.1).

---

## 12. Secuencia de construcción propuesta (sub-fases F2.2, staging primero)

| Paso | Entregable | Validación |
|---|---|---|
| **F2.2-0** | Confirmar firma de webhook Clientify (§3.3) + consolidar cliente (T-1) + `env` (T-2) | — |
| **F2.2-1** | `crm_ingest_lead` (RPC) + upsert/dedup/asignación | staging (tx+rollback) |
| **F2.2-2** | Handler webhook con HMAC + ingesta real + `clientify_sync_log` | staging + payloads simulados firmados |
| **F2.2-3** | Bandeja `/comercial/leads` (lista + reasignar) | build + lint |
| **F2.2-4** | `crm_promote_lead` + acción "Calificar" → enchufa Write-Path | staging |
| **F2.2-5** | Pull `sync-deals` → persistencia/reconciliación | staging |
| **F2.2-6** (borde F2.4) | Outbound Nexus→Clientify + `stage_map` | staging + sandbox Clientify |

---

## 13. Decisiones abiertas / riesgos

| # | Punto | Estado |
|---|---|---|
| D-1 | **Alcance F2.2.** | ✅ **RESUELTO — inbound-first** (leads + dedup + asignación + bandeja + promoción). Outbound = F2.2-6/F2.4. |
| D-2 | **Estrategia de asignación.** | ✅ **RESUELTO — least-loaded** (por servicio/origen si es inferible; fallback al comercial activo con menos leads abiertos). |
| D-4 | **Dedup ambiguo.** | ✅ **RESUELTO — crear y marcar** ('posible duplicado' → revisión humana en la bandeja; nunca se pierde un lead ni se mergea en conflicto). |
| D-3 | **Firma de webhook Clientify.** | ✅ **RESUELTO (F2.2-0)** — Clientify **no firma**; auth = **token-en-URL** + idempotencia + reconciliación (`CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md`). Gate pre-prod: confirmar con soporte. |
| D-5 | Sandbox/tenant de prueba de Clientify para no tocar PROD al validar outbound. | ⏳ Operativa (relevante recién en F2.2-6/F2.4). |

> Con D-1 resuelto (inbound-first), el alcance ejecutable de F2.2 es **F2.2-0 → F2.2-5**; el outbound (F2.2-6) se trata como borde F2.4 y no bloquea la entrega de valor (recibir y operar leads reales).

---

## 14. Lo que NO se toca

- ❌ Producción, `main`, Netlify, **Clientify PROD** (escritura), Supabase PROD.
- ❌ Dominio CRM, Write-Path (0047), Capacity Engine, Dashboard, Ficha 360° — se **consumen**, no se modifican.
- ❌ El cliente de lectura `clientify/client.ts` (se extiende/consolida, no se rompe).

---

*Arquitectura previa a código. Sin migraciones, sin ramas nuevas, sin commits. Esperando decisiones (D-1, D-2 en especial) y la confirmación de §3.3 para abrir F2.2-0.*

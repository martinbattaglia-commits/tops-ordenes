# COMMERCIAL_MODULE_MASTER_PLAN

**Proyecto:** TOPS Nexus — Módulo CRM Comercial
**Empresa:** Logística TOPS (Verotin S.A.)
**Fase:** 1 — Auditoría funcional y diseño de arquitectura (sin código)
**Fecha:** 2026-06-04
**Decisión de arquitectura:** Híbrido por etapa (Clientify = tope de embudo · Nexus = objetos comerciales estructurados + operación)

> Este documento es el plan maestro. Los otros 4 entregables lo referencian:
> [CLIENTIFY_NEXUS_DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md) ·
> [COMMERCIAL_PIPELINE_DESIGN](./COMMERCIAL_PIPELINE_DESIGN.md) ·
> [ONBOARDING_AUTOMATION_DESIGN](./ONBOARDING_AUTOMATION_DESIGN.md) ·
> [COMMERCIAL_KPI_DASHBOARD](./COMMERCIAL_KPI_DASHBOARD.md)

---

## 0. Resumen ejecutivo

El objetivo estratégico es convertir TOPS Nexus en el sistema operativo integral de Logística TOPS, cubriendo la cadena completa:

```
Google Ads → Clientify → TOPS Nexus → Cotización → Propuesta PDF
   → Contrato → Onboarding → Operación → Facturación
```

**Hallazgo central de la auditoría:** una parte sustancial ya existe. No partimos de cero.

| Capa | Estado real (verificado en código) |
|---|---|
| Integración Clientify (lectura) | **Construida y viva** — contactos, empresas, deals, pipelines, actividades (`src/lib/clientify/`) |
| Sync bidireccional / persistencia | **No construida** — `sync-deals` resume pero no persiste; webhook es stub sin HMAC (diferido a "F2.7" en el código) |
| Pipeline UI | **Construida** — kanban alimentado por deals de Clientify (`comercial/pipeline`) |
| Cotizador | **Construido** — tarifario real MAYO/2026, PDF por `window.print()`, **sin persistencia** (`public/tools/cotizador`) |
| Propuestas ANMAT / General | **Construidas** — generadores PDF, **sin persistencia** (solo localStorage) |
| Clients | **Tabla Supabase real** `clients` (clave CUIT) + sync híbrido con Clientify Companies |
| RBAC `comercial` | **Ya sembrado** — módulo + permisos `comercial.view`/`comercial.edit` + rol `comercial` (`0009_rbac.sql`) |
| Objetos estructurados (oportunidad, cotización, propuesta, contrato, onboarding) | **No existen como tablas** — solo blobs en `documents` (`'contrato'`, `'presupuesto'`) |
| KPIs comerciales | **No existen** — el pipeline calcula un snapshot efímero en memoria |

**Conclusión:** la Fase 2 no es "construir un CRM"; es **persistir, estructurar y cerrar el lazo** sobre lo que ya hay: convertir el cotizador y las propuestas (hoy efímeros) en objetos versionados y trazables, materializar las oportunidades en Postgres, cerrar el sync con Clientify, y automatizar el handoff a operación.

---

## 1. Principio de arquitectura: Híbrido por etapa

Cada etapa del embudo tiene **un único sistema de registro (system of record, SoR)**. Esto evita el doble-conteo y define dónde se escribe.

| Etapa del embudo | SoR | Por qué |
|---|---|---|
| Captación (Google Ads) | Clientify | Clientify ya recibe los leads de campañas; es su fortaleza nativa (marketing automation, formularios, scoring) |
| Lead / Contactado / Calificado | **Clientify** | Trabajo de SDR/marketing; Nexus lo **espeja** (read + cache) para visibilidad y KPIs |
| Calificado → **Oportunidad estructurada** | **Nexus** | A partir de aquí entran datos del negocio TOPS: m², tipo de servicio (ANMAT / Cargas Generales / Oficinas), depósito, probabilidad. Clientify no modela m² ni custodia |
| Cotización | **Nexus** | El cotizador y su tarifario MAYO/2026 ya viven en Nexus |
| Propuesta PDF | **Nexus** | Los generadores ANMAT/General ya viven en Nexus |
| Negociación | **Nexus** (deal espejado a Clientify) | El monto/forecast se gestiona sobre la cotización estructurada |
| Ganado / Perdido | **Nexus**, escribe a Clientify | El cierre dispara onboarding y debe reflejarse en Clientify para reporting de marketing |
| Contrato / Onboarding / Operación / Facturación | **Nexus** | Dominio 100% operativo de TOPS (WMS, custodia, ARCA) |

> **Regla de oro del sync:** Clientify es SoR de *quién es el lead y de dónde vino*; Nexus es SoR de *qué le vamos a cobrar, qué firmó y cómo opera*. La frontera es la etapa **Calificado → Oportunidad**.

### 1.1 Matriz de System of Record por dominio (definición confirmada)

Enumeración explícita acordada con el negocio. Cada dominio tiene **un único** dueño:

| Dominio | System of Record | Nota |
|---|---|---|
| Leads | **Clientify** | Captación y nutrición |
| Contactos | **Clientify** | Personas; Nexus solo lee (`contactos` ya funciona) |
| Empresas | **Clientify** (comercial) | Nexus mantiene proyección operativa en `clients` por CUIT para integridad de FKs (orders/WMS/facturación) |
| Marketing | **Clientify** | Campañas, automatizaciones, scoring |
| Google Ads | **Clientify** | Origen de leads |
| WhatsApp | **Clientify** (marketing/SDR) | Nexus conserva su `api/whatsapp/send` **solo** para notificaciones operativas (onboarding, despacho), no para secuencias comerciales |
| Email | **Clientify** (marketing/SDR) | Ídem: Nexus `lib/email.ts` solo para transaccional/operativo |
| SDR | **Clientify** | Prospección y agendamiento |
| **Oportunidades** | **Nexus** | Estructuradas: m², servicio, probabilidad, estado |
| **Cotizaciones** | **Nexus** | Persistidas (hoy el cotizador es efímero) |
| **Propuestas** | **Nexus** | Versionadas con PDF guardado (hoy localStorage) |
| **Contratos** | **Nexus** | Generación, versionado, firma |
| **Onboarding** | **Nexus** | Checklist automático (RNE, croquis, plancheta, accesos, docs) |
| **Cliente activo** | **Nexus** | `clients.activo = true` |
| **Operación** | **Nexus** | WMS, custodia, pedidos, órdenes |
| **Facturación** | **Nexus** | ARCA (productivo) |
| **KPIs ejecutivos** | **Nexus** | Dashboard comercial |

**Regla de transición (única frontera de escritura):**
```
Lead calificado en Clientify  ──►  Crear Oportunidad en Nexus
                                    (desde aquí Nexus es dueño del proceso)
```
Antes de la frontera, Nexus **espeja** Clientify (lectura + cache). Después, Nexus es SoR y **empuja** el estado del deal hacia Clientify para cerrar el reporting de marketing. **No se duplica el CRM de marketing de Clientify** (sin reimplementar formularios, scoring, campañas ni secuencias).

Detalle del contrato de sincronización (campos, dirección, idempotencia) en [CLIENTIFY_NEXUS_DATA_MODEL §5](./CLIENTIFY_NEXUS_DATA_MODEL.md).

---

## 2. Mapa de módulos objetivo

El módulo `comercial` ya existe en la navegación y en RBAC. La Fase 2 lo expande de 2 sub-rutas (pipeline, contactos) + herramientas a un CRM completo.

```
/comercial
├── /pipeline           [EXISTE] kanban — pasa de "solo lectura Clientify" a "oportunidades Nexus + espejo Clientify"
├── /contactos          [EXISTE] lectura Clientify — se mantiene
├── /leads              [NUEVO]  bandeja de leads sincronizados desde Clientify (webhook)
├── /oportunidades      [NUEVO]  CRUD de oportunidades estructuradas (m², servicio, probabilidad, estado)
│   └── /[id]           [NUEVO]  ficha 360°: contacto, cotizaciones, propuestas, contrato, onboarding
├── /cotizaciones       [NUEVO]  cotizaciones persistidas (hoy el cotizador es efímero)
├── /propuestas         [NUEVO]  propuestas versionadas con PDF guardado (hoy localStorage)
├── /contratos          [NUEVO]  generación, versionado, firma
├── /onboarding         [NUEVO]  checklist automático (RNE, croquis, plancheta, accesos, docs)
├── /herramientas       [EXISTE] cotizador + propuesta-anmat + propuesta-general (se integran a /cotizaciones)
└── /dashboard          [NUEVO]  KPIs ejecutivos (forecast, tasa de cierre, vacancia, m² potenciales)
```

Cada sub-módulo nuevo respeta el patrón existente del repo: server components con `force-dynamic`, server actions con validación Zod, RLS por rol vía los helpers de `0005_fix_rls_recursion.sql`.

---

## 3. Componentes — estado y plan

### 3.1 Leads
- **Origen:** Clientify (Google Ads → Clientify → webhook → Nexus).
- **Hoy:** webhook es un stub (`api/clientify/webhook/route.ts`) que loguea y devuelve `{ ok: true }`; **sin verificación HMAC, sin persistencia.**
- **Plan:** implementar verificación de firma, persistir el evento en `crm_leads` + `clientify_sync_log`, y disparar reglas (asignación de owner, creación de tarea). Ver [PIPELINE §3](./COMMERCIAL_PIPELINE_DESIGN.md).

### 3.2 Oportunidades
- **Hoy:** no existen como entidad; el "deal" vive solo en Clientify y se lee en el kanban.
- **Plan:** tabla `crm_opportunities` con `client_id` (FK a `clients` por CUIT), `contacto`, `service_type` (anmat/general/oficinas), `m2`, `estado` (etapa), `probabilidad`, `monto`, `owner`, `clientify_deal_id`. Es el **eje** del módulo: cotizaciones, propuestas y contrato cuelgan de ella.

### 3.3 Propuestas (Cotización → Propuesta PDF)
- **Hoy:** cotizador y propuestas funcionan pero son **efímeros** (cotizador no guarda nada; propuestas usan localStorage). El PDF se hace por `window.print()`.
- **Plan:**
  - Persistir cada cotización en `crm_quotes` + `crm_quote_items` (tarifario, descuentos, IVA 21%, total) ligada a una oportunidad.
  - Persistir cada propuesta en `crm_proposals` (tipo ANMAT/General, versión, estado, PDF guardado en `documents` como `'presupuesto'`).
  - Mantener los artefactos HTML actuales como capa de presentación; el cambio es **capturar el resultado**, no reescribir la lógica de cálculo (ver nota de no-tocar en `ToolEmbed.tsx`).

### 3.4 Contratos
- **Hoy:** no existe entidad; `documents` ya soporta el tipo `'contrato'`.
- **Plan:** `crm_contracts` (oportunidad, cliente, versión, estado draft/enviado/firmado, `signed_at`, PDF → `documents`). Generación automática desde la propuesta ganada; versionado; firma (campo de estado + evidencia, reutilizando el patrón de custodia/evidencia de `0038`).

### 3.5 Onboarding
- **Hoy:** no existe; el backbone operativo (`orders`, `logistics_orders`, custodia) sí.
- **Plan:** al pasar la oportunidad a **Ganado**, crear automáticamente un `crm_onboarding` + checklist (`crm_onboarding_tasks`): RNE, croquis, plancheta, accesos, documentación. Alta automática del cliente como activo. Handoff a operación. Detalle en [ONBOARDING_AUTOMATION_DESIGN](./ONBOARDING_AUTOMATION_DESIGN.md).

### 3.6 Cliente Activo
- **Hoy:** `clients.activo boolean` ya existe (`0004_extended_schema.sql`).
- **Plan:** la automatización de onboarding marca `activo = true` y deja el cliente listo para operar (WMS / pedidos / facturación).

### 3.7 Dashboard Ejecutivo
- **Hoy:** el pipeline calcula un snapshot en memoria (open count, total, won YTD); no hay dashboard.
- **Plan:** `/comercial/dashboard` con pipeline total, forecast ponderado, tasa de cierre, ciclo de venta, vacancia (cruce con WMS), m² potenciales, facturación proyectada (cruce con ARCA). Definiciones en [COMMERCIAL_KPI_DASHBOARD](./COMMERCIAL_KPI_DASHBOARD.md).

---

## 4. RBAC y seguridad

- El módulo `comercial` **ya está en el enum `permission_module_t`** y sembrado en `0009_rbac.sql` con `comercial.view`, `comercial.edit` y rol `comercial`. **No se requiere migración de enum.**
- **Ampliación propuesta** (siguiendo el patrón de seed de `0022`/`0030`): `comercial.create`, `comercial.delete`, `comercial.admin`, y permisos de onboarding (`comercial.onboarding` o reutilizar `operaciones`).
- **PII:** la lectura del owner/vendedor asignado debe respetar el lockdown de `0040_profiles_pii_lockdown.sql` — no leer `profiles` directo desde cliente; usar una vista `profiles_public(id, full_name)` (sin email) como prescribe la nota de esa migración.
- **RLS:** toda tabla nueva reutiliza los helpers `current_role()`, `is_staff()`, `is_admin()` de `0005`. Patrón: lectura = staff o scope por `client_id`; escritura = staff; borrado = admin (soft-delete `deleted_at` estilo `documents`).

---

## 5. Roadmap por fases (propuesta, sin ejecutar)

| Fase | Nombre | Entregable | Depende de |
|---|---|---|---|
| **F2.1** | Cimientos de datos | Migraciones: `crm_opportunities`, `crm_quotes(+items)`, `crm_proposals`, `crm_contracts`, `crm_onboarding(+tasks)`, `crm_stage_history`, `clientify_sync_log` | Aprobación del data model |
| **F2.2** | Oportunidades | CRUD `/comercial/oportunidades` + ficha 360° | F2.1 |
| **F2.3** | Persistencia comercial | Guardar cotizaciones y propuestas (capturar salida de los artefactos existentes) | F2.2 |
| **F2.4** | Cierre de sync Clientify | Webhook con HMAC + persistencia + `sync-deals` → cache; espejo bidireccional | F2.1 |
| **F2.5** | Contratos | Generación, versionado, firma | F2.3 |
| **F2.6** | Onboarding automático | Trigger Ganado → checklist + alta cliente + handoff operación | F2.5 |
| **F2.7** | Dashboard ejecutivo | KPIs + vistas materializadas | F2.2–F2.6 |

> Cada fase es una migración + UI aislada, siguiendo la cadencia de "gates" del repo (`docs/handoff/GATE_*`). Ninguna toca producción/Netlify/Supabase PROD sin autorización explícita (restricción activa del handoff maestro).

---

## 6. Restricciones y no-objetivos (Fase 1)

- **No** escribir código, **no** commits, **no** deploy (Fase 1 = diseño).
- **No** tocar: Producción, Netlify, Neuralsoft, Supabase PROD (sin autorización explícita).
- **No** reescribir la lógica de cálculo del cotizador ni de las propuestas: son artefactos validados; solo se captura su salida.
- **No** duplicar el CRM de marketing de Clientify: Nexus no reimplementa formularios, scoring ni campañas.

---

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Doble fuente de verdad lead/deal | Doble conteo en forecast | Frontera estricta por etapa (§1); `clientify_deal_id` como clave de espejo idempotente |
| Cotizador/propuestas son HTML opacos (bundle gzip) | Difícil capturar la salida estructurada | Definir un contrato de salida (postMessage / payload JSON) desde el artefacto al host antes de persistir |
| Webhook sin HMAC | Inyección de leads falsos | Verificación de firma obligatoria en F2.4 antes de exponer |
| Cruce de vacancia con WMS | KPI incorrecto | ✅ **Resuelto**: fuente oficial = Digital Twin / sector ([VACANCY_SOURCE_OF_TRUTH_ANALYSIS](./VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md)). Pendiente operativo (no bloquea F2.1): m² Luján, confirmación legacy |
| PII de owners | Fuga (hallazgo F-01-R ya remediado) | Vista `profiles_public` por `0040` |

---

## 8. Próximos pasos

1. ✅ Validar la decisión híbrida y el data model con el negocio — **ratificado** (Híbrido por etapa, §1.1).
2. ✅ Confirmar la fuente de **vacancia** — **ratificado**: Digital Twin / sector ([VACANCY_SOURCE_OF_TRUTH_ANALYSIS](./VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md)).
3. Aprobar el set de tablas de [CLIENTIFY_NEXUS_DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md) → **autoriza F2.1** (DDL + RLS + modelo CRM).
4. En paralelo (no bloquean F2.1): cargar m² de Luján (G1) y confirmar ocupación legacy con operaciones (G6).
5. Iniciar F2.1 en rama de feature, fuera de PROD (restricción del handoff maestro).

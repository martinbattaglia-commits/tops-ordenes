# CRM_UX_REVIEW — Validación de la experiencia completa (antes de construir UI)

**Módulo:** CRM Comercial Nexus · **Tipo:** Review de UX / flujo · **Fecha:** 2026-06-04
**Alcance:** validar el flujo `Lead → Oportunidad → Capacidad → Cotización → Propuesta → Contrato → Onboarding → Cliente Activo`.
**Sin código · sin migraciones · sin RBAC.** Primero la experiencia; luego F2.1-3.
**Base:** dominio [CRM_DOMAIN_ARCHITECTURE](./CRM_DOMAIN_ARCHITECTURE.md) · flujo [F2.1_ARCHITECTURE](./COMMERCIAL_F2_1_ARCHITECTURE.md) · pipeline [PIPELINE](./COMMERCIAL_PIPELINE_DESIGN.md) · onboarding [ONBOARDING](./ONBOARDING_AUTOMATION_DESIGN.md).

---

## 1. Sitemap CRM

```
/comercial   (dominio "Comercial · CRM")
│
├── /dashboard-comercial      [NUEVO]  landing por rol (vendedor/gerente/ops)
│
├── EMBUDO
│   ├── /leads                [NUEVO]  bandeja de leads (espejo Clientify)
│   ├── /pipeline             [EXISTE→evoluciona] kanban sobre crm_opportunities
│   └── /oportunidades        [NUEVO]  lista + filtros
│       └── /[id]             [NUEVO]  ★ FICHA 360° (hub central del flujo)
│           ├── #capacidad     panel findAvailability()
│           ├── #cotizaciones  crm_quotes
│           ├── #propuestas    crm_proposals
│           ├── #contrato      crm_contracts
│           ├── #onboarding    crm_onboarding + tasks
│           └── #historial     crm_stage_history
│
├── DOCUMENTOS COMERCIALES
│   ├── /cotizaciones         [NUEVO]  índice global (atajo; el alta vive en la ficha)
│   ├── /propuestas           [NUEVO]  índice global
│   └── /contratos            [NUEVO]  índice global
│
├── ONBOARDING
│   └── /onboarding           [NUEVO]  tablero de altas en curso (vista operaciones)
│
├── HERRAMIENTAS (existentes, se integran a la ficha)
│   ├── /herramientas/cotizador          [EXISTE]  → se invoca desde una oportunidad
│   ├── /herramientas/propuesta-anmat    [EXISTE]  → idem
│   └── /herramientas/propuesta-general  [EXISTE]  → idem
│
├── CAPACIDAD (ya construido)
│   ├── /mapa-lujan           [EXISTE]
│   ├── /mapa-magaldi         [EXISTE]
│   └── /dashboard-vacancia   [EXISTE]  consume el Motor Corporativo
│
└── CONTACTOS / CUENTAS
    ├── /contactos            [EXISTE]  lectura Clientify
    └── /clients (módulo)     [EXISTE]  cuentas B2B (Supabase, CUIT)
```

**Principio:** la **ficha 360° de la oportunidad** (`/oportunidades/[id]`) es el centro de gravedad. Todo el flujo (capacidad, cotización, propuesta, contrato, onboarding) se opera **desde ahí**, en pestañas/secciones. Los índices globales (`/cotizaciones`, etc.) son atajos de lectura, no el punto de alta.

---

## 2. Navegación

| Mecanismo | Diseño |
|---|---|
| **Sidebar** (dominio "Comercial · CRM") | agrupar en 3 bloques: *Embudo* (Leads, Pipeline, Oportunidades), *Documentos* (Cotizaciones, Propuestas, Contratos), *Capacidad* (Mapas, Vacancia). Hoy todo está plano — reordenar. |
| **Landing por rol** | al entrar a `/comercial`: vendedor → su pipeline; gerente → forecast+vacancia; operaciones → cola de onboarding. |
| **Breadcrumbs** | `Comercial / Oportunidades / OPP-2026-0042 (Empresa X)` |
| **Navegación intra-ficha** | pestañas dentro de `/oportunidades/[id]`: Resumen · Capacidad · Cotizaciones · Propuestas · Contrato · Onboarding · Historial |
| **Acciones de avance** | botón primario contextual por etapa ("Calificar", "Cotizar", "Generar propuesta", "Marcar ganado", "Iniciar onboarding") — guía el happy path |
| **Salto a Clientify** | desde Lead/Contacto, deep-link a Clientify (ya existe en `/contactos`) — la frontera es visible |

> **Regla de navegación:** el usuario nunca debería preguntarse "¿y ahora dónde voy?". Cada etapa expone su **siguiente acción** como botón primario en la ficha.

---

## 3. Pantallas necesarias (inventario)

| # | Pantalla | Propósito | Datos | Actor principal | Estado |
|---|---|---|---|---|---|
| 1 | Bandeja de Leads | triage de leads de Clientify | `crm_leads` | SDR/Vendedor | NUEVO |
| 2 | Pipeline (kanban) | mover oportunidades por etapa | `crm_opportunities` | Vendedor/Gerente | EVOLUCIONA |
| 3 | Lista Oportunidades | buscar/filtrar | `crm_opportunities` | Vendedor | NUEVO |
| 4 | **Ficha 360° Oportunidad** | hub del flujo | todo `crm_*` de la opp | Vendedor | NUEVO ★ |
| 5 | Panel Capacidad (en ficha) | feasibility + sugerencia sede/sector | motor `findAvailability` | Vendedor | NUEVO |
| 6 | Cotizador (invocado) | calcular cotización | artefacto existente + `crm_quotes` | Vendedor | EXISTE+puente |
| 7 | Generador Propuesta (invocado) | PDF ANMAT/General | artefacto existente + `crm_proposals` | Vendedor | EXISTE+puente |
| 8 | Contrato (en ficha) | generar/versionar/firmar | `crm_contracts` | Vendedor/Admin | NUEVO |
| 9 | Tablero Onboarding | checklist por cliente | `crm_onboarding(+tasks)` | Operaciones | NUEVO |
| 10 | Dashboard por rol | KPIs/forecast/vacancia | motor + `crm_*` | Gerente | NUEVO |
| 11 | Índices (cotiz/prop/contratos) | lectura global | `crm_*` | Vendedor/Gerente | NUEVO (liviano) |

**Pantallas ya construidas que el flujo reutiliza:** mapas Luján/Magaldi, dashboard de vacancia, contactos Clientify, clientes B2B.

---

## 4. Roles involucrados

| Rol | Dónde trabaja | Responsabilidad en el flujo |
|---|---|---|
| **SDR / Marketing** | **Clientify** (no Nexus) | captar y nutrir leads; calificar inicialmente |
| **Vendedor (rol `comercial`)** | Nexus | dueño de la oportunidad: califica→cotiza→propone→negocia→gana |
| **Gerente Comercial** | Nexus | forecast, revisión de pipeline, aprobación de descuentos/condiciones, vacancia |
| **Operaciones (`operaciones`/`supervisor`)** | Nexus | onboarding (croquis, plancheta, accesos), asignación física de espacio |
| **Admin** | Nexus | RBAC, overrides, borrados, firma de contratos |
| **Cliente B2B** (futuro portal) | externo | recibe propuesta/contrato, firma (hoy fuera de Nexus) |

> Frontera de sistema: **SDR/marketing viven en Clientify**; desde "Calificado → Oportunidad" el dueño es el **Vendedor en Nexus** (híbrido por etapa ratificado).

---

## 5. Flujo usuario por usuario

### 5.1 SDR / Marketing (en Clientify)
Capta lead (Google Ads/web) → lo nutre → lo **califica**. Nexus **espeja** el lead (`crm_leads` vía webhook) y lo muestra en la *Bandeja de Leads* con su origen. **No trabaja en Nexus.**

### 5.2 Vendedor — el recorrido central
1. **Lead → Oportunidad:** en la *Bandeja de Leads*, ve un lead calificado. Acción **"Crear oportunidad"** → abre la *Ficha 360°* con `service_type`, m² estimado, CUIT. (Frontera: a partir de acá Nexus es dueño.)
2. **Capacidad (inmediata):** la ficha muestra un **badge de feasibility** — `findAvailability({category, m2})` responde "✅ entra en Luján PB8" o "⚠️ no hay bloque único". *Esto pasa ANTES de cotizar* — no se cotiza lo inexistente.
3. **Cotización:** botón **"Cotizar"** abre el cotizador (artefacto existente) precargado con servicio/m². Al confirmar, la salida se **guarda** como `crm_quotes` (hoy es efímera → necesita un puente).
4. **Propuesta:** botón **"Generar propuesta"** abre el generador ANMAT/General. El PDF se **persiste** (`crm_proposals` + documento). La propuesta sugiere la sede/sector del paso 2.
5. **Negociación:** ajusta precio/condiciones; el m² pasa a **reservado** (soft-hold visible para que otros vendedores no lo revendan).
6. **Ganado:** al firmar contrato (`crm_contracts.firmado`), acción **"Marcar ganado"** → m² pasa a **comprometido** → dispara onboarding.

### 5.3 Gerente Comercial
Vive en el *Dashboard por rol*: forecast ponderado (cruzado con feasibility — no cuenta lo que no entra), tasa de cierre, **vacancia comercial** (capacidad − ocupado − comprometido). Revisa el pipeline, aprueba descuentos.

### 5.4 Operaciones
Recibe el *Tablero de Onboarding* cuando una opp se gana: checklist auto-generado (RNE, croquis, plancheta, accesos, documentación) según `service_type` (ANMAT exige RNE+plancheta). Completa tareas, **asigna el espacio físico**. Al completar → cliente `activo` + el m² pasa de **comprometido → ocupado** (regla anti-doble-conteo).

### 5.5 Admin
RBAC, firma/override de contratos, borrados (soft-delete). Transversal.

### 5.6 Cliente Activo (resultado)
Queda dado de alta, operando en WMS/Pedidos/OS, facturado por ARCA. (Portal cliente = futuro.)

---

## 6. Riesgos UX

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| R-1 | **Cotizador/propuestas son artefactos opacos (iframe/HTML)** — capturar su salida estructurada para `crm_quotes`/`crm_proposals` no es trivial; riesgo de doble carga o pérdida del dato | 🔴 Alta | Definir un **contrato de salida (postMessage/JSON)** del artefacto al host ANTES de construir; o un "Guardar en Nexus" dentro del artefacto. Es el mayor riesgo técnico-UX |
| R-2 | **Confusión de sistema** (¿contacto en Clientify o Nexus?) | 🟠 Media | Frontera visible: una sola acción "Crear oportunidad" como puerta; deep-links claros a Clientify; nunca duplicar edición de contactos |
| R-3 | **Vender capacidad inexistente** si feasibility aparece tarde | 🔴 Alta | Badge de capacidad en la ficha **desde la creación** de la oportunidad y en cada cotización; bloquear "Generar propuesta" si `capacity_feasible=false` sin override |
| R-4 | **Overselling del mismo m²** entre vendedores (no se ve el reservado) | 🟠 Media | Mostrar **m² reservado/comprometido** en el dashboard de vacancia y en la ficha; el motor descuenta committed |
| R-5 | **Guardas de etapa confusas** (no deja pasar a "ganado") | 🟡 Baja | Mensaje explícito: "Falta contrato firmado para marcar ganado"; checklist de requisitos por etapa |
| R-6 | **Handoff comercial→operaciones se cae** | 🟠 Media | Onboarding aparece automático en el tablero de Operaciones + notificación; ownership explícito por tarea |
| R-7 | **Ficha 360° sobrecargada** (demasiada info) | 🟡 Baja | Pestañas + estado colapsado; mostrar solo la "siguiente acción" prominente |
| R-8 | **Uso en visita/depósito (móvil)** | 🟡 Baja | La etapa *Visita* y el onboarding pueden requerir mobile/tablet; priorizar responsive en ficha y checklist |
| R-9 | **PII de owners** (emails/nombres) | 🟠 Media | Vista `profiles_public` (sin email) — ya previsto; no exponer `profiles` directo |
| R-10 | **Doble conteo capacidad** si onboarding no actualiza ocupación | 🔴 Alta | Regla `comprometido→ocupado` al completar onboarding debe ser visible y automática; sin ella el forecast miente |

---

## 7. Recomendaciones antes de construir UI

1. **Resolver R-1 primero (puente cotizador/propuesta).** Definir el contrato de captura de salida de los artefactos existentes. Sin esto, la persistencia de cotizaciones/propuestas queda coja. *Decisión bloqueante de UI.*
2. **La Ficha 360° es el MVP, no el pipeline.** Construir primero `/oportunidades/[id]` (hub) con capacidad inline; el kanban drag-and-drop es secundario.
3. **Capacidad inline, no en otra pantalla.** El badge `findAvailability` vive en la ficha y en el cotizador, no obliga a ir al dashboard de vacancia.
4. **Una sola "puerta" Clientify→Nexus:** la acción "Crear oportunidad" desde el lead. Todo lo anterior es Clientify.
5. **Landing por rol** desde el día uno (vendedor/gerente/operaciones ven cosas distintas) — evita la sobrecarga.
6. **Mostrar el estado de compromiso** (reservado/comprometido) en vacancia y ficha para evitar overselling (R-4).
7. **Happy-path guiado:** botón "siguiente acción" por etapa; navegación libre como respaldo, no como default.
8. **Construir incremental:** (a) ficha + oportunidad CRUD + capacidad → (b) cotización/propuesta persistidas → (c) contrato → (d) onboarding → (e) pipeline drag-drop + dashboards. Cada uno entregable y testeable.
9. **Responsive en ficha y checklist de onboarding** (uso en depósito).
10. **No construir índices globales pesados al inicio:** `/cotizaciones` etc. pueden ser tablas simples; el alta vive en la ficha.

---

## 8. Decisiones UX a ratificar (antes de UI)

| # | Decisión | Por qué importa |
|---|---|---|
| UX-1 | **Puente de captura** del cotizador/propuestas: ¿postMessage del artefacto, "Guardar en Nexus" embebido, o reescritura nativa? | Define R-1; condiciona toda la persistencia comercial |
| UX-2 | ¿La Ficha 360° usa **pestañas** o scroll de secciones? | Densidad de información |
| UX-3 | ¿`/cotizaciones`, `/propuestas`, `/contratos` son **rutas propias** o solo secciones de la ficha + un índice? | Tamaño del sitemap |
| UX-4 | ¿Hay **portal de cliente** (firma/seguimiento) en el alcance, o queda fuera? | Frontera del flujo |
| UX-5 | Orden de construcción incremental (§7.8) | Prioridad del backlog de UI |

---

## 9. Conclusión

El flujo de 8 etapas es **coherente y construible**, con la **Ficha 360° de la oportunidad** como centro y el **Motor de Capacidad** integrado inline. Los tres riesgos altos (R-1 puente de artefactos, R-3 feasibility temprana, R-10 anti-doble-conteo) deben resolverse en diseño **antes** de escribir UI. La recomendación es construir incremental empezando por la ficha + capacidad, no por el pipeline.

> Validada la experiencia, el siguiente paso técnico es **F2.1-3** (RBAC seed + `profiles_public`), y recién después la UI siguiendo §7.8. **Sin código/migraciones/RBAC en este documento.**

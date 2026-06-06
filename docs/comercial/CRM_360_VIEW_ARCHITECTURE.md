# CRM_360_VIEW_ARCHITECTURE — Ficha 360° de Oportunidad (F2.1-6)

**Frente:** F2.1-6 · **Rama:** `feature/crm-comercial-f2-1` · **Fecha:** 2026-06-06
**Objetivo:** la **pantalla central del CRM** — una vista única que integra Opportunity + Capacity + Quote + Proposal + Contract + Onboarding.
**Alcance:** experiencia principal de Comercial, con **implementación local** (datos de muestra). **Sin Clientify, sin webhook HMAC** (frentes posteriores).

---

## 1. Arquitectura

### 1.1 Capas
```
UI (cliente)            Opportunity360View.tsx  ── tabs + pipeline + capacidad
   ▲ props
Server loader           [id]/page.tsx  ── getOpportunityFull(id)
   ▲
Fuente de datos LOCAL   opportunities-data.ts  ── 3 oportunidades de muestra
   ▲ tipos
Contrato de tipos       crm-types.ts  ── espeja crm_* (0041–0046)
   │
Capacidad (en vivo)     corporate-capacity.ts · findAvailability()
```

### 1.2 Decisión: fuente local primero
La Ficha consume tipos que **espejan las tablas `crm_*`**. Hoy se sirven desde `opportunities-data.ts` (muestra). En **F2.1-7** se reimplementan los accesores (`listOpportunities`, `getOpportunityFull`) leyendo Supabase **sin tocar la UI** (misma forma `OpportunityFull`). Esto permite construir y validar la experiencia sin depender de Supabase ni de producción.

### 1.3 Integración de capacidad (en vivo)
La Ficha calcula la factibilidad llamando a `findAvailability({category, m2})` del **Motor Corporativo** (F2.1-4), mapeando `service_type → category` (`anmat→anmat`, `general→general`, `oficinas→oficina`). No se guarda: se computa al renderizar → siempre refleja la oferta real de las dos sedes.

---

## 2. Diseño UX

### 2.1 Estructura de la pantalla
```
┌ Breadcrumb: Comercial / Oportunidades / OPP-2026-0001 ────────────────┐
├ HEADER  empresa · OPP-id · [etapa] [compromiso]   [Siguiente acción ▸]│
│         KPIs: servicio · m² · monto · probabilidad · cierre           │
│         BADGE de capacidad (entra / no entra · note del motor)        │
├ PIPELINE STEPPER  (8 etapas, actual resaltada, hechas con ✓)          │
├ TABS  Resumen · Capacidad · Cotizaciones(n) · Propuestas(n) ·         │
│       Contrato · Onboarding · Historial                                │
└ CONTENIDO de la pestaña activa ───────────────────────────────────────┘
```

### 2.2 Principios (de CRM_UX_REVIEW)
- **Hub único:** todo cuelga de la oportunidad; no se navega a pantallas sueltas.
- **Capacidad inline:** el badge vive en el header + pestaña Capacidad; no obliga a ir al dashboard.
- **Siguiente acción visible:** botón primario contextual por etapa, coloreado por la etapa, que lleva a la pestaña relevante (Cotizar→Cotizaciones, Ganado→Onboarding…). Guía el happy path.
- **Estados vacíos útiles:** cada pestaña sin datos explica el próximo paso ("Sin contrato. Se genera al pasar a Ganado").
- **Densidad controlada:** pestañas (no scroll infinito); contadores en las pestañas con contenido.

### 2.3 Contenido por pestaña
| Pestaña | Muestra |
|---|---|
| Resumen | contacto/email/tel/CUIT · sede y unidades asignadas · estado de compromiso · deal Clientify |
| Capacidad | resultado de `findAvailability` + disponibilidad por sede (Luján/Magaldi) |
| Cotizaciones | `crm_quotes` con ítems, subtotal/desc/IVA/total, estado, tarifario |
| Propuestas | `crm_proposals` (tipo, versión, estado, enviada/vista, cotización ligada) |
| Contrato | `crm_contracts` (versión, firma, vigencia) o estado vacío |
| Onboarding | `crm_onboarding` + tareas (RNE/croquis/plancheta/accesos/doc) con progreso |
| Historial | timeline de `crm_stage_history` (transiciones de etapa) |

---

## 3. Modelo de navegación

```
Sidebar · Comercial · CRM
   └─ Oportunidades            → /comercial/oportunidades        (lista)
        └─ fila "Ficha 360°"   → /comercial/oportunidades/[id]   (ficha)
              └─ tabs internas (estado local, sin recargar)
              └─ "Siguiente acción" → cambia a la pestaña relevante
              └─ Breadcrumb ↑ vuelve a la lista
```

- **Lista** (`/comercial/oportunidades`): tabla con ID, empresa, servicio, m², etapa, probabilidad, monto, **badge de capacidad**, y link a la ficha.
- **Ficha** (`/comercial/oportunidades/[id]`): server carga `OpportunityFull`; si no existe → `notFound()`.
- **Deep-link** por `publicId` soportado por el accesor (`getOpportunityIdByPublicId`) para futuros enlaces desde Clientify/pipeline.
- Navegación intra-ficha = pestañas en estado local (cliente), sin navegación de ruta.

---

## 4. Implementación (local)

| Archivo | Rol |
|---|---|
| `src/lib/comercial/crm-types.ts` | tipos del dominio + labels/colores |
| `src/lib/comercial/opportunities-data.ts` | 3 oportunidades de muestra + accesores |
| `src/app/(app)/comercial/oportunidades/page.tsx` | lista (server) |
| `src/app/(app)/comercial/oportunidades/[id]/page.tsx` | loader de ficha (server) |
| `src/app/(app)/comercial/oportunidades/[id]/Opportunity360View.tsx` | Ficha 360° (cliente, ~330 líneas) |
| `src/components/shell/Sidebar.tsx` | +1 link "Oportunidades" (badge 360°) |

**Datos de muestra:** OPP-2026-0001 (ANMAT 200, en propuesta, cotización+propuesta), OPP-2026-0002 (CG 800, ganado, contrato+onboarding), OPP-2026-0003 (ANMAT 600, calificado, capacidad ajustada).

---

## 5. QA

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` | ✅ sin errores |
| `npm run build` | ✅ Compiled successfully · lista 229 B · ficha 6,69 kB |
| Coherencia datos + capacidad (tsx) | ✅ OPP-0001 ENTRA · OPP-0002 ENTRA · **OPP-0003 NO ENTRA (508<600)** |

> La factibilidad de la ficha coincide con el Motor Corporativo en vivo (no es un dato hardcodeado).

---

## 6. Fuera de alcance (frentes posteriores)
- Integración **Clientify** y **webhook HMAC** (F2.1-5).
- **Persistencia real** (Supabase) y transiciones de etapa con server actions (F2.1-7).
- **Puente de captura** del cotizador/propuestas (UX-1, F2.1-7).

**Sin merge · sin main · sin Netlify · sin deploy · sin producción.**

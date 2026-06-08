# CRM-OPPORTUNITIES-360-AUDIT

**Fecha:** 2026-06-08 · **Modo:** auditoría read-only (no se modificó nada, no se tocó producción).
**Base:** Supabase productivo `arsksytgdnzukbmfgkju`.

---

## Respuesta explícita

> ## D) PENDIENTE DE SINCRONIZACIÓN / CARGA DE DATOS
> El **código está completo y operativo** (UI + server actions + RPCs + RLS), pero **el embudo está vacío en producción** (0 registros en todas las tablas `crm_*`). La pantalla vacía **no es un bug**: la tabla existe y devuelve 0 filas. No es (A) plenamente operativo porque no hay datos; no es (B) incompleto a nivel de build; no es (C) abandonado (desarrollo reciente).

---

## 1) Propósito del módulo

**CRM interno "360°" de TOPS** — un embudo comercial propio, más profundo y operativo que el pipeline de Clientify:

```
crm_leads → (Promover) → crm_opportunities → crm_quotes / crm_proposals / crm_contracts / onboarding
                                            └→ factibilidad de capacidad (integración WMS) + reserva
```

La **Ficha 360°** (`Opportunity360View.tsx`) consolida por oportunidad: cotizaciones, propuestas, contrato, onboarding, línea de tiempo de etapas, y **factibilidad de capacidad contra el WMS** ("Entra / No entra", reserva de unidades en depósito). Es la capa de **fulfillment/operación**, no solo pipeline.

### ¿Reemplaza o complementa a Clientify?
**Complementa (modelo paralelo).** Clientify es el CRM externo en uso hoy (`/comercial/contactos` y `/comercial/pipeline` leen Clientify en vivo: 2139 contactos, deals reales). El CRM 360° es un modelo **interno en Supabase** orientado a operación (capacidad/cotización/contrato/onboarding). **No hay sincronización Clientify ↔ crm_opportunities** (existe un campo `clientifyDealId` modelado, pero sin código de sync). Hoy son dos mundos separados.

---

## 2) Estado actual

| Dimensión | Estado |
|---|---|
| **UI** | ✅ construida: lista (`/comercial/oportunidades`), Ficha 360° (`[id]`), embed de captura (cotizador/propuesta), inbox de leads (`/comercial/leads`) con botón "Promover" |
| **Server actions** | ✅ `promoteLead`, `advanceStage`, `reserveCapacity`, `completeOnboarding`, `updateOpportunityFields`, `saveCaptureForOpportunity` |
| **RPCs en DB** | ✅ `crm_promote_lead`, `crm_advance_stage`, `crm_reserve_capacity`, `crm_complete_onboarding`, `crm_list_commercial_users` (migraciones 0046/0050/0058+) |
| **Datos (prod)** | 🔴 **0 registros** en todo el embudo |
| **Sync Clientify** | ❌ inexistente |
| **Punto de creación** | Promover un **lead** (`crm_leads`) → oportunidad. **No hay "Nueva oportunidad" directa** ni alta automática desde Clientify |

> Comentario en `capture-actions.ts`: *"la app apunta a una base que puede no tener crm_*; la persistencia real se prueba contra staging"* → el módulo se desarrolló/validó en **staging**; el prod tiene las tablas vacías.

---

## 3) Origen de datos

- **Supabase** (TOPS-internal): `crm_opportunities` (+ `crm_quotes`, `crm_proposals`, `crm_contracts`, `crm_quote_items`, `crm_stage_events`, `crm_leads`).
- `listOpportunities()` (`opportunities-data.ts:188`): si Supabase responde → usa `crm_opportunities`; **solo cae a 3 muestras locales si la tabla NO existe / error**. Como la tabla **existe y está vacía**, devuelve `[]` con `source="supabase"` → **pantalla vacía** (header dice "fuente: Supabase (crm_opportunities)").
- Capacidad: integra `wms/corporate-capacity.ts` (factibilidad real contra el WMS).

---

## 4) Cantidad de registros (prod, evidencia)

```
crm_leads ......... */0
crm_opportunities . */0   ← causa de la pantalla vacía
crm_quotes ........ */0
crm_proposals ..... */0
crm_contracts ..... */0
(crm_opportunities responde HTTP 200 · existe · 0 filas)
```

---

## 5) Funcionalidades existentes

- Lista de oportunidades (Supabase) con etapa, m², probabilidad, monto, factibilidad de capacidad.
- **Ficha 360°**: cotizaciones, propuestas, contrato, onboarding, timeline de etapas, capacidad WMS, embed cotizador/propuesta ("Guardar en Nexus").
- **Inbox de Leads** + **Promover lead → oportunidad** (`crm_promote_lead`).
- Transiciones de etapa y reserva de capacidad (RPCs fail-closed, auditadas).
- Edición de campos de la oportunidad; adjuntar cotización/propuesta.

## 6) Funcionalidades faltantes / gaps

- 🔴 **Sin datos en prod** (todo el embudo en 0) → el módulo no muestra nada.
- 🔴 **Sin alta nativa "Nueva oportunidad"**: solo se crean **promoviendo leads**; y `crm_leads` también está en 0 (no hay captura de leads activa en prod).
- 🔴 **Sin sync con Clientify**: las 2139 cuentas / deals de Clientify **no** alimentan este modelo (el `clientifyDealId` está modelado pero no cableado).
- 🟠 **Empty state pobre**: muestra una tabla vacía en vez de un mensaje claro ("Sin oportunidades cargadas").

---

## 7) Recomendación

1. **Definir la estrategia de datos** (decisión de negocio):
   - **Opción A — Captura nativa:** activar la entrada de `crm_leads` (formularios web/landing → leads) y operar el flujo Promover→360°. El módulo ya está listo para esto.
   - **Opción B — Sync desde Clientify:** construir un puente Clientify→`crm_opportunities` (p.ej. deals ganados/calificados → crea oportunidad interna). No existe hoy; es desarrollo nuevo.
   - **Opción C — Carga/seed inicial:** importar las oportunidades vigentes a `crm_opportunities` (one-shot) para arrancar.
2. **Mientras tanto:** mejorar el *empty state* (mensaje "Sin oportunidades cargadas" + explicación), para que no parezca roto. Cambio mínimo de UX, sin tocar lógica.
3. **Confirmar el rol del módulo:** ¿reemplazará a Clientify a futuro (migración) o es una capa operativa paralela permanente? Eso define si conviene invertir en el sync (Opción B) o mantener ambos.
4. **No bloquea nada** hoy: el resto del CRM (Contactos/Pipeline sobre Clientify) funciona; este módulo está "parked" esperando datos.

> **Conclusión:** módulo **construido y operativo a nivel de código**, **vacío por falta de datos en prod** (embudo en 0, desarrollado contra staging, sin sync con Clientify). Estado = **D (pendiente de carga/sincronización)**. No se ejecutó ningún cambio.

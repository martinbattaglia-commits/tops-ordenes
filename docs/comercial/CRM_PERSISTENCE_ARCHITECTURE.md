# CRM_PERSISTENCE_ARCHITECTURE — Persistencia real (F2.1-7)

**Frente:** F2.1-7 · **Rama:** `feature/crm-comercial-f2-1` · **Fecha:** 2026-06-06
**Objetivo:** reemplazar la fuente local tipada de la Ficha 360° por **datos reales en Supabase** (`crm_*`), manteniendo **la misma UX, navegación y Ficha 360°**.
**Sin Clientify · sin webhook HMAC · sin producción · sin main · sin Netlify.**

---

## 1. Arquitectura de persistencia

```
Ficha 360° (UI cliente, sin cambios)
   ▲ props (OpportunityFull, source)
Páginas server (async)        page.tsx → await getOpportunityFull(id)
   ▲
Data layer                    opportunities-data.ts
   │  createClient() (app)         │ try Supabase
   ├─ Supabase OK ────────────────►│ opportunities-supabase.ts (nested select)
   │                                │      ▼ map
   │                          opportunities-mapper.ts  (PURO: fila DB → tipos TS)
   └─ Supabase ausente / error ───► muestra local (fallback)  → source:"local"
```

### 1.1 Fallback resiliente (clave)
La app apunta a una base donde `crm_*` **puede no existir** (p. ej. sin 0041–0046). El data layer:
- si `createClient()` da cliente **y** la consulta no falla → usa **Supabase** (`source: "supabase"`).
- si no hay cliente, la tabla no existe o hay error → cae a la **muestra local** (`source: "local"`).

Así la Ficha 360° **nunca rompe**, y la UI **muestra la fuente** (badge en la ficha, texto en la lista) con total transparencia.

### 1.2 Mapper puro y reutilizable
`opportunities-mapper.ts` no depende de Supabase ni de alias `@`: convierte la **fila cruda** (snake_case, como la devuelve PostgREST/pg) a los tipos TS de la Ficha. Lo usan **el accesor Supabase** (app) y **la evidencia contra staging** → garantiza que la UI ve la misma forma venga de donde venga.

### 1.3 Una sola consulta (nested select)
`getOpportunityFullDb` trae la oportunidad + cotizaciones(+ítems) + propuestas + contrato + onboarding(+tareas) + historial en **una** consulta PostgREST (embedding por FK). Eficiente y atómico.

---

## 2. Mapeo tipos ↔ tablas

### 2.1 `Opportunity` ↔ `crm_opportunities`
| TS | Columna DB | Nota |
|---|---|---|
| id · publicId | id · public_id | |
| empresa | `clients.razon` | join por client_id |
| cuit · contacto · email · telefono | cuit · contacto · email · telefono | |
| serviceType | service_type | |
| m2 · monto | m2 · monto | numeric → number |
| deposito · estado · probabilidad · currency | idem | |
| ownerName | owner_id | ⚠️ hoy "—" (resolución de nombre vía `profiles_public` = follow-up) |
| expectedClose · clientifyDealId | expected_close · clientify_deal_id | |
| capacityFeasible | capacity_feasible | |
| assignedSite | assigned_site | |
| assignedUnits | assigned_units | jsonb → string[] |
| committedState | committed_state | alimenta el hook de capacidad (F2.1-4) |

### 2.2 Relacionadas
| TS | Tabla | Resolución |
|---|---|---|
| `Quote` + `items` | `crm_quotes` + `crm_quote_items` | items ordenados por `orden` |
| `Proposal.quotePublicId` | `crm_proposals` (quote_id) | resuelto contra el `public_id` de la cotización |
| `Contract` (último) | `crm_contracts` | mayor `version`; `proposalPublicId` resuelto |
| `Onboarding` + `tasks` | `crm_onboarding` + `crm_onboarding_tasks` | `hasDocument = document_id != null` |
| `StageEvent[]` | `crm_stage_history` | ordenado por `changed_at` |

> **Limitación documentada:** nombres de `owner_id`/`changed_by` (uuid → persona) se muestran como "—" hasta resolverlos vía la vista `profiles_public` (sin email, mandato 0040) — follow-up menor, no bloquea.

---

## 3. Implementación

| Archivo | Cambio |
|---|---|
| `src/lib/comercial/opportunities-mapper.ts` | **nuevo** — formas RAW + mapper puro (snake→camel) |
| `src/lib/comercial/opportunities-supabase.ts` | **nuevo** — `listOpportunitiesDb` / `getOpportunityFullDb` (nested select, resiliente) |
| `src/lib/comercial/opportunities-data.ts` | accesores **async** Supabase-then-local; exponen `source` |
| `src/app/(app)/comercial/oportunidades/page.tsx` | server async; muestra fuente |
| `src/app/(app)/comercial/oportunidades/[id]/page.tsx` | server async; pasa `source` a la ficha |
| `Opportunity360View.tsx` | +badge de fuente (Supabase / muestra local) — **UX intacta** |

**La UX, la navegación y la estructura de la Ficha 360° no cambian** (mismo componente, mismos tabs, mismo pipeline).

---

## 4. QA

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` | ✅ sin errores |
| `npm run build` | ✅ Compiled successfully · lista 228 B · ficha 6,76 kB (caché `.next` stale se auto-sanó al regenerar) |

---

## 5. Evidencia — end-to-end contra staging

Se sembró en **staging** una oportunidad completa (cliente + oportunidad + cotización+ítem + propuesta + contrato + onboarding+3 tareas + 2 historial) en una **transacción con ROLLBACK**, se leyó la fila cruda y se pasó por el **mapper real de la app**:

```
publicId: OPP-2026-0033 | empresa: Cliente E2E S.A. | servicio: anmat 200m² | committed: reservado
assignedSite: PEDRO_LUJAN_3159 | units: ["Cubículos 2º piso"]
quotes: 1 · items: 1 · total: $19.360.000
proposals: 1 · quotePublicId: COT-2026-0007   (resuelto desde quote_id)
contract: CON-2026-0005 firmado · proposalPublicId: PROP-2026-0007   (resuelto desde proposal_id)
onboarding: ONB-2026-0003 · 60% · tareas: 3
history: 2 eventos
RESULTADO E2E: PASS ✅
```

> Esto demuestra que **la Ficha 360° funciona end-to-end contra el modelo CRM real**: lectura desde `crm_*`, joins (clients.razon), jsonb (assigned_units), resolución de FKs (quote/proposal public_id), y la misma forma `OpportunityFull` que consume la UI. Sin residuos (rollback). Producción intacta.

---

## 6. Estado y siguiente

✅ Persistencia real implementada y probada contra staging, con fallback local y UX intacta.
**Pendiente (otros frentes):** resolución de nombres de owner (`profiles_public`), escritura/transiciones (server actions), **Clientify** y **webhook HMAC** (F2.1-5), puente de captura cotizador/propuestas (UX-1).

**Sin merge · sin main · sin Netlify · sin deploy · sin producción.**

# CRM_LEADS_INBOX_ARCHITECTURE — F2.2-3 · Bandeja de leads

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-3 — bandeja de leads (`/comercial/leads`)
**Estado:** ✅ implementado y validado en staging (DB) + build verde

> La bandeja es **el primer lugar donde Comercial ve leads reales** entrando desde Clientify (webhook F2.2-2 → `crm_ingest_lead`). **No** incluye promoción a oportunidad (F2.2-4) ni outbound.

---

## 1. Flujo

```
Clientify ─webhook─► crm_ingest_lead ─► crm_leads
                                          │ (RLS comercial.view)
                                          ▼
              /comercial/leads (server)  ── listLeads() ──►  LeadsInboxView (client)
                  │ fuente Supabase con fallback a muestra local
                  ├─ filtros · indicadores · posible duplicado
                  ├─ reasignación  → reassignLead()  → UPDATE owner_id (RLS comercial.edit)
                  └─ calificación  → setLeadStatus() → UPDATE status   (RLS comercial.edit)
```

---

## 2. Componentes

| Pieza | Archivo | Rol |
|---|---|---|
| Página (server) | `src/app/(app)/comercial/leads/page.tsx` | `listLeads()` → vista |
| Vista (client) | `src/app/(app)/comercial/leads/LeadsInboxView.tsx` | tabla, filtros, KPIs, acciones |
| Accesor Supabase | `src/lib/comercial/leads-supabase.ts` | `listLeadsDb` (+ owners) · `listCommercialUsersDb` |
| Data layer | `src/lib/comercial/leads-data.ts` | Supabase con fallback a muestra local |
| Acciones | `src/lib/comercial/lead-actions.ts` | `reassignLead` · `setLeadStatus` |
| Tipos | `src/lib/comercial/crm-types.ts` | `CrmLead`, `LeadStatus`, labels/colores |
| Helper DB | `supabase/migrations/0049_crm_list_commercial_users.sql` | comerciales activos (PII-safe) |

---

## 3. Alcance implementado

| Alcance | Cómo |
|---|---|
| **Listado de `crm_leads`** | `listLeadsDb` bajo RLS `comercial.view`; orden por `created_at desc` |
| **Filtros** | búsqueda (nombre/email/empresa/ID), estado, owner (incl. "sin asignar"), fuente, posible-duplicado |
| **Ownership** | `owner_id` resuelto a nombre vía `profiles_public` (sin email) |
| **Posible duplicado** | derivado de `tags` (`posible_duplicado`); badge "dup" + filtro + KPI |
| **Reasignación** | `<select>` de comerciales activos (`crm_list_commercial_users`) → `reassignLead` |
| **Calificación** | `setLeadStatus`: nuevo→contactado→calificado, →descartado, reactivar (NO `promovido`) |
| **Indicadores** | total · nuevos · contactados · calificados · sin asignar · posibles duplicados |

### 3.1 Calificación ≠ promoción
La bandeja **mueve `crm_leads.status`** (calificación operativa), pero **NO crea la oportunidad**. La promoción `calificado → crm_opportunities` (Ficha 360°) es **F2.2-4**. `setLeadStatus` rechaza `promovido` y no toca leads ya promovidos.

---

## 4. Seguridad y resiliencia

- **RLS por usuario:** lectura `comercial.view`, escritura `comercial.edit` (acciones bajo sesión, `SECURITY INVOKER`). Verificado: un usuario sin permiso → UPDATE bloqueado (0 filas, sin fuga).
- **Helper de comerciales** `SECURITY DEFINER` PII-safe (id + nombre, sin email) — porque leer roles de otros usuarios bajo RLS puede no resolver.
- **Gate de escritura (UI):** `source==='supabase'` habilita acciones; en muestra local se deshabilitan con nota (RA-1).
- **Fallback:** si `crm_*` no existe (runtime PROD), la bandeja muestra muestra local y sigue navegable.

---

## 5. Frontera (lo que NO hace)

- ❌ Promoción a oportunidad (F2.2-4).
- ❌ Outbound / write-back a Clientify.
- ❌ Sin tocar producción, `main`, Netlify, Clientify PROD, Supabase PROD.

*Arquitectura de la bandeja. QA y evidencia en los docs hermanos.*

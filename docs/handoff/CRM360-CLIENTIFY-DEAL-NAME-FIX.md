# CRM360-CLIENTIFY-DEAL-NAME-FIX

**Fecha:** 2026-06-08 · Fix UX — no mostrar URLs técnicas de Clientify como título.
**Estado:** implementado · tsc PASS · build PASS · dev sirviendo · migración espejo **preparada, NO aplicada**.

---

## 1. Causa raíz

El título comercial sale de `mapOpportunity`:
```ts
const empresa = razonOf(r.clients) ?? str(r.company_name) ?? r.contacto ?? "—";
```
Cuando la oportunidad **no tiene cuenta linkeada** (`clients.razon` nulo), cae a `company_name`.
En algunos deals de Clientify ese campo viene poblado con una **URL técnica de la API**, p. ej.:
```
https://api.clientify.net/v1/companies/16216611/
```
→ esa URL terminaba mostrándose como título en cards Kanban, tabla y header de la ficha.

Además: **no existe** ninguna columna con el nombre real del deal en `crm_opportunities`
(verificado en `supabase/migrations`: el upsert de sync persiste `company_name`, `clientify_pipeline`,
`clientify_modified`, etc., pero **no** `name`/`deal_name`).

---

## 2. Campo correcto usado + regla anti-URL

Nuevo módulo `src/lib/comercial/opportunity-title.ts` (fuente única):

- **`isClientifyApiUrl(value)`** — `true` si el valor:
  - empieza con `https://api.clientify.net/`, **o**
  - contiene `/v1/companies/`, `/v1/contacts/` o `/v1/deals/`.
  Esos valores **nunca** se usan como título.

- **`opportunityDisplayTitle(o)`** — título con cadena de fallback (cada candidato saneado anti-URL):
  1. `dealName` — nombre real del deal de Clientify (espejo; ver §5)
  2. `empresa` — razón social / company_name
  3. `companyName` — espejo Clientify
  4. `contacto` — nombre de contacto
  5. **servicio derivado** — `Depósito ANMAT` · `Almacenaje · Cargas Generales` · `Oficinas Corporativas`

Defensa **en el origen** (mapper): `company_name` y `clientify_deal_name` se mapean con
`safeStr()` → si son una URL técnica devuelven `null`. Así `empresa`/`companyName` jamás
transportan la URL aguas abajo.

---

## 3. Fallback aplicado

| Situación | Título mostrado |
|---|---|
| company_name = URL técnica, sin razón social | salta URL → **contacto** → si no, **servicio** (ej. "Depósito ANMAT") |
| razón social presente | razón social |
| company_name real (no URL) | company_name |
| `clientify_deal_name` poblado (tras migración) | **nombre real del deal** (máxima prioridad) |

Nunca se muestra una URL/endpoint de Clientify como título visible.

---

## 4. Alcance actualizado
- **Kanban cards** — `OpportunitiesView.tsx`: título = `opportunityDisplayTitle(o)`.
- **Tabla** — ídem (columna Empresa·Contacto).
- **Header Ficha 360°** — `Opportunity360View.tsx`: `<h1>{opportunityDisplayTitle(o)}</h1>`.
- **Buscador global** — el haystack incluye `opportunityDisplayTitle(o)` + `dealName` + `empresa` saneada → se puede buscar por el nombre visible/real, no por la URL.
- **Mapper** — `opportunities-mapper.ts`: `safeStr` para `company_name` y `clientify_deal_name`; nuevo campo `dealName`.
- **Tipo** — `crm-types.ts`: `Opportunity.dealName: string | null`.

**No se tocó:** sync, backfill, Clientify API, crm_units, reservas, contratos, mapas, Compliance, RRHH.

---

## 5. ¿Hizo falta nueva columna?

**Sí, para mostrar el NOMBRE REAL del deal** (hoy no está persistido). Detección explícita:
no existe `clientify_deal_name` en `crm_opportunities` (confirmado en migraciones).

- **No se inventó dato:** mientras la columna no exista, `dealName = null` y el título usa el
  fallback comercial legible (empresa/contacto/servicio). El bug de la URL ya queda resuelto
  igual, sin la columna.
- **Migración mínima preparada (NO aplicada):**
  `supabase/migrations/0069_crm_opportunities_deal_name.sql`
  ```sql
  alter table public.crm_opportunities
    add column if not exists clientify_deal_name text;
  ```
  Aditiva, idempotente, no borra nada. **Requiere autorización explícita** para aplicarse en
  prod (`arsksytgdnzukbmfgkju`) vía SQL Editor — el asistente no ejecuta escrituras en prod.
- El mapper **ya lee** `clientify_deal_name` de forma defensiva. El `SELECT`
  (`opportunities-supabase.ts`) **se dejó intacto a propósito**: agregar la columna al SELECT
  antes de que exista rompería la query. Pasos post-aplicación (fuera de este frente, con su
  propia autorización): (1) sumar la columna al LIST_SELECT/FULL_SELECT; (2) extender el upsert
  de sync para escribir el `name` del Deal.

---

## 6. Validación

### Técnica (ejecutada)
- `tsc --noEmit` → **EXIT 0**.
- `next build` → **EXIT 0**; `/comercial/oportunidades` = `ƒ Dynamic` (bundle 3.86 → **4.06 kB**), `/[id]` `ƒ Dynamic`; sin warnings.
- dev `:3030` reiniciado y sirviendo (`GET /comercial/oportunidades` → 307 redirect a login para curl sin sesión).

### Casos funcionales (sesión real del usuario)
| Caso | Resultado esperado |
|---|---|
| 1 · Card con `…/v1/companies/16216611/` | Muestra título comercial legible (contacto o servicio), **no** la URL |
| 2 · Buscar por nombre de oportunidad | La card aparece (haystack incluye el título visible y el dealName) |
| 3 · Tabla | Ninguna fila muestra una URL técnica como título |
| 4 · Ficha 360° header | Nunca muestra URL técnica |
| 5 · Sin nombre real | Fallback comercial legible — jamás URL |

> Tras aplicar 0069 + poblar `clientify_deal_name` por sync, el título pasará a mostrar el
> **nombre real del deal** (Caso 1 "Después: Nombre real de la oportunidad") con máxima prioridad.

---

## 7. Archivos
- `src/lib/comercial/opportunity-title.ts` — **nuevo** (isClientifyApiUrl + opportunityDisplayTitle).
- `src/lib/comercial/crm-types.ts` — `Opportunity.dealName`.
- `src/lib/comercial/opportunities-mapper.ts` — `safeStr`, `dealName`, empresa saneada.
- `src/lib/comercial/opportunities-data.ts` — `dealName: null` en la muestra local.
- `src/app/(app)/comercial/oportunidades/OpportunitiesView.tsx` — título y búsqueda.
- `src/app/(app)/comercial/oportunidades/[id]/Opportunity360View.tsx` — header de la ficha.
- `supabase/migrations/0069_crm_opportunities_deal_name.sql` — **preparada, sin aplicar**.

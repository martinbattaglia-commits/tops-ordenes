# CRM_PULL_RECONCILIATION_ARCHITECTURE — F2.2-5 · Reconciliación por pull

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-5 — backbone de resiliencia del inbound (recupera webhooks perdidos)
**Estado:** ✅ implementado y validado en staging (10/10)

> Inbound-only. Sin outbound, sin write-back. El pull **lee** Clientify y **re-ingesta** vía `crm_ingest_lead` (idempotente).

---

## 1. Por qué pull de **contactos** (no de deals)

El webhook que construimos (F2.2-2) es **contacto → lead**. Su modo de falla es un **webhook de contacto perdido**. La resiliencia, por tanto, es un **pull de contactos** que re-ingesta y recupera los faltantes. (`/api/clientify/sync-deals` —deals→oportunidades— es un pull hermano que pertenece al espejo de oportunidades/outbound, fuera del inbound de leads.) Por eso F2.2-5 entrega **`/api/clientify/sync-contacts`**.

---

## 2. Mecanismo

```
cron ─► GET /api/clientify/sync-contacts   (Authorization: Bearer CRON_SECRET)
          │ listContacts({ordering:'-modified', page_size}) — READ-ONLY
          ▼
   reconcileContacts(contacts, ingest)
          │ por cada contacto: normalizeLead → ingest('pull') = crm_ingest_lead (idempotente)
          ▼
   report { scanned, recovered, refreshed, flagged, skipped, errors, recoveredIds }
```

- **`reconcileContacts(contacts, ingest)`** (`src/lib/clientify/reconcile.ts`): lógica pura con `ingest` **inyectable** → el route usa `supabase.rpc`; el test usa `pg`. Reusa el **normalizador real** (`webhook.ts`).
- **Route** (`/api/clientify/sync-contacts`): cron-protegido, lee Clientify, reconcilia con cliente **service-role**, devuelve el reporte.

---

## 3. Cómo cubre el alcance

| Alcance | Cómo |
|---|---|
| **Persistencia** | cada contacto → `crm_ingest_lead` → `crm_leads` + `clientify_sync_log(event='pull')` |
| **Reconciliación** | re-ingesta de la ventana reciente de contactos |
| **Detección de divergencias** | `recovered` (inserted durante pull) = contactos que **faltaban** en Nexus; `recoveredIds` los lista |
| **Recuperación ante webhook perdido** | un contacto sin lead → el pull lo **inserta** (recupera) |
| **Idempotencia** | `crm_ingest_lead` por `clientify_id`: re-correr el pull no duplica (recovered=0, refreshed=N) |

---

## 4. Semántica del reporte

| Campo | Significado |
|---|---|
| `scanned` | contactos procesados |
| `recovered` | **inserted** → webhook perdido recuperado (divergencia real) |
| `refreshed` | updated + linked → ya presente, datos refrescados |
| `flagged` | duplicate_flagged (D-4) |
| `skipped` | sin identidad (clientify_id/email/phone) → no procesable |
| `errors` + `errorDetails` | fallos de ingesta por contacto (no abortan el lote) |

> Operativamente: `recovered > 0` repetido entre corridas señala **pérdida sistemática de webhooks** (revisar configuración/entrega) — la reconciliación lo visibiliza además de corregirlo.

---

## 5. Seguridad / frontera

- **Read-only sobre Clientify** (listContacts); **no** escribe en Clientify.
- Cron protegido por `CRON_SECRET`; ingesta vía RPC `SECURITY DEFINER` (0048) con service-role.
- Ventana acotada (`page_size`, default 200, máx 500) por corrida; el cron define la frecuencia.
- ❌ Sin outbound, sin write-back, sin tocar producción/`main`/Netlify/Clientify PROD (escritura)/Supabase PROD.

*Arquitectura. QA y evidencia en los docs hermanos.*

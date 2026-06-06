# CRM_LEAD_INGEST_ARCHITECTURE — F2.2-1 · Arquitectura de la ingesta de leads

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-1 — ingesta de leads (inbound only)
**Decisiones base (ratificadas):** D-1 inbound-only · D-2 least-loaded · D-3 token-en-URL · D-4 crear-y-marcar

> Inbound-only. Sin outbound, sin write-back a Clientify, sin bandeja (otro frente). Validado en staging.

---

## 1. Rol de la ingesta

El webhook (F2.2-2) recibe un evento de Clientify, lo **normaliza** a un lead canónico y llama **una sola función** — `crm_ingest_lead` — que resuelve todo de forma atómica: deduplicar, asignar owner, persistir y auditar. La función es la **única puerta de escritura** de la ingesta.

```
Clientify ──webhook (token-en-URL)──► handler  ──normaliza──►  crm_ingest_lead(p_lead, p_raw, p_event)
                                                                     │  (1 transacción)
                              dedup persona ── owner least-loaded ── upsert crm_leads ── clientify_sync_log
                                                                     │
                                                              return { action, lead_id, owner_id, … }
```

---

## 2. Contrato de la función

`crm_ingest_lead(p_lead jsonb, p_raw jsonb default null, p_event text default null) → jsonb`

- **`p_lead`** (normalizado por el handler): `clientify_id, source, full_name, email, phone, cuit, company_name, tags[]`.
- **`p_raw`**: payload Clientify completo (trazabilidad; se guarda en `crm_leads.raw` y en el log).
- **`p_event`**: nombre del evento Clientify (p. ej. `contact.created`).
- **Retorna**: `{ action, lead_id, public_id, owner_id, status, dedup_match, dedup_kind, flagged }`.
  - `action ∈ {inserted, updated, linked, duplicate_flagged}`.

### 2.1 `SECURITY DEFINER` (y por qué difiere del Write-Path)
El webhook es **tráfico de máquina sin sesión de usuario** (no hay `auth.uid()`). Por eso la ingesta es `SECURITY DEFINER` (corre como owner, escribe bajo el dueño de las tablas) — superficie mínima y controlada, **sin** abrir service-role a las tablas. Contrasta con el Write-Path (0047, `SECURITY INVOKER`), que siempre tiene usuario. `search_path` fijado; `execute` **solo a `service_role`** (no authenticated/anon).

---

## 3. Deduplicación (de PERSONA)

Prioridad de match, todos sobre `crm_leads` no borrados:

1. **`clientify_id`** (exacto) → mismo contacto Clientify → **upsert idempotente** (el entrante refresca). `action=updated`.
2. **`email`** (normalizado lower/trim).
3. **`phone`** (normalizado a dígitos).

**Resolución del match por email/phone:**
- **Nombres compatibles** (alguno nulo o iguales case-insensitive) → **enriquecer** el existente (rellena huecos, enlaza `clientify_id` si faltaba). `action=linked`.
- **Nombres en conflicto** (ambos presentes y distintos) → **D-4: crear y marcar** → nuevo lead con tag `posible_duplicado` + `raw._dedup_conflict_with`. `action=duplicate_flagged`. **Nunca se pierde ni se mergea en conflicto.**
- **Sin match** → **insertar** lead nuevo. `action=inserted`.

> **CUIT NO es clave de dedup de lead.** Identifica la **cuenta/empresa** (dos contactos comparten CUIT). El CUIT se guarda en el lead y se usa para **enlazar a `clients` en la promoción** (F2.2-4), no para colapsar personas.

---

## 4. Asignación de owner (least-loaded · D-2)

- **Universo elegible:** usuarios `profiles.active=true` con rol RBAC **`comercial`** (`user_roles → roles.slug='comercial'`).
- **Regla:** menor cantidad de **leads abiertos** (`status ∈ {nuevo, contactado, calificado}`, no borrados). Empate → **menor `owner_id`** (determinista). Sin tabla de puntero (a diferencia de round-robin).
- **Solo en INSERT/conflicto** (lead nuevo). En `updated`/`linked` **se conserva** el owner existente.
- **Sin comerciales activos** → `owner_id = null` (lead **se crea igual**, no se pierde; queda sin asignar para reasignación manual en la bandeja).

> **Routing por servicio/equipo (D-2 regla 1):** requiere una tabla de mapeo equipo→usuario que **no existe aún**. F2.2-1 implementa el **least-loaded** (operativo); el routing por servicio queda como mejora additiva futura.

---

## 5. Persistencia y auditoría

- **`crm_leads`:** upsert según la decisión. `public_id` `LEAD-YYYY-NNNN` por trigger; `status` default `nuevo`; `raw` = payload completo.
- **`clientify_sync_log`** (append-only): una fila por ingesta — `direction='inbound'`, `entity='lead'`, `clientify_id`, `nexus_id=lead_id`, `event`, `status='ok'`, `payload = raw + _ingest{action, owner_id, match_kind, flagged}` (observabilidad completa sin columnas nuevas).
- **Atomicidad:** todo en la transacción de la función. Si algo falla, `raise` revierte todo; el **handler** (F2.2-2) registra el error (la función no puede loguear en una tx que se revierte).

---

## 6. Lo que NO hace (frontera F2.2-1)

- ❌ No llama a Clientify (inbound-only; sin write-back).
- ❌ No promueve a oportunidad (F2.2-4) ni crea bandeja (frente aparte).
- ❌ No enlaza `clients` por CUIT (ocurre en la promoción).
- ❌ No toca producción, `main`, Netlify, Clientify PROD, Supabase PROD.

*Arquitectura de la ingesta. La función vive en `0048_crm_ingest_lead.sql`; QA y evidencia en los docs hermanos.*

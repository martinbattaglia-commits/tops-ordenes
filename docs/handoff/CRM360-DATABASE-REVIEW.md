# CRM360-DATABASE-REVIEW (Fase 2 · Auditoría de datos)

**Fecha:** 2026-06-08 · Proyecto prod: `arsksytgdnzukbmfgkju` · Verificación read-only (service role).
**Sin escritura.** Evidencia para decidir la activación del inbound Clientify → CRM360.

## Conteos reales en producción
| Tabla | Estado | Filas |
|---|---|--:|
| `crm_leads` | existe | **0** |
| `crm_opportunities` | existe | **0** |
| `crm_quotes` | existe | **0** |
| `crm_proposals` | existe | **0** |
| `crm_contracts` | existe | **0** |
| `crm_onboarding` (+`crm_onboarding_tasks`) | existe | **0** |
| `crm_stage_history` | existe | 0 |
| `clientify_sync_log` | existe | 0 |
| `crm_quote_items` | existe | 0 |

> El esquema (migraciones **0041–0051**) **está aplicado** en prod (todas las tablas responden 200), pero **no hay datos**. `crm_sync_audit` da 404 porque la tabla de auditoría real se llama **`clientify_sync_log`** (0045).

## Esquema relevante (verificado)

### `crm_opportunities` (0042) — destino del Deal
Columnas clave: `short_id`, `public_id` (OPP-YYYY-#### · unique), `client_id`→clients, `cuit`, `lead_id`→crm_leads, `service_type` **(enum `crm_service_t` NOT NULL)**, `estado` **(enum `crm_stage_t` default `nuevo_lead`)**, `probabilidad` (0–100), `monto` numeric(14,2), `currency` (def ARS), `owner_id`→auth.users, `expected_close` date, **`clientify_deal_id` text UNIQUE** (espejo idempotente), `committed_state`, `created_by`, `created_at`, `deleted_at`.

### `crm_leads` (0042)
`clientify_id` text **UNIQUE** (idempotencia inbound), `public_id` (LEAD-YYYY-####), `email`, `telefono`, `status` (enum `crm_lead_status_t`), `tags[]`, …

### `clientify_sync_log` (0045) — auditoría
`direction (inbound|outbound)`, `entity (lead|deal|contact|company)`, `clientify_id`, `nexus_id`, `event`, `status (ok|error|skipped)`, `error`, `payload jsonb`, `created_at`.

### Enums (0041)
- `crm_service_t = (anmat, general, oficinas)`
- `crm_stage_t = (nuevo_lead, contactado, calificado, visita, propuesta, negociacion, ganado, perdido)`
- `crm_lead_status_t = (nuevo, contactado, calificado, descartado, promovido)`
- `crm_committed_state_t = (none, reservado, comprometido, ocupado)`

## Funciones existentes (write path)
- `crm_ingest_lead` (0048): upsert idempotente en **`crm_leads`** por `clientify_id` (+ dedup email/teléfono) + log. **NO toca `crm_opportunities`.**
- `crm_promote_lead` (0050): crea una `crm_opportunities` a partir de un lead (promoción manual) + `crm_stage_history`.
- `crm_onboarding_autocreate` (0051): onboarding al ganar.
- **NO existe `crm_ingest_deal`** → no hay camino Deal → `crm_opportunities`.

## Causa raíz de `crm_opportunities = 0`
1. **El inbound diseñado es lead-centric:** webhook → `crm_ingest_lead` → `crm_leads`, y recién `crm_promote_lead` crea la oportunidad. La regla pedida es **Deal → oportunidad directa** → falta esa vía.
2. **El webhook no dispara:** `crm_leads` también está en 0 → Clientify no está enviando eventos a la URL tokenizada (o no está configurado el webhook en Clientify).
3. **No hay backfill:** los **172 deals** ya existentes en Clientify (ver Fase 1) nunca se ingestaron. `GET /api/clientify/sync-deals` es **snapshot read-only que no persiste** (comentario en el código: "En F2.7 se conecta a Supabase").
4. **Sin polling programado:** no hay cron de reconciliación en `netlify.toml`.

## Gaps de esquema para la regla Deal → oportunidad
`crm_opportunities` no tiene columnas para algunos **campos mínimos** pedidos (se preservan hoy de forma parcial):
| Campo pedido | En `crm_opportunities` | Acción |
|---|---|---|
| clientify_deal_id | ✅ `clientify_deal_id` (unique) | usar como clave idempotente |
| amount | ✅ `monto` | directo |
| status/stage | ✅ `estado` (mapear) | mapeo enum |
| owner | ⚠️ `owner_id` (uuid) | falta `owner_name` crudo |
| company_id / company_name | ⚠️ `client_id`/`cuit` | falta `company_name` / `clientify_company_id` |
| contact_id / contact_name | ⚠️ `contacto` (texto) | falta `clientify_contact_id` |
| pipeline | ❌ | falta `pipeline` / `pipeline_stage` |
| created_at / updated_at | ✅ `created_at` | falta `clientify_modified` |

**Recomendación:** agregar columnas espejo `clientify_company_id`, `company_name`, `clientify_contact_id`, `pipeline`, `pipeline_stage`, `owner_name`, `clientify_modified` **o** un único `clientify_raw jsonb` (snapshot del deal). Migración nueva `0052_crm_opportunity_clientify_mirror.sql` (a diseñar, no aplicar aún).

> Conclusión: la base está sólida (esquema aplicado, idempotencia por `clientify_deal_id` lista, auditoría en `clientify_sync_log`). Falta **la vía de ingesta deal-centric + backfill + disparo del webhook**.

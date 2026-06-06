# CRM_PROMOTE_LEAD_ARCHITECTURE — F2.2-4 · Promoción Lead → Opportunity

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-4 — promoción lead → oportunidad (la frontera Clientify↔Nexus)
**Estado:** ✅ implementado y validado en staging (14/14)

> Es la **frontera** del modelo (PIPELINE §2): al calificar, el lead se promueve a oportunidad y Nexus pasa a ser SoR. Sin outbound, sin write-back.

---

## 1. Contrato

`crm_promote_lead(p_lead uuid, p_fields jsonb) → jsonb` · `plpgsql · security invoker · search_path = public, pg_temp`.

- **`p_fields`:** `service_type` (requerido: anmat|general|oficinas), `m2`, `cuit` (override), `deposito` (MAGALDI|LUJAN) — opcionales salvo service_type.
- **Retorna:** `{ action: 'promoted'|'already_promoted', lead_id, opportunity_id, opportunity_public_id, owner_id, client_id }`.

### 1.1 `SECURITY INVOKER` (no DEFINER)
La calificación la ejecuta un **usuario comercial** (hay `auth.uid()`), igual que el Write-Path F2.1. La RLS de sesión gobierna (R-G2 intacto); `created_by`/`changed_by = auth.uid()`. Contrasta con la **ingesta** (`crm_ingest_lead`, DEFINER), que es tráfico de máquina sin usuario.

---

## 2. Flujo (una transacción atómica)

```
crm_promote_lead(lead, {service_type, …})
  1. lock lead (RLS comercial.view) · LEAD_NOT_FOUND si no visible
  2. idempotencia: opportunity_id ya seteado / status='promovido' → already_promoted (no-op)
  3. guardas: status≠descartado · service_type válido · (CUIT o client enlazable)
  4. enlace clients por CUIT (cuenta canónica · best-effort bajo RLS)
  5. INSERT crm_opportunities (estado='calificado', hereda owner + contacto/email/telefono + cuit + lead_id + client_id)
  6. UPDATE crm_leads (opportunity_id ← opp, status='promovido')
  7. INSERT crm_stage_history (null → calificado, changed_by=auth.uid())
  → de acá manda el Write-Path F2.1 (advanceStage/reserveCapacity/…)
```

---

## 3. Reglas (alcance F2.2-4)

| Ítem | Cómo |
|---|---|
| **Creación de `crm_opportunities`** | `estado='calificado'`, `committed_state` default `none` |
| **Herencia de owner** | `owner_id` ← lead |
| **Herencia de datos de contacto** | `contacto`←full_name, `email`, `telefono`←phone, `cuit` |
| **Enlace lead ↔ opportunity** | `crm_leads.opportunity_id` ← opp · `crm_opportunities.lead_id` ← lead |
| **Status → promovido** | `crm_leads.status='promovido'` |
| **stage_history inicial** | `(null → calificado)`, `changed_by=auth.uid()`, nota con `LEAD-id` |
| **Enlace a clients por CUIT** | resuelve `client_id` (cuenta canónica) — acá se usa el CUIT del lead |

### 3.1 Guarda de negocio (PIPELINE §5.2 → calificado)
Requiere **`service_type`** y **CUIT o cliente enlazable**. Sin eso → `MISSING_BUSINESS_DATA`. Garantiza que toda oportunidad nazca con datos mínimos de cuenta.

---

## 4. App-layer

`promoteLead(leadId, { serviceType, m2?, cuit?, deposito? })` en `lead-actions.ts` (`"use server"`, sesión de usuario) → `rpc crm_promote_lead` → revalida leads + oportunidades. Errores humanizados. **Es la superficie lista para el disparador en la bandeja** (el botón con selección de servicio es la glue de UI restante — ver evaluación del ciclo).

---

## 5. Errores controlados

| Excepción | Disparador |
|---|---|
| `LEAD_NOT_FOUND` | lead inexistente o no visible bajo RLS |
| `LEAD_DISCARDED` | promover un lead descartado |
| `INVALID_SERVICE` | `service_type` ausente/ inválido |
| `MISSING_BUSINESS_DATA` | sin CUIT ni cliente enlazable |

Cada excepción aborta la transacción → rollback total (lead intacto).

---

## 6. Frontera

- ❌ Outbound / write-back a Clientify.
- ❌ Botón de promoción en la bandeja (glue de UI — se evalúa tras F2.2-4).
- ❌ Producción, `main`, Netlify, Clientify PROD, Supabase PROD.

*Arquitectura. QA y evidencia en los docs hermanos.*

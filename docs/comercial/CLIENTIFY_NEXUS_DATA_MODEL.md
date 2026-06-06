# CLIENTIFY_NEXUS_DATA_MODEL

**Módulo:** CRM Comercial — Modelo de datos y contrato de sincronización
**Fase:** 1 — Diseño (sin código, sin migraciones ejecutadas)
**Fecha:** 2026-06-04
**Relacionado:** [MASTER_PLAN](./COMMERCIAL_MODULE_MASTER_PLAN.md) · [PIPELINE](./COMMERCIAL_PIPELINE_DESIGN.md) · [ONBOARDING](./ONBOARDING_AUTOMATION_DESIGN.md) · [KPI](./COMMERCIAL_KPI_DASHBOARD.md)

> **Estado actual verificado:** No existe ninguna tabla de CRM en Postgres. Un grep sobre las 38 migraciones por `lead/deal/opportunit/cotiza/propuesta/contrato/onboard/crm` devuelve **cero** `CREATE TABLE`. Lo único adyacente: `clients` (cuenta B2B, clave CUIT), `documents` (soporta blobs `'contrato'` y `'presupuesto'`), y el RBAC `comercial` ya sembrado. Este documento define lo que falta.

---

## 1. Convenciones (heredadas del repo — obligatorias)

Verificadas en migraciones existentes; toda tabla nueva las respeta:

| Convención | Regla | Referencia |
|---|---|---|
| PK | `uuid primary key default gen_random_uuid()` | `0001_init.sql:39` |
| ID humano | `short_id int` (secuencia) + `public_id text unique` por trigger `BEFORE INSERT` | `OS-000000` `0001:117`, `PED-YYYY-0001` `0030:77`, `CUST-YYYY-0001` `0036:85` |
| Timestamps | `created_at timestamptz not null default now()`; `updated_at` con trigger `touch_updated_at()` | `0009:68-79`, `0004:20-26` |
| Auditoría | `created_by uuid references auth.users(id) on delete set null` | `0001:48` |
| Soft-delete | `deleted_at timestamptz` + borrado físico solo admin (patrón más maduro del repo) | `documents` `0010:93-94` |
| Naming | estructura en inglés snake_case; términos de negocio en español (`razon`, `cuit`, `m2`, `estado`) | mixto, `0001`/`0004` |
| RLS | habilitado siempre; helpers `current_role()`, `is_staff()`, `is_admin()` | `0005_fix_rls_recursion.sql:23-67` |
| Realtime | `notify pgrst, 'reload schema';` tras DDL | `0021:12` |

**Prefijo de tablas:** `crm_*` para aislar el dominio comercial (paralelo a `wms_*`, `custody_*`).

---

## 2. Diagrama de entidades (objetivo)

```
                          Clientify (externo, SoR tope de embudo)
                                   │  webhook / pull
                                   ▼
clients ──────┐            clientify_sync_log (auditoría de sync)
(cuit, B2B)   │                    │
              │                    ▼
              ├──< crm_leads  (lead crudo espejado de Clientify)
              │         │ (calificación → promueve a)
              │         ▼
              └──< crm_opportunities ───────────────┐  (EJE del módulo)
                        │  clientify_deal_id          │
       ┌────────────────┼───────────────┬────────────┤
       ▼                ▼               ▼            ▼
 crm_quotes        crm_proposals   crm_contracts  crm_onboarding
   │ (+items)        │ pdf→documents  │ pdf→docs     │ (+tasks)
   ▼                                                  ▼
 crm_quote_items                              (alta cliente activo →
                                               orders / logistics_orders)

 crm_stage_history  (audit de transiciones de etapa, append-only)
```

`crm_opportunities` es el centro: leads se promueven a ella; cotizaciones, propuestas, contrato y onboarding cuelgan de ella; el cierre (Ganado) dispara onboarding y alta operativa.

---

## 3. Tablas nuevas (DDL conceptual)

> DDL ilustrativo (no ejecutado). Tipos enum nuevos se agregan en migración propia y *committed* antes de usarse (Postgres prohíbe usar un valor de enum en la misma transacción que lo crea — patrón `0021`/`0029`).

### 3.1 `crm_leads` — lead espejado de Clientify
```sql
create table public.crm_leads (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique,                    -- LEAD-YYYY-0001
  clientify_id    text unique,                    -- id del contacto en Clientify (idempotencia)
  source          text,                           -- 'google_ads' | 'web' | 'referido' | ...
  full_name       text,
  email           text,
  phone           text,
  cuit            text,                            -- si viene; enlaza a clients luego
  company_name    text,
  status          crm_lead_status_t not null default 'nuevo',
  owner_id        uuid references auth.users(id), -- vendedor asignado
  tags            text[] not null default '{}',
  raw             jsonb,                           -- payload Clientify completo (trazabilidad)
  opportunity_id  uuid references public.crm_opportunities(id), -- si se promovió
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);
-- enum crm_lead_status_t: 'nuevo','contactado','calificado','descartado','promovido'
```

### 3.2 `crm_opportunities` — oportunidad estructurada (EJE)
```sql
create table public.crm_opportunities (
  id               uuid primary key default gen_random_uuid(),
  public_id        text unique,                   -- OPP-YYYY-0001
  client_id        uuid references public.clients(id),   -- FK por cuenta (puede ser null hasta calificar)
  cuit             text,                          -- clave de negocio antes de existir el client
  lead_id          uuid references public.crm_leads(id),
  contacto         text,                          -- persona de contacto (inline, estilo clients.contacto)
  email            text,
  telefono         text,
  service_type     crm_service_t not null,        -- 'anmat' | 'general' | 'oficinas'
  m2               numeric(12,2),                 -- metros cuadrados (Clientify NO modela esto)
  deposito         depot_t,                       -- reutiliza enum existente (MAGALDI/LUJAN)
  estado           crm_stage_t not null default 'nuevo_lead',  -- etapa del pipeline (§ PIPELINE)
  probabilidad     int not null default 0 check (probabilidad between 0 and 100),
  monto            numeric(14,2),                 -- valor estimado (sincroniza con cotización aceptada)
  currency         text not null default 'ARS',
  owner_id         uuid references auth.users(id),
  expected_close   date,
  actual_close     date,
  clientify_deal_id text unique,                  -- espejo del deal en Clientify (idempotencia)
  clientify_pipeline text,                        -- 'ANMAT' | 'Cargas Generales' | 'Alquiler de oficinas'
  lost_reason      text,                          -- motivo si estado='perdido'
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  deleted_at       timestamptz
);
-- enum crm_service_t: 'anmat','general','oficinas'  (alineado a SERVICES del cotizador)
-- enum crm_stage_t: ver COMMERCIAL_PIPELINE_DESIGN §2
```

### 3.3 `crm_quotes` + `crm_quote_items` — cotización persistida
Hoy el cotizador (`public/tools/cotizador`) calcula pero **no guarda nada**. Estas tablas capturan su salida.
```sql
create table public.crm_quotes (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique,                    -- COT-YYYY-0001
  opportunity_id  uuid not null references public.crm_opportunities(id),
  service_type    crm_service_t not null,
  tarifario_ref   text,                           -- 'MAYO/2026' (versión de tarifario aplicada)
  subtotal        numeric(14,2) not null,         -- neto sin IVA
  descuento_total numeric(14,2) not null default 0,
  iva             numeric(14,2) not null,         -- 21%
  total           numeric(14,2) not null,         -- subtotal - desc + IVA
  currency        text not null default 'ARS',
  status          crm_quote_status_t not null default 'borrador',
  pdf_document_id uuid references public.documents(id),  -- PDF guardado (tipo 'presupuesto')
  payload         jsonb,                          -- snapshot completo del cálculo del cotizador
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);
-- enum crm_quote_status_t: 'borrador','enviada','aceptada','rechazada','vencida'

create table public.crm_quote_items (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references public.crm_quotes(id) on delete cascade,
  concepto      text not null,                    -- 'Depósito ANMAT', 'Picking', 'Transporte zona A'...
  categoria     text,                             -- 'storage'|'ops_in'|'ops_out'|'transporte'
  cantidad      numeric(12,2) not null,
  unidad        text not null,                    -- 'm2'|'pallet'|'m3'|'hora'|'unidad'
  precio_unit   numeric(14,2) not null,
  importe       numeric(14,2) not null,
  orden         int not null default 0
);
```

### 3.4 `crm_proposals` — propuesta versionada
Hoy las propuestas (ANMAT/General) viven en localStorage y se imprimen con `window.print()`. Esto las versiona y guarda el PDF.
```sql
create table public.crm_proposals (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique,                    -- PROP-YYYY-0001
  opportunity_id  uuid not null references public.crm_opportunities(id),
  quote_id        uuid references public.crm_quotes(id),
  tipo            crm_proposal_t not null,        -- 'anmat' | 'general'
  version         int not null default 1,
  status          crm_proposal_status_t not null default 'borrador',
  pdf_document_id uuid references public.documents(id),
  sent_at         timestamptz,
  viewed_at       timestamptz,                    -- si se trackea apertura
  payload         jsonb,                          -- datos del formulario de la propuesta
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz,
  unique (opportunity_id, tipo, version)
);
-- enum crm_proposal_t: 'anmat','general'
-- enum crm_proposal_status_t: 'borrador','enviada','aceptada','rechazada'
```

### 3.5 `crm_contracts` — contrato
```sql
create table public.crm_contracts (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique,                    -- CON-YYYY-0001
  opportunity_id  uuid not null references public.crm_opportunities(id),
  client_id       uuid references public.clients(id),
  proposal_id     uuid references public.crm_proposals(id),
  version         int not null default 1,
  status          crm_contract_status_t not null default 'borrador',
  pdf_document_id uuid references public.documents(id),   -- tipo 'contrato'
  signed_at       timestamptz,
  signed_by       text,                           -- firmante (cliente)
  signature_evidence_id uuid,                     -- reutiliza patrón evidencia custodia (0038)
  valid_from      date,
  valid_until     date,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);
-- enum crm_contract_status_t: 'borrador','enviado','firmado','vigente','vencido','rescindido'
```

### 3.6 `crm_onboarding` + `crm_onboarding_tasks`
Detalle funcional en [ONBOARDING_AUTOMATION_DESIGN](./ONBOARDING_AUTOMATION_DESIGN.md). Esquema base:
```sql
create table public.crm_onboarding (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique,                    -- ONB-YYYY-0001
  opportunity_id  uuid not null references public.crm_opportunities(id),
  client_id       uuid references public.clients(id),
  contract_id     uuid references public.crm_contracts(id),
  status          crm_onboarding_status_t not null default 'pendiente',
  progress_pct    int not null default 0,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
-- enum crm_onboarding_status_t: 'pendiente','en_curso','bloqueado','completado'

create table public.crm_onboarding_tasks (
  id              uuid primary key default gen_random_uuid(),
  onboarding_id   uuid not null references public.crm_onboarding(id) on delete cascade,
  tipo            crm_onboarding_task_t not null,  -- 'rne','croquis','plancheta','accesos','documentacion'
  titulo          text not null,
  status          text not null default 'pendiente', -- 'pendiente'|'en_curso'|'completado'|'na'
  document_id     uuid references public.documents(id),
  assignee_id     uuid references auth.users(id),
  due_date        date,
  completed_at    timestamptz,
  orden           int not null default 0
);
-- enum crm_onboarding_task_t: 'rne','croquis','plancheta','accesos','documentacion'
```

### 3.7 `crm_stage_history` — auditoría de transiciones (append-only)
```sql
create table public.crm_stage_history (
  id              bigserial primary key,          -- ledger → bigserial (estilo audit_log 0001:155)
  opportunity_id  uuid not null references public.crm_opportunities(id),
  from_stage      crm_stage_t,
  to_stage        crm_stage_t not null,
  changed_by      uuid references auth.users(id),
  changed_at      timestamptz not null default now(),
  note            text
);
```

### 3.8 `clientify_sync_log` — cache + auditoría del sync (cierra "F2.7" del código)
El header de `sync-deals/route.ts:13` ya promete esta tabla ("se conecta a Supabase para persistir un cache local").
```sql
create table public.clientify_sync_log (
  id              bigserial primary key,
  direction       text not null,                  -- 'inbound'|'outbound'
  entity          text not null,                  -- 'lead'|'deal'|'contact'|'company'
  clientify_id    text,
  nexus_id        uuid,
  event           text,                           -- evento del webhook o 'pull'
  status          text not null,                  -- 'ok'|'error'|'skipped'
  error           text,
  payload         jsonb,
  created_at      timestamptz not null default now()
);
```

---

## 4. Relaciones con lo existente (no se modifican)

| Tabla nueva | Se ancla a | Vía |
|---|---|---|
| `crm_opportunities.client_id` | `clients` | FK uuid (cuenta B2B, clave CUIT `0001:41`) |
| `crm_quotes.pdf_document_id` | `documents` | FK; tipo `'presupuesto'` ya en `document_type_t` `0010:22-34` |
| `crm_contracts.pdf_document_id` | `documents` | FK; tipo `'contrato'` ya existe |
| `crm_opportunities.deposito` | enum `depot_t` | reutiliza MAGALDI/LUJAN |
| onboarding → operación | `orders` / `logistics_orders` | alta del cliente activo dispara primer flujo operativo |
| `*.owner_id` lectura segura | `profiles_public(id, full_name)` | vista sin email, por mandato de `0040` |

---

## 5. Contrato de sincronización Clientify ↔ Nexus

Regla de oro (del MASTER_PLAN §1): **Clientify = quién es el lead y de dónde vino; Nexus = qué le cobramos, qué firmó, cómo opera.**

### 5.1 Inbound (Clientify → Nexus)
| Disparador | Acción en Nexus | Idempotencia |
|---|---|---|
| Webhook `contact.created` / lead de Google Ads | upsert `crm_leads` por `clientify_id` | `clientify_id` unique |
| Webhook `deal.updated` (etapa pre-calificación) | actualizar espejo de etapa en `crm_opportunities` si ya existe | `clientify_deal_id` unique |
| Pull programado (`sync-deals`) | refrescar cache de deals abiertos/ganados → `clientify_sync_log` + `crm_opportunities` espejo | por `clientify_deal_id` |

**Seguridad obligatoria (hoy ausente):** verificar firma HMAC `x-clientify-signature` contra `CLIENTIFY_WEBHOOK_SECRET` (variable **no existe aún** en `env.ts` — agregar). Hoy el webhook acepta cualquier payload sin verificar (`webhook/route.ts:26` TODO).

### 5.2 Outbound (Nexus → Clientify)
| Disparador en Nexus | Acción en Clientify | Nota |
|---|---|---|
| Oportunidad creada/promovida desde lead | crear/actualizar Deal | requiere endpoints de escritura — hoy solo existen GET en el cliente activo (`client.ts`); los métodos de escritura están en el cliente **huérfano** `src/lib/clientify.ts` (no usado) |
| Etapa avanza (Visita/Propuesta/Negociación) | mover `pipeline_stage` del Deal | mapeo de etapas en [PIPELINE §4](./COMMERCIAL_PIPELINE_DESIGN.md) |
| Ganado / Perdido | cerrar Deal (`status` 2/4) + `actual_closed_date` | dispara onboarding en Nexus |

> **Deuda técnica a resolver en F2.4:** consolidar los dos clientes Clientify (el activo `src/lib/clientify/client.ts` solo-lectura y el huérfano `src/lib/clientify.ts` con escritura) en uno solo con auth `Token` (no `Bearer`) y base `https://api.clientify.net/v1`.

### 5.3 Resolución de conflictos
- **Etapa:** si difiere entre sistemas, gana el SoR de esa etapa (Clientify para pre-calificación; Nexus desde Oportunidad en adelante).
- **Monto:** Nexus gana una vez existe una `crm_quote` aceptada (es el dato real); antes, se espeja el `amount` de Clientify.
- **Cliente/CUIT:** `clients.cuit` es la clave canónica de deduplicación (constraint unique `0001:41`).

---

## 6. RLS (patrón por tabla nueva)

Reutiliza helpers de `0005`. Plantilla (estilo `0030:132-179`):
```sql
alter table public.crm_opportunities enable row level security;
-- lectura: staff ve todo; (futuro) cliente B2B ve solo lo suyo por client_id
create policy crm_opp_read on public.crm_opportunities for select
  using ( public.is_staff() );
-- escritura: staff comercial/admin
create policy crm_opp_write on public.crm_opportunities for insert
  with check ( public.current_role() in ('admin','operaciones','supervisor','comercial') );
create policy crm_opp_update on public.crm_opportunities for update
  using ( public.current_role() in ('admin','operaciones','supervisor','comercial') );
-- borrado: solo admin (soft-delete preferido vía deleted_at)
create policy crm_opp_delete on public.crm_opportunities for delete
  using ( public.is_admin() );
```

---

## 7. Permisos RBAC a sembrar (patrón `0022`/`0030`)

`comercial.view`/`comercial.edit` ya existen (`0009:196-197`). Agregar:

| Slug | Módulo | Acción | Label |
|---|---|---|---|
| `comercial.create` | comercial | create | Crear oportunidades / cotizaciones |
| `comercial.delete` | comercial | delete | Borrar (admin) |
| `comercial.admin` | comercial | admin | Administración del módulo comercial |
| `comercial.onboarding` | comercial | edit | Gestionar onboarding (o reutilizar `operaciones`) |

> No requiere `alter type ... add value` — el módulo `comercial` ya está en `permission_module_t` (`0009:23`). Solo `insert into permissions` + `role_permissions` en migración de seed.

---

## 8. Orden de migración propuesto (F2.1)

1. `00XX_crm_enums.sql` — crear todos los enums `crm_*` (commit aislado).
2. `00XX_crm_core.sql` — `crm_leads`, `crm_opportunities` + triggers `public_id` + RLS.
3. `00XX_crm_quotes_proposals.sql` — `crm_quotes(+items)`, `crm_proposals`.
4. `00XX_crm_contracts_onboarding.sql` — `crm_contracts`, `crm_onboarding(+tasks)`.
5. `00XX_crm_sync_audit.sql` — `crm_stage_history`, `clientify_sync_log`.
6. `00XX_crm_rbac_seed.sql` — permisos finos + mapeo a roles.
7. `00XX_profiles_public_view.sql` — vista segura de owners (mandato `0040`).

Todas en rama de feature, **nunca** sobre Supabase PROD sin autorización (restricción del handoff maestro).

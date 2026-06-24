# Tablero Comercial Clientify (Nexus) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar el artefacto offline `TOPS-Dashboard-Comercial-OFFLINE.html` a un módulo nativo de Nexus (`/comercial/tablero`) que lee de Clientify, persiste un snapshot diario a las 21:00 ART en Supabase, y permite editar probabilidad/horizonte/observaciones de forma compartida y auditada (reemplazando el `localStorage` per-device).

**Architecture:** Sigue el patrón de capas de Nexus: Feature `src/app/(app)/comercial/tablero` → Route Handler / Server Action → `src/lib/comercial/*.ts` → Supabase. El tablero NO consulta Clientify en cada carga: lee de una caché Supabase que un cron (GitHub Actions → endpoint protegido por `CRON_SECRET`) refresca a las 21:00, clonando el patrón ya probado de `contratos-drive-sync`/`caja-chica`. Las métricas se calculan con las reglas correctas que el `.html` tiene mal (excluir Expired/Lost del pipeline activo; forecast solo sobre activos).

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres + RLS + RPC `SECURITY DEFINER`), vitest, charts SVG nativos (reutiliza `src/components/charts/`), Tailwind 3.4.

## Global Constraints

- **G1 — No commit/push/deploy automático.** El asistente deja staged y muestra; ejecuta Martín. `main` queda local.
- **G3 — Migraciones idempotentes, numeradas, APLICADAS A MANO por Martín en el SQL Editor.** El asistente NO ejecuta WRITES en Supabase. Prohibido `supabase db push`. No reusar números con hueco (0012/0028). Próximo libre: **0085** (último es `0084_announcements.sql`).
- **G4 — PROD = `arsksytgdnzukbmfgkju`.** Validar primero en branch efímero (`create_branch`) si se valida contra DB.
- **G5 — Evidencia antes de cerrar:** build verde / test ejecutado / lectura de estado real. Nunca "validado" sin prueba.
- **G7 — Una fase por vez:** Fase 1 (datos + sync) → OK de Dirección → Fase 2 (UI). No arrancar Fase 2 sin OK.
- **G10/RPC + RLS:** toda tabla con RLS habilitada; policies por `public.current_role()`; escrituras del job con `createAdminClient()` (service-role, bypassa RLS); RPC `SECURITY DEFINER` con `set search_path = public, pg_temp`.
- **G11 — Fallback:** si `env.clientify.configured === false`, el tablero degrada con banner (no rompe el shell).
- **Pipelines visibles (fuente única):** `isVisibleCommercialPipeline()` de `src/lib/comercial/pipeline-filter.ts` (ANMAT / Cargas Generales / Oficinas). Excluir "Logística Tops" catch-all.
- **Status reales Clientify (de `mappers.ts`):** `1=open, 2=expired, 3=won, 4=lost`. "Activo" = `status !== "won" && status !== "lost"`. "Pipeline activo $" para forecast = excluir además `expired`.
- **Roles RBAC para edición del overlay:** `current_role() in ('admin','supervisor','operaciones')`. NOTA: `user_role_t` (migración 0001) = `admin|operaciones|supervisor|cliente`; **NO existe el valor `'comercial'`** en ese enum (eso vive en el sistema de slugs RBAC de 0009, que es otra cosa). El equipo comercial opera como `operaciones` (convención de `crm_opportunities`/0042 y caja-chica/0082).

---

## File Structure

| Archivo | Responsabilidad | Fase |
|---|---|---|
| `supabase/migrations/0085_clientify_dashboard.sql` | Caché de deals, overlay manual, snapshots diarios, bitácora, RPC replace | 1 |
| `src/lib/comercial/dashboard-snapshot.ts` | Funciones puras: agregar deals → filas de caché y de snapshot (testeable) | 1 |
| `src/lib/comercial/dashboard-sync-db.ts` | Persistencia (service-role): replace caché vía RPC + insert snapshots + sync_log | 1 |
| `src/app/api/clientify/sync-deals/route.ts` | **Modificar:** persistir a Supabase, `?dry=1`, POST, status 200/502 | 1 |
| `.github/workflows/clientify-dashboard-sync.yml` | Cron `0 0 * * *` (21:00 ART) → dispara el endpoint | 1 |
| `src/lib/comercial/dashboard-kpis.ts` | Funciones puras de KPIs/alertas (testeable) | 2 |
| `src/lib/comercial/dashboard-data.ts` | Data layer del tablero: lee caché + overlay + snapshots de Supabase | 2 |
| `src/lib/comercial/overlay-actions.ts` | Server action `upsertDealOverlay` (RLS) | 2 |
| `src/app/(app)/comercial/tablero/page.tsx` | Página server-component del tablero | 2 |
| `src/components/comercial/tablero/*.tsx` | KPIs, Funnel SVG, tabla editable, charts | 2 |

---

# FASE 1 — Fundación de datos + sincronización 21:00

> Entregable independiente y testeable: a las 21:00 ART, Clientify queda persistido en Supabase (caché + snapshot histórico), con bitácora y endpoint protegido. No toca UI todavía.

### Task 1: Migración 0085 — tablas + RPC (idempotente, NO aplicar)

**Files:**
- Create: `supabase/migrations/0085_clientify_dashboard.sql`

**Interfaces:**
- Produces (tablas): `public.clientify_deals_cache`, `public.crm_deal_overlay`, `public.clientify_dashboard_snapshots`, `public.clientify_sync_log`.
- Produces (RPC): `public.clientify_replace_deals_cache(p_rows jsonb, p_run_id uuid) returns int` (service_role).
- Produces (vista): `public.v_clientify_deals_enriched` (caché LEFT JOIN overlay, security_invoker).

- [ ] **Step 1: Escribir la migración idempotente**

Crear `supabase/migrations/0085_clientify_dashboard.sql` con EXACTAMENTE este contenido (sigue las convenciones auditadas en `0082_cash_box_foundation.sql`):

```sql
-- =========================================================================
-- 0085_clientify_dashboard — CRM Comercial › Tablero (espejo Clientify)
-- =========================================================================
-- Caché diaria de deals de Clientify + overlay manual (probabilidad/horizonte/
-- observaciones) compartido y auditado + snapshots históricos por pipeline para
-- tendencias. Un job (21:00 ART = 00:00 UTC) hace replace atómico de la caché y
-- agrega 1 snapshot por día por pipeline. Nexus NUNCA escribe en Clientify.
--
-- 100% ADITIVA. Convenciones (0082): id uuid default gen_random_uuid();
-- created_at/updated_at default now(); trigger public.tg_touch_updated_at()
-- (0005); RLS con public.current_role(); RPC security definer + search_path fijo;
-- revoke from public/anon/authenticated + grant a service_role.
-- =========================================================================

-- ---- Enum status de deal (espejo de mappers.ts) -------------------------
do $$ begin
  create type public.clientify_deal_status_t as enum ('open','expired','won','lost','other');
exception when duplicate_object then null; end $$;

-- ---- (A) Caché de deals (replace diario) --------------------------------
create table if not exists public.clientify_deals_cache (
  deal_id        bigint primary key,                    -- id de Clientify (estable)
  title          text not null default '',
  contact_name   text,
  company_name   text,
  amount         numeric(16,2) not null default 0,
  currency       text not null default 'ARS',
  stage          text,
  stage_id       bigint,
  pipeline       text,
  pipeline_id    bigint,
  probability    int not null default 0,                -- prob. de Clientify (no la editable)
  status         public.clientify_deal_status_t not null default 'other',
  status_label   text,
  owner_name     text,
  expected_close date,
  actual_close   date,
  created_src    timestamptz,                           -- created en Clientify
  modified_src   timestamptz,                           -- modified en Clientify
  href           text,
  sync_run_id    uuid,
  synced_at      timestamptz not null default now()
);
create index if not exists clientify_cache_pipeline_idx on public.clientify_deals_cache (pipeline_id, status);
create index if not exists clientify_cache_modified_idx on public.clientify_deals_cache (modified_src desc);

-- ---- (B) Overlay manual (compartido + auditado) -------------------------
-- Reemplaza el localStorage per-device del artefacto. 1 fila por deal.
create table if not exists public.crm_deal_overlay (
  clientify_deal_id bigint primary key,                 -- = clientify_deals_cache.deal_id
  probabilidad      int check (probabilidad between 0 and 100), -- override manual (null = usar la de Clientify)
  horizonte         text,                               -- 'Esta semana' | '15 días' | ... | 'A definir'
  observaciones     text,
  updated_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---- (C) Snapshot histórico — 1 por día por pipeline --------------------
create table if not exists public.clientify_dashboard_snapshots (
  id                uuid primary key default gen_random_uuid(),
  snapshot_date     date not null default current_date,
  pipeline_id       bigint not null,
  pipeline_name     text not null,
  sync_run_id       uuid,
  deals_total       int not null default 0,             -- todos los deals del pipeline
  deals_active      int not null default 0,             -- status not in (won,lost)
  total_amount      numeric(16,2) not null default 0,   -- Σ amount (todos)
  active_amount     numeric(16,2) not null default 0,   -- Σ amount (status in open,other) → "pipeline vivo"
  forecast_weighted numeric(16,2) not null default 0,   -- Σ amount*prob/100 (solo activos no expired)
  won_count         int not null default 0,
  won_amount        numeric(16,2) not null default 0,
  lost_count        int not null default 0,
  expired_count     int not null default 0,
  avg_probability   numeric(6,2) not null default 0,
  created_at        timestamptz not null default now(),
  unique (snapshot_date, pipeline_id)                   -- upsert: última corrida del día gana
);
create index if not exists clientify_snap_idx on public.clientify_dashboard_snapshots (pipeline_id, snapshot_date desc);

-- ---- (D) Bitácora de sync ----------------------------------------------
create table if not exists public.clientify_sync_log (
  id            bigserial primary key,
  run_id        uuid not null unique default gen_random_uuid(),
  trigger       text not null check (trigger in ('cron','manual','api')),
  status        text not null check (status in ('running','completed','partial','error','skipped')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   int,
  pipelines     int default 0,
  deals_synced  int default 0,
  errors        int default 0,
  message       text,
  report        jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists clientify_sync_started_idx on public.clientify_sync_log (started_at desc);

-- ---- Triggers updated_at (usa public.tg_touch_updated_at() de 0005) ------
drop trigger if exists trg_crm_deal_overlay_touch on public.crm_deal_overlay;
create trigger trg_crm_deal_overlay_touch
  before update on public.crm_deal_overlay
  for each row execute function public.tg_touch_updated_at();

-- ---- (E) Replace ATÓMICO de la caché (DELETE+INSERT) --------------------
-- security definer + search_path fijo; EXECUTE solo service_role (lo llama el job).
create or replace function public.clientify_replace_deals_cache(p_rows jsonb, p_run_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  delete from public.clientify_deals_cache;
  insert into public.clientify_deals_cache
    (deal_id, title, contact_name, company_name, amount, currency, stage, stage_id,
     pipeline, pipeline_id, probability, status, status_label, owner_name,
     expected_close, actual_close, created_src, modified_src, href, sync_run_id)
  select (r->>'deal_id')::bigint,
         coalesce(r->>'title',''),
         nullif(r->>'contact_name',''),
         nullif(r->>'company_name',''),
         coalesce((r->>'amount')::numeric, 0),
         coalesce(nullif(r->>'currency',''), 'ARS'),
         nullif(r->>'stage',''),
         nullif(r->>'stage_id','')::bigint,
         nullif(r->>'pipeline',''),
         nullif(r->>'pipeline_id','')::bigint,
         coalesce((r->>'probability')::int, 0),
         coalesce(nullif(r->>'status','')::public.clientify_deal_status_t, 'other'),
         nullif(r->>'status_label',''),
         nullif(r->>'owner_name',''),
         nullif(r->>'expected_close','')::date,
         nullif(r->>'actual_close','')::date,
         nullif(r->>'created_src','')::timestamptz,
         nullif(r->>'modified_src','')::timestamptz,
         nullif(r->>'href',''),
         p_run_id
  from jsonb_array_elements(p_rows) as r;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.clientify_replace_deals_cache(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.clientify_replace_deals_cache(jsonb, uuid) to service_role;

-- ---- (F) Vista de lectura: caché + overlay ------------------------------
create or replace view public.v_clientify_deals_enriched
  with (security_invoker = true) as
  select c.*,
         o.probabilidad  as overlay_probabilidad,
         o.horizonte     as overlay_horizonte,
         o.observaciones as overlay_observaciones,
         o.updated_at    as overlay_updated_at,
         coalesce(o.probabilidad, c.probability) as effective_probability
  from public.clientify_deals_cache c
  left join public.crm_deal_overlay o on o.clientify_deal_id = c.deal_id;

-- ---- RLS ----------------------------------------------------------------
-- Lectura: cualquier autenticado (datos comerciales internos, patrón compliance/caja-chica).
-- Escritura overlay: roles comerciales. Caché/snapshots/log: solo service-role (sin policy write).
alter table public.clientify_deals_cache         enable row level security;
alter table public.crm_deal_overlay              enable row level security;
alter table public.clientify_dashboard_snapshots enable row level security;
alter table public.clientify_sync_log            enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'clientify_deals_cache','crm_deal_overlay','clientify_dashboard_snapshots','clientify_sync_log'
  ] loop
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format($f$
      create policy "%1$s read" on public.%1$s
        for select to authenticated using (true);
    $f$, t);
  end loop;
end $$;

-- Escritura del overlay: solo roles comerciales (los demás writes van por service-role).
drop policy if exists "crm_deal_overlay write" on public.crm_deal_overlay;
create policy "crm_deal_overlay write" on public.crm_deal_overlay
  for all to authenticated
  using (public.current_role() in ('admin','supervisor','operaciones'))
  with check (public.current_role() in ('admin','supervisor','operaciones'));

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Verificar idempotencia (lectura estática, sin aplicar)**

Run: `grep -c "if not exists\|or replace\|duplicate_object\|drop policy if exists\|drop trigger if exists" supabase/migrations/0085_clientify_dashboard.sql`
Expected: ≥ 10 (cada objeto creado de forma idempotente). Confirmar que NO hay `drop table`, `alter ... drop column`, ni `db push`.

- [ ] **Step 3: Confirmar numeración libre**

Run: `ls supabase/migrations/ | grep -E "^0085" ; echo "exit=$?"`
Expected: solo `0085_clientify_dashboard.sql` (no colisión).

- [ ] **Step 4: ENTREGAR, NO APLICAR (G3)**

NO ejecutar la migración. Dejar el archivo staged y avisar a Martín que la aplique a mano en el SQL Editor de prod `arsksytgdnzukbmfgkju`. La validación contra DB (Task siguiente) recién corre una vez aplicada (o en un branch efímero `create_branch`).

---

### Task 2: Módulo de persistencia + agregación pura

**Files:**
- Create: `src/lib/comercial/dashboard-snapshot.ts`
- Create: `src/lib/comercial/dashboard-sync-db.ts`
- Test: `src/lib/comercial/dashboard-snapshot.test.ts`

**Interfaces:**
- Consumes: `UiDeal` de `@/lib/clientify/mappers`.
- Produces: `buildCacheRows(deals: UiDeal[]): CacheRow[]`; `buildSnapshotRows(deals: UiDeal[], runId: string): SnapshotRow[]`; `persistDealsSync(deals, runId): Promise<{cached:number; snapshots:number}>`.

- [ ] **Step 1: Escribir el test de agregación (falla primero)**

Crear `src/lib/comercial/dashboard-snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSnapshotRows } from "./dashboard-snapshot";
import type { UiDeal } from "@/lib/clientify/mappers";

function deal(p: Partial<UiDeal>): UiDeal {
  return {
    id: 1, title: "t", contactName: null, contactEmail: null, contactPhone: null,
    companyName: null, amount: 0, currency: "ARS", stage: "s", stageId: 1,
    pipeline: "ANMAT", pipelineId: 10, probability: 0, probabilityLabel: "",
    status: "open", statusLabel: "", ownerName: null, expectedClose: null,
    actualClose: null, createdAt: "", modifiedAt: "", tags: [], source: null, href: "",
    ...p,
  };
}

describe("buildSnapshotRows", () => {
  it("excluye won/lost del pipeline activo y expired del forecast", () => {
    const deals: UiDeal[] = [
      deal({ id: 1, pipelineId: 10, pipeline: "ANMAT", amount: 1000, probability: 50, status: "open" }),
      deal({ id: 2, pipelineId: 10, pipeline: "ANMAT", amount: 2000, probability: 80, status: "expired" }),
      deal({ id: 3, pipelineId: 10, pipeline: "ANMAT", amount: 5000, probability: 100, status: "won" }),
      deal({ id: 4, pipelineId: 10, pipeline: "ANMAT", amount: 9000, probability: 0, status: "lost" }),
    ];
    const [row] = buildSnapshotRows(deals, "run-1");
    expect(row.pipeline_id).toBe(10);
    expect(row.deals_total).toBe(4);
    expect(row.deals_active).toBe(2);          // open + expired (no won/lost)
    expect(row.total_amount).toBe(8000);       // todos
    expect(row.active_amount).toBe(1000);      // solo open/other (vivo real)
    expect(row.forecast_weighted).toBe(500);   // 1000*0.5 (expired excluido)
    expect(row.won_count).toBe(1);
    expect(row.won_amount).toBe(5000);
    expect(row.lost_count).toBe(1);
    expect(row.expired_count).toBe(1);
  });

  it("agrupa por pipeline_id", () => {
    const rows = buildSnapshotRows(
      [deal({ pipelineId: 10 }), deal({ pipelineId: 20, pipeline: "Cargas Generales" })],
      "run-1"
    );
    expect(rows.map((r) => r.pipeline_id).sort()).toEqual([10, 20]);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm run test -- dashboard-snapshot`
Expected: FAIL ("buildSnapshotRows is not a function" / módulo inexistente).

- [ ] **Step 3: Implementar `dashboard-snapshot.ts` (funciones puras)**

Crear `src/lib/comercial/dashboard-snapshot.ts`:

```ts
import type { UiDeal } from "@/lib/clientify/mappers";

export interface CacheRow {
  deal_id: number;
  title: string;
  contact_name: string | null;
  company_name: string | null;
  amount: number;
  currency: string;
  stage: string | null;
  stage_id: number | null;
  pipeline: string | null;
  pipeline_id: number | null;
  probability: number;
  status: UiDeal["status"];
  status_label: string | null;
  owner_name: string | null;
  expected_close: string | null;
  actual_close: string | null;
  created_src: string | null;
  modified_src: string | null;
  href: string | null;
}

export interface SnapshotRow {
  pipeline_id: number;
  pipeline_name: string;
  deals_total: number;
  deals_active: number;
  total_amount: number;
  active_amount: number;
  forecast_weighted: number;
  won_count: number;
  won_amount: number;
  lost_count: number;
  expired_count: number;
  avg_probability: number;
  sync_run_id: string;
}

const isActive = (d: UiDeal) => d.status !== "won" && d.status !== "lost";
const isLive = (d: UiDeal) => d.status === "open" || d.status === "other"; // excluye expired/won/lost

export function buildCacheRows(deals: UiDeal[]): CacheRow[] {
  return deals.map((d) => ({
    deal_id: d.id,
    title: d.title ?? "",
    contact_name: d.contactName,
    company_name: d.companyName,
    amount: d.amount,
    currency: d.currency || "ARS",
    stage: d.stage,
    stage_id: d.stageId,
    pipeline: d.pipeline,
    pipeline_id: d.pipelineId,
    probability: d.probability ?? 0,
    status: d.status,
    status_label: d.statusLabel,
    owner_name: d.ownerName,
    expected_close: d.expectedClose,
    actual_close: d.actualClose,
    created_src: d.createdAt || null,
    modified_src: d.modifiedAt || null,
    href: d.href,
  }));
}

export function buildSnapshotRows(deals: UiDeal[], runId: string): SnapshotRow[] {
  const byPipeline = new Map<number, UiDeal[]>();
  for (const d of deals) {
    if (d.pipelineId == null) continue;
    const arr = byPipeline.get(d.pipelineId) ?? [];
    arr.push(d);
    byPipeline.set(d.pipelineId, arr);
  }
  const rows: SnapshotRow[] = [];
  for (const [pid, ds] of byPipeline) {
    const active = ds.filter(isActive);
    const live = ds.filter(isLive);
    const sum = (xs: UiDeal[], f: (d: UiDeal) => number) => xs.reduce((a, d) => a + f(d), 0);
    rows.push({
      pipeline_id: pid,
      pipeline_name: ds[0]?.pipeline ?? "—",
      deals_total: ds.length,
      deals_active: active.length,
      total_amount: sum(ds, (d) => d.amount),
      active_amount: sum(live, (d) => d.amount),
      forecast_weighted: sum(live, (d) => (d.amount * (d.probability ?? 0)) / 100),
      won_count: ds.filter((d) => d.status === "won").length,
      won_amount: sum(ds.filter((d) => d.status === "won"), (d) => d.amount),
      lost_count: ds.filter((d) => d.status === "lost").length,
      expired_count: ds.filter((d) => d.status === "expired").length,
      avg_probability: active.length
        ? Math.round((sum(active, (d) => d.probability ?? 0) / active.length) * 100) / 100
        : 0,
      sync_run_id: runId,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm run test -- dashboard-snapshot`
Expected: PASS (2 tests).

- [ ] **Step 5: Implementar `dashboard-sync-db.ts` (persistencia service-role)**

Crear `src/lib/comercial/dashboard-sync-db.ts` (sigue el patrón de `src/lib/tesoreria/caja-chica/sync-db.ts`):

```ts
import { createAdminClient } from "@/lib/supabase/server";
import type { UiDeal } from "@/lib/clientify/mappers";
import { buildCacheRows, buildSnapshotRows } from "./dashboard-snapshot";

/**
 * Persiste el snapshot de Clientify en Supabase con service-role (bypassa RLS):
 *  1. Replace atómico de la caché vía RPC clientify_replace_deals_cache.
 *  2. Upsert de 1 snapshot por pipeline por día (unique snapshot_date,pipeline_id).
 * Devuelve los conteos para la bitácora. No escribe el log (lo hace la route).
 */
export async function persistDealsSync(
  deals: UiDeal[],
  runId: string
): Promise<{ cached: number; snapshots: number }> {
  const admin = createAdminClient();

  const cacheRows = buildCacheRows(deals);
  const { data: cached, error: rpcErr } = await admin.rpc("clientify_replace_deals_cache", {
    p_rows: cacheRows,
    p_run_id: runId,
  });
  if (rpcErr) throw new Error(`replace cache: ${rpcErr.message}`);

  const snapRows = buildSnapshotRows(deals, runId).map((r) => ({
    ...r,
    snapshot_date: new Date().toISOString().slice(0, 10),
  }));
  if (snapRows.length) {
    const { error: snapErr } = await admin
      .from("clientify_dashboard_snapshots")
      .upsert(snapRows, { onConflict: "snapshot_date,pipeline_id" });
    if (snapErr) throw new Error(`upsert snapshots: ${snapErr.message}`);
  }

  return { cached: (cached as number) ?? cacheRows.length, snapshots: snapRows.length };
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: 0 errores. (Si `admin.rpc` tipa estricto, castear `p_rows` a `unknown` no es necesario; `createAdminClient()` ya devuelve un client `any`-friendly como en `caja-chica/sync-db.ts`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/comercial/dashboard-snapshot.ts src/lib/comercial/dashboard-snapshot.test.ts src/lib/comercial/dashboard-sync-db.ts
git commit -m "feat(comercial): persistencia de snapshot Clientify para tablero"
```
> (G1: NO ejecutar sin OK de Martín. Dejar staged si se prefiere.)

---

### Task 3: Extender el endpoint `sync-deals` para persistir

**Files:**
- Modify: `src/app/api/clientify/sync-deals/route.ts`

**Interfaces:**
- Consumes: `persistDealsSync` de `@/lib/comercial/dashboard-sync-db`; `isVisibleCommercialPipeline` de `@/lib/comercial/pipeline-filter`.
- Produces: respuesta JSON con `{ ok, runId, cached, snapshots, ... }`; status 200 ok / 401 cron / 502 error / 503 sin key.

- [ ] **Step 1: Reescribir el handler para persistir + dry-run + POST**

Reemplazar el contenido de `src/app/api/clientify/sync-deals/route.ts` por:

```ts
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listDeals, listPipelines, ClientifyError } from "@/lib/clientify/client";
import { mapDeal } from "@/lib/clientify/mappers";
import { isVisibleCommercialPipeline } from "@/lib/comercial/pipeline-filter";
import { persistDealsSync } from "@/lib/comercial/dashboard-sync-db";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/clientify/sync-deals
 * Snapshot diario de deals de Clientify → Supabase (caché + snapshots).
 * Cron 21:00 ART vía .github/workflows/clientify-dashboard-sync.yml.
 * Auth: si CRON_SECRET está seteado, exige Authorization: Bearer <secret>.
 * `?dry=1` recorre y reporta sin escribir. Status: 401 cron · 200 ok · 502 error · 503 sin key.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!env.clientify.configured) {
    return NextResponse.json({ ok: false, error: "CLIENTIFY_API_KEY no configurada" }, { status: 503 });
  }

  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const runId = randomUUID();
  const started = Date.now();

  try {
    const pipelinesRes = await listPipelines();
    // Solo pipelines comerciales visibles (ANMAT / Cargas Generales / Oficinas).
    const pipelines = pipelinesRes.results.filter((p) => isVisibleCommercialPipeline(p.name));

    const dealsByPipeline = await Promise.all(
      pipelines.map(async (p) => {
        const res = await listDeals({ pipeline_id: p.id, page_size: 500, ordering: "-modified" });
        return res.results.map(mapDeal);
      })
    );
    const deals = dealsByPipeline.flat();

    let persisted = { cached: 0, snapshots: 0 };
    if (!dryRun) {
      persisted = await persistDealsSync(deals, runId);
      const elapsed = Date.now() - started;
      await createAdminClient().from("clientify_sync_log").insert({
        run_id: runId,
        trigger: "cron",
        status: "completed",
        finished_at: new Date().toISOString(),
        duration_ms: elapsed,
        pipelines: pipelines.length,
        deals_synced: deals.length,
        errors: 0,
        message: `OK ${deals.length} deals / ${persisted.snapshots} snapshots`,
      });
    }

    return NextResponse.json({
      ok: true,
      runId,
      dryRun,
      syncedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      pipelines: pipelines.length,
      totalDeals: deals.length,
      cached: persisted.cached,
      snapshots: persisted.snapshots,
    });
  } catch (e) {
    const status = e instanceof ClientifyError && e.status >= 400 && e.status < 600 ? e.status : 502;
    // Bitácora de error (best-effort, no rompe la respuesta).
    try {
      await createAdminClient().from("clientify_sync_log").insert({
        run_id: runId, trigger: "cron", status: "error",
        finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
        errors: 1, message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* noop */ }
    return NextResponse.json(
      { ok: false, runId, error: e instanceof Error ? e.message : String(e) },
      { status }
    );
  }
}

export async function GET(req: Request): Promise<Response> { return handle(req); }
export async function POST(req: Request): Promise<Response> { return handle(req); }
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: typecheck 0 errores; build exit 0.

- [ ] **Step 3: Verificación funcional dry-run (sin escribir DB)**

Levantar dev (`npm run dev`, corre desde main por G8) y, con `CLIENTIFY_API_KEY` configurada:
Run: `curl -s "http://localhost:3030/api/clientify/sync-deals?dry=1" | jq '{ok,pipelines,totalDeals,dryRun}'`
Expected: `{ "ok": true, "pipelines": 3, "totalDeals": <n>, "dryRun": true }` (3 = ANMAT/Cargas/Oficinas). Sin escribir Supabase.

- [ ] **Step 4: Verificación de persistencia (requiere 0085 aplicada por Martín)**

Run: `curl -s "http://localhost:3030/api/clientify/sync-deals" | jq '{ok,cached,snapshots}'`
Expected: `{ "ok": true, "cached": <n>, "snapshots": 3 }`. Luego confirmar filas reales vía MCP Supabase (read-only): `select count(*) from clientify_deals_cache;` y `select snapshot_date,pipeline_name,deals_active,forecast_weighted from clientify_dashboard_snapshots order by created_at desc limit 3;`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/clientify/sync-deals/route.ts
git commit -m "feat(clientify): sync-deals persiste caché+snapshot a Supabase (cron 21:00)"
```

---

### Task 4: Workflow cron 21:00 ART

**Files:**
- Create: `.github/workflows/clientify-dashboard-sync.yml`

**Interfaces:**
- Consumes: secrets `CRON_SECRET`, `APP_URL` (GitHub Actions). Endpoint `POST /api/clientify/sync-deals`.

- [ ] **Step 1: Crear el workflow (clon del de contratos)**

Crear `.github/workflows/clientify-dashboard-sync.yml`:

```yaml
name: Clientify · Tablero Comercial Sync (diario 21:00 ART)

# Snapshot diario de deals de Clientify → Supabase (caché + snapshots históricos),
# fuente del Tablero Comercial de Nexus. Dispara el endpoint protegido
# /api/clientify/sync-deals, que recorre los pipelines comerciales visibles.
#
# Horario: 00:00 UTC = 21:00 America/Argentina/Buenos_Aires (UTC-3 fijo, sin DST).
#
# Secrets (GitHub → Settings → Secrets and variables → Actions):
#   - CRON_SECRET : mismo valor que la env var CRON_SECRET en Netlify.
#   - APP_URL     : (opcional) base URL del deploy; default https://tops-ordenes.netlify.app

on:
  schedule:
    - cron: "0 0 * * *" # 00:00 UTC = 21:00 ART, diario
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: clientify-dashboard-sync
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Trigger Clientify dashboard sync endpoint
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          set -euo pipefail
          BASE="${APP_URL:-https://tops-ordenes.netlify.app}"
          echo "POST $BASE/api/clientify/sync-deals"
          code=$(curl -sS --max-time 120 -o /tmp/resp.json -w "%{http_code}" -X POST \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            "$BASE/api/clientify/sync-deals")
          echo "HTTP $code"
          cat /tmp/resp.json || true
          echo
          test "$code" = "200"
          ok=$(jq -r '.ok // false' /tmp/resp.json)
          deals=$(jq -r '.totalDeals // 0' /tmp/resp.json)
          echo "ok=$ok totalDeals=$deals"
          if [ "$ok" != "true" ]; then
            echo "::error::Sync Clientify falló (ok=$ok). Revisar el reporte arriba."
            exit 1
          fi
          echo "Sync Clientify completo ($deals deals)."
```

- [ ] **Step 2: Validar el YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/clientify-dashboard-sync.yml')); print('YAML OK')"`
Expected: `YAML OK`.

- [ ] **Step 3: Verificación end-to-end (post-deploy, manual)**

Tras el deploy a prod (que ejecuta Martín, G1), disparar `workflow_dispatch` desde la pestaña Actions y confirmar HTTP 200 + `ok=true`. Es la evidencia G5 de que la sync 21:00 quedó operativa.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/clientify-dashboard-sync.yml
git commit -m "ci(clientify): cron 21:00 ART para sync del tablero comercial"
```

> **GATE FASE 1 (G7):** `npm run typecheck` 0 · `npm run build` exit 0 · dry-run OK · migración 0085 entregada (no aplicada). **Esperar OK de Dirección antes de Fase 2.**

---

# FASE 2 — Tablero UI + edición compartida (overlay)

> Depende de Fase 1 aplicada. Construye `/comercial/tablero` leyendo de Supabase (caché+overlay+snapshots), con KPIs correctos, charts SVG, y edición de probabilidad/horizonte/observaciones persistida en `crm_deal_overlay`.

### Task 5: KPIs y alertas — funciones puras (TDD)

**Files:**
- Create: `src/lib/comercial/dashboard-kpis.ts`
- Test: `src/lib/comercial/dashboard-kpis.test.ts`

**Interfaces:**
- Produces: `EnrichedDeal` (tipo de fila de `v_clientify_deals_enriched`); `computeKpis(deals: EnrichedDeal[]): Kpis`; `dealAlerts(d: EnrichedDeal, today: Date): Alert[]`.

- [ ] **Step 1: Test (falla primero)**

Crear `src/lib/comercial/dashboard-kpis.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeKpis, dealAlerts, type EnrichedDeal } from "./dashboard-kpis";

function ed(p: Partial<EnrichedDeal>): EnrichedDeal {
  return {
    deal_id: 1, title: "t", company_name: null, contact_name: null, amount: 0,
    currency: "ARS", pipeline: "ANMAT", pipeline_id: 10, stage: "s", status: "open",
    owner_name: null, expected_close: null, modified_src: null, href: "",
    effective_probability: 0, overlay_horizonte: null, overlay_observaciones: null, ...p,
  };
}

describe("computeKpis", () => {
  it("forecast solo sobre activos no-expired; pipeline vivo excluye won/lost/expired", () => {
    const k = computeKpis([
      ed({ amount: 1000, effective_probability: 50, status: "open" }),
      ed({ amount: 2000, effective_probability: 80, status: "expired" }),
      ed({ amount: 5000, effective_probability: 100, status: "won" }),
    ]);
    expect(k.count).toBe(3);
    expect(k.activePipeline).toBe(1000);  // solo open
    expect(k.forecast).toBe(500);          // 1000*0.5
    expect(k.wonAmount).toBe(5000);
  });
});

describe("dealAlerts", () => {
  const today = new Date("2026-06-24T12:00:00");
  it("marca cierre vencido y deal estancado", () => {
    const alerts = dealAlerts(
      ed({ status: "open", expected_close: "2026-06-01", modified_src: "2026-05-01T00:00:00Z" }),
      today
    ).map((a) => a.kind);
    expect(alerts).toContain("overdue");
    expect(alerts).toContain("stale");
  });
  it("no alerta deals ganados", () => {
    expect(dealAlerts(ed({ status: "won", expected_close: "2026-06-01" }), today)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr → falla**

Run: `npm run test -- dashboard-kpis`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `dashboard-kpis.ts`**

```ts
export interface EnrichedDeal {
  deal_id: number;
  title: string;
  company_name: string | null;
  contact_name: string | null;
  amount: number;
  currency: string;
  pipeline: string | null;
  pipeline_id: number | null;
  stage: string | null;
  status: "open" | "expired" | "won" | "lost" | "other";
  owner_name: string | null;
  expected_close: string | null;
  modified_src: string | null;
  href: string;
  effective_probability: number;        // overlay.probabilidad ?? clientify.probability
  overlay_horizonte: string | null;
  overlay_observaciones: string | null;
}

export interface Kpis {
  count: number;
  totalPipeline: number;   // Σ amount (todos)
  activePipeline: number;  // Σ amount (open/other) — pipeline vivo
  forecast: number;        // Σ amount*prob/100 (open/other)
  wonAmount: number;
  avgProbability: number;
  byPipeline: { id: number; name: string; active: number; forecast: number; count: number }[];
}

export interface Alert { kind: "overdue" | "stale" | "lowprob"; label: string; }

const isLive = (d: EnrichedDeal) => d.status === "open" || d.status === "other";
const STALE_DAYS = 21;

export function computeKpis(deals: EnrichedDeal[]): Kpis {
  const live = deals.filter(isLive);
  const sum = (xs: EnrichedDeal[], f: (d: EnrichedDeal) => number) => xs.reduce((a, d) => a + f(d), 0);
  const byMap = new Map<number, { id: number; name: string; active: number; forecast: number; count: number }>();
  for (const d of live) {
    if (d.pipeline_id == null) continue;
    const e = byMap.get(d.pipeline_id) ?? { id: d.pipeline_id, name: d.pipeline ?? "—", active: 0, forecast: 0, count: 0 };
    e.active += d.amount;
    e.forecast += (d.amount * d.effective_probability) / 100;
    e.count += 1;
    byMap.set(d.pipeline_id, e);
  }
  return {
    count: deals.length,
    totalPipeline: sum(deals, (d) => d.amount),
    activePipeline: sum(live, (d) => d.amount),
    forecast: sum(live, (d) => (d.amount * d.effective_probability) / 100),
    wonAmount: sum(deals.filter((d) => d.status === "won"), (d) => d.amount),
    avgProbability: live.length ? Math.round(sum(live, (d) => d.effective_probability) / live.length) : 0,
    byPipeline: [...byMap.values()].sort((a, b) => b.active - a.active),
  };
}

export function dealAlerts(d: EnrichedDeal, today: Date): Alert[] {
  if (!isLive(d)) return [];
  const out: Alert[] = [];
  if (d.expected_close && new Date(d.expected_close + "T12:00:00") < today)
    out.push({ kind: "overdue", label: "Cierre estimado vencido" });
  if (d.modified_src) {
    const days = (today.getTime() - new Date(d.modified_src).getTime()) / 86_400_000;
    if (days >= STALE_DAYS) out.push({ kind: "stale", label: `Sin actividad ${Math.floor(days)} días` });
  }
  if (d.effective_probability > 0 && d.effective_probability < 15)
    out.push({ kind: "lowprob", label: "Probabilidad baja" });
  return out;
}
```

- [ ] **Step 4: Correr → pasa**

Run: `npm run test -- dashboard-kpis`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/comercial/dashboard-kpis.ts src/lib/comercial/dashboard-kpis.test.ts
git commit -m "feat(comercial): KPIs y alertas del tablero (funciones puras + tests)"
```

---

### Task 6: Data layer del tablero

**Files:**
- Create: `src/lib/comercial/dashboard-data.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server` (RLS); `EnrichedDeal`, `computeKpis` de `./dashboard-kpis`.
- Produces: `getTableroData(): Promise<TableroData>` con `{ deals, kpis, trends, lastSync, configured }`.

- [ ] **Step 1: Implementar `dashboard-data.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { computeKpis, type EnrichedDeal, type Kpis } from "./dashboard-kpis";

export interface TrendPoint { date: string; forecast: number; active: number; }
export interface TableroData {
  configured: boolean;
  deals: EnrichedDeal[];
  kpis: Kpis;
  trends: Record<number, TrendPoint[]>; // pipeline_id → serie (últimos 30 snapshots)
  lastSync: string | null;
}

const EMPTY_KPIS: Kpis = {
  count: 0, totalPipeline: 0, activePipeline: 0, forecast: 0, wonAmount: 0, avgProbability: 0, byPipeline: [],
};

export async function getTableroData(): Promise<TableroData> {
  const supabase = createClient();

  const { data: rows } = await supabase
    .from("v_clientify_deals_enriched")
    .select(
      "deal_id,title,company_name,contact_name,amount,currency,pipeline,pipeline_id,stage,status,owner_name,expected_close,modified_src,href,effective_probability,overlay_horizonte,overlay_observaciones"
    )
    .order("amount", { ascending: false });

  const deals = (rows ?? []) as EnrichedDeal[];

  const { data: snaps } = await supabase
    .from("clientify_dashboard_snapshots")
    .select("snapshot_date,pipeline_id,forecast_weighted,active_amount")
    .order("snapshot_date", { ascending: true })
    .limit(300);

  const trends: Record<number, TrendPoint[]> = {};
  for (const s of snaps ?? []) {
    (trends[s.pipeline_id] ??= []).push({
      date: s.snapshot_date, forecast: Number(s.forecast_weighted), active: Number(s.active_amount),
    });
  }

  const { data: log } = await supabase
    .from("clientify_sync_log")
    .select("finished_at,status")
    .eq("status", "completed")
    .order("finished_at", { ascending: false })
    .limit(1);

  return {
    configured: env.clientify.configured,
    deals,
    kpis: deals.length ? computeKpis(deals) : EMPTY_KPIS,
    trends,
    lastSync: log?.[0]?.finished_at ?? null,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/comercial/dashboard-data.ts
git commit -m "feat(comercial): data layer del tablero (caché+overlay+trends desde Supabase)"
```

---

### Task 7: Server action de edición del overlay

**Files:**
- Create: `src/lib/comercial/overlay-actions.ts`

**Interfaces:**
- Produces: `upsertDealOverlay(input: { dealId: number; probabilidad?: number | null; horizonte?: string | null; observaciones?: string | null }): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Implementar la action**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const HORIZONTES = new Set([
  "Esta semana", "15 días", "30 días", "60 días", "90 días", "+90 días", "A definir",
]);

export async function upsertDealOverlay(input: {
  dealId: number;
  probabilidad?: number | null;
  horizonte?: string | null;
  observaciones?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: "No autenticado" };

  // Validación (defensa en profundidad; la RLS exige rol operaciones/admin/supervisor).
  if (input.probabilidad != null && (input.probabilidad < 0 || input.probabilidad > 100))
    return { ok: false, error: "Probabilidad fuera de rango" };
  if (input.horizonte != null && !HORIZONTES.has(input.horizonte))
    return { ok: false, error: "Horizonte inválido" };
  const obs = input.observaciones?.slice(0, 2000) ?? null;

  const { error } = await supabase.from("crm_deal_overlay").upsert(
    {
      clientify_deal_id: input.dealId,
      probabilidad: input.probabilidad ?? null,
      horizonte: input.horizonte ?? null,
      observaciones: obs,
      updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clientify_deal_id" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/comercial/tablero");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/comercial/overlay-actions.ts
git commit -m "feat(comercial): server action upsert overlay (probabilidad/horizonte/observaciones)"
```

---

### Task 8: Página del tablero + componentes

**Files:**
- Create: `src/app/(app)/comercial/tablero/page.tsx`
- Create: `src/components/comercial/tablero/KpiCards.tsx`
- Create: `src/components/comercial/tablero/FunnelChart.tsx`
- Create: `src/components/comercial/tablero/DealsTable.tsx`

**Interfaces:**
- Consumes: `getTableroData` (Task 6); `computeKpis`/`dealAlerts`/`EnrichedDeal` (Task 5); `upsertDealOverlay` (Task 7); `ServiceMixDonut`, `Sparkline` de `@/components/charts/*`.

- [ ] **Step 1: Página server-component**

Crear `src/app/(app)/comercial/tablero/page.tsx`. Reusar el guard de página del módulo comercial (mismo patrón que `comercial/pipeline/page.tsx`).

```tsx
import { getTableroData } from "@/lib/comercial/dashboard-data";
import { KpiCards } from "@/components/comercial/tablero/KpiCards";
import { FunnelChart } from "@/components/comercial/tablero/FunnelChart";
import { DealsTable } from "@/components/comercial/tablero/DealsTable";

export const metadata = { title: "Tablero Comercial · Clientify" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TableroPage() {
  const data = await getTableroData();

  if (!data.configured) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Tablero Comercial</h1>
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Clientify no está configurado (<code>CLIENTIFY_API_KEY</code>). El tablero se activa
          cuando la integración esté seteada y el cron de las 21:00 haya corrido al menos una vez.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-400">Comercial · CRM</div>
          <h1 className="text-2xl font-bold">Tablero de Oportunidades</h1>
        </div>
        <div className="text-xs text-slate-400">
          Última sync: {data.lastSync ? new Date(data.lastSync).toLocaleString("es-AR") : "—"}
        </div>
      </header>

      <KpiCards kpis={data.kpis} trends={data.trends} />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FunnelChart deals={data.deals} />
      </section>
      <DealsTable deals={data.deals} />
    </div>
  );
}
```

- [ ] **Step 2: `KpiCards.tsx` (server component)**

Crear `src/components/comercial/tablero/KpiCards.tsx`. KPI héroe = Forecast ponderado activo; tarjetas secundarias por pipeline; mini-tendencia con `Sparkline`.

```tsx
import { Sparkline } from "@/components/charts/Sparkline";
import type { Kpis } from "@/lib/comercial/dashboard-kpis";
import type { TrendPoint } from "@/lib/comercial/dashboard-data";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);

export function KpiCards({ kpis, trends }: { kpis: Kpis; trends: Record<number, TrendPoint[]> }) {
  const allForecast = Object.values(trends).reduce<number[]>((acc, serie) => {
    serie.forEach((p, i) => { acc[i] = (acc[i] ?? 0) + p.forecast; });
    return acc;
  }, []);
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-300 bg-white p-4 shadow-sm dark:bg-slate-900">
        <div className="text-[10px] uppercase tracking-wider text-emerald-600">Forecast ponderado (activo)</div>
        <div className="mt-1 font-mono text-2xl font-bold text-emerald-600">{fmt(kpis.forecast)}</div>
        {allForecast.length > 1 && <div className="mt-2"><Sparkline data={allForecast} color="#059669" /></div>}
      </div>
      <Kpi label="Pipeline vivo" value={fmt(kpis.activePipeline)} sub={`${kpis.count} oportunidades`} />
      <Kpi label="Ganado YTD" value={fmt(kpis.wonAmount)} sub="cerrado este año" />
      <Kpi label="Prob. promedio" value={`${kpis.avgProbability}%`} sub="deals activos" />
      {kpis.byPipeline.map((p) => (
        <Kpi key={p.id} label={p.name} value={fmt(p.active)} sub={`${p.count} deals · fcast ${fmt(p.forecast)}`} />
      ))}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 3: `FunnelChart.tsx` (SVG nativo)**

Crear `src/components/comercial/tablero/FunnelChart.tsx`: barras horizontales por etapa (cuenta + monto), SVG puro (sin librería), agrupando deals activos por `stage`.

```tsx
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { notation: "compact", style: "currency", currency: "ARS" }).format(n || 0);

export function FunnelChart({ deals }: { deals: EnrichedDeal[] }) {
  const live = deals.filter((d) => d.status === "open" || d.status === "other");
  const byStage = new Map<string, { count: number; amount: number }>();
  for (const d of live) {
    const k = d.stage ?? "—";
    const e = byStage.get(k) ?? { count: 0, amount: 0 };
    e.count += 1; e.amount += d.amount;
    byStage.set(k, e);
  }
  const rows = [...byStage.entries()].sort((a, b) => b[1].count - a[1].count);
  const max = Math.max(1, ...rows.map((r) => r[1].count));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-semibold">Funnel comercial (activos por etapa)</h3>
      <div className="space-y-2">
        {rows.map(([stage, v]) => (
          <div key={stage} className="flex items-center gap-2 text-xs">
            <span className="w-44 truncate text-slate-500" title={stage}>{stage}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded bg-[#1f33c8]" style={{ width: `${(v.count / max) * 100}%` }} />
            </div>
            <span className="w-10 text-right font-mono">{v.count}</span>
            <span className="w-20 text-right font-mono text-slate-400">{fmt(v.amount)}</span>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-400">Sin oportunidades activas.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `DealsTable.tsx` (client component, edición inline)**

Crear `src/components/comercial/tablero/DealsTable.tsx`: tabla con las 3 columnas editables que persisten vía `upsertDealOverlay` (con estado optimista + revert en error). Marca alertas con `dealAlerts`.

```tsx
"use client";

import { useState, useTransition } from "react";
import { upsertDealOverlay } from "@/lib/comercial/overlay-actions";
import { dealAlerts, type EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

const HORIZONTES = ["Esta semana", "15 días", "30 días", "60 días", "90 días", "+90 días", "A definir"];
const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);

export function DealsTable({ deals }: { deals: EnrichedDeal[] }) {
  const today = new Date();
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-sm font-semibold">Oportunidades</h3>
        <p className="text-[11px] text-slate-400">Probabilidad, horizonte y observaciones se guardan para todo el equipo.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/50">
            <tr>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">Pipeline</th>
              <th className="px-4 py-3 text-right">Importe</th>
              <th className="px-4 py-3 text-left">Prob. ★</th>
              <th className="px-4 py-3 text-left">Horizonte ★</th>
              <th className="px-4 py-3 text-left">Observaciones ★</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {deals.map((d) => <Row key={d.deal_id} d={d} today={today} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ d, today }: { d: EnrichedDeal; today: Date }) {
  const [prob, setProb] = useState(d.effective_probability);
  const [hor, setHor] = useState(d.overlay_horizonte ?? "A definir");
  const [obs, setObs] = useState(d.overlay_observaciones ?? "");
  const [pending, start] = useTransition();
  const save = (patch: Parameters<typeof upsertDealOverlay>[0]) =>
    start(async () => { await upsertDealOverlay({ dealId: d.deal_id, ...patch }); });
  const alerts = dealAlerts(d, today);

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <td className="px-4 py-3">
        <a href={d.href} target="_blank" rel="noreferrer" className="font-medium hover:underline">{d.title}</a>
        <div className="text-[11px] text-slate-400">{d.company_name ?? d.contact_name ?? ""}</div>
        {alerts.map((a) => (
          <span key={a.kind} className="mr-1 mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{a.label}</span>
        ))}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">{d.pipeline}</td>
      <td className="px-4 py-3 text-right font-mono">{fmt(d.amount)}</td>
      <td className="px-4 py-3">
        <input type="range" min={0} max={100} step={5} value={prob}
          onChange={(e) => setProb(+e.target.value)}
          onMouseUp={() => save({ probabilidad: prob })}
          onTouchEnd={() => save({ probabilidad: prob })} className="w-28" />
        <span className="ml-2 font-mono text-xs">{prob}%</span>
      </td>
      <td className="px-4 py-3">
        <select value={hor} onChange={(e) => { setHor(e.target.value); save({ horizonte: e.target.value }); }}
          className="rounded-lg border-slate-200 py-1 text-xs dark:border-slate-700 dark:bg-slate-800">
          {HORIZONTES.map((h) => <option key={h}>{h}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <input value={obs} onChange={(e) => setObs(e.target.value)} onBlur={() => save({ observaciones: obs })}
          placeholder="Notas…" disabled={pending}
          className="w-56 rounded-lg border-slate-200 py-1 text-xs dark:border-slate-700 dark:bg-slate-800" />
      </td>
    </tr>
  );
}
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: typecheck 0; build exit 0.

- [ ] **Step 6: Verificación en navegador (evidencia G5)**

`npm run dev` → abrir `http://localhost:3030/comercial/tablero`. Confirmar: KPIs no-cero, funnel con etapas, tabla con deals. Editar una probabilidad y un horizonte → recargar → el cambio persiste (vino de `crm_deal_overlay`, no de localStorage). Capturar screenshot. Verificar consola sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/comercial/tablero/ src/components/comercial/tablero/
git commit -m "feat(comercial): tablero /comercial/tablero (KPIs+funnel+tabla editable overlay)"
```

---

### Task 9: Navegación + guard RBAC

**Files:**
- Modify: el archivo de navegación del módulo Comercial (mismo donde se listan `pipeline`, `contactos`, `oportunidades` — localizar con `grep -rln "comercial/pipeline" src/app src/components`).

**Interfaces:**
- Consumes: ruta `/comercial/tablero`.

- [ ] **Step 1: Localizar el menú comercial**

Run: `grep -rln "comercial/pipeline\|/comercial/oportunidades" src/ | head`
Expected: el/los archivos de navegación (sidebar/nav del módulo).

- [ ] **Step 2: Agregar la entrada "Tablero"**

Añadir un ítem `{ href: "/comercial/tablero", label: "Tablero" }` junto a "Pipeline" siguiendo el formato exacto de los ítems vecinos en ese archivo (copiar la forma del objeto existente; no inventar props).

- [ ] **Step 3: Confirmar el guard de página**

El layout `(app)/comercial` ya aplica el guard RBAC del módulo comercial (mismo que protege `pipeline`). Verificar que `/comercial/tablero` queda detrás del mismo guard (no requiere guard nuevo: hereda del layout). Si `pipeline/page.tsx` tuviera un guard inline, replicarlo en `tablero/page.tsx`.

- [ ] **Step 4: Typecheck + verificación**

Run: `npm run typecheck`
Expected: 0. Abrir el módulo Comercial en dev y confirmar que "Tablero" aparece y navega.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(comercial): entrada de navegación al Tablero"
```

> **GATE FASE 2 (G7/G5):** `npm run typecheck` 0 · `npm run build` exit 0 · `npm run test` verde · screenshot del tablero con datos reales y persistencia de overlay verificada. Recién entonces, deploy lo ejecuta Martín (G1).

---

## Self-Review

**1. Spec coverage (vs. requerimientos del prompt original):**
- Auditoría del HTML → entregada antes de este plan (informe en chat). ✓
- Integración con Clientify → Tasks 2–3 (reusa cliente existente, persiste a Supabase). ✓
- Sync diaria 21:00 → Tasks 3–4 (endpoint + cron `0 0 * * *`). ✓
- Optimización de métricas → Tasks 2 y 5 (forecast/pipeline activo correctos; excluye Expired/Lost). ✓
- Mejoras del artefacto (overlay compartido, alertas, tendencias) → Tasks 1(B/C), 5, 8. ✓
- Auditoría técnica / arquitectura (RLS, RPC, capas) → Task 1 + cumplimiento G-rules. ✓

**2. Placeholder scan:** sin "TBD"/"implementar luego". Cada step de código trae el código real. UI con markup concreto (no pseudo).

**3. Type consistency:** `buildSnapshotRows`/`buildCacheRows` (Task 2) consumidos por `persistDealsSync` (Task 2) y la route (Task 3). `EnrichedDeal`/`computeKpis`/`dealAlerts` (Task 5) consumidos por `dashboard-data` (Task 6), `KpiCards`/`FunnelChart`/`DealsTable` (Task 8). `upsertDealOverlay` firma idéntica en Task 7 y su uso en Task 8. Vista `v_clientify_deals_enriched` (Task 1) ↔ `select` de columnas en Task 6 ↔ campos de `EnrichedDeal` (Task 5): alineados.

**Riesgos / supuestos a confirmar en ejecución:**
- `createClient`/`createAdminClient` exportados desde `@/lib/supabase/server` (confirmado: `createAdminClient` en línea 45; `createClient` usado en `rrhh/actions.ts`).
- El guard RBAC del layout `(app)/comercial` cubre rutas nuevas (Task 9 lo verifica; si no, replicar inline).
- `npm run build` con `output: export`? Si el deploy fuera estático, las rutas `force-dynamic` + server actions requieren runtime Netlify (ya en uso por `/comercial/pipeline` y `/api/*`). Confirmar en Task 8 build.
```

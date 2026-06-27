# Plan: Tablero Comercial — Redesign Ejecutivo 2026-06-25

## Context
Branch: feat/tablero-redesign-2026 | Base commit: 165530d (main@HEAD)
Project: ~/CODE/tops-ordenes (Next.js 14, App Router, Supabase, Tailwind CSS custom)
Prod: arsksytgdnzukbmfgkju | No apply migrations without G3 gate.

## Goals
Transform the existing commercial dashboard from an informational display into an executive
command center for a 3PL B2B logistics company. Priorities:
1. Decision-first: every metric must enable an action
2. Score 0-100 + traffic-light semáforo (green/yellow/red) on every deal
3. URL state persistence for all filters (deep links, shareable views)
4. Forecast by period (30/60/90d)
5. Funnel with stage conversion rates
6. Source performance analysis
7. Stagnant opportunities dedicated block
8. Data quality block
9. Deal detail side panel (drill-down)
10. Vista Dirección (executive summary view)

## Architecture Constraints
- Keep Server Component for page.tsx (data fetching stays server-side)
- Client Components for all interactive parts (filters, panels, scroll)
- URL state via Next.js searchParams (server) + useSearchParams/useRouter (client)
- No external chart libraries — continue with custom SVG
- No UI library additions — use existing custom Tailwind classes
- All computations in TypeScript, no magic numbers without constants
- `deal_source` field: create DB migration 0089 (cannot self-apply; generate file only)
- Treat missing `deal_source` gracefully — `null` becomes "Sin fuente"
- Never invent data — show "N/D" when data is missing

## Global Constraints (binding for all tasks)
- TypeScript strict mode, zero type errors
- All new pure functions must have companion test in same or adjacent .test.ts file
- `pnpm run build` and `pnpm run typecheck` must pass (exit 0)
- `pnpm run test` (vitest) must pass
- No breaking changes to existing API routes or sync functions
- Maintain RLS: overlay editable by operaciones/supervisor/admin only
- No data invented — if a field is null, display "—" or "N/D"
- Design system: use existing custom CSS classes (.card, .card-pad, .badge-*, .kpi, etc.)
- Dark mode: all components must work in dark mode (var(--fg-primary), etc.)
- Animations: use existing nx-* classes for consistency

## Data Model Notes
### EnrichedDeal (existing, from v_clientify_deals_enriched)
- deal_id, title, company_name, contact_name, amount, currency
- pipeline, pipeline_id, stage, status ("open"|"expired"|"won"|"lost"|"other")
- owner_name, expected_close (ISO date string), modified_src (ISO timestamp)
- href (Clientify deeplink), effective_probability (0-100, read-only)
- overlay_horizonte, overlay_observaciones

### Fields being ADDED (Task 1 migration + mapper update)
- deal_source: string | null — from Clientify deal_source field

### Fields NOT available (document as missing data)
- m² potenciales — not in Clientify; show "N/D" with suggestion
- tipo_servicio — not in Clientify; derive from pipeline name as proxy
- motivo_perdida — not in Clientify custom fields (unknown)
- duracion_contrato — not available
- rentabilidad_m2 — not available

---

## Task 1: Data Layer — Score 0-100, Semáforo, deal_source, Forecast Periods, Funnel, Quality

### Scope
Files to create/modify:
- `supabase/migrations/0089_add_deal_source.sql` (NEW — migration, NOT self-applied)
- `src/lib/clientify/mappers.ts` (ADD deal_source to UiDeal mapping)
- `src/lib/clientify/types.ts` (VERIFY deal_source exists in ClientifyDeal)
- `src/lib/clientify/data.ts` (ADD deal_source to DB insert payload)
- `src/lib/comercial/dashboard-kpis.ts` (ADD deal_source to EnrichedDeal, ADD new KPI fields)
- `src/lib/comercial/commercial-score.ts` (ADD normalizeScore(raw) → 0-100, ADD getSemaforoColor)
- `src/lib/comercial/dashboard-insights.ts` (ADD groupBySource, getFunnelData, getStagnantDeals, getDataQuality, getForecastByPeriod)
- `src/lib/comercial/dashboard-data.ts` (ADD new computed fields to TableroData return)
- `src/lib/comercial/commercial-score.test.ts` (ADD tests for normalizeScore, getSemaforoColor)
- `src/lib/comercial/dashboard-kpis.test.ts` (ADD tests for new KPI fields)

### Spec

#### 1.1 DB Migration 0089
```sql
-- Add deal_source column to clientify_deals_cache
ALTER TABLE clientify_deals_cache ADD COLUMN IF NOT EXISTS deal_source text;

-- Update materialized view (if it's a real view, update the SELECT)
-- v_clientify_deals_enriched already uses SELECT c.* so no change needed
```
File: `supabase/migrations/0089_add_deal_source.sql`

#### 1.2 Mapper (mappers.ts)
`UiDeal` interface must add `deal_source: string | null`
`mapDeal()` must map `raw.deal_source ?? null` to `deal_source`
The insert object in `data.ts` must include `deal_source`

#### 1.3 EnrichedDeal type extension (dashboard-kpis.ts)
Add to `EnrichedDeal`:
```typescript
deal_source: string | null;
// computed virtual fields for rendering convenience:
stale_days?: number;          // precomputed days without activity
is_overdue?: boolean;         // precomputed overdue flag
```

Add to `Kpis`:
```typescript
stagnantCount: number;        // live + stale_days >= 14 (less strict than noActionCount)
lostCount: number;            // count of lost deals
lostAmount: number;           // Σ amount of lost deals
wonCount: number;             // count of won deals (add alongside wonAmount)
forecastByPeriod: ForecastPeriod[]; // 30/60/90d buckets
sourceBreakdown: SourceStats[];     // per deal_source stats
funnelData: FunnelStage[];          // ordered stages with conversion
dataQuality: DataQualityReport;     // field completeness
```

New interfaces:
```typescript
export interface ForecastPeriod {
  label: "30d" | "60d" | "90d";
  days: number;
  count: number;
  hotCount: number;             // count with effective_probability >= 60
  totalAmount: number;
  weightedAmount: number;       // Σ amount * prob/100
  avgProbability: number;
}

export interface SourceStats {
  source: string;               // "Sin fuente" if null
  count: number;
  totalAmount: number;
  weightedAmount: number;
  wonCount: number;
  lostCount: number;
  avgProbability: number;
  ticketAvg: number;
}

export interface FunnelStage {
  stage: string;
  count: number;
  totalAmount: number;
  weightedAmount: number;
  conversionRate: number | null; // % that advance to next stage (null if last)
  dropRate: number | null;       // % that are lost or stagnant here (null if no data)
  avgDaysInStage: number | null; // null when no expected_close data
}

export interface DataQualityReport {
  total: number;
  completeness: DataQualityField[];
  incomplete: { deal_id: number; title: string; missing: string[] }[];
}

export interface DataQualityField {
  field: string;
  label: string;
  filled: number;
  pct: number;
}
```

#### 1.4 Score Normalization (commercial-score.ts)
The raw score is `amount × prob/100 × factors`. To normalize to 0-100:
- Collect all live deal scores
- Map percentile rank to 0-100
- OR use a log-scale normalization relative to max score

Use PERCENTILE approach (avoids dependency on dataset max):
```typescript
/**
 * Normalizes raw commercial scores to 0-100 using percentile rank.
 * Must be called on the full live deals array, not per-deal.
 * @param rawScores - array of raw scores for ALL live deals
 * @param rawScore - the specific deal's raw score
 * @returns 0-100 integer
 */
export function normalizeScore(rawScores: number[], rawScore: number): number
```

#### 1.5 Semáforo (commercial-score.ts)
```typescript
export type SemaforoColor = "green" | "yellow" | "red";

/**
 * Traffic light based on normalized score (0-100).
 * green:  score >= 65 (hot opportunity, attack now)
 * yellow: score >= 35 (warm, active follow-up)
 * red:    score < 35  (cold, at risk, stagnant)
 */
export function getSemaforoColor(normalizedScore: number): SemaforoColor

/**
 * Returns semáforo based on qualitative deal state (for deals without score,
 * e.g. won/lost/expired). Also usable as override when specific conditions apply.
 */
export function getSemaforoLabel(color: SemaforoColor): string
// "Prioritaria" | "En seguimiento" | "En riesgo"
```

#### 1.6 Forecast by Period (dashboard-insights.ts)
```typescript
export function getForecastByPeriod(deals: EnrichedDeal[], today: Date): ForecastPeriod[]
```
- Compute 30d, 60d, 90d buckets
- For each: filter live deals where expected_close is within [today, today+days]
- If no expected_close, exclude from period forecasts (add to "sin fecha" category but don't show in period)

#### 1.7 Funnel Data (dashboard-insights.ts)
```typescript
export function getFunnelData(deals: EnrichedDeal[]): FunnelStage[]
```
- Group live deals by stage
- Order stages by avg probability (Clientify stage_id if available, else by probability)
- Compute conversion rate between consecutive stages as count[i+1]/count[i]
- Avg probability used as proxy for stage ordering when no stage_id ordering is available

#### 1.8 Source Grouping (dashboard-insights.ts)
```typescript
export function groupBySource(deals: EnrichedDeal[]): SourceStats[]
```
- Map null sources to "Sin fuente"
- Include won/lost counts from all deals (not just live)
- Sort by totalAmount desc

#### 1.9 Data Quality (dashboard-insights.ts)
```typescript
export function getDataQuality(deals: EnrichedDeal[]): DataQualityReport
```
- Check these fields on live deals: amount (>1), effective_probability (>0), expected_close, owner_name, deal_source, overlay_horizonte
- For each: compute filled count and pct
- List top 20 most incomplete deals

#### 1.10 Stagnant Count (dashboard-kpis.ts)
```typescript
stagnantCount: live.filter(d => stalenessDays(d, today) >= 14).length
```

#### 1.11 dashboard-data.ts updates
Add to `TableroData` return:
```typescript
forecastPeriods: ForecastPeriod[];
funnelStages: FunnelStage[];
sourceStats: SourceStats[];
dataQuality: DataQualityReport;
```
Compute all using the new functions from dashboard-insights.ts.

#### 1.12 Tests
Add to `commercial-score.test.ts`:
- normalizeScore: [0, 50, 100] range test, handles empty array, handles all-same scores
- getSemaforoColor: boundary tests (34, 35, 64, 65)

Add to `dashboard-kpis.test.ts`:
- stagnantCount present in output
- lostCount and wonCount present
- forecastByPeriod structure valid

---

## Task 2: URL State & Deep Links

### Scope
Files to create/modify:
- `src/hooks/useTableroFilters.ts` (NEW — URL state hook)
- `src/components/comercial/tablero/TableroShell.tsx` (NEW — client wrapper with URL context)
- `src/app/(app)/comercial/tablero/page.tsx` (MODIFY — read searchParams, pass to shell)
- `src/components/comercial/tablero/ActiveFilterChips.tsx` (NEW — shows active filter chips)

### Spec

#### 2.1 URL Filter Schema
Supported query params:
```
?pipeline=ANMAT              → filter by pipeline name
?stage=Propuesta             → filter by stage
?source=Google+Ads           → filter by deal_source
?score=hot|warm|cold         → filter by semáforo tier (hot=green, warm=yellow, cold=red)
?status=active|expired|won|lost|all  → status filter (default: active)
?no_action=1                 → only no-action deals (stale >= 21d)
?stagnant=1                  → only stagnant deals (stale >= 14d)
?overdue=1                   → only overdue deals
?closing_30=1                → only closing in 30d
?sort=score|amount|forecast|probability|modified  → sort key (default: score)
```

#### 2.2 useTableroFilters hook
```typescript
// src/hooks/useTableroFilters.ts
export interface TableroFilters {
  pipeline: string;
  stage: string;
  source: string;
  score: "hot" | "warm" | "cold" | "all";
  status: "active" | "expired" | "won" | "lost" | "all";
  no_action: boolean;
  stagnant: boolean;
  overdue: boolean;
  closing_30: boolean;
  sort: SortKey;
}

export function useTableroFilters(): {
  filters: TableroFilters;
  setFilter: <K extends keyof TableroFilters>(key: K, value: TableroFilters[K]) => void;
  clearAll: () => void;
  applyFilter: (partial: Partial<TableroFilters>) => void;  // for deep-link clicks
  activeCount: number;
}
```
- Uses `useSearchParams` to read and `useRouter.replace` to write (shallow, no scroll)
- `applyFilter` replaces only the specified keys, preserving others
- All params are strings in URL, hook parses them to typed values

#### 2.3 TableroShell (NEW)
```tsx
// src/components/comercial/tablero/TableroShell.tsx
"use client"
// Receives pre-computed data from server page
// Owns filter context (useTableroFilters)
// Passes filters down to OpportunitiesTable
// Exposes setFilter via a scrollTo+filter function for metric cards
```

#### 2.4 Scroll-to behavior
When a metric card or alert is clicked:
1. Call `applyFilter()` to set the relevant filter
2. Call `document.getElementById('opportunities-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })`
3. The table automatically re-renders with the new filter (URL-driven)

The OpportunitiesTable root element must have `id="opportunities-table"`.
Similar for other sections: `id="forecast-block"`, `id="funnel-block"`, `id="stagnant-block"`, etc.

#### 2.5 ActiveFilterChips component
```tsx
// Shows chips for each active filter with an X to clear
// Chip examples: "Pipeline: ANMAT ×", "Score: Caliente ×", "Sin acción ×"
// "Limpiar filtros" button when any filter is active
```

#### 2.6 Page.tsx update
```tsx
// page.tsx reads searchParams for initial render (SSR-compatible)
// Passes to TableroShell which then uses useSearchParams for CSR updates
export default async function TableroPage({ searchParams }) {
  const data = await getTableroData();
  return <TableroShell data={data} initialParams={searchParams} />
}
```

---

## Task 3: Executive Summary & Forecast Blocks Redesign

### Scope
Files to modify/create:
- `src/components/comercial/tablero/ExecutiveSummary.tsx` (REWRITE)
- `src/components/comercial/tablero/ForecastBlocks.tsx` (NEW)
- `src/components/comercial/tablero/CommercialAlerts.tsx` (ENHANCE with deep links)

### Spec

#### 3.1 ExecutiveSummary redesign
12 KPI cards in a responsive grid (3 cols desktop, 2 tablet, 1 mobile):

Row 1 — Pipeline Health:
1. Pipeline activo (Σ amount vivas) — subtitle: "valor bruto"
2. Forecast ponderado (Σ amount×prob/100) — subtitle: "valor esperado"
3. Pipeline concreción % (forecast/pipeline) — subtitle: "prob. de cierre ponderada"

Row 2 — Opportunities:
4. Oportunidades vivas — clickable → filter: status=active
5. Oportunidades calientes (score ≥ 65) — clickable → filter: score=hot
6. Ganado este mes (wonAmount) — green color

Row 3 — Alerts:
7. Sin próxima acción (noActionCount) — clickable → filter: no_action=1 — red if > 0
8. Seguimiento vencido (overdueCount) — clickable → filter: overdue=1 — red if > 0
9. Oportunidades estancadas (stagnantCount) — clickable → filter: stagnant=1 — yellow if > 0

Row 4 — Quality:
10. Ticket promedio (activePipeline/liveCount) — subtitle: "promedio vivas"
11. Probabilidad promedio (avgProbability%) — subtitle: "media simple"
12. Datos incompletos — clickable → scroll to DataQuality block

Each card:
- On hover: show subtle lift (nx-lift class)
- Clickable cards: cursor-pointer + hover state
- On click: call applyFilter + scrollIntoView
- Show delta vs yesterday (from kpis.deltas) with up/down arrows when available
- tooltip on hover explaining the metric

#### 3.2 ForecastBlocks (NEW)
3 horizontal cards in a row: 30d / 60d / 90d

Each card shows:
- Period label ("Próximos 30 días")
- Valor bruto (totalAmount formatted)
- Valor ponderado (weightedAmount formatted) — larger, prominent
- Cantidad de oportunidades (count)
- Calientes (hotCount) — with green badge
- Probabilidad promedio (avgProbability%)

On click: applyFilter({ closing_30: true }) for 30d card (for now; 60/90 not yet separate filters)

Title row: "Forecast comercial" with subtitle "Oportunidades con fecha estimada de cierre"

If period has 0 deals: show empty state "Sin oportunidades en este período"

#### 3.3 CommercialAlerts deep links
Each alert item on click → call applyFilter(relevant filter) + scrollIntoView
Example: "N oportunidades sin próxima acción" → applyFilter({ no_action: true })
Add chevron-right icon to each clickable alert
Section title: add "Ver todas →" link that clears filters and scrolls to table

---

## Task 4: Top 10 Opportunities & Funnel Analysis

### Scope
Files to modify/create:
- `src/components/comercial/tablero/TopOpportunities.tsx` (REWRITE)
- `src/components/comercial/tablero/FunnelAnalysis.tsx` (NEW)
- `src/lib/comercial/dashboard-insights.ts` (already updated in Task 1, may need tweaks)

### Spec

#### 4.1 TopOpportunities rewrite
Show top 10 (not 6) live deals ordered by normalized score.

Display format: Card with title "Top oportunidades para atacar ahora"

Each row (table-like within the card):
- Semáforo dot (green/yellow/red) — with tooltip: reason
- Score badge (0-100) — colored by semáforo tier
- Company name + opportunity title
- Amount bruto (formatted)
- Valor esperado (amount × prob/100, formatted)
- Probability % — colored by level
- Stage
- Días sin actividad (stale_days) — red if >= 21
- Horizonte (overlay_horizonte or "—")
- Owner name (or "—")
- Source (deal_source or "—")
- Action button → opens DealDetailPanel OR links to Clientify href

Semáforo tooltip reasons:
- green: "Probabilidad alta + actividad reciente"
- yellow: "Seguimiento en curso — revisar"
- red: "Sin actividad / en riesgo"

Score tooltip: breakdown of why this score
"Base: $X × 50% = $Y | Horizonte: ×1.15 | Etapa: ×1.25 | Actividad: ×1.0"

Mobile: collapse to simpler view (semáforo, company, amount, score)

Section is NOT clickable to filter — it's a standalone ranking.

#### 4.2 FunnelAnalysis (NEW)
Section title: "Embudo comercial"

Display:
- Horizontal funnel bars, one per stage, ordered by progression
- Each bar shows: stage name, count, total amount, weighted amount, conversion rate to next
- Widths proportional to count (not amount)

Auto-insights block below the funnel:
- "La mayor concentración de oportunidades está en [stage con más deals]"
- "La mayor caída ocurre entre [stageX] y [stageY] ([N%] de abandono)"
- "Hay [N] oportunidades estancadas en [stage]"
- "El tiempo promedio en negociación es de [X] días" (if expected_close data allows estimate)

On click on a stage bar → applyFilter({ stage: stageName }) + scroll to table

---

## Task 5: Source Performance, Stagnant, Data Quality

### Scope
Files to create:
- `src/components/comercial/tablero/SourcePerformance.tsx` (NEW)
- `src/components/comercial/tablero/StagnantOpportunities.tsx` (NEW)
- `src/components/comercial/tablero/DataQuality.tsx` (NEW)

### Spec

#### 5.1 SourcePerformance
Section title: "Rendimiento por canal / fuente"
Subtitle: "No solo cuántos leads, sino cuáles son los mejores"

Table/card layout showing per source:
| Fuente | Oportunidades | Valor bruto | Valor esperado | Ticket prom. | Prob. prom. | Ganadas | Perdidas |
|--------|--------------|------------|---------------|--------------|-------------|---------|---------|

If deal_source is NULL for most deals: show a banner "La fuente de origen no está completa en Clientify. [N]% de oportunidades sin fuente. Completar el campo 'Fuente' en cada deal para activar este análisis."

Click on source row → applyFilter({ source: sourceName })

If no source data: show informative empty state instead of hiding the section.

#### 5.2 StagnantOpportunities
Section title: "Oportunidades estancadas"
id="stagnant-block" (for scroll-to)

Segmentation: tabs or toggle for 14d / 21d / 30d / 60d threshold
(default: 21d to match existing noActionCount logic)

Table columns:
| Semáforo | Empresa | Oportunidad | Valor | Prob% | Etapa | Días sin actividad | Última actividad | Responsable | Acción sugerida |

Sorted by: days_without_activity desc

If empty: "No hay oportunidades estancadas. El equipo está al día."

Each row: Clientify deeplink button

#### 5.3 DataQuality
Section title: "Calidad de datos CRM"
id="data-quality-block" (for scroll-to)

Progress bars for each field completeness:
- Importe > $1: X%
- Probabilidad > 0%: X%
- Fecha estimada de cierre: X%
- Responsable asignado: X%
- Fuente de origen: X%
- Horizonte definido: X%

Below: table of top incomplete deals with missing fields listed

Banner: "Si los datos no están completos, el dashboard puede mentir con elegancia. Completa los campos marcados en Clientify."

Click on incomplete deal → Clientify deeplink

---

## Task 6: Opportunities Table Redesign + Deal Detail Panel

### Scope
Files to modify/create:
- `src/components/comercial/tablero/OpportunitiesTable.tsx` (REWRITE)
- `src/components/comercial/tablero/DealDetailPanel.tsx` (NEW)

### Spec

#### 6.1 OpportunitiesTable rewrite
Root element: `<section id="opportunities-table" ...>`

Add columns:
| # | Semáforo | Score | Empresa | Oportunidad | Pipeline | Etapa | Valor bruto | Valor esp. | Prob% | Horizonte | Días sin act. | Prox. acción | Resp. | Fuente | Estado |

New filters (added to existing):
- Source dropdown (from unique deal_source values + "Sin fuente")
- Score tier: Caliente / En seguimiento / En riesgo (maps to hot/warm/cold)
- Solo vencidas: boolean toggle
- Solo estancadas: boolean toggle (>= 14d stagnant)
- Sort by: score, amount, forecast, probability, modified, days_stagnant

URL integration:
- Reads initial filter state from `useTableroFilters()` hook
- Updates URL on every filter change (useRouter.replace, shallow)
- Shows ActiveFilterChips above table
- Maintains state when navigating back/forward

Column rendering:
- Semáforo: colored dot with tooltip (reason for color)
- Score: badge with color tier (green/yellow/red background)
- Valor esp.: amount × prob formatted
- Días sin act.: colored (green<7, yellow 7-14, red>=21)
- Prox. acción: from getSuggestedAction() — displayed as text chip
- Estado: badge (open/won/lost/expired styled)
- Row click → open DealDetailPanel (lateral)
- External link icon → Clientify href

#### 6.2 DealDetailPanel (NEW)
```tsx
// Slide-in panel from the right (fixed overlay)
// Triggered by clicking a deal row
// Shows all available fields including overlay editing
```

Panel layout:
- Header: company name + opportunity title + semáforo dot
- Score badge (prominent)
- Grid of read-only fields: Amount, Probability, Pipeline, Stage, Status, Source, Owner, Expected Close, Last Activity, Created
- Computed fields: Valor esperado, Días sin actividad, Alerta
- Overlay section (editable): Horizonte selector, Observaciones textarea, Save button
- Acciones sugeridas: action text from getSuggestedAction()
- "Abrir en Clientify" button (external link → deal.href)
- "Cerrar" button or click outside to close

Animations:
- Slide from right (translateX(100%) → translateX(0)) on open
- Reverse on close
- Backdrop overlay (semi-transparent)

Keyboard: ESC to close, focus trap

---

## Task 7: Vista Dirección + Loss Analysis + Page Layout

### Scope
Files to create/modify:
- `src/components/comercial/tablero/VistaDireccion.tsx` (NEW)
- `src/components/comercial/tablero/LossAnalysis.tsx` (NEW)
- `src/app/(app)/comercial/tablero/page.tsx` (LAYOUT REORGANIZATION)

### Spec

#### 7.1 VistaDireccion (NEW)
Section title: "Vista Dirección"
Subtitle: "Todo lo que necesita saber en una pantalla"
id="vista-direccion"

3-column executive grid on desktop:

Column 1 — "¿Cuánto se puede cerrar?"
- Forecast ponderado del mes (next 30d weighted amount)
- Top 3 oportunidades por valor esperado (name + amount + prob)
- "Ver todas las calientes →" → applyFilter({ score: 'hot' })

Column 2 — "¿Dónde está el riesgo?"
- Count de oportunidades sin próxima acción (red badge) + link
- Count de vencidas sin respuesta (red badge) + link
- Top 3 oportunidades atascadas (most days without activity)
- "¿Qué decisiones tomar esta semana?" → list of top 3 AccionesSemana

Column 3 — "Calidad del pipeline"
- Weighted concretion % (gauge-style display)
- Pipeline con mayor concentración (bar or text)
- Fuente con mejor conversión (if source data available)
- Data quality score (% completeness as a number)

"Acciones recomendadas de esta semana" block:
- Top 5 actions from existing ActionPlan component data
- Each action: severity icon + text + deal name + "Ir a la oportunidad →" deeplink

#### 7.2 LossAnalysis (NEW — only show if won/lost data available)
Section title: "Análisis de pérdidas"
Show only if lostCount > 0.

Display:
- Total perdido (count + amount)
- Ganado vs perdido (simple bar comparison)
- Motivos de pérdida: "Los motivos de pérdida no están disponibles en Clientify. Para activar este análisis, agrega un campo personalizado 'Motivo de pérdida' en los deals perdidos."
- Top stages where deals go lost (stage distribution of lost deals)
- Comparison: lost deals by pipeline

#### 7.3 Page Layout Reorganization
New section order:
```
1. Header (title, last sync)
2. Vista Dirección                    ← NEW — executive summary at the top
3. Executive Summary KPI cards        ← moved/kept
4. Forecast Blocks (30/60/90d)        ← NEW
5. Commercial Alerts                  ← moved up
6. Top 10 Opportunities               ← expanded to 10
7. Funnel Analysis                    ← NEW
8. Priority Matrix (2x2)              ← kept
9. Distributions (Pipeline + Stages)  ← kept
10. Concretion Bands + Forecast Trend ← kept
11. Source Performance                ← NEW
12. Stagnant Opportunities            ← NEW
13. Loss Analysis                     ← NEW (conditional)
14. Data Quality                      ← NEW
15. Auto Insights + Action Plan       ← moved to end
16. Opportunities Table               ← always last
17. Sync Status                       ← footer
```

ActiveFilterChips appears above the table (section 16).

---

## Task 8: Polish — Hover States, Tooltips, Animations

### Scope
Files to modify:
- `src/components/comercial/tablero/TopOpportunities.tsx` (tooltips)
- `src/components/comercial/tablero/FunnelAnalysis.tsx` (hover + tooltip)
- `src/components/comercial/tablero/ExecutiveSummary.tsx` (tooltips)
- `src/components/comercial/tablero/ForecastBlocks.tsx` (hover)
- `src/components/comercial/tablero/CommercialAlerts.tsx` (hover)
- Multiple: add `title` attributes + custom Tooltip components

### Spec

#### 8.1 Tooltip component (if not existing)
Check for existing Tooltip in codebase. If none, create a minimal:
```tsx
// src/components/ui/Tooltip.tsx
// Uses CSS :hover + absolute positioned div
// No external deps
// Supports: position top/bottom, maxWidth 220px
```

#### 8.2 Hover states to add
- KPI cards: nx-lift + border color change
- Score badges: show breakdown tooltip
- Semáforo dots: show reason tooltip  
- Funnel stage bars: show count + conversion rate tooltip
- Alert items: show "click para filtrar" hint
- Action plan items: highlight row
- Source performance rows: show "click para filtrar" hint

#### 8.3 Loading state
Add loading skeleton to `loading.tsx` that mirrors the new layout structure.

---

## Task sequencing and dependencies
1. Task 1 (Data Layer) → ALL other tasks depend on new types and functions
2. Task 2 (URL State) → Tasks 3-7 use the filter hook
3. Tasks 3, 4, 5 can run AFTER Task 2 (partially independent)
4. Task 6 (Table) depends on Task 2 (URL state hook)
5. Task 7 (Page Layout) depends on ALL new components existing
6. Task 8 (Polish) runs last

## Test Coverage Requirements
- Task 1: normalizeScore, getSemaforoColor, getForecastByPeriod, getDataQuality, getFunnelData must have unit tests
- Task 2: useTableroFilters should have basic parse/serialize tests (if vitest supports hook testing)
- Tasks 3-8: UI components — no new test requirement, existing 110 tests must still pass

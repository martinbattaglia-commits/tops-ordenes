// Read model (capa liviana, HEX-4/HEX-5) · Calificaciones + scores F2.
// Lectura bajo sesión de usuario (RLS por has_permission('prospeccion.view')).
// JOIN entre prospeccion_prospects, prospeccion_scores_current y prospeccion_enrichment.
// Degrada con fallback a valores vacíos/cero si Supabase no está disponible o la tabla aún no existe.
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface QualificationSummary {
  totalImported: number;
  totalScoreado: number;
  totalAprobado: number;
  totalRechazado: number;
  totalDuplicado: number;
  avgScore: number;
  decisionCounts: { import: number; review: number; discard: number };
  byIndustry: Array<{ industry: string | null; count: number }>;
  byCargo: Array<{ cargo: string | null; count: number }>;
  byDecision: Array<{ decision: string; count: number }>;
}

export interface ProspectWithScore {
  id: string;
  shortId: string | null;
  status: string;
  companyName: string | null;
  fullName: string | null;
  cargo: string | null;
  email: string | null;
  cuit: string | null;
  website: string | null;
  linkedinUrl: string | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  // Desde prospeccion_scores_current
  score: number | null;
  confidence: number | null;
  priorityTier: string | null;
  decision: string | null;
  explanation: string | null;
  // Desde prospeccion_enrichment
  industryNormalized: string | null;
  employeeBand: string | null;
  isArgentina: boolean | null;
  dentroMercadoObjetivo: boolean | null;
}

// ---------------------------------------------------------------------------
// Constantes de fallback
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY: QualificationSummary = {
  totalImported: 0,
  totalScoreado: 0,
  totalAprobado: 0,
  totalRechazado: 0,
  totalDuplicado: 0,
  avgScore: 0,
  decisionCounts: { import: 0, review: 0, discard: 0 },
  byIndustry: [],
  byCargo: [],
  byDecision: [],
};

// ---------------------------------------------------------------------------
// Tipos de fila crudos de Supabase
// ---------------------------------------------------------------------------

interface ScoreJoin {
  score: number | null;
  confidence: number | null;
  priority_tier: string | null;
  decision: string | null;
  explanation: string | null;
}

interface EnrichmentJoin {
  industry_normalized: string | null;
  employee_band: string | null;
  is_argentina: boolean | null;
  dentro_mercado_objetivo: boolean | null;
}

interface ProspectRow {
  id: string;
  short_id: string | null;
  status: string;
  company_name: string | null;
  full_name: string | null;
  cargo: string | null;
  email: string | null;
  cuit: string | null;
  website: string | null;
  linkedin_url: string | null;
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  prospeccion_scores_current: ScoreJoin | ScoreJoin[] | null;
  prospeccion_enrichment: EnrichmentJoin | EnrichmentJoin[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Supabase devuelve el join como objeto único o array; normaliza a objeto o null. */
function pickFirst<T>(v: T | T[] | null): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function mapRow(r: ProspectRow): ProspectWithScore {
  const score = pickFirst(r.prospeccion_scores_current);
  const enrichment = pickFirst(r.prospeccion_enrichment);
  return {
    id: r.id,
    shortId: r.short_id,
    status: r.status,
    companyName: r.company_name,
    fullName: r.full_name,
    cargo: r.cargo,
    email: r.email,
    cuit: r.cuit,
    website: r.website,
    linkedinUrl: r.linkedin_url,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    rejectedAt: r.rejected_at,
    rejectionReason: r.rejection_reason,
    score: score?.score ?? null,
    confidence: score?.confidence ?? null,
    priorityTier: score?.priority_tier ?? null,
    decision: score?.decision ?? null,
    explanation: score?.explanation ?? null,
    industryNormalized: enrichment?.industry_normalized ?? null,
    employeeBand: enrichment?.employee_band ?? null,
    isArgentina: enrichment?.is_argentina ?? null,
    dentroMercadoObjetivo: enrichment?.dentro_mercado_objetivo ?? null,
  };
}

// ---------------------------------------------------------------------------
// Funciones públicas
// ---------------------------------------------------------------------------

/**
 * Lista prospectos con scores y enrichment (LEFT JOIN).
 * Hasta 200 registros, orden por fecha descendente.
 * Fallback a lista vacía con source='local' si Supabase no está disponible.
 */
export async function listProspectsWithScores(): Promise<{
  items: ProspectWithScore[];
  source: "supabase" | "local";
}> {
  const supabase = createClient();
  if (!supabase) return { items: [], source: "local" };

  const { data, error } = await supabase
    .from("prospeccion_prospects")
    .select(
      `
      id, short_id, status, company_name, full_name, cargo, email, cuit, website, linkedin_url,
      created_at, approved_at, rejected_at, rejection_reason,
      prospeccion_scores_current!left(score, confidence, priority_tier, decision, explanation),
      prospeccion_enrichment!left(industry_normalized, employee_band, is_argentina, dentro_mercado_objetivo)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !data) return { items: [], source: "local" };

  return {
    items: (data as ProspectRow[]).map(mapRow),
    source: "supabase",
  };
}

/**
 * Agrega estadísticas de calificación desde la DB.
 * Ejecuta múltiples queries livianas en lugar de un aggregate complejo.
 * Fallback a EMPTY_SUMMARY si Supabase no está disponible o hay error.
 */
export async function getQualificationSummary(): Promise<QualificationSummary> {
  const supabase = createClient();
  if (!supabase) return EMPTY_SUMMARY;

  try {
    // -- Conteos por status (una sola query, filtra en JS) --
    const { data: statusRows, error: statusError } = await supabase
      .from("prospeccion_prospects")
      .select("status");

    if (statusError) return EMPTY_SUMMARY;

    const rows = (statusRows ?? []) as Array<{ status: string }>;

    const countBy = (s: string) => rows.filter((r) => r.status === s).length;

    // -- Promedio de score (prospeccion_scores_current) --
    const { data: scoreRows, error: scoreError } = await supabase
      .from("prospeccion_scores_current")
      .select("score, decision");

    const scores = (scoreErrors(scoreError) ? [] : (scoreRows ?? [])) as Array<{
      score: number | null;
      decision: string | null;
    }>;

    const validScores = scores.map((r) => r.score).filter((s): s is number => s !== null);
    const avgScore =
      validScores.length > 0
        ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
        : 0;

    const decisionCount = (d: string) => scores.filter((r) => r.decision === d).length;

    // -- Distribución por industria (prospeccion_enrichment) --
    const { data: enrichRows, error: enrichError } = await supabase
      .from("prospeccion_enrichment")
      .select("industry_normalized");

    const enrichList = (enrichError ? [] : (enrichRows ?? [])) as Array<{
      industry_normalized: string | null;
    }>;

    const industryMap = new Map<string | null, number>();
    for (const r of enrichList) {
      const k = r.industry_normalized ?? null;
      industryMap.set(k, (industryMap.get(k) ?? 0) + 1);
    }
    const byIndustry = Array.from(industryMap.entries())
      .map(([industry, count]) => ({ industry, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // -- Distribución por cargo (prospeccion_prospects) --
    const cargoMap = new Map<string | null, number>();
    const { data: cargoRows, error: cargoError } = await supabase
      .from("prospeccion_prospects")
      .select("cargo");

    const cargoList = (cargoError ? [] : (cargoRows ?? [])) as Array<{
      cargo: string | null;
    }>;

    for (const r of cargoList) {
      const k = r.cargo ?? null;
      cargoMap.set(k, (cargoMap.get(k) ?? 0) + 1);
    }
    const byCargo = Array.from(cargoMap.entries())
      .map(([cargo, count]) => ({ cargo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // -- byDecision agregado desde scores --
    const decisionMap = new Map<string, number>();
    for (const r of scores) {
      const k = r.decision ?? "unknown";
      decisionMap.set(k, (decisionMap.get(k) ?? 0) + 1);
    }
    const byDecision = Array.from(decisionMap.entries())
      .map(([decision, count]) => ({ decision, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalImported: countBy("imported"),
      totalScoreado: countBy("scoreado"),
      totalAprobado: countBy("aprobado"),
      totalRechazado: countBy("rechazado"),
      totalDuplicado: countBy("duplicado"),
      avgScore,
      decisionCounts: {
        import: decisionCount("import"),
        review: decisionCount("review"),
        discard: decisionCount("discard"),
      },
      byIndustry,
      byCargo,
      byDecision,
    };
  } catch {
    return EMPTY_SUMMARY;
  }
}

/** Centinela helper — evita duplicar la comprobación de error nula. */
function scoreErrors(e: { message: string } | null): boolean {
  return e !== null;
}

/**
 * Lista solo los prospectos con status='aprobado', con sus scores y enrichment.
 * Usado por la UI de revisión antes de exportar a Clientify.
 */
export async function listApprovedProspects(): Promise<ProspectWithScore[]> {
  const supabase = createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("prospeccion_prospects")
    .select(
      `
      id, short_id, status, company_name, full_name, cargo, email, cuit, website, linkedin_url,
      created_at, approved_at, rejected_at, rejection_reason,
      prospeccion_scores_current!left(score, confidence, priority_tier, decision, explanation),
      prospeccion_enrichment!left(industry_normalized, employee_band, is_argentina, dentro_mercado_objetivo)
    `,
    )
    .eq("status", "aprobado")
    .order("approved_at", { ascending: false })
    .limit(200);

  if (error || !data) return [];

  return (data as ProspectRow[]).map(mapRow);
}

import "server-only";
import { createClient } from "@/lib/supabase/server";

// LINK-WA-002 · FASE 2 E1 — lectura de la bandeja de sugerencias.
// 🔑 Invariante del módulo AI (tools.test.ts): «retrieval = sesión del usuario».
// Se lee CON LA SESIÓN, nunca con service_role ⇒ las policies admin-only de 0210
// son la frontera real (defensa en capas junto al gate de la página).

export interface SuggestionRow {
  id: string;
  runId: string;
  conversationId: string;
  conversationTitle: string | null;
  kind: "clasificacion" | "hallazgo" | "accion";
  payload: Record<string, unknown>;
  citations: Array<{ messageId: string; quote?: string }>;
  confidence: number | null;
  status: "pendiente" | "descartada" | "aceptada";
  createdAt: string;
}

export interface RunRow {
  id: string;
  conversationTitle: string | null;
  outcome: string;
  messagesAnalyzed: number;
  suggestionsEmitted: number;
  provider: string;
  /** Modelo efectivo. Antes quedaba NULL en los errores: se perdía justo cuando
   *  más importaba saber contra qué modelo se falló. */
  model: string | null;
  /** Relato de la ventana y del motivo de corte. Se expone al operador: la promesa
   *  de «ningún recorte silencioso» se cumplía en la base pero NO para la persona
   *  que decide, que es quien la necesitaba. */
  detail: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Costo REAL. null = no verificable (el proveedor no informó usage). */
  costUsd: number | null;
  /** false = el costo NO entró en el agregado mensual: corrida no contabilizada. */
  audited: boolean;
  createdAt: string;
}

export async function listSuggestions(limit = 200): Promise<SuggestionRow[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("ai_suggestions")
    .select("id, run_id, conversation_id, kind, payload, citations, confidence, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  const rows = data as Array<Record<string, unknown>>;
  const convIds = Array.from(new Set(rows.map((r) => r.conversation_id as string)));
  const titles = new Map<string, string | null>();
  if (convIds.length > 0) {
    const { data: convs } = await supabase
      .from("connect_conversations").select("id, title").in("id", convIds);
    for (const c of ((convs ?? []) as Array<{ id: string; title: string | null }>)) {
      titles.set(c.id, c.title);
    }
  }
  return rows.map((r) => ({
    id: r.id as string,
    runId: r.run_id as string,
    conversationId: r.conversation_id as string,
    conversationTitle: titles.get(r.conversation_id as string) ?? null,
    kind: r.kind as SuggestionRow["kind"],
    payload: (r.payload ?? {}) as Record<string, unknown>,
    citations: (r.citations ?? []) as SuggestionRow["citations"],
    confidence: (r.confidence as number | null) ?? null,
    status: r.status as SuggestionRow["status"],
    createdAt: r.created_at as string,
  }));
}

export async function listRuns(limit = 20): Promise<RunRow[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("ai_analysis_runs")
    .select("id, conversation_id, outcome, messages_analyzed, suggestions_emitted, provider, model, detail, tokens_in, tokens_out, cost_usd, audited, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  const rows = data as Array<Record<string, unknown>>;
  const convIds = Array.from(new Set(rows.map((r) => r.conversation_id as string)));
  const titles = new Map<string, string | null>();
  if (convIds.length > 0) {
    const { data: convs } = await supabase
      .from("connect_conversations").select("id, title").in("id", convIds);
    for (const c of ((convs ?? []) as Array<{ id: string; title: string | null }>)) {
      titles.set(c.id, c.title);
    }
  }
  return rows.map((r) => ({
    id: r.id as string,
    conversationTitle: titles.get(r.conversation_id as string) ?? null,
    outcome: r.outcome as string,
    messagesAnalyzed: Number(r.messages_analyzed ?? 0),
    suggestionsEmitted: Number(r.suggestions_emitted ?? 0),
    provider: r.provider as string,
    model: (r.model as string | null) ?? null,
    detail: (r.detail as string | null) ?? null,
    tokensIn: r.tokens_in === null || r.tokens_in === undefined ? null : Number(r.tokens_in),
    tokensOut: r.tokens_out === null || r.tokens_out === undefined ? null : Number(r.tokens_out),
    costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
    audited: Boolean(r.audited),
    createdAt: r.created_at as string,
  }));
}

/** Hilos WhatsApp disponibles para analizar (bandeja de origen). */
export async function listWhatsappThreads(): Promise<Array<{ id: string; title: string | null; messages: number }>> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("connect_conversations")
    .select("id, title")
    .eq("kind", "whatsapp")
    .order("created_at", { ascending: true });
  const convs = (data ?? []) as Array<{ id: string; title: string | null }>;
  const out: Array<{ id: string; title: string | null; messages: number }> = [];
  for (const c of convs) {
    const { count } = await supabase
      .from("connect_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.id);
    out.push({ id: c.id, title: c.title, messages: count ?? 0 });
  }
  return out;
}

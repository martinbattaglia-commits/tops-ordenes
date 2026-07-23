// Nexus Link · RC1.4 Búsqueda Global (lectura). Llama al RPC connect_search (0153), que se apoya
// en los índices FTS/ILIKE existentes (sin motor paralelo). isMock()→seeds. Orden D-RC1.4-4 lo fija
// el RPC (sort_rank: 1 conversaciones · 2 contextos ERP · 3 mensajes · 4 adjuntos).

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { MOCK_CONVERSATIONS, MOCK_MESSAGES, MOCK_LINKS } from "../mock";

export type SearchResultType = "conversation" | "erp_context" | "message" | "attachment";

export interface SearchResult {
  resultType: SearchResultType;
  conversationId: string;
  contextId: string;
  kind: string;
  title: string;
  snippet: string | null;
  entityType: string | null;
  entityRef: string | null;
  occurredAt: string | null;
  sortRank: number;
}

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export async function searchConnect(query: string, limit = 30): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (isMock()) return mockSearch(q, limit);
  const supabase = createClient();
  if (!supabase) return mockSearch(q, limit);

  const { data, error } = await supabase.rpc("connect_search", { p_query: q, p_limit: limit });
  if (error) {
    console.error("[connect/searchConnect] rpc error:", error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    resultType: r.result_type as SearchResultType,
    conversationId: String(r.conversation_id),
    contextId: String(r.context_id),
    kind: String(r.kind),
    title: String(r.title ?? ""),
    snippet: (r.snippet as string | null) ?? null,
    entityType: (r.entity_type as string | null) ?? null,
    entityRef: (r.entity_ref as string | null) ?? null,
    occurredAt: (r.occurred_at as string | null) ?? null,
    sortRank: Number(r.sort_rank ?? 9),
  }));
}

// ── Demo (sin Supabase): busca sobre los seeds RC1.1, mismo orden que el RPC. ──
function mockSearch(q: string, limit: number): SearchResult[] {
  const needle = q.toLowerCase();
  const out: SearchResult[] = [];
  for (const c of MOCK_CONVERSATIONS) {
    const hay = `${c.title ?? ""} ${c.topic ?? ""} ${c.slug ?? ""} ${c.contextId}`.toLowerCase();
    if (!hay.includes(needle)) continue;
    const isErp = c.kind === "erp";
    const link = MOCK_LINKS[c.id]?.[0];
    out.push({
      resultType: isErp ? "erp_context" : "conversation",
      conversationId: c.id, contextId: c.contextId, kind: c.kind,
      title: c.title ?? c.slug ?? "Conversación", snippet: c.topic,
      entityType: isErp ? link?.entityType ?? null : null,
      entityRef: isErp ? link?.entityId ?? link?.entityIdText ?? null : null,
      occurredAt: c.lastMessageAt, sortRank: isErp ? 2 : 1,
    });
  }
  for (const [convId, msgs] of Object.entries(MOCK_MESSAGES)) {
    const c = MOCK_CONVERSATIONS.find((x) => x.id === convId);
    for (const m of msgs) {
      if (!(m.body ?? "").toLowerCase().includes(needle)) continue;
      out.push({
        resultType: "message", conversationId: convId, contextId: c?.contextId ?? "",
        kind: c?.kind ?? "dm", title: c?.title ?? "Mensaje", snippet: m.body,
        entityType: null, entityRef: null, occurredAt: m.createdAt, sortRank: 3,
      });
    }
  }
  return out.sort((a, b) => a.sortRank - b.sortRank || (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "")).slice(0, limit);
}

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { TimelineEntry, TimelineScope } from "./types";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

/**
 * Lee el timeline corporativo unificado. Scaffold de F0.5.0: la vista
 * v_knowledge_timeline se crea en F0.5.1 (mig 0111). Hasta entonces devuelve [].
 * En demo/preview devuelve [] (no rompe la shell). G11.
 */
export async function listTimeline(_scope: TimelineScope = {}): Promise<TimelineEntry[]> {
  if (isMock()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  // F0.5.1: query a v_knowledge_timeline filtrando por scope, keyset por seq desc.
  return [];
}

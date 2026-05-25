"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * Cliente Supabase para usar dentro de Client Components.
 * En demo mode devolvemos null y los hooks/componentes se encargan
 * de mostrar la data mock.
 */
export function createClient() {
  if (!env.supabase.configured) {
    return null;
  }
  return createBrowserClient(env.supabase.url!, env.supabase.anonKey!);
}

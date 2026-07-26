"use server";

// Nexus Link · driving adapter (server action de LECTURA): bandeja archivada (UX-002).
// Fetch diferido desde la pestaña Archivo de ConversationList. Misma frontera que toda
// lectura de Connect: sesión + connect.view; los datos salen de v_connect_inbox
// (security_invoker + membresía por auth.uid()) vía listInbox({archived: true}).

import { canAccess } from "@/lib/rbac/guard";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { InboxItem } from "../../types";
import { listInbox } from "../../read/inbox-data";

export type ArchivedInboxResult =
  | { ok: true; items: InboxItem[] }
  | { ok: false; message: string };

export async function listArchivedInboxAction(): Promise<ArchivedInboxResult> {
  const demo = env.app.demoMode || env.app.needsSupabase;
  const supabase = createClient();
  if (!demo && supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, message: "Sesión no autenticada." };
    if (!(await canAccess("connect.view"))) {
      return { ok: false, message: "Sin permiso (connect.view)." };
    }
  }
  return { ok: true, items: await listInbox({ archived: true }) };
}

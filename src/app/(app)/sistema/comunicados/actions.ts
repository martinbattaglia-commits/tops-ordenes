"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { isCurrentUserAdmin } from "@/lib/auth/roles";
import { formatZodIssues } from "@/lib/erp/validation";
import { AnnouncementInputSchema, type AnnouncementInput } from "@/lib/comunicados/validation";

interface Ok {
  ok: true;
}
interface Err {
  ok: false;
  error: string;
}
export type ComunicadoActionResult = Ok | Err;

const DENY: Err = { ok: false, error: "Solo Presidencia/Administración pueden gestionar comunicados." };

// El cockpit (force-dynamic) re-lee en cada request; revalidamos igual ambas rutas.
function revalidate() {
  revalidatePath("/sistema/comunicados");
  revalidatePath("/ejecutivo");
}

export async function createAnnouncementAction(input: AnnouncementInput): Promise<ComunicadoActionResult> {
  const parsed = AnnouncementInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: formatZodIssues(parsed.error) };
  if (env.app.demoMode || env.app.needsSupabase) return { ok: true };
  if (!(await isCurrentUserAdmin())) return DENY;
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("announcements").insert({ ...parsed.data, created_by: user?.id ?? null });
  if (error) return { ok: false, error: `No se pudo crear el comunicado: ${error.message}` };
  revalidate();
  return { ok: true };
}

export async function updateAnnouncementAction(id: string, input: AnnouncementInput): Promise<ComunicadoActionResult> {
  if (!id) return { ok: false, error: "Comunicado inválido" };
  const parsed = AnnouncementInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: formatZodIssues(parsed.error) };
  if (env.app.demoMode || env.app.needsSupabase) return { ok: true };
  if (!(await isCurrentUserAdmin())) return DENY;
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("announcements")
    .update({ ...parsed.data, updated_by: user?.id ?? null })
    .eq("id", id);
  if (error) return { ok: false, error: `No se pudo actualizar el comunicado: ${error.message}` };
  revalidate();
  return { ok: true };
}

export async function setAnnouncementActiveAction(id: string, active: boolean): Promise<ComunicadoActionResult> {
  if (!id) return { ok: false, error: "Comunicado inválido" };
  if (env.app.demoMode || env.app.needsSupabase) return { ok: true };
  if (!(await isCurrentUserAdmin())) return DENY;
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };
  const { error } = await supabase.from("announcements").update({ active }).eq("id", id);
  if (error) return { ok: false, error: `No se pudo actualizar el comunicado: ${error.message}` };
  revalidate();
  return { ok: true };
}

export async function deleteAnnouncementAction(id: string): Promise<ComunicadoActionResult> {
  if (!id) return { ok: false, error: "Comunicado inválido" };
  if (env.app.demoMode || env.app.needsSupabase) return { ok: true };
  if (!(await isCurrentUserAdmin())) return DENY;
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { ok: false, error: `No se pudo borrar el comunicado: ${error.message}` };
  revalidate();
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { isCurrentUserAdmin } from "@/lib/auth/roles";
import {
  CreateCostCenterSchema,
  formatZodIssues,
  type CreateCostCenterInput,
} from "@/lib/erp/validation";

interface ActionOk {
  ok: true;
}
interface ActionErr {
  ok: false;
  error: string;
}
export type CostCenterActionResult = ActionOk | ActionErr;

export async function createCostCenterAction(
  input: CreateCostCenterInput
): Promise<CostCenterActionResult> {
  const parsed = CreateCostCenterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: formatZodIssues(parsed.error) };
  }
  const d = parsed.data;

  if (env.app.demoMode || env.app.needsSupabase) {
    return { ok: true };
  }

  // Gate 5.5: solo admin puede crear centros de costo (F-05, enforcement server-side).
  if (!(await isCurrentUserAdmin())) {
    return { ok: false, error: "Solo los administradores pueden gestionar centros de costo." };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("cost_centers").insert({
    code: d.code.toUpperCase(),
    name: d.name,
    description: d.description || null,
    created_by: user?.id ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Ya existe un centro de costo con ese código." };
    }
    return { ok: false, error: `No se pudo crear el centro de costo: ${error.message}` };
  }

  revalidatePath("/settings/centros-costo");
  return { ok: true };
}

export async function setCostCenterActiveAction(
  id: string,
  active: boolean
): Promise<CostCenterActionResult> {
  if (!id) return { ok: false, error: "Centro de costo inválido" };

  if (env.app.demoMode || env.app.needsSupabase) {
    return { ok: true };
  }

  // Gate 5.5: solo admin puede activar/desactivar centros de costo (F-05).
  if (!(await isCurrentUserAdmin())) {
    return { ok: false, error: "Solo los administradores pueden gestionar centros de costo." };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };

  const { error } = await supabase
    .from("cost_centers")
    .update({ active })
    .eq("id", id);

  if (error) {
    return { ok: false, error: `No se pudo actualizar el centro de costo: ${error.message}` };
  }

  revalidatePath("/settings/centros-costo");
  return { ok: true };
}

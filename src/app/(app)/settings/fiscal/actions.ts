"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Verifica que el caller esté autenticado y sea admin. Devuelve userId o error. */
async function requireAdmin(): Promise<
  | { ok: true; userId: string; supabase: NonNullable<ReturnType<typeof createClient>>; ip: string | null }
  | { ok: false; error: string }
> {
  if (env.app.demoMode) {
    return { ok: false, error: "Modo demo: la configuración fiscal requiere Supabase real." };
  }
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no configurado." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado." };

  const { data: meProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (meProfile?.role !== "admin") {
    return { ok: false, error: "Solo los administradores pueden editar la configuración fiscal." };
  }

  const h = headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return { ok: true, userId: user.id, supabase, ip };
}

// ============================================================================
// Configuración fiscal (singleton id=1)
// ============================================================================

const FiscalConfigSchema = z.object({
  razon_social: z.string().min(1).max(200),
  nombre_fantasia: z.string().max(200).nullable().optional(),
  cuit: z.string().min(11).max(13),
  ingresos_brutos: z.string().max(40).nullable().optional(),
  inicio_actividades: z.string().max(10).nullable().optional(),
  domicilio_comercial: z.string().max(300).nullable().optional(),
  localidad: z.string().max(120).nullable().optional(),
  provincia: z.string().max(80).nullable().optional(),
  condicion_iva: z.enum([
    "RESPONSABLE_INSCRIPTO",
    "MONOTRIBUTO",
    "EXENTO",
    "CONSUMIDOR_FINAL",
    "NO_RESPONSABLE",
    "NO_CATEGORIZADO",
  ]),
  ambiente: z.enum(["SANDBOX", "HOMOLOGACION", "PRODUCCION"]),
  cert_alias: z.string().max(120).nullable().optional(),
  default_punto_venta: z.coerce.number().int().positive().nullable().optional(),
  pie_legal: z.string().max(2000).nullable().optional(),
});

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (out[k] === "") out[k] = null;
  }
  return out as T;
}

export async function updateFiscalConfig(input: unknown): Promise<ActionResult> {
  const parsed = FiscalConfigSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 3).map((i) => i.message).join(" · ");
    return { ok: false, error: msg || "Datos inválidos." };
  }

  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { supabase, userId, ip } = guard;

  // No permitir activar PRODUCCION sin credenciales montadas en el host.
  if (parsed.data.ambiente === "PRODUCCION" && !env.arca.configured) {
    return {
      ok: false,
      error:
        "No se puede activar PRODUCCIÓN: faltan credenciales X.509. Definí ARCA_CERT_PEM / ARCA_KEY_PEM (PEM o base64, recomendado en Netlify) o ARCA_CERT_PATH / ARCA_KEY_PATH antes de emitir con validez fiscal.",
    };
  }

  const patch = emptyToNull({
    ...parsed.data,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  const { error } = await supabase.from("fiscal_config").update(patch).eq("id", 1);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    user_id: userId,
    entity: "fiscal_config",
    entity_id: null, // fiscal_config es singleton id=1 (no es uuid)
    action: "update",
    payload: {
      id: 1,
      ambiente: parsed.data.ambiente,
      default_punto_venta: parsed.data.default_punto_venta,
    },
    ip,
  });

  revalidatePath("/settings/fiscal");
  revalidatePath("/billing");
  return { ok: true };
}

// ============================================================================
// Puntos de venta
// ============================================================================

const PuntoVentaSchema = z.object({
  numero: z.coerce.number().int().positive().max(99999),
  descripcion: z.string().min(1).max(200),
  tipo: z.enum(["WEBSERVICE", "CONTROLADOR_FISCAL", "MANUAL"]),
});

export async function addPuntoVenta(input: unknown): Promise<ActionResult> {
  const parsed = PuntoVentaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos del punto de venta inválidos." };

  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { supabase, userId, ip } = guard;

  const { data: inserted, error } = await supabase
    .from("puntos_venta")
    .insert({
      numero: parsed.data.numero,
      descripcion: parsed.data.descripcion,
      tipo: parsed.data.tipo,
      activo: true,
    })
    .select("id")
    .single();
  if (error) {
    const msg = /duplicate|unique/i.test(error.message)
      ? `Ya existe un punto de venta con el número ${parsed.data.numero}.`
      : error.message;
    return { ok: false, error: msg };
  }

  await supabase.from("audit_log").insert({
    user_id: userId,
    entity: "puntos_venta",
    entity_id: inserted?.id ?? null,
    action: "create",
    payload: { ...parsed.data },
    ip,
  });

  revalidatePath("/settings/fiscal");
  return { ok: true };
}

export async function setPuntoVentaActivo(
  id: string,
  activo: boolean
): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { supabase, userId, ip } = guard;

  const { error } = await supabase.from("puntos_venta").update({ activo }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    user_id: userId,
    entity: "puntos_venta",
    entity_id: id,
    action: activo ? "activate" : "deactivate",
    payload: { activo },
    ip,
  });

  revalidatePath("/settings/fiscal");
  return { ok: true };
}

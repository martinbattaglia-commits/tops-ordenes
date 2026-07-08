"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidCuit } from "@/lib/utils";

// Alta de proveedor — misma filosofía que "Nuevo cliente" (clients/actions.ts).
const CONCEPTO_GANANCIAS = ["honorarios", "mercaderias", "servicios", "alquileres", "excluido"] as const;

// Concepto de Ganancias como string validado (compat. con inputs de formulario;
// el CHECK en DB es el guard final).
const conceptoGananciasField = z
  .string()
  .max(20)
  .optional()
  .default("")
  .refine(
    (v) => v === "" || (CONCEPTO_GANANCIAS as readonly string[]).includes(v),
    "Concepto de Ganancias inválido"
  );

const NewVendorSchema = z.object({
  razon: z.string().trim().min(2, "Razón social muy corta").max(200),
  cuit: z.string().trim().min(11, "CUIT incompleto").max(15).refine(isValidCuit, "CUIT inválido (dígito verificador)"),
  contacto: z.string().max(120).optional().default(""),
  email: z.string().email("Email inválido").or(z.literal("")).optional().default(""),
  telefono: z.string().max(40).optional().default(""),
  domicilio: z.string().max(240).optional().default(""),
  categoria: z.string().max(120).optional().default(""),
  cond_pago: z.string().max(60).optional().default("30 días"),
  tags: z.array(z.string()).max(20).optional().default([]),
  // Datos fiscales/contables capturados desde el alta (req. Contadora 7).
  cond_iva: z.string().max(40).optional().default(""),
  concepto_ganancias: conceptoGananciasField,
  cuenta_contable: z.string().max(20).optional().default(""),
});
export type NewVendorInput = z.input<typeof NewVendorSchema>;
export type CreateVendorResult = { ok: true; id: string } | { ok: false; error: string };

const blank = (s?: string | null) => (s && s.trim() !== "" ? s.trim() : null);

/** Valida un código de cuenta contra el Plan de Cuentas (imputable + activa). */
async function assertValidAccountCode(
  admin: ReturnType<typeof createAdminClient>,
  code: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!code) return { ok: true };
  if (!admin) return { ok: true };
  const { data, error } = await admin
    .from("chart_of_accounts")
    .select("code, is_postable, is_active")
    .eq("code", code)
    .maybeSingle();
  if (error) {
    // Si el catálogo no está disponible, no bloquea el alta (se guarda el código).
    return { ok: true };
  }
  if (!data) return { ok: false, error: `La cuenta ${code} no existe en el Plan de Cuentas.` };
  if (!data.is_postable || !data.is_active) {
    return { ok: false, error: `La cuenta ${code} no es imputable.` };
  }
  return { ok: true };
}

export async function createVendor(input: NewVendorInput): Promise<CreateVendorResult> {
  const p = NewVendorSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Backend no disponible." };
  const v = p.data;

  const cuenta = blank(v.cuenta_contable);
  const cuentaCheck = await assertValidAccountCode(admin, cuenta);
  if (!cuentaCheck.ok) return cuentaCheck;

  const { data, error } = await admin
    .from("vendors")
    .insert({
      razon: v.razon,
      cuit: v.cuit,
      contacto: blank(v.contacto),
      email: blank(v.email),
      telefono: blank(v.telefono),
      domicilio: blank(v.domicilio),
      categoria: blank(v.categoria),
      cond_pago: blank(v.cond_pago) ?? "30 días",
      tags: v.tags ?? [],
      cond_iva: blank(v.cond_iva),
      concepto_ganancias: blank(v.concepto_ganancias),
      cuenta_contable: cuenta,
    })
    .select("id")
    .single();
  if (error) {
    const msg = /duplicate|unique/i.test(error.message) ? "Ya existe un proveedor con ese CUIT." : error.message;
    return { ok: false, error: msg };
  }
  revalidatePath("/compras/proveedores");
  return { ok: true, id: data.id as string };
}

/** Edita los datos fiscales/contables de un proveedor existente (desde la ficha). */
const VendorFiscalSchema = z.object({
  id: z.string().uuid(),
  cond_iva: z.string().max(40).optional().default(""),
  concepto_ganancias: conceptoGananciasField,
  cuenta_contable: z.string().max(20).optional().default(""),
});
export type VendorFiscalInput = z.input<typeof VendorFiscalSchema>;

export async function updateVendorFiscal(input: VendorFiscalInput): Promise<CreateVendorResult> {
  const p = VendorFiscalSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Backend no disponible." };
  const v = p.data;

  const cuenta = blank(v.cuenta_contable);
  const cuentaCheck = await assertValidAccountCode(admin, cuenta);
  if (!cuentaCheck.ok) return cuentaCheck;

  const { error } = await admin
    .from("vendors")
    .update({
      cond_iva: blank(v.cond_iva),
      concepto_ganancias: blank(v.concepto_ganancias),
      cuenta_contable: cuenta,
    })
    .eq("id", v.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/compras/proveedores/${v.id}`);
  revalidatePath("/compras/proveedores");
  return { ok: true, id: v.id };
}

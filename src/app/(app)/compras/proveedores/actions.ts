"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidCuit } from "@/lib/utils";

// Alta de proveedor — misma filosofía que "Nuevo cliente" (clients/actions.ts).
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
});
export type NewVendorInput = z.input<typeof NewVendorSchema>;
export type CreateVendorResult = { ok: true; id: string } | { ok: false; error: string };

const blank = (s?: string | null) => (s && s.trim() !== "" ? s.trim() : null);

export async function createVendor(input: NewVendorInput): Promise<CreateVendorResult> {
  const p = NewVendorSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Backend no disponible." };
  const v = p.data;
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

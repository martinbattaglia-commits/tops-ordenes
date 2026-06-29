"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { clientify } from "@/lib/clientify";
import {
  clientToClientifyCompanyPayload,
  listClientsHybrid,
  clientifyCompanyToClient,
} from "@/lib/data/clients";
import { isValidCuit } from "@/lib/utils";
import type { Client } from "@/lib/types";

// ============================================================================
// Schema: input del modal "Nuevo cliente"
// ============================================================================

const NewClientSchema = z.object({
  razon: z.string().min(2, "Razón social muy corta").max(200),
  cuit: z
    .string()
    .min(11, "CUIT incompleto")
    .max(15)
    .refine((v) => isValidCuit(v), "CUIT inválido (dígito verificador)"),
  contacto: z.string().max(120).optional().default(""),
  email: z
    .string()
    .email("Email inválido")
    .or(z.literal(""))
    .optional()
    .default(""),
  telefono: z.string().max(40).optional().default(""),
  tags: z.array(z.string()).max(20).optional().default([]),
  depot: z.enum(["MAGALDI", "LUJAN", ""]).optional().default(""),
  observ: z.string().max(2000).optional().default(""),
  // Categoría fiscal + imputación contable capturadas desde el alta (req. Contadora 7).
  condicion_iva: z
    .enum([
      "RESPONSABLE_INSCRIPTO",
      "MONOTRIBUTO",
      "EXENTO",
      "CONSUMIDOR_FINAL",
      "NO_RESPONSABLE",
      "NO_CATEGORIZADO",
    ])
    .optional()
    .default("RESPONSABLE_INSCRIPTO"),
  cuenta_contable: z.string().max(20).optional().default(""),
});

export type NewClientInput = z.input<typeof NewClientSchema>;

export type CreateClientResult =
  | { ok: true; client: Client; source: "clientify+supabase" | "supabase" }
  | { ok: false; error: string };

// ============================================================================
// Action: listar clientes
// ============================================================================

export async function fetchClients(search?: string): Promise<{
  ok: boolean;
  rows: Client[];
  total: number;
  source: string;
  warning?: string;
  error?: string;
}> {
  try {
    const r = await listClientsHybrid({ search });
    return { ok: true, rows: r.rows, total: r.total, source: r.source, warning: r.warning };
  } catch (e) {
    console.error("[clients/actions.fetchClients] failed", e);
    return {
      ok: false,
      rows: [],
      total: 0,
      source: "error",
      error: e instanceof Error ? e.message : "Error inesperado",
    };
  }
}

// ============================================================================
// Action: crear cliente
// ============================================================================

export async function createClient(input: NewClientInput): Promise<CreateClientResult> {
  try {
    return await createClientInner(input);
  } catch (e) {
    console.error("[clients/actions.createClient] unhandled", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado al guardar el cliente.",
    };
  }
}

async function createClientInner(input: NewClientInput): Promise<CreateClientResult> {
  // 1. Validar
  const parsed = NewClientSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 3).map((i) => i.message).join(" · ");
    return { ok: false, error: msg };
  }
  const data = parsed.data;
  const cuitDigits = data.cuit.replace(/\D/g, "");

  // 2. Anti-duplicado: chequear si ya existe ese CUIT en Supabase
  const admin = createAdminClient();
  if (admin) {
    const { data: existing } = await admin
      .from("clients")
      .select("id, razon, cuit, domicilio, telefono, contacto, email, tags, created_at")
      .eq("cuit", cuitDigits)
      .maybeSingle();
    if (existing) {
      return {
        ok: false,
        error: `Ya existe un cliente con CUIT ${cuitDigits} (${existing.razon}).`,
      };
    }
  }

  // 3. Crear en Clientify (si está configurado). NO bloquea: si falla, igual
  //    grabamos en Supabase para que el flujo operativo siga.
  let clientifyId: number | null = null;
  let clientifySynced = false;
  if (env.clientify.configured) {
    // B2B: el cliente es una EMPRESA en Clientify, no un contacto/persona.
    const payload = clientToClientifyCompanyPayload({
      razon: data.razon,
      cuit: cuitDigits,
      email: data.email,
      telefono: data.telefono,
      tags: data.tags,
    });
    const r = await clientify.createCompany(payload);
    if (r.ok) {
      clientifyId = r.data.id;
      clientifySynced = true;
    } else {
      console.error("[clients] Clientify create failed (non-blocking)", r);
    }
  }

  // 4. Persistir en Supabase (siempre, para FK con orders)
  if (!admin) {
    // Sin Supabase admin no podemos persistir. Si Clientify lo aceptó, devolvemos
    // el objeto en memoria; si no, error.
    if (!clientifySynced) {
      return {
        ok: false,
        error: "Supabase no está configurado y Clientify rechazó la creación.",
      };
    }
    const memClient: Client = {
      id: `clientify-company-${clientifyId}`,
      razon: data.razon,
      cuit: cuitDigits,
      domicilio: null,
      telefono: data.telefono || null,
      contacto: data.contacto || null,
      email: data.email || null,
      tags: data.tags,
      created_at: new Date().toISOString(),
    };
    revalidatePath("/clients");
    return { ok: true, client: memClient, source: "clientify+supabase" };
  }

  const cuenta = data.cuenta_contable?.trim() || null;
  if (cuenta) {
    const { data: acc, error: accErr } = await admin
      .from("chart_of_accounts")
      .select("code, is_postable, is_active")
      .eq("code", cuenta)
      .maybeSingle();
    // Si el catálogo está disponible: validar. Si falla la consulta, no bloquea.
    if (!accErr) {
      if (!acc) return { ok: false, error: `La cuenta ${cuenta} no existe en el Plan de Cuentas.` };
      if (!acc.is_postable || !acc.is_active) {
        return { ok: false, error: `La cuenta ${cuenta} no es imputable.` };
      }
    }
  }

  const { data: row, error } = await admin
    .from("clients")
    .insert({
      razon: data.razon,
      cuit: cuitDigits,
      domicilio: null,
      telefono: data.telefono || null,
      contacto: data.contacto || null,
      email: data.email || null,
      tags: data.tags,
      condicion_iva: data.condicion_iva,
      cuenta_contable: cuenta,
    })
    .select("id, razon, cuit, domicilio, telefono, contacto, email, tags, created_at, condicion_iva, cuenta_contable")
    .single();

  if (error || !row) {
    console.error("[clients] supabase insert failed", error);
    return {
      ok: false,
      error: error?.message ?? "No pudimos guardar el cliente en la base de datos.",
    };
  }

  revalidatePath("/clients");
  revalidatePath("/orders/new");
  return {
    ok: true,
    client: row as Client,
    source: clientifySynced ? "clientify+supabase" : "supabase",
  };
}

// ============================================================================
// Action: editar datos fiscales/contables de un cliente existente (ficha)
// ============================================================================

const ClientFiscalSchema = z.object({
  id: z.string().uuid(),
  condicion_iva: z.enum([
    "RESPONSABLE_INSCRIPTO",
    "MONOTRIBUTO",
    "EXENTO",
    "CONSUMIDOR_FINAL",
    "NO_RESPONSABLE",
    "NO_CATEGORIZADO",
  ]),
  cuenta_contable: z.string().max(20).optional().default(""),
});
export type ClientFiscalInput = z.input<typeof ClientFiscalSchema>;

export async function updateClientFiscal(
  input: ClientFiscalInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = ClientFiscalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Backend no disponible." };
  const d = parsed.data;
  const cuenta = d.cuenta_contable?.trim() || null;
  if (cuenta) {
    const { data: acc, error: accErr } = await admin
      .from("chart_of_accounts")
      .select("code, is_postable, is_active")
      .eq("code", cuenta)
      .maybeSingle();
    if (!accErr) {
      if (!acc) return { ok: false, error: `La cuenta ${cuenta} no existe en el Plan de Cuentas.` };
      if (!acc.is_postable || !acc.is_active) {
        return { ok: false, error: `La cuenta ${cuenta} no es imputable.` };
      }
    }
  }
  const { error } = await admin
    .from("clients")
    .update({ condicion_iva: d.condicion_iva, cuenta_contable: cuenta })
    .eq("id", d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/clientes/${d.id}`);
  revalidatePath("/clients");
  return { ok: true };
}

// ============================================================================
// Action: forzar refresh desde Clientify (manual refresh button)
// ============================================================================

export async function refreshFromClientify(): Promise<{
  ok: boolean;
  synced: number;
  error?: string;
}> {
  if (!env.clientify.configured) {
    return { ok: false, synced: 0, error: "Clientify no está configurado." };
  }
  try {
    // B2B: sincronizamos EMPRESAS (no contactos). Pull 1 página completa (100).
    const r = await clientify.listCompanies({ pageSize: 100 });
    if (!r.ok) return { ok: false, synced: 0, error: r.message };
    const admin = createAdminClient();
    if (!admin) return { ok: false, synced: 0, error: "Supabase admin no disponible." };
    const rows = r.data.results.map(clientifyCompanyToClient).filter((c) => c.cuit?.length >= 11);
    if (rows.length === 0) {
      revalidatePath("/clients");
      return { ok: true, synced: 0 };
    }
    const { error } = await admin.from("clients").upsert(
      rows.map((r) => ({
        razon: r.razon,
        cuit: r.cuit,
        domicilio: r.domicilio,
        telefono: r.telefono,
        contacto: r.contacto,
        email: r.email,
        tags: r.tags ?? [],
      })),
      { onConflict: "cuit" }
    );
    if (error) return { ok: false, synced: 0, error: error.message };
    revalidatePath("/clients");
    return { ok: true, synced: rows.length };
  } catch (e) {
    console.error("[clients] refreshFromClientify failed", e);
    return {
      ok: false,
      synced: 0,
      error: e instanceof Error ? e.message : "Error inesperado",
    };
  }
}

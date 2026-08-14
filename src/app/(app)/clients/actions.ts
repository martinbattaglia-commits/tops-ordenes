"use server";

/**
 * Server actions del registro maestro de clientes.
 *
 * ─── AUTORIZACIÓN REAL ─────────────────────────────────────────────────────
 *
 * Cada acción verifica su permiso ANTES de tocar la base, vía `denyReason`.
 * La versión anterior no verificaba ninguno: `createClient` y
 * `updateClientFiscal` escribían con `service_role` para cualquiera que
 * alcanzara la ruta. Ocultar un botón no es autorización.
 *
 * ─── SIN UPSERTS DESTRUCTIVOS ──────────────────────────────────────────────
 *
 * Desaparece `refreshFromClientify`, que hacía
 * `upsert(onConflict: "cuit")` con service_role sobre la cartera entera y
 * pisaba razón social, domicilio, teléfono, contacto, email y tags locales
 * con lo que devolviera el CRM. En su lugar, `previewClientifyDivergences`
 * COMPARA y REPORTA, sin escribir una sola fila: la resolución de cada
 * divergencia es una decisión humana, no un efecto colateral de apretar
 * «actualizar».
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { clientify } from "@/lib/clientify";
import {
  clientToClientifyCompanyPayload,
  clientifyCompanyToClient,
  duplicateCandidates,
  listClients,
  type DuplicateCandidate,
} from "@/lib/data/clients";
import { denyReason } from "@/lib/rbac/guard";
import { isValidCuit } from "@/lib/utils";
import type { Client } from "@/lib/types";

// ============================================================================
// Schemas
// ============================================================================

const NewClientSchema = z.object({
  razon: z.string().min(2, "Razón social muy corta").max(200),
  cuit: z
    .string()
    .min(11, "CUIT incompleto")
    .max(15)
    .refine((v) => isValidCuit(v), "CUIT inválido (dígito verificador)"),
  nombre_comercial: z.string().max(200).optional().default(""),
  codigo: z.string().max(30).optional().default(""),
  contacto: z.string().max(120).optional().default(""),
  email: z.string().email("Email inválido").or(z.literal("")).optional().default(""),
  telefono: z.string().max(40).optional().default(""),
  tags: z.array(z.string()).max(20).optional().default([]),
  depot: z.enum(["MAGALDI", "LUJAN", ""]).optional().default(""),
  observ: z.string().max(2000).optional().default(""),
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
  /** Confirmación explícita ante candidatos a duplicado ya advertidos. */
  confirmar_pese_a_duplicados: z.boolean().optional().default(false),
});

export type NewClientInput = z.input<typeof NewClientSchema>;

export type CreateClientResult =
  | { ok: true; client: Client; clientify_sync: "ok" | "pendiente" | "no_configurado" }
  | { ok: false; error: string; duplicados?: DuplicateCandidate[] };

// ============================================================================
// Listar
// ============================================================================

export async function fetchClients(search?: string): Promise<{
  ok: boolean;
  rows: Client[];
  total: number;
  source: string;
  warning?: string;
  error?: string;
}> {
  const deny = await denyReason("clientes.view");
  if (deny) return { ok: false, rows: [], total: 0, source: "denied", error: deny };
  try {
    const r = await listClients({ search });
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

/** Candidatos a duplicado para advertir en el formulario, antes de guardar. */
export async function checkDuplicates(
  razon: string,
  cuit?: string,
): Promise<{ ok: boolean; candidatos: DuplicateCandidate[] }> {
  const deny = await denyReason("clientes.view");
  if (deny) return { ok: false, candidatos: [] };
  return { ok: true, candidatos: await duplicateCandidates(razon, cuit ?? null) };
}

// ============================================================================
// Crear
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
  const deny = await denyReason("clientes.create");
  if (deny) return { ok: false, error: deny };

  const parsed = NewClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => i.message).join(" · ") };
  }
  const data = parsed.data;
  const cuitDigits = data.cuit.replace(/\D/g, "");

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Backend no disponible." };

  // Duplicado EXACTO por CUIT: bloquea siempre. Es la unicidad de la tabla.
  const { data: existing } = await admin
    .from("clients")
    .select("id, razon")
    .eq("cuit", cuitDigits)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: `Ya existe un cliente con CUIT ${cuitDigits} (${existing.razon}).` };
  }

  // Duplicado PROBABLE por razón social: advierte, no bloquea. Un alta
  // legítima con nombre parecido debe poder completarse; lo que no puede es
  // ocurrir sin que nadie la haya visto.
  if (!data.confirmar_pese_a_duplicados) {
    const candidatos = await duplicateCandidates(data.razon, cuitDigits);
    if (candidatos.length > 0) {
      return {
        ok: false,
        error: "Hay clientes parecidos. Revisalos y confirmá si aun así querés crear uno nuevo.",
        duplicados: candidatos,
      };
    }
  }

  const cuenta = data.cuenta_contable?.trim() || null;
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

  // 1) El cliente NACE nativo, siempre. Clientify no participa de su creación.
  const { data: row, error } = await admin
    .from("clients")
    .insert({
      razon: data.razon,
      cuit: cuitDigits,
      nombre_comercial: data.nombre_comercial || null,
      codigo: data.codigo || null,
      telefono: data.telefono || null,
      contacto: data.contacto || null,
      email: data.email || null,
      tags: data.tags,
      condicion_iva: data.condicion_iva,
      cuenta_contable: cuenta,
      sync_state: env.clientify.configured ? "pending" : "never",
    })
    .select("*")
    .single();

  if (error || !row) {
    console.error("[clients] insert failed", error);
    return { ok: false, error: error?.message ?? "No pudimos guardar el cliente." };
  }

  await registrarEvento(row.id, "created", { after: row });

  // 2) Empuje a Clientify: BEST-EFFORT y posterior. Si falla, el cliente ya
  //    existe y es plenamente usable; sólo queda marcado el estado de sync.
  let sync: "ok" | "pendiente" | "no_configurado" = "no_configurado";
  if (env.clientify.configured) {
    sync = "pendiente";
    try {
      const r = await clientify.createCompany(
        clientToClientifyCompanyPayload({
          razon: data.razon,
          cuit: cuitDigits,
          email: data.email,
          telefono: data.telefono,
          tags: data.tags,
        }),
      );
      await admin
        .from("clients")
        .update(
          r.ok
            ? {
                external_source: "clientify",
                external_id: String(r.data.id),
                sync_state: "ok",
                sync_last_attempt_at: new Date().toISOString(),
                sync_last_result: "created",
                sync_last_error: null,
              }
            : {
                sync_state: "error",
                sync_last_attempt_at: new Date().toISOString(),
                sync_last_result: "failed",
                // Error SANEADO: sólo el mensaje, nunca el cuerpo crudo ni la credencial.
                sync_last_error: sanitizarError(r.message),
              },
        )
        .eq("id", row.id);
      if (r.ok) sync = "ok";
    } catch (e) {
      console.error("[clients] clientify push failed (no bloqueante)", e);
      await admin
        .from("clients")
        .update({
          sync_state: "error",
          sync_last_attempt_at: new Date().toISOString(),
          sync_last_result: "exception",
          sync_last_error: sanitizarError(e instanceof Error ? e.message : String(e)),
        })
        .eq("id", row.id);
    }
  }

  revalidatePath("/clients");
  revalidatePath("/orders/new");
  return { ok: true, client: row as Client, clientify_sync: sync };
}

// ============================================================================
// Editar ficha fiscal
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
  input: ClientFiscalInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const deny = await denyReason("clientes.edit");
  if (deny) return { ok: false, error: deny };

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

  const { data: before } = await admin
    .from("clients")
    .select("condicion_iva, cuenta_contable")
    .eq("id", d.id)
    .maybeSingle();

  const { error } = await admin
    .from("clients")
    .update({ condicion_iva: d.condicion_iva, cuenta_contable: cuenta })
    .eq("id", d.id);
  if (error) return { ok: false, error: error.message };

  await registrarEvento(d.id, "updated", {
    before,
    after: { condicion_iva: d.condicion_iva, cuenta_contable: cuenta },
  });

  revalidatePath(`/clientes/${d.id}`);
  revalidatePath("/clients");
  return { ok: true };
}

// ============================================================================
// Activar / desactivar
// ============================================================================

export async function setClientActivo(
  id: string,
  activo: boolean,
  motivo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const deny = await denyReason("clientes.delete");
  if (deny) return { ok: false, error: deny };
  if (!motivo?.trim()) return { ok: false, error: "El motivo es obligatorio." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Backend no disponible." };

  // Un cliente NUNCA se elimina físicamente: se desactiva. Las órdenes y
  // recepciones históricas que lo referencian siguen siendo válidas.
  const { error } = await admin.from("clients").update({ activo }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await registrarEvento(id, activo ? "activated" : "deactivated", { motivo: motivo.trim() });
  revalidatePath("/clients");
  return { ok: true };
}

// ============================================================================
// Clientify: comparar sin escribir
// ============================================================================

export interface ClientifyDivergence {
  external_id: string;
  razon_crm: string;
  cuit: string;
  /** null = el CRM tiene una empresa que no existe localmente. */
  client_id: string | null;
  razon_local: string | null;
  campos_distintos: string[];
}

/**
 * Compara la cartera del CRM con el registro maestro y REPORTA divergencias.
 *
 * NO ESCRIBE NADA. Reemplaza a `refreshFromClientify`, que hacía un upsert
 * masivo por CUIT con service_role: ese camino pisaba en silencio datos
 * cargados a mano y era imposible saber después qué se había perdido.
 *
 * Qué hacer con cada divergencia es una decisión de una persona, y por eso
 * esta acción termina en una lista, no en un `update`.
 */
export async function previewClientifyDivergences(): Promise<{
  ok: boolean;
  divergencias: ClientifyDivergence[];
  error?: string;
}> {
  const deny = await denyReason("clientes.view");
  if (deny) return { ok: false, divergencias: [], error: deny };
  if (!env.clientify.configured) {
    return { ok: false, divergencias: [], error: "Clientify no está configurado." };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, divergencias: [], error: "Backend no disponible." };

  const r = await clientify.listCompanies({ pageSize: 100 });
  if (!r.ok) {
    // El CRM caído NO degrada nada: sólo no se puede comparar.
    return { ok: false, divergencias: [], error: sanitizarError(r.message) };
  }

  const espejos = r.data.results.map(clientifyCompanyToClient);
  const { data: locales } = await admin
    .from("clients")
    .select("id, razon, cuit, email, telefono, external_id");
  const porCuit = new Map(
    (locales ?? []).map((c) => [String(c.cuit).replace(/\D/g, ""), c] as const),
  );

  const divergencias: ClientifyDivergence[] = [];
  for (const e of espejos) {
    const cuitDigits = e.cuit.replace(/\D/g, "");
    if (cuitDigits.length !== 11) continue;
    const local = porCuit.get(cuitDigits);
    if (!local) {
      divergencias.push({
        external_id: e.external_id,
        razon_crm: e.razon,
        cuit: cuitDigits,
        client_id: null,
        razon_local: null,
        campos_distintos: ["(no existe localmente)"],
      });
      continue;
    }
    const distintos: string[] = [];
    if (local.razon !== e.razon) distintos.push("razon");
    if ((local.email ?? null) !== (e.email ?? null)) distintos.push("email");
    if ((local.telefono ?? null) !== (e.telefono ?? null)) distintos.push("telefono");
    if (!local.external_id) distintos.push("(sin vínculo externo)");
    if (distintos.length > 0) {
      divergencias.push({
        external_id: e.external_id,
        razon_crm: e.razon,
        cuit: cuitDigits,
        client_id: local.id,
        razon_local: local.razon,
        campos_distintos: distintos,
      });
    }
  }
  return { ok: true, divergencias };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Registra un evento de auditoría. `ts`, `actor` y `actor_email` los sella el
 * trigger de 0241 server-side: lo que se mande desde acá se descarta.
 */
async function registrarEvento(
  clientId: string,
  kind: "created" | "updated" | "activated" | "deactivated" | "sync_attempt" | "sync_conflict",
  payload: { before?: unknown; after?: unknown; motivo?: string },
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin.from("client_events").insert({
    client_id: clientId,
    kind,
    origin: "manual",
    before: payload.before ?? null,
    after: payload.after ?? null,
    motivo: payload.motivo ?? null,
  });
  if (error) console.error("[clients] audit insert failed", error.message);
}

/**
 * Deja el error apto para persistirse: acota longitud y elimina cualquier
 * cosa con forma de credencial. Prohibido guardar token, clave o cuerpo crudo.
 */
function sanitizarError(msg: string | undefined): string {
  if (!msg) return "error desconocido";
  return msg
    .replace(/(bearer|token|api[_-]?key|authorization)\s*[:=]?\s*\S+/gi, "$1 [REDACTADO]")
    .slice(0, 500);
}

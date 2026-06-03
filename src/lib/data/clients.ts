/**
 * Capa de datos para Clientes.
 *
 * Estrategia híbrida:
 *  - **Clientify es source of truth comercial** (cuando está configurado).
 *  - **Supabase es source of truth operativo** — los `orders` hacen FK a la
 *    tabla `clients`, así que cada cliente que se crea/edita se proyecta
 *    en Supabase por CUIT para mantener la integridad referencial.
 *  - Si Clientify NO está configurado, todo se mantiene contra Supabase
 *    (la app sigue funcionando, simplemente no sincroniza con el CRM).
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { clientify, type ClientifyCompany } from "@/lib/clientify";
import { MOCK_CLIENTS } from "@/lib/mock-data";
import type { Client } from "@/lib/types";

export interface ListClientsOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListClientsResult {
  rows: Client[];
  total: number;
  source: "clientify" | "supabase" | "mock";
  warning?: string;
}

/**
 * Lista clientes priorizando Clientify, con fallback a Supabase si Clientify
 * no está configurado o devuelve error. Siempre devuelve datos válidos
 * (nunca rompe la UI).
 */
export async function listClientsHybrid(
  opts: ListClientsOptions = {}
): Promise<ListClientsResult> {
  const { search, page = 1, pageSize = 50 } = opts;

  // 1. Intento Clientify si está configurado.
  //    TOPS es B2B: la cartera de clientes son EMPRESAS (razón social + CUIT),
  //    no personas. Por eso leemos `/companies/`, no `/contacts/`.
  if (env.clientify.configured) {
    const res = await clientify.listCompanies({ page, pageSize, search });
    if (res.ok) {
      const rows = res.data.results.map(clientifyCompanyToClient);
      // Best-effort: proyectamos a Supabase para que orders tenga FK válida.
      void projectToSupabase(rows).catch((e) =>
        console.error("[clients] projectToSupabase failed (non-blocking)", e)
      );
      return { rows, total: res.data.count, source: "clientify" };
    }
    // Si Clientify falla, no rompemos — caemos a Supabase con un warning visible.
    console.error("[clients] Clientify fetch failed, falling back to Supabase", res);
    const fb = await listFromSupabase(opts);
    return {
      ...fb,
      warning: `CRM Clientify no disponible (${res.message}). Mostrando datos locales.`,
    };
  }

  // 2. Sin Clientify: Supabase
  return listFromSupabase(opts);
}

async function listFromSupabase(opts: ListClientsOptions): Promise<ListClientsResult> {
  const admin = createAdminClient();
  if (!admin) {
    // Sin nada configurado → mock (modo demo o setup incompleto)
    const filtered = filterMock(MOCK_CLIENTS, opts.search);
    return { rows: filtered, total: filtered.length, source: "mock" };
  }
  let q = admin.from("clients").select("*", { count: "exact" }).order("razon");
  if (opts.search) {
    const s = opts.search.trim();
    if (s) q = q.or(`razon.ilike.%${s}%,cuit.ilike.%${s}%,email.ilike.%${s}%`);
  }
  const from = ((opts.page ?? 1) - 1) * (opts.pageSize ?? 50);
  const to = from + (opts.pageSize ?? 50) - 1;
  q = q.range(from, to);

  const { data, error, count } = await q;
  if (error) {
    console.error("[clients] supabase list failed", error);
    return { rows: [], total: 0, source: "supabase", warning: error.message };
  }
  return {
    rows: (data ?? []) as Client[],
    total: count ?? data?.length ?? 0,
    source: "supabase",
  };
}

function filterMock(rows: Client[], search?: string): Client[] {
  if (!search) return rows;
  const q = search.toLowerCase();
  return rows.filter(
    (c) =>
      c.razon.toLowerCase().includes(q) ||
      c.cuit.includes(q) ||
      (c.email?.toLowerCase().includes(q) ?? false)
  );
}

// ============================================================================
// Mapeo TOPS Client ↔ Clientify Company (cartera B2B)
// ============================================================================

/** Convierte una EMPRESA de Clientify al modelo Client de TOPS (cartera B2B). */
export function clientifyCompanyToClient(c: ClientifyCompany): Client {
  const razon = (c.name ?? "").trim() || `Empresa #${c.id}`;
  const cuit = (c.identification_number ?? extractCuitFromRaw(c.raw) ?? "").toString();

  return {
    id: `clientify-company-${c.id}`,
    razon,
    cuit,
    domicilio: null,
    telefono: c.phone ?? null,
    // El "contacto principal" vive en los contactos asociados a la empresa
    // (relación aparte en Clientify), no en el payload de la empresa.
    contacto: null,
    email: c.email ?? null,
    tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string") : [],
    created_at:
      (typeof c.raw?.created === "string" ? c.raw.created : null) ?? new Date().toISOString(),
  };
}

function extractCuitFromRaw(raw: Record<string, unknown> | undefined): string | null {
  if (!raw) return null;
  const candidates = [
    "cuit",
    "CUIT",
    "tax_id",
    "vat",
    "identification",
    "identification_number",
    "taxpayer_identification_number",
    "tax_number",
  ];
  for (const k of candidates) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Convierte un input de "Nuevo cliente" TOPS al payload Clientify Company. */
export function clientToClientifyCompanyPayload(input: {
  razon: string;
  cuit: string;
  email?: string;
  telefono?: string;
  tags?: string[];
}): Record<string, unknown> {
  return {
    name: input.razon.trim(),
    identification_number: input.cuit.replace(/\D/g, ""),
    email: input.email?.trim() || undefined,
    phone: input.telefono?.trim() || undefined,
    tags: input.tags && input.tags.length > 0 ? input.tags : undefined,
  };
}

// ============================================================================
// Projection a Supabase (para FK de orders)
// ============================================================================

async function projectToSupabase(rows: Client[]): Promise<void> {
  if (rows.length === 0) return;
  const admin = createAdminClient();
  if (!admin) return;

  const eligible = rows.filter((r) => r.cuit && r.cuit.replace(/\D/g, "").length === 11);
  if (eligible.length === 0) return;

  const { error } = await admin.from("clients").upsert(
    eligible.map((r) => ({
      razon: r.razon,
      cuit: r.cuit,
      domicilio: r.domicilio,
      telefono: r.telefono,
      contacto: r.contacto,
      email: r.email,
      tags: r.tags ?? [],
    })),
    { onConflict: "cuit", ignoreDuplicates: false }
  );
  if (error) {
    console.error("[clients] upsert into supabase failed (non-blocking)", error);
  }
}

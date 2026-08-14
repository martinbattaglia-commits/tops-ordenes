/**
 * Capa de datos para Clientes.
 *
 * ─── PROPIEDAD DEL DATO ────────────────────────────────────────────────────
 *
 * `public.clients` en Supabase es el SISTEMA MAESTRO. Clientify es un sistema
 * externo espejo: opcional, subsidiario y no autoritativo.
 *
 * Esto INVIERTE lo que hacía la versión anterior de este archivo, que
 * declaraba «Clientify es source of truth comercial» y, en consecuencia:
 *
 *   · devolvía filas con id sintético `clientify-company-${id}` —un
 *     identificador externo usado como identidad interna—, de modo que la
 *     lista de /clients y la que consume el WMS eran dos universos distintos
 *     y ningún id de la primera servía para crear una orden o una recepción;
 *   · proyectaba a Supabase con `upsert(onConflict: "cuit")` ejecutado con
 *     service_role, pisando razón social, domicilio, teléfono, contacto,
 *     email y tags locales con lo que viniera del CRM, sin dejar rastro.
 *
 * Ninguna de las dos cosas ocurre acá. La identidad es SIEMPRE el uuid
 * canónico de `public.clients`, y ninguna sincronización sobrescribe un dato
 * escrito por una persona.
 *
 * ─── NO BLOQUEANTE ─────────────────────────────────────────────────────────
 *
 * Listar, buscar, crear y editar clientes NO consultan Clientify. Que el CRM
 * esté caído, desconectado, con timeout, con credencial inválida o con error
 * intermitente produce exactamente el mismo comportamiento funcional que que
 * no esté configurado: la operación local se completa igual. No queda ninguna
 * ruta de lectura que dependa de la red.
 */
import "server-only";

import { createAdminClient, createClient as createUserClient } from "@/lib/supabase/server";
import { MOCK_CLIENTS } from "@/lib/mock-data";
import type { ClientifyCompany } from "@/lib/clientify";
import type { Client } from "@/lib/types";

export interface ListClientsOptions {
  search?: string;
  page?: number;
  pageSize?: number;
  soloActivos?: boolean;
}

export interface ListClientsResult {
  rows: Client[];
  total: number;
  /** `mock` sólo cuando no hay backend configurado (demo o setup incompleto). */
  source: "supabase" | "mock";
  warning?: string;
}

/**
 * Lista clientes desde el registro maestro. Fuente ÚNICA: `public.clients`.
 *
 * No existe una rama «si Clientify está configurado»: el CRM no participa de
 * la lectura, así que un cliente local nunca queda oculto por un problema del
 * CRM. Reemplaza a `listClientsHybrid`.
 */
export async function listClients(opts: ListClientsOptions = {}): Promise<ListClientsResult> {
  const { search, page = 1, pageSize = 50, soloActivos = false } = opts;

  const admin = createAdminClient();
  if (!admin) {
    const filtrados = filterMock(MOCK_CLIENTS, search);
    return { rows: filtrados, total: filtrados.length, source: "mock" };
  }

  let q = admin.from("clients").select("*", { count: "exact" }).order("razon");
  if (soloActivos) q = q.eq("activo", true);
  if (search?.trim()) {
    const s = search.trim();
    const digits = s.replace(/\D/g, "");
    // Filtro amplio para la grilla administrativa. La búsqueda NORMALIZADA
    // (sin tildes, espacios colapsados, CUIT en cualquier formato) es la RPC
    // `clients_search`, que expone searchClients() más abajo.
    const ors = [`razon.ilike.%${s}%`, `nombre_comercial.ilike.%${s}%`, `email.ilike.%${s}%`];
    if (digits.length >= 3) ors.push(`cuit.ilike.%${digits}%`);
    q = q.or(ors.join(","));
  }

  const from = (page - 1) * pageSize;
  q = q.range(from, from + pageSize - 1);

  const { data, error, count } = await q;
  if (error) {
    console.error("[clients] list failed", error);
    return { rows: [], total: 0, source: "supabase", warning: error.message };
  }
  return { rows: (data ?? []) as Client[], total: count ?? data?.length ?? 0, source: "supabase" };
}

function filterMock(rows: Client[], search?: string): Client[] {
  if (!search) return rows;
  const q = search.toLowerCase();
  return rows.filter(
    (c) =>
      c.razon.toLowerCase().includes(q) ||
      c.cuit.includes(q) ||
      (c.email?.toLowerCase().includes(q) ?? false),
  );
}

// ============================================================================
// Búsqueda canónica normalizada (RPC de 0241)
// ============================================================================

export interface ClientSearchHit {
  id: string;
  razon: string;
  nombre_comercial: string | null;
  cuit: string;
  codigo: string | null;
  email: string | null;
  telefono: string | null;
  localidad: string | null;
  activo: boolean;
  score: number;
}

/**
 * Búsqueda normalizada por razón social, nombre comercial, CUIT, código,
 * email o teléfono. Tolera mayúsculas, tildes, espacios repetidos y CUIT
 * escrito con o sin guiones.
 *
 * Usa el cliente del USUARIO, no `service_role`: la RPC es SECURITY INVOKER y
 * la RLS del llamador sigue vigente. Una búsqueda no puede ser la puerta
 * trasera para leer lo que la RLS niega.
 */
export async function searchClients(
  q: string,
  limit = 20,
  soloActivos = true,
): Promise<ClientSearchHit[]> {
  const supabase = createUserClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("clients_search", {
    p_q: q,
    p_limit: limit,
    p_solo_activos: soloActivos,
  });
  if (error) {
    console.error("[clients] clients_search failed", error);
    return [];
  }
  return (data ?? []) as ClientSearchHit[];
}

export interface DuplicateCandidate {
  id: string;
  razon: string;
  cuit: string;
  match_reason: "cuit_identico" | "razon_similar";
  score: number;
}

/**
 * Candidatos a duplicado, para ADVERTIR antes de dar de alta. Informativa: no
 * fusiona, no decide y no bloquea por sí sola. El único criterio determinante
 * sigue siendo el CUIT, que tiene unicidad en la tabla; el parecido de nombre
 * sólo advierte.
 */
export async function duplicateCandidates(
  razon: string,
  cuit?: string | null,
): Promise<DuplicateCandidate[]> {
  const supabase = createUserClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("clients_duplicate_candidates", {
    p_razon: razon,
    p_cuit: cuit ?? null,
  });
  if (error) {
    console.error("[clients] clients_duplicate_candidates failed", error);
    return [];
  }
  return (data ?? []) as DuplicateCandidate[];
}

// ============================================================================
// Mapeo TOPS Client ↔ Clientify Company (cartera B2B)
// ============================================================================

/** Proyección de una empresa de Clientify, SIN identidad interna. */
export interface ClientifyMirror {
  razon: string;
  cuit: string;
  telefono: string | null;
  email: string | null;
  tags: string[];
  external_source: "clientify";
  external_id: string;
}

/**
 * Convierte una EMPRESA de Clientify a la proyección espejo.
 *
 * NO devuelve `id`: el identificador de Clientify viaja en `external_id` y
 * queda marcado como externo. Que antes se devolviera como `Client.id` es
 * justamente lo que hacía que la lista de /clients no sirviera para crear
 * órdenes ni recepciones.
 */
export function clientifyCompanyToClient(c: ClientifyCompany): ClientifyMirror {
  const razon = (c.name ?? "").trim() || `Empresa #${c.id}`;
  const cuit = (c.identification_number ?? extractCuitFromRaw(c.raw) ?? "").toString();

  return {
    razon,
    cuit,
    telefono: c.phone ?? null,
    email: c.email ?? null,
    tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string") : [],
    external_source: "clientify",
    external_id: String(c.id),
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

/** Convierte un input de «Nuevo cliente» TOPS al payload Clientify Company. */
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
// Selector canónico (P3-N1B) — contrato sin cambios
// ============================================================================

export interface ClientSelectOption {
  id: string;
  razon: string;
}

/**
 * Opciones del selector canónico de los formularios WMS. Fuente EXCLUSIVA:
 * `public.clients`, sólo activos. El uuid es lo que viaja al servidor; la
 * razón social es apenas la etiqueta visible.
 */
export async function listActiveClientRefs(): Promise<ClientSelectOption[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data, error } = await admin
    .from("clients")
    .select("id, razon")
    .eq("activo", true)
    .order("razon");
  if (error) throw new Error(`listActiveClientRefs: ${error.message}`);
  return (data ?? []) as ClientSelectOption[];
}

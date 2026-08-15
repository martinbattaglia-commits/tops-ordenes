/**
 * Capa de datos para Clientes.
 *
 * ─── CLIENTES 100 % NATIVOS ────────────────────────────────────────────────
 *
 * `public.clients` en Supabase es la ÚNICA fuente de verdad del registro
 * maestro. Por decisión expresa de Dirección, Clientify queda fuera de este
 * flujo: no se consulta, no se escribe y no se sincroniza.
 *
 * La versión anterior de este archivo declaraba «Clientify es source of truth
 * comercial» y, en consecuencia, devolvía filas con id sintético
 * `clientify-company-${id}` —un identificador externo usado como identidad
 * interna, de modo que la lista de /clients y la que consume el WMS eran dos
 * universos distintos— y proyectaba a Supabase con
 * `upsert(onConflict: "cuit")` ejecutado con service_role, pisando razón
 * social, domicilio, teléfono, contacto, email y tags locales con lo que
 * viniera del CRM. Nada de eso queda en pie.
 *
 * Ninguna operación de clientes toca la red. Que Clientify esté caído, sin
 * credenciales o inaccesible no cambia absolutamente nada acá, porque no
 * participa. La integración que usan otros módulos —comercial, prospección,
 * webhooks— sigue intacta y es ajena a este archivo.
 */
import "server-only";

import { createClient as createUserClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { MOCK_CLIENTS } from "@/lib/mock-data";
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

export class ClientsAccessDeniedError extends Error {
  constructor() {
    super("No autorizado: se requiere el permiso clientes.view.");
    this.name = "ClientsAccessDeniedError";
  }
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

  const supabase = createUserClient();
  if (!supabase) {
    if (!env.app.demoMode) throw new ClientsAccessDeniedError();
    const filtrados = filterMock(MOCK_CLIENTS, search);
    return { rows: filtrados, total: filtrados.length, source: "mock" };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new ClientsAccessDeniedError();
  const { data: canView, error: permissionError } = await supabase.rpc("has_permission", {
    p_slug: "clientes.view",
  });
  if (permissionError || canView !== true) throw new ClientsAccessDeniedError();

  let q = supabase.from("clients").select("*", { count: "exact" }).order("razon");
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
    console.error("[clients] list failed", { code: "CLIENTS_LIST_FAILED" });
    return {
      rows: [],
      total: 0,
      source: "supabase",
      warning: "No pudimos cargar el registro maestro.",
    };
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
    console.error("[clients] clients_search failed", { code: "CLIENT_SEARCH_FAILED" });
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
  if (!supabase) {
    throw new Error("No pudimos verificar posibles duplicados. Reintentá antes de crear.");
  }
  const { data, error } = await supabase.rpc("clients_duplicate_candidates", {
    p_razon: razon,
    p_cuit: cuit ?? null,
  });
  if (error) {
    console.error("[clients] clients_duplicate_candidates failed", {
      code: "CLIENT_DUPLICATE_CHECK_FAILED",
    });
    throw new Error("No pudimos verificar posibles duplicados. Reintentá antes de crear.");
  }
  return (data ?? []) as DuplicateCandidate[];
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
export async function listActiveClientRefs(
  scope: "wms" | "pedidos",
): Promise<ClientSelectOption[]> {
  const supabase = createUserClient();
  if (!supabase) throw new Error("CLIENT_ACTIVE_REFS_UNAVAILABLE");
  const { data, error } = await supabase.rpc("clients_active_refs", { p_scope: scope });
  if (error) throw new Error("CLIENT_ACTIVE_REFS_DENIED");
  return (data ?? []) as ClientSelectOption[];
}

import { env } from "@/lib/env";
import type {
  ClientifyContact,
  ClientifyCompany,
  ClientifyDeal,
  ClientifyPipeline,
  ClientifyActivity,
  ClientifyPaginated,
} from "./types";

/**
 * Cliente HTTP tipado para Clientify v1.
 *
 * Auth: `Authorization: Token <CLIENTIFY_API_KEY>` (sí, "Token", no "Bearer").
 * Rate limit: 300 req/min según docs. Manejamos 429 con backoff exponencial.
 * Errores: throw con mensaje explícito; el caller decide si fallback a mock.
 */

class ClientifyError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string,
    public body?: unknown
  ) {
    super(message);
    this.name = "ClientifyError";
  }
}

type QueryValue = string | number | boolean | undefined | null;

interface FetchOpts {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** Cuántos reintentos ante 429/5xx. Default 2. */
  maxRetries?: number;
}

async function fetchClientify<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  if (!env.clientify.configured) {
    throw new ClientifyError("CLIENTIFY_API_KEY no configurada", 0, path);
  }

  const base = env.clientify.baseUrl.replace(/\/$/, "");
  const cleanPath = path.replace(/^\//, "");
  let url = `${base}/${cleanPath}`;

  if (opts.query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    }
    const qs = sp.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  return fetchInner<T>(url, opts);
}

async function fetchInner<T>(url: string, opts: FetchOpts): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  let attempt = 0;
  let lastErr: ClientifyError | null = null;

  while (attempt <= maxRetries) {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Token ${env.clientify.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      // Server actions / route handlers: cache off
      cache: "no-store",
    });

    if (res.ok) {
      // 204 no content
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    // 429 → backoff
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "0", 10);
      const wait = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
      attempt++;
      continue;
    }

    // 5xx → retry una vez
    if (res.status >= 500 && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
      attempt++;
      continue;
    }

    const body = await res.text().catch(() => "");
    lastErr = new ClientifyError(
      `Clientify ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
      res.status,
      url,
      body
    );
    break;
  }

  throw lastErr ?? new ClientifyError("Clientify request failed", 0, url);
}

// ------------------------------------------------------------------
// PUBLIC API — Contacts
// ------------------------------------------------------------------

export interface ListContactsParams {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  status?: string;
  tag?: string;
}

export async function listContacts(
  params: ListContactsParams = {}
): Promise<ClientifyPaginated<ClientifyContact>> {
  return fetchClientify<ClientifyPaginated<ClientifyContact>>("contacts/", {
    query: params as Record<string, QueryValue>,
  });
}

export async function getContact(id: number): Promise<ClientifyContact> {
  return fetchClientify<ClientifyContact>(`contacts/${id}/`);
}

// ------------------------------------------------------------------
// PUBLIC API — Companies
// ------------------------------------------------------------------

export async function listCompanies(
  params: ListContactsParams = {}
): Promise<ClientifyPaginated<ClientifyCompany>> {
  return fetchClientify<ClientifyPaginated<ClientifyCompany>>("companies/", {
    query: params as Record<string, QueryValue>,
  });
}

// ------------------------------------------------------------------
// PUBLIC API — Pipelines / Stages / Deals
// ------------------------------------------------------------------

export async function listPipelines(): Promise<ClientifyPaginated<ClientifyPipeline>> {
  return fetchClientify<ClientifyPaginated<ClientifyPipeline>>("deals/pipelines/");
}

export interface ListDealsParams {
  page?: number;
  page_size?: number;
  pipeline?: number;
  pipeline_stage?: number;
  status?: number;
  contact?: number;
  ordering?: string;
  search?: string;
}

export async function listDeals(
  params: ListDealsParams = {}
): Promise<ClientifyPaginated<ClientifyDeal>> {
  return fetchClientify<ClientifyPaginated<ClientifyDeal>>("deals/", {
    query: params as Record<string, QueryValue>,
  });
}

export async function getDeal(id: number): Promise<ClientifyDeal> {
  return fetchClientify<ClientifyDeal>(`deals/${id}/`);
}

// ------------------------------------------------------------------
// PUBLIC API — Activities
// ------------------------------------------------------------------

export async function listActivities(params: {
  page?: number;
  page_size?: number;
  contact?: number;
  deal?: number;
  type?: string;
}): Promise<ClientifyPaginated<ClientifyActivity>> {
  return fetchClientify<ClientifyPaginated<ClientifyActivity>>("activities/", {
    query: params as Record<string, QueryValue>,
  });
}

// ------------------------------------------------------------------
// PUBLIC API — Diagnostics
// ------------------------------------------------------------------

export interface ClientifyPing {
  ok: true;
  contactsCount: number;
  dealsCount: number;
  pipelinesCount: number;
  tenant?: string;
}

export async function ping(): Promise<ClientifyPing> {
  const [contacts, deals, pipelines] = await Promise.all([
    listContacts({ page_size: 1 }),
    listDeals({ page_size: 1 }),
    listPipelines(),
  ]);
  return {
    ok: true,
    contactsCount: contacts.count,
    dealsCount: deals.count,
    pipelinesCount: pipelines.count,
    tenant: pipelines.results[0]?.user_company,
  };
}

export { ClientifyError };

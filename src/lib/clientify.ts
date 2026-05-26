/**
 * Clientify REST API client.
 *
 * Diseño:
 *  - Singleton por proceso (la key se lee de env una vez al primer uso).
 *  - Fetch wrapper con retries exponenciales en 429/5xx (3 reintentos).
 *  - Header `Authorization: Token <key>` (auth nativa de Clientify, no Bearer).
 *  - Métodos tipados para `contacts` y `companies` cubriendo el caso de uso
 *    de TOPS Órdenes (listar, buscar, crear, actualizar).
 *  - Logs claros con prefijo `[clientify]` y nivel info/error.
 *
 * Servidor-only: este archivo NO debe importarse desde components client.
 * Las API keys NUNCA viajan al browser.
 */
import "server-only";

const CLIENTIFY_BASE_URL =
  process.env.CLIENTIFY_BASE_URL?.trim() || "https://api.clientify.net/v1";
const CLIENTIFY_API_KEY = process.env.CLIENTIFY_API_KEY?.trim() || "";
const CLIENTIFY_TIMEOUT_MS = Number(process.env.CLIENTIFY_TIMEOUT_MS) || 15_000;
const CLIENTIFY_MAX_RETRIES = Number(process.env.CLIENTIFY_MAX_RETRIES) || 3;

export const clientifyConfigured = Boolean(CLIENTIFY_API_KEY);

// ============================================================================
// Tipos públicos
// ============================================================================

/** Shape mínimo de un contacto en Clientify. Los campos exactos pueden
 *  variar por instancia — usar `raw` para preservar todo lo que devuelve la API. */
export interface ClientifyContact {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  tags?: string[];
  company?: number | { id: number; name: string } | null;
  identification_number?: string | null; // algunos accounts AR lo usan para CUIT
  created?: string | null;
  raw?: Record<string, unknown>;
}

export interface ClientifyCompany {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  industry?: string | null;
  country?: string | null;
  identification_number?: string | null; // CUIT
  tags?: string[];
  raw?: Record<string, unknown>;
}

export interface ClientifyListPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ClientifyError {
  ok: false;
  status: number;
  message: string;
  detail?: unknown;
}

export type ClientifyResult<T> = { ok: true; data: T } | ClientifyError;

// ============================================================================
// Núcleo: fetch wrapper con retries
// ============================================================================

interface RequestOpts {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Override del retry count. 0 = sin retries. */
  retries?: number;
}

async function clientifyRequest<T>(
  path: string,
  opts: RequestOpts = {}
): Promise<ClientifyResult<T>> {
  if (!CLIENTIFY_API_KEY) {
    return {
      ok: false,
      status: 0,
      message:
        "Clientify no está configurado en el servidor. Falta la variable CLIENTIFY_API_KEY.",
    };
  }

  const { method = "GET", query, body, retries = CLIENTIFY_MAX_RETRIES } = opts;

  // Build URL
  const base = CLIENTIFY_BASE_URL.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${cleanPath}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Token ${CLIENTIFY_API_KEY}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let attempt = 0;
  const max = Math.max(0, retries);
  let lastErr: ClientifyError | null = null;

  while (attempt <= max) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CLIENTIFY_TIMEOUT_MS);
    try {
      const startMs = Date.now();
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
        cache: "no-store",
      });
      const elapsed = Date.now() - startMs;
      clearTimeout(timer);

      const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
      const payload: unknown = isJson ? await res.json().catch(() => null) : await res.text();

      if (res.ok) {
        if (process.env.NODE_ENV !== "production") {
          console.info(`[clientify] ${method} ${cleanPath} → ${res.status} (${elapsed}ms)`);
        }
        return { ok: true, data: payload as T };
      }

      // Rate limit / 5xx → retry con backoff
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      lastErr = {
        ok: false,
        status: res.status,
        message: extractErrorMessage(payload, res.status),
        detail: payload,
      };
      console.error(
        `[clientify] ${method} ${cleanPath} → ${res.status} ${retryable ? "(retrying)" : ""}`,
        payload
      );

      if (!retryable || attempt === max) return lastErr;
    } catch (e) {
      clearTimeout(timer);
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? `Timeout tras ${CLIENTIFY_TIMEOUT_MS}ms`
            : e.message
          : "Error desconocido";
      lastErr = { ok: false, status: 0, message: msg, detail: e };
      console.error(`[clientify] ${method} ${cleanPath} → network error`, msg);
      if (attempt === max) return lastErr;
    }

    // backoff exponencial: 300ms, 900ms, 2700ms ...
    const wait = 300 * Math.pow(3, attempt);
    await new Promise((r) => setTimeout(r, wait));
    attempt += 1;
  }

  return (
    lastErr ?? {
      ok: false,
      status: 0,
      message: "Sin respuesta del CRM. Verificá la conectividad e intentá de nuevo.",
    }
  );
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    if (typeof obj.message === "string") return obj.message;
    if (Array.isArray(obj.non_field_errors) && typeof obj.non_field_errors[0] === "string") {
      return obj.non_field_errors[0];
    }
    // Errores DRF típicos: { campo: ["error 1", "error 2"] }
    const firstField = Object.entries(obj).find(([, v]) => Array.isArray(v) && v.length > 0);
    if (firstField) {
      const [field, errs] = firstField;
      const msg = (errs as unknown[])[0];
      return `${field}: ${typeof msg === "string" ? msg : "inválido"}`;
    }
  }
  if (status === 401) return "API key de Clientify inválida o expirada.";
  if (status === 403) return "Sin permisos en Clientify para esta operación.";
  if (status === 404) return "Recurso no encontrado en Clientify.";
  if (status === 429) return "Clientify saturado (rate limit). Reintentá en un momento.";
  if (status >= 500) return "Clientify está caído. Intentá de nuevo en unos minutos.";
  return `Error HTTP ${status}`;
}

// ============================================================================
// API pública: Contactos
// ============================================================================

export const clientify = {
  /** Listar contactos paginado. */
  async listContacts(
    params: { page?: number; pageSize?: number; search?: string } = {}
  ): Promise<ClientifyResult<ClientifyListPage<ClientifyContact>>> {
    return clientifyRequest<ClientifyListPage<ClientifyContact>>("/contacts/", {
      query: {
        page: params.page ?? 1,
        page_size: params.pageSize ?? 50,
        search: params.search,
      },
    });
  },

  /** Trae un contacto por id. */
  async getContact(id: number): Promise<ClientifyResult<ClientifyContact>> {
    return clientifyRequest<ClientifyContact>(`/contacts/${id}/`);
  },

  /** Busca contactos por texto libre (razón social / cuit / email). */
  async searchContacts(query: string): Promise<ClientifyResult<ClientifyListPage<ClientifyContact>>> {
    return clientifyRequest<ClientifyListPage<ClientifyContact>>("/contacts/", {
      query: { search: query, page_size: 50 },
    });
  },

  /** Crea un contacto. Payload pass-through: el caller mapea campos TOPS → Clientify. */
  async createContact(payload: Record<string, unknown>): Promise<ClientifyResult<ClientifyContact>> {
    return clientifyRequest<ClientifyContact>("/contacts/", {
      method: "POST",
      body: payload,
      retries: 1, // escritura: sólo 1 reintento si vuelve 5xx, para no duplicar
    });
  },

  /** Actualiza un contacto por id (parcial). */
  async updateContact(
    id: number,
    payload: Record<string, unknown>
  ): Promise<ClientifyResult<ClientifyContact>> {
    return clientifyRequest<ClientifyContact>(`/contacts/${id}/`, {
      method: "PATCH",
      body: payload,
      retries: 1,
    });
  },

  // -------- Companies --------
  async listCompanies(
    params: { page?: number; pageSize?: number; search?: string } = {}
  ): Promise<ClientifyResult<ClientifyListPage<ClientifyCompany>>> {
    return clientifyRequest<ClientifyListPage<ClientifyCompany>>("/companies/", {
      query: {
        page: params.page ?? 1,
        page_size: params.pageSize ?? 50,
        search: params.search,
      },
    });
  },

  /** Health check ligero. Hace `GET /contacts/?page_size=1`. */
  async ping(): Promise<ClientifyResult<{ ok: true; count?: number }>> {
    const res = await clientifyRequest<ClientifyListPage<ClientifyContact>>("/contacts/", {
      query: { page_size: 1 },
      retries: 0,
    });
    if (!res.ok) return res;
    return { ok: true, data: { ok: true, count: res.data.count } };
  },
};

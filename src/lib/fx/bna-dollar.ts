import "server-only";
import { env } from "@/lib/env";
import {
  parseCriptoyaBna,
  parseDolarApiOficial,
  resolveFxQuote,
  type FxQuote,
} from "./parse";

export type { FxQuote, FxStatus, FxProvider } from "./parse";

/**
 * Provider server-side de la cotización del dólar Banco Nación (venta).
 *
 * Fuente primaria : criptoya `bancostodos` → clave `bna` (Banco Nación exacto).
 * Fuente fallback : dolarapi `dolares/oficial` (oficial minorista = BNA).
 * Ambas son JSON público, solo-lectura, configurables por env (por si cambia el
 * endpoint). NUNCA se hardcodea una cotización: si las dos fallan, se sirve el
 * último dato conocido (stale) o `unavailable`.
 *
 * Caché a nivel de módulo: garantiza que NO se golpea la fuente externa en cada
 * render del Cockpit (que es `force-dynamic`). Vive por instancia de servidor y
 * se refresca pasado `revalidateSeconds`. Se complementa con el Data Cache de
 * Next (`next.revalidate`) sobre el `fetch`.
 */

interface CacheEntry {
  quote: FxQuote;
  atMs: number;
}
let cache: CacheEntry | null = null;

async function fetchJson(
  url: string,
  timeoutMs: number,
  revalidateSeconds: number
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devuelve la cotización actual. Nunca lanza (la UI no debe romperse). Usa la
 * caché de módulo si está fresca; si no, refresca desde primaria → fallback →
 * caché stale → unavailable.
 */
export async function getBnaDollar(): Promise<FxQuote> {
  const { primaryUrl, fallbackUrl, revalidateSeconds, timeoutMs } = env.fx.bna;

  if (cache && Date.now() - cache.atMs < revalidateSeconds * 1000) {
    return cache.quote;
  }

  const quote = await resolveFxQuote({
    primary: async () =>
      parseCriptoyaBna(await fetchJson(primaryUrl, timeoutMs, revalidateSeconds)),
    fallback: async () =>
      parseDolarApiOficial(await fetchJson(fallbackUrl, timeoutMs, revalidateSeconds)),
    cached: cache?.quote ?? null,
    onError: (stage, err) => {
      // Degradación silenciosa para el usuario, pero observable en logs del server.
      console.warn(`[fx/bna] fuente ${stage} falló:`, err instanceof Error ? err.message : err);
    },
  });

  // Sólo cacheamos datos frescos; un `stale`/`unavailable` no debe pisar un
  // último-dato-bueno previo.
  if (quote.status === "fresh") {
    cache = { quote, atMs: Date.now() };
  }
  return quote;
}

/** Hook de test: limpia la caché de módulo. No usar en runtime. */
export function __resetBnaCacheForTest(): void {
  cache = null;
}

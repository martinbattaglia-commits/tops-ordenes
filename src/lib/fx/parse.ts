/**
 * Núcleo PURO del provider de cotización del dólar Banco Nación (venta).
 *
 * Sin IO ni `server-only`: acá viven el parseo de cada fuente y la orquestación
 * primaria → fallback → caché → no-disponible. El módulo con red/caché
 * (`bna-dollar.ts`) sólo inyecta los `fetch` reales sobre estas funciones. Este
 * archivo es el que se testea (política vitest del repo: unidades puras, sin IO).
 *
 * Contrato de negocio (fijado por Dirección):
 *  - SIEMPRE Banco Nación, tipo VENTA, par USD/ARS.
 *  - NUNCA se hardcodea una cotización real: si no hay dato, `status:"unavailable"`.
 *  - No se muestra blue / MEP / CCL / tarjeta / promedio de mercado.
 */

export type FxStatus = "fresh" | "stale" | "unavailable";
export type FxProvider = "criptoya:bna" | "dolarapi:oficial";

/** Dato crudo ya normalizado desde cualquier fuente. */
export interface FxParsed {
  /** Venta (ask). Siempre > 0 cuando el parseo es exitoso. */
  sell: number;
  /** Compra (bid). Puede faltar en la fuente → null. */
  buy: number | null;
  /** ISO 8601 de la última actualización reportada por la fuente, o null. */
  updatedAt: string | null;
}

/** Cotización lista para la UI y para la API route. */
export interface FxQuote {
  /** Etiqueta de fuente para la UI. Siempre "Banco Nación". */
  source: string;
  pair: "USD/ARS";
  type: "venta";
  /** Venta (ask). null sólo si nunca se pudo obtener dato. */
  sell: number | null;
  /** Compra (bid). Opcional. */
  buy: number | null;
  /** ISO 8601 de la última actualización, o null. */
  updatedAt: string | null;
  /** true cuando se sirve un dato de caché (el refresh falló). */
  stale: boolean;
  status: FxStatus;
  /** Qué upstream respondió (diagnóstico; no se muestra crudo al usuario). */
  provider: FxProvider | null;
}

export const FX_SOURCE_LABEL = "Banco Nación";

function isPositiveNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

/**
 * criptoya `bancostodos`: objeto por banco. Tomamos SÓLO la clave `bna`
 * (Banco Nación exacto, no un promedio). `ask` = venta, `bid` = compra,
 * `time` = epoch en segundos.
 */
export function parseCriptoyaBna(data: unknown): FxParsed | null {
  if (!data || typeof data !== "object") return null;
  const bna = (data as Record<string, unknown>).bna;
  if (!bna || typeof bna !== "object") return null;
  const o = bna as Record<string, unknown>;
  if (!isPositiveNumber(o.ask)) return null;
  return {
    sell: o.ask,
    buy: isPositiveNumber(o.bid) ? o.bid : null,
    updatedAt: isPositiveNumber(o.time) ? new Date(o.time * 1000).toISOString() : null,
  };
}

/**
 * dolarapi `dolares/oficial`: el dólar oficial minorista = referencia Banco
 * Nación. `venta`/`compra` en pesos, `fechaActualizacion` ISO. Fuente de
 * respaldo cuando la primaria no responde.
 */
export function parseDolarApiOficial(data: unknown): FxParsed | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (!isPositiveNumber(o.venta)) return null;
  return {
    sell: o.venta,
    buy: isPositiveNumber(o.compra) ? o.compra : null,
    updatedAt: typeof o.fechaActualizacion === "string" ? o.fechaActualizacion : null,
  };
}

/** Empaqueta un dato fresco en la forma de UI/API. */
export function toQuote(parsed: FxParsed, provider: FxProvider): FxQuote {
  return {
    source: FX_SOURCE_LABEL,
    pair: "USD/ARS",
    type: "venta",
    sell: parsed.sell,
    buy: parsed.buy,
    updatedAt: parsed.updatedAt,
    stale: false,
    status: "fresh",
    provider,
  };
}

/** Estado terminal cuando no hay ningún dato (ni fuentes ni caché). */
export const FX_UNAVAILABLE: FxQuote = {
  source: FX_SOURCE_LABEL,
  pair: "USD/ARS",
  type: "venta",
  sell: null,
  buy: null,
  updatedAt: null,
  stale: true,
  status: "unavailable",
  provider: null,
};

/**
 * Orquestación PURA (fetchers inyectados). Cada fetcher devuelve `FxParsed | null`
 * (o lanza). Estrategia:
 *   1) primaria (Banco Nación exacto) → fresh
 *   2) fallback (oficial = BNA) → fresh
 *   3) último dato conocido (caché) → stale
 *   4) nada → unavailable
 * Nunca lanza: la UI jamás debe romperse por la cotización.
 */
export async function resolveFxQuote(opts: {
  primary: () => Promise<FxParsed | null>;
  fallback: () => Promise<FxParsed | null>;
  cached: FxQuote | null;
  onError?: (stage: "primary" | "fallback", err: unknown) => void;
}): Promise<FxQuote> {
  try {
    const p = await opts.primary();
    if (p) return toQuote(p, "criptoya:bna");
  } catch (err) {
    opts.onError?.("primary", err);
  }
  try {
    const f = await opts.fallback();
    if (f) return toQuote(f, "dolarapi:oficial");
  } catch (err) {
    opts.onError?.("fallback", err);
  }
  if (opts.cached && opts.cached.sell != null) {
    return { ...opts.cached, stale: true, status: "stale" };
  }
  return FX_UNAVAILABLE;
}

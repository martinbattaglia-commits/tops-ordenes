/**
 * Rate limiter in-memory por clave (IP, userId, etc).
 * Token-bucket simple: `limit` requests / `windowMs` ventana deslizante.
 *
 * Limitación: vive en la memoria del proceso. En Netlify Functions cada
 * función puede correr en un container distinto, así que esto NO reemplaza
 * un limiter centralizado (Upstash / Redis) para escenarios de alto tráfico
 * o ataques distribuidos. Sirve perfecto contra abuso casual y mistakes.
 */

interface Bucket {
  hits: number[];
}

const store = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - opts.windowMs;
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= opts.limit) {
    const oldest = bucket.hits[0] ?? now;
    const retryAfterMs = oldest + opts.windowMs - now;
    store.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterMs };
  }

  bucket.hits.push(now);
  store.set(key, bucket);
  return {
    ok: true,
    remaining: Math.max(0, opts.limit - bucket.hits.length),
    retryAfterMs: 0,
  };
}

export function clientKey(ip: string | null | undefined, userId?: string | null): string {
  return userId ? `u:${userId}` : ip ? `ip:${ip}` : "anon";
}

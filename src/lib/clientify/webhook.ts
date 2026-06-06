import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
// Nota: módulo server-intended (lo importa solo el route handler). No usa
// `server-only` para que las funciones puras sean testeables aisladas; el
// secret no se filtra al cliente (no es NEXT_PUBLIC y ningún client lo importa).

/**
 * webhook.ts — F2.2-2 · verificación de token + normalización del payload Clientify.
 *
 * Clientify NO firma sus webhooks (ver CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md), por eso
 * la autenticación es un **token secreto en la URL** comparado timing-safe. Estas
 * funciones son puras (la normalización no toca red/DB) → testeables aisladas.
 */

/** Compara dos strings en tiempo constante (evita timing attacks). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false; // length leak es inevitable; el token es de largo fijo
  return timingSafeEqual(ba, bb);
}

/**
 * Verifica el token-en-URL del webhook contra `CLIENTIFY_WEBHOOK_SECRET`.
 * Deniega si el secret no está configurado o el token no coincide.
 * `secret` es inyectable para testing.
 */
export function verifyWebhookToken(
  provided: string | undefined | null,
  secret: string = env.clientify.webhookSecret,
): boolean {
  if (!secret) return false;            // sin secret configurado → denegar (fail-closed)
  if (!provided) return false;
  return safeEqual(provided, secret);
}

// ── Normalización del payload ──────────────────────────────────────────────

export interface NormalizedLead {
  clientify_id: string | null;
  source: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cuit: string | null;
  company_name: string | null;
  tags: string[];
}

export interface NormalizedWebhook {
  lead: NormalizedLead;
  event: string | null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

/** Extrae el objeto contacto de distintos envoltorios posibles del webhook. */
function extractObject(body: Record<string, unknown>): Record<string, unknown> {
  for (const k of ["data", "object", "contact", "payload", "result"]) {
    const v = body[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return body; // objeto plano (la API devuelve el contacto al tope)
}

/** Primer email de un array `emails[]` o de un campo escalar `email`. */
function pickEmail(obj: Record<string, unknown>): string | null {
  const arr = obj.emails;
  if (Array.isArray(arr)) {
    for (const e of arr) {
      const em = asString((e as Record<string, unknown>)?.email);
      if (em) return em;
    }
  }
  return asString(obj.email);
}

function pickPhone(obj: Record<string, unknown>): string | null {
  const arr = obj.phones;
  if (Array.isArray(arr)) {
    for (const p of arr) {
      const ph = asString((p as Record<string, unknown>)?.phone);
      if (ph) return ph;
    }
  }
  return asString(obj.phone);
}

function pickFullName(obj: Record<string, unknown>): string | null {
  const direct = asString(obj.full_name) ?? asString(obj.name);
  if (direct) return direct;
  const fn = asString(obj.first_name) ?? "";
  const ln = asString(obj.last_name) ?? "";
  const joined = `${fn} ${ln}`.trim();
  return joined || null;
}

function pickTags(obj: Record<string, unknown>): string[] {
  const t = obj.tags;
  if (Array.isArray(t)) return t.map((x) => asString(x)).filter((x): x is string => !!x);
  return [];
}

/**
 * Normaliza el body del webhook a un lead canónico para `crm_ingest_lead`.
 * Devuelve null si no hay identidad mínima (clientify_id, email o phone) → el
 * handler lo trata como `skipped` (200, sin reintentos).
 */
export function normalizeLead(body: unknown): NormalizedWebhook | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const root = body as Record<string, unknown>;
  const obj = extractObject(root);

  const clientify_id =
    asString(obj.id) ?? asString(obj.contact_id) ?? asString(root.object_id) ?? asString(root.id);
  const email = pickEmail(obj);
  const phone = pickPhone(obj);

  // Identidad mínima requerida.
  if (!clientify_id && !email && !phone) return null;

  const lead: NormalizedLead = {
    clientify_id,
    source: asString(obj.contact_source) ?? asString(obj.medium) ?? asString(obj.channel) ?? asString(obj.source),
    full_name: pickFullName(obj),
    email,
    phone,
    cuit: asString(obj.taxpayer_identification_number) ?? asString(obj.identification_number) ?? asString(obj.cuit),
    company_name: asString(obj.company_name) ?? asString(obj.company_name_text),
    tags: pickTags(obj),
  };

  const event =
    asString(root.event) ??
    (asString(root.object_type) && asString(root.action)
      ? `${asString(root.object_type)}.${asString(root.action)}`
      : asString(root.object_type));

  return { lead, event };
}

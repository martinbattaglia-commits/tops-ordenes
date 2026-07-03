import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * cron-auth.ts — F4.4-E2 · Guard único FAIL-CLOSED para endpoints de cron/ops.
 *
 * Reemplaza el patrón fail-open `if (secret) { ... }` (si CRON_SECRET no estaba
 * configurado el endpoint quedaba ABIERTO — hallazgo #1 de la auditoría de
 * permisos 2026-06-28) por el patrón del worker F4.1 (0160 / dispatch-outbox):
 * sin secret → 503 (misconfig visible), credencial inválida → 401, comparación
 * timing-safe. Puro y testeable: el secret es inyectable.
 *
 * Evidencia E1 (2026-07-03): los 5 workflows de GH Actions ya envían
 * `Authorization: Bearer $CRON_SECRET` y corren verdes → endurecer estos guards
 * NO rompe los crons operativos (CRON_SECRET confirmado en GitHub y Netlify).
 */

/** Compara dos strings en tiempo constante (evita timing attacks). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false; // el largo puede filtrarse; los secrets son de largo fijo
  return timingSafeEqual(ba, bb);
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 503 | 401; error: string };

/**
 * Evalúa el header Authorization contra `Bearer <CRON_SECRET>`.
 * Fail-closed: sin secret configurado → 503; header ausente/incorrecto → 401.
 */
export function checkCronAuth(
  authorizationHeader: string | null | undefined,
  secret: string | undefined = process.env.CRON_SECRET,
): CronAuthResult {
  const s = secret?.trim();
  if (!s) {
    return { ok: false, status: 503, error: "CRON_SECRET no configurado (fail-closed)" };
  }
  if (!timingSafeStringEqual(authorizationHeader ?? "", `Bearer ${s}`)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

/**
 * Guard drop-in para route handlers: devuelve la respuesta de error (503/401)
 * o `null` si la request está autorizada. Incluye `ok` y `success` en el body
 * para preservar los dos shapes de error históricos de los endpoints migrados.
 */
export function requireCronAuth(req: Request, secret?: string): NextResponse | null {
  const r = checkCronAuth(req.headers.get("authorization"), secret);
  if (r.ok) return null;
  return NextResponse.json(
    { ok: false, success: false, error: r.error },
    { status: r.status },
  );
}

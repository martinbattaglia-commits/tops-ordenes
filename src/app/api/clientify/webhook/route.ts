import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/clientify/webhook  (SIN token) — DESHABILITADO.
 *
 * El handler real es tokenizado: `POST /api/clientify/webhook/[token]` (F2.2-2),
 * con autenticación por token-en-URL (Clientify no firma → no HMAC). Este endpoint
 * sin token ya NO procesa nada: existía como placeholder y se cierra para no dejar
 * una puerta de ingesta sin autenticar.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Usá la URL tokenizada: POST /api/clientify/webhook/<token>" },
    { status: 404 },
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "Webhook de Clientify. El endpoint activo es POST /api/clientify/webhook/<token>.",
  });
}

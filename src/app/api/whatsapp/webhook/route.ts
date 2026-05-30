import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/webhook — verificación inicial de Meta
 * POST /api/whatsapp/webhook — recibe eventos (mensajes entrantes, statuses)
 *
 * Configuración:
 *  1. En Meta Developers → tu app → WhatsApp → Configuration
 *  2. Webhook URL: https://nexus.logisticatops.com/api/whatsapp/webhook
 *  3. Verify Token: el valor de META_WA_WEBHOOK_VERIFY_TOKEN (lo elegís)
 *  4. Subscribir a: messages, message_status (mínimo)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = process.env.META_WA_WEBHOOK_VERIFY_TOKEN ?? "nexus-tops-verify";

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // Estructura típica: { object: "whatsapp_business_account", entry: [{ id, changes: [...] }] }
  console.info("[whatsapp] webhook recibido", JSON.stringify(body).slice(0, 500));

  // TODO F3: persistir mensajes entrantes, actualizar status de mensajes enviados,
  //   marcar OC como "leída por proveedor" cuando hay read receipt, etc.

  return NextResponse.json({ ok: true, received: true });
}

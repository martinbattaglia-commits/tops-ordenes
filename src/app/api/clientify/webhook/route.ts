import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/clientify/webhook
 *
 * Placeholder para recibir webhooks de Clientify (deal moved, contact updated, etc.).
 *
 * En F2.7 se conecta:
 *  - Verificación de firma (Clientify firma con HMAC compartido)
 *  - Persistencia del evento en `clientify_webhook_events`
 *  - Invalidación de cache UI (revalidatePath)
 *  - Triggers de automatizaciones (notificar a Ruth/JL si un deal pasa a "Ganado")
 *
 * Configuración pendiente:
 *  1. En app.clientify.com → Settings → Webhooks → agregar URL:
 *     `https://nexus.logisticatops.com/api/clientify/webhook`
 *  2. Setear env var `CLIENTIFY_WEBHOOK_SECRET` con el secret compartido.
 *  3. Implementar verificación HMAC en este handler.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  // TODO F2.7: verificar firma HMAC
  // const sig = req.headers.get("x-clientify-signature");
  // if (!verifySignature(body, sig, env.clientify.webhookSecret)) return 401

  console.info("[clientify] webhook recibido", {
    event: body?.event,
    objectType: body?.object_type,
    objectId: body?.object_id,
    receivedAt: new Date().toISOString(),
  });

  // TODO F2.7: persistir evento + invalidar cache + disparar automatizaciones
  return NextResponse.json({ ok: true, received: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "Webhook endpoint de Clientify. Configurá la URL en app.clientify.com → Settings → Webhooks",
    method: "POST",
  });
}

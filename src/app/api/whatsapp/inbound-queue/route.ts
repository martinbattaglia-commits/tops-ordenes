import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { consumeInboundBatch } from "@/lib/whatsapp/inbound-consumer";
import { createSupabaseInboundConsumerPorts } from "@/lib/whatsapp/inbound-consumer.supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/whatsapp/inbound-queue — LINK-WA WA-8R9 · M-4.
 *
 * Drena la cola durable de `wa_inbound_events`: los eventos que el webhook
 * recibió y contestó con HTTP 200 pero cuya proyección no se completó.
 *
 * Por qué existe: el webhook DEBE responder 200 aunque la proyección falle —un
 * 5xx haría que Meta reintente en bucle por un problema que no es suyo—, así
 * que el evento queda `processed = false`. Sin este consumidor nadie volvía a
 * mirarlo y el hecho de Meta se perdía sin dejar error en ningún lado.
 *
 * Auth FAIL-CLOSED vía `requireCronAuth()`: 503 sin `CRON_SECRET` configurado,
 * 401 con Bearer inválido (comparación timing-safe). No hay camino anónimo.
 *
 * La activación programada (cron externo) es un gate de deploy aparte: este
 * endpoint es idempotente y se puede invocar a mano sin riesgo.
 *
 * La respuesta lleva SÓLO contadores y códigos de error saneados. Nunca
 * payloads, teléfonos, texto de terceros ni wamids: la tabla que drena contiene
 * PII de terceros y esta respuesta queda en logs.
 */
async function handle(req: Request): Promise<Response> {
  const auth = await requireCronAuth(req);
  if (auth) return auth;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { success: false, error: "SERVICE_UNAVAILABLE: sin cliente de servicio." },
      { status: 503 },
    );
  }

  // Tamaño de lote acotado: el endpoint es idempotente y se vuelve a invocar.
  // Un lote sin techo convertiría una cola larga en un timeout.
  const url = new URL(req.url);
  const crudo = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  const limit = Number.isFinite(crudo) ? Math.min(Math.max(crudo, 1), 100) : 25;

  try {
    const resultado = await consumeInboundBatch(
      createSupabaseInboundConsumerPorts(admin as never),
      limit,
    );
    return NextResponse.json({ success: true, ...resultado });
  } catch (e) {
    // Nunca se filtra el mensaje crudo: podría arrastrar contenido del evento.
    return NextResponse.json(
      { success: false, error: "CONSUMER_ERROR", detail: e instanceof Error ? e.name : "unknown" },
      { status: 502 },
    );
  }
}

export const POST = handle;
export const GET = handle;

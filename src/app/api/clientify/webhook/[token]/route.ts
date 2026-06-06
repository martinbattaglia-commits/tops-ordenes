import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyWebhookToken, normalizeLead } from "@/lib/clientify/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/clientify/webhook/[token]
 *
 * Handler real del webhook de Clientify (F2.2-2). Inbound-only.
 *
 * Seguridad: Clientify NO firma sus webhooks → autenticación por **token-en-URL**
 * (path), comparado timing-safe contra CLIENTIFY_WEBHOOK_SECRET. Ver
 * docs/comercial/CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md.
 *
 * Flujo: verifica token → normaliza payload → crm_ingest_lead (service-role).
 * Idempotencia y dedup viven en la RPC (clientify_id unique). Sin write-back.
 *
 * Códigos: 401 token inválido · 400 JSON inválido · 200 ok/skipped ·
 *          502 error transitorio (Clientify reintenta) · 503 no configurado.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  // 1 · Autenticación por token-en-URL (fail-closed)
  if (!verifyWebhookToken(params.token)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 2 · Cuerpo crudo → JSON
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // 3 · Normalización (sin identidad mínima → skip, 200, sin reintentos)
  const norm = normalizeLead(body);
  if (!norm) {
    console.info("[clientify] webhook skipped (sin identidad)", { receivedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true, skipped: true, reason: "no_identity" });
  }

  // 4 · Persistencia vía RPC (service-role; la RPC es SECURITY DEFINER)
  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase service-role no configurado" }, { status: 503 });
  }

  try {
    const { data, error } = await supabase.rpc("crm_ingest_lead", {
      p_lead: norm.lead,
      p_raw: body,
      p_event: norm.event,
    });

    if (error) {
      // Error de DB → best-effort log + 502 para que Clientify reintente.
      console.error("[clientify] webhook ingest error", error.message);
      await supabase.from("clientify_sync_log").insert({
        direction: "inbound", entity: "lead", clientify_id: norm.lead.clientify_id,
        event: norm.event, status: "error", error: error.message, payload: body as object,
      }).then(() => {}, () => {});
      return NextResponse.json({ ok: false, error: "ingest_failed" }, { status: 502 });
    }

    const result = (data ?? {}) as { action?: string; lead_id?: string };
    console.info("[clientify] webhook ingest ok", {
      event: norm.event, action: result.action, leadId: result.lead_id,
    });
    return NextResponse.json({ ok: true, action: result.action ?? null, leadId: result.lead_id ?? null });
  } catch (e) {
    console.error("[clientify] webhook unexpected error", e);
    return NextResponse.json({ ok: false, error: "ingest_exception" }, { status: 502 });
  }
}

/** GET → no expone si el token es válido; solo método permitido. */
export async function GET() {
  return NextResponse.json({ ok: true, info: "Clientify webhook endpoint. Use POST." });
}

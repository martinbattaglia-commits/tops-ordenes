import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyMetaSignature, verifyMetaVerifyToken } from "@/lib/whatsapp/webhook";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/webhook — verificación inicial de Meta (handshake).
 * POST /api/whatsapp/webhook — recibe eventos (mensajes entrantes, statuses).
 *
 * F4.4-E2/E3 (cierra el TODO F3 y el hallazgo A08 de la auditoría):
 *  - POST verifica `X-Hub-Signature-256` (HMAC-SHA256 del body CRUDO con
 *    META_WA_APP_SECRET) ANTES de parsear. Fail-closed: sin secret → 503;
 *    firma ausente/ inválida → 401 + fila de auditoría del rechazo.
 *  - GET fail-closed: se eliminó el default hardcodeado del verify token.
 *  - Persistencia sandbox: eventos firmados se guardan CRUDOS en
 *    `wa_inbound_events` (mig 0171, RLS deny-all, solo service_role) sin
 *    parsing de negocio. La tabla ES la auditoría del canal.
 *  - PII: el body ya NO se loguea (contiene teléfonos y texto de terceros).
 *
 * Configuración (panel Meta Developers → app → WhatsApp → Configuration):
 *  1. Webhook URL: https://nexus.logisticatops.com/api/whatsapp/webhook
 *  2. Verify Token: valor de META_WA_WEBHOOK_VERIFY_TOKEN
 *  3. App Secret: valor de META_WA_APP_SECRET (Settings → Basic)
 *  4. Subscribir a: messages, message_status (mínimo)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const configured = process.env.META_WA_WEBHOOK_VERIFY_TOKEN;

  if (!configured?.trim()) {
    // Fail-closed: sin token configurado no hay handshake (antes caía a un
    // default hardcodeado conocido públicamente en el repo).
    return NextResponse.json(
      { ok: false, error: "META_WA_WEBHOOK_VERIFY_TOKEN no configurado (fail-closed)" },
      { status: 503 },
    );
  }
  if (mode === "subscribe" && challenge && verifyMetaVerifyToken(token, configured)) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
}

export async function POST(req: Request) {
  // Body CRUDO antes de cualquier parse — la firma es sobre los bytes exactos.
  const raw = await req.text();
  const result = verifyMetaSignature(
    raw,
    req.headers.get("x-hub-signature-256"),
    process.env.META_WA_APP_SECRET,
  );

  if (!result.valid) {
    if (result.reason === "no_secret") {
      // Misconfig visible: el canal no procesa NADA sin App Secret.
      return NextResponse.json(
        { ok: false, error: "META_WA_APP_SECRET no configurado (fail-closed)" },
        { status: 503 },
      );
    }
    // Anti-flood (fix adversarial F4.4): el endpoint es público — sin límite,
    // un atacante convierte cada POST basura en un insert de audit_log. El 401
    // se responde SIEMPRE; solo se muestrea la auditoría (10/min por instancia).
    if (rateLimit("whatsapp-webhook-audit", { limit: 10, windowMs: 60_000 }).ok) {
      await auditSignatureRejection(result.reason);
    }
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { _unparseable: true, _length: raw.length };
  }

  // Persistencia best-effort: si la mig 0171 aún no está aplicada, el evento
  // se pierde con error logueado pero Meta recibe 200 (evita que deshabilite
  // el webhook por reintentos fallidos).
  let persisted = false;
  const admin = createAdminClient();
  if (admin) {
    const { error } = await admin
      .from("wa_inbound_events")
      .insert({ payload, signature_valid: true });
    if (error) {
      console.error("[whatsapp] wa_inbound_events insert falló:", error.message);
    } else {
      persisted = true;
    }
  }

  return NextResponse.json({ ok: true, received: true, persisted });
}

/** Auditoría del rechazo (sin firma, sin body, sin PII — solo la razón). */
async function auditSignatureRejection(reason: string): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;
    await admin.from("audit_log").insert({
      entity: "whatsapp_webhook",
      entity_id: null,
      action: "signature_rejected",
      payload: { reason },
    });
  } catch (e) {
    console.error("[whatsapp] audit de rechazo falló:", e instanceof Error ? e.message : e);
  }
}

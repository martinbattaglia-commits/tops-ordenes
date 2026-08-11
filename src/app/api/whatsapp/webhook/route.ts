import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyMetaSignature, verifyMetaVerifyToken } from "@/lib/whatsapp/webhook";
import { parseInboundPayload } from "@/lib/whatsapp/inbound";
import { parseOperatorProfileIds } from "@/lib/whatsapp/operators";
import { projectInbound } from "@/lib/whatsapp/link-projection";
import { createSupabaseProjectionPort } from "@/lib/whatsapp/link-projection.supabase";
import { handleInboundEvent, type InboundPorts } from "@/lib/whatsapp/inbound-core";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/webhook — handshake de verificación de Meta.
 * POST /api/whatsapp/webhook — eventos entrantes (mensajes y statuses).
 *
 * 1B-1B: la orquestación vive en `inbound-core.ts` (pura y testeable con
 * fakes). Esta route es sólo el adaptador: lee el body CRUDO, cablea los
 * puertos contra Supabase/env y traduce `{status, body}` a `NextResponse`.
 *
 * Configuración (Meta Developers → app → WhatsApp → Configuration):
 *  1. Webhook URL: https://nexus.logisticatops.com/api/whatsapp/webhook
 *  2. Verify Token: META_WA_WEBHOOK_VERIFY_TOKEN
 *  3. App Secret: META_WA_APP_SECRET
 *  4. Suscribir: messages, message_status
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const configured = process.env.META_WA_WEBHOOK_VERIFY_TOKEN;

  if (!configured?.trim()) {
    // Fail-closed: sin token configurado no hay handshake.
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
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature-256");

  const result = await handleInboundEvent({ rawBody, signatureHeader }, buildPorts());
  return NextResponse.json(result.body, { status: result.status });
}

/** Cableado productivo de los puertos. No decide nada: sólo conecta. */
function buildPorts(): InboundPorts {
  const admin = createAdminClient();

  return {
    verifySignature: (raw, header) =>
      verifyMetaSignature(raw, header, process.env.META_WA_APP_SECRET),

    parsePayload: (payload) => parseInboundPayload(payload, process.env.META_WA_PHONE_NUMBER_ID),

    store: {
      async persist(payload) {
        if (!admin) return null;
        const { data, error } = await admin
          .from("wa_inbound_events")
          .insert({ payload, signature_valid: true })
          .select("seq")
          .maybeSingle();
        if (error || data?.seq == null) return null;
        return Number(data.seq);
      },
      // R7 · una marca que no actualizó exactamente una fila NO acredita nada:
      // lanza, y el core la traduce en evento pendiente (nunca processed:true).
      async markProcessed(seq, notes) {
        if (!admin) throw new Error("sin service client");
        const { data, error } = await admin
          .from("wa_inbound_events")
          .update({ processed: true, notes: notes.slice(0, 500) })
          .eq("seq", seq)
          .select("seq");
        if (error || (data ?? []).length !== 1) {
          throw new Error("mark_processed_row_count");
        }
      },
      async markPending(seq, notes) {
        if (!admin) throw new Error("sin service client");
        // `processed` permanece false: cola durable de reconciliación.
        const { data, error } = await admin
          .from("wa_inbound_events")
          .update({ processed: false, notes: `PENDING ${notes}`.slice(0, 500) })
          .eq("seq", seq)
          .select("seq");
        if (error || (data ?? []).length !== 1) {
          throw new Error("mark_pending_row_count");
        }
      },
    },

    async project(input) {
      if (!admin) throw new Error("sin service client");
      const operators = parseOperatorProfileIds();
      return projectInbound(input, createSupabaseProjectionPort(admin), operators.ids);
    },

    async auditSignatureRejection(reason) {
      if (!admin) return;
      await admin.from("audit_log").insert({
        entity: "whatsapp_webhook",
        entity_id: null,
        action: "signature_rejected",
        payload: { reason },
      });
    },

    // Anti-flood: el endpoint es público; el 401 se responde siempre pero la
    // auditoría se muestrea para que un atacante no genere inserts a voluntad.
    shouldAuditRejection: () =>
      rateLimit("whatsapp-webhook-audit", { limit: 10, windowMs: 60_000 }).ok,

    logger: {
      error: (message) => console.error("[whatsapp]", message),
      warn: (message) => console.warn("[whatsapp]", message),
    },
  };
}

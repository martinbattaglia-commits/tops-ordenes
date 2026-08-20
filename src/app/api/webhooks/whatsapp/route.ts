import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyMetaHmacSignature } from "@/lib/whatsapp/hmac";
import { parseInboundPayload } from "@/lib/whatsapp/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handshake GET — Verificación de Webhook Meta WhatsApp Cloud API.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const verifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_WA_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken?.trim()) {
    return NextResponse.json(
      { ok: false, error: "WHATSAPP_VERIFY_TOKEN no configurado (fail-closed)" },
      { status: 503 }
    );
  }

  if (mode === "subscribe" && challenge && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
}

/**
 * Ingesta POST — Procesamiento idempotente y seguro de mensajes y eventos de WhatsApp.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature-256");

  const secret = process.env.WHATSAPP_APP_SECRET || process.env.META_WA_APP_SECRET;

  // Validación de firma HMAC-SHA256 (Abortar con 401 si no coincide)
  if (!verifyMetaHmacSignature(rawBody, signatureHeader, secret ?? "")) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const phoneId =
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    process.env.META_WA_PHONE_NUMBER_ID ||
    "default";

  // Intentar parseo normalizado de payload de Meta
  const parsed = parseInboundPayload(body, phoneId);

  if (!parsed.ok && parsed.reason === "tenant_mismatch") {
    return NextResponse.json({ ok: false, error: "Tenant mismatch" }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, status: "dry_run" }, { status: 200 });
  }

  // Extraer mensajes entrantes normalizados
  const messages = parsed.ok ? parsed.messages : [];
  let processedCount = 0;

  for (const msg of messages) {
    const wamId = msg.wamid;
    const phoneFormatted = msg.fromE164.replace(/\D/g, "");

    // Deduplicación por external_msg_id (wamId)
    if (wamId) {
      const { data: existingMsg } = await supabase
        .from("connect_messages")
        .select("id")
        .eq("external_msg_id", wamId)
        .maybeSingle();

      if (existingMsg) {
        continue;
      }
    }

    const candidates = [`wa:${phoneFormatted}`, `wa:+${phoneFormatted}`, phoneFormatted, `+${phoneFormatted}`];
    let conversationId: string | null = null;
    let handoverState = "BOT_ACTIVE";

    const { data: existingConv } = await supabase
      .from("connect_conversations")
      .select("id, handover_state")
      .eq("kind", "whatsapp")
      .in("context_id", candidates)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
      handoverState = existingConv.handover_state ?? "BOT_ACTIVE";
    } else {
      const { data: newConv } = await supabase
        .from("connect_conversations")
        .insert({
          kind: "whatsapp",
          context_id: `wa:${phoneFormatted}`,
          title: `WhatsApp ${phoneFormatted}`,
          handover_state: "BOT_ACTIVE",
        })
        .select("id")
        .single();

      if (newConv) {
        conversationId = newConv.id;
      }
    }

    if (conversationId) {
      // Inserción en connect_messages
      await supabase.from("connect_messages").insert({
        conversation_id: conversationId,
        kind: msg.media ? "audio" : "text",
        body: msg.text,
        external_msg_id: wamId,
        meta: { direction: "inbound", media: msg.media, profileName: msg.profileName },
        created_at: msg.sentAt,
      });

      // Actualizar last_message_at en connect_conversations (abre la ventana de 24h en verde)
      await supabase
        .from("connect_conversations")
        .update({
          last_message_at: msg.sentAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);

      processedCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: processedCount,
  }, { status: 200 });
}

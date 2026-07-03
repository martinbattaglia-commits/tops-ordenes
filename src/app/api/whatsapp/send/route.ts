import { NextResponse } from "next/server";
import { sendText, sendTemplate, templates, isWhatsappConfigured } from "@/lib/whatsapp/meta";
import { requireCronAuth } from "@/lib/cron-auth";
import { checkOutboundAllowed, normalizeMsisdn } from "@/lib/whatsapp/sandbox";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/send
 *
 * Body:
 *   { kind: "text", to: "5491131079124", text: "..." }
 *   { kind: "template", to: "...", template: "hello_world", language: "en_US" }
 *   { kind: "oc_firmada", to: "...", publicId: "OC-2026-0349", total: "$ 18.948.600", pdfUrl: "..." }
 *
 * F4.4-E2/E3 (D-F44-3):
 *  - Auth FAIL-CLOSED: exige `Authorization: Bearer <CRON_SECRET>` siempre
 *    (503 sin secret configurado, 401 credencial inválida, timing-safe).
 *    Cambio declarado vs F3: antes era "opcional si CRON_SECRET existía";
 *    ningún módulo interno llama a este endpoint (verificado por grep).
 *  - SANDBOX (default ON): mientras WHATSAPP_SANDBOX != "0", solo se permite
 *    enviar a números de WHATSAPP_SANDBOX_ALLOWLIST (internos). Destino fuera
 *    de la lista → 403 + auditoría. Pasar a "0" = decisión de Dirección (F5).
 */
export async function POST(req: Request) {
  // Separación de privilegios opcional (fix adversarial F4.4): si Dirección
  // define WHATSAPP_SEND_SECRET, este endpoint deja de compartir credencial
  // con los crons de sync. Sin la var, sigue siendo CRON_SECRET (fail-closed).
  const denied = requireCronAuth(req, process.env.WHATSAPP_SEND_SECRET ?? process.env.CRON_SECRET);
  if (denied) return denied;

  if (!isWhatsappConfigured()) {
    return NextResponse.json(
      { ok: false, error: "WhatsApp no configurado" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.kind || !body.to) {
    return NextResponse.json(
      { ok: false, error: "Body inválido: requiere { kind, to, ... }" },
      { status: 400 }
    );
  }

  // Fix adversarial F4.4: se valida y se ENVÍA el mismo valor normalizado
  // (antes se validaba String(body.to) pero se enviaba body.to crudo; además
  // un number crudo rompía normalizePhone en meta.ts → 500).
  const to = normalizeMsisdn(String(body.to));
  if (!to) {
    return NextResponse.json(
      { ok: false, error: "`to` inválido: se espera un número E.164 (solo dígitos)" },
      { status: 400 }
    );
  }
  const decision = checkOutboundAllowed(to);
  if (!decision.allowed) {
    await auditSandboxRejection(String(body.kind));
    return NextResponse.json(
      {
        ok: false,
        error:
          "Destino fuera de la allowlist sandbox (WHATSAPP_SANDBOX activo). " +
          "Agregar el número interno a WHATSAPP_SANDBOX_ALLOWLIST o (F5, Dirección) desactivar sandbox.",
      },
      { status: 403 }
    );
  }

  try {
    let result;
    switch (body.kind) {
      case "text":
        result = await sendText({ to, text: body.text });
        break;
      case "template":
        result = await sendTemplate({
          to,
          template: body.template,
          language: body.language,
          components: body.components,
        });
        break;
      case "oc_firmada":
        result = await templates.ocFirmada({
          to,
          publicId: body.publicId,
          total: body.total,
          pdfUrl: body.pdfUrl,
        });
        break;
      case "hello_world":
        result = await templates.helloWorld(to);
        break;
      default:
        return NextResponse.json(
          { ok: false, error: `kind no soportado: ${body.kind}` },
          { status: 400 }
        );
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/** Auditoría del rechazo sandbox (mínimo dato: kind del intento, sin número ni contenido). */
async function auditSandboxRejection(kind: string): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;
    await admin.from("audit_log").insert({
      entity: "whatsapp_send",
      entity_id: null,
      action: "sandbox_rejected",
      payload: { reason: "destination_not_allowlisted", kind },
    });
  } catch (e) {
    console.error("[whatsapp] audit de rechazo sandbox falló:", e instanceof Error ? e.message : e);
  }
}

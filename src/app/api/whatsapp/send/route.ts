import { NextResponse } from "next/server";
import { sendText, sendTemplate, templates, isWhatsappConfigured } from "@/lib/whatsapp/meta";

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
 * Auth: opcional con `Authorization: Bearer <CRON_SECRET>` para llamadas
 * externas. Sin auth: solo desde sesión interna (middleware).
 */
export async function POST(req: Request) {
  if (!isWhatsappConfigured()) {
    return NextResponse.json(
      { ok: false, error: "WhatsApp no configurado" },
      { status: 503 }
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.kind || !body.to) {
    return NextResponse.json(
      { ok: false, error: "Body inválido: requiere { kind, to, ... }" },
      { status: 400 }
    );
  }

  try {
    let result;
    switch (body.kind) {
      case "text":
        result = await sendText({ to: body.to, text: body.text });
        break;
      case "template":
        result = await sendTemplate({
          to: body.to,
          template: body.template,
          language: body.language,
          components: body.components,
        });
        break;
      case "oc_firmada":
        result = await templates.ocFirmada({
          to: body.to,
          publicId: body.publicId,
          total: body.total,
          pdfUrl: body.pdfUrl,
        });
        break;
      case "hello_world":
        result = await templates.helloWorld(body.to);
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

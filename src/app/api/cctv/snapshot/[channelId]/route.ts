import { NextResponse } from "next/server";
import { getSnapshot, HikvisionError } from "@/lib/cctv/hikvision";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cctv/snapshot/[channelId]
 *
 * Proxy de snapshot JPEG desde el NVR Hikvision. El channelId sigue
 * el formato {N}0{S} (ej "101", "302", "1602"). Stream main por default.
 *
 * Cache: 5 segundos en cliente (las cámaras se refrescan en grid pero
 * no necesitamos hammer al NVR). Tipo: image/jpeg.
 *
 * Auth: requiere sesión interna (middleware aplica). En F3 se puede
 * abrir un endpoint público con tokens cortos para mostrar snapshots
 * en QR de validación de operaciones.
 */
export async function GET(_req: Request, { params }: { params: { channelId: string } }) {
  if (!env.hikvision.configured) {
    return NextResponse.json({ ok: false, error: "Hikvision NVR no configurado" }, { status: 503 });
  }

  // Sanitize: solo dígitos, 3-4 dígitos
  const channelId = params.channelId.replace(/\D/g, "").slice(0, 4);
  if (!/^\d{3,4}$/.test(channelId)) {
    return NextResponse.json({ ok: false, error: "channelId inválido" }, { status: 400 });
  }

  try {
    const jpeg = await getSnapshot(channelId);
    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=5",
      },
    });
  } catch (e) {
    if (e instanceof HikvisionError) {
      return NextResponse.json(
        { ok: false, error: e.message, status: e.status, path: e.path },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 }
      );
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

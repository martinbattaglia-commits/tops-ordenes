import { NextResponse } from "next/server";
import { ping as hikvisionPing, HikvisionError } from "@/lib/cctv/hikvision";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cctv/ping
 *
 * Diagnóstico del NVR Hikvision: device info + lista de canales.
 * Si todo está OK responde 200 con counts, deviceName, model y firmware.
 */
export async function GET() {
  if (!env.hikvision.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: "HIKVISION_HOST/USER/PASSWORD no configurados",
        hint: "Setealo en .env.local o en Netlify Env Vars",
      },
      { status: 503 }
    );
  }

  try {
    const result = await hikvisionPing();
    return NextResponse.json({
      ...result,
      checkedAt: new Date().toISOString(),
      endpoint: `${env.hikvision.useHttps ? "https" : "http"}://${env.hikvision.host}:${env.hikvision.useHttps ? env.hikvision.httpsPort : env.hikvision.httpPort}`,
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

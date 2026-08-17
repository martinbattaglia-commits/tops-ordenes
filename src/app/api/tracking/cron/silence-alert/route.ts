import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { sendOneOrderEmail } from "@/lib/email";
import {
  evaluateTrackingSilence,
  trackingSilenceThresholdHours,
  TRACKING_SILENCE_RECIPIENTS,
} from "@/lib/tracking/silence-alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET|POST /api/tracking/cron/silence-alert
 *
 * Cron diario: si hace más de `TRACKING_SILENCE_THRESHOLD_HOURS` (default 24)
 * que no entra una posición, manda un correo a los destinatarios fijos. Si hay
 * datos frescos no hace nada.
 *
 * Molde: `/api/connect/cron/dispatch-outbox`. Fail-closed vía `requireCronAuth`
 * (503 sin CRON_SECRET · 401 Bearer inválido · timing-safe).
 *
 * Sin estado: no registra "ya avisé". Una corrida por día ⇒ un correo por día
 * mientras dure el silencio.
 */
async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  // Una sola consulta: la última recepción de TODA la flota.
  const { data, error } = await supabase
    .from("fleet_positions")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "FLEET_POSITIONS_QUERY_FAILED" },
      { status: 502 },
    );
  }

  const evaluation = evaluateTrackingSilence({
    lastCreatedAt: (data as { created_at?: string } | null)?.created_at ?? null,
    nowMs: Date.now(),
    thresholdHours: trackingSilenceThresholdHours(),
  });

  if (!evaluation.alert) {
    return NextResponse.json({
      ok: true,
      alerted: false,
      last_at: evaluation.lastAt,
      hours_silent: Math.round(evaluation.hoursSilent * 10) / 10,
    });
  }

  // Clave de idempotencia por día y destinatario: si el cron se dispara dos
  // veces el mismo día (reintento manual), Resend no duplica el correo.
  const dia = new Date().toISOString().slice(0, 10);
  const envios = await Promise.all(
    TRACKING_SILENCE_RECIPIENTS.map(async (to) => {
      const r = await sendOneOrderEmail({
        to,
        subject: evaluation.subject,
        html: evaluation.html,
        text: evaluation.text,
        idempotencyKey: `tracking-silence-${dia}-${to}`,
      });
      return { to, ok: r.ok, skipped: r.skipped === true };
    }),
  );

  return NextResponse.json({
    ok: envios.every((e) => e.ok),
    alerted: true,
    last_at: evaluation.lastAt,
    hours_silent:
      evaluation.hoursSilent == null
        ? null
        : Math.round(evaluation.hoursSilent * 10) / 10,
    sent: envios.filter((e) => e.ok && !e.skipped).length,
    skipped: envios.filter((e) => e.skipped).length,
  });
}

export const GET = handle;
export const POST = handle;

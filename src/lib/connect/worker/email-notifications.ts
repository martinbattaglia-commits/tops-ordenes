import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { hrefFor } from "@/lib/notifications/href";

/**
 * email-notifications.ts — LINK-NOTIFY-001 · F1 EMAIL MVP.
 *
 * Tercer procesador del cron dispatch-outbox (tras drenado + automatizaciones):
 * consume public.notifications (que los triggers 0161/0165/0169/0172/0205 ya
 * pueblan POR DESTINATARIO) y envía email vía Resend para lo que "requiere
 * acción" (regla F1 de Dirección). No toca outbox, triggers ni campana.
 *
 * Garantías:
 *  · Kill-switch: NOTIFY_EMAIL_ENABLED !== "1" ⇒ no-op total.
 *  · Allowlist (ventana D3): NOTIFY_EMAIL_ALLOWLIST no vacía ⇒ sólo esos emails.
 *  · Idempotencia: claim por UNIQUE(notification_id) en notification_email_sends
 *    (0207) — quien inserta, envía; doble corrida NO duplica.
 *  · Sin auto-retry (F1): 'error'/'claimed' huérfano quedan auditados, no se
 *    reintentan — el aviso sigue en la campana; se prefiere no duplicar.
 *  · Sin PII: asunto/cuerpo = título de la notificación + deep-link al ERP.
 */

const WINDOW_HOURS = 48; // la activación no dispara el histórico
const BATCH = 25; // techo de envíos por corrida (anti-ráfaga)

export interface EmailRunSummary {
  enabled: boolean;
  candidates: number;
  sent: number;
  errors: number;
  skippedAllowlist: number;
  skippedClaimed: number;
}

interface NotificationRow {
  id: string;
  user_id: string | null;
  kind: string | null;
  priority: string | null;
  title: string | null;
  entity: string | null;
  entity_id: string | null;
  read_at: string | null;
}

/** Regla F1 (resolución 07-26): email = requiere acción. */
export function isEligibleNotification(n: {
  kind: string | null;
  priority: string | null;
  title: string | null;
  read_at: string | null;
}): boolean {
  if (n.read_at) return false; // ya visto en la campana ⇒ sin correo
  if (n.kind === "connect_mention") return true;
  if (n.kind === "connect_task" || n.kind === "connect_incident") {
    if (n.priority === "high" || n.priority === "urgent") return true;
    // Asignaciones de cualquier prioridad — título literal de 0165/0169
    // (heurística MVP declarada en el plan; falla conservador: nunca spamea de más).
    if ((n.title ?? "").startsWith("Te asignaron:")) return true;
  }
  return false;
}

/** Template mínimo: título + botón deep-link. El contenido vive en el ERP. */
export function buildNotificationEmail(n: {
  title: string | null;
  entity: string | null;
  entity_id: string | null;
}): { subject: string; html: string } {
  const title = (n.title ?? "Notificación de NEXUS").slice(0, 140);
  const url = `${env.app.url}${hrefFor(n.entity, n.entity_id)}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f7f8fb;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;border:1px solid #e5e8ef">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.14em;color:#c90812;font-weight:bold">NEXUS LINK</p>
      <p style="margin:0 0 16px;font-size:16px;color:#101828;font-weight:bold">${escapeHtml(title)}</p>
      <a href="${url}"
         style="display:inline-block;background:#c90812;color:#ffffff;text-decoration:none;font-weight:bold;font-size:13px;padding:10px 18px;border-radius:6px">
        Abrir en NEXUS
      </a>
      <p style="margin:20px 0 0;font-size:11px;color:#5a6577">
        Aviso automático de TOPS NEXUS · Logística TOPS (Verotin S.A.). El detalle completo está en el sistema.
      </p>
    </div>
  </div>`;
  return { subject: title, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseAllowlist(): Set<string> | null {
  const raw = (process.env.NOTIFY_EMAIL_ALLOWLIST ?? "").trim();
  if (!raw) return null; // vacía = sin restricción (sólo post-GO de rollout)
  return new Set(
    raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
}

export async function emailNotificationProcessor(): Promise<EmailRunSummary> {
  const summary: EmailRunSummary = {
    enabled: false, candidates: 0, sent: 0, errors: 0,
    skippedAllowlist: 0, skippedClaimed: 0,
  };
  if (process.env.NOTIFY_EMAIL_ENABLED !== "1") return summary;
  summary.enabled = true;

  const supabase = createAdminClient();
  if (!supabase) return summary;
  if (!env.email.resendKey) return summary; // sin key ⇒ dormido (patrón OS)

  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  const { data: rows, error } = await supabase
    .from("notifications")
    .select("id, user_id, kind, priority, title, entity, entity_id, read_at")
    .in("kind", ["connect_mention", "connect_task", "connect_incident"])
    .is("read_at", null)
    .not("user_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error || !rows) {
    if (error) console.error("[notify/email] query error:", error.message);
    return summary;
  }

  const eligible = (rows as NotificationRow[]).filter(isEligibleNotification);
  if (eligible.length === 0) return summary;

  // Descartar las ya procesadas (una sola query) — el claim UNIQUE re-verifica igual.
  const { data: doneRows } = await supabase
    .from("notification_email_sends")
    .select("notification_id")
    .in("notification_id", eligible.map((n) => n.id));
  const done = new Set(((doneRows ?? []) as Array<{ notification_id: string }>)
    .map((r) => r.notification_id));
  const todo = eligible.filter((n) => !done.has(n.id));
  summary.candidates = todo.length;
  if (todo.length === 0) return summary;

  // Emails de destinatarios (profiles.email; sin exponer nada al cliente — service_role).
  const userIds = Array.from(new Set(todo.map((n) => n.user_id!)));
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", userIds);
  const emailByUser = new Map(
    ((profs ?? []) as Array<{ id: string; email: string | null }>)
      .filter((p) => p.email)
      .map((p) => [p.id, p.email!.toLowerCase()]),
  );

  const allowlist = parseAllowlist();
  const from = process.env.NOTIFY_EMAIL_FROM ?? "TOPS NEXUS <notificaciones@logisticatops.com>";

  for (const n of todo.slice(0, BATCH)) {
    const to = emailByUser.get(n.user_id!);
    if (!to) continue;
    if (allowlist && !allowlist.has(to)) {
      summary.skippedAllowlist += 1;
      continue; // NO se reclama: si la allowlist se abre luego, sigue elegible (ventana 48 h)
    }

    // CLAIM idempotente: sólo quien logra insertar envía.
    const { data: claimed, error: claimErr } = await supabase
      .from("notification_email_sends")
      .upsert(
        { notification_id: n.id, to_email: to, status: "claimed" },
        { onConflict: "notification_id", ignoreDuplicates: true },
      )
      .select("id");
    if (claimErr) {
      console.error("[notify/email] claim error:", claimErr.message);
      summary.errors += 1;
      continue;
    }
    if (!claimed || claimed.length === 0) {
      summary.skippedClaimed += 1; // otro worker lo tomó
      continue;
    }

    const { subject, html } = buildNotificationEmail(n);
    let status: "sent" | "error" = "sent";
    let providerId: string | null = null;
    let errText: string | null = null;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.email.resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
      });
      if (res.ok) {
        providerId = ((await res.json()) as { id?: string }).id ?? null;
      } else {
        status = "error";
        errText = (await res.text().catch(() => "")) || `HTTP ${res.status}`;
      }
    } catch (e) {
      status = "error";
      errText = e instanceof Error ? e.message : String(e);
    }

    await supabase
      .from("notification_email_sends")
      .update({
        status,
        provider_id: providerId,
        error: errText,
        updated_at: new Date().toISOString(),
      })
      .eq("notification_id", n.id);

    if (status === "sent") summary.sent += 1;
    else {
      summary.errors += 1;
      console.error(`[notify/email] envío fallido (${n.id}):`, errText);
    }
  }

  return summary;
}

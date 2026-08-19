/**
 * inbound.ts — LINK-WA S1 · Normalización del payload inbound de Meta Cloud API.
 *
 * Función PURA: entra el payload ya verificado por HMAC (webhook.ts) y salen
 * mensajes y estados normalizados. Sin red, sin Supabase, sin env obligatoria
 * (el phone_number_id del tenant se inyecta) ⇒ testeable con fixtures sintéticas.
 *
 * Mapeo cuenta/número → tenant (requisito de Dirección): el `phone_number_id`
 * del evento DEBE coincidir exactamente con el número comercial configurado.
 * Fail-closed: sin configuración ⇒ `tenant_unresolved`; distinto ⇒
 * `tenant_mismatch`. En ninguno de los dos casos se proyecta nada: un evento de
 * otra cuenta jamás puede escribir en este tenant.
 *
 * Alcance S1: sólo mensajes de TEXTO. El resto se cuenta como `skipped` y queda
 * en `wa_inbound_events` (crudo) para fases posteriores.
 */

import {
  describeUnsupported, extractInboundCaption, extractInboundMedia, inboundMediaBody,
  type InboundMedia,
} from "./inbound-media";

export type WaStatusValue = "sent" | "delivered" | "read" | "failed";

export interface WaInboundMessage {
  /** wamid de Meta — clave de idempotencia global (connect_messages.external_msg_id). */
  wamid: string;
  /** Contraparte en E.164 con "+" (misma convención que wa-import). */
  fromE164: string;
  text: string;
  /** ISO-8601 derivado del timestamp unix de Meta. */
  sentAt: string;
  /** Nombre de perfil declarado por WhatsApp, si vino. Nunca se confía como identidad. */
  profileName: string | null;
  /**
   * H-7 · media adjunto del cliente, cuando el mensaje trae uno.
   *
   * `text` sigue siendo el cuerpo visible —el pie de foto, o la etiqueta de lo
   * que llegó—: el hilo nunca muestra una burbuja muda. Los BYTES no viajan
   * acá; se resuelven contra la Graph API en el adaptador, igual que el
   * saliente.
   */
  media?: InboundMedia | null;
}

export interface WaInboundStatus {
  wamid: string;
  status: WaStatusValue;
  at: string;
  recipientE164: string | null;
  errorCode: number | null;
}

export interface WaInboundSkipped {
  /**
   * H-7 · dejó de significar «todo lo que no es texto». Ahora cuenta SÓLO los
   * tipos que este ingreso no sabe guardar —video, sticker, ubicación,
   * reacción—, y `unsupportedTypes` los nombra: el número solo fue lo que hizo
   * invisible durante seis días la pérdida de 14 archivos de clientes.
   */
  nonText: number;
  malformed: number;
  unknownStatus: number;
  /** Tipos concretos que se descartaron, sin repetir. */
  unsupportedTypes?: string[];
}

export type WaInboundParse =
  | {
      ok: true;
      phoneNumberId: string;
      messages: WaInboundMessage[];
      statuses: WaInboundStatus[];
      skipped: WaInboundSkipped;
    }
  | {
      ok: false;
      reason:
        | "not_object"
        | "not_whatsapp_object"
        | "tenant_unresolved"
        | "tenant_mismatch";
    };

const STATUS_VALUES = new Set<string>(["sent", "delivered", "read", "failed"]);

/** E.164 canónico con "+" (idéntico criterio que wa-import/ingest.normalizePhoneE164). */
export function toE164(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Timestamp unix (segundos, string o number) → ISO. Devuelve null si no es válido. */
export function metaTimestampToIso(raw: unknown): string | null {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Normaliza el payload de Meta.
 *
 * @param payload      cuerpo ya parseado del webhook (post-HMAC).
 * @param tenantPhoneNumberId  META_WA_PHONE_NUMBER_ID del número comercial propio.
 */
export function parseInboundPayload(
  payload: unknown,
  tenantPhoneNumberId: string | undefined,
): WaInboundParse {
  const tenant = tenantPhoneNumberId?.trim();
  if (!tenant) return { ok: false, reason: "tenant_unresolved" };

  const root = asRecord(payload);
  if (!root) return { ok: false, reason: "not_object" };
  if (root.object !== "whatsapp_business_account") {
    return { ok: false, reason: "not_whatsapp_object" };
  }

  const messages: WaInboundMessage[] = [];
  const statuses: WaInboundStatus[] = [];
  const skipped: WaInboundSkipped = { nonText: 0, malformed: 0, unknownStatus: 0 };
  const unsupportedTypes: string[] = [];
  const seenWamids = new Set<string>();
  let sawMatchingTenant = false;
  let sawForeignTenant = false;

  for (const entry of asArray(root.entry)) {
    const e = asRecord(entry);
    if (!e) continue;
    for (const change of asArray(e.changes)) {
      const c = asRecord(change);
      const value = asRecord(c?.value);
      if (!value) continue;

      const metadata = asRecord(value.metadata);
      const pnid = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : null;
      if (pnid !== tenant) {
        // Un change de otra cuenta/número no puede escribir acá. Se ignora sin
        // abortar el resto: el payload puede traer varios entries.
        if (pnid) sawForeignTenant = true;
        continue;
      }
      sawMatchingTenant = true;

      // Nombre declarado por WhatsApp, indexado por wa_id.
      const nameByWaId = new Map<string, string>();
      for (const contact of asArray(value.contacts)) {
        const ct = asRecord(contact);
        const waId = toE164(ct?.wa_id);
        const name = asRecord(ct?.profile)?.name;
        if (waId && typeof name === "string" && name.trim()) nameByWaId.set(waId, name.trim());
      }

      for (const raw of asArray(value.messages)) {
        const m = asRecord(raw);
        const wamid = typeof m?.id === "string" ? m.id.trim() : "";
        const fromE164 = toE164(m?.from);
        const sentAt = metaTimestampToIso(m?.timestamp);
        if (!wamid || !fromE164 || !sentAt) {
          skipped.malformed += 1;
          continue;
        }
        // H-7 · el media del cliente ENTRA. Antes, todo lo que no fuera texto se
        // sumaba a `skipped.nonText` —un contador que no se persistía— y se
        // perdía sin dejar rastro que el operador pudiera ver.
        let body: string;
        let media: InboundMedia | null = null;
        if (m?.type === "text") {
          const t = asRecord(m.text)?.body;
          if (typeof t !== "string" || !t.length) {
            skipped.malformed += 1;
            continue;
          }
          body = t;
        } else {
          media = extractInboundMedia(m);
          if (!media) {
            // Sigue habiendo tipos que este ingreso no sabe guardar. Ahora se
            // NOMBRAN, para que la próxima pérdida sea diagnosticable.
            skipped.nonText += 1;
            const tipo = describeUnsupported(m);
            if (tipo && !unsupportedTypes.includes(tipo)) unsupportedTypes.push(tipo);
            continue;
          }
          body = inboundMediaBody(media, extractInboundCaption(m));
        }
        // Meta puede reenviar el mismo wamid dentro del mismo POST.
        if (seenWamids.has(wamid)) continue;
        seenWamids.add(wamid);

        messages.push({
          wamid,
          fromE164,
          text: body,
          sentAt,
          profileName: nameByWaId.get(fromE164) ?? null,
          media,
        });
      }

      for (const raw of asArray(value.statuses)) {
        const s = asRecord(raw);
        const wamid = typeof s?.id === "string" ? s.id.trim() : "";
        const at = metaTimestampToIso(s?.timestamp);
        const status = typeof s?.status === "string" ? s.status.trim().toLowerCase() : "";
        if (!wamid || !at) {
          skipped.malformed += 1;
          continue;
        }
        if (!STATUS_VALUES.has(status)) {
          skipped.unknownStatus += 1;
          continue;
        }
        const firstError = asRecord(asArray(s?.errors)[0]);
        const code = typeof firstError?.code === "number" ? firstError.code : null;
        statuses.push({
          wamid,
          status: status as WaStatusValue,
          at,
          recipientE164: toE164(s?.recipient_id),
          errorCode: code,
        });
      }
    }
  }

  if (!sawMatchingTenant && sawForeignTenant) {
    return { ok: false, reason: "tenant_mismatch" };
  }

  return {
    ok: true, phoneNumberId: tenant, messages, statuses,
    skipped: unsupportedTypes.length > 0 ? { ...skipped, unsupportedTypes } : skipped,
  };
}

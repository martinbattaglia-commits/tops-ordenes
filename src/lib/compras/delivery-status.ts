import type { POEmailSend, POEvent } from "@/lib/types-po";

export interface PurchaseDeliveryEvidence {
  emailConfirmed: boolean;
  driveConfirmed: boolean;
  detail: string;
}

/**
 * El query string `just_created` sólo confirma que existe la OC. Los efectos
 * externos se anuncian exclusivamente cuando su ledger contiene evidencia.
 */
export function purchaseDeliveryEvidence(
  emails: POEmailSend[] | undefined,
  events: POEvent[] | undefined,
  _driveFileId: string | null | undefined,
): PurchaseDeliveryEvidence {
  const emailConfirmed = Boolean(emails?.some(
    (email) => (email.status === "sent" || email.status === "opened")
      && Boolean(email.provider_id),
  ));
  const driveConfirmed = Boolean(events?.some(
    (event) => event.kind === "drive_synced"
      && typeof event.meta?.file_id === "string"
      && event.meta.file_id.length > 0,
  ));

  const detail = emailConfirmed && driveConfirmed
    ? "Notificación por email confirmada · Copia en Drive confirmada."
    : emailConfirmed
      ? "Notificación por email confirmada · Drive todavía sin evidencia."
      : driveConfirmed
        ? "Copia en Drive confirmada · Notificación por email todavía sin evidencia."
        : "Los envíos automáticos todavía no tienen evidencia confirmada.";

  return { emailConfirmed, driveConfirmed, detail };
}

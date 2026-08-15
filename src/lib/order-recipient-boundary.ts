import { z } from "zod";

/** Mensaje operativo deliberadamente genérico: no filtra PII ni detalles DB. */
export const ORDER_RECIPIENT_SAFE_ERROR =
  "No pudimos verificar los datos de contacto del cliente. Revisá su ficha o intentá nuevamente.";

/** Código persistible/notificable que no replica texto potencialmente sensible del proveedor. */
export const ORDER_EMAIL_FAILURE_CODE = "ORDER_EMAIL_DELIVERY_FAILED";

export type OrderRecipientFailureCode =
  | "CLIENT_CONTACT_LOOKUP_FAILED"
  | "CLIENT_CONTACT_NOT_FOUND"
  | "CLIENT_EMAIL_MISSING"
  | "CLIENT_EMAIL_INVALID";

type OrderRecipientFailure = {
  ok: false;
  code: OrderRecipientFailureCode;
  error: typeof ORDER_RECIPIENT_SAFE_ERROR;
};

type OrderRecipientSuccess<T> = {
  ok: true;
  client: T;
  email: string;
};

const CanonicalEmailSchema = z
  .string()
  .max(254)
  .email()
  .refine((value) => value === value.trim());

function failure(code: OrderRecipientFailureCode): OrderRecipientFailure {
  return { ok: false, code, error: ORDER_RECIPIENT_SAFE_ERROR };
}

/**
 * Resuelve el destinatario únicamente desde la fila canónica leída por el
 * servidor. El payload del navegador no forma parte de este contrato, por lo
 * que no puede prevalecer, actuar como fallback ni alcanzar el plan de correo.
 */
export function resolveCanonicalOrderRecipient<T extends { email?: unknown }>(
  client: T | null | undefined,
  lookupError: unknown,
): OrderRecipientSuccess<T> | OrderRecipientFailure {
  if (lookupError !== null && lookupError !== undefined) {
    return failure("CLIENT_CONTACT_LOOKUP_FAILED");
  }
  if (!client) return failure("CLIENT_CONTACT_NOT_FOUND");
  if (typeof client.email !== "string" || client.email.length === 0) {
    return failure("CLIENT_EMAIL_MISSING");
  }

  const parsed = CanonicalEmailSchema.safeParse(client.email);
  if (!parsed.success) return failure("CLIENT_EMAIL_INVALID");

  // No normalizar: el valor entregado al plan coincide byte a byte con DB.
  return { ok: true, client, email: client.email };
}

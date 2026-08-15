import { describe, expect, it } from "vitest";
import { purchaseDeliveryEvidence } from "./delivery-status";
import type { POEmailSend, POEvent } from "@/lib/types-po";

function email(status: POEmailSend["status"], providerId: string | null): POEmailSend {
  return {
    order_id: "11111111-1111-4111-8111-111111111111",
    to_email: "proveedor@example.test",
    tag: "Proveedor",
    status,
    provider_id: providerId,
    error: null,
    sent_at: "2026-08-15T12:00:00.000Z",
    opened_at: null,
  };
}

function event(kind: POEvent["kind"], fileId?: string): POEvent {
  return {
    order_id: "11111111-1111-4111-8111-111111111111",
    ts: "2026-08-15T12:00:00.000Z",
    kind,
    actor: "system",
    actor_email: null,
    ip: null,
    meta: fileId ? { file_id: fileId } : {},
  };
}

describe("evidencia visual de entrega de OC", () => {
  it("no fabrica email ni Drive por el solo hecho de crear la orden", () => {
    expect(purchaseDeliveryEvidence([], [], null)).toEqual({
      emailConfirmed: false,
      driveConfirmed: false,
      detail: "Los envíos automáticos todavía no tienen evidencia confirmada.",
    });
  });

  it("un queued/unknown/failed o un sent sin provider_id no confirma email", () => {
    for (const row of [email("queued", null), email("unknown", null), email("failed", null), email("sent", null)]) {
      expect(purchaseDeliveryEvidence([row], [], null).emailConfirmed).toBe(false);
    }
  });

  it("confirma cada transporte sólo por su propia evidencia", () => {
    expect(purchaseDeliveryEvidence([email("sent", "resend-1")], [], null)).toMatchObject({
      emailConfirmed: true,
      driveConfirmed: false,
    });
    expect(purchaseDeliveryEvidence([], [event("drive_synced", "drive-1")], null)).toMatchObject({
      emailConfirmed: false,
      driveConfirmed: true,
    });
    expect(purchaseDeliveryEvidence([email("opened", "resend-1")], [], "drive-falsificable")).toEqual({
      emailConfirmed: true,
      driveConfirmed: false,
      detail: "Notificación por email confirmada · Drive todavía sin evidencia.",
    });
    expect(purchaseDeliveryEvidence([email("opened", "resend-1")], [event("drive_synced", "drive-1")], "drive-1")).toEqual({
      emailConfirmed: true,
      driveConfirmed: true,
      detail: "Notificación por email confirmada · Copia en Drive confirmada.",
    });
  });
});

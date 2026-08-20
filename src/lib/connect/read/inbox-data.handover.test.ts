import { describe, expect, it } from "vitest";
import { mapConversation } from "./inbox-data";
import type { ConversationRow } from "../types";

const row = (handover_state: ConversationRow["handover_state"]): ConversationRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  context_id: "CTX-2026-000001",
  kind: "whatsapp",
  slug: null,
  title: "Contacto",
  visibility: "private",
  topic: null,
  archived_at: null,
  created_by: null,
  last_message_seq: 1,
  last_message_at: "2026-08-20T23:43:50.000Z",
  created_at: "2026-08-20T23:40:00.000Z",
  handover_state,
});

describe("getConversation · hidratación persistida del handover", () => {
  it("conserva PAUSED_HUMAN durante el refresh del servidor", () => {
    expect(mapConversation(row("PAUSED_HUMAN")).handoverState).toBe("PAUSED_HUMAN");
  });

  it("conserva BOT_ACTIVE", () => {
    expect(mapConversation(row("BOT_ACTIVE")).handoverState).toBe("BOT_ACTIVE");
  });

  it("mantiene compatibilidad con filas legacy sin estado", () => {
    expect(mapConversation(row(null)).handoverState).toBeUndefined();
  });
});

import { describe, it, expect, vi } from "vitest";
import { dispatchComposerSend, type ComposerDispatchPorts } from "./composer-dispatch";

describe("composer-dispatch · soporte de replyTo (P3)", () => {
  const CONV = "11111111-1111-4111-8111-111111111111";
  const CID = "msg-client-12345678";
  const REPLY_MSG_ID = "22222222-2222-4222-8222-222222222222";

  it("propaga replyTo en conversaciones de Connect", async () => {
    const postConnectMessage = vi.fn().mockResolvedValue({ ok: true, messageId: "srv-1", seq: 5 });
    const sendWhatsappText = vi.fn().mockResolvedValue({ ok: true, messageId: "wa-1" });
    const ports: ComposerDispatchPorts = { postConnectMessage, sendWhatsappText };

    const outcome = await dispatchComposerSend(
      {
        kind: "dm",
        conversationId: CONV,
        body: "respuesta al mensaje",
        clientMsgId: CID,
        replyTo: REPLY_MSG_ID,
      },
      ports,
    );

    expect(outcome).toEqual({ route: "connect", status: "sent", messageId: "srv-1", seq: 5 });
    expect(postConnectMessage).toHaveBeenCalledWith({
      conversationId: CONV,
      body: "respuesta al mensaje",
      clientMsgId: CID,
      mentions: [],
      replyTo: REPLY_MSG_ID,
    });
    expect(sendWhatsappText).not.toHaveBeenCalled();
  });

  it("no propaga replyTo en conversaciones de WhatsApp hacia Meta API", async () => {
    const postConnectMessage = vi.fn().mockResolvedValue({ ok: true, messageId: "srv-1", seq: 5 });
    const sendWhatsappText = vi.fn().mockResolvedValue({ ok: true, messageId: "wa-1" });
    const ports: ComposerDispatchPorts = { postConnectMessage, sendWhatsappText };

    const outcome = await dispatchComposerSend(
      {
        kind: "whatsapp",
        conversationId: CONV,
        body: "mensaje de whatsapp",
        clientMsgId: CID,
        replyTo: REPLY_MSG_ID,
      },
      ports,
    );

    expect(outcome).toEqual({ route: "whatsapp", status: "sent", messageId: "wa-1" });
    expect(sendWhatsappText).toHaveBeenCalledWith({
      conversationId: CONV,
      text: "mensaje de whatsapp",
      clientMsgId: CID,
    });
    expect(postConnectMessage).not.toHaveBeenCalled();
  });
});

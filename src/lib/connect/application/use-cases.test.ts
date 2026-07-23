import { describe, it, expect } from "vitest";
import {
  CreateConversationUseCase, PostMessageUseCase, MarkReadUseCase, LinkEntityUseCase,
} from "./use-cases";
import { ok, type Result } from "../domain/result";
import type {
  ConnectWritePort, CreateConversationInput, PostMessageInput,
} from "../ports/write-port";
import type { ConnectEntityType, MemberRole } from "../types";

/** Fake del puerto de escritura: registra las llamadas, no toca Supabase. */
class FakeWritePort implements ConnectWritePort {
  public posted: PostMessageInput[] = [];
  public created: CreateConversationInput[] = [];
  public reads: Array<{ conversationId: string; upToSeq: number }> = [];
  async createConversation(input: CreateConversationInput): Promise<Result<{ conversationId: string }>> {
    this.created.push(input);
    return ok({ conversationId: "c-new" });
  }
  async postMessage(input: PostMessageInput): Promise<Result<{ messageId: string; seq: number }>> {
    this.posted.push(input);
    return ok({ messageId: "m-1", seq: 7 });
  }
  async markRead(conversationId: string, upToSeq: number): Promise<Result<void>> {
    this.reads.push({ conversationId, upToSeq });
    return ok(undefined);
  }
  async addMember(): Promise<Result<void>> { return ok(undefined); }
  async linkEntity(): Promise<Result<void>> { return ok(undefined); }
}

describe("connect/application · PostMessageUseCase", () => {
  it("rechaza mensaje vacío sin llegar al puerto", async () => {
    const port = new FakeWritePort();
    const res = await new PostMessageUseCase(port).execute({
      conversationId: "c1", body: "   ", clientMsgId: "abcdefgh",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("empty_message");
    expect(port.posted).toHaveLength(0);
  });
  it("exige clientMsgId", async () => {
    const port = new FakeWritePort();
    const res = await new PostMessageUseCase(port).execute({
      conversationId: "c1", body: "hola", clientMsgId: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("missing_client_msg_id");
  });
  it("normaliza el body y postea (devuelve id+seq)", async () => {
    const port = new FakeWritePort();
    const res = await new PostMessageUseCase(port).execute({
      conversationId: "c1", body: "  hola  ", clientMsgId: "abcdefgh",
    });
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.value.seq).toBe(7); }
    expect(port.posted[0].body).toBe("hola");
  });
  it("acepta solo-adjunto (cuerpo vacío con attachmentIds)", async () => {
    const port = new FakeWritePort();
    const res = await new PostMessageUseCase(port).execute({
      conversationId: "c1", body: "", clientMsgId: "abcdefgh",
      attachmentIds: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(res.ok).toBe(true);
  });
  it("F4.1B: pasa las menciones al puerto", async () => {
    const port = new FakeWritePort();
    const res = await new PostMessageUseCase(port).execute({
      conversationId: "c1", body: "hola @María", clientMsgId: "abcdefgh",
      mentions: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(res.ok).toBe(true);
    expect(port.posted[0].mentions).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });
  it("F4.1B (D-F41-8): rechaza más de MAX_MENTIONS sin llegar al puerto", async () => {
    const port = new FakeWritePort();
    const res = await new PostMessageUseCase(port).execute({
      conversationId: "c1", body: "hola", clientMsgId: "abcdefgh",
      mentions: Array.from({ length: 21 }, (_, i) => `id-${i}`),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("too_many_mentions");
    expect(port.posted).toHaveLength(0);
  });
});

describe("connect/application · CreateConversationUseCase", () => {
  it("un canal exige nombre o slug", async () => {
    const res = await new CreateConversationUseCase(new FakeWritePort()).execute({ kind: "channel" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("channel_needs_name");
  });
  it("vínculo a entidad sin id falla", async () => {
    const res = await new CreateConversationUseCase(new FakeWritePort()).execute({
      kind: "erp", entityType: "orders" as ConnectEntityType,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("link_needs_id");
  });
  it("crea un dm simple", async () => {
    const port = new FakeWritePort();
    const res = await new CreateConversationUseCase(port).execute({ kind: "dm" });
    expect(res.ok).toBe(true);
    expect(port.created).toHaveLength(1);
  });
});

describe("connect/application · MarkRead / LinkEntity", () => {
  it("markRead rechaza seq negativo", async () => {
    const res = await new MarkReadUseCase(new FakeWritePort()).execute("c1", -1);
    expect(res.ok).toBe(false);
  });
  it("markRead pasa el seq al puerto", async () => {
    const port = new FakeWritePort();
    await new MarkReadUseCase(port).execute("c1", 12);
    expect(port.reads[0]).toEqual({ conversationId: "c1", upToSeq: 12 });
  });
  it("linkEntity exige id", async () => {
    const res = await new LinkEntityUseCase(new FakeWritePort()).execute(
      "c1", "orders" as ConnectEntityType, null, null,
    );
    expect(res.ok).toBe(false);
  });
});

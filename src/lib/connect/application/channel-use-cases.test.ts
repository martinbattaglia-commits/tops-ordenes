import { describe, it, expect } from "vitest";
import { channelOps, SetTopicUseCase, SetTitleUseCase, PinMessageUseCase } from "./channel-use-cases";
import { ok, type Result } from "../domain/result";
import type { ChannelOpsPort } from "../ports/channel-ops-port";
import type { MemberRole } from "../types";

class FakeOps implements ChannelOpsPort {
  public calls: Array<[string, unknown[]]> = [];
  private rec(name: string, args: unknown[]): Promise<Result<void>> { this.calls.push([name, args]); return Promise.resolve(ok(undefined)); }
  joinChannel(c: string) { return this.rec("join", [c]); }
  addMember(c: string, p: string, r: MemberRole) { return this.rec("add", [c, p, r]); }
  removeMember(c: string, p: string) { return this.rec("remove", [c, p]); }
  setMemberRole(c: string, p: string, r: MemberRole) { return this.rec("setRole", [c, p, r]); }
  archiveConversation(c: string) { return this.rec("archive", [c]); }
  setTopic(c: string, t: string) { return this.rec("setTopic", [c, t]); }
  setTitle(c: string, t: string) { return this.rec("setTitle", [c, t]); }
  pinMessage(m: string) { return this.rec("pin", [m]); }
  unpinMessage(m: string) { return this.rec("unpin", [m]); }
}

describe("connect/application · channel use-cases", () => {
  it("setTopic rechaza tema vacío sin llegar al port", async () => {
    const ops = new FakeOps();
    const res = await new SetTopicUseCase(ops).execute("c1", "   ");
    expect(res.ok).toBe(false);
    expect(ops.calls).toHaveLength(0);
  });
  it("setTopic normaliza y persiste", async () => {
    const ops = new FakeOps();
    const res = await new SetTopicUseCase(ops).execute("c1", "  Coordinación  ");
    expect(res.ok).toBe(true);
    expect(ops.calls[0]).toEqual(["setTopic", ["c1", "Coordinación"]]);
  });
  it("setTitle rechaza nombre vacío sin llegar al port (DEFECT-7)", async () => {
    const ops = new FakeOps();
    const res = await new SetTitleUseCase(ops).execute("c1", "   ");
    expect(res.ok).toBe(false);
    expect(ops.calls).toHaveLength(0);
  });
  it("setTitle normaliza (trim) y persiste el nombre visible (DEFECT-7)", async () => {
    const ops = new FakeOps();
    const res = await new SetTitleUseCase(ops).execute("c1", "  Operaciones Magaldi  ");
    expect(res.ok).toBe(true);
    expect(ops.calls[0]).toEqual(["setTitle", ["c1", "Operaciones Magaldi"]]);
  });
  it("pin rechaza messageId vacío", async () => {
    const res = await new PinMessageUseCase(new FakeOps()).pin("");
    expect(res.ok).toBe(false);
  });
  it("channelOps ensambla y delega join/member/archive", async () => {
    const ops = new FakeOps();
    const o = channelOps(ops);
    await o.join.execute("c1");
    await o.member.add("c1", "p1", "member");
    await o.member.setRole("c1", "p1", "moderator");
    await o.archive.execute("c1");
    expect(ops.calls.map((c) => c[0])).toEqual(["join", "add", "setRole", "archive"]);
  });
});

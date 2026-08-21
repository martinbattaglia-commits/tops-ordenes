import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/recovery/route";

describe("GET /auth/recovery", () => {
  it("custodia el token en cookie HttpOnly y limpia la URL", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(new NextRequest(
      "https://nexus.logisticatops.com/auth/recovery?token_hash=synthetic-hash&type=recovery",
    ));
    expect(response.headers.get("location")).toBe(
      "https://nexus.logisticatops.com/auth/recovery/confirm",
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("nexus-password-recovery-token=synthetic-hash");
    expect(cookie).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it("rechaza tipos distintos de recovery sin fijar token", async () => {
    const response = await GET(new NextRequest(
      "https://nexus.logisticatops.com/auth/recovery?token_hash=synthetic-hash&type=magiclink",
    ));
    expect(response.headers.get("location")).toContain("/auth/recovery/confirm?error=invalid");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

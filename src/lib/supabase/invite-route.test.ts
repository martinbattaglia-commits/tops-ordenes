import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/invite/route";

describe("GET /auth/invite", () => {
  it("custodia sólo un token invite y limpia la URL", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(new NextRequest(
      "https://nexus.logisticatops.com/auth/invite?token_hash=synthetic-invite&type=invite",
    ));
    expect(response.headers.get("location")).toBe(
      "https://nexus.logisticatops.com/auth/invite/confirm",
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("nexus-password-invite-token=synthetic-invite");
    expect(cookie).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).not.toContain("synthetic-invite");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it("rechaza recovery y magic link sin fijar cookie", async () => {
    for (const type of ["recovery", "magiclink", "email", ""]) {
      const response = await GET(new NextRequest(
        `https://nexus.logisticatops.com/auth/invite?token_hash=synthetic-invite&type=${type}`,
      ));
      expect(response.headers.get("location")).toContain("/auth/invite/confirm?error=invalid");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});

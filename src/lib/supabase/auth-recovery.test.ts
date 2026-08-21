import { beforeEach, describe, expect, it } from "vitest";
import {
  authenticatedAuthTransitionAllowed,
  createAuthTransitionToken,
  extractSessionId,
  getTransitionSecret,
  isPasswordRecoveryNext,
  PASSWORD_INVITE_COOKIE,
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_PATH,
  passwordRecoveryErrorMessage,
  safeAuthNext,
  sanitizeAuthErrorMessage,
  validateNewPassword,
  verifyAuthTransitionToken,
} from "./auth-recovery";

const TEST_SECRET = "test-auth-transition-secret-minimum-32-chars-entropy-key";

beforeEach(() => {
  process.env.AUTH_TRANSITION_SECRET = TEST_SECRET;
});

async function transition(
  pathname: string,
  method: string,
  values: Record<string, string> = {},
  user?: { id: string; email?: string | null } | null,
  sessionId?: string | null,
) {
  return await authenticatedAuthTransitionAllowed({
    pathname,
    method,
    cookie: (name) => values[name],
    user,
    sessionId,
  });
}

describe("R1 · Fail-Closed Obligatorio (Sin usuario, sesión o session_id = BLOQUEADO)", () => {
  const userA = { id: "user-a-uuid", email: "despachos-lujan@logisticatops.com" };
  const session1 = "session-1111-aaaa";
  const session2 = "session-2222-bbbb";

  it("token firmado + usuario ausente (currentAuth null o sin userId): bloqueado fail-closed", async () => {
    const token = await createAuthTransitionToken({
      purpose: "recovery",
      userId: userA.id,
      sessionId: session1,
      userEmail: userA.email,
    });

    const resNull = await verifyAuthTransitionToken(token, "recovery", null);
    expect(resNull.valid).toBe(false);
    expect(resNull.reason).toBe("missing_identity");

    const resNoUser = await verifyAuthTransitionToken(token, "recovery", { userId: "", sessionId: session1 });
    expect(resNoUser.valid).toBe(false);
    expect(resNoUser.reason).toBe("missing_identity");
  });

  it("token firmado + sesión ausente (sin currentAuth o sin sessionId): bloqueado fail-closed", async () => {
    const token = await createAuthTransitionToken({
      purpose: "recovery",
      userId: userA.id,
      sessionId: session1,
      userEmail: userA.email,
    });

    const resNoSession = await verifyAuthTransitionToken(token, "recovery", { userId: userA.id, sessionId: "" });
    expect(resNoSession.valid).toBe(false);
    expect(resNoSession.reason).toBe("missing_identity");
  });

  it("token firmado + sessionId ausente en token: bloqueado", async () => {
    const payload = { v: 1, purpose: "recovery", userId: userA.id, iat: Date.now(), exp: Date.now() + 600 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const token = `${encoded}.synthetic-signature`;

    const result = await verifyAuthTransitionToken(token, "recovery", {
      userId: userA.id,
      sessionId: session1,
    });
    expect(result.valid).toBe(false);
  });

  it("JWT no verificable en extractSessionId: devuelve null", () => {
    expect(extractSessionId(null)).toBeNull();
    expect(extractSessionId({ id: "" })).toBeNull();
    expect(extractSessionId({ access_token: "invalid-token" })).toBeNull();
    expect(extractSessionId({ access_token: "a.b" })).toBeNull();
    expect(extractSessionId({ access_token: "a.eyJpbnZhbGlkIjoxfQ.c" })).toBeNull();
  });

  it("extractSessionId extrae sesión de session.id y de claims JWT session_id / sid", () => {
    expect(extractSessionId({ id: "uuid-session-123" })).toBe("uuid-session-123");

    const jwtSessionPayload = Buffer.from(JSON.stringify({ session_id: "claim-session-456" })).toString("base64url");
    expect(extractSessionId({ access_token: `header.${jwtSessionPayload}.sig` })).toBe("claim-session-456");

    const jwtSidPayload = Buffer.from(JSON.stringify({ sid: "claim-sid-789" })).toString("base64url");
    expect(extractSessionId({ access_token: `header.${jwtSidPayload}.sig` })).toBe("claim-sid-789");
  });

  it("mismo usuario y mismo correo, pero distinto session_id: bloqueado (session_mismatch)", async () => {
    const token = await createAuthTransitionToken({
      purpose: "recovery",
      userId: userA.id,
      sessionId: session1,
      userEmail: userA.email,
    });

    const result = await verifyAuthTransitionToken(token, "recovery", {
      userId: userA.id,
      sessionId: session2,
      email: userA.email,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("session_mismatch");
  });

  it("mismo usuario y mismo session_id: permitido", async () => {
    const token = await createAuthTransitionToken({
      purpose: "recovery",
      userId: userA.id,
      sessionId: session1,
      userEmail: userA.email,
    });

    const result = await verifyAuthTransitionToken(token, "recovery", {
      userId: userA.id,
      sessionId: session1,
      email: userA.email,
    });
    expect(result.valid).toBe(true);
    expect(result.payload?.userId).toBe(userA.id);
    expect(result.payload?.sessionId).toBe(session1);
  });

  it("mismo usuario después de refresh legítimo conservando session_id: permitido", async () => {
    const token = await createAuthTransitionToken({
      purpose: "recovery",
      userId: userA.id,
      sessionId: session1,
      userEmail: userA.email,
    });

    const sessionAfterRefresh = { id: session1, access_token: "refreshed.access.token" };
    const resolvedSessionId = extractSessionId(sessionAfterRefresh);

    const result = await verifyAuthTransitionToken(token, "recovery", {
      userId: userA.id,
      sessionId: resolvedSessionId,
      email: userA.email,
    });
    expect(result.valid).toBe(true);
  });

  it("usuario diferente: bloqueado (user_mismatch)", async () => {
    const token = await createAuthTransitionToken({
      purpose: "recovery",
      userId: userA.id,
      sessionId: session1,
      userEmail: userA.email,
    });

    const result = await verifyAuthTransitionToken(token, "recovery", {
      userId: "other-user-uuid",
      sessionId: session1,
      email: "otro@logisticatops.com",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("user_mismatch");
  });
});

describe("B2 · Secreto dedicado y fail-closed sin fallbacks inseguros", () => {
  it("AUTH_TRANSITION_SECRET ausente en producción: fail-closed", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.AUTH_TRANSITION_SECRET;
    try {
      (process.env as any).NODE_ENV = "production";
      delete process.env.AUTH_TRANSITION_SECRET;
      expect(() => getTransitionSecret()).toThrow(/AUTH_TRANSITION_SECRET_REQUIRED/);
    } finally {
      (process.env as any).NODE_ENV = prevEnv;
      process.env.AUTH_TRANSITION_SECRET = prevSecret;
    }
  });

  it("sólo NEXT_PUBLIC_SUPABASE_ANON_KEY presente: fail-closed", () => {
    const prevSecret = process.env.AUTH_TRANSITION_SECRET;
    delete process.env.AUTH_TRANSITION_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.public_anon_key";
    expect(() => getTransitionSecret()).toThrow(/AUTH_TRANSITION_SECRET_MISSING/);
    process.env.AUTH_TRANSITION_SECRET = prevSecret;
  });

  it("sólo SUPABASE_SERVICE_ROLE_KEY presente: fail-closed", () => {
    const prevSecret = process.env.AUTH_TRANSITION_SECRET;
    delete process.env.AUTH_TRANSITION_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-key-1234567890123456";
    expect(() => getTransitionSecret()).toThrow(/AUTH_TRANSITION_SECRET_MISSING/);
    process.env.AUTH_TRANSITION_SECRET = prevSecret;
  });

  it("sólo CRON_SECRET presente: fail-closed", () => {
    const prevSecret = process.env.AUTH_TRANSITION_SECRET;
    delete process.env.AUTH_TRANSITION_SECRET;
    process.env.CRON_SECRET = "cron-secret-1234567890123456789012";
    expect(() => getTransitionSecret()).toThrow(/AUTH_TRANSITION_SECRET_MISSING/);
    process.env.AUTH_TRANSITION_SECRET = prevSecret;
  });

  it("secreto sintético explícito en test (>= 32 chars): emisión y validación correctas", async () => {
    process.env.AUTH_TRANSITION_SECRET = "synthetic-test-secret-at-least-32-chars-long";
    const token = await createAuthTransitionToken({
      purpose: "recovery",
      userId: "u-1",
      sessionId: "s-1",
    });
    const result = await verifyAuthTransitionToken(token, "recovery", { userId: "u-1", sessionId: "s-1" });
    expect(result.valid).toBe(true);
  });
});

describe("B3 · Criptografía estándar Web Crypto (crypto.subtle)", () => {
  it("firma producida con Web Crypto: verificada correctamente", async () => {
    const token = await createAuthTransitionToken({
      purpose: "invite",
      userId: "u-inv",
      sessionId: "s-inv",
    });
    const result = await verifyAuthTransitionToken(token, "invite", { userId: "u-inv", sessionId: "s-inv" });
    expect(result.valid).toBe(true);
  });

  it("firma con otra clave: bloqueada", async () => {
    process.env.AUTH_TRANSITION_SECRET = "first-key-minimum-32-chars-entropy-test-aaa";
    const token = await createAuthTransitionToken({
      purpose: "recovery",
      userId: "u-1",
      sessionId: "s-1",
    });

    process.env.AUTH_TRANSITION_SECRET = "second-key-minimum-32-chars-entropy-test-bbb";
    const result = await verifyAuthTransitionToken(token, "recovery", { userId: "u-1", sessionId: "s-1" });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_signature");
  });
});

describe("H1 · Middleware transición fail-closed y blindaje de redirects", () => {
  const user = { id: "u123", email: "despachos-lujan@logisticatops.com" };
  const sessionId = "s123";

  it("safeAuthNext rechaza /auth/reset-password y open redirects desde callbacks", () => {
    expect(safeAuthNext("/auth/reset-password")).toBe("/dashboard");
    expect(safeAuthNext("/auth/recovery")).toBe("/dashboard");
    expect(safeAuthNext("/auth/invite")).toBe("/dashboard");
    expect(safeAuthNext("https://evil.example/steal")).toBe("/dashboard");
    expect(safeAuthNext("//evil.example/steal")).toBe("/dashboard");
    const backslash = String.fromCharCode(92);
    expect(safeAuthNext("/" + backslash + "evil.example/steal")).toBe("/dashboard");
    expect(safeAuthNext("/orders")).toBe("/orders");
  });

  it("middleware sin usuario o sin sesión falla cerrado (false)", async () => {
    const validRecoveryToken = await createAuthTransitionToken({
      purpose: "recovery",
      userId: user.id,
      sessionId,
      userEmail: user.email,
    });

    // Sin usuario -> FALSE
    expect(
      await transition("/auth/reset-password", "GET", { [PASSWORD_RECOVERY_COOKIE]: validRecoveryToken }, null, sessionId),
    ).toBe(false);

    // Sin sessionId -> FALSE
    expect(
      await transition("/auth/reset-password", "GET", { [PASSWORD_RECOVERY_COOKIE]: validRecoveryToken }, user, null),
    ).toBe(false);
  });
});

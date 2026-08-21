export * from "./auth-recovery-shared";

import {
  PASSWORD_RECOVERY_PATH,
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_TOKEN_COOKIE,
  PASSWORD_INVITE_COOKIE,
  PASSWORD_INVITE_TOKEN_COOKIE,
  TRANSITION_VERSION,
  TRANSITION_TTL_SECONDS,
  MIN_SECRET_LENGTH,
  AuthTransitionPayload,
  TransitionValidationResult,
} from "./auth-recovery-shared";

/**
 * Obtiene la clave de firma de servidor dedicada para los tokens de transición Auth.
 * Requiere AUTH_TRANSITION_SECRET explícito (mínimo 32 caracteres).
 * Cero fallbacks a claves públicas, service role o secretos de otros subsistemas.
 */
export function getTransitionSecret(): string {
  const secret = process.env.AUTH_TRANSITION_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_TRANSITION_SECRET_REQUIRED: Production environment requires AUTH_TRANSITION_SECRET");
    }
    throw new Error("AUTH_TRANSITION_SECRET_MISSING: AUTH_TRANSITION_SECRET must be configured");
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error("AUTH_TRANSITION_SECRET_TOO_SHORT: AUTH_TRANSITION_SECRET must be at least 32 characters");
  }
  return secret;
}

/**
 * Extrae el session_id unívoco de una sesión de Supabase (desde session.id o claim session_id/sid del JWT).
 */
export function extractSessionId(
  session: { id?: string; access_token?: string } | null | undefined,
): string | null {
  if (!session) return null;
  if (session.id && typeof session.id === "string" && session.id.trim()) {
    return session.id.trim();
  }
  if (session.access_token && typeof session.access_token === "string" && session.access_token.includes(".")) {
    try {
      const parts = session.access_token.split(".");
      if (parts.length === 3) {
        const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
        const payload = JSON.parse(payloadJson);
        if (payload.session_id && typeof payload.session_id === "string" && payload.session_id.trim()) {
          return payload.session_id.trim();
        }
        if (payload.sid && typeof payload.sid === "string" && payload.sid.trim()) {
          return payload.sid.trim();
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Importa la clave HMAC con Web Crypto estándar (crypto.subtle).
 */
async function getCryptoKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  return await globalThis.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/**
 * Emite un token de transición firmado criptográficamente con Web Crypto
 * y ligado a userId, sessionId y propósito exacto.
 */
export async function createAuthTransitionToken(input: {
  purpose: "recovery" | "invite";
  userId: string;
  sessionId: string;
  userEmail?: string;
}): Promise<string> {
  const secret = getTransitionSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTransitionPayload = {
    v: TRANSITION_VERSION,
    purpose: input.purpose,
    userId: input.userId,
    sessionId: input.sessionId,
    userEmail: input.userEmail ? input.userEmail.toLowerCase().trim() : undefined,
    iat: now,
    exp: now + TRANSITION_TTL_SECONDS,
  };

  const payloadEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const key = await getCryptoKey(secret, "sign");
  const encoder = new TextEncoder();
  const signatureBuffer = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payloadEncoded));
  const signature = Buffer.from(signatureBuffer).toString("base64url");

  return `${payloadEncoded}.${signature}`;
}

/**
 * R1 — Valida un token de transición con Web Crypto de forma estrictamente FAIL-CLOSED.
 * Si falta identidad activa (usuario ausente, sesión ausente o sessionId ausente), RECHAZA INMEDIATAMENTE.
 */
export async function verifyAuthTransitionToken(
  tokenString: string | null | undefined,
  expectedPurpose: "recovery" | "invite",
  currentAuth: { userId?: string | null; sessionId?: string | null; email?: string | null } | null | undefined,
): Promise<TransitionValidationResult> {
  if (!tokenString || typeof tokenString !== "string") {
    return { valid: false, reason: "missing" };
  }

  // R1 Fail-closed: Identidad completa y activa obligatoria para validar contexto de transición
  if (!currentAuth || !currentAuth.userId || !currentAuth.sessionId) {
    return { valid: false, reason: "missing_identity" };
  }

  const parts = tokenString.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "invalid_format" };
  }

  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) {
    return { valid: false, reason: "invalid_format" };
  }

  let secret: string;
  try {
    secret = getTransitionSecret();
  } catch {
    return { valid: false, reason: "invalid_signature" };
  }

  try {
    const key = await getCryptoKey(secret, "verify");
    const signatureBuffer = Buffer.from(signature, "base64url");
    const encoder = new TextEncoder();
    const isValid = await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      signatureBuffer,
      encoder.encode(payloadEncoded),
    );
    if (!isValid) {
      return { valid: false, reason: "invalid_signature" };
    }
  } catch {
    return { valid: false, reason: "invalid_signature" };
  }

  let payload: AuthTransitionPayload;
  try {
    const jsonStr = Buffer.from(payloadEncoded, "base64url").toString("utf8");
    payload = JSON.parse(jsonStr);
  } catch {
    return { valid: false, reason: "invalid_format" };
  }

  if (payload.v !== TRANSITION_VERSION || !payload.userId || !payload.sessionId || !payload.purpose) {
    return { valid: false, reason: "invalid_format" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now || payload.iat > now + 60) {
    return { valid: false, reason: "expired", payload };
  }

  if (payload.purpose !== expectedPurpose) {
    return { valid: false, reason: "purpose_mismatch", payload };
  }

  if (currentAuth.userId !== payload.userId) {
    return { valid: false, reason: "user_mismatch", payload };
  }
  if (currentAuth.sessionId !== payload.sessionId) {
    return { valid: false, reason: "session_mismatch", payload };
  }
  if (
    payload.userEmail &&
    currentAuth.email &&
    currentAuth.email.toLowerCase().trim() !== payload.userEmail.toLowerCase().trim()
  ) {
    return { valid: false, reason: "user_mismatch", payload };
  }

  return { valid: true, payload };
}

export function recoveryCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: PASSWORD_RECOVERY_PATH,
    maxAge: 10 * 60,
  };
}

export function recoveryTokenCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/auth/recovery",
    maxAge: 5 * 60,
  };
}

export function inviteCookieOptions() {
  return {
    ...recoveryCookieOptions(),
    path: PASSWORD_RECOVERY_PATH,
  };
}

export function inviteTokenCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/auth/invite",
    maxAge: 5 * 60,
  };
}

export function safeOtpTokenHash(value: string | null | undefined): string | null {
  if (!value || value.length < 8 || value.length > 512) return null;
  if (!/^[A-Za-z0-9._~-]+$/.test(value)) return null;
  return value;
}

interface AuthTransitionRequest {
  pathname: string;
  method: string;
  cookie: (name: string) => string | undefined;
  user?: { id: string; email?: string | null } | null;
  sessionId?: string | null;
}

/**
 * Excepción estrecha para atravesar el guard empresarial durante Auth.
 * Exige el contexto HttpOnly emitido por el servidor y ligado a userId + sessionId.
 * Falla cerrado si falta user o sessionId.
 */
export async function authenticatedAuthTransitionAllowed({
  pathname,
  method,
  cookie,
  user,
  sessionId,
}: AuthTransitionRequest): Promise<boolean> {
  if (method === "GET") {
    if (pathname === "/auth/recovery" || pathname === "/auth/invite") return true;
    if (pathname === "/api/auth/callback") return true;
  }

  if (method !== "GET" && method !== "POST") return false;

  if (pathname === "/auth/recovery/confirm") {
    return safeOtpTokenHash(cookie(PASSWORD_RECOVERY_TOKEN_COOKIE)) !== null;
  }
  if (pathname === "/auth/invite/confirm") {
    return safeOtpTokenHash(cookie(PASSWORD_INVITE_TOKEN_COOKIE)) !== null;
  }

  if (pathname === PASSWORD_RECOVERY_PATH) {
    if (!user?.id || !sessionId) {
      return false; // R1 Fail-closed: sin identidad completa no hay transición
    }

    const recoveryToken = cookie(PASSWORD_RECOVERY_COOKIE);
    const inviteToken = cookie(PASSWORD_INVITE_COOKIE);

    const currentAuth = { userId: user.id, sessionId, email: user.email };

    const recoveryRes = recoveryToken
      ? await verifyAuthTransitionToken(recoveryToken, "recovery", currentAuth)
      : { valid: false };
    const inviteRes = inviteToken
      ? await verifyAuthTransitionToken(inviteToken, "invite", currentAuth)
      : { valid: false };

    return recoveryRes.valid !== inviteRes.valid;
  }

  return false;
}

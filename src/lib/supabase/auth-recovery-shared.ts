export const PASSWORD_RECOVERY_PATH = "/auth/reset-password";
export const PASSWORD_RECOVERY_COOKIE = "nexus-password-recovery";
export const PASSWORD_RECOVERY_TOKEN_COOKIE = "nexus-password-recovery-token";
export const PASSWORD_INVITE_COOKIE = "nexus-password-invite";
export const PASSWORD_INVITE_TOKEN_COOKIE = "nexus-password-invite-token";

export const DEFAULT_AUTH_NEXT = "/dashboard";
export const TRANSITION_VERSION = 1;
export const TRANSITION_TTL_SECONDS = 10 * 60; // 10 minutos
export const MIN_SECRET_LENGTH = 32;

export interface AuthTransitionPayload {
  v: number;
  purpose: "recovery" | "invite";
  userId: string;
  sessionId: string;
  userEmail?: string;
  iat: number;
  exp: number;
}

export interface TransitionValidationResult {
  valid: boolean;
  reason?:
    | "missing"
    | "missing_identity"
    | "invalid_format"
    | "invalid_signature"
    | "expired"
    | "purpose_mismatch"
    | "user_mismatch"
    | "session_mismatch";
  payload?: AuthTransitionPayload;
}

/**
 * Sanitiza cualquier error del proveedor antes de mostrarlo en la interfaz.
 * Nunca expone error.message crudo, tokens ni internals de Supabase.
 */
export function sanitizeAuthErrorMessage(
  error: unknown,
  defaultMessage = "No pudimos completar la solicitud.",
): string {
  if (!error) return defaultMessage;
  const msg = typeof error === "string" ? error : (error as { message?: string }).message ?? "";

  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(msg)) {
    return "Demasiados intentos. Por favor esperá unos minutos antes de reintentar.";
  }
  if (/invalid login credentials|invalid_grant|user not found|invalid password/i.test(msg)) {
    return "Credenciales inválidas. Verificá tu correo y contraseña.";
  }
  if (/password.*weak|characters|policy|at least|rule/i.test(msg)) {
    return "La contraseña no cumple la política de seguridad. Debe tener al menos 8 caracteres.";
  }
  if (/fetch failed|network|timeout|connection/i.test(msg)) {
    return "Error de conexión con el servicio. Volvé a intentarlo en unos momentos.";
  }

  return defaultMessage;
}

/**
 * Valida un destino seguro dentro de la aplicación sin permitir open redirects ni destinos /auth/*.
 */
export function safeAuthNext(value: string | null | undefined, fallback = DEFAULT_AUTH_NEXT): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  const backslash = String.fromCharCode(92);
  if (value.includes(backslash) || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://nexus.invalid");
    if (parsed.origin !== "https://nexus.invalid") return fallback;
    const path = parsed.pathname.toLowerCase();
    if (
      path.startsWith("/auth/reset-password") ||
      path.startsWith("/auth/recovery") ||
      path.startsWith("/auth/invite")
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function isPasswordRecoveryNext(value: string): boolean {
  return new URL(value, "https://nexus.invalid").pathname === PASSWORD_RECOVERY_PATH;
}

export function otpErrorKind(message?: string): "expired" | "network" {
  if (!message) return "expired";
  return /expired|one-time|token.*not found|invalid.*token/i.test(message) ? "expired" : "network";
}

export function passwordRecoveryErrorMessage(code?: string): string {
  switch (code) {
    case "expired":
      return "El enlace venció o ya fue utilizado. Pedí uno nuevo y abrí solamente el correo más reciente.";
    case "missing_session":
    case "missing_identity":
      return "No hay una sesión de recuperación válida. Pedí un enlace nuevo.";
    case "user_mismatch":
    case "session_mismatch":
      return "La sesión no coincide con el enlace de recuperación. Iniciá el proceso nuevamente.";
    case "network":
      return "No pudimos completar la operación por un error de red. Volvé a intentarlo.";
    default:
      return "El enlace de recuperación es inválido, fue utilizado o está incompleto. Pedí uno nuevo.";
  }
}

export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (password.length > 72) return "La contraseña no puede superar los 72 caracteres.";
  if (password !== confirmation) return "Las contraseñas no coinciden.";
  return null;
}

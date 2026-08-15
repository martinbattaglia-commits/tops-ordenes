import "server-only";

/**
 * Capacidades por CANAL de Nexus Link (migración 0236) — resolución FAIL-CLOSED.
 *
 * ─── POR QUÉ NO SE REUSA `canAccess()` ─────────────────────────────────────
 *
 * `canAccess()` es deliberadamente anti-lockout: sin Supabase devuelve `true`, y
 * un usuario SIN asignación de rol pasa salvo que `RBAC_ENFORCE=1` esté activo
 * globalmente. Ese diseño es correcto para no romper módulos durante la
 * transición del RBAC, pero es exactamente lo contrario de lo que necesita una
 * PROHIBICIÓN de canal: acá el default tiene que ser negar.
 *
 * `nexus_link_can()` (0236) ya resuelve fail-closed en la base y —esto es lo
 * importante— NO consulta los permisos legacy `connect.view/create/edit`, así que
 * no pueden funcionar como bypass, y su rama administrativa exige doble
 * evidencia. Este módulo es sólo la frontera de servidor hacia esa función.
 *
 * ─── LA REGLA ──────────────────────────────────────────────────────────────
 *
 * Capacidad ausente, sesión ausente, error de RPC o base inalcanzable ⇒ DENEGADO
 * para `whatsapp.*`. Sin excepciones, tampoco en demo: un modo de demostración
 * no puede abrir un canal comercial.
 *
 * Para `internal_chat.*` se conserva la tolerancia de demo (sin Supabase, la
 * demo funciona), porque ahí no hay nada que proteger de terceros y romperla
 * dejaría la aplicación sin chat en preview.
 */

import { createClient } from "@/lib/supabase/server";

export const NEXUS_LINK_CAPABILITIES = [
  "nexus_link.internal_chat.read",
  "nexus_link.internal_chat.send",
  "nexus_link.internal_chat.media",
  "nexus_link.whatsapp.read",
  "nexus_link.whatsapp.send",
  "nexus_link.whatsapp.media",
] as const;

export type NexusLinkCapability = (typeof NEXUS_LINK_CAPABILITIES)[number];

/** ¿La capacidad pertenece al canal de WhatsApp? */
export function isWhatsappCapability(cap: NexusLinkCapability): boolean {
  return cap.startsWith("nexus_link.whatsapp.");
}

/**
 * ¿El usuario de la sesión tiene la capacidad de canal?
 *
 * FAIL-CLOSED para WhatsApp. La decisión se toma SIEMPRE en la base mediante
 * `nexus_link_can()`: acá no se replica la lógica de permisos, para que no
 * puedan divergir.
 */
export async function canChannel(cap: NexusLinkCapability): Promise<boolean> {
  const esWhatsapp = isWhatsappCapability(cap);
  const supabase = createClient();
  if (!supabase) return !esWhatsapp; // sin base: demo sólo para chat interno

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false; // sin sesión: nunca

  const { data, error } = await supabase.rpc("nexus_link_can", { p_capability: cap });
  if (error) {
    // Si 0236 todavía no está aplicada, la RPC no existe. Para WhatsApp eso es
    // denegar; para el chat interno se conserva el comportamiento previo, o la
    // ventana entre migración y build dejaría a todos sin chat.
    return !esWhatsapp;
  }
  return data === true;
}

/**
 * ¿Es administrador CANÓNICO? Doble evidencia: `profiles.role='admin'` Y una
 * asignación real que porte `connect.admin`. Escribir la columna no alcanza.
 * Fail-closed: sin sesión, sin base o ante error de RPC ⇒ false.
 */
export async function isCanonicalAdmin(): Promise<boolean> {
  const supabase = createClient();
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.rpc("nexus_link_is_admin");
  if (error) return false;
  return data === true;
}

/**
 * Autoridad para el importador de WhatsApp Comercial: administrador canónico
 * Y capacidad del canal, ACUMULATIVAS. Ninguna de las dos sola habilita.
 */
export async function canAdminWhatsappImport(): Promise<boolean> {
  const [admin, canal] = await Promise.all([
    isCanonicalAdmin(),
    canChannel("nexus_link.whatsapp.read"),
  ]);
  return admin && canal;
}

/** Azúcar para el caso más frecuente: ¿puede ver WhatsApp? */
export const canReadWhatsapp = (): Promise<boolean> => canChannel("nexus_link.whatsapp.read");

/**
 * Resultado uniforme de denegación para server actions y route handlers.
 * Mensaje deliberadamente NEUTRO: no confirma ni desmiente que la conversación
 * exista, para no filtrar metadata por la vía del mensaje de error.
 */
export const DENEGADO_CANAL = {
  ok: false as const,
  message: "No tenés acceso a este canal.",
};

import "server-only";

/**
 * Nexus Link · FASE B — Lectura AUTORIZADA de la ficha de contacto de WhatsApp.
 *
 * ─── POR QUÉ ESTE MÓDULO EXISTE ────────────────────────────────────────────
 *
 * El teléfono es dato personal. Que la ruta del hilo ya tenga guarda de canal
 * no alcanza como argumento: la ficha se pide desde un lugar, pero podría
 * pedirse desde otro mañana. Entonces la decisión se toma ACÁ, en un único
 * punto de estrangulamiento, y la ruta lo consume — nunca al revés.
 *
 * ─── LAS TRES CAPAS QUE TIENEN QUE FALLAR A LA VEZ PARA QUE HAYA FUGA ──────
 *
 *  1. RLS. `connect_conversations select` (0237) devuelve la fila sólo a un
 *     participante y, si `kind='whatsapp'`, sólo con
 *     `nexus_link_can('nexus_link.whatsapp.read')`. Sin eso, el `select` no
 *     trae fila: no hay `context_id` que parsear.
 *  2. Capacidad, verificada de nuevo acá contra `nexus_link_can()`. Redundante
 *     con la RLS a propósito: si alguien mañana leyera esta tabla con
 *     `service_role`, la RLS no lo frenaría y esta comprobación sí.
 *  3. Forma. `resolverContactoWa()` sólo produce ficha para `kind='whatsapp'`.
 *
 * ─── INDISTINGUIBILIDAD ────────────────────────────────────────────────────
 *
 * Conversación inexistente, UUID adivinado, hilo del que no se es participante,
 * hilo de WhatsApp sin la capacidad y hilo interno devuelven TODOS `null`. No
 * hay código de error que los separe, ni mensaje distinto, ni latencia
 * distinguible por rama: quien no puede ver el hilo tampoco puede aprender que
 * existe. Y `null` NO significa «sin número» — para eso la ficha existe con
 * `e164: null`.
 *
 * ─── ALCANCE REAL DE ESTA FRONTERA (no confundirla con más de lo que es) ───
 *
 * Esto cierra la vía por la que ESTA ficha obtiene el teléfono. NO cierra todas
 * las vías por las que el teléfono existe en la base. Medido en producción el
 * 2026-08-14: `connect_participants.external_ref->>'phone'` guarda el mismo
 * número en 21 de 26 participantes de WhatsApp, y la policy SELECT de esa tabla
 * (0143) **no tiene predicado de canal** — ni 0236 ni 0237 la tocan—, de modo
 * que un participante del hilo sin `nexus_link.whatsapp.read` puede leerlo por
 * PostgREST y por realtime. Está medido y reproducido en
 * `tests/db/t-link-b1-02-channel-rls.test.ts`, bajo «HALLAZGO ABIERTO».
 *
 * Su cierre exige una migración (`0239`) y queda pendiente de Dirección. Se
 * deja escrito acá para que nadie lea este módulo y concluya que el teléfono
 * está protegido en todas partes: no lo está.
 *
 * ─── LO QUE NUNCA SE HACE ──────────────────────────────────────────────────
 *
 * No se registra el teléfono en ningún log, traza ni mensaje de error: los
 * errores de esta función son silenciosos por diseño (devuelven `null`), porque
 * un `console.error` con la fila adentro filtraría el dato al servidor de logs,
 * que no tiene la capacidad de canal de nadie.
 */

import { createClient } from "@/lib/supabase/server";
import { canChannel } from "@/lib/rbac/nexus-link";
import { resolverContactoWa, type WaContactIdentity } from "@/lib/whatsapp/contact-identity";

export type { WaContactIdentity };

/** Puerto estrecho: lo mínimo para decidir. Permite probar sin red ni Supabase. */
export interface WaContactPort {
  /** Fila de conversación tal como la deja pasar la RLS, o `null`. */
  leerConversacion(conversationId: string): Promise<{
    kind: string;
    title: string | null;
    contextId: string | null;
  } | null>;
  /** ¿La sesión tiene `nexus_link.whatsapp.read`? */
  puedeLeerWhatsapp(): Promise<boolean>;
}

/**
 * Núcleo de la decisión, sin IO.
 *
 * Se lee la fila PRIMERO para que la RLS sea la que decide en primer lugar: si
 * la base no la deja salir, acá no hay nada que autorizar ni que filtrar. La
 * comprobación de capacidad que viene después es una segunda barrera
 * independiente, no la principal. Las tres salidas `null` son la misma para el
 * llamador.
 */
export async function resolverFichaAutorizada(
  conversationId: string,
  port: WaContactPort,
): Promise<WaContactIdentity | null> {
  const fila = await port.leerConversacion(conversationId);
  if (!fila) return null;
  if (fila.kind !== "whatsapp") return null;
  if (!(await port.puedeLeerWhatsapp())) return null;
  return resolverContactoWa(fila);
}

/**
 * Ficha de contacto del hilo, o `null` si el llamador no puede tenerla.
 *
 * Usa el cliente de SESIÓN —nunca `service_role`—, así que la RLS es la que
 * decide en primer lugar y esta función no puede ampliarle el alcance a nadie.
 */
export async function getWaContact(conversationId: string): Promise<WaContactIdentity | null> {
  const supabase = createClient();
  if (!supabase) return null; // sin base no hay dato personal que servir

  return resolverFichaAutorizada(conversationId, {
    async leerConversacion(id) {
      const { data, error } = await supabase
        .from("connect_conversations")
        .select("kind, title, context_id")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      const fila = data as { kind: string; title: string | null; context_id: string | null };
      return { kind: fila.kind, title: fila.title, contextId: fila.context_id };
    },
    puedeLeerWhatsapp: () => canChannel("nexus_link.whatsapp.read"),
  });
}

import "server-only";
import { randomUUID } from "node:crypto";
import { relayToMake } from "./make-relay";
import type {
  ClaimedMakeRelay,
  MakeRelayWorkerPorts,
} from "./make-relay-worker";

type AdminClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  from?: (table: string) => any;
};

export function getContextIdCandidates(rawPhone: string): string[] {
  const digits = String(rawPhone).replace(/\D/g, "");
  const set = new Set<string>();
  if (digits) {
    set.add(`wa:${digits}`);
    set.add(`wa:+${digits}`);
    set.add(`+${digits}`);
    set.add(digits);
    if (digits.startsWith("549") && digits.length >= 12) {
      const sin9 = `54${digits.slice(3)}`;
      set.add(`wa:${sin9}`);
      set.add(`wa:+${sin9}`);
      set.add(`+${sin9}`);
      set.add(sin9);
    } else if (digits.startsWith("54") && !digits.startsWith("549") && digits.length >= 10) {
      const con9 = `549${digits.slice(2)}`;
      set.add(`wa:${con9}`);
      set.add(`wa:+${con9}`);
      set.add(`+${con9}`);
      set.add(con9);
    }
  }
  return Array.from(set);
}

export function createSupabaseMakeRelayPorts(admin: AdminClient): MakeRelayWorkerPorts {
  return {
    newToken: () => randomUUID(),

    async claim(token, limit, relayKey): Promise<ClaimedMakeRelay[]> {
      const { data, error } = await admin.rpc("wa_claim_make_relay", {
        p_token: token,
        p_limit: limit,
        p_relay_key: relayKey ?? null,
      });
      if (error) throw new Error("relay_claim_failed");
      return ((data ?? []) as Array<{
        id: number | string;
        relay_key: string;
        raw_body: string;
        signature_header: string | null;
        attempts: number;
      }>).map((row) => ({
        id: Number(row.id),
        relayKey: row.relay_key,
        rawBody: row.raw_body,
        signatureHeader: row.signature_header,
        attempts: Number(row.attempts),
      }));
    },

    async deliver(row) {
      if (typeof admin.from === "function") {
        let fromNum: unknown;
        try {
          const payload = JSON.parse(row.rawBody);
          const entry = payload?.entry?.[0]?.changes?.[0]?.value;
          fromNum = entry?.messages?.[0]?.from;
        } catch {
          // Un payload que no representa un mensaje entrante no requiere
          // handover (por ejemplo, un status). Conserva el relay estándar.
        }

        if (fromNum) {
          const candidates = getContextIdCandidates(String(fromNum));
          const { data: convs, error: conversationError } = await admin
            .from("connect_conversations")
            // 0260 sólo define estas dos columnas. La selección anterior
            // pedía `is_bot_active`, `assigned_to` y `assigned_profile_id`,
            // que no existen en el esquema vivo: PostgREST devolvía error y
            // el worker continuaba sin haber leído el handover.
            .select("id, handover_state")
            .in("context_id", candidates)
            .limit(1);

          // Fail-closed: tanto un error estructurado como una excepción de
          // red/transporte se propagan al worker para reencolar la outbox.
          // Nunca se entrega a Max sin acreditar antes el handover.
          if (conversationError) throw new Error("handover_state_unavailable");

          const conv = Array.isArray(convs) ? convs[0] : convs;

          if (conv?.handover_state === "PAUSED_HUMAN") {
            // 0260 vuelve `handover_state` la fuente canónica. El trigger
            // pausa el hilo en la misma transacción que inserta la primera
            // respuesta humana; una reactivación manual posterior debe
            // prevalecer y no puede ser anulada por mensajes históricos.
            console.log(`[whatsapp] Relay omitido por Handover activo (conv=${conv.id})`);
            return { ok: true, state: "delivered" };
          }
        }
      }

      return relayToMake(row.rawBody, row.signatureHeader, {
        enabled: true,
        endpoint: process.env.WHATSAPP_MAKE_RELAY_URL,
        relayId: row.relayKey,
        timeoutMs: Number(process.env.WHATSAPP_MAKE_RELAY_TIMEOUT_MS) || undefined,
      });
    },

    async release(id, token, outcome, error) {
      const { data, error: rpcError } = await admin.rpc("wa_release_make_relay", {
        p_id: id,
        p_token: token,
        p_outcome: outcome,
        p_error: error,
      });
      if (rpcError) throw new Error("relay_release_failed");
      return String(data ?? "not_claimed") as
        | "delivered"
        | "requeued"
        | "dead"
        | "not_claimed";
    },
  };
}

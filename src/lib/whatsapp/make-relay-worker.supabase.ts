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
        try {
          const payload = JSON.parse(row.rawBody);
          const entry = payload?.entry?.[0]?.changes?.[0]?.value;
          const fromNum = entry?.messages?.[0]?.from;
          if (fromNum) {
            const phoneFormatted = String(fromNum).replace(/\D/g, "");
            const { data: conv } = await admin
              .from("connect_conversations")
              .select("handover_state")
              .eq("kind", "whatsapp")
              .eq("context_id", phoneFormatted)
              .maybeSingle();

            if (conv?.handover_state === "PAUSED_HUMAN") {
              console.log("[whatsapp] Relay omitido por Handover activo");
              return { ok: true, state: "delivered" };
            }
          }
        } catch {
          // continuar con relay standard si no es parseable
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

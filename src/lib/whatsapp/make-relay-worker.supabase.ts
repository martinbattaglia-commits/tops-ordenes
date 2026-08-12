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

    deliver: (row) =>
      relayToMake(row.rawBody, row.signatureHeader, {
        enabled: true,
        endpoint: process.env.WHATSAPP_MAKE_RELAY_URL,
        relayId: row.relayKey,
        timeoutMs: Number(process.env.WHATSAPP_MAKE_RELAY_TIMEOUT_MS) || undefined,
      }),

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

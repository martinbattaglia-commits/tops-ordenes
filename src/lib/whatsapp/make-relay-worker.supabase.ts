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
        try {
          const payload = JSON.parse(row.rawBody);
          const entry = payload?.entry?.[0]?.changes?.[0]?.value;
          const fromNum = entry?.messages?.[0]?.from;
          if (fromNum) {
            const candidates = getContextIdCandidates(String(fromNum));
            const { data: convs } = await admin
              .from("connect_conversations")
              .select("id, handover_state, is_bot_active, assigned_to, assigned_profile_id")
              .in("context_id", candidates)
              .limit(1);

            const conv = Array.isArray(convs) ? convs[0] : convs;

            if (conv) {
              // 1. Si el hilo está en PAUSED_HUMAN, bot desactivado o asignado a operador humano
              if (
                conv.handover_state === "PAUSED_HUMAN" ||
                conv.is_bot_active === false ||
                conv.assigned_to != null ||
                conv.assigned_profile_id != null
              ) {
                console.log(`[whatsapp] Relay omitido por Handover activo (conv=${conv.id})`);
                return { ok: true, state: "delivered" };
              }

              // 2. Comprobar si el último mensaje saliente fue enviado por un operador humano (no Max Bot)
              const { data: recentMsgs } = await admin
                .from("connect_messages")
                .select("id, author_participant_id, author_profile_id, meta, created_at")
                .eq("conversation_id", conv.id)
                .order("created_at", { ascending: false })
                .limit(10);

              if (recentMsgs && recentMsgs.length > 0) {
                const lastOutbound = (recentMsgs as Array<Record<string, any>>).find((m) => {
                  const meta = m.meta ?? {};
                  const waMeta = meta.wa ?? {};
                  return (
                    meta.direction === "outbound" ||
                    waMeta.direction === "outbound" ||
                    m.author_profile_id != null
                  );
                });

                if (lastOutbound) {
                  const meta = lastOutbound.meta ?? {};
                  const waMeta = meta.wa ?? {};
                  const isMaxBot =
                    meta.sent_by === "max_bot" ||
                    meta.author === "max_bot" ||
                    meta.source === "make_relay" ||
                    meta.is_bot === true ||
                    waMeta.sent_by === "max_bot";

                  if (!isMaxBot) {
                    console.log(`[whatsapp] Relay omitido: último mensaje saliente de operador humano (conv=${conv.id})`);
                    if (conv.handover_state !== "PAUSED_HUMAN") {
                      await admin
                        .from("connect_conversations")
                        .update({
                          handover_state: "PAUSED_HUMAN",
                          handover_at: new Date().toISOString(),
                        })
                        .eq("id", conv.id);
                    }
                    return { ok: true, state: "delivered" };
                  }
                }
              }
            }
          }
        } catch {
          // continuar con relay standard ante excepciones no controladas de parsing
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

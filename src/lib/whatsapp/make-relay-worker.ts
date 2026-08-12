import type { MakeRelayResult } from "./make-relay";

/** Fila durable, ya verificada por HMAC y encolada en la transacción de custodia. */
export interface ClaimedMakeRelay {
  id: number;
  relayKey: string;
  rawBody: string;
  signatureHeader: string | null;
  attempts: number;
}

export interface MakeRelayWorkerPorts {
  newToken(): string;
  claim(token: string, limit: number, relayKey?: string): Promise<ClaimedMakeRelay[]>;
  deliver(row: ClaimedMakeRelay): Promise<MakeRelayResult>;
  release(
    id: number,
    token: string,
    outcome: "delivered" | "retryable",
    error: string | null,
  ): Promise<"delivered" | "requeued" | "dead" | "not_claimed">;
}

export interface MakeRelayWorkerResult {
  claimed: number;
  delivered: number;
  requeued: number;
  dead: number;
  errors: string[];
}

/**
 * Un intento at-least-once. La identidad estable viaja en `x-nexus-relay-id`;
 * un timeout ambiguo se reintenta con la MISMA identidad y nunca se descarta.
 */
export async function consumeMakeRelayBatch(
  ports: MakeRelayWorkerPorts,
  options: { limit?: number; relayKey?: string } = {},
): Promise<MakeRelayWorkerResult> {
  const result: MakeRelayWorkerResult = {
    claimed: 0,
    delivered: 0,
    requeued: 0,
    dead: 0,
    errors: [],
  };
  const token = ports.newToken();
  let rows: ClaimedMakeRelay[];
  try {
    // Claim estricto de UNA fila: attempts sólo se incrementa para el egress
    // que esta invocación efectivamente comienza.
    rows = await ports.claim(token, 1, options.relayKey);
  } catch {
    result.errors.push("claim_failed");
    return result;
  }
  result.claimed = rows.length;

  for (const row of rows) {
    let delivery: MakeRelayResult;
    try {
      delivery = await ports.deliver(row);
    } catch {
      delivery = { ok: false, state: "network" };
    }

    const outcome = delivery.ok && delivery.state === "delivered" ? "delivered" : "retryable";
    const error = outcome === "delivered" ? null : delivery.state;
    let state: Awaited<ReturnType<MakeRelayWorkerPorts["release"]>>;
    try {
      state = await ports.release(row.id, token, outcome, error);
    } catch {
      result.errors.push("release_failed");
      continue;
    }
    if (state === "delivered") result.delivered += 1;
    else if (state === "requeued") result.requeued += 1;
    else if (state === "dead") result.dead += 1;
  }

  return result;
}

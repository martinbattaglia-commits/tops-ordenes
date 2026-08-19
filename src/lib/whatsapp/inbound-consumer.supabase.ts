import "server-only";
import { randomUUID } from "node:crypto";
import { parseInboundPayload } from "./inbound";
import { projectInbound, isProjectionComplete } from "./link-projection";
import { createSupabaseProjectionPort } from "./link-projection.supabase";
import { metaDownloadTransport } from "./media-transport";
import { parseOperatorProfileIds } from "./operators";
import type { InboundConsumerPorts, ClaimedEvent } from "./inbound-consumer";

/**
 * inbound-consumer.supabase.ts — LINK-WA WA-8R9 · M-4 · puertos del consumidor.
 *
 * Adaptador delgado: el claim atómico, el backoff y el lease viven en las RPC de
 * 0229, porque la concurrencia entre dos workers sólo se resuelve de verdad en
 * el motor. Acá se cablean esas RPC y se reutiliza EXACTAMENTE el mismo
 * proyector que usa el webhook, de modo que reprocesar un evento de la cola es
 * indistinguible de haberlo procesado en vivo.
 */

type AdminClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (t: string) => unknown;
};

export function createSupabaseInboundConsumerPorts(admin: AdminClient): InboundConsumerPorts {
  return {
    // El token identifica a ESTE worker. Se genera por lote, no por proceso: un
    // worker que se cuelga y revive no debe poder liberar trabajo ya retomado.
    newToken: () => randomUUID(),

    async claim(token, limit): Promise<ClaimedEvent[]> {
      const { data, error } = await admin.rpc("wa_claim_inbound_events", {
        p_token: token,
        p_limit: limit,
      });
      if (error) throw new Error(`claim: ${error.message}`);
      const filas = (data ?? []) as Array<{ seq: number | string; payload: unknown; attempts: number }>;
      return filas.map((f) => ({
        seq: Number(f.seq),
        payload: f.payload,
        attempts: Number(f.attempts),
      }));
    },

    async release(seq, token, outcome, error) {
      const { data, error: err } = await admin.rpc("wa_release_inbound_event", {
        p_seq: seq,
        p_token: token,
        p_outcome: outcome,
        p_error: error,
      });
      if (err) throw new Error(`release: ${err.message}`);
      return String(data ?? "not_claimed");
    },

    async project(payload) {
      // MISMO parser y MISMO proyector que el webhook: si divergieran, la cola
      // aplicaría una semántica distinta a la del camino en vivo y el reproceso
      // dejaría de ser equivalente.
      const parsed = parseInboundPayload(payload, process.env.META_WA_PHONE_NUMBER_ID);
      if (!parsed.ok) {
        // HIGH-3 · el motivo se propaga TAL CUAL, sin aplanarlo a `malformed`.
        //
        // `tenant_unresolved` es falta de configuración del proceso, no un
        // defecto del evento: el núcleo lo clasifica como transitorio y el
        // evento vuelve a la cola. Aplanarlo a `malformed` lo volvía terminal y
        // descartaba un hecho de Meta por una variable de entorno sin poner.
        //
        // `not_whatsapp_object`, `not_object` y `tenant_mismatch` sí son
        // permanentes: describen un payload que este tenant nunca va a proyectar.
        return { complete: false, errors: [parsed.reason] };
      }
      const operadores = parseOperatorProfileIds();
      const resultado = await projectInbound(
        { messages: parsed.messages, statuses: parsed.statuses },
        createSupabaseProjectionPort(admin as never, metaDownloadTransport()),
        operadores.ids,
      );
      return { complete: isProjectionComplete(resultado), errors: resultado.errors };
    },
  };
}

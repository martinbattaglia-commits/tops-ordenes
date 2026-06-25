// Adapter (driven) · IngestPort sobre la RPC DEFINER `prospeccion_ingest` (Persistencia §2.2).
// La RPC está revocada de anon/authenticated y concedida a service_role → este adapter DEBE
// recibir un cliente con service_role (createAdminClient), no el de sesión. La atomicidad
// (prospect + 2 eventos al Outbox en una tx) la garantiza la función PL/pgSQL.
import { type Result, ok, err } from "../../domain/result";
import { domainError } from "../../domain/errors";
import type { IngestPort, ProspectIngestRow, IngestResult } from "../../ports/ingest.port";
import type { SourceSlugValue } from "../../domain/vo/source-slug";

/** Superficie mínima del cliente Supabase que este adapter necesita (RPC). */
export interface RpcCapableClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export class SupabaseIngestAdapter implements IngestPort {
  constructor(private readonly client: RpcCapableClient) {}

  async ingest(
    rows: ReadonlyArray<ProspectIngestRow>,
    source: SourceSlugValue,
  ): Promise<Result<IngestResult>> {
    try {
      const { data, error } = await this.client.rpc("prospeccion_ingest", {
        p_rows: rows,
        p_source: source,
      });
      if (error) return err(domainError("INGEST_FAILED", error.message));
      const r = (data ?? {}) as { inserted?: number; duplicates?: number };
      return ok({ inserted: r.inserted ?? 0, duplicates: r.duplicates ?? 0 });
    } catch (e) {
      return err(domainError("INGEST_FAILED", e instanceof Error ? e.message : String(e)));
    }
  }
}

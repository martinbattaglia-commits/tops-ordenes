import { describe, it, expect } from "vitest";
import { SupabaseIngestAdapter, type RpcCapableClient } from "./supabase-ingest.adapter";

const ROW = {
  company_name: "ACME", cuit: null, website: null, full_name: null, cargo: null,
  email: "a@x.com", phone: null, linkedin_url: null, raw: {},
};

describe("SupabaseIngestAdapter", () => {
  it("invoca prospeccion_ingest con p_rows/p_source y mapea el resultado", async () => {
    let calledFn = "";
    let calledArgs: Record<string, unknown> = {};
    const client: RpcCapableClient = {
      async rpc(fn, args) {
        calledFn = fn;
        calledArgs = args;
        return { data: { inserted: 1, duplicates: 0 }, error: null };
      },
    };
    const r = await new SupabaseIngestAdapter(client).ingest([ROW], "csv");
    expect(calledFn).toBe("prospeccion_ingest");
    expect(calledArgs.p_source).toBe("csv");
    expect(Array.isArray(calledArgs.p_rows)).toBe(true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ inserted: 1, duplicates: 0 });
  });

  it("convierte un error de la RPC en INGEST_FAILED (no lanza)", async () => {
    const client: RpcCapableClient = {
      async rpc() {
        return { data: null, error: { message: "permission denied" } };
      },
    };
    const r = await new SupabaseIngestAdapter(client).ingest([ROW], "csv");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INGEST_FAILED");
  });

  it("captura excepciones inesperadas como INGEST_FAILED", async () => {
    const client: RpcCapableClient = {
      async rpc() {
        throw new Error("network");
      },
    };
    const r = await new SupabaseIngestAdapter(client).ingest([ROW], "csv");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INGEST_FAILED");
  });
});

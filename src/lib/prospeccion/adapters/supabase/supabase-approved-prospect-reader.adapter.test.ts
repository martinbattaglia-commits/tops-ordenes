import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseApprovedProspectReaderAdapter } from "./supabase-approved-prospect-reader.adapter";

interface QueryResponse {
  data: unknown[] | null;
  error: { message: string } | null;
}

function fakeClient(response: QueryResponse) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query = {
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return query;
    },
    in(...args: unknown[]) {
      calls.push({ method: "in", args });
      return query;
    },
    async eq(...args: unknown[]) {
      calls.push({ method: "eq", args });
      return response;
    },
  };
  const client = {
    from(...args: unknown[]) {
      calls.push({ method: "from", args });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("SupabaseApprovedProspectReaderAdapter", () => {
  it("mantiene el filtro aprobado y mapea la fila al DTO del puerto", async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          id: "p1",
          company_name: "ACME",
          full_name: "Ada Lovelace",
          cargo: "COO",
          email: "ada@acme.test",
          phone: "+5491100000000",
          website: "https://acme.test",
          cuit: "20123456786",
          linkedin_url: "https://linkedin.test/ada",
          status: "aprobado",
        },
      ],
      error: null,
    });

    const result = await new SupabaseApprovedProspectReaderAdapter(client).loadApproved([
      "p1",
      "p2",
    ]);

    expect(calls).toEqual([
      { method: "from", args: ["prospeccion_prospects"] },
      {
        method: "select",
        args: [
          "id, company_name, full_name, cargo, email, phone, website, cuit, linkedin_url, status",
        ],
      },
      { method: "in", args: ["id", ["p1", "p2"]] },
      { method: "eq", args: ["status", "aprobado"] },
    ]);
    expect(result).toEqual({
      ok: true,
      prospects: [
        {
          prospect_id: "p1",
          company_name: "ACME",
          full_name: "Ada Lovelace",
          cargo: "COO",
          email: "ada@acme.test",
          phone: "+5491100000000",
          website: "https://acme.test",
          cuit: "20123456786",
          linkedin_url: "https://linkedin.test/ada",
        },
      ],
    });
  });

  it("propaga el mensaje de error para que el caso de uso preserve su contrato", async () => {
    const { client } = fakeClient({ data: null, error: { message: "permission denied" } });

    await expect(
      new SupabaseApprovedProspectReaderAdapter(client).loadApproved(["p1"]),
    ).resolves.toEqual({ ok: false, errorMessage: "permission denied" });
  });
});

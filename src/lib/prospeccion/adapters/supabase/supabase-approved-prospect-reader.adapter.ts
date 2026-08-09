import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ApprovedProspectReadResult,
  ApprovedProspectReaderPort,
  ProspectToExport,
} from "../../ports/clientify-export.port";

interface ProspectRow {
  id: string;
  company_name: string | null;
  full_name: string | null;
  cargo: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  cuit: string | null;
  linkedin_url: string | null;
}

/** Implementación Supabase del puerto de lectura usado por ExportToClientify. */
export class SupabaseApprovedProspectReaderAdapter implements ApprovedProspectReaderPort {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadApproved(
    prospectIds: readonly string[],
  ): Promise<ApprovedProspectReadResult> {
    const { data, error } = await this.supabase
      .from("prospeccion_prospects")
      .select(
        "id, company_name, full_name, cargo, email, phone, website, cuit, linkedin_url, status",
      )
      .in("id", [...prospectIds])
      .eq("status", "aprobado");

    if (error) return { ok: false, errorMessage: error.message };

    return {
      ok: true,
      prospects: ((data ?? []) as ProspectRow[]).map((row) => ({
        prospect_id: row.id,
        company_name: row.company_name,
        full_name: row.full_name,
        cargo: row.cargo,
        email: row.email,
        phone: row.phone,
        website: row.website,
        cuit: row.cuit,
        linkedin_url: row.linkedin_url,
      })),
    };
  }
}

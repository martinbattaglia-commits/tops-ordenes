// Adapter (driven) · QualificationPort + ApprovalPort sobre RPCs DEFINER.
// Las RPCs están revocadas de anon/authenticated y concedidas a service_role →
// este adapter DEBE recibir un cliente con service_role (createAdminClient).
import type { QualificationPort, ApprovalPort, QualificationRecord } from '../../ports/qualification.port';

/** Superficie mínima del cliente Supabase que este adapter necesita. */
export interface RpcCapableClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

/** Forma del objeto que la RPC `prospeccion_record_qualification` espera en p_rows. */
interface QualificationRpcRow {
  prospect_id: string;
  company_profile: {
    industry: string | null;
    industry_normalized: string | null;
    employees_raw: number | null;
    employee_band: string | null;
    country: string | null;
    is_argentina: boolean;
    is_b2b: boolean;
    has_depositos: boolean;
    has_import_export: boolean;
    has_distribucion_nacional: boolean;
    has_cds: boolean;
    terceriza_almacenamiento: boolean;
    dentro_mercado_objetivo: boolean;
    growth_signal: string;
    profile_raw: Record<string, unknown>;
  };
  score: number;
  confidence: number;
  priority_tier: string;
  priority_value: number;
  decision: string;
  explanation: string;
  factors: unknown;
  penalties: unknown;
  hard_fails: ReadonlyArray<string>;
  decision_trace: unknown;
  business_unit: string;
  model_version: string;
  strategy_id: string;
  icp_config_version: string;
  confidence_version: string;
  created_by: string | null;
}

export class SupabaseQualificationAdapter implements QualificationPort, ApprovalPort {
  constructor(private readonly client: RpcCapableClient) {}

  async persistQualifications(
    records: QualificationRecord[],
    actorId: string | null,
  ): Promise<{ persisted: number; errors: number }> {
    let persisted = 0;
    let errors = 0;

    for (const record of records) {
      const { result, trace } = record;

      const row: QualificationRpcRow = {
        prospect_id: record.prospect_id,
        company_profile: {
          industry: result.profile.industry,
          industry_normalized: result.profile.industryNormalized,
          employees_raw: result.profile.employeesRaw,
          employee_band: result.profile.employeeBand,
          country: result.profile.country,
          is_argentina: result.profile.isArgentina,
          is_b2b: result.profile.isB2B,
          has_depositos: result.profile.hasDepositos,
          has_import_export: result.profile.hasImportExport,
          has_distribucion_nacional: result.profile.hasDistribucionNacional,
          has_cds: result.profile.hasCds,
          terceriza_almacenamiento: result.profile.tercerizaAlmacenamiento,
          dentro_mercado_objetivo: result.profile.dentroMercadoObjetivo,
          growth_signal: result.profile.growthSignal,
          profile_raw: result.profile.profileInputs,
        },
        score: result.score,
        confidence: result.confidence,
        priority_tier: result.priority.tier,
        priority_value: result.priority.value,
        decision: result.decision,
        explanation: result.explanation,
        factors: result.factors,
        penalties: result.penalties,
        hard_fails: result.hardFails,
        decision_trace: trace,
        business_unit: result.businessUnit,
        model_version: result.modelVersion,
        strategy_id: result.strategyId,
        icp_config_version: result.icpConfigVersion,
        confidence_version: result.confidenceVersion,
        created_by: actorId,
      };

      try {
        const { error } = await this.client.rpc('prospeccion_record_qualification', {
          p_rows: [row],
        });
        if (error) {
          console.error(
            `[SupabaseQualificationAdapter] RPC error for prospect ${record.prospect_id}:`,
            error.message,
          );
          errors++;
        } else {
          persisted++;
        }
      } catch (e) {
        console.error(
          `[SupabaseQualificationAdapter] Unexpected error for prospect ${record.prospect_id}:`,
          e instanceof Error ? e.message : String(e),
        );
        errors++;
      }
    }

    return { persisted, errors };
  }

  async approveProspect(
    prospectId: string,
    actorId: string,
  ): Promise<{ ok: boolean }> {
    try {
      const { error } = await this.client.rpc('prospeccion_approve_prospect', {
        p_prospect_id: prospectId,
        p_actor_id: actorId,
      });
      if (error) {
        console.error(
          `[SupabaseQualificationAdapter] approveProspect error for ${prospectId}:`,
          error.message,
        );
        return { ok: false };
      }
      return { ok: true };
    } catch (e) {
      console.error(
        `[SupabaseQualificationAdapter] approveProspect unexpected error for ${prospectId}:`,
        e instanceof Error ? e.message : String(e),
      );
      return { ok: false };
    }
  }

  async rejectProspect(
    prospectId: string,
    actorId: string,
    reason: string,
  ): Promise<{ ok: boolean }> {
    try {
      const { error } = await this.client.rpc('prospeccion_reject_prospect', {
        p_prospect_id: prospectId,
        p_actor_id: actorId,
        p_reason: reason,
      });
      if (error) {
        console.error(
          `[SupabaseQualificationAdapter] rejectProspect error for ${prospectId}:`,
          error.message,
        );
        return { ok: false };
      }
      return { ok: true };
    } catch (e) {
      console.error(
        `[SupabaseQualificationAdapter] rejectProspect unexpected error for ${prospectId}:`,
        e instanceof Error ? e.message : String(e),
      );
      return { ok: false };
    }
  }
}

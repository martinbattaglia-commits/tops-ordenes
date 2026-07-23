// Caso de uso · QualifyProspects. Orquesta: corre el motor puro qualify() por cada prospecto,
// descarta los que fallan sin bloquear el lote, delega persistencia en QualificationPort.
// Depende SOLO de ports (AP-3/AP-15): ninguna dependencia de infraestructura directa.
import { qualify } from '../qualification/qualify';
import type { QualificationPort, ProspectToQualify, QualificationRecord } from '../ports/qualification.port';
import type { IcpConfig } from '../qualification/types';
import { ICP_GENERAL_V1 } from '../qualification/icp-config';
import { type Result, ok } from '../domain/result';

export interface QualifyProspectsInput {
  prospects: ProspectToQualify[];
  icpConfig?: IcpConfig;
  actorId: string | null;
}

export interface QualifyProspectsOutput {
  qualified: number;
  errors: number;
  results: Array<{
    prospect_id: string;
    score: number;
    decision: string;
    explanation: string;
  }>;
}

export class QualifyProspectsUseCase {
  constructor(private readonly port: QualificationPort) {}

  async execute(input: QualifyProspectsInput): Promise<Result<QualifyProspectsOutput>> {
    const icp = input.icpConfig ?? ICP_GENERAL_V1;
    const records: QualificationRecord[] = [];
    let qualErrors = 0;

    for (const p of input.prospects) {
      const r = qualify(
        {
          raw: p.raw,
          company_name: p.company_name,
          cargo: p.cargo,
          email: p.email,
          website: p.website,
          cuit: p.cuit,
          linkedin_url: p.linkedin_url,
        },
        icp,
      );

      if (r.ok) {
        records.push({
          prospect_id: p.prospect_id,
          result: r.value.result,
          trace: r.value.trace,
        });
      } else {
        console.warn(
          `[QualifyProspectsUseCase] qualify() failed for prospect ${p.prospect_id}:`,
          r.error,
        );
        qualErrors++;
      }
    }

    if (records.length === 0) {
      return ok({ qualified: 0, errors: qualErrors, results: [] });
    }

    const { persisted, errors: persistErrors } = await this.port.persistQualifications(
      records,
      input.actorId,
    );

    return ok({
      qualified: persisted,
      errors: qualErrors + persistErrors,
      results: records.map((rec) => ({
        prospect_id: rec.prospect_id,
        score: rec.result.score,
        decision: rec.result.decision,
        explanation: rec.result.explanation,
      })),
    });
  }
}

// Port (driven) · QualificationPort + ApprovalPort — escritura y transiciones de calificación.
// La RPC `prospeccion_record_qualification` es atómica (qualification + evento al Outbox).
// `prospeccion_approve_prospect` y `prospeccion_reject_prospect` ejecutan la FSM de estado.
import type { QualificationResult, DecisionTrace } from '../qualification/types';

export interface ProspectToQualify {
  prospect_id: string;
  raw: Record<string, unknown>;
  company_name: string | null;
  cargo: string | null;
  email: string | null;
  website: string | null;
  cuit: string | null;
  linkedin_url: string | null;
}

export interface QualificationRecord {
  prospect_id: string;
  result: QualificationResult;
  trace: DecisionTrace;
}

export interface QualificationPort {
  persistQualifications(
    records: QualificationRecord[],
    actorId: string | null,
  ): Promise<{ persisted: number; errors: number }>;
}

export interface ApprovalPort {
  approveProspect(prospectId: string, actorId: string): Promise<{ ok: boolean }>;
  rejectProspect(prospectId: string, actorId: string, reason: string): Promise<{ ok: boolean }>;
}

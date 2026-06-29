// Caso de uso · ApproveProspect. Encapsula la transición de estado aprobado/rechazado
// delegando en ApprovalPort (sin lógica de infraestructura directa).
import type { ApprovalPort } from '../ports/qualification.port';
import { type Result, ok, err } from '../domain/result';
import { domainError } from '../domain/errors';

export class ApproveProspectUseCase {
  constructor(private readonly port: ApprovalPort) {}

  async approve(prospectId: string, actorId: string): Promise<Result<{ ok: boolean }>> {
    try {
      const result = await this.port.approveProspect(prospectId, actorId);
      if (!result.ok) {
        return err(
          domainError(
            'ILLEGAL_TRANSITION',
            `No se pudo aprobar el prospecto ${prospectId}. La RPC retornó error.`,
            { prospectId, actorId },
          ),
        );
      }
      return ok({ ok: true });
    } catch (e) {
      return err(
        domainError(
          'ILLEGAL_TRANSITION',
          `Error inesperado al aprobar el prospecto ${prospectId}: ${e instanceof Error ? e.message : String(e)}`,
          { prospectId, actorId },
        ),
      );
    }
  }

  async reject(
    prospectId: string,
    actorId: string,
    reason: string,
  ): Promise<Result<{ ok: boolean }>> {
    try {
      const result = await this.port.rejectProspect(prospectId, actorId, reason);
      if (!result.ok) {
        return err(
          domainError(
            'ILLEGAL_TRANSITION',
            `No se pudo rechazar el prospecto ${prospectId}. La RPC retornó error.`,
            { prospectId, actorId, reason },
          ),
        );
      }
      return ok({ ok: true });
    } catch (e) {
      return err(
        domainError(
          'ILLEGAL_TRANSITION',
          `Error inesperado al rechazar el prospecto ${prospectId}: ${e instanceof Error ? e.message : String(e)}`,
          { prospectId, actorId, reason },
        ),
      );
    }
  }
}

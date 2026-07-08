// Caso de uso · ExportToClientify (F2 Prospección Inteligente).
//
// Orquesta:
//   1. Valida que se reciban IDs a exportar.
//   2. Carga los prospectos con status 'aprobado' (filtrado por IDs).
//   3. Delega la exportación y registro al ClientifyExportAdapter.
//   4. Devuelve un resumen tipado vía Result<ExportSummary>.
//
// Depende SOLO de puertos abstractos (AP-3/AP-15):
//   - ClientifyExportAdapter (driven)
//   - SupabaseClient (para fetch de prospectos)
//
// Errores de dominio: EXPORT_FAILED / NOT_FOUND (errors.ts).

import { type Result, ok, err } from "../domain/result";
import { domainError } from "../domain/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ClientifyExportAdapter,
  type ProspectToExport,
  type ExportResult,
} from "../adapters/clientify/clientify-export.adapter";

// ---------------------------------------------------------------------------
// Tipos públicos del caso de uso
// ---------------------------------------------------------------------------

export interface ExportToClientifyInput {
  /** IDs de prospectos a exportar (deben estar en status 'aprobado'). */
  readonly prospectIds: string[];
  /** UUID del usuario autenticado que dispara la exportación. */
  readonly actorId: string;
}

export interface ExportSummary {
  /** Total de prospectos procesados (solo los que estaban en 'aprobado'). */
  readonly processed: number;
  /** Cuántos se exportaron con éxito a Clientify. */
  readonly totalOk: number;
  /** Cuántos fallaron. */
  readonly totalErrors: number;
  /** IDs que se pidieron pero no estaban en status 'aprobado'. */
  readonly skipped: string[];
  /** Detalle por prospecto. */
  readonly results: ExportResult[];
}

// ---------------------------------------------------------------------------
// Fila mínima que se lee de prospeccion_prospects
// ---------------------------------------------------------------------------

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
  status: string;
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ExportToClientifyUseCase {
  constructor(
    private readonly exportAdapter: ClientifyExportAdapter,
    private readonly supabase: SupabaseClient,
  ) {}

  async execute(input: ExportToClientifyInput): Promise<Result<ExportSummary>> {
    // -- Guardia mínima -------------------------------------------------------
    if (input.prospectIds.length === 0) {
      return err(domainError("EXPORT_FAILED", "Se requiere al menos un prospecto para exportar."));
    }
    if (!input.actorId) {
      return err(domainError("EXPORT_FAILED", "actorId es obligatorio para el registro de exportación."));
    }

    // -- 1. Cargar prospectos aprobados filtrados por IDs ---------------------
    const { data, error } = await this.supabase
      .from("prospeccion_prospects")
      .select(
        "id, company_name, full_name, cargo, email, phone, website, cuit, linkedin_url, status",
      )
      .in("id", input.prospectIds)
      .eq("status", "aprobado");

    if (error) {
      return err(
        domainError(
          "EXPORT_FAILED",
          `Error al cargar prospectos desde la base de datos: ${error.message}`,
        ),
      );
    }

    const rows = (data ?? []) as ProspectRow[];

    // IDs solicitados que no estaban en status 'aprobado' (ya sincronizados, rechazados, etc.)
    const foundIds = new Set(rows.map((r) => r.id));
    const skipped = input.prospectIds.filter((id) => !foundIds.has(id));

    if (rows.length === 0) {
      // Todos los IDs solicitados están en un status distinto de 'aprobado'.
      return ok({
        processed: 0,
        totalOk: 0,
        totalErrors: 0,
        skipped,
        results: [],
      });
    }

    // -- 2. Mapear a DTO del adapter ------------------------------------------
    const prospectsToExport: ProspectToExport[] = rows.map((r) => ({
      prospect_id: r.id,
      company_name: r.company_name,
      full_name: r.full_name,
      cargo: r.cargo,
      email: r.email,
      phone: r.phone,
      website: r.website,
      cuit: r.cuit,
      linkedin_url: r.linkedin_url,
    }));

    // -- 3. Delegar al adapter ------------------------------------------------
    try {
      const summary = await this.exportAdapter.export(prospectsToExport, input.actorId);

      return ok({
        processed: rows.length,
        totalOk: summary.totalOk,
        totalErrors: summary.totalErrors,
        skipped,
        results: summary.results,
      });
    } catch (e) {
      return err(
        domainError(
          "EXPORT_FAILED",
          `Error inesperado durante la exportación: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }
}

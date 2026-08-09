// Ports (driven) · Lectura de prospectos aprobados y exportación a Clientify.
// Los contratos pertenecen a la aplicación; Supabase y Clientify se cablean
// exclusivamente desde adapters/composition.

export interface ProspectToExport {
  readonly prospect_id: string;
  readonly company_name: string | null;
  readonly full_name: string | null;
  readonly cargo: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly cuit: string | null;
  readonly linkedin_url: string | null;
}

export interface ExportResult {
  readonly prospect_id: string;
  readonly ok: boolean;
  /** ID numérico del contacto en Clientify. Null si falló. */
  readonly clientify_contact_id: number | null;
  /** Mensaje de error legible. Null si fue exitoso. */
  readonly error: string | null;
}

export interface ExportBatchSummary {
  readonly results: ExportResult[];
  readonly totalOk: number;
  readonly totalErrors: number;
}

export type ApprovedProspectReadResult =
  | { readonly ok: true; readonly prospects: ProspectToExport[] }
  | { readonly ok: false; readonly errorMessage: string };

export interface ApprovedProspectReaderPort {
  loadApproved(prospectIds: readonly string[]): Promise<ApprovedProspectReadResult>;
}

export interface ClientifyExportPort {
  export(prospects: ProspectToExport[], exportedBy: string): Promise<ExportBatchSummary>;
}

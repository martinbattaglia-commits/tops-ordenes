// Driven adapter · Exportación de prospectos aprobados a Clientify CRM (F2).
//
// Responsabilidades:
//   1. Crear el contacto en Clientify vía postContact().
//   2. Hacer upsert en prospeccion_crm_refs (prospect_id, crm_provider).
//   3. Avanzar el status del prospecto de 'aprobado' → 'sincronizado'.
//   4. Registrar el lote en prospeccion_export_log (append-only).
//
// Depende de: @/lib/clientify/client (driven/HTTP), SupabaseClient (driven/DB).
// NO conoce al caso de uso que lo llama (Hexagonal AP-3/AP-15).
//
// Nota sobre prospeccion_export_log.exported_by: la columna es UUID (mig 0107).
// El caller pasa un UUID de usuario válido en `exportedBy`.

import {
  postContact,
  searchContactByEmail,
  type CreateContactPayload,
} from "@/lib/clientify/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Divide un nombre completo en first_name / last_name. */
function splitName(fullName: string | null): { firstName: string; lastName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

/** Construye el payload para Clientify a partir de un prospecto. */
function buildContactPayload(p: ProspectToExport): CreateContactPayload {
  const { firstName, lastName } = splitName(p.full_name);
  return {
    first_name: firstName || p.company_name || "Prospecto",
    last_name: lastName,
    title: p.cargo ?? "",
    company_name: p.company_name ?? "",
    emails: p.email ? [{ type: 1, email: p.email }] : [],
    phones: p.phone ? [{ type: 1, phone: p.phone }] : [],
    taxpayer_identification_number: p.cuit ?? "",
    channel: "linkedin",
    contact_source: "Prospección Inteligente TOPS",
    medium: "nexus_prospeccion",
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ClientifyExportAdapter {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Exporta un lote de prospectos aprobados a Clientify.
   *
   * Estrategia de dedup:
   *   - Si el prospecto tiene email, intentamos primero buscar un contacto existente en Clientify.
   *     Si lo encontramos, usamos ese (evitamos duplicados en el CRM).
   *     Si no, creamos uno nuevo con postContact().
   *   - Si no tiene email, siempre crea un contacto nuevo.
   *
   * El `exportedBy` es el UUID del usuario autenticado que dispara la exportación.
   */
  async export(
    prospects: ProspectToExport[],
    exportedBy: string,
  ): Promise<ExportBatchSummary> {
    const results: ExportResult[] = [];

    for (const p of prospects) {
      const result = await this.exportOne(p);
      results.push(result);
    }

    const totalOk = results.filter((r) => r.ok).length;
    const totalErrors = results.filter((r) => !r.ok).length;

    // Registro append-only del lote (prospeccion_export_log, mig 0107).
    // Usamos el cliente de Supabase recibido — el caller es responsable de
    // pasar uno con privilegios suficientes (service_role o policy insert).
    await this.supabase.from("prospeccion_export_log").insert({
      exported_by: exportedBy,
      prospect_count: prospects.length,
      provider: "clientify",
      results: results,
      errors: results.filter((r) => !r.ok),
      total_ok: totalOk,
      total_errors: totalErrors,
    });

    return { results, totalOk, totalErrors };
  }

  // ---------------------------------------------------------------------------
  // Privado
  // ---------------------------------------------------------------------------

  private async exportOne(p: ProspectToExport): Promise<ExportResult> {
    try {
      const clientifyContact = await this.resolveOrCreateContact(p);

      // Upsert en prospeccion_crm_refs.
      // unique(prospect_id, crm_provider) → ON CONFLICT actualiza synced_at y metadata.
      const { error: refError } = await this.supabase
        .from("prospeccion_crm_refs")
        .upsert(
          {
            prospect_id: p.prospect_id,
            crm_provider: "clientify",
            crm_contact_id: String(clientifyContact.id),
            synced_at: new Date().toISOString(),
            sync_version: 1,
            metadata: {
              url: clientifyContact.url,
              name: `${clientifyContact.first_name} ${clientifyContact.last_name}`.trim(),
            },
          },
          { onConflict: "prospect_id,crm_provider" },
        );

      if (refError) {
        return {
          prospect_id: p.prospect_id,
          ok: false,
          clientify_contact_id: null,
          error: `crm_refs upsert failed: ${refError.message}`,
        };
      }

      // Avanza el status a 'sincronizado' solo si sigue en 'aprobado'.
      // Condición .eq('status', 'aprobado') evita pisar transiciones posteriores.
      await this.supabase
        .from("prospeccion_prospects")
        .update({ status: "sincronizado" })
        .eq("id", p.prospect_id)
        .eq("status", "aprobado");

      return {
        prospect_id: p.prospect_id,
        ok: true,
        clientify_contact_id: clientifyContact.id,
        error: null,
      };
    } catch (e) {
      return {
        prospect_id: p.prospect_id,
        ok: false,
        clientify_contact_id: null,
        error: e instanceof Error ? e.message : "Error desconocido al exportar prospecto",
      };
    }
  }

  /**
   * Busca un contacto existente en Clientify por email (si hay email).
   * Si existe lo reutiliza; si no, lo crea con postContact().
   */
  private async resolveOrCreateContact(p: ProspectToExport) {
    if (p.email) {
      const existing = await searchContactByEmail(p.email);
      if (existing) return existing;
    }
    return postContact(buildContactPayload(p));
  }
}

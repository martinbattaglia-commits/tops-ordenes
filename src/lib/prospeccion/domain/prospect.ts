// Aggregate Root `Prospect` (Parte II §1.1). F0: tramo de adquisición (created → imported).
// La factory valida VOs y la invariante de identidad ANTES de producir el snapshot que la RPC
// persiste (CS-RPC-2: la RPC recibe un snapshot pre-validado; no re-valida reglas de negocio).
import { type Result, ok, err } from "./result";
import { domainError } from "./errors";
import type { ProspectId } from "./vo/prospect-id";
import { Email } from "./vo/email";
import { Cuit } from "./vo/cuit";
import { Phone } from "./vo/phone";
import { Website } from "./vo/website";
import type { SourceSlug, SourceSlugValue } from "./vo/source-slug";

/** Entrada cruda por fila (CSV/manual/paste/…), strings sin normalizar. */
export interface ProspectImportInput {
  company_name?: string | null;
  cuit?: string | null;
  website?: string | null;
  full_name?: string | null;
  cargo?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  raw?: Record<string, unknown>;
}

/** Proyección normalizada del AR — lo que viaja a la RPC de ingesta (primitivos, nunca VOs). */
export interface ProspectSnapshot {
  readonly id: ProspectId;
  readonly status: "raw";
  readonly source: SourceSlugValue;
  readonly company_name: string | null;
  readonly cuit: string | null; // dígitos normalizados
  readonly website: string | null;
  readonly full_name: string | null;
  readonly cargo: string | null;
  readonly email: string | null; // lower/trim
  readonly phone: string | null; // solo dígitos
  readonly linkedin_url: string | null;
  readonly raw: Record<string, unknown>;
}

const clean = (s: string | null | undefined): string | null => {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
};

export class Prospect {
  private constructor(private readonly snap: ProspectSnapshot) {}

  get id(): ProspectId {
    return this.snap.id;
  }
  get status(): "raw" {
    return this.snap.status;
  }

  toSnapshot(): ProspectSnapshot {
    return { ...this.snap, raw: { ...this.snap.raw } };
  }

  /**
   * Construye un Prospect nuevo desde una fila de import. Recibe el `ProspectId` ya generado
   * por IdGeneratorPort (ARCH-001: NO lo pide al repositorio). Valida VOs presentes y exige
   * al menos una clave de identidad (INV: sin identidad la fila NO produce evento, 15:157-160).
   */
  static fromImportRow(id: ProspectId, source: SourceSlug, input: ProspectImportInput): Result<Prospect> {
    let email: string | null = null;
    if (clean(input.email) !== null) {
      const r = Email.create(input.email);
      if (!r.ok) return r;
      email = r.value.value;
    }

    let cuit: string | null = null;
    if (clean(input.cuit) !== null) {
      const r = Cuit.create(input.cuit);
      if (!r.ok) return r;
      cuit = r.value.value;
    }

    let website: string | null = null;
    if (clean(input.website) !== null) {
      const r = Website.create(input.website);
      if (!r.ok) return r;
      website = r.value.value;
    }

    let phone: string | null = null;
    if (clean(input.phone) !== null) {
      const r = Phone.create(input.phone);
      if (!r.ok) return r;
      phone = r.value.value;
    }

    const linkedin = clean(input.linkedin_url)?.toLowerCase() ?? null;

    // INV de identidad mínima: al menos una clave (email | cuit | linkedin | phone).
    // CR-HIGH #7 / CC-4: `phone` es clave de IDENTIDAD-DE-ALTA (habilita crear el prospecto) pero
    // NO es señal de DEDUP en F0 — la cadena de dedup es cuit → lower(email) → linkedin_url
    // (DeduplicationPolicy + RPC). Consecuencia DELIBERADA: dos filas con SOLO el mismo phone se
    // crean ambas (no se deduplican) hasta que F1+ extienda la cadena. Fijado por test.
    if (!email && !cuit && !linkedin && !phone) {
      return err(domainError("MISSING_IDENTITY", "fila sin clave de identidad (email/cuit/linkedin/phone)"));
    }

    return ok(
      new Prospect({
        id,
        status: "raw",
        source: source.value,
        company_name: clean(input.company_name),
        cuit,
        website,
        full_name: clean(input.full_name),
        cargo: clean(input.cargo),
        email,
        phone,
        linkedin_url: linkedin,
        raw: input.raw ?? {},
      }),
    );
  }
}

// Alias con el nombre del Blueprint (Parte II §2.5). Delega en el factory estático del AR.
export const ProspectFactory = {
  fromImportRow: (id: ProspectId, source: SourceSlug, input: ProspectImportInput): Result<Prospect> =>
    Prospect.fromImportRow(id, source, input),
};

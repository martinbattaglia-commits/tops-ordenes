// Domain Service · DeduplicationPolicy — PURA, sin I/O. Fuente de verdad conceptual del criterio
// de dedup (Parte II §2.2 / CS-RPC-2). La RPC `prospeccion_ingest` la materializa en SQL por
// performance de ingesta masiva (excepción acotada documentada); esta política la refleja y se testea.
// Cadena de dedup F0: cuit → lower(email) → linkedin_url (CC-4). CUIT identifica CUENTA, no persona.

export interface DedupeKeys {
  readonly cuit: string | null;
  readonly email: string | null;
  readonly linkedinUrl: string | null;
}

export const DeduplicationPolicy = {
  /** Clave primaria de dedup según la cadena F0 (cuit → email → linkedin), o null si no hay ninguna. */
  primaryKey(k: DedupeKeys): string | null {
    return k.cuit || k.email || k.linkedinUrl || null;
  },

  /** ¿El candidato colisiona con alguna clave ya vista? (determinista, sin red ni base). */
  isDuplicate(candidate: DedupeKeys, seen: ReadonlySet<string>): boolean {
    return [candidate.cuit, candidate.email, candidate.linkedinUrl].some((k) => !!k && seen.has(k));
  },
};

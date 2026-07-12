export interface VoiceConfigSource {
  readonly id: string;
  isEnabled(): boolean;
}

/** Nivel 1: interruptor maestro horneado en el build. */
export class BuildFlagSource implements VoiceConfigSource {
  readonly id = "build-flag";

  constructor(private readonly raw: string | undefined) {}

  isEnabled(): boolean {
    return this.raw === "1" || this.raw === "true";
  }
}

/**
 * Composición AND, fail-closed. Una fuente de Nivel 2 (organización, rol,
 * usuario) solo puede restringir; nunca sobrescribe el flag de build.
 * Ver spec §13.
 */
export function isVoiceEnabled(sources: readonly VoiceConfigSource[]): boolean {
  return sources.length > 0 && sources.every((s) => s.isEnabled());
}

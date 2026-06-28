/**
 * Accessor tipado de la información de versión/build, leída de las variables
 * NEXT_PUBLIC_* que next.config.mjs inyecta en build time (ver
 * scripts/version-info.mjs). Las referencias literales a `process.env.NEXT_PUBLIC_*`
 * quedan inlineadas por Next, así que esto funciona igual en servidor y cliente.
 *
 * Único punto de lectura: lo usan /api/version y la pantalla de Administración.
 */
export interface BuildVersion {
  /** SHA completo del commit desplegado (o "unknown"). */
  commitSha: string;
  /** SHA corto (7) para mostrar. */
  shortSha: string;
  /** Branch de origen del build. */
  branch: string;
  /** Fecha ISO del build. */
  buildDate: string;
  /** Identificador del build (= SHA corto, o "local-<ts>"). */
  buildId: string;
  /** Contexto/entorno: production · deploy-preview · branch-deploy · development. */
  environment: string;
}

export function getVersion(): BuildVersion {
  const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA || "unknown";
  return {
    commitSha,
    shortSha: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 7),
    branch: process.env.NEXT_PUBLIC_BRANCH || "unknown",
    buildDate: process.env.NEXT_PUBLIC_BUILD_DATE || "unknown",
    buildId: process.env.NEXT_PUBLIC_BUILD_ID || "unknown",
    environment:
      process.env.NEXT_PUBLIC_DEPLOY_CONTEXT || process.env.NODE_ENV || "unknown",
  };
}

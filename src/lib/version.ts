/**
 * Accessor de versión/build. Lee variables **server-only** `BUILD_*` que
 * next.config.mjs inyecta en build time (ver scripts/version-info.mjs).
 *
 * SEGURIDAD: las variables NO llevan prefijo NEXT_PUBLIC_, así que NO se inyectan
 * en el bundle de cliente. Solo se resuelven en código de servidor (route handler
 * /api/version y el Server Component de Administración). Si por error un componente
 * de cliente las leyera, obtendría "unknown" (falla-seguro, sin filtrar nada).
 *
 * Dos vistas:
 *  - getPublicVersion()  → mínimo, expuesto sin auth en /api/version.
 *  - getVersion()        → completo, solo para Administración (RBAC) y server.
 */
export interface BuildVersion {
  /** SHA completo del commit desplegado (o "unknown"). PRIVADO. */
  commitSha: string;
  /** SHA corto (7) — seguro de exponer. */
  shortSha: string;
  /** Branch de origen del build. PRIVADO. */
  branch: string;
  /** Fecha ISO del build. */
  buildDate: string;
  /** Identificador del build (= SHA corto, o "local-<ts>"). */
  buildId: string;
  /** Contexto/entorno: production · deploy-preview · branch-deploy · development. */
  environment: string;
}

/** Versión completa — solo para superficies de servidor con RBAC (Administración). */
export function getVersion(): BuildVersion {
  const commitSha = process.env.BUILD_COMMIT_SHA || "unknown";
  return {
    commitSha,
    shortSha: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 7),
    branch: process.env.BUILD_BRANCH || "unknown",
    buildDate: process.env.BUILD_DATE || "unknown",
    buildId: process.env.BUILD_ID || "unknown",
    environment: process.env.BUILD_CONTEXT || process.env.NODE_ENV || "unknown",
  };
}

/** Forma mínima pública: sin SHA completo ni branch (no expone infra interna). */
export interface PublicVersion {
  /** SHA corto del build publicado. */
  version: string;
  /** Fecha ISO del build. */
  builtAt: string;
  /** Entorno de ejecución. */
  environment: string;
}

export function getPublicVersion(): PublicVersion {
  const v = getVersion();
  return {
    version: v.shortSha,
    builtAt: v.buildDate,
    environment: v.environment,
  };
}

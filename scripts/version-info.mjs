/**
 * Fuente ÚNICA de la información de versión/build. La consumen:
 *   - next.config.mjs  → inyecta NEXT_PUBLIC_* en el bundle (build time)
 *   - scripts/gen-version.mjs → log de trazabilidad antes del build/deploy
 *
 * Orden de resolución (robusto para local, Netlify CLI y Netlify git build):
 *   1. Variables de entorno ya presentes (NEXT_PUBLIC_*, y las que Netlify
 *      define en builds git: COMMIT_REF / BRANCH / HEAD / CONTEXT).
 *   2. git local (rev-parse).
 *   3. Fallback explícito ("unknown" / "local-<ts>") — nunca rompe el build.
 *
 * No depende de Next ni de TS: es .mjs puro para correr en next.config y en CLI.
 */
import { execSync } from "node:child_process";

function fromEnv(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function git(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

export function getBuildVersion() {
  const commitSha =
    fromEnv(["BUILD_COMMIT_SHA", "COMMIT_REF"]) ||
    git("git rev-parse HEAD") ||
    "unknown";

  let branch =
    fromEnv(["BUILD_BRANCH", "BRANCH"]) ||
    git("git rev-parse --abbrev-ref HEAD") ||
    "unknown";
  // En CI/detached HEAD `--abbrev-ref` devuelve "HEAD"; Netlify expone HEAD=branch.
  if (branch === "HEAD") branch = fromEnv(["HEAD"]) || "detached";

  const buildDate = fromEnv(["BUILD_DATE"]) || new Date().toISOString();

  const shortSha = commitSha === "unknown" ? "unknown" : commitSha.slice(0, 7);

  const buildId =
    fromEnv(["BUILD_ID"]) ||
    (commitSha === "unknown" ? `local-${Date.now()}` : shortSha);

  // Solo significativo cuando hay git local; en builds por env queda false.
  const dirty = git("git rev-parse HEAD") ? git("git status --porcelain") !== "" : false;

  const environment =
    fromEnv(["BUILD_CONTEXT", "CONTEXT"]) ||
    process.env.NODE_ENV ||
    "development";

  return { commitSha, shortSha, branch, buildDate, buildId, environment, dirty };
}

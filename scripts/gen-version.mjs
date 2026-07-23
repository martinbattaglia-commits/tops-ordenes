/**
 * Hook `prebuild`: imprime la versión que se va a compilar/desplegar ANTES del
 * build, dejando registro en el log de Netlify (o de la terminal en deploy CLI).
 * Garantiza que ningún build de producción quede sin trazabilidad visible.
 *
 * No escribe archivos ni inyecta nada: la inyección de las variables server-only
 * BUILD_* (sin prefijo NEXT_PUBLIC_) la hace next.config.mjs usando la MISMA
 * fuente (scripts/version-info.mjs).
 */
import { getBuildVersion } from "./version-info.mjs";

const v = getBuildVersion();
const bar = "=".repeat(72);
const line = `▶ BUILD VERSION  sha=${v.shortSha}  branch=${v.branch}  buildId=${v.buildId}  env=${v.environment}  date=${v.buildDate}`;

console.log(`\n${bar}\n${line}\n${bar}\n`);

if (v.dirty) {
  console.warn(
    "⚠  Working tree con cambios SIN COMMITEAR: el deploy no será 100% reproducible desde un SHA.\n" +
      "   Commiteá antes de deployar a producción (ver docs/runbooks/RELEASE.md).\n"
  );
}

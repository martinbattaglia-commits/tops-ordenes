/**
 * P3-N1A0 · Ubicación del reporte JSON de la corrida.
 *
 * Vive bajo `node_modules/.cache/` para no ensuciar el árbol de trabajo ni
 * exigir una entrada en `.gitignore`.
 */
import { resolve } from "node:path";

export const REPORT_PATH = resolve(
  process.cwd(),
  "node_modules",
  ".cache",
  "p3n1a0-run-report.json",
);

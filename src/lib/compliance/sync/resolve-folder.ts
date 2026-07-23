import { findFolderByPath } from "@/lib/drive/client";
import { env } from "@/lib/env";

/**
 * Resuelve la carpeta regulatoria de Drive para el sync de Compliance.
 *
 * Orden de resolución (paridad con Contratos, `resolveContratosFolderIds`,
 * fix d82b889):
 *
 *  1. `COMPLIANCE_DRIVE_FOLDER_ID` (env explícita) → se honra SIEMPRE
 *     (`via:"env-id"`). Es configuración de servidor confiable y la carpeta
 *     puede vivir FUERA del root de la SA — desde E12 el corpus Compliance
 *     vive en una carpeta propia, independiente del árbol histórico. NO se
 *     exige `isUnderRoot`. El acceso real lo valida el walk de Drive al
 *     correr el sync: si la SA no puede leerla, el run termina en
 *     `status:"error"` explícito — nunca se degrada en silencio al root.
 *  2. Ruta por nombres (`COMPLIANCE_DRIVE_PATH`) desde el root de la SA
 *     (`via:"path"`).
 *  3. Root corporativo `GOOGLE_DRIVE_ROOT_FOLDER_ID` (`via:"root"`).
 *  4. Nada configurado → `via:"none"` (el engine reporta 'skipped').
 */
export async function resolveComplianceFolder(): Promise<{ id: string | null; via: string }> {
  const direct = env.compliance.driveFolderId;
  if (direct) return { id: direct, via: "env-id" };

  const root = env.google.driveRootFolderId || undefined;
  const subpath = env.compliance.driveSubpath.split("/").map((s) => s.trim()).filter(Boolean);
  const byPath = await findFolderByPath(subpath);
  if (byPath) return { id: byPath, via: "path" };
  if (root) return { id: root, via: "root" };
  return { id: null, via: "none" };
}

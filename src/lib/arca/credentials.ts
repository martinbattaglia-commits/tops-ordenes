/**
 * Resolución de credenciales X.509 (cert + clave privada) para ARCA.
 *
 * Orden de preferencia:
 *   1. Contenido PEM en env (ARCA_CERT_PEM / ARCA_KEY_PEM, base64 o PEM crudo).
 *      Vía requerida en Netlify Functions y otros runtimes serverless, donde NO
 *      hay filesystem persistente en las rutas ARCA_CERT_PATH / ARCA_KEY_PATH.
 *   2. Archivos en disco (ARCA_CERT_PATH / ARCA_KEY_PATH). Hosts con FS (dev/VM).
 *
 * La clave privada vive SOLO en memoria durante la firma del TRA; nunca se
 * loguea ni se persiste en repo/DB. El cert público puede ir por path o env; la
 * clave privada debe entregarse como secret de la plataforma (env), jamás en VCS.
 */

import { readFile } from "fs/promises";
import { env } from "../env";

export interface ArcaPem {
  certPem: string;
  keyPem: string;
}

/** True si hay credenciales completas por contenido-env o por path en disco. */
export function hasArcaCredentials(): boolean {
  return Boolean(
    (env.arca.certPem && env.arca.keyPem) ||
      (env.arca.certPath && env.arca.keyPath)
  );
}

/**
 * Devuelve el PEM de cert + clave. Prefiere contenido-env; si falta, lee de los
 * paths indicados. Lanza con mensaje accionable si no logra resolver ambos.
 */
export async function resolveArcaPem(
  certPath: string,
  keyPath: string
): Promise<ArcaPem> {
  const certPem = env.arca.certPem || (certPath ? await readFile(certPath, "utf8") : "");
  const keyPem = env.arca.keyPem || (keyPath ? await readFile(keyPath, "utf8") : "");
  if (!certPem || !keyPem) {
    throw new Error(
      "ARCA: faltan credenciales X.509. Definí ARCA_CERT_PEM / ARCA_KEY_PEM " +
        "(PEM crudo o base64) para runtime serverless, o ARCA_CERT_PATH / " +
        "ARCA_KEY_PATH en hosts con filesystem. La clave privada nunca va al repo/DB."
    );
  }
  return { certPem, keyPem };
}

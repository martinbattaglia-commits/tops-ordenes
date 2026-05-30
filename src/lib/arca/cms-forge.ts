/**
 * Firmador CMS/PKCS#7 puro-JavaScript para WSAA (ARCA/AFIP) — GATE F (F2).
 *
 * Reemplaza la dependencia del binario `openssl` del host (no garantizado en
 * runtimes serverless como Netlify Functions) por una implementación 100% Node
 * basada en `node-forge`. Produce el equivalente exacto a:
 *
 *     openssl smime -sign -signer cert -inkey key -outform DER -nodetach
 *
 * es decir, un PKCS#7 SignedData con el contenido (TRA) EMBEBIDO (no detached),
 * codificado en DER y devuelto en base64 — el formato que WSAA `LoginCms` espera
 * en `<in0>`.
 *
 * Seguridad:
 *  - La clave privada se resuelve por contenido-env (ARCA_KEY_PEM) o path
 *    (ARCA_KEY_PATH) y vive SOLO en memoria durante la firma. Nunca se loguea
 *    ni se persiste en repo/DB.
 *  - No se imprime cert/clave/CMS en claro.
 */

// node-forge se declara como módulo ambiente en ./node-forge.d.ts (sin @types).
import forge from "node-forge";
import type { CmsSigner } from "./wsaa";
import { resolveArcaPem } from "./credentials";

export interface ForgeSignerOptions {
  /** Algoritmo de digest. ARCA acepta sha256 (default) y sha1 (legacy). */
  digest?: "sha256" | "sha1";
}

/**
 * Construye un CmsSigner puro-JS. Resuelve cert+clave PEM por cada firma vía
 * `resolveArcaPem` (contenido-env > archivo en disco): portable a serverless,
 * falla claro si faltan/no legibles.
 */
export function forgeCmsSigner(
  certPath: string,
  keyPath: string,
  opts: ForgeSignerOptions = {}
): CmsSigner {
  const digestOid =
    opts.digest === "sha1" ? forge.pki.oids.sha1 : forge.pki.oids.sha256;

  return {
    async sign(traXml: string): Promise<string> {
      const { certPem, keyPem } = await resolveArcaPem(certPath, keyPath);

      const cert = forge.pki.certificateFromPem(certPem);
      const privateKey = forge.pki.privateKeyFromPem(keyPem);

      const p7 = forge.pkcs7.createSignedData();
      // Contenido embebido (no detached): el TRA va dentro del SignedData.
      p7.content = forge.util.createBuffer(traXml, "utf8");
      p7.addCertificate(cert);
      p7.addSigner({
        key: privateKey,
        certificate: cert,
        digestAlgorithm: digestOid,
        authenticatedAttributes: [
          { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
          { type: forge.pki.oids.messageDigest },
          { type: forge.pki.oids.signingTime, value: new Date() },
        ],
      });

      // detached:false ⇒ equivalente a `-nodetach` (contenido incluido).
      p7.sign({ detached: false });

      const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
      // DER binario → base64 (lo que viaja en el envelope SOAP de LoginCms).
      return forge.util.encode64(der);
    },
  };
}

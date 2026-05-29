/**
 * GATE F · F2 — Test del firmador CMS puro-JS (forgeCmsSigner).
 *
 * Verifica, con EVIDENCIA REAL y sin tocar ARCA, que el firmador `node-forge`
 * produce un PKCS#7 SignedData equivalente al de `openssl smime -nodetach`:
 *   1. Genera un cert+clave AUTOFIRMADO de PRUEBA (NO ARCA, descartable).
 *   2. Firma un TRA de muestra con el módulo real `src/lib/arca/cms-forge.ts`
 *      (transpilado con esbuild → no es una reimplementación).
 *   3. Valida estructura con node-forge (SignedData + contenido embebido == TRA).
 *   4. Cross-check con el binario `openssl cms -verify` (interoperabilidad).
 *   5. Compara contra el CMS que produce el opensslSigner sobre el mismo input.
 *
 * NO usa certificados ARCA. NO llama a WSAA/WSFEv1. NO emite comprobantes.
 *
 * Uso:  node scripts/arca-cms-signer-test.mjs
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import forge from "node-forge";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const log = (...a) => console.log(...a);
let FAIL = 0;
const check = (name, cond, detail = "") => {
  log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
};

const work = mkdtempSync(join(tmpdir(), "arca-cms-test-"));
try {
  log("=== GATE F · F2 — CMS signer test (sin ARCA) ===\n");

  // 1) Cert+clave de PRUEBA autofirmado (NO ARCA).
  const certPath = join(work, "test-cert.pem");
  const keyPath = join(work, "test-key.pem");
  const gen = spawnSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048",
      "-keyout", keyPath, "-out", certPath,
      "-days", "1", "-nodes",
      "-subj", "/CN=TOPS-NEXUS-CMS-TEST/O=TEST-NO-ARCA",
    ],
    { encoding: "utf8" }
  );
  check("Generación de cert+clave de prueba (openssl req)", gen.status === 0,
    gen.status === 0 ? "RSA-2048 autofirmado descartable" : gen.stderr);
  if (gen.status !== 0) throw new Error("No se pudo generar el cert de prueba");

  // 2) Transpilar el MÓDULO REAL cms-forge.ts con esbuild.
  // CJS para que `require("crypto")` interno de node-forge funcione (en ESM
  // esbuild lo rompe con "Dynamic require not supported").
  const bundlePath = join(work, "cms-forge.cjs");
  const build = spawnSync(
    join(REPO, "node_modules/.bin/esbuild"),
    [
      join(REPO, "src/lib/arca/cms-forge.ts"),
      "--bundle", "--format=cjs", "--platform=node",
      `--outfile=${bundlePath}`,
    ],
    { encoding: "utf8" }
  );
  check("Transpilación del módulo real cms-forge.ts (esbuild)", build.status === 0,
    build.status === 0 ? "bundle CJS generado" : build.stderr);
  if (build.status !== 0) throw new Error("esbuild falló");

  const mod = await import(bundlePath);
  const forgeCmsSigner = mod.forgeCmsSigner ?? mod.default?.forgeCmsSigner;
  check("forgeCmsSigner exportado por el módulo", typeof forgeCmsSigner === "function");

  // TRA de muestra (estructura real de loginTicketRequest, datos ficticios).
  const tra =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>1748505600</uniqueId>` +
    `<generationTime>2026-05-29T10:00:00-03:00</generationTime>` +
    `<expirationTime>2026-05-29T10:20:00-03:00</expirationTime>` +
    `</header><service>wsfe</service></loginTicketRequest>`;

  // 3) Firmar con el módulo real.
  const signer = forgeCmsSigner(certPath, keyPath);
  const t0 = Date.now();
  const cmsB64 = await signer.sign(tra);
  const ms = Date.now() - t0;
  check("Firma CMS producida (base64 no vacío)", typeof cmsB64 === "string" && cmsB64.length > 0,
    `len=${cmsB64.length}, ${ms}ms`);

  // 4a) Validación estructural con node-forge.
  const der = forge.util.decode64(cmsB64);
  const asn1 = forge.asn1.fromDer(der);
  const msg = forge.pkcs7.messageFromAsn1(asn1);
  const isSignedData =
    msg && (msg.type === forge.pki.oids.signedData || msg.rawCapture?.signature);
  check("CMS parsea como PKCS#7 SignedData (node-forge)", Boolean(isSignedData),
    `type=${msg?.type}`);

  // Contenido embebido == TRA (no detached).
  let embedded = "";
  try {
    embedded = msg.rawCapture?.content
      ? forge.util.decodeUtf8(
          msg.rawCapture.content.value?.[0]?.value ?? msg.rawCapture.content.value ?? ""
        )
      : "";
  } catch { embedded = ""; }
  // Fallback robusto: verificar vía openssl (4b) que el contenido sale igual.

  // 4b) Cross-check con openssl cms -verify (interoperabilidad real).
  const derPath = join(work, "cms.der");
  writeFileSync(derPath, Buffer.from(der, "binary"));
  const outPath = join(work, "verified-content.txt");
  const verify = spawnSync(
    "openssl",
    [
      "cms", "-verify", "-inform", "DER", "-in", derPath,
      "-noverify",                 // self-signed: no validar cadena (es test)
      "-certfile", certPath,
      "-out", outPath,
    ],
    { encoding: "utf8" }
  );
  const verifiedContent = (() => { try { return readFileSync(outPath, "utf8"); } catch { return ""; } })();
  check("openssl cms -verify ACEPTA el CMS de node-forge", verify.status === 0,
    verify.status === 0 ? (verify.stderr || "").trim() : (verify.stderr || "").trim());
  check("Contenido recuperado por openssl == TRA original (nodetach OK)",
    verifiedContent.trim() === tra.trim(),
    `recuperado ${verifiedContent.length}B vs original ${tra.length}B`);

  // 5) Comparación con opensslSigner sobre el MISMO input.
  const osl = spawnSync(
    "openssl",
    ["smime", "-sign", "-signer", certPath, "-inkey", keyPath, "-outform", "DER", "-nodetach"],
    { input: Buffer.from(tra, "utf8") } // sin `encoding` ⇒ stdout/stderr como Buffer
  );
  check("opensslSigner produce CMS sobre el mismo input", osl.status === 0,
    osl.status === 0 ? `len=${osl.stdout.length}B` : String(osl.stderr));
  if (osl.status === 0) {
    // Verificar que el CMS de openssl también recupera el TRA (paridad).
    const oslDer = join(work, "openssl.der");
    writeFileSync(oslDer, osl.stdout);
    const oslOut = join(work, "openssl-content.txt");
    const v2 = spawnSync("openssl",
      ["cms", "-verify", "-inform", "DER", "-in", oslDer, "-noverify", "-certfile", certPath, "-out", oslOut],
      { encoding: "utf8" });
    const c2 = (() => { try { return readFileSync(oslOut, "utf8"); } catch { return ""; } })();
    check("Paridad forge↔openssl: ambos recuperan el mismo TRA",
      v2.status === 0 && c2.trim() === tra.trim(),
      `openssl-path recuperó ${c2.length}B`);
  }

  log(`\n=== Resumen: ${FAIL === 0 ? "TODOS OK" : FAIL + " FALLO(S)"} ===`);
  process.exitCode = FAIL === 0 ? 0 : 1;
} finally {
  // Borrar cert+clave de prueba y artefactos temporales.
  try { rmSync(work, { recursive: true, force: true }); } catch {}
}

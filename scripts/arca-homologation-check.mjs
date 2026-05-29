#!/usr/bin/env node
/**
 * ARCA — Homologación dry-run / readiness check (FASE E4).
 *
 * Verifica, de forma incremental y SIN emitir comprobantes, los prerequisitos
 * del handshake de homologación de ARCA (ex-AFIP):
 *
 *   G1. openssl disponible en el host (necesario para firmar el CMS/PKCS#7).
 *   G2. Certificado X.509 + clave privada presentes y legibles (paths por env).
 *   G3. Conectividad SOAP a WSFEv1 homologación (FEDummy — NO requiere Auth).
 *   G4. WSAA homologación: TRA → firma CMS → LoginCms → Token+Sign (requiere G2).
 *   G5. WSFEv1 read-only: FECompUltimoAutorizado (requiere G4 + CUIT).
 *
 * NUNCA llama FECAESolicitar (no se emite ningún comprobante, ni de prueba),
 * salvo que se pase --emit EXPLÍCITO (default OFF). NUNCA usa endpoints de
 * PRODUCCIÓN: fuerza las URLs de homologación.
 *
 * Reglas de seguridad: jamás imprime Token/Sign/clave/CMS en claro (solo
 * longitudes/hashes truncados).
 *
 * Uso:
 *   ARCA_CERT_PATH=/host/cert.pem ARCA_KEY_PATH=/host/key.pem ARCA_CUIT=33604896989 \
 *     node scripts/arca-homologation-check.mjs --ptovta 1 --cbtetipo 11
 *
 * Sin credenciales, corre G1 + G3 (lo que es verificable sin cert) y reporta
 * G2/G4/G5 como SKIPPED con instrucciones.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const HOMO = {
  wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  wsfev1: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
};
const FEV1_NS = "http://ar.gov.afip.dif.FEV1/";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);

const CERT = process.env.ARCA_CERT_PATH?.trim() || "";
const KEY = process.env.ARCA_KEY_PATH?.trim() || "";
const CUIT = (process.env.ARCA_CUIT || "").replace(/\D/g, "");
const PTOVTA = Number(opt("ptovta", "1"));
const CBTETIPO = Number(opt("cbtetipo", "11")); // 11 = Factura C
const ALLOW_EMIT = has("emit");

const results = [];
const log = (gate, status, detail) => {
  results.push({ gate, status, detail });
  const icon = status === "OK" ? "✅" : status === "SKIP" ? "⏭️ " : "❌";
  console.log(`${icon} ${gate}: ${status}${detail ? " — " + detail : ""}`);
};

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function extractTag(xml, name) {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`,
    "i"
  );
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

async function soapPost(url, action, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

// ---- G1: openssl --------------------------------------------------------
async function checkOpenssl() {
  return new Promise((resolve) => {
    const p = spawn("openssl", ["version"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", (code) => resolve(code === 0 ? out.trim() : null));
  });
}

// ---- G2: cert/key presentes --------------------------------------------
async function checkCreds() {
  if (!CERT || !KEY) return { ok: false, reason: "ARCA_CERT_PATH/ARCA_KEY_PATH no seteados" };
  try {
    await Promise.all([readFile(CERT), readFile(KEY)]);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ---- G3: FEDummy (sin Auth) --------------------------------------------
async function feDummy() {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${FEV1_NS}">` +
    `<soapenv:Header/><soapenv:Body><ar:FEDummy/></soapenv:Body></soapenv:Envelope>`;
  const { status, text } = await soapPost(HOMO.wsfev1, `${FEV1_NS}FEDummy`, body);
  return {
    status,
    appServer: extractTag(text, "AppServer"),
    dbServer: extractTag(text, "DbServer"),
    authServer: extractTag(text, "AuthServer"),
  };
}

// ---- G4: WSAA login -----------------------------------------------------
function buildTra(service = "wsfe") {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(now / 1000)}</uniqueId>` +
    `<generationTime>${iso(now - 600000)}</generationTime>` +
    `<expirationTime>${iso(now + 600000)}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`
  );
}

async function signCms(tra) {
  return new Promise((resolve, reject) => {
    const p = spawn("openssl", [
      "smime", "-sign", "-signer", CERT, "-inkey", KEY,
      "-outform", "DER", "-nodetach",
    ]);
    const out = [];
    const err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => reject(new Error("openssl: " + e.message)));
    p.on("close", (c) =>
      c === 0
        ? resolve(Buffer.concat(out).toString("base64"))
        : reject(new Error("openssl smime code " + c + ": " + Buffer.concat(err).toString()))
    );
    p.stdin.write(tra);
    p.stdin.end();
  });
}

async function wsaaLogin() {
  const tra = buildTra();
  const cms = await signCms(tra);
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body>` +
    `<wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>` +
    `</soapenv:Body></soapenv:Envelope>`;
  const { status, text } = await soapPost(HOMO.wsaa, "", body);
  let inner = extractTag(text, "loginCmsReturn") ?? text;
  if (!/loginTicketResponse/.test(inner)) {
    inner = inner
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
  const token = extractTag(inner, "token");
  const sign = extractTag(inner, "sign");
  const exp = extractTag(inner, "expirationTime");
  if (!token || !sign) {
    const fault = extractTag(text, "faultstring");
    throw new Error("WSAA sin token/sign" + (fault ? ": " + fault : ""));
  }
  return { token, sign, exp, cmsHash: createHash("sha256").update(cms).digest("hex").slice(0, 12) };
}

// ---- G5: FECompUltimoAutorizado (read-only) ----------------------------
async function ultimoAutorizado(token, sign) {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${FEV1_NS}">` +
    `<soapenv:Header/><soapenv:Body><ar:FECompUltimoAutorizado>` +
    `<ar:Auth><ar:Token>${esc(token)}</ar:Token><ar:Sign>${esc(sign)}</ar:Sign><ar:Cuit>${CUIT}</ar:Cuit></ar:Auth>` +
    `<ar:PtoVta>${PTOVTA}</ar:PtoVta><ar:CbteTipo>${CBTETIPO}</ar:CbteTipo>` +
    `</ar:FECompUltimoAutorizado></soapenv:Body></soapenv:Envelope>`;
  const { text } = await soapPost(HOMO.wsfev1, `${FEV1_NS}FECompUltimoAutorizado`, body);
  const errBlock = extractTag(text, "Errors");
  if (errBlock) {
    const code = extractTag(errBlock, "Code");
    const msg = extractTag(errBlock, "Msg");
    throw new Error(`WSFEv1 Errors [${code}] ${msg}`);
  }
  return extractTag(text, "CbteNro");
}

// ---- main ---------------------------------------------------------------
(async () => {
  console.log("=== ARCA Homologación readiness check (sin emisión) ===");
  console.log(`WSAA:   ${HOMO.wsaa}`);
  console.log(`WSFEv1: ${HOMO.wsfev1}\n`);

  // G1
  const ov = await checkOpenssl();
  if (ov) log("G1 openssl", "OK", ov);
  else log("G1 openssl", "FAIL", "no disponible — instalar openssl en el host");

  // G2
  const creds = await checkCreds();
  if (creds.ok) log("G2 cert/key", "OK", "archivos legibles");
  else log("G2 cert/key", "SKIP", creds.reason);

  // G3 (conectividad, sin cert)
  try {
    const d = await feDummy();
    const all = d.appServer === "OK" && d.dbServer === "OK" && d.authServer === "OK";
    log("G3 FEDummy", all ? "OK" : "FAIL",
      `HTTP ${d.status} App=${d.appServer} Db=${d.dbServer} Auth=${d.authServer}`);
  } catch (e) {
    log("G3 FEDummy", "FAIL", e.name === "AbortError" ? "timeout" : e.message);
  }

  // G4 + G5 requieren credenciales
  if (!creds.ok || !ov) {
    log("G4 WSAA login", "SKIP", "requiere G1 (openssl) + G2 (cert/key)");
    log("G5 FECompUltimoAutorizado", "SKIP", "requiere G4 + ARCA_CUIT");
  } else {
    let ta = null;
    try {
      ta = await wsaaLogin();
      log("G4 WSAA login", "OK",
        `token len=${ta.token.length} sign len=${ta.sign.length} exp=${ta.exp} cmsHash=${ta.cmsHash}`);
    } catch (e) {
      log("G4 WSAA login", "FAIL", e.message);
    }
    if (ta && CUIT) {
      try {
        const nro = await ultimoAutorizado(ta.token, ta.sign);
        log("G5 FECompUltimoAutorizado", "OK",
          `PtoVta=${PTOVTA} CbteTipo=${CBTETIPO} últimoNro=${nro} (próximo=${Number(nro) + 1})`);
      } catch (e) {
        log("G5 FECompUltimoAutorizado", "FAIL", e.message);
      }
    } else if (ta) {
      log("G5 FECompUltimoAutorizado", "SKIP", "falta ARCA_CUIT");
    }
  }

  if (ALLOW_EMIT) {
    console.log("\n⚠️  --emit ignorado en este script: no se emiten comprobantes ni de prueba (política FASE E).");
  }

  const fails = results.filter((r) => r.status === "FAIL").length;
  const skips = results.filter((r) => r.status === "SKIP").length;
  console.log(`\n=== Resumen: ${results.length - fails - skips} OK · ${skips} SKIP · ${fails} FAIL ===`);
  process.exit(fails > 0 ? 1 : 0);
})();

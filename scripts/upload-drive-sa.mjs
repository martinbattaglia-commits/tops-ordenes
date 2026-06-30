#!/usr/bin/env node
/**
 * upload-drive-sa.mjs
 *
 * Sube la credencial de la Service Account de Google Drive a Netlify Blobs.
 * La credencial NO entra al repositorio: se lee desde .env.local o desde stdin.
 *
 * Uso:
 *   node scripts/upload-drive-sa.mjs              # lee GOOGLE_SERVICE_ACCOUNT_JSON de .env.local
 *   node scripts/upload-drive-sa.mjs --verify     # solo verifica (lee, valida, no sobreescribe)
 *   GOOGLE_SERVICE_ACCOUNT_JSON='...' node scripts/upload-drive-sa.mjs
 *
 * Requisitos:
 *   - netlify-cli autenticado (`netlify login`)
 *   - @netlify/blobs disponible en node_modules
 *
 * Seguridad:
 *   - El valor de la credencial NUNCA se imprime en stdout/stderr.
 *   - Se almacena como envelope JSON con checksum SHA-256 en el store "secrets".
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { getStore } from "@netlify/blobs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const SITE_ID = "d84a7d34-b90c-4e61-aff6-678abf1ac432";
const STORE_NAME = "secrets";
const BLOB_KEY = "google-service-account";

const VERIFY_ONLY = process.argv.includes("--verify");

// ---------------------------------------------------------------------------
// 1. Obtener el token de Netlify CLI
// ---------------------------------------------------------------------------
function getNetlifyToken() {
  try {
    const out = execSync("netlify api listSites", { encoding: "utf8", stdio: "pipe" });
    // Si el comando anterior funcionó, el token está configurado.
    // Obtenemos el token del config de netlify-cli.
    const configPath = resolve(process.env.HOME ?? "~", ".netlify/config.json");
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      const token = cfg?.users?.[Object.keys(cfg.users ?? {})[0]]?.auth?.token;
      if (token) return token;
    }
    // Fallback: NETLIFY_AUTH_TOKEN env var
    if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
    throw new Error("No se pudo obtener el token de Netlify CLI.");
  } catch (e) {
    if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
    console.error("ERROR: Netlify CLI no autenticado. Ejecutá: netlify login");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 2. Cargar la credencial desde .env.local o env var
// ---------------------------------------------------------------------------
function loadCredential() {
  // Primero: env var directa (ideal para CI o pipelines)
  const fromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (fromEnv) return fromEnv;

  // Segundo: .env.local en la raíz del proyecto
  const envLocalPath = resolve(ROOT, ".env.local");
  if (existsSync(envLocalPath)) {
    const lines = readFileSync(envLocalPath, "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(/^GOOGLE_SERVICE_ACCOUNT_JSON\s*=\s*['"]?([\s\S]*?)['"]?\s*$/);
      if (m) {
        const val = m[1].trim().replace(/^['"]|['"]$/g, "");
        if (val) return val;
      }
    }
  }

  console.error(
    "ERROR: GOOGLE_SERVICE_ACCOUNT_JSON no encontrado en env ni en .env.local.\n" +
    "Opciones:\n" +
    "  1. Agregar GOOGLE_SERVICE_ACCOUNT_JSON='...' a .env.local\n" +
    "  2. Exportar la var antes de correr el script",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Validar que el JSON es una Service Account válida
// ---------------------------------------------------------------------------
function validateServiceAccount(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.error("ERROR: el JSON de la Service Account no es JSON válido.");
    process.exit(1);
  }
  const missing = ["type", "client_email", "private_key"].filter((k) => !parsed[k]);
  if (missing.length) {
    console.error(`ERROR: al JSON de la Service Account le faltan campos: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (parsed.type !== "service_account") {
    console.error(`ERROR: "type" debe ser "service_account", es "${parsed.type}"`);
    process.exit(1);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// 4. SHA-256
// ---------------------------------------------------------------------------
function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Comparación de checksums en tiempo CONSTANTE (anti timing-attack), espejo de
 * src/lib/credentials/checksum.ts: re-hashea ambos operandos a 32 bytes fijos y
 * usa crypto.timingSafeEqual (que exige igual longitud). Nunca lanza por longitud.
 */
function checksumsEqual(a, b) {
  const na = createHash("sha256").update(String(a).trim().toLowerCase(), "utf8").digest();
  const nb = createHash("sha256").update(String(b).trim().toLowerCase(), "utf8").digest();
  return timingSafeEqual(na, nb);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const token = getNetlifyToken();
  const store = getStore({ name: STORE_NAME, siteID: SITE_ID, token });

  if (VERIFY_ONLY) {
    console.log(`[verify] Leyendo "${BLOB_KEY}" de Blobs store "${STORE_NAME}"...`);
    const raw = await store.get(BLOB_KEY, { type: "text" });
    if (!raw) {
      console.error(`[verify] ERROR: clave "${BLOB_KEY}" no existe en Blobs.`);
      process.exit(1);
    }
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      console.error("[verify] ERROR: contenido almacenado no es JSON válido.");
      process.exit(1);
    }
    const actualHash = sha256Hex(envelope.value ?? "");
    if (!checksumsEqual(actualHash, envelope.sha256 ?? "")) {
      console.error(
        `[verify] ERROR INTEGRIDAD: checksum no coincide.\n` +
        `  almacenado : ${envelope.sha256}\n` +
        `  recomputado: ${actualHash}`,
      );
      process.exit(1);
    }
    const parsed = validateServiceAccount(envelope.value);
    console.log(`[verify] ✅ OK`);
    console.log(`  client_email : ${parsed.client_email}`);
    console.log(`  algo         : ${envelope.algo}`);
    console.log(`  createdAt    : ${envelope.createdAt ?? "(no registrado)"}`);
    console.log(`  sha256       : ${actualHash.slice(0, 16)}…  (coincide)`);
    return;
  }

  // Upload
  const raw = loadCredential();
  const parsed = validateServiceAccount(raw);
  const sha256 = sha256Hex(raw);
  const envelope = {
    value: raw,
    sha256,
    algo: "SHA-256",
    createdAt: new Date().toISOString(),
  };

  console.log(`[upload] Subiendo credencial a Blobs...`);
  console.log(`  store        : ${STORE_NAME}`);
  console.log(`  key          : ${BLOB_KEY}`);
  console.log(`  client_email : ${parsed.client_email}`);
  console.log(`  sha256       : ${sha256.slice(0, 16)}…`);
  // No imprimimos el valor ni fragmentos del mismo.

  await store.setJSON(BLOB_KEY, envelope);

  console.log(`[upload] ✅ Credencial subida. Ejecutando --verify...`);
  // Verificar inmediatamente
  const stored = await store.get(BLOB_KEY, { type: "text" });
  const storedEnv = JSON.parse(stored);
  const verifyHash = sha256Hex(storedEnv.value);
  if (!checksumsEqual(verifyHash, storedEnv.sha256 ?? "")) {
    console.error("[upload] ERROR: verificación post-upload falló (checksum no coincide).");
    process.exit(1);
  }
  if (storedEnv.value !== raw) {
    console.error("[upload] ERROR: el valor almacenado difiere del original.");
    process.exit(1);
  }
  console.log(`[upload] ✅ Verificación post-upload OK. Credencial lista en Blobs.`);
  console.log(``);
  console.log(`Próximos pasos:`);
  console.log(`  1. Cambiar scope de GOOGLE_SERVICE_ACCOUNT_JSON a "builds" solo en Netlify`);
  console.log(`  2. Agregar GOOGLE_SA_EMAIL=${parsed.client_email} como var de entorno (no secret, no runtime)`);
  console.log(`  3. netlify deploy --prod`);
})();

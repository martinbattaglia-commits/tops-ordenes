#!/usr/bin/env node
/**
 * TOPS NEXUS — Environment check / guard / heal
 * -------------------------------------------------------------
 * Hardening del entorno. NO toca código de app, lógica ni datos.
 * NUNCA imprime valores de variables — solo nombres y PASS/FAIL.
 *
 * Modos:
 *   node scripts/env-check.mjs            -> reporte completo; exit 1 si algo FAIL (CI / pre-deploy)
 *   node scripts/env-check.mjs --guard    -> solo warning; exit 0 SIEMPRE (hook de arranque, no bloquea)
 *   node scripts/env-check.mjs --heal     -> si falta .env.local en el cwd, lo copia del worktree `main`
 *
 * Combinables: `--heal --guard` (usado por el hook predev).
 */
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const GUARD = args.has("--guard");
const HEAL = args.has("--heal");
const CWD = process.cwd();
const ENV_FILE = join(CWD, ".env.local");

// Integración -> claves requeridas (gating). Solo nombres, jamás valores.
const GROUPS = {
  Clientify: ["CLIENTIFY_API_KEY"],
  Tracking: ["NEXT_PUBLIC_MAPBOX_TOKEN"],
  CCTV: ["HIKVISION_HOST", "HIKVISION_USER", "HIKVISION_PASSWORD"],
  Supabase: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  OCR: ["OPENAI_API_KEY"],
};

function parseEnvFileKeys(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    // Guardamos solo si tiene valor no vacío. NUNCA exponemos el valor.
    if (val.length > 0) out[key] = true;
  }
  return out;
}

function findMainWorktreeEnv() {
  try {
    const porcelain = execSync("git worktree list --porcelain", { encoding: "utf8" });
    const blocks = porcelain.split(/\n\n+/);
    for (const b of blocks) {
      const path = (b.match(/^worktree (.+)$/m) || [])[1];
      const branch = (b.match(/^branch (.+)$/m) || [])[1] || "";
      if (path && branch.endsWith("/main")) {
        const f = join(path, ".env.local");
        if (existsSync(f)) return f;
      }
    }
  } catch {
    /* git ausente o no es repo: no-op */
  }
  return null;
}

// --heal: si no hay .env.local en el cwd, intentar copiarlo del worktree main.
if (HEAL && !existsSync(ENV_FILE)) {
  const src = findMainWorktreeEnv();
  if (src && src !== ENV_FILE) {
    try {
      copyFileSync(src, ENV_FILE);
      console.log(`\x1b[33m[env:heal] .env.local ausente en este worktree → copiado desde main (${src}).\x1b[0m`);
    } catch (e) {
      console.warn(`\x1b[33m[env:heal] No se pudo copiar .env.local desde main: ${e.message}\x1b[0m`);
    }
  } else if (!src) {
    console.warn("\x1b[33m[env:heal] No se encontró .env.local en el worktree main para auto-copiar.\x1b[0m");
  }
}

// Fuente de verdad para el chequeo: process.env (CI / runtime) + .env.local del cwd.
const fileKeys = parseEnvFileKeys(ENV_FILE);
const present = (k) =>
  (typeof process.env[k] === "string" && process.env[k].trim().length > 0) || fileKeys[k] === true;

const results = Object.entries(GROUPS).map(([name, keys]) => {
  const missing = keys.filter((k) => !present(k));
  return { name, ok: missing.length === 0, missing };
});

const anyFail = results.some((r) => !r.ok);
const hasEnvFile = existsSync(ENV_FILE);

if (GUARD) {
  // Hook de arranque: solo advierte, nunca bloquea.
  if (anyFail) {
    console.warn("\x1b[33m──────────────────────────────────────────────────────────");
    console.warn(" ⚠️  TOPS NEXUS — variables de entorno faltantes (runtime degradado)");
    if (!hasEnvFile) console.warn(`     · No existe .env.local en: ${CWD}`);
    for (const r of results.filter((x) => !x.ok)) {
      console.warn(`     · ${r.name}: falta ${r.missing.join(", ")}`);
    }
    console.warn("     Fix: servir desde el worktree `main`, o `npm run env:check -- --heal`.");
    console.warn("──────────────────────────────────────────────────────────\x1b[0m");
  }
  process.exit(0);
}

// Reporte completo (env:check)
console.log("");
console.log("TOPS NEXUS — Environment Check");
console.log(`cwd: ${CWD}`);
console.log(`.env.local: ${hasEnvFile ? "presente" : "AUSENTE"}`);
console.log("──────────────────────────────");
for (const r of results) {
  const tag = r.ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  const detail = r.ok ? r.name : `${r.name}  (falta: ${r.missing.join(", ")})`;
  console.log(`  ${tag}  ${detail}`);
}
console.log("──────────────────────────────");
console.log(anyFail ? "\x1b[31mRESULT: FAIL\x1b[0m (faltan variables — ver arriba)" : "\x1b[32mRESULT: PASS\x1b[0m (todas las integraciones con entorno)");
console.log("(Solo se muestran NOMBRES de variables — ningún valor.)");
console.log("");
process.exit(anyFail ? 1 : 0);

#!/usr/bin/env node
/**
 * Diagnóstico de conexión Supabase con service_role.
 *
 * Uso: node scripts/supabase-check.mjs
 *
 * Lee .env.local automáticamente, no requiere argumentos. Imprime:
 *  - URL del proyecto
 *  - Tablas existentes en public
 *  - Buckets de Storage
 *  - Status de migrations (mediante chequeo de tablas conocidas)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`\n📡 Conectando a ${url}\n`);

// 1. Chequear tablas conocidas (proxy para saber qué migrations corrieron)
const KNOWN_TABLES = [
  // 0001
  "profiles",
  "clients",
  "operators",
  "services_catalog",
  "orders",
  "order_services",
  "email_sends",
  "audit_log",
  // 0004
  "notifications",
  "attachments",
  // 0008 (purchase orders)
  "vendors",
  "products",
  "purchase_orders",
  "po_items",
  "po_events",
  "po_email_sends",
  // 0009 (RBAC)
  "permissions",
  "roles",
  "role_permissions",
  "user_roles",
];

console.log("📋 Tablas:");
let migrationsState = { v0001: true, v0008: true, v0009: true };
for (const table of KNOWN_TABLES) {
  const { error, count } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    console.log(`  ❌ ${table.padEnd(22)} — ${error.message.split("\n")[0]}`);
    if (["profiles", "orders"].includes(table)) migrationsState.v0001 = false;
    if (["vendors", "purchase_orders"].includes(table)) migrationsState.v0008 = false;
    if (["roles", "permissions"].includes(table)) migrationsState.v0009 = false;
  } else {
    console.log(`  ✅ ${table.padEnd(22)} (${count ?? 0} rows)`);
  }
}

console.log("\n🪣 Storage buckets:");
const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
if (bucketErr) {
  console.log(`  ❌ ${bucketErr.message}`);
} else {
  for (const b of buckets) {
    console.log(`  ${b.public ? "🌍" : "🔒"} ${b.name}`);
  }
}

console.log("\n📦 Migrations status:");
console.log(`  0001_init.sql              ${migrationsState.v0001 ? "✅ aplicada" : "❌ falta"}`);
console.log(`  0008_purchase_orders.sql   ${migrationsState.v0008 ? "✅ aplicada" : "❌ falta"}`);
console.log(`  0009_rbac.sql              ${migrationsState.v0009 ? "✅ aplicada" : "❌ falta"}`);
console.log();

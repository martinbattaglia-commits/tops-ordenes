#!/usr/bin/env node
/**
 * Smoke test del módulo RBAC: lee roles + permisos desde DB real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env.local"), "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\n📋 Roles seedeados en DB real:\n");
const { data: roles } = await supabase
  .from("roles")
  .select("slug, name, color, is_system, role_permissions(permission_id)")
  .order("name");
for (const r of roles) {
  const perms = r.role_permissions?.length ?? 0;
  console.log(`  ${r.color}  ${r.slug.padEnd(15)} · ${r.name.padEnd(28)} · ${String(perms).padStart(2)} permisos · ${r.is_system ? "system" : "custom"}`);
}

console.log("\n🏭 Vendors seedeados:\n");
const { data: vendors } = await supabase
  .from("vendors")
  .select("razon, cuit, categoria, cond_pago")
  .order("razon");
for (const v of vendors) {
  console.log(`  ${v.razon.padEnd(32)} · ${v.cuit} · ${(v.categoria ?? "—").padEnd(22)} · ${v.cond_pago}`);
}

console.log("\n📦 Products seedeados:\n");
const { data: products } = await supabase
  .from("products")
  .select("sku, label, price, vendor:vendors(razon)")
  .order("price", { ascending: false });
for (const p of products) {
  console.log(`  ${p.sku.padEnd(14)} · $${String(p.price).padStart(10)} · ${p.label.slice(0, 38).padEnd(38)} · ${p.vendor?.razon ?? "—"}`);
}

console.log(`\n✨ Total: ${roles.length} roles · ${vendors.length} vendors · ${products.length} products\n`);

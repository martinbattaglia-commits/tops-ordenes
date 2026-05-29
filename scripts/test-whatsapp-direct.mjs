#!/usr/bin/env node
/**
 * Test directo con phone_number_id ya configurado.
 *
 * Uso:
 *   node scripts/test-whatsapp-direct.mjs ping
 *   node scripts/test-whatsapp-direct.mjs templates
 *   node scripts/test-whatsapp-direct.mjs send                  → hello_world a default
 *   node scripts/test-whatsapp-direct.mjs send 5491131079124    → hello_world a otro
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env.local"), "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const TOKEN = env.META_WA_TOKEN;
const PHONE_ID = env.META_WA_PHONE_NUMBER_ID;
const WABA_ID = env.META_WA_BUSINESS_ACCOUNT_ID;
const GRAPH = "https://graph.facebook.com/v22.0";
const cmd = process.argv[2] ?? "ping";

console.log(`\n🔑 Token: ${TOKEN.slice(0, 20)}...`);
console.log(`📞 Phone Number ID: ${PHONE_ID}`);
console.log(`🏢 WABA ID: ${WABA_ID}\n`);

async function fb(path, init = {}) {
  const res = await fetch(`${GRAPH}/${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

if (cmd === "ping") {
  console.log("📡 Phone number info\n");
  const r = await fb(
    `${PHONE_ID}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,code_verification_status`
  );
  if (r.ok) {
    console.log("   ✅ OK");
    console.log("  ", JSON.stringify(r.body, null, 2).split("\n").join("\n   "));
  } else {
    console.log(`   ❌ ${r.status}:`, r.body);
  }
} else if (cmd === "templates") {
  console.log("📝 Templates\n");
  const r = await fb(
    `${WABA_ID}/message_templates?fields=name,status,language,category&limit=50`
  );
  if (r.ok) {
    for (const t of r.body.data ?? []) {
      const icon = t.status === "APPROVED" ? "✅" : t.status === "PENDING" ? "⏳" : "❌";
      console.log(`   ${icon} ${t.name.padEnd(35)} · ${t.language} · ${t.category} · ${t.status}`);
    }
  } else {
    console.log(`   ❌ ${r.status}:`, r.body);
  }
} else if (cmd === "send") {
  const dest = (process.argv[3] ?? env.WHATSAPP_NOTIFY_DEFAULT ?? "").replace(/[^\d]/g, "");
  if (!dest) {
    console.error("❌ Sin destino");
    process.exit(1);
  }
  console.log(`📤 Enviando hello_world a +${dest}\n`);
  const r = await fb(`${PHONE_ID}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: dest,
      type: "template",
      template: { name: "hello_world", language: { code: "en_US" } },
    }),
  });
  if (r.ok) {
    console.log(`   ✅ Enviado · message_id: ${r.body.messages?.[0]?.id}`);
    console.log(`   📱 Chequeá WhatsApp en +${dest}`);
  } else {
    console.log(`   ❌ ${r.status}:`, JSON.stringify(r.body, null, 2));
  }
} else {
  console.error(`Comando desconocido: ${cmd}`);
  process.exit(1);
}
console.log();

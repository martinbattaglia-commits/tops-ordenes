#!/usr/bin/env node
/**
 * Discovery + smoke test de WhatsApp Cloud API (Meta).
 *
 * Pasos:
 *  1. Valida el token con /me
 *  2. Lista WhatsApp Business Accounts del token
 *  3. Lista phone numbers de cada WABA
 *  4. (Opcional) Envía mensaje de hello_world al número destino
 *
 * Uso:
 *   node scripts/test-whatsapp.mjs                          → solo discovery
 *   node scripts/test-whatsapp.mjs send                     → discovery + envío de prueba
 *   node scripts/test-whatsapp.mjs send 5491131079124       → envía a otro número
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const TOKEN = env.META_WA_TOKEN;
const GRAPH = "https://graph.facebook.com/v22.0";

if (!TOKEN) {
  console.error("❌ META_WA_TOKEN no configurado");
  process.exit(1);
}

console.log(`\n🔑 Token: ${TOKEN.slice(0, 20)}...${TOKEN.slice(-6)}\n`);

async function fb(path, init = {}) {
  const res = await fetch(`${GRAPH}/${path.replace(/^\//, "")}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`   ❌ ${res.status}:`, JSON.stringify(body, null, 2));
    return null;
  }
  return body;
}

// 1. Validar token (debug_token o /me)
console.log("📡 1. Validando token con debug_token\n");
const debug = await fb(`debug_token?input_token=${TOKEN}`);
if (debug?.data) {
  const d = debug.data;
  console.log(`   ✅ Token válido`);
  console.log(`   App ID: ${d.app_id}`);
  console.log(`   Type: ${d.type}`);
  console.log(`   Scopes: ${(d.scopes ?? []).join(", ")}`);
  console.log(`   Expira: ${d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "nunca"}`);
  console.log(`   User ID: ${d.user_id ?? "—"}\n`);
}

// 2. Listar WABAs
console.log("📋 2. WhatsApp Business Accounts disponibles\n");
const me = await fb("me?fields=id,name");
if (me) {
  console.log(`   Cuenta: ${me.name} (${me.id})`);
}

// Buscar WABAs por business account
const businesses = await fb("me/businesses?fields=id,name");
let wabaIds = [];

if (businesses?.data?.length) {
  for (const b of businesses.data) {
    console.log(`\n   🏢 Business: ${b.name} (${b.id})`);
    const wabas = await fb(
      `${b.id}/owned_whatsapp_business_accounts?fields=id,name,timezone_id`
    );
    if (wabas?.data?.length) {
      for (const w of wabas.data) {
        wabaIds.push(w.id);
        console.log(`      ✅ WABA: ${w.name ?? "(sin nombre)"} (${w.id})`);
      }
    }
  }
} else {
  // Token de tipo system user — probamos endpoint alternativo
  console.log(`   (no hay /me/businesses — probando alternativas)`);
}

// 3. Listar phone numbers de cada WABA
let allNumbers = [];
console.log(`\n📞 3. Phone Numbers de las WABAs\n`);
for (const wabaId of wabaIds) {
  const nums = await fb(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`
  );
  if (nums?.data?.length) {
    for (const n of nums.data) {
      allNumbers.push({ ...n, waba: wabaId });
      console.log(`   ✅ ${n.display_phone_number} (id: ${n.id})`);
      console.log(`      Verified: ${n.verified_name ?? "—"} · Quality: ${n.quality_rating ?? "—"} · Status: ${n.code_verification_status ?? "—"}`);
    }
  }
}

if (allNumbers.length === 0) {
  console.log("   ⚠️  No se encontraron números via /me/businesses.");
  console.log("   Probá ir a https://business.facebook.com → WhatsApp Accounts");
  console.log("   y copiá manualmente el Phone Number ID y WABA ID.\n");
  process.exit(0);
}

// 4. Auto-update .env.local con el primer número encontrado
const firstNumber = allNumbers[0];
const newEnv = readFileSync(envPath, "utf-8")
  .replace(/META_WA_PHONE_NUMBER_ID=.*/m, `META_WA_PHONE_NUMBER_ID=${firstNumber.id}`)
  .replace(/META_WA_BUSINESS_ACCOUNT_ID=.*/m, `META_WA_BUSINESS_ACCOUNT_ID=${firstNumber.waba}`);
writeFileSync(envPath, newEnv);
console.log(`\n✏️  .env.local actualizado:`);
console.log(`   META_WA_PHONE_NUMBER_ID=${firstNumber.id}`);
console.log(`   META_WA_BUSINESS_ACCOUNT_ID=${firstNumber.waba}\n`);

// 5. Listar templates aprobados
console.log("📝 4. Templates aprobados\n");
const tpls = await fb(`${firstNumber.waba}/message_templates?fields=name,status,language,category`);
if (tpls?.data?.length) {
  for (const t of tpls.data) {
    const icon = t.status === "APPROVED" ? "✅" : t.status === "PENDING" ? "⏳" : "❌";
    console.log(`   ${icon} ${t.name.padEnd(30)} · ${t.language} · ${t.category} · ${t.status}`);
  }
} else {
  console.log("   (sin templates — el sandbox suele tener `hello_world` por defecto)");
}

// 6. Envío de prueba (opcional)
if (process.argv[2] === "send") {
  const dest = (process.argv[3] ?? env.WHATSAPP_NOTIFY_DEFAULT ?? "5491131079124").replace(/[^\d]/g, "");
  console.log(`\n📤 5. Enviando mensaje de prueba a +${dest}\n`);
  const sendRes = await fb(`${firstNumber.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: dest,
      type: "template",
      template: {
        name: "hello_world",
        language: { code: "en_US" },
      },
    }),
  });
  if (sendRes) {
    console.log(`   ✅ Enviado · message_id: ${sendRes.messages?.[0]?.id}`);
    console.log(`   📱 Chequeá WhatsApp en +${dest}\n`);
  }
}

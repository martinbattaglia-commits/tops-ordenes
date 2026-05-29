#!/usr/bin/env node
/**
 * Smoke test OpenAI API:
 *  1. Ping con chat.completions (validar key)
 *  2. Test Vision con imagen sintética
 *  3. Reportar uso/costos
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

const KEY = env.OPENAI_API_KEY;
const MODEL = env.OPENAI_OCR_MODEL ?? "gpt-4o-mini";

if (!KEY) {
  console.error("❌ OPENAI_API_KEY no configurada");
  process.exit(1);
}

console.log(`\n🔑 API Key: ${KEY.slice(0, 15)}...${KEY.slice(-6)}`);
console.log(`🤖 Model: ${MODEL}\n`);

// 1. Ping mínimo
console.log("📡 Test 1: chat.completions ping\n");
const t0 = Date.now();
const pingRes = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: "Sos un asistente de TOPS NEXUS. Responde en español, breve." },
      { role: "user", content: "Decime en una sola línea qué hace un ERP logístico 3PL." },
    ],
    max_tokens: 80,
  }),
});

if (!pingRes.ok) {
  console.error(`❌ ${pingRes.status}:`, await pingRes.text());
  process.exit(1);
}
const pingData = await pingRes.json();
console.log(`  ✅ ${Date.now() - t0}ms · ${pingData.usage?.total_tokens} tokens`);
console.log(`  💬 "${pingData.choices[0].message.content.trim()}"\n`);

// 2. Vision con imagen pequeña (factura sintética como data URL)
console.log("👁️  Test 2: Vision OCR con imagen sintética\n");
// Imagen base64 1x1 white pixel (solo para validar que el endpoint Vision responde)
const dummyImg =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const t1 = Date.now();
const visionRes = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "¿Qué ves en esta imagen? Responde en una palabra." },
          { type: "image_url", image_url: { url: dummyImg } },
        ],
      },
    ],
    max_tokens: 30,
  }),
});

if (!visionRes.ok) {
  console.error(`❌ Vision falló (${visionRes.status}):`, await visionRes.text());
  process.exit(1);
}
const visionData = await visionRes.json();
console.log(`  ✅ ${Date.now() - t1}ms · ${visionData.usage?.total_tokens} tokens`);
console.log(`  💬 "${visionData.choices[0].message.content.trim()}"\n`);

// 3. Resumen de uso
const totalTokens = (pingData.usage?.total_tokens ?? 0) + (visionData.usage?.total_tokens ?? 0);
const estimatedCost = (totalTokens / 1000) * 0.00015; // gpt-4o-mini avg
console.log(`📊 Total: ${totalTokens} tokens · ~$${estimatedCost.toFixed(6)} USD\n`);
console.log(`✨ OpenAI listo para OCR Centro Documental\n`);

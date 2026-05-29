#!/usr/bin/env node
/**
 * Smoke test OCR end-to-end con el contrato ANMAT real del usuario.
 * Lee un PDF de disco, lo manda al endpoint /api/documental/ocr y muestra el extract.
 *
 * Para que funcione, antes hay que arrancar el dev server (npm run dev en otro tty).
 */
import { readFileSync, existsSync } from "node:fs";
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

// Test directo del lib OCR (sin pasar por el endpoint web)
const pdfPath =
  process.argv[2] ??
  "/Users/martinbattaglia/Downloads/Version Final Contrato ANMAT (2).pdf";

if (!existsSync(pdfPath)) {
  console.error(`❌ PDF no encontrado: ${pdfPath}`);
  process.exit(1);
}

console.log(`\n📄 PDF: ${pdfPath}`);
const buffer = readFileSync(pdfPath);
console.log(`   ${(buffer.length / 1024).toFixed(1)} KB\n`);

// 1. pdf-parse
console.log("🔍 1. Extrayendo texto con pdf-parse…\n");
const { PDFParse } = await import("pdf-parse");
const t0 = Date.now();
const parser = new PDFParse({ data: new Uint8Array(buffer) });
const textResult = await parser.getText();
await parser.destroy();
const parsed = { text: textResult.text ?? "", numpages: textResult.pages?.length ?? 1 };
console.log(`   ✅ ${Date.now() - t0}ms · ${parsed.numpages} páginas · ${parsed.text.length} caracteres`);
console.log(`   📝 Preview: "${parsed.text.slice(0, 200).replace(/\s+/g, " ")}…"\n`);

// 2. OpenAI extraction
console.log("🤖 2. Estructurando con GPT-4o-mini…\n");
const KEY = env.OPENAI_API_KEY;
const MODEL = env.OPENAI_OCR_MODEL ?? "gpt-4o-mini";

const PROMPT = `Eres un asistente que extrae datos estructurados de documentos corporativos
argentinos (facturas, remitos, contratos, habilitaciones ANMAT, certificados, OC, presupuestos).
Para Logística TOPS / Verotin S.A.

Devolvé EXCLUSIVAMENTE un JSON válido con esta estructura:
{
  "type": "factura|remito|contrato|habilitacion|certificado|auditoria|presupuesto|orden_compra|orden_servicio|constancia_afip|otro",
  "typeConfidence": 0.0-1.0,
  "title": "Identificador",
  "date": "YYYY-MM-DD o null",
  "expiresAt": "YYYY-MM-DD o null",
  "summary": "1-2 oraciones",
  "parties": [{ "name": "string", "taxId": "XX-XXXXXXXX-X o null", "address": "string o null", "role": "emisor|receptor|cliente|proveedor|destinatario" }],
  "amounts": [{ "value": number, "currency": "ARS|USD", "original": "string", "kind": "subtotal|iva|total|neto|otro" }],
  "lineItems": [{ "description": "string", "quantity": number|null, "unit": "string|null", "unitPrice": number|null, "subtotal": number|null, "sku": "string|null" }],
  "tags": ["tag1", "tag2", ...]
}`;

const t1 = Date.now();
const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: PROMPT },
      {
        role: "user",
        content: `Documento (${parsed.numpages} páginas):\n\n${parsed.text.slice(0, 30000)}`,
      },
    ],
    max_tokens: 2500,
    temperature: 0.1,
    response_format: { type: "json_object" },
  }),
});

if (!res.ok) {
  console.error(`❌ ${res.status}:`, await res.text());
  process.exit(1);
}

const body = await res.json();
const extract = JSON.parse(body.choices[0].message.content);

console.log(`   ✅ ${Date.now() - t1}ms · ${body.usage?.total_tokens} tokens · ~$${((body.usage?.total_tokens ?? 0) / 1000000 * 0.15).toFixed(6)} USD\n`);

console.log("📊 Extract estructurado:\n");
console.log(`   Tipo:        ${extract.type} (confianza ${Math.round((extract.typeConfidence ?? 0) * 100)}%)`);
console.log(`   Título:      ${extract.title ?? "—"}`);
console.log(`   Fecha:       ${extract.date ?? "—"}`);
console.log(`   Vence:       ${extract.expiresAt ?? "—"}`);
console.log(`   Resumen:     ${extract.summary ?? "—"}`);
console.log(`\n   Partes (${extract.parties?.length ?? 0}):`);
for (const p of extract.parties ?? []) {
  console.log(`     • ${p.name}${p.taxId ? " · " + p.taxId : ""}${p.role ? " · " + p.role : ""}`);
}
console.log(`\n   Montos (${extract.amounts?.length ?? 0}):`);
for (const a of extract.amounts ?? []) {
  console.log(`     • ${a.currency ?? "—"} ${a.value} ${a.kind ? `(${a.kind})` : ""}`);
}
console.log(`\n   Tags: ${(extract.tags ?? []).join(", ")}`);
console.log();

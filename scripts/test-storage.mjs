#!/usr/bin/env node
/**
 * Smoke test de Supabase Storage para PDFs OC.
 * Sube un PDF dummy a po-pdfs y verifica la URL pública.
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

// Minimal valid PDF (creado a mano)
const minimalPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj\n" +
    "4 0 obj<</Length 60>>stream\nBT /F1 24 Tf 100 700 Td (TOPS NEXUS - test PDF) Tj ET\nendstream\nendobj\n" +
    "xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000091 00000 n \n0000000158 00000 n \n" +
    "trailer<</Size 5/Root 1 0 R>>\nstartxref\n260\n%%EOF\n",
  "utf-8"
);

const path = "2026/05-mayo/TEST-OC-2026-9999.pdf";
console.log(`\n📤 Subiendo ${minimalPdf.length} bytes a po-pdfs/${path}\n`);

const { error: upErr } = await supabase.storage
  .from("po-pdfs")
  .upload(path, minimalPdf, { contentType: "application/pdf", upsert: true });

if (upErr) {
  console.error("❌ Upload falló:", upErr.message);
  process.exit(1);
}

const { data: pub } = supabase.storage.from("po-pdfs").getPublicUrl(path);
console.log(`✅ Upload OK\n🌍 URL pública: ${pub.publicUrl}\n`);

// Verificar que se puede descargar
console.log("📥 Descargando para verificar...\n");
const resp = await fetch(pub.publicUrl);
console.log(`   HTTP ${resp.status} ${resp.statusText}`);
console.log(`   Content-Type: ${resp.headers.get("content-type")}`);
console.log(`   Content-Length: ${resp.headers.get("content-length")} bytes`);

if (resp.ok) {
  console.log("\n✨ Storage workflow end-to-end OK\n");
} else {
  console.log("\n❌ No se pudo descargar el PDF\n");
}

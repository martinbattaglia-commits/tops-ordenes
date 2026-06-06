/**
 * clientify-capture-real.mjs — G-3 · captura READ-ONLY de la forma real del contacto.
 *
 * Uso (desde la raíz):  node scripts/clientify-capture-real.mjs
 *
 * GET /v1/contacts/?page_size=1 (SOLO LECTURA · no muta nada) → extrae la
 * ESTRUCTURA de campos reales, REDACTA PII y guarda
 * docs/comercial/fixtures/clientify-contact-REAL.json (apto para commitear).
 * NO imprime PII: solo nombres de campo (keys) y tipos.
 *
 * Autorizado puntualmente (regla "no tocar Clientify PROD" → solo lectura).
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const key = (process.env.CLIENTIFY_API_KEY || "").trim();
const base = (process.env.CLIENTIFY_BASE_URL || "https://api.clientify.net/v1").replace(/\/$/, "");
if (!key) { console.error("❌ CLIENTIFY_API_KEY no configurada."); process.exit(1); }

// Reemplazos sintéticos por clave PII (preserva nombre de campo + tipo).
const PII = {
  first_name: "Nombre", last_name: "Apellido", name: "Nombre Apellido",
  email: "contacto@empresa.test", phone: "+54 11 4000-0000",
  owner_name: "Owner Redactado", owner: "https://api.clientify.net/v1/users/0/",
  taxpayer_identification_number: "30-12345678-9", picture_url: null,
  street: "Calle 123", city: "CABA", zip: "1000", value: "redacted",
};
function redact(node, key) {
  if (Array.isArray(node)) return node.map((x) => redact(x, key));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = redact(v, k);
    return out;
  }
  if (typeof node === "string" && key in PII) return PII[key];
  return node; // ids, números, booleanos, enums, fechas, tags → se conservan
}
function shape(node) {
  if (Array.isArray(node)) return node.length ? [shape(node[0])] : [];
  if (node && typeof node === "object") {
    const o = {}; for (const [k, v] of Object.entries(node)) o[k] = shape(v); return o;
  }
  return typeof node;
}

(async () => {
  const res = await fetch(`${base}/contacts/?page_size=1`, {
    headers: { Authorization: `Token ${key}`, Accept: "application/json" }, cache: "no-store",
  });
  if (!res.ok) { console.error(`❌ Clientify ${res.status} ${res.statusText}`); process.exit(1); }
  const data = await res.json();
  const contact = data?.results?.[0];
  if (!contact) { console.error("❌ Sin contactos en la cuenta (no se pudo capturar forma)."); process.exit(1); }

  const redacted = redact(contact);
  const fixture = {
    _meta: {
      purpose: "Captura REAL (read-only GET /contacts) con PII redactada. Nombres de campo y estructura reales; valores sintéticos.",
      source: "real-redacted", capturedAt_note: "stamp manual si se requiere", shape: "flat-contact",
    },
    ...redacted,
  };
  writeFileSync("docs/comercial/fixtures/clientify-contact-REAL.json", JSON.stringify(fixture, null, 2) + "\n");

  // Salida SIN PII: solo nombres de campo y tipos.
  console.log("✅ Forma real capturada (PII redactada). Campos top-level:");
  console.log("   " + Object.keys(contact).sort().join(", "));
  console.log("\nEstructura (tipos):");
  console.log(JSON.stringify(shape(contact), null, 2));
  console.log("\nGuardado: docs/comercial/fixtures/clientify-contact-REAL.json");
})().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });

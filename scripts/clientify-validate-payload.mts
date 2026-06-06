/**
 * clientify-validate-payload.mts — G-3 · valida un payload Clientify contra el normalizador real.
 *
 * Uso (desde la raíz):  npx tsx scripts/clientify-validate-payload.mts
 *
 * Corre el `normalizeLead` REAL de la app sobre:
 *   1) el payload de REFERENCIA (inferido)            → docs/comercial/fixtures/clientify-contact-REFERENCE.json
 *   2) la CAPTURA REAL si existe (la dejás vos)        → docs/comercial/fixtures/clientify-contact-REAL.json
 *   3) una variante ENVELOPED (sanity)
 *
 * Objetivo (G-3): confirmar que el comportamiento real del webhook coincide con la
 * arquitectura — es decir, que el normalizador extrae identidad + campos del payload
 * real. Si la captura real deja algún campo en null que la referencia sí mapea,
 * lo marca: ahí hay una diferencia de nombres de campo a ajustar en webhook.ts.
 *
 * No toca red ni DB. No requiere staging.
 */
import { readFileSync, existsSync } from "node:fs";
import { normalizeLead } from "../src/lib/clientify/webhook";

const FIX = "docs/comercial/fixtures";
const results: Array<{ t: string; pass: boolean; detail: string }> = [];
const ok = (t: string, pass: boolean, detail = "") => results.push({ t, pass, detail });

function stripMeta(obj: Record<string, unknown>): Record<string, unknown> {
  const { _meta, ...rest } = obj; void _meta; return rest;
}

function checkPayload(label: string, raw: unknown, expectIdentity = true) {
  const norm = normalizeLead(raw);
  if (!norm) { ok(`${label}: normalizeLead devuelve resultado`, !expectIdentity, "null (sin identidad)"); return; }
  const l = norm.lead;
  ok(`${label}: identidad presente (clientify_id|email|phone)`, !!(l.clientify_id || l.email || l.phone),
    `id=${l.clientify_id} email=${l.email} phone=${l.phone}`);
  const mapped = Object.entries({
    clientify_id: l.clientify_id, full_name: l.full_name, email: l.email, phone: l.phone,
    cuit: l.cuit, source: l.source, tags: l.tags.length ? l.tags.join("|") : null,
  }).filter(([, v]) => v != null).map(([k]) => k);
  ok(`${label}: campos canónicos mapeados`, mapped.length >= 3, "mapeados=[" + mapped.join(", ") + "]" + (norm.event ? " event=" + norm.event : ""));
}

// 1 · REFERENCIA
const ref = JSON.parse(readFileSync(`${FIX}/clientify-contact-REFERENCE.json`, "utf8"));
checkPayload("REFERENCIA", stripMeta(ref));

// 2 · CAPTURA REAL (si existe)
const realPath = `${FIX}/clientify-contact-REAL.json`;
if (existsSync(realPath)) {
  const real = JSON.parse(readFileSync(realPath, "utf8"));
  console.log("ℹ️  Captura REAL encontrada → validando contra el normalizador.");
  checkPayload("REAL", stripMeta(typeof real === "object" && real ? real : {}));

  // Paridad: ¿qué mapea la referencia que la real NO? (diferencia de nombres de campo)
  const nr = normalizeLead(stripMeta(ref))?.lead;
  const nx = normalizeLead(stripMeta(real))?.lead;
  if (nr && nx) {
    const gaps = (["clientify_id", "full_name", "email", "phone", "cuit", "source"] as const)
      .filter((k) => nr[k] != null && nx[k] == null);
    ok("REAL: paridad de campos con la referencia", gaps.length === 0,
      gaps.length ? "campos que la REAL no mapeó: " + gaps.join(", ") + " → revisar webhook.ts" : "sin brechas");
  }
} else {
  console.log("⚠️  No hay captura REAL aún (docs/comercial/fixtures/clientify-contact-REAL.json).");
  console.log("    Seguí el runbook G-3 para capturarla; luego re-ejecutá este harness.");
}

// 3 · ENVELOPED (sanity)
checkPayload("ENVELOPED", { event: "contact.created", object_type: "contact", object_id: 778899, data: stripMeta(ref) });

// 4 · sin identidad → null
checkPayload("SIN-IDENTIDAD", { first_name: "Solo" }, false);

console.log("");
for (const r of results) console.log(`${r.pass ? "✅" : "❌"} ${r.t}${r.detail ? "  → " + r.detail : ""}`);
const passed = results.filter((r) => r.pass).length;
console.log("\n──────────────────────────────────────────────────────────────────");
console.log(`TOTAL ${results.length} · PASS ${passed} · FAIL ${results.length - passed}`);
console.log(passed === results.length ? "RESULTADO: GO ✅" : "RESULTADO: revisar ❌");
console.log(existsSync(realPath) ? "Validado contra captura REAL." : "Validado contra REFERENCIA (pendiente captura real — G-3).");
if (passed !== results.length) process.exitCode = 1;

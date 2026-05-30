#!/usr/bin/env node
/**
 * Auditoría read-only del estado REAL de Documents en producción.
 * Determina si lo aplicado es la versión MVP original (insegura) o la
 * Enterprise Hardened.
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
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log(`\n🔍  Documents — Audit de producción\n   ${env.NEXT_PUBLIC_SUPABASE_URL}\n`);

// 1. Tabla documents existe? cuántas filas?
const { count: docCount, error: docErr } = await supabase
  .from("documents")
  .select("*", { count: "exact", head: true });
console.log(`📋 documents (table): ${docErr ? "❌ NO existe" : "✅ existe · " + (docCount ?? 0) + " filas"}`);

// 2. documents_audit existe? (señal Enterprise)
const { count: auditCount, error: auditErr } = await supabase
  .from("documents_audit")
  .select("*", { count: "exact", head: true });
const hasAudit = !auditErr;
console.log(
  `📋 documents_audit (table): ${
    hasAudit ? "✅ existe · " + (auditCount ?? 0) + " filas (señal Enterprise)" : "❌ NO existe (señal MVP)"
  }`
);

// 3. Bucket privado o público?
const { data: buckets } = await supabase.storage.listBuckets();
const docsBucket = (buckets ?? []).find((b) => b.id === "documents");
if (docsBucket) {
  console.log(
    `🪣 bucket documents: existe · ${
      docsBucket.public ? "🔴 PÚBLICO (MVP)" : "🟢 PRIVADO (Enterprise)"
    }`
  );
  if (docsBucket.file_size_limit) {
    console.log(`   file_size_limit: ${docsBucket.file_size_limit} bytes`);
  }
  if (docsBucket.allowed_mime_types?.length) {
    console.log(`   allowed_mime_types: ${docsBucket.allowed_mime_types.join(", ")}`);
  }
} else {
  console.log(`🪣 bucket documents: ❌ NO existe`);
}

// 4. Columnas críticas de documents (señales Enterprise)
if (!docErr) {
  // Tomamos una fila para ver shape
  const { data: sample } = await supabase.from("documents").select("*").limit(1).maybeSingle();
  if (sample) {
    const enterpriseCols = [
      "document_group_id",
      "version",
      "is_current",
      "supersedes_id",
      "deleted_at",
      "deleted_by",
    ];
    const found = enterpriseCols.filter((c) => c in sample);
    console.log(
      `\n🧬 Columnas Enterprise en sample row: ${found.length}/${enterpriseCols.length}`
    );
    for (const c of enterpriseCols) {
      console.log(`   ${c in sample ? "✅" : "❌"} ${c}`);
    }
  } else {
    console.log(`\n🧬 documents está vacío — no se puede inspeccionar columnas via select`);
  }
}

// 5. Permisos documental.*
const { data: perms } = await supabase
  .from("permissions")
  .select("slug")
  .like("slug", "documental.%")
  .order("slug");
console.log(`\n🔐 Permisos documental.*: ${perms?.length ?? 0}`);
for (const p of perms ?? []) console.log(`   ${p.slug}`);

// 6. Veredicto
console.log(`\n📊  Veredicto:`);
const enterpriseSignals = [
  hasAudit,
  docsBucket && !docsBucket.public,
  perms && perms.length >= 5,
];
const enterpriseScore = enterpriseSignals.filter(Boolean).length;
const totalSignals = enterpriseSignals.length;
if (enterpriseScore === totalSignals) {
  console.log(`   🟢 ENTERPRISE HARDENED aplicada (${enterpriseScore}/${totalSignals} señales)`);
} else if (enterpriseScore === 0) {
  console.log(`   🔴 MVP ORIGINAL aplicada (sin Enterprise) — REQUIERE GATE 3 de upgrade`);
} else {
  console.log(`   🟡 HÍBRIDA / parcial (${enterpriseScore}/${totalSignals}) — investigar`);
}
console.log();

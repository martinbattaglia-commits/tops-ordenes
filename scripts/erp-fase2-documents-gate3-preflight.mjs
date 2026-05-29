#!/usr/bin/env node
/**
 * NEXUS ERP · FASE 2 · DOCUMENTS · GATE 3 · PRE-FLIGHT
 *
 * Verificación read-only del estado del repo + producción antes de
 * autorizar la aplicación de 0010_documents.sql Enterprise.
 *
 * NO toca producción. NO aplica SQL. NO modifica nada.
 *
 * Uso:
 *   node scripts/erp-fase2-documents-gate3-preflight.mjs          → pre-aplicación
 *   node scripts/erp-fase2-documents-gate3-preflight.mjs --post   → post-aplicación
 *
 * Salida: tabla con cada chequeo + veredicto GO / NO-GO.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const isPost = process.argv.includes("--post");

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, ".env.local"), "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
const ok = (id, label, detail = "") => results.push({ id, status: "ok", label, detail });
const warn = (id, label, detail = "") => results.push({ id, status: "warn", label, detail });
const fail = (id, label, detail = "") => results.push({ id, status: "fail", label, detail });

console.log(
  `\n📋  NEXUS ERP · FASE 2 · DOCUMENTS · GATE 3 · PRE-FLIGHT  ${isPost ? "(POST)" : "(PRE)"}\n`
);
console.log(`   Proyecto Supabase: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`   Fecha: ${new Date().toISOString()}\n`);

// ============================================================
// PR-1: Migración 0010 presente y con tamaño esperado
// ============================================================
const migPath = resolve(ROOT, "supabase/migrations/0010_documents.sql");
if (existsSync(migPath)) {
  const lines = readFileSync(migPath, "utf-8").split("\n").length;
  const sha = execSync(`shasum -a 256 "${migPath}"`).toString().trim().split(" ")[0];
  if (lines >= 400) {
    ok("PR-1", "Migración 0010 presente", `${lines} líneas · SHA256 ${sha.slice(0, 12)}…`);
  } else {
    warn(
      "PR-1",
      "Migración 0010 presente pero corta",
      `Solo ${lines} líneas. Enterprise Hardened debería ser ≥ 449. Verificar.`
    );
  }
} else {
  fail("PR-1", "Migración 0010 AUSENTE", "Falta supabase/migrations/0010_documents.sql");
}

// ============================================================
// PR-2: App NO usa getPublicUrl (debe usar createSignedUrl)
// ============================================================
try {
  const grepResult = execSync(
    `grep -rn "getPublicUrl" src/lib/documental/ "src/app/(app)/documental/" 2>/dev/null || true`,
    { cwd: ROOT }
  ).toString().trim();
  if (!grepResult) {
    ok("PR-2", "App usa signed URLs (sin getPublicUrl)", "Ningún hit");
  } else {
    fail(
      "PR-2",
      "App TODAVÍA referencia getPublicUrl",
      grepResult.split("\n").slice(0, 3).join(" · ")
    );
  }
} catch (e) {
  warn("PR-2", "No se pudo verificar getPublicUrl", e.message);
}

// ============================================================
// PR-3: Build limpio (typecheck rápido sin emit)
// ============================================================
try {
  execSync("npx tsc --noEmit 2>&1", { cwd: ROOT, stdio: "pipe" });
  ok("PR-3", "Typecheck pasa", "npx tsc --noEmit OK");
} catch (e) {
  const errOutput = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
  fail(
    "PR-3",
    "Typecheck FALLA",
    errOutput.split("\n").slice(0, 3).join(" · ")
  );
}

// ============================================================
// PR-4: Producción sin tabla documents NI bucket (pre-aplicación)
// PR-4-POST: Producción CON tabla + bucket privado (post-aplicación)
// ============================================================
try {
  // Tabla documents
  const { error: docErr, count: docCount } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true });

  const tableExists = !docErr;

  // Tabla documents_audit
  const { error: auditErr } = await supabase
    .from("documents_audit")
    .select("*", { count: "exact", head: true });
  const auditExists = !auditErr;

  // Bucket
  const { data: buckets } = await supabase.storage.listBuckets();
  const docsBucket = (buckets ?? []).find((b) => b.id === "documents");

  if (isPost) {
    // POST: todo debe existir
    if (tableExists && auditExists && docsBucket) {
      ok(
        "PR-4-POST",
        "documents + audit + bucket existen",
        `documents=${docCount ?? 0} rows · bucket public=${docsBucket.public}`
      );
      if (docsBucket.public) {
        fail(
          "PR-4-PRIV",
          "Bucket 'documents' es PÚBLICO (debería ser privado)",
          "🚨 ROLLBACK INMEDIATO RECOMENDADO"
        );
      } else {
        ok("PR-4-PRIV", "Bucket 'documents' es PRIVADO", "public=false ✓");
      }
    } else {
      fail(
        "PR-4-POST",
        "Estado post-aplicación INCOMPLETO",
        `table=${tableExists} · audit=${auditExists} · bucket=${!!docsBucket}`
      );
    }
  } else {
    // PRE: nada debe existir
    if (!tableExists && !auditExists && !docsBucket) {
      ok(
        "PR-4",
        "Producción limpia (sin documents/audit/bucket)",
        "Listo para aplicar 0010 sin conflictos"
      );
    } else {
      warn(
        "PR-4",
        "Producción tiene objetos pre-existentes",
        `table=${tableExists} · audit=${auditExists} · bucket=${!!docsBucket} — verificar idempotencia`
      );
    }
  }
} catch (e) {
  fail("PR-4", "Error consultando Supabase", e.message);
}

// ============================================================
// PR-5: Restore points (informativo, no automatizable via API pública)
// ============================================================
warn(
  "PR-5",
  "Restore point manual (no verificable por script)",
  "Verificar en Dashboard → Database → Backups antes de ejecutar"
);

// ============================================================
// PR-6: Backup local pg_dump (informativo)
// ============================================================
const backupsDir = resolve(ROOT, "backups");
if (existsSync(backupsDir)) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const expectedName = `prod-pre-0010-${today}`;
  try {
    const files = execSync(`ls -1 "${backupsDir}" 2>/dev/null`).toString().trim().split("\n");
    const hasBackup = files.some((f) => f.includes("prod-pre-0010"));
    if (hasBackup) {
      ok("PR-6", "Backup pg_dump local presente", files.find((f) => f.includes("prod-pre-0010")));
    } else {
      warn("PR-6", "Sin backup pg_dump local", `Esperado: ${expectedName}.sql.gz`);
    }
  } catch {
    warn("PR-6", "Directorio backups/ vacío", `Crear backup antes de ejecutar`);
  }
} else {
  warn("PR-6", "Directorio backups/ no existe", "Crear backup pg_dump antes de ejecutar");
}

// ============================================================
// PR-7: Idempotencia (no verificable sin entorno staging activo)
// ============================================================
warn(
  "PR-7",
  "Idempotencia (verificar en staging)",
  "Aplicar 0010 dos veces a tops-nexus-staging; ambas deben pasar"
);

// ============================================================
// PR-8/9/10: Coordinación humana (no verificable por script)
// ============================================================
warn("PR-8", "Ventana de mantenimiento (coordinación)", "Acordar con Ruth + JL");
warn("PR-9", "Equipo on-call (coordinación)", "Designar DBA + Front backup");
warn("PR-10", "Rollback runbook (lectura)", "Walkthrough con CTO + DBA");

// ============================================================
// Verificación adicional POST: triggers + permisos + idempotencia
// ============================================================
if (isPost) {
  try {
    // Triggers (consulta via RPC no disponible, hacemos un select indirecto)
    const { error: trigErr } = await supabase
      .from("documents_audit")
      .select("ts")
      .limit(1);

    if (!trigErr) {
      ok("POST-A", "documents_audit accesible", "audit lectura OK");
    }

    // Permisos
    const { data: perms } = await supabase
      .from("permissions")
      .select("slug")
      .like("slug", "documental.%")
      .order("slug");
    if (perms && perms.length >= 5) {
      ok(
        "POST-B",
        "Permisos documental.* presentes",
        perms.map((p) => p.slug).join(", ")
      );
    } else {
      warn(
        "POST-B",
        "Permisos documental.* INCOMPLETOS",
        `Esperados ≥5, encontrados ${perms?.length ?? 0}`
      );
    }
  } catch (e) {
    warn("POST-X", "Verificación post incompleta", e.message);
  }
}

// ============================================================
// Salida
// ============================================================
console.log("┌─────────┬────────┬────────────────────────────────────────────────────────┐");
console.log("│  ID     │ Status │ Detalle                                                 │");
console.log("├─────────┼────────┼────────────────────────────────────────────────────────┤");
for (const r of results) {
  const icon = r.status === "ok" ? "✅ OK  " : r.status === "warn" ? "⚠️ WARN" : "❌ FAIL";
  const label = (r.label + (r.detail ? ` — ${r.detail}` : "")).slice(0, 54);
  console.log(`│ ${r.id.padEnd(7)} │ ${icon} │ ${label.padEnd(54)} │`);
}
console.log("└─────────┴────────┴────────────────────────────────────────────────────────┘");

const fails = results.filter((r) => r.status === "fail").length;
const warns = results.filter((r) => r.status === "warn").length;
const oks = results.filter((r) => r.status === "ok").length;

console.log(`\n📊  Resumen: ${oks} OK · ${warns} WARN · ${fails} FAIL\n`);

if (fails > 0) {
  console.log("🛑  VEREDICTO: ❌ NO-GO — hay fallos críticos. NO ejecutar GATE 3.\n");
  process.exit(2);
} else if (warns > 0 && !isPost) {
  console.log(
    "🟡  VEREDICTO: ⏸  CONDICIONAL — resolver los WARN coordinativos antes de ejecutar GATE 3.\n"
  );
  console.log("    Los WARN no son bloqueantes técnicos pero requieren acción humana");
  console.log("    (restore point, backup, ventana, on-call, rollback walkthrough).\n");
  process.exit(1);
} else {
  console.log("🟢  VEREDICTO: ✅ GO — pre-flight limpio.\n");
  process.exit(0);
}

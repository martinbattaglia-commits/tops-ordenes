/**
 * P3-N1B · MANIFIESTO REPRODUCIBLE DE MUTANTES (N-01) — herramienta de guardián.
 *
 * Uso:   node tests/db/scripts/p3-n1b-mutants.mjs
 *
 * Qué hace: aplica, UNO POR VEZ, cada uno de los CATORCE mutantes declarados
 * sobre los archivos del expediente P3-N1B, corre la suite discriminante
 * mínima con la MISMA configuración oficial (`vitest.db.config.ts`, que exige
 * PostgreSQL 17 local vía initdb/pg_ctl), y restaura el archivo BYTE A BYTE
 * verificando SHA-256 antes de pasar al siguiente.
 *
 * Autoridad de muerte: exit code ≠ 0 de la corrida discriminante. Nada
 * textual cuenta como muerte. Un patrón que no matchea el árbol actual se
 * reporta como ERROR y el manifiesto entero se considera FALLIDO: un
 * manifiesto que muta en el vacío no prueba nada.
 *
 * 🔴 JAMÁS en CI: muta transitoriamente el árbol de trabajo. Es una campaña
 * manual y reproducible para revisiones C4/Guardian. Se niega a correr si
 * detecta `CI` en el entorno o si el árbol tiene cambios stageados (el
 * respaldo/restauración es por archivo completo y no debe pisar un índice a
 * medio armar).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

const M0219 = "supabase/migrations/0219_wms_client_identity_foundation.sql";
const M0220 = "supabase/migrations/0220_wms_canonical_identity_cutover.sql";
const COMP = "supabase/migrations/ROLLBACK_0219_0220_wms_client_identity.md";

/**
 * Los CATORCE mutantes. Cada entrada: qué garantía ataca, dónde, la mutación
 * exacta (find→replace, aplicada una vez) y la suite discriminante mínima.
 * `edits` admite más de un sitio cuando la garantía tiene defensa en
 * profundidad y un solo corte quedaría enmascarado por la otra capa (M-11).
 */
export const MUTANTS = [
  {
    id: "M-01",
    name: "allocate_order vuelve a decidir por client_name",
    file: M0220,
    edits: [[
      "where ii.client_id = v_order.client_id",
      "where ii.client_name = v_order.client_name",
    ]],
    targets: ["tests/db/t-n1b-04-allocate-canonical.test.ts"],
  },
  {
    id: "M-02",
    name: "allocate_order ignora la business_unit declarada del pedido",
    file: M0220,
    edits: [[
      "and (v_order.business_unit is null or ii.business_unit = v_order.business_unit)",
      "",
    ]],
    targets: ["tests/db/t-n1b-04-allocate-canonical.test.ts"],
  },
  {
    id: "M-03",
    name: "la reserva pierde la business_unit (foto en NULL)",
    file: M0220,
    edits: [[
      "'reservada'::alloc_status_t, v_cand.bu, now(), auth.uid())",
      "'reservada'::alloc_status_t, null, now(), auth.uid())",
    ]],
    targets: ["tests/db/t-n1b-04-allocate-canonical.test.ts"],
  },
  {
    id: "M-04",
    name: "gate G-1 eliminado: el corte acepta cobertura parcial",
    file: M0220,
    edits: [[
      "select count(*) into v_n from public.inventory_items where client_id is null;",
      "select 0 into v_n;",
    ]],
    targets: ["tests/db/t-n1b-03-cutover-gates.test.ts"],
  },
  {
    id: "M-05",
    name: "la unicidad canónica se crea SIN nulls not distinct",
    file: M0220,
    edits: [[
      "create unique index inventory_items_canonical_identity_uk\n      on public.inventory_items (client_id, sku, position_id) nulls not distinct;",
      "create unique index inventory_items_canonical_identity_uk\n      on public.inventory_items (client_id, sku, position_id);",
    ]],
    // La poscondición de G-5 lo detecta al CARGAR 0220: el setup global de
    // cualquier suite muere. Se apunta a la discriminante semántica.
    targets: ["tests/db/t-a0-02-real-constraint.test.ts"],
  },
  {
    id: "M-06",
    name: "confirm_reception fusiona por client_name",
    file: M0220,
    edits: [[
      "where client_id = v_rec.client_id and sku = v_item.sku",
      "where client_name = v_rec.client_name and sku = v_item.sku",
    ]],
    targets: ["tests/db/t-n1b-05-confirm-reception-canonical.test.ts"],
  },
  {
    id: "M-07",
    name: "multi-BU elige una línea (heurística prohibida)",
    file: M0219,
    edits: [[
      "    -- Regla 3 + 4: ni elegir, ni conservar una línea que dejó de ser cierta.\n    update public.inventory_items set business_unit = null where id = p_item_id;",
      "    update public.inventory_items set business_unit = v_bus[1] where id = p_item_id;",
    ]],
    targets: ["tests/db/t-n1b-02-bu-projection.test.ts"],
  },
  {
    id: "M-08",
    name: "multi-BU conserva la línea vieja (regla 3 rota)",
    file: M0219,
    edits: [[
      "    -- Regla 3 + 4: ni elegir, ni conservar una línea que dejó de ser cierta.\n    update public.inventory_items set business_unit = null where id = p_item_id;",
      "    null; -- conserva lo que hubiera",
    ]],
    targets: ["tests/db/t-n1b-02-bu-projection.test.ts"],
  },
  {
    id: "M-09",
    name: "la omisión de business_unit se marca 'declared'",
    file: M0219,
    edits: [[
      "new.business_unit_source := 'defaulted';",
      "new.business_unit_source := 'declared';",
    ]],
    targets: ["tests/db/t-n1b-01-identity-foundation.test.ts"],
  },
  {
    id: "M-10",
    name: "la compensación no devuelve client_id a anulable",
    file: COMP,
    edits: [[
      "alter table public.inventory_items alter column client_id drop not null;",
      "-- (mutado: la compensación omite devolver la nulabilidad)",
    ]],
    targets: ["tests/db/t-n1b-06-rollback-reapply.test.ts"],
  },
  {
    id: "M-11",
    name: "gate G-5 eliminado (ambas capas): índice homónimo pasa sin validar",
    file: M0220,
    // 🔴 DOS sitios a propósito: G-5 tiene precondición y poscondición; cortar
    // una sola queda enmascarado por la otra (defensa en profundidad, se
    // verificó empíricamente). El mutante representa «retirar el gate», y el
    // gate son las dos capas.
    edits: [
      ["if not coalesce(v_exact, false) then", "if false and not coalesce(v_exact, false) then"],
      ["if not v_exact then", "if false and not v_exact then"],
    ],
    targets: ["tests/db/t-n1b-03-cutover-gates.test.ts"],
  },
  {
    id: "M-12",
    name: "sin vínculos conserva la BU anterior (B-01)",
    file: M0219,
    edits: [[
      "    -- Sin vínculos: sin fuente de proyección ⇒ sin valor.\n    update public.inventory_items set business_unit = null where id = p_item_id;",
      "    null; -- (mutado: conserva la BU aunque ya no tenga fuente)",
    ]],
    targets: ["tests/db/t-n1b-02-bu-projection.test.ts"],
  },
  {
    id: "M-13",
    name: "FEFO invertido: vence-después primero (B-02)",
    file: M0220,
    edits: [[
      "order by fefo_date asc nulls last, ii.id",
      "order by fefo_date desc nulls first, ii.id",
    ]],
    targets: ["tests/db/t-n1b-04-allocate-canonical.test.ts"],
  },
  {
    id: "M-14",
    name: "FEFO reemplazado por orden de id a secas (B-03/N-02)",
    file: M0220,
    // 🔴 B-03: con un fixture degenerado —UUIDs ascendiendo en el mismo orden
    // que los vencimientos— esta mutación quedaba VERDE. El fixture actual es
    // adversarial (el ítem que vence primero lleva el id MÁS ALTO y el ítem
    // sin lote el MÁS BAJO), de modo que ordenar sólo por id asigna primero
    // el stock sin lote y muere.
    edits: [[
      "order by fefo_date asc nulls last, ii.id",
      "order by ii.id",
    ]],
    targets: ["tests/db/t-n1b-04-allocate-canonical.test.ts"],
  },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function run() {
  if (process.env.CI) {
    console.error("✖ Este manifiesto muta el árbol de trabajo: PROHIBIDO en CI.");
    process.exit(1);
  }
  const staged = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: ROOT, encoding: "utf8" });
  if ((staged.stdout ?? "").trim() !== "") {
    console.error("✖ Hay cambios stageados: destrabar el índice antes de mutar.");
    process.exit(1);
  }

  const results = [];
  for (const mutant of MUTANTS) {
    const path = join(ROOT, mutant.file);
    const original = readFileSync(path);
    const shaBefore = sha256(original);
    let text = original.toString("utf8");

    let patternError = null;
    for (const [find] of mutant.edits) {
      const count = text.split(find).length - 1;
      if (count !== 1) {
        patternError = `patrón con ${count} ocurrencias (se exige exactamente 1): ${find.slice(0, 60)}…`;
        break;
      }
    }

    if (patternError) {
      results.push({ ...mutant, verdict: "ERROR", detail: patternError });
      continue;
    }

    for (const [find, replace] of mutant.edits) text = text.replace(find, replace);

    let verdict;
    let detail = "";
    try {
      writeFileSync(path, text, "utf8");
      const runResult = spawnSync(
        "npx",
        ["vitest", "run", "--config", "vitest.db.config.ts", ...mutant.targets],
        { cwd: ROOT, encoding: "utf8", timeout: 900_000 },
      );
      const dead = runResult.status !== 0;
      verdict = dead ? "MUERTO" : "SOBREVIVIO";
      detail = `exit ${runResult.status}`;
    } finally {
      writeFileSync(path, original);
      const shaAfter = sha256(readFileSync(path));
      if (shaAfter !== shaBefore) {
        console.error(`✖ RESTAURACIÓN FALLIDA en ${mutant.file} — intervenir a mano.`);
        process.exit(2);
      }
    }
    results.push({ ...mutant, verdict, detail });
    console.log(`${mutant.id}  ${verdict.padEnd(10)} (${detail})  ${mutant.name}`);
  }

  const survivors = results.filter((r) => r.verdict !== "MUERTO");
  console.log("\n=== P3-N1B · CAMPAÑA DE MUTANTES ===");
  for (const r of results) console.log(`  ${r.id}  ${r.verdict.padEnd(10)} ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  if (survivors.length > 0) {
    console.error(`\n✖ ${survivors.length} mutante(s) NO muertos. El expediente NO está protegido.`);
    process.exit(1);
  }
  console.log(`\nP3_N1B_MUTANTS_ALL_DEAD (${results.length}/14)`);
}

run();

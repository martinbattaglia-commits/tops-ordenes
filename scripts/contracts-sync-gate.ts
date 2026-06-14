/**
 * contracts-sync-gate.ts — GATE OPERATIVO CRM Contratos (validación determinista).
 *
 * Ejecuta la LÓGICA REAL del motor de sincronización (plan.ts + classify.ts) y del
 * tablero (contracts-engine.ts) contra fixtures, cubriendo los 5 escenarios del gate.
 * No requiere Drive ni base: valida las reglas de decisión que el motor consume.
 *
 * Correr: `node scripts/contracts-sync-gate.ts`  (Node ≥ 23, type-stripping nativo).
 */

import { classifyDocTipo, parseCuit, folderToRazon } from "../src/lib/comercial/contracts-sync/classify.ts";
import { diffDoc, docAlertAction, planRemovals, type ExistingDocState } from "../src/lib/comercial/contracts-sync/plan.ts";
import { computeAggregates } from "../src/lib/comercial/contracts-engine.ts";
import { CONTRACTS_SEED, AUDIT_CORTE, AUDIT_AGGREGATES } from "../src/lib/comercial/contracts-seed.ts";

let pass = 0;
let fail = 0;
const failed: string[] = [];
function check(name: string, cond: boolean, got?: unknown): void {
  if (cond) {
    pass += 1;
    console.log("  ✓ " + name);
  } else {
    fail += 1;
    failed.push(name);
    console.log("  ✗ FAIL " + name + (got !== undefined ? "  got=" + JSON.stringify(got) : ""));
  }
}
function section(t: string): void {
  console.log("\n" + t);
}

const baseDoc: ExistingDocState = {
  id: "d1",
  driveFileId: "f1",
  md5: "AAA111",
  modified: "2026-06-01T10:00:00.000Z",
  status: "synced",
  contractId: "c1",
};

// ── ESCENARIO 1 — Contrato/documento nuevo agregado en Drive ──────────────────
section("ESCENARIO 1 · Contrato nuevo en Drive → aparece en Nexus");
{
  const change = diffDoc(undefined, { md5Checksum: "Z", modifiedAt: "2026-06-13T00:00:00Z" });
  check("documento inexistente → change='new' (el motor inserta)", change === "new", change);
  check("clasifica 'Contrato locación DEO.pdf' → contrato", classifyDocTipo("Contrato locación DEO.pdf") === "contrato");
  check("sin alerta espuria en alta de contrato", docAlertAction("new", "contrato") === null);
}

// ── ESCENARIO 2 — Adenda agregada / modificada ────────────────────────────────
section("ESCENARIO 2 · Adenda → contrato actualizado");
{
  check("clasifica 'Adenda I ampliación superficie.pdf' → adenda", classifyDocTipo("Adenda I ampliación superficie.pdf") === "adenda");
  const nuevaAdenda = diffDoc(undefined, { md5Checksum: "X", modifiedAt: "2026-06-13T00:00:00Z" });
  check("adenda nueva → change='new' (se agrega al contrato)", nuevaAdenda === "new", nuevaAdenda);
  const adendaMod = diffDoc(baseDoc, { md5Checksum: "BBB222", modifiedAt: "2026-06-13T00:00:00Z" });
  check("adenda existente con md5 distinto → change='updated'", adendaMod === "updated", adendaMod);
  check("adenda modificada → alerta 'adenda_modificada'", docAlertAction("updated", "adenda") === "adenda_modificada");
  check("renovación modificada → alerta 'adenda_modificada'", docAlertAction("updated", "renovacion") === "adenda_modificada");
}

// ── ESCENARIO 3 — Documento eliminado ────────────────────────────────────────
section("ESCENARIO 3 · Documento eliminado → alerta generada");
{
  const seen = new Set<string>(); // no se vio f1 en esta corrida
  const scanned = new Set<string>(["c1"]); // pero su contrato SÍ se recorrió
  const removals = planRemovals([baseDoc], seen, scanned);
  check("doc sincronizado no visto (contrato recorrido) → baja", removals.length === 1 && removals[0].id === "d1", removals.map((r) => r.id));
  // el motor emite alerta 'documento_eliminado' por cada removal (ver engine.ts)
}

// ── ESCENARIO 3-bis — SEGURIDAD: no marcar baja si el contrato no se recorrió ──
section("ESCENARIO 3-bis · Falso positivo evitado (fix crítico de la revisión)");
{
  const seen = new Set<string>();
  const scannedOtro = new Set<string>(["cX"]); // el contrato de f1 (c1) NO se recorrió
  const removals = planRemovals([baseDoc], seen, scannedOtro);
  check("doc de contrato NO recorrido → NO se da de baja", removals.length === 0, removals.map((r) => r.id));
  const visto = new Set<string>(["f1"]);
  check("doc visto en la corrida → NO se da de baja", planRemovals([baseDoc], visto, new Set(["c1"])).length === 0);
}

// ── ESCENARIO 4 — Rescisión detectada ────────────────────────────────────────
section("ESCENARIO 4 · Rescisión detectada → alerta/estado");
{
  check("clasifica 'Rescisión GEVECO 2026.pdf' → rescision", classifyDocTipo("Rescisión GEVECO 2026.pdf") === "rescision");
  check("clasifica 'Distracto contrato.pdf' → rescision", classifyDocTipo("Distracto contrato.pdf") === "rescision");
  check("rescisión nueva → alerta 'rescision_detectada'", docAlertAction("new", "rescision") === "rescision_detectada");
}

// ── ESCENARIO 5 — Modificación documental ────────────────────────────────────
section("ESCENARIO 5 · Modificación documental → evento registrado");
{
  const change = diffDoc(baseDoc, { md5Checksum: "CCC333", modifiedAt: baseDoc.modified });
  check("md5 cambia → change='updated' (evento 'updated')", change === "updated", change);
  const changeByDate = diffDoc(baseDoc, { md5Checksum: baseDoc.md5, modifiedAt: "2026-06-13T00:00:00Z" });
  check("modifiedTime cambia → change='updated'", changeByDate === "updated", changeByDate);
  check("modificación de contrato (no adenda) → sin alerta, sólo evento", docAlertAction("updated", "contrato") === null);
  const sinCambio = diffDoc(baseDoc, { md5Checksum: baseDoc.md5, modifiedAt: baseDoc.modified });
  check("sin cambios → change='unchanged' (no-op)", sinCambio === "unchanged", sinCambio);
}

// ── Clasificación / parseo adicional ─────────────────────────────────────────
section("Clasificación documental y parseo");
{
  check("'Carta documento intimación.pdf' → carta_documento", classifyDocTipo("Carta documento intimación.pdf") === "carta_documento");
  check("'Condiciones generales.pdf' → condiciones", classifyDocTipo("Condiciones generales.pdf") === "condiciones");
  check("'NOSIS informe.pdf' → nosis", classifyDocTipo("NOSIS informe.pdf") === "nosis");
  check("'foto random.jpg' → otro", classifyDocTipo("foto random.jpg") === "otro");
  check("parseCuit('DEO 30-71911511-6') = 30-71911511-6", parseCuit("DEO 30-71911511-6") === "30-71911511-6", parseCuit("DEO 30-71911511-6"));
  check("folderToRazon('30-71911511-6 DEO S.A.') limpia CUIT", folderToRazon("30-71911511-6 DEO S.A.") === "DEO S.A.", folderToRazon("30-71911511-6 DEO S.A."));
}

// ── DASHBOARD — Agregados del tablero (DB-first; misma fórmula del motor) ─────
section("DASHBOARD · Agregados (computeAggregates vs auditoría K)");
{
  const a = computeAggregates(CONTRACTS_SEED, AUDIT_CORTE);
  check(`contratos activos = ${AUDIT_AGGREGATES.activos}`, a.activos === AUDIT_AGGREGATES.activos, a.activos);
  check(`ANMAT = ${AUDIT_AGGREGATES.anmat}`, a.anmat === AUDIT_AGGREGATES.anmat, a.anmat);
  check(`Cargas Generales = ${AUDIT_AGGREGATES.cg}`, a.cg === AUDIT_AGGREGATES.cg, a.cg);
  check(`m² total = ${AUDIT_AGGREGATES.m2Total}`, a.m2Total === AUDIT_AGGREGATES.m2Total, a.m2Total);
  check(`fact. ARS mensual = ${AUDIT_AGGREGATES.factArs}`, a.factArs === AUDIT_AGGREGATES.factArs, a.factArs);
  check(`fact. USD mensual = ${AUDIT_AGGREGATES.factUsd}`, a.factUsd === AUDIT_AGGREGATES.factUsd, a.factUsd);
  check(`críticos = ${AUDIT_AGGREGATES.criticos}`, a.criticos === AUDIT_AGGREGATES.criticos, a.criticos);
  check(`vencen ≤180d = ${AUDIT_AGGREGATES.prox180}`, a.prox180 === AUDIT_AGGREGATES.prox180, a.prox180);
}

// ── Resultado ────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(56));
console.log(`GATE CONTRATOS · ${pass} PASS · ${fail} FAIL`);
if (fail > 0) {
  console.log("FALLIDOS: " + failed.join(", "));
  console.log("RESULTADO: ✗ REJECTED");
  process.exit(1);
}
console.log("RESULTADO: ✓ TODOS LOS ESCENARIOS PASAN");
process.exit(0);

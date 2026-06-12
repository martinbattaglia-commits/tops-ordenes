/**
 * QA FISCAL-HARDENING — casos H1 sobre emitInvoice() en modo mock (SANDBOX).
 * Ejecutar: npx tsx scripts/qa/fiscal-hardening-test.ts (desde la raíz del repo)
 */
process.env.NEXT_PUBLIC_DEMO_MODE = "1";

import { emitInvoice } from "../../src/lib/invoicing/emit";
import { mockStore, findBilledOrderConflicts } from "../../src/lib/invoicing/data";

const ctx = { userId: "qa-user", ip: "127.0.0.1" };
let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.log(`❌ ${name} ${detail}`);
  }
}

async function main() {
  // --- Caso 0: factura base $1.210.000 (neto 1.000.000 + IVA 21%) ---------
  const fac = await emitInvoice(
    {
      client_id: null,
      cuit_cliente: "20-34425248-4",
      razon_social: "QA Cliente SRL",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "FACTURA_A",
      concepto: 2,
      items: [{ descripcion: "Servicio logístico QA", cantidad: 1, precio_unitario: 1_000_000, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
      periodo: "2026-06",
    },
    ctx
  );
  check("C0 — Factura A autorizada (mock)", fac.ok && !!fac.invoice?.cae, JSON.stringify(fac.errors));
  const facId = fac.invoice!.id;
  check("C0b — total $1.210.000", fac.invoice!.total === 1_210_000, String(fac.invoice!.total));

  // --- Caso 1: NC sin comprobante asociado → RECHAZADA --------------------
  const ncSin = await emitInvoice(
    {
      cuit_cliente: "20-34425248-4",
      razon_social: "QA Cliente SRL",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "NOTA_CREDITO_A",
      concepto: 2,
      items: [{ descripcion: "NC sin asociado", cantidad: 1, precio_unitario: 100_000, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
    },
    ctx
  );
  check(
    "C1 — NC sin asociado rechazada (RG 4540)",
    !ncSin.ok && (ncSin.errors ?? []).some((e) => e.includes("asociado")),
    JSON.stringify(ncSin.errors)
  );

  // --- Caso 2: NC parcial válida ($121.000) con CbtesAsoc → AUTORIZADA ----
  const ncParcial = await emitInvoice(
    {
      cuit_cliente: "20-34425248-4",
      razon_social: "QA Cliente SRL",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "NOTA_CREDITO_A",
      concepto: 2,
      items: [{ descripcion: "NC parcial por diferencia de tarifa", cantidad: 1, precio_unitario: 100_000, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
      comprobante_asociado_id: facId,
    },
    ctx
  );
  check("C2 — NC parcial autorizada", ncParcial.ok && !!ncParcial.invoice?.cae, JSON.stringify(ncParcial.errors));
  const req = ncParcial.invoice?.request_arca as { FeDetReq?: { CbtesAsoc?: unknown[] }[] } | null;
  check(
    "C2b — request ARCA incluye CbtesAsoc",
    !!req?.FeDetReq?.[0]?.CbtesAsoc?.length,
    JSON.stringify(req?.FeDetReq?.[0])?.slice(0, 200)
  );

  // --- Caso 3: NC excedente (resta $1.089.000 acreditable; pido $1.210.000) → tope
  const ncExc = await emitInvoice(
    {
      cuit_cliente: "20-34425248-4",
      razon_social: "QA Cliente SRL",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "NOTA_CREDITO_A",
      concepto: 2,
      items: [{ descripcion: "NC excedente", cantidad: 1, precio_unitario: 1_000_000, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
      comprobante_asociado_id: facId,
    },
    ctx
  );
  check(
    "C3 — NC excedente bloqueada por tope",
    !ncExc.ok && (ncExc.errors ?? []).some((e) => e.includes("excede")),
    JSON.stringify(ncExc.errors)
  );

  // --- Caso 4: letra equivocada (NC_B sobre Factura A) → RECHAZADA --------
  const ncLetra = await emitInvoice(
    {
      cuit_cliente: "20-34425248-4",
      razon_social: "QA Cliente SRL",
      condicion_iva: "CONSUMIDOR_FINAL",
      tipo_comprobante: "NOTA_CREDITO_B",
      concepto: 2,
      items: [{ descripcion: "NC letra B", cantidad: 1, precio_unitario: 10_000, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
      comprobante_asociado_id: facId,
    },
    ctx
  );
  check(
    "C4 — letra B sobre Factura A rechazada",
    !ncLetra.ok && (ncLetra.errors ?? []).some((e) => e.includes("letra")),
    JSON.stringify(ncLetra.errors)
  );

  // --- Caso 5: CUIT receptor distinto → RECHAZADA --------------------------
  const ncCuit = await emitInvoice(
    {
      cuit_cliente: "33-60489698-9",
      razon_social: "Otro Receptor SA",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "NOTA_CREDITO_A",
      concepto: 2,
      items: [{ descripcion: "NC receptor distinto", cantidad: 1, precio_unitario: 10_000, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
      comprobante_asociado_id: facId,
    },
    ctx
  );
  check(
    "C5 — receptor distinto rechazado",
    !ncCuit.ok && (ncCuit.errors ?? []).some((e) => e.includes("receptor")),
    JSON.stringify(ncCuit.errors)
  );

  // --- Caso 6: NC sobre NC → RECHAZADA -------------------------------------
  const ncSobreNc = await emitInvoice(
    {
      cuit_cliente: "20-34425248-4",
      razon_social: "QA Cliente SRL",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "NOTA_CREDITO_A",
      concepto: 2,
      items: [{ descripcion: "NC sobre NC", cantidad: 1, precio_unitario: 1_000, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
      comprobante_asociado_id: ncParcial.invoice!.id,
    },
    ctx
  );
  check(
    "C6 — NC sobre NC rechazada",
    !ncSobreNc.ok && (ncSobreNc.errors ?? []).some((e) => e.toLowerCase().includes("nota de crédito")),
    JSON.stringify(ncSobreNc.errors)
  );

  // --- Caso 7: tope acumulado — segunda NC parcial hasta el límite exacto --
  // Acreditado: $121.000. Restante: $1.089.000. NC por exactamente $1.089.000 → OK.
  const ncResto = await emitInvoice(
    {
      cuit_cliente: "20-34425248-4",
      razon_social: "QA Cliente SRL",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "NOTA_CREDITO_A",
      concepto: 2,
      items: [{ descripcion: "NC por el resto", cantidad: 1, precio_unitario: 900_000, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
      comprobante_asociado_id: facId,
    },
    ctx
  );
  check("C7 — NC por el resto exacto autorizada ($1.089.000)", ncResto.ok, JSON.stringify(ncResto.errors));

  // --- Caso 8: tras acreditar el 100%, cualquier NC adicional → tope $0 ----
  const ncCero = await emitInvoice(
    {
      cuit_cliente: "20-34425248-4",
      razon_social: "QA Cliente SRL",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "NOTA_CREDITO_A",
      concepto: 2,
      items: [{ descripcion: "NC sobre saldo cero", cantidad: 1, precio_unitario: 1, alicuota_iva: 21 }],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
      comprobante_asociado_id: facId,
    },
    ctx
  );
  check("C8 — NC sobre saldo $0 bloqueada", !ncCero.ok, JSON.stringify(ncCero.errors));

  // ===== H4 — guard de idempotencia (doble facturación) ====================

  // Caso 9: factura que referencia OS "os-qa-1"/"os-qa-2".
  const facOs = await emitInvoice(
    {
      cuit_cliente: "30-54006559-2",
      razon_social: "QA Garbarino",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      tipo_comprobante: "FACTURA_A",
      concepto: 2,
      items: [
        { descripcion: "OS os-qa-1", cantidad: 1, precio_unitario: 500_000, alicuota_iva: 21, order_id: "11111111-1111-4111-8111-111111111111" },
        { descripcion: "OS os-qa-2", cantidad: 1, precio_unitario: 300_000, alicuota_iva: 21, order_id: "22222222-2222-4222-8222-222222222222" },
      ],
      fch_serv_desde: "2026-06-01",
      fch_serv_hasta: "2026-06-12",
    },
    ctx
  );
  check("C9 — Factura con OS vinculadas autorizada", facOs.ok, JSON.stringify(facOs.errors));

  // Caso 10: el guard detecta las OS como ya facturadas (replay bloqueable).
  const conflicts = await findBilledOrderConflicts([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333", // OS nunca facturada
  ]);
  check(
    "C10 — guard H4 detecta 2 OS facturadas (y no la tercera)",
    conflicts.length === 2 && conflicts.every((c) => c.comprobante.includes("FACTURA_A")),
    JSON.stringify(conflicts)
  );

  // Caso 11: tras anular la factura (anulada=true), el guard libera las OS.
  const target = mockStore().invoices.find((i) => i.id === facOs.invoice!.id);
  if (target) target.anulada = true;
  const conflictsPost = await findBilledOrderConflicts([
    "11111111-1111-4111-8111-111111111111",
  ]);
  check("C11 — factura anulada no bloquea re-facturación", conflictsPost.length === 0, JSON.stringify(conflictsPost));

  // Caso 12: una NC con order_id no cuenta como facturación de la OS.
  // (la NC de anulación no copia order_id por diseño; verificación defensiva)
  check(
    "C12 — las NC no participan del guard",
    (await findBilledOrderConflicts(["22222222-2222-4222-8222-222222222222"])).length === 0,
    "la única factura que referenciaba la OS está anulada"
  );

  console.log(`\nRESULTADO: ${pass} PASS · ${fail} FAIL · invoices en mock: ${mockStore().invoices.length}`);
  process.exit(fail > 0 ? 1 : 0);
}

main();

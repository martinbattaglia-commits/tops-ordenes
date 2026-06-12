/**
 * QA IVA VENTAS V1 — fundación canónica (vat_lines + G7) en modo mock SANDBOX.
 * Ejecutar: npx tsx scripts/qa/iva-ventas-v1-test.ts (desde la raíz del repo)
 */
process.env.NEXT_PUBLIC_DEMO_MODE = "1";

import { emitInvoice } from "../../src/lib/invoicing/emit";
import { alicuotaToId, alicuotaFromId, AlicIvaId } from "../../src/lib/arca/types";
import { round2 } from "../../src/lib/invoicing/calc";

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

const baseInput = {
  cuit_cliente: "20-34425248-4",
  razon_social: "QA Cliente SRL",
  condicion_iva: "RESPONSABLE_INSCRIPTO" as const,
  tipo_comprobante: "FACTURA_A" as const,
  concepto: 2,
  fch_serv_desde: "2026-06-01",
  fch_serv_hasta: "2026-06-12",
};

async function main() {
  // --- G7: default silencioso eliminado -----------------------------------
  let threw = false;
  try {
    alicuotaToId(19);
  } catch {
    threw = true;
  }
  check("V1 — alicuotaToId(19) lanza error (antes devolvía 21 silenciosamente)", threw);

  let threw105 = false;
  try {
    alicuotaToId(10.5);
  } catch {
    threw105 = true;
  }
  check("V1b — alícuotas válidas siguen mapeando", !threw105 && alicuotaToId(10.5) === 4);

  // V2: emisión con alícuota inválida → error controlado, no excepción.
  const inv19 = await emitInvoice(
    {
      ...baseInput,
      items: [{ descripcion: "Alícuota inválida", cantidad: 1, precio_unitario: 1000, alicuota_iva: 19 }],
    },
    ctx
  );
  check(
    "V2 — emisión con 19% rechazada con error explícito",
    !inv19.ok && (inv19.errors ?? []).some((e) => e.includes("inválida")),
    JSON.stringify(inv19.errors)
  );

  // --- vat_lines canónicas -------------------------------------------------
  // V3: multi-alícuota 21 / 10.5 / 0 → 3 líneas con pares AFIP correctos.
  const multi = await emitInvoice(
    {
      ...baseInput,
      items: [
        { descripcion: "Servicio gravado 21", cantidad: 1, precio_unitario: 100_000, alicuota_iva: 21 },
        { descripcion: "Servicio gravado 10.5", cantidad: 2, precio_unitario: 25_000, alicuota_iva: 10.5 },
        { descripcion: "Concepto a tasa 0", cantidad: 1, precio_unitario: 10_000, alicuota_iva: 0 },
      ],
    },
    ctx
  );
  const lines = multi.invoice?.vat_lines ?? [];
  check("V3 — factura multi-alícuota autorizada con 3 líneas IVA", multi.ok && lines.length === 3, JSON.stringify(multi.errors ?? lines));
  const pairOk = lines.every(
    (l) =>
      [
        [3, 0],
        [4, 10.5],
        [5, 21],
        [6, 27],
        [8, 5],
        [9, 2.5],
      ].some(([id, pct]) => l.alic_iva_id === id && l.alicuota_iva === pct)
  );
  check("V3b — pares AFIP (alic_iva_id ↔ alícuota) válidos en todas las líneas", pairOk, JSON.stringify(lines));

  // V4: identidad matemática Σ líneas = cabecera (mandato #4, tolerancia 0).
  const sNeto = round2(lines.reduce((a, l) => a + l.neto_gravado, 0));
  const sIva = round2(lines.reduce((a, l) => a + l.iva_importe, 0));
  check(
    "V4 — Σ neto líneas = subtotal cabecera (exacto)",
    sNeto === multi.invoice!.subtotal,
    `${sNeto} vs ${multi.invoice!.subtotal}`
  );
  check("V4b — Σ IVA líneas = iva cabecera (exacto)", sIva === multi.invoice!.iva, `${sIva} vs ${multi.invoice!.iva}`);

  // V5: stress de redondeo — 9 renglones con centavos impares al 21%:
  // la identidad Σ líneas = cabecera debe sostenerse SIEMPRE (es por construcción).
  const stress = await emitInvoice(
    {
      ...baseInput,
      items: Array.from({ length: 9 }, (_, i) => ({
        descripcion: `OS impar ${i + 1}`,
        cantidad: 1,
        precio_unitario: 1000.07 + i * 333.33,
        alicuota_iva: 21,
      })),
    },
    ctx
  );
  const sl = stress.invoice?.vat_lines ?? [];
  const stIva = round2(sl.reduce((a, l) => a + l.iva_importe, 0));
  const stNeto = round2(sl.reduce((a, l) => a + l.neto_gravado, 0));
  check(
    "V5 — 9 renglones con centavos: Σ líneas = cabecera (identidad por construcción)",
    stress.ok && sl.length === 1 && stIva === stress.invoice!.iva && stNeto === stress.invoice!.subtotal,
    `iva ${stIva} vs ${stress.invoice?.iva} · neto ${stNeto} vs ${stress.invoice?.subtotal}`
  );

  // V6: equivalencia del BACKFILL — agrupar items por alícuota reproduce
  // exactamente las vat_lines emitidas (misma fórmula que la migración 0072 §6).
  const byAlic = new Map<number, { neto: number; iva: number }>();
  for (const it of stress.invoice!.items ?? []) {
    const cur = byAlic.get(it.alic_iva_id) ?? { neto: 0, iva: 0 };
    cur.neto = round2(cur.neto + it.importe_neto);
    cur.iva = round2(cur.iva + it.importe_iva);
    byAlic.set(it.alic_iva_id, cur);
  }
  const backfillEq = sl.every((l) => {
    const b = byAlic.get(l.alic_iva_id);
    return b && round2(b.neto) === l.neto_gravado && round2(b.iva) === l.iva_importe;
  });
  check("V6 — backfill (GROUP BY items) ≡ vat_lines emitidas", backfillEq);

  // V7: roundtrip de mapeos Id ↔ alícuota.
  const ids = [AlicIvaId.CERO, AlicIvaId.DOS_CINCO, AlicIvaId.CINCO, AlicIvaId.DIEZ_CINCO, AlicIvaId.VEINTIUNO, AlicIvaId.VEINTISIETE];
  check(
    "V7 — roundtrip alicuotaToId(alicuotaFromId(id)) = id para los 6 ids AFIP",
    ids.every((id) => alicuotaToId(alicuotaFromId(id)) === id)
  );

  console.log(`\nRESULTADO: ${pass} PASS · ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main();

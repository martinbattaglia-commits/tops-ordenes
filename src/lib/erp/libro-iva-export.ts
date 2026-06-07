import type { LibroIvaResult } from "./libro-iva-data";

/**
 * Builders de exportación del Libro IVA Compras (ERP-B3).
 *
 * Funciones PURAS: toman el resultado ya calculado por `getLibroIvaCompras`
 * (donde toda la matemática fiscal ya vive en la DB) y serializan. No leen DB ni
 * recalculan impuestos: solo formatean. Testeables en aislamiento.
 *
 * Columnas obligatorias (siempre presentes): Neto Gravado · IVA Pagado · Total
 * Gravado (Neto+IVA), diferenciado del Total Comprobante.
 */

const COLUMNS = [
  "Fecha",
  "Proveedor",
  "CUIT",
  "Comprobante",
  "Centro de costo",
  "Neto Gravado",
  "IVA Pagado",
  "Percepciones",
  "Total Gravado",
  "Total Comprobante",
  "Estado",
] as const;

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  // Escapado CSV RFC-4180: comillas dobladas si hay coma/comilla/salto.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * CSV UTF-8 con BOM (Excel lo abre con acentos correctos).
 */
export function buildLibroIvaCsv(result: LibroIvaResult): string {
  const lines: string[] = [];
  lines.push(COLUMNS.join(","));
  for (const r of result.rows) {
    lines.push(
      [
        r.fecha,
        csvCell(r.proveedor),
        r.cuit,
        csvCell(r.comprobante),
        csvCell(r.costCenter ?? ""),
        r.netoGravado.toFixed(2),
        r.iva.toFixed(2),
        r.percepciones.toFixed(2),
        r.totalGravado.toFixed(2),
        r.totalComprobante.toFixed(2),
        r.approvalStatus,
      ].join(",")
    );
  }
  // Fila de totales
  const k = result.kpis;
  lines.push(
    [
      "TOTALES",
      "",
      "",
      `${k.cantidadComprobantes} comprobantes`,
      "",
      k.netoGravado.toFixed(2),
      k.ivaCreditoFiscal.toFixed(2),
      k.percepciones.toFixed(2),
      k.totalGravado.toFixed(2),
      "",
      "",
    ].join(",")
  );
  const BOM = "﻿";
  return BOM + lines.join("\r\n");
}

/**
 * XLSX real con exceljs: hoja de comprobantes + hoja de subtotales por alícuota.
 * Import dinámico de exceljs (no infla el bundle de la pantalla).
 */
export async function buildLibroIvaXlsx(result: LibroIvaResult): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "TOPS Nexus — Libro IVA Compras";

  // --- Hoja 1: comprobantes ---
  const ws = wb.addWorksheet("Libro IVA Compras");
  ws.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Proveedor", key: "proveedor", width: 30 },
    { header: "CUIT", key: "cuit", width: 15 },
    { header: "Comprobante", key: "comprobante", width: 24 },
    { header: "Centro de costo", key: "costCenter", width: 20 },
    { header: "Neto Gravado", key: "neto", width: 16 },
    { header: "IVA Pagado", key: "iva", width: 14 },
    { header: "Percepciones", key: "percep", width: 14 },
    { header: "Total Gravado", key: "totalGravado", width: 16 },
    { header: "Total Comprobante", key: "totalComp", width: 18 },
    { header: "Estado", key: "estado", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  const moneyFmt = '#,##0.00';
  for (const r of result.rows) {
    ws.addRow({
      fecha: r.fecha,
      proveedor: r.proveedor,
      cuit: r.cuit,
      comprobante: r.comprobante,
      costCenter: r.costCenter ?? "",
      neto: r.netoGravado,
      iva: r.iva,
      percep: r.percepciones,
      totalGravado: r.totalGravado,
      totalComp: r.totalComprobante,
      estado: r.approvalStatus,
    });
  }
  const k = result.kpis;
  const totalRow = ws.addRow({
    fecha: "TOTALES",
    comprobante: `${k.cantidadComprobantes} comprobantes`,
    neto: k.netoGravado,
    iva: k.ivaCreditoFiscal,
    percep: k.percepciones,
    totalGravado: k.totalGravado,
  });
  totalRow.font = { bold: true };
  ["neto", "iva", "percep", "totalGravado", "totalComp"].forEach((key) => {
    ws.getColumn(key).numFmt = moneyFmt;
  });

  // --- Hoja 2: subtotales por alícuota ---
  const ws2 = wb.addWorksheet("Subtotales por alícuota");
  ws2.columns = [
    { header: "Alícuota %", key: "alic", width: 12 },
    { header: "Comprobantes", key: "comp", width: 14 },
    { header: "Neto Gravado", key: "neto", width: 16 },
    { header: "IVA Crédito Fiscal", key: "iva", width: 18 },
    { header: "Total Gravado", key: "total", width: 16 },
  ];
  ws2.getRow(1).font = { bold: true };
  for (const s of result.subtotales) {
    ws2.addRow({ alic: s.alicuota, comp: s.comprobantes, neto: s.netoGravado, iva: s.iva, total: s.totalGravado });
  }
  ["neto", "iva", "total"].forEach((key) => {
    ws2.getColumn(key).numFmt = moneyFmt;
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function libroIvaFileName(filters: { desde?: string | null; hasta?: string | null }, ext: string): string {
  const d = filters.desde ?? "inicio";
  const h = filters.hasta ?? "hoy";
  return `LibroIVACompras-${d}_${h}.${ext}`;
}

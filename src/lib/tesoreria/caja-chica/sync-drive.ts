// Adaptador SheetSource real: baja el XLSX por fileId (downloadFileBuffer) y
// extrae SOLO la solapa del período pedido (on-demand). No se unit-testea (IO);
// se valida en dry-run. (Extraer todas las solapas rompía con celdas raras de
// hojas no-ejercicio como "Visa Nati"/"Deudas".)

import { downloadFileBuffer } from "@/lib/drive/client";
import { extractMatrix } from "./parse";
import type { SheetSource } from "./sync-engine";
import type { CellMatrix } from "./types";
import type { Workbook } from "exceljs";

export function createDriveSheetSource(fileId: string | null): SheetSource {
  let wb: Workbook | null = null;
  return {
    async load() {
      if (!fileId) throw new Error("CAJA_CHICA_DRIVE_FILE_ID ausente");
      const ExcelJS = await import("exceljs");
      const buf = await downloadFileBuffer(fileId);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buf as unknown as ArrayBuffer);
      wb = book;
    },
    getMatrix(periodo: number): CellMatrix | null {
      if (!wb) return null;
      const ws = wb.getWorksheet(String(periodo));
      return ws ? extractMatrix(ws) : null;
    },
  };
}

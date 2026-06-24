// Adaptador SheetSource real: baja el XLSX por fileId (downloadFileBuffer) y
// extrae cada solapa con exceljs. No se unit-testea (IO); se valida en dry-run.

import { downloadFileBuffer } from "@/lib/drive/client";
import { extractMatrix } from "./parse";
import type { SheetSource } from "./sync-engine";
import type { CellMatrix } from "./types";

export function createDriveSheetSource(fileId: string | null): SheetSource {
  let sheets: Map<string, CellMatrix> | null = null;
  return {
    async load() {
      if (!fileId) throw new Error("CAJA_CHICA_DRIVE_FILE_ID ausente");
      const ExcelJS = await import("exceljs");
      const buf = await downloadFileBuffer(fileId);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const map = new Map<string, CellMatrix>();
      wb.eachSheet((ws) => {
        map.set(ws.name.trim(), extractMatrix(ws));
      });
      sheets = map;
    },
    getMatrix(periodo: number): CellMatrix | null {
      if (!sheets) return null;
      return sheets.get(String(periodo)) ?? null;
    },
  };
}

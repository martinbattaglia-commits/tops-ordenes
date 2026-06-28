import type { ReaderPort } from "../kernel/ports";
import { ok, err, domainError } from "../kernel/result";
import type { RawRow, RawTable } from "../kernel/types";

export const xlsxReader: ReaderPort = {
  id: "xlsx",
  accepts: (f) =>
    f.name.toLowerCase().endsWith(".xlsx") ||
    f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  async read(file) {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) return err(domainError("XLSX_EMPTY", "el archivo no tiene hojas"));
      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: false }, (cell) => headers.push(String(cell.value ?? "").trim()));
      const rows: RawRow[] = [];
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const out: RawRow = {};
        headers.forEach((h, j) => { out[h] = String(row.getCell(j + 1).value ?? "").trim(); });
        if (Object.values(out).some((v) => v !== "")) rows.push(out);
      }
      const table: RawTable = { headers, rows, sourceName: (file as File).name ?? "archivo.xlsx" };
      return ok(table);
    } catch (e) {
      return err(domainError("XLSX_PARSE", e instanceof Error ? e.message : String(e)));
    }
  },
};

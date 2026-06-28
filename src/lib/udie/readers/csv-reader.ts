import Papa from "papaparse";
import type { ReaderPort } from "../kernel/ports";
import { ok, err, domainError } from "../kernel/result";
import type { RawRow, RawTable } from "../kernel/types";

export const csvReader: ReaderPort = {
  id: "csv",
  accepts: (f) => f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv",
  async read(file) {
    const text = (await file.text()).replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: "", // auto-detect ; or ,
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
    });
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return err(domainError("CSV_PARSE", parsed.errors[0]?.message ?? "CSV inválido"));
    }
    const headers = parsed.meta.fields ?? [];
    const rows: RawRow[] = parsed.data.map((r) => {
      const out: RawRow = {};
      for (const h of headers) out[h] = (r[h] ?? "").toString();
      return out;
    });
    const table: RawTable = { headers, rows, sourceName: (file as File).name ?? "archivo.csv" };
    return ok(table);
  },
};

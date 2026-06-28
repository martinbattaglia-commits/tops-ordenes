import type { NormalizerPort } from "../kernel/ports";
import type { RawTable, RawRow } from "../kernel/types";

const clean = (s: string): string => s.replace(/^﻿/, "").trim();

export const defaultNormalizer: NormalizerPort = {
  normalize(table: RawTable): RawTable {
    const headers = table.headers.map(clean);
    const rows: RawRow[] = table.rows.map((row) => {
      const out: RawRow = {};
      for (const key of Object.keys(row)) out[clean(key)] = clean(row[key] ?? "");
      return out;
    });
    return { headers, rows, sourceName: table.sourceName };
  },
};

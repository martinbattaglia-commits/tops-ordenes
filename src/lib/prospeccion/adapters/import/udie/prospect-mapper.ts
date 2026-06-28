import type { MapperPort } from "@/lib/udie/kernel/ports";
import type { RawRow, DetectedFormat } from "@/lib/udie/kernel/types";
import type { ProspectImportInput } from "../../../domain/prospect";
import { HEADER_ALIASES } from "../header-aliases";

export function makeProspectMapper(format: DetectedFormat): MapperPort<ProspectImportInput> {
  return {
    format,
    map(rawRow: RawRow, fmt: DetectedFormat): ProspectImportInput {
      const input: ProspectImportInput = {};
      const raw: Record<string, unknown> = {};
      let firstName: string | null = null;
      let lastName: string | null = null;

      for (const header of Object.keys(rawRow)) {
        const value = rawRow[header] ?? "";
        raw[header] = value;
        const key = header.toLowerCase().trim();
        if (key === "first name" || key === "nombre de pila") { firstName = value || null; continue; }
        if (key === "last name" || key === "apellido") { lastName = value || null; continue; }
        const field = HEADER_ALIASES[key];
        if (field && value !== "") (input as Record<string, unknown>)[field] = value;
      }
      if (!input.full_name && (firstName || lastName)) {
        input.full_name = [firstName, lastName].filter(Boolean).join(" ").trim();
      }
      raw._detected_format = fmt;
      input.raw = raw;
      return input;
    },
  };
}

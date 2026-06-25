// Adapter (driving-side helper) · parser CSV → ProspectImportInput[]. Puro y testeable (sin I/O).
// Mapea cabeceras conocidas (con alias ES/EN) a los campos del DTO; conserva la fila cruda en `raw`.
import type { ProspectImportInput } from "../../domain/prospect";

const HEADER_ALIASES: Record<string, keyof ProspectImportInput> = {
  company_name: "company_name", empresa: "company_name", company: "company_name",
  cuit: "cuit",
  website: "website", web: "website", sitio: "website", url: "website",
  full_name: "full_name", nombre: "full_name", name: "full_name", contacto: "full_name",
  cargo: "cargo", title: "cargo", puesto: "cargo", rol: "cargo",
  email: "email", mail: "email", correo: "email",
  phone: "phone", telefono: "phone", tel: "phone", celular: "phone",
  linkedin_url: "linkedin_url", linkedin: "linkedin_url", perfil: "linkedin_url",
};

/** Tokeniza una línea CSV respetando comillas dobles y comas internas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): ProspectImportInput[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const rows: ProspectImportInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const raw: Record<string, unknown> = {};
    const input: ProspectImportInput = {};
    headers.forEach((h, j) => {
      const val = cells[j] ?? "";
      raw[h] = val;
      const field = HEADER_ALIASES[h];
      if (field && val !== "") (input as Record<string, unknown>)[field] = val;
    });
    input.raw = raw;
    rows.push(input);
  }
  return rows;
}

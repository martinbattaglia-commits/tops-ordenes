import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv-parser";

describe("parseCsv", () => {
  it("mapea cabeceras (con alias ES) a campos del DTO y conserva raw", () => {
    const csv = "empresa,cuit,email,nombre,cargo\nACME,20-12345678-6,laura@acme.test,Laura Gómez,Operaciones";
    const rows = parseCsv(csv);
    expect(rows.length).toBe(1);
    expect(rows[0]!.company_name).toBe("ACME");
    expect(rows[0]!.cuit).toBe("20-12345678-6");
    expect(rows[0]!.email).toBe("laura@acme.test");
    expect(rows[0]!.full_name).toBe("Laura Gómez");
    expect(rows[0]!.cargo).toBe("Operaciones");
    expect(rows[0]!.raw).toBeTruthy();
  });

  it("respeta comillas con comas internas", () => {
    const csv = 'empresa,nombre\n"ACME, S.A.",Laura';
    const rows = parseCsv(csv);
    expect(rows[0]!.company_name).toBe("ACME, S.A.");
  });

  it("devuelve vacío si no hay filas de datos", () => {
    expect(parseCsv("empresa,email").length).toBe(0);
    expect(parseCsv("").length).toBe(0);
  });
});

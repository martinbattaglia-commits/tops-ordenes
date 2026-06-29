import { describe, it, expect } from "vitest";
import { parseCsv, parseEstadoSheet } from "./sheet";

const HEADER =
  "Item ID,Sede,Tipo de certificado,Expediente,Organismo,Estado administrativo,Fecha de inicio,Fecha del pronto despacho,Última actuación,Próxima acción,Nivel de riesgo,Observaciones";

describe("parseCsv", () => {
  it("respeta comas embebidas dentro de comillas", () => {
    const rows = parseCsv(`a,"b,c",d\n1,2,3`);
    expect(rows[0]).toEqual(["a", "b,c", "d"]);
    expect(rows[1]).toEqual(["1", "2", "3"]);
  });
  it("comillas dobles escapadas", () => {
    expect(parseCsv(`"He dijo ""hola""",x`)[0]).toEqual(['He dijo "hola"', "x"]);
  });
});

describe("parseEstadoSheet", () => {
  it("CASO MAG-04: mapea y normaliza estado/etapa", () => {
    const csv = [
      HEADER,
      `MAG-04,MAGALDI,CAA Nación R. Peligrosos,EX-2023-116887453,Min. Ambiente,En elaboración,2023-09-01,2025-02-01,Pronto despacho presentado,Esperar disposición,alto,Trámite avanzado`,
    ].join("\n");
    const { rows, errors } = parseEstadoSheet(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].item_id).toBe("MAG-04");
    expect(rows[0].estado_administrativo).toBe("en_tramite");
    expect(rows[0].etapa).toBe("pronto_despacho"); // inferida por fecha_pronto_despacho presente
    expect(rows[0].nivel_riesgo).toBe("alto");
    expect(rows[0].fecha_pronto_despacho).toBe("2025-02-01");
  });
  it("fila sin Item ID → error y NO se incluye (degradación segura)", () => {
    const csv = [HEADER, `,MAGALDI,X,,Org,Vigente,,,,,,`].join("\n");
    const { rows, errors } = parseEstadoSheet(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/Item ID/i);
  });
  it("estado no normalizable → error y fila descartada", () => {
    const csv = [HEADER, `MAG-99,MAGALDI,X,,Org,blabla,,,,,,`].join("\n");
    const { rows, errors } = parseEstadoSheet(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/MAG-99/);
  });
});

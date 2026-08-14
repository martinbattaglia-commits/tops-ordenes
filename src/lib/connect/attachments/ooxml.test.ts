// Nexus Link · FASE B — controles adversariales de identidad OOXML.
//
// Los ZIP de esta suite son REALES: encabezados locales, datos deflate y
// directorio central construidos byte a byte. Es la única forma de atacar un
// validador que contrasta el directorio central contra los encabezados locales
// y descomprime `[Content_Types].xml` para leer lo que declara.
//
// El constructor expone perillas para MENTIR de forma selectiva —tamaños sólo
// en el central, offsets fuera de rango, métodos inexistentes—, que es lo que
// hace un contenedor fabricado a mano.

import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  OOXML_LIMITS, detectOoxmlKind, hasDuplicateEntries, hasMacros, hasTraversal,
  hasUnsupportedMethod, isZipBomb, localHeadersMatch, parseContentTypeOverrides,
  readZipCentralDirectory, validateOoxml,
} from "./ooxml";
import { validateAttachment } from "./validate";

// ─────────────────────── constructor de ZIP reales ───────────────────────

interface EntradaZip {
  name: string;
  data: string | Uint8Array;
  /** 0 = almacenado, 8 = deflate. Se puede forzar uno inexistente. */
  method?: number;
  /** Miente los tamaños SÓLO en el directorio central. */
  centralSizes?: { comp: number; unc: number };
  /** Miente los tamaños en AMBOS encabezados (bomba declarada coherente). */
  declaredSizes?: { comp: number; unc: number };
  /** Miente el offset del encabezado local en el directorio central. */
  centralOffset?: number;
}

const enc = new TextEncoder();
const w16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const w32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

function buildZip(entradas: readonly EntradaZip[]): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  for (const e of entradas) {
    const cruda = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const metodo = e.method ?? 8;
    const cuerpo = metodo === 8 ? new Uint8Array(deflateRawSync(cruda)) : cruda;
    const nombre = enc.encode(e.name);
    const offset = local.length;
    const comp = e.declaredSizes?.comp ?? cuerpo.length;
    const unc = e.declaredSizes?.unc ?? cruda.length;

    local.push(
      ...w32(0x04034b50), ...w16(20), ...w16(0), ...w16(metodo),
      ...w16(0), ...w16(0), ...w32(0),          // hora, fecha, crc (no validado)
      ...w32(comp), ...w32(unc),
      ...w16(nombre.length), ...w16(0),
      ...nombre, ...cuerpo,
    );
    central.push(
      ...w32(0x02014b50), ...w16(20), ...w16(20), ...w16(0), ...w16(metodo),
      ...w16(0), ...w16(0), ...w32(0),
      ...w32(e.centralSizes?.comp ?? comp), ...w32(e.centralSizes?.unc ?? unc),
      ...w16(nombre.length), ...w16(0), ...w16(0),
      ...w16(0), ...w16(0), ...w32(0),
      ...w32(e.centralOffset ?? offset),
      ...nombre,
    );
  }
  const eocd = [
    ...w32(0x06054b50), ...w16(0), ...w16(0),
    ...w16(entradas.length), ...w16(entradas.length),
    ...w32(central.length), ...w32(local.length), ...w16(0),
  ];
  return new Uint8Array([...local, ...central, ...eocd]);
}

const NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/content-types"';
const MAIN = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
} as const;

/** `[Content_Types].xml` con los Override que se le indiquen. */
function contentTypes(...overrides: Array<[string, string]>): string {
  const o = overrides
    .map(([parte, tipo]) => `<Override PartName="${parte}" ContentType="${tipo}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types ${NS}>` +
    `<Default Extension="xml" ContentType="application/xml"/>${o}</Types>`;
}

const DOCX = buildZip([
  { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]) },
  { name: "_rels/.rels", data: "<Relationships/>" },
  { name: "word/document.xml", data: "<w:document><w:body/></w:document>" },
]);
const XLSX = buildZip([
  { name: "[Content_Types].xml", data: contentTypes(["/xl/workbook.xml", MAIN.xlsx]) },
  { name: "xl/workbook.xml", data: "<workbook/>" },
]);
const PPTX = buildZip([
  { name: "[Content_Types].xml", data: contentTypes(["/ppt/presentation.xml", MAIN.pptx]) },
  { name: "ppt/presentation.xml", data: "<presentation/>" },
]);

// ─────────────────────────── parser estructural ───────────────────────────

describe("readZipCentralDirectory", () => {
  it("lee las entradas de un ZIP bien formado", () => {
    expect(readZipCentralDirectory(DOCX)?.map((e) => e.name)).toEqual([
      "[Content_Types].xml", "_rels/.rels", "word/document.xml",
    ]);
  });

  it("conserva método y offset local para poder contrastarlos", () => {
    const e = readZipCentralDirectory(DOCX)!;
    expect(e.every((x) => x.method === 8)).toBe(true);
    expect(e[0].localHeaderOffset).toBe(0);
    expect(e[1].localHeaderOffset).toBeGreaterThan(0);
  });

  it("rechaza lo que no tiene EOCD", () => {
    expect(readZipCentralDirectory(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBeNull();
  });

  it("rechaza un directorio central truncado", () => {
    expect(readZipCentralDirectory(DOCX.slice(0, DOCX.length - 30))).toBeNull();
  });

  it("rechaza un offset local fuera de los límites físicos", () => {
    const roto = buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]), centralOffset: 900_000 },
      { name: "word/document.xml", data: "<w:document/>" },
    ]);
    expect(readZipCentralDirectory(roto)).toBeNull();
  });
});

describe("controles de integridad del paquete", () => {
  it("detecta traversal en todas sus formas", () => {
    const t = (name: string) => hasTraversal([
      { name, compressedSize: 1, uncompressedSize: 1, method: 8, localHeaderOffset: 0, hasDataDescriptor: false },
    ]);
    expect(t("../../etc/passwd")).toBe(true);
    expect(t("word/../../x")).toBe(true);
    expect(t("/absoluto")).toBe(true);
    expect(t("C:\\Windows\\x")).toBe(true);
    expect(t("word/document.xml")).toBe(false);
  });

  it("detecta bomba por ratio y por volumen", () => {
    const e = (comp: number, unc: number) => [{
      name: "a", compressedSize: comp, uncompressedSize: unc,
      method: 8, localHeaderOffset: 0, hasDataDescriptor: false,
    }];
    expect(isZipBomb(e(1, 1_000_000))).toBe(true);
    expect(isZipBomb(e(1_000, OOXML_LIMITS.maxUncompressedBytes + 1))).toBe(true);
    expect(isZipBomb(e(1_000, 5_000))).toBe(false);
  });

  it("detecta entradas duplicadas y métodos no admitidos", () => {
    expect(hasDuplicateEntries(readZipCentralDirectory(DOCX)!)).toBe(false);
    const dup = buildZip([
      { name: "word/document.xml", data: "<a/>" },
      { name: "word/document.xml", data: "<b/>" },
    ]);
    expect(hasDuplicateEntries(readZipCentralDirectory(dup)!)).toBe(true);
    const raro = buildZip([{ name: "x.xml", data: "hola", method: 12 }]);
    expect(hasUnsupportedMethod(readZipCentralDirectory(raro)!)).toBe(true);
    expect(hasUnsupportedMethod(readZipCentralDirectory(DOCX)!)).toBe(false);
  });

  it("contrasta el directorio central contra los encabezados locales", () => {
    expect(localHeadersMatch(DOCX, readZipCentralDirectory(DOCX)!)).toBe(true);
    const mentiroso = buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]) },
      { name: "word/document.xml", data: "<w:document/>", centralSizes: { comp: 7, unc: 9 } },
    ]);
    expect(localHeadersMatch(mentiroso, readZipCentralDirectory(mentiroso)!)).toBe(false);
  });

  it("detecta macros por vbaProject.bin", () => {
    const e = (name: string) => hasMacros([
      { name, compressedSize: 1, uncompressedSize: 1, method: 8, localHeaderOffset: 0, hasDataDescriptor: false },
    ]);
    expect(e("word/vbaProject.bin")).toBe(true);
    expect(e("word/document.xml")).toBe(false);
  });
});

describe("parseContentTypeOverrides", () => {
  it("normaliza la barra inicial y respeta el tipo declarado", () => {
    const m = parseContentTypeOverrides(contentTypes(["/xl/workbook.xml", MAIN.xlsx]));
    expect(m.get("xl/workbook.xml")).toBe(MAIN.xlsx);
  });

  it("un índice sin Override queda vacío", () => {
    expect(parseContentTypeOverrides(contentTypes()).size).toBe(0);
  });
});

// ─────────────────────────── identidad completa ───────────────────────────

describe("validateOoxml · las tres familias legítimas", () => {
  it("acepta DOCX, XLSX y PPTX con su MIME canónico", () => {
    for (const [bytes, ext, frag] of [
      [DOCX, "contrato.docx", "wordprocessingml"],
      [XLSX, "planilla.xlsx", "spreadsheetml"],
      [PPTX, "charla.pptx", "presentationml"],
    ] as const) {
      const r = validateOoxml(bytes, ext);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.mime).toContain(frag);
    }
  });

  it("la carpeta sola NO alcanza: detectOoxmlKind es sólo el primer filtro", () => {
    const soloCarpeta = buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/notas.xml", "application/xml"]) },
      { name: "word/notas.xml", data: "<x/>" },
    ]);
    // El filtro barato dice "docx"…
    expect(detectOoxmlKind(readZipCentralDirectory(soloCarpeta)!)).toBe("docx");
    // …pero la validación completa lo rechaza por falta de parte principal.
    const r = validateOoxml(soloCarpeta, "x.docx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/parte principal/);
  });
});

describe("validateOoxml · rechazos exigidos", () => {
  const rechaza = (bytes: Uint8Array, nombre: string, patron: RegExp) => {
    const r = validateOoxml(bytes, nombre);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(patron);
  };

  it("ZIP arbitrario renombrado a .docx", () => {
    rechaza(buildZip([{ name: "payload.exe", data: "MZ..." }]), "contrato.docx", /ZIP genérico/i);
  });

  it("[Content_Types].xml vacío", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: "" },
      { name: "word/document.xml", data: "<w:document/>" },
    ]), "x.docx", /no declara sus tipos/);
  });

  it("[Content_Types].xml presente pero sin ningún Override", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes() },
      { name: "word/document.xml", data: "<w:document/>" },
    ]), "x.docx", /no declara sus tipos/);
  });

  it("main part ausente aunque el índice la declare", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]) },
      { name: "word/styles.xml", data: "<styles/>" },
    ]), "x.docx", /parte principal/);
  });

  it("main part presente pero declarada con otro ContentType", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", "text/plain"]) },
      { name: "word/document.xml", data: "<w:document/>" },
    ]), "x.docx", /ZIP genérico|documentos de Office/i);
  });

  it("familia declarada distinta de la extensión", () => {
    rechaza(XLSX, "documento.docx", /no corresponde/);
  });

  it("dos familias a la vez: paquete ambiguo", () => {
    rechaza(buildZip([
      {
        name: "[Content_Types].xml",
        data: contentTypes(["/word/document.xml", MAIN.docx], ["/xl/workbook.xml", MAIN.xlsx]),
      },
      { name: "word/document.xml", data: "<w:document/>" },
      { name: "xl/workbook.xml", data: "<workbook/>" },
    ]), "x.docx", /más de un formato/);
  });

  it("entradas duplicadas", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]) },
      { name: "word/document.xml", data: "<a/>" },
      { name: "word/document.xml", data: "<b/>" },
    ]), "x.docx", /duplicadas o ambiguas/);
  });

  it("traversal dentro del paquete", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]) },
      { name: "word/document.xml", data: "<w:document/>" },
      { name: "../../evil", data: "x" },
    ]), "x.docx", /rutas inválidas/);
  });

  it("bomba de descompresión declarada de forma coherente", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/xl/workbook.xml", MAIN.xlsx]) },
      { name: "xl/workbook.xml", data: "<workbook/>", declaredSizes: { comp: 10, unc: 900_000_000 } },
    ]), "planilla.xlsx", /desproporcionada/);
  });

  it("método de compresión no admitido", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]), method: 0 },
      { name: "word/document.xml", data: "<w:document/>", method: 14 },
    ]), "x.docx", /método de compresión/);
  });

  it("directorio central incompatible con los encabezados locales", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]) },
      { name: "word/document.xml", data: "<w:document/>", centralSizes: { comp: 11, unc: 13 } },
    ]), "x.docx", /directorio central incompatible/);
  });

  it("macros por parte binaria", () => {
    rechaza(buildZip([
      { name: "[Content_Types].xml", data: contentTypes(["/word/document.xml", MAIN.docx]) },
      { name: "word/document.xml", data: "<w:document/>" },
      { name: "word/vbaProject.bin", data: "\x00\x01binario" },
    ]), "plantilla.docx", /macros/);
  });

  it("macros por ContentType macroEnabled, aunque no esté el binario", () => {
    rechaza(buildZip([
      {
        name: "[Content_Types].xml",
        data: contentTypes(["/word/document.xml", "application/vnd.ms-word.document.macroEnabled.main+xml"]),
      },
      { name: "word/document.xml", data: "<w:document/>" },
    ]), "plantilla.docm", /macros/);
  });
});

// ───────────────────────── integración con el sniffer ─────────────────────

describe("integración con validateAttachment", () => {
  it("un ZIP pelado ya NO pasa como documento", () => {
    const pelado = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(30).fill(0)]);
    expect(validateAttachment(pelado, "cosas.zip").ok).toBe(false);
  });

  it("un DOCX legítimo pasa y sale con su MIME específico", () => {
    const r = validateAttachment(DOCX, "contrato.docx");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sniffed.mime).toContain("wordprocessingml");
      expect(r.fileName).toBe("contrato.docx");
    }
  });

  it("un ejecutable comprimido y renombrado a .xlsx se rechaza", () => {
    const r = validateAttachment(buildZip([{ name: "virus.exe", data: "MZ\x90\x00" }]), "planilla.xlsx");
    expect(r.ok).toBe(false);
  });
});

// Nexus Link · FASE B — identidad estructural de OOXML.
//
// ─── POR QUÉ NO ALCANZA CON LA FIRMA ───────────────────────────────────────
//
// Aceptar un DOCX porque empieza con `PK\x03\x04` es aceptar CUALQUIER ZIP.
// Aceptarlo porque además trae `[Content_Types].xml` y una carpeta `word/`
// tampoco alcanza: las dos cosas se fabrican en diez segundos con `zip`, y un
// ejecutable metido en un contenedor con esos dos nombres pasaría igual.
//
// Acá la identidad se exige COMPLETA, en tres niveles que un ZIP arbitrario no
// puede satisfacer por accidente:
//
//   1. ESTRUCTURA — el directorio central se parsea de verdad y además tiene
//      que ser CONSISTENTE con los encabezados locales de cada entrada: mismo
//      nombre, mismo método, mismos tamaños, offsets dentro de los límites
//      físicos del archivo. Un directorio central fabricado a mano que apunte
//      a cualquier lado se cae acá.
//   2. MAIN PART — la familia no se deduce de la carpeta sino de la parte
//      principal: `word/document.xml`, `xl/workbook.xml`, `ppt/presentation.xml`.
//   3. DECLARACIÓN — `[Content_Types].xml` se descomprime y se lee, y tiene que
//      declarar para esa parte principal el ContentType canónico de la familia.
//      La carpeta, la parte y la declaración tienen que decir los tres lo mismo.
//
// Sólo se descomprime `[Content_Types].xml`, con tope de salida. El resto del
// paquete no se infla nunca: no hace falta para decidir, y no inflarlo es la
// mejor defensa contra una bomba.

import { inflateRawSync } from "node:zlib";

export type OoxmlKind = "docx" | "xlsx" | "pptx";

export interface OoxmlEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  /** Método de compresión del ZIP: 0 = almacenado, 8 = deflate. */
  method: number;
  /** Offset del encabezado local, para poder contrastarlo con el central. */
  localHeaderOffset: number;
  /** Bit 3 de los flags: tamaños diferidos al data descriptor. */
  hasDataDescriptor: boolean;
}

export const OOXML_LIMITS = {
  /** Ratio máximo declarado (descomprimido / comprimido) del paquete. */
  maxRatio: 120,
  /** Tamaño máximo total descomprimido que declaramos aceptable. */
  maxUncompressedBytes: 300 * 1024 * 1024,
  /** Tope de entradas: un OOXML normal tiene decenas, no decenas de miles. */
  maxEntries: 5000,
  /** Tope de `[Content_Types].xml` YA inflado: es un índice, no un contenido. */
  maxContentTypesBytes: 1024 * 1024,
} as const;

/** Únicos métodos admitidos. Todo lo demás se rechaza sin intentar leerlo. */
const METODOS_ADMITIDOS = new Set([0, 8]);
const STORED = 0;
const DEFLATE = 8;

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

/**
 * Lee el directorio central. `null` si el ZIP no es estructuralmente válido.
 *
 * No soporta ZIP64 a propósito: un OOXML ofimático legítimo dentro del tope de
 * 25 MB no lo necesita, y aceptar un formato más flexible sólo agranda la
 * superficie de ataque sin ganar nada.
 */
export function readZipCentralDirectory(bytes: Uint8Array): OoxmlEntry[] | null {
  if (bytes.length < 22) return null;
  // El EOCD está al final; puede haber comentario, así que se busca hacia atrás.
  let eocd = -1;
  const desde = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= desde; i--) {
    if (u32(bytes, i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const total = u16(bytes, eocd + 10);
  const cenSize = u32(bytes, eocd + 12);
  const cenOffset = u32(bytes, eocd + 16);
  if (total === 0 || total > OOXML_LIMITS.maxEntries) return null;
  if (cenOffset + cenSize > bytes.length) return null;

  const entries: OoxmlEntry[] = [];
  let p = cenOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== CEN_SIG) return null;
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const uncompressedSize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localHeaderOffset = u32(bytes, p + 42);
    if (p + 46 + nameLen > bytes.length) return null;
    // El offset local tiene que caer dentro del archivo y dejar lugar al
    // encabezado completo: un directorio central que apunte fuera es basura.
    if (localHeaderOffset + 30 > bytes.length) return null;
    const name = new TextDecoder("utf-8").decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      method,
      localHeaderOffset,
      hasDataDescriptor: (flags & 0x08) !== 0,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Dos entradas con el mismo nombre: el paquete es ambiguo, no se interpreta. */
export function hasDuplicateEntries(entries: readonly OoxmlEntry[]): boolean {
  const vistos = new Set<string>();
  for (const e of entries) {
    const n = normalizarNombre(e.name);
    if (vistos.has(n)) return true;
    vistos.add(n);
  }
  return false;
}

/** Alguna entrada usa un método que no vamos a interpretar. */
export function hasUnsupportedMethod(entries: readonly OoxmlEntry[]): boolean {
  return entries.some((e) => !METODOS_ADMITIDOS.has(e.method));
}

const normalizarNombre = (n: string) => n.replace(/\\/g, "/");

/** Una entrada que se escapa del paquete (traversal o ruta absoluta). */
export function hasTraversal(entries: readonly OoxmlEntry[]): boolean {
  return entries.some((e) => {
    const n = normalizarNombre(e.name);
    return (
      n.startsWith("/") ||
      /^[A-Za-z]:/.test(n) ||
      n === ".." ||
      n.startsWith("../") ||
      n.includes("/../")
    );
  });
}

/** Bomba de descompresión: ratio o volumen declarados fuera de escala. */
export function isZipBomb(entries: readonly OoxmlEntry[]): boolean {
  const comprimido = entries.reduce((a, e) => a + e.compressedSize, 0);
  const descomprimido = entries.reduce((a, e) => a + e.uncompressedSize, 0);
  if (descomprimido > OOXML_LIMITS.maxUncompressedBytes) return true;
  if (comprimido === 0) return descomprimido > 0;
  return descomprimido / comprimido > OOXML_LIMITS.maxRatio;
}

/**
 * ¿El directorio central concuerda con los encabezados locales?
 *
 * Es el control que distingue un ZIP real de uno fabricado: quien arma un
 * contenedor a mano suele escribir sólo el directorio central —es lo que leen
 * los parsers perezosos— y deja los encabezados locales inventados o ausentes.
 */
export function localHeadersMatch(bytes: Uint8Array, entries: readonly OoxmlEntry[]): boolean {
  for (const e of entries) {
    const o = e.localHeaderOffset;
    if (o + 30 > bytes.length) return false;
    if (u32(bytes, o) !== LOC_SIG) return false;
    const metodoLocal = u16(bytes, o + 8);
    const compLocal = u32(bytes, o + 18);
    const uncLocal = u32(bytes, o + 22);
    const nameLen = u16(bytes, o + 26);
    const extraLen = u16(bytes, o + 28);
    if (metodoLocal !== e.method) return false;
    if (o + 30 + nameLen > bytes.length) return false;
    const nombreLocal = new TextDecoder("utf-8").decode(bytes.subarray(o + 30, o + 30 + nameLen));
    if (normalizarNombre(nombreLocal) !== normalizarNombre(e.name)) return false;
    // Con data descriptor los tamaños locales son 0 por especificación; sin él,
    // tienen que coincidir exactamente con el directorio central.
    if (!e.hasDataDescriptor) {
      if (compLocal !== e.compressedSize || uncLocal !== e.uncompressedSize) return false;
    }
    const datos = o + 30 + nameLen + extraLen;
    if (datos + e.compressedSize > bytes.length) return false;
  }
  return true;
}

/** Bytes de una entrada, con tope de salida. `null` si no se puede leer. */
function leerEntrada(bytes: Uint8Array, e: OoxmlEntry, maxSalida: number): Uint8Array | null {
  const o = e.localHeaderOffset;
  if (o + 30 > bytes.length) return null;
  const nameLen = u16(bytes, o + 26);
  const extraLen = u16(bytes, o + 28);
  const datos = o + 30 + nameLen + extraLen;
  if (datos + e.compressedSize > bytes.length) return null;
  const crudo = bytes.subarray(datos, datos + e.compressedSize);
  if (e.method === STORED) {
    return crudo.length > maxSalida ? null : crudo;
  }
  if (e.method !== DEFLATE) return null;
  try {
    // `maxOutputLength` hace que una bomba aborte acá adentro en vez de
    // reservar memoria sin límite: el tope lo aplica zlib, no un chequeo mío.
    return new Uint8Array(inflateRawSync(crudo, { maxOutputLength: maxSalida }));
  } catch {
    return null;
  }
}

const MAIN_PART: Record<OoxmlKind, string> = {
  docx: "word/document.xml",
  xlsx: "xl/workbook.xml",
  pptx: "ppt/presentation.xml",
};

const MAIN_TYPE: Record<OoxmlKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
};

const MIME_POR_TIPO: Record<OoxmlKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** ContentTypes de las variantes con macros: se reconocen para rechazarlas. */
const MACRO_TYPES = new Set([
  "application/vnd.ms-word.document.macroEnabled.main+xml",
  "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml",
]);

/** Overrides declarados en `[Content_Types].xml`, normalizados y en minúscula. */
export function parseContentTypeOverrides(xml: string): Map<string, string> {
  const overrides = new Map<string, string>();
  const re = /<Override\b[^>]*?>/gi;
  for (const m of xml.matchAll(re)) {
    const tag = m[0];
    const parte = /PartName\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    const tipo = /ContentType\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (!parte || !tipo) continue;
    overrides.set(parte.replace(/^\/+/, "").toLowerCase(), tipo.trim());
  }
  return overrides;
}

/** Documento con macros: se detecta por su parte binaria característica. */
export function hasMacros(entries: readonly OoxmlEntry[]): boolean {
  return entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(normalizarNombre(e.name)));
}

/**
 * Familia OOXML según las carpetas presentes.
 *
 * Se conserva como control BARATO y de primera línea, pero por sí solo no
 * decide nada: `validateOoxml` exige además la parte principal y la declaración
 * congruente en `[Content_Types].xml`.
 */
export function detectOoxmlKind(entries: readonly OoxmlEntry[]): OoxmlKind | null {
  const nombres = entries.map((e) => normalizarNombre(e.name));
  if (!nombres.some((n) => n === "[Content_Types].xml")) return null;
  if (nombres.some((n) => n.startsWith("word/"))) return "docx";
  if (nombres.some((n) => n.startsWith("xl/"))) return "xlsx";
  if (nombres.some((n) => n.startsWith("ppt/"))) return "pptx";
  return null;
}

export type OoxmlValidation =
  | { ok: true; kind: OoxmlKind; mime: string; ext: OoxmlKind }
  | { ok: false; message: string };

/**
 * Validación completa del paquete.
 *
 * POLÍTICA DE MACROS: se RECHAZAN, por dos caminos independientes —la parte
 * `vbaProject.bin` y el ContentType `macroEnabled`—. Un VBA es código
 * ejecutable dentro de un adjunto y este chat no tiene ninguna necesidad
 * operativa de transportarlo. Es la misma decisión que excluir SVG y HTML.
 */
export function validateOoxml(
  bytes: Uint8Array,
  declaredName?: string | null,
): OoxmlValidation {
  const entries = readZipCentralDirectory(bytes);
  if (!entries) return { ok: false, message: "El archivo no es un ZIP válido." };
  if (hasDuplicateEntries(entries)) {
    return { ok: false, message: "El documento tiene entradas duplicadas o ambiguas." };
  }
  if (hasTraversal(entries)) {
    return { ok: false, message: "El documento contiene rutas inválidas." };
  }
  if (isZipBomb(entries)) {
    return { ok: false, message: "El documento declara una descompresión desproporcionada." };
  }
  if (hasUnsupportedMethod(entries)) {
    return { ok: false, message: "El documento usa un método de compresión no admitido." };
  }
  if (!localHeadersMatch(bytes, entries)) {
    return { ok: false, message: "El documento tiene un directorio central incompatible con su contenido." };
  }

  const ct = entries.find((e) => normalizarNombre(e.name) === "[Content_Types].xml");
  if (!ct) {
    return {
      ok: false,
      message: "Sólo se aceptan documentos de Office (DOCX, XLSX o PPTX); un ZIP genérico no.",
    };
  }
  const crudo = leerEntrada(bytes, ct, OOXML_LIMITS.maxContentTypesBytes);
  if (!crudo || crudo.length === 0) {
    return { ok: false, message: "El documento no declara sus tipos de contenido." };
  }
  const overrides = parseContentTypeOverrides(new TextDecoder("utf-8").decode(crudo));
  if (overrides.size === 0) {
    return { ok: false, message: "El documento no declara sus tipos de contenido." };
  }

  // La familia se resuelve por TRIPLE coincidencia: la parte principal existe
  // como entrada real, y el índice la declara con el ContentType canónico de
  // esa misma familia. Si dan más de una, el paquete es ambiguo.
  const presentes = new Set(entries.map((e) => normalizarNombre(e.name)));
  const familias = (Object.keys(MAIN_PART) as OoxmlKind[]).filter((k) => {
    if (!presentes.has(MAIN_PART[k])) return false;
    return overrides.get(MAIN_PART[k]) === MAIN_TYPE[k];
  });
  if (familias.length > 1) {
    return { ok: false, message: "El documento declara más de un formato a la vez." };
  }
  if (familias.length === 0) {
    // Se distingue el caso "es Office pero le falta la parte principal" del
    // caso "no es Office", porque el primero suele ser un archivo corrupto y el
    // segundo un intento de colar otra cosa.
    const conCarpeta = detectOoxmlKind(entries);
    if (conCarpeta && !presentes.has(MAIN_PART[conCarpeta])) {
      return { ok: false, message: "El documento está incompleto: falta su parte principal." };
    }
    const tipoDeclarado = conCarpeta ? overrides.get(MAIN_PART[conCarpeta]) : undefined;
    if (tipoDeclarado && MACRO_TYPES.has(tipoDeclarado)) {
      return { ok: false, message: "Los documentos con macros no están permitidos." };
    }
    return {
      ok: false,
      message: "Sólo se aceptan documentos de Office (DOCX, XLSX o PPTX); un ZIP genérico no.",
    };
  }
  const kind = familias[0];

  if (hasMacros(entries)) {
    return { ok: false, message: "Los documentos con macros no están permitidos." };
  }
  // Cualquier parte declarada como macroEnabled descalifica el paquete, aunque
  // el `vbaProject.bin` no esté (todavía) presente.
  for (const tipo of overrides.values()) {
    if (MACRO_TYPES.has(tipo)) {
      return { ok: false, message: "Los documentos con macros no están permitidos." };
    }
  }

  // La extensión declarada, si la hay, tiene que corresponder al contenido real.
  const ext = (declaredName ?? "").toLowerCase().split(".").pop() ?? "";
  if (["docx", "xlsx", "pptx", "docm", "xlsm", "pptm"].includes(ext)) {
    const esperada = ext.replace(/m$/, "x");
    if (esperada !== kind) {
      return { ok: false, message: `El contenido no corresponde a un .${ext}.` };
    }
  }
  return { ok: true, kind, mime: MIME_POR_TIPO[kind], ext: kind };
}

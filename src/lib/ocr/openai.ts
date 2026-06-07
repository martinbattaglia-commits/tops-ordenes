import type {
  ExtractedDocument,
  DocumentType,
  ExtractedComprobante,
  ExtractedFiscal,
  ExtractedVatLine,
  ExtractedOtherTax,
  ExtractedOtherTaxKind,
} from "./types";

// `pdf-parse` (vía pdfjs-dist) NO se importa arriba a propósito: su carga
// eager rompe el bundling RSC de Next ("Object.defineProperty called on
// non-object") y tiraba TODA la ruta, incluso el camino de imágenes que no
// necesita PDF. Se carga de forma perezosa solo dentro de extractFromPdf.

/**
 * OCR + extracción estructurada de documentos corporativos con OpenAI.
 *
 * Estrategia híbrida (rápida y económica):
 *  1. PDF con texto extraíble  → pdf-parse → GPT-4o-mini con texto puro
 *     (lo más común: contratos, facturas digitales, OC PDF → costo ~$0.001)
 *  2. PDF escaneado sin texto  → convertir a imagen → GPT-4o-mini Vision
 *     (costo ~$0.01)
 *  3. Imagen pura (JPG/PNG)    → GPT-4o-mini Vision directo
 *
 * Modelos:
 *  - gpt-4o-mini (default): ~$0.15/M input + $0.60/M output tokens
 *  - gpt-4o (override):     ~$2.50/M input + $10/M output tokens — solo
 *    para contratos largos con sellos manuscritos o tablas complejas
 */

const OPENAI_BASE = "https://api.openai.com/v1";

class OcrError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "OcrError";
  }
}

function getApiKey(): string {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k) throw new OcrError("OPENAI_API_KEY no configurada", 503);
  return k;
}

function getModel(override?: string): string {
  return override || process.env.OPENAI_OCR_MODEL || "gpt-4o-mini";
}

/**
 * Prompt de extracción. Pide JSON estructurado siguiendo el shape
 * de `ExtractedDocument` (sin meta/rawText, esos los llenamos local).
 */
const EXTRACTION_PROMPT = `Eres un asistente que extrae datos estructurados de documentos corporativos
argentinos (facturas, remitos, contratos, habilitaciones ANMAT, certificados,
OC, presupuestos). Para Logística TOPS / Verotin S.A.

Devolvé EXCLUSIVAMENTE un JSON válido (sin markdown, sin texto adicional)
con esta estructura:

{
  "type": "factura|remito|contrato|habilitacion|certificado|auditoria|presupuesto|orden_compra|orden_servicio|constancia_afip|otro",
  "typeConfidence": 0.0-1.0,
  "title": "Identificador o título principal del doc (ej 'FA A 0003-00080012')",
  "date": "YYYY-MM-DD o null",
  "expiresAt": "YYYY-MM-DD o null (solo si es contrato/habilitación/certificado con vencimiento)",
  "summary": "1-2 oraciones en español rioplatense neutro describiendo el doc",
  "parties": [
    { "name": "string", "taxId": "XX-XXXXXXXX-X o null", "address": "string o null", "role": "emisor|receptor|cliente|proveedor|destinatario" }
  ],
  "amounts": [
    { "value": 1234.56, "currency": "ARS|USD|EUR", "original": "string del texto", "kind": "subtotal|iva|total|neto|otro" }
  ],
  "lineItems": [
    { "description": "string", "quantity": number|null, "unit": "string|null", "unitPrice": number|null, "subtotal": number|null, "sku": "string|null" }
  ],
  "comprobante": {
    "letra": "A|B|C|M|null",
    "clase": "factura|nota_credito|nota_debito|recibo|otro|null",
    "puntoVenta": "string de 4-5 dígitos tal cual (ej '0003') o null",
    "numero": "string de 8 dígitos tal cual (ej '00001234') o null",
    "cae": "14 dígitos sin espacios o null"
  },
  "fiscal": {
    "vatLines": [
      { "alicuota": 21, "baseNeto": 1000.00, "importeIva": 210.00 }
    ],
    "otherTaxes": [
      { "kind": "PERCEPCION_IVA|PERCEPCION_IIBB|PERCEPCION_GANANCIAS|IMPUESTO_INTERNO|OTRO", "jurisdiction": "provincia o null", "base": 1000.00, "alicuota": 3.0, "importe": 30.00 }
    ],
    "netoNoGravado": 0.00,
    "netoExento": 0.00,
    "totalDeclarado": 1240.00
  },
  "tags": ["palabra1", "palabra2", ...]
}

Reglas:
- Si un campo no aparece en el doc, usá null o array vacío
- Las fechas en formato ISO YYYY-MM-DD (interpretá dd/mm/yyyy del español)
- Los montos como números (sin formato): 1234567.89, no "1.234.567,89"
- typeConfidence < 0.6 si no estás seguro
- comprobante: SOLO para facturas/notas de crédito/débito/recibos. Si el doc no es
  un comprobante fiscal, usá comprobante: null.
  · "letra" es la letra grande del recuadro central (A/B/C/M). El código fiscal
    también la indica: COD 01→A, COD 06→B, COD 11→C.
  · "puntoVenta" y "numero": leelos del encabezado ("Punto de Venta: 0003",
    "Comp. Nro: 00001234"). Mantené los ceros a la izquierda.
  · "cae": número de 14 dígitos cerca de "CAE N°". Es CRÍTICO no perderlo.
- tags: 3-6 palabras clave útiles para búsqueda (ANMAT, cosmética, urgente, vencimiento, etc.)
- fiscal: SOLO para facturas/notas de crédito/débito argentinas. Si el doc no es un
  comprobante con desglose impositivo, usá fiscal: null. Es la parte MÁS importante
  para contabilidad — extraela con máximo cuidado del cuadro de impuestos al pie:
  · vatLines: UNA entrada por cada alícuota de IVA distinta del cuadro. La alícuota
    debe ser EXACTAMENTE una de: 0, 2.5, 5, 10.5, 21, 27 (porcentajes AFIP). Si una
    factura tiene neto a 21% y neto a 10.5%, devolvé DOS entradas. baseNeto es la base
    imponible y importeIva el IVA de esa fila (importeIva ≈ baseNeto·alicuota/100).
    NO sumes alícuotas distintas en una sola fila. En Factura B/C el IVA no se
    discrimina: dejá vatLines vacío y poné el importe en netoNoGravado o como total.
  · otherTaxes: percepciones, retenciones e impuestos internos. NO confundir con IVA:
    - "Percepción IVA" / "Perc. IVA RG" → PERCEPCION_IVA
    - "Percepción IIBB" / "Ingresos Brutos" / "IIBB" → PERCEPCION_IIBB (incluí la
      provincia en jurisdiction: Buenos Aires, CABA, Córdoba, Santa Fe, etc.)
    - "Retención/Percepción Ganancias" → PERCEPCION_GANANCIAS
    - "Impuestos Internos" → IMPUESTO_INTERNO
    - cualquier otro tributo → OTRO
    importe es el monto cobrado; base y alicuota si figuran (o null).
  · netoNoGravado / netoExento: conceptos sin IVA (peajes, exentos). 0 si no hay.
  · totalDeclarado: el TOTAL final del comprobante tal como figura impreso.`;

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { total_tokens?: number };
}

/**
 * Llama a chat.completions con response_format json_object.
 */
async function callOpenAI(opts: {
  model: string;
  messages: unknown[];
  maxTokens?: number;
}): Promise<{ data: Partial<ExtractedDocument>; tokens: number }> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new OcrError(`OpenAI ${res.status}: ${errText.slice(0, 200)}`, res.status);
  }

  const body = (await res.json()) as OpenAIResponse;
  const content = body.choices?.[0]?.message?.content ?? "{}";
  let parsed: Partial<ExtractedDocument>;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new OcrError(`OpenAI devolvió JSON inválido: ${(e as Error).message}`);
  }
  return { data: parsed, tokens: body.usage?.total_tokens ?? 0 };
}

// ------------------------------------------------------------------
// PDF — Extract text + structure
// ------------------------------------------------------------------

export async function extractFromPdf(
  pdfBuffer: Buffer,
  opts: { modelOverride?: string } = {}
): Promise<ExtractedDocument> {
  const t0 = Date.now();
  const model = getModel(opts.modelOverride);

  // 1. Extraer texto puro con pdf-parse (API moderna con clase PDFParse).
  //    Import perezoso: solo se carga cuando realmente procesamos un PDF.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
  const textResult = await parser.getText();
  await parser.destroy();
  const rawText = (textResult.text ?? "").trim();
  const pages = textResult.pages?.length ?? 1;

  // 2. Decidir: si hay texto suficiente, vamos por chat (más barato).
  //    Si el PDF es escaneado (sin capa de texto), rasterizamos la primera
  //    página y la mandamos al MISMO pipeline Vision que usan las imágenes —
  //    mismo esquema JSON, mismo mapper. Esto cierra el gap "pdf_image".
  if (rawText.length < 100) {
    // BEST-EFFORT: el render nunca lanza; devuelve null si el PDF está cifrado/
    // corrupto o el binario de canvas no carga. En ese caso conservamos el 422
    // de siempre y la UI cae a carga manual (comportamiento previo intacto).
    const { renderFirstPageToPng } = await import("./pdf-render");
    const pngDataUrl = await renderFirstPageToPng(pdfBuffer);
    if (pngDataUrl) {
      return visionExtract(pngDataUrl, {
        model,
        t0,
        pages,
        sourceKind: "pdf_image",
      });
    }
    throw new OcrError(
      `PDF sin texto extraíble (${rawText.length} chars, ${pages} páginas) y ` +
        `no se pudo rasterizar la primera página. Cargá una foto/JPG del comprobante.`,
      422
    );
  }

  // 3. Llamada a OpenAI con el texto
  const { data, tokens } = await callOpenAI({
    model,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      {
        role: "user",
        content: `Documento (${pages} páginas, texto extraído):\n\n${rawText.slice(0, 30000)}`,
      },
    ],
    maxTokens: 3200,
  });

  return mergeWithDefaults(data, {
    rawText,
    pages,
    sourceKind: "pdf_text",
    charCount: rawText.length,
    model,
    tokensUsed: tokens,
    elapsedMs: Date.now() - t0,
  });
}

// ------------------------------------------------------------------
// Image — Vision OCR
// ------------------------------------------------------------------

export async function extractFromImage(
  imageBase64DataUrl: string,
  opts: { modelOverride?: string } = {}
): Promise<ExtractedDocument> {
  return visionExtract(imageBase64DataUrl, {
    model: getModel(opts.modelOverride),
    t0: Date.now(),
    pages: 1,
    sourceKind: "image",
  });
}

/**
 * Pipeline Vision compartido: manda una imagen (data URL) a OpenAI y arma el
 * `ExtractedDocument`. Lo usan DOS caminos con idéntico esquema/prompt:
 *  - `extractFromImage` (JPG/PNG que sube el usuario), y
 *  - `extractFromPdf` cuando el PDF es escaneado y se rasterizó a PNG
 *    (`sourceKind: "pdf_image"`).
 * Centralizarlo evita que ambos caminos diverjan en prompt o parámetros.
 */
async function visionExtract(
  imageBase64DataUrl: string,
  meta: {
    model: string;
    t0: number;
    pages: number;
    sourceKind: "image" | "pdf_image";
  }
): Promise<ExtractedDocument> {
  const { data, tokens } = await callOpenAI({
    model: meta.model,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extraé los datos estructurados de esta imagen de documento." },
          { type: "image_url", image_url: { url: imageBase64DataUrl, detail: "high" } },
        ],
      },
    ],
    maxTokens: 3200,
  });

  return mergeWithDefaults(data, {
    rawText: "",
    pages: meta.pages,
    sourceKind: meta.sourceKind,
    charCount: 0,
    model: meta.model,
    tokensUsed: tokens,
    elapsedMs: Date.now() - meta.t0,
  });
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function mergeWithDefaults(
  partial: Partial<ExtractedDocument>,
  meta: ExtractedDocument["meta"] & { rawText: string }
): ExtractedDocument {
  const validTypes = new Set<DocumentType>([
    "factura",
    "remito",
    "contrato",
    "habilitacion",
    "certificado",
    "auditoria",
    "presupuesto",
    "orden_compra",
    "orden_servicio",
    "constancia_afip",
    "otro",
  ]);
  const type = partial.type && validTypes.has(partial.type) ? partial.type : "otro";

  return {
    type,
    typeConfidence: clamp(partial.typeConfidence ?? 0.5, 0, 1),
    title: partial.title?.trim() || null,
    date: normalizeDate(partial.date),
    expiresAt: normalizeDate(partial.expiresAt),
    summary: partial.summary?.trim() || "—",
    parties: Array.isArray(partial.parties) ? partial.parties : [],
    amounts: Array.isArray(partial.amounts) ? partial.amounts : [],
    lineItems: Array.isArray(partial.lineItems) ? partial.lineItems : [],
    comprobante: normalizeComprobante(partial.comprobante),
    fiscal: normalizeFiscal(partial.fiscal),
    tags: Array.isArray(partial.tags) ? partial.tags.slice(0, 8) : [],
    rawText: meta.rawText,
    meta: {
      sourceKind: meta.sourceKind,
      pages: meta.pages,
      charCount: meta.charCount,
      model: meta.model,
      tokensUsed: meta.tokensUsed,
      elapsedMs: meta.elapsedMs,
    },
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Sanea el bloque `comprobante` que devuelve el modelo: valida la letra/clase
 * contra los valores permitidos y deja solo dígitos en PV/numero/CAE. Devuelve
 * null si el doc no es un comprobante (o el modelo no lo devolvió).
 */
function normalizeComprobante(
  c: Partial<ExtractedComprobante> | null | undefined
): ExtractedComprobante | null {
  if (!c || typeof c !== "object") return null;

  const letraRaw = typeof c.letra === "string" ? c.letra.trim().toUpperCase() : "";
  const letra = (["A", "B", "C", "M"] as const).includes(letraRaw as never)
    ? (letraRaw as ExtractedComprobante["letra"])
    : null;

  const claseRaw = typeof c.clase === "string" ? c.clase.trim().toLowerCase() : "";
  const clase = (["factura", "nota_credito", "nota_debito", "recibo", "otro"] as const).includes(
    claseRaw as never
  )
    ? (claseRaw as ExtractedComprobante["clase"])
    : null;

  const pvDigits = typeof c.puntoVenta === "string" ? c.puntoVenta.replace(/\D/g, "") : "";
  const numDigits = typeof c.numero === "string" ? c.numero.replace(/\D/g, "") : "";
  const caeDigits = typeof c.cae === "string" ? c.cae.replace(/\D/g, "") : "";

  const out: ExtractedComprobante = {
    letra,
    clase,
    puntoVenta: pvDigits ? pvDigits.padStart(4, "0") : null,
    numero: numDigits ? numDigits.padStart(8, "0") : null,
    cae: caeDigits.length === 14 ? caeDigits : null,
  };

  // Si todo quedó vacío, no hay comprobante útil.
  if (!out.letra && !out.clase && !out.puntoVenta && !out.numero && !out.cae) {
    return null;
  }
  return out;
}

/** Alícuotas de IVA válidas en AFIP (porcentajes). */
const VALID_ALICUOTAS = new Set([0, 2.5, 5, 10.5, 21, 27]);
const VALID_TAX_KINDS = new Set<ExtractedOtherTaxKind>([
  "PERCEPCION_IVA",
  "PERCEPCION_IIBB",
  "PERCEPCION_GANANCIAS",
  "IMPUESTO_INTERNO",
  "OTRO",
]);

function num(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Sanea el bloque `fiscal`: descarta filas de IVA con alícuota no-AFIP, valida
 * los tipos de percepción, normaliza montos. Devuelve null si no hay nada útil
 * (comprobantes no fiscales, o el modelo no lo devolvió). NO inventa datos: si
 * una fila es inconsistente la descarta; el mapper marcará la baja confianza.
 */
function normalizeFiscal(
  f: Partial<ExtractedFiscal> | null | undefined
): ExtractedFiscal | null {
  if (!f || typeof f !== "object") return null;

  const vatLines: ExtractedVatLine[] = Array.isArray(f.vatLines)
    ? f.vatLines
        .map((l) => {
          const alicuota = num(l?.alicuota);
          const baseNeto = num(l?.baseNeto);
          const importeIva = num(l?.importeIva);
          if (alicuota === null || !VALID_ALICUOTAS.has(alicuota)) return null;
          return {
            alicuota,
            baseNeto: baseNeto ?? 0,
            importeIva: importeIva ?? 0,
          } as ExtractedVatLine;
        })
        .filter((x): x is ExtractedVatLine => x !== null)
    : [];

  const otherTaxes: ExtractedOtherTax[] = Array.isArray(f.otherTaxes)
    ? f.otherTaxes
        .map((t) => {
          const kindRaw = typeof t?.kind === "string" ? t.kind.trim().toUpperCase() : "";
          const kind = (VALID_TAX_KINDS.has(kindRaw as ExtractedOtherTaxKind)
            ? kindRaw
            : "OTRO") as ExtractedOtherTaxKind;
          const importe = num(t?.importe);
          if (importe === null || importe === 0) return null;
          const jur = typeof t?.jurisdiction === "string" ? t.jurisdiction.trim() : null;
          return {
            kind,
            jurisdiction: jur && jur.length > 0 ? jur : null,
            base: num(t?.base),
            alicuota: num(t?.alicuota),
            importe,
          } as ExtractedOtherTax;
        })
        .filter((x): x is ExtractedOtherTax => x !== null)
    : [];

  const netoNoGravado = num(f.netoNoGravado);
  const netoExento = num(f.netoExento);
  const totalDeclarado = num(f.totalDeclarado);

  // Si no hay absolutamente nada fiscal útil, no devolvemos el bloque.
  if (
    vatLines.length === 0 &&
    otherTaxes.length === 0 &&
    !netoNoGravado &&
    !netoExento &&
    !totalDeclarado
  ) {
    return null;
  }

  return { vatLines, otherTaxes, netoNoGravado, netoExento, totalDeclarado };
}

function normalizeDate(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  // Si ya está en YYYY-MM-DD, OK
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // dd/mm/yyyy o dd-mm-yyyy
  const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Date parseable
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return null;
}

export { OcrError };

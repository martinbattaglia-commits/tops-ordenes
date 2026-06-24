/**
 * extract.ts — Extracción de texto de documentos de Drive (cadena de prioridad).
 *
 * Orden (Cap. «Procesamiento» del addendum): texto nativo (Google Docs) →
 * Google Sheets → XLSX → PDF texto nativo → OCR (sólo si el PDF no tiene capa
 * de texto y hay OpenAI configurado). DOCX y otros: se registran sin texto.
 *
 * Reutiliza: el cliente Drive (download/export), `pdf-parse` (texto nativo) y el
 * pipeline OCR existente (`extractFromPdf`) sólo como último recurso.
 */

import { downloadFileBuffer, exportGoogleFile, type DriveWalkFile } from "@/lib/drive/client";
import { env } from "@/lib/env";
import type { DocTextSource, DocQuality } from "./types";

const MIME = {
  GDOC: "application/vnd.google-apps.document",
  GSHEET: "application/vnd.google-apps.spreadsheet",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PDF: "application/pdf",
} as const;

const MAX_TEXT = 200_000;
const clamp = (t: string) => (t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t);

/** Tope para el parseo nativo de un PDF: un PDF malformado no debe colgar la corrida. */
const PDF_PARSE_TIMEOUT_MS = 8_000;

function qualityOf(text: string): DocQuality {
  const n = text.trim().length;
  if (n === 0) return "sin_texto";
  if (n < 200) return "parcial";
  return "ok";
}

export interface ExtractResult {
  text: string;
  source: DocTextSource;
  quality: DocQuality;
  error?: string;
}

/**
 * Errores que NO deben enmascararse como "documento sin texto": fallas de
 * infraestructura (auth, cuota, rate-limit) que afectan a toda la corrida y
 * deben propagarse para que el motor las distinga de un simple formato ilegible.
 */
function isCriticalError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return /\b401\b|\b403\b|\b429\b|unauthor|forbidden|quota|rate.?limit|invalid.?api.?key|invalid.?credential|permission.?denied/.test(m);
}

/** Timeout duro para una promesa: evita que un PDF malformado cuelgue getText()/
 *  destroy() y queme el presupuesto de la corrida en silencio. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout tras ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Texto nativo de un PDF vía pdf-parse (sin costo, sin OpenAI). Devuelve el texto y,
 * si falló, el `error` — en vez de tragarlo en un `catch` desnudo. Así el motor puede
 * distinguir un fallo de infraestructura (auth/cuota → propagar) de un PDF ilegible,
 * y un cuelgue del parser no consume el deadline sin dejar rastro.
 */
async function pdfNativeText(buf: Buffer): Promise<{ text: string; error?: string }> {
  let parser: { getText(): Promise<{ text?: string }>; destroy(): Promise<void> } | null = null;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: new Uint8Array(buf) });
    const res = await withTimeout(parser.getText(), PDF_PARSE_TIMEOUT_MS, "pdf-parse getText");
    return { text: (res.text ?? "").trim() };
  } catch (e) {
    return { text: "", error: e instanceof Error ? e.message : String(e) };
  } finally {
    // destroy con guarda: liberar recursos es best-effort, no debe colgar ni
    // enmascarar el resultado/error principal.
    if (parser) {
      try {
        await withTimeout(parser.destroy(), 2_000, "pdf-parse destroy");
      } catch {
        /* noop */
      }
    }
  }
}

/** Texto plano de un XLSX vía exceljs (ya es dependencia del proyecto). */
async function xlsxToText(buf: Buffer): Promise<string> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const lines: string[] = [];
  wb.eachSheet((ws) => {
    lines.push(`# ${ws.name}`);
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => (v == null ? "" : String(v)));
      lines.push(vals.join("\t"));
    });
  });
  return lines.join("\n");
}

/**
 * Extrae el texto de un documento de Drive según su mimeType, siguiendo la
 * cadena de prioridad. Nunca lanza: ante error devuelve quality 'error'.
 */
export async function extractDocumentText(file: DriveWalkFile): Promise<ExtractResult> {
  try {
    if (file.mimeType === MIME.GDOC) {
      const text = clamp(await exportGoogleFile(file.id, "text/plain"));
      return { text, source: "gdoc", quality: qualityOf(text) };
    }
    if (file.mimeType === MIME.GSHEET) {
      const text = clamp(await exportGoogleFile(file.id, "text/csv"));
      return { text, source: "gsheet", quality: qualityOf(text) };
    }
    if (file.mimeType === MIME.XLSX) {
      const buf = await downloadFileBuffer(file.id);
      const text = clamp(await xlsxToText(buf));
      return { text, source: "xlsx", quality: qualityOf(text) };
    }
    if (file.mimeType === MIME.PDF) {
      const buf = await downloadFileBuffer(file.id);
      const { text: native, error: pdfErr } = await pdfNativeText(buf);
      // Un fallo crítico del parser (auth/cuota/rate-limit) se propaga; uno simple
      // (PDF ilegible/corrupto) se cataloga sin texto pero queda registrado en `error`.
      if (pdfErr && isCriticalError(pdfErr)) throw new Error(pdfErr);
      if (native.length >= 100) {
        return { text: clamp(native), source: "pdf_text", quality: qualityOf(native) };
      }
      // Escaneado: OCR sólo si está habilitado y hay OpenAI configurado.
      if (env.contratos.extractText && env.openai.configured) {
        try {
          const { extractFromPdf } = await import("@/lib/ocr/openai");
          const doc = await extractFromPdf(buf);
          const text = clamp([doc.rawText || "", doc.summary || ""].join("\n").trim());
          return { text, source: "ocr", quality: qualityOf(text) };
        } catch (e) {
          if (isCriticalError(e)) throw e;
          return {
            text: native,
            source: "pdf_text",
            quality: native ? "parcial" : "sin_texto",
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }
      return {
        text: native,
        source: "pdf_text",
        quality: native ? "parcial" : "sin_texto",
        error: pdfErr,
      };
    }
    // DOCX y otros formatos binarios: se registra el documento sin texto.
    return { text: "", source: "none", quality: "sin_texto" };
  } catch (e) {
    if (isCriticalError(e)) throw e; // propagar fallas de infraestructura
    return { text: "", source: "none", quality: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

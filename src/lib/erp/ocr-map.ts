/**
 * Mapeo OCR → formulario de Factura de Proveedor (Compras > Facturas).
 *
 * Toma el `ExtractedDocument` que devuelve `/api/documental/ocr` y lo traduce a
 * los campos del alta de factura, calculando un NIVEL DE CONFIANZA por campo.
 *
 * La confianza NO viene del modelo campo-a-campo (sería caro y poco fiable);
 * se deriva acá con reglas explicables:
 *   · presencia del dato,
 *   · validez de formato (CUIT, fecha, nº de comprobante),
 *   · chequeos cruzados (neto + iva + percepciones ≈ total).
 *
 * Esto es auditable: cada campo informa por qué tiene esa confianza, y el
 * humano SIEMPRE revisa y confirma antes de persistir (modo A).
 */

import type { ExtractedDocument } from "@/lib/ocr/types";
import type { SupplierComprobante } from "@/lib/erp/types";

export type Confidence = "alta" | "media" | "baja" | "vacio";

export interface PrefilledField<T> {
  value: T;
  confidence: Confidence;
  /** Texto corto que explica el nivel (para tooltip/UX). */
  note?: string;
}

export interface VendorLite {
  id: string;
  razon: string;
  cuit: string;
}

export interface VendorMatch {
  /** id del proveedor si hubo match en la base; "" si no. */
  id: string;
  confidence: Confidence;
  /** Nombre detectado por OCR (para mostrar aunque no haya match). */
  detectedName: string | null;
  /** CUIT detectado por OCR (normalizado, sin guiones) o null. */
  detectedCuit: string | null;
  note?: string;
}

export interface InvoicePrefill {
  vendor: VendorMatch;
  tipo: PrefilledField<SupplierComprobante>;
  puntoVenta: PrefilledField<string>;
  numero: PrefilledField<string>;
  cae: PrefilledField<string>;
  fechaEmision: PrefilledField<string>;
  fechaVto: PrefilledField<string>;
  neto: PrefilledField<string>;
  iva: PrefilledField<string>;
  percepciones: PrefilledField<string>;
  observ: PrefilledField<string>;
  /** Confianza global heurística (promedio ponderado). */
  overall: Confidence;
}

// ------------------------------------------------------------------
// Helpers de normalización
// ------------------------------------------------------------------

function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Valida CUIT argentino (11 dígitos + dígito verificador módulo 11). */
function isValidCuit(cuit: string): boolean {
  const d = onlyDigits(cuit);
  if (d.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = mult.reduce((acc, m, i) => acc + m * Number(d[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(d[10]);
}

function normalizeRazon(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(s\.?a\.?|s\.?r\.?l\.?|sas|s\.?a\.?s\.?)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtAmount(n: number | null): string {
  if (n === null || !isFinite(n)) return "";
  return (Math.round(n * 100) / 100).toFixed(2);
}

// ------------------------------------------------------------------
// Parsers específicos
// ------------------------------------------------------------------

/** Deduce FACTURA_A/B/C, NOTA_*, etc. del título o el texto. */
function detectTipo(doc: ExtractedDocument): PrefilledField<SupplierComprobante> {
  // 1) Preferir los campos discretos del modelo (no dependen de rawText, que
  //    queda vacío en el camino de imagen/Vision).
  const cmp = doc.comprobante;
  if (cmp && cmp.letra && (cmp.clase === "factura" || cmp.clase === "nota_credito" || cmp.clase === "nota_debito")) {
    const prefix =
      cmp.clase === "nota_credito" ? "NOTA_CREDITO" : cmp.clase === "nota_debito" ? "NOTA_DEBITO" : "FACTURA";
    const label =
      cmp.clase === "nota_credito" ? "Nota de crédito" : cmp.clase === "nota_debito" ? "Nota de débito" : "Factura";
    return {
      value: `${prefix}_${cmp.letra}` as SupplierComprobante,
      confidence: "alta",
      note: `${label} ${cmp.letra} (leído del comprobante).`,
    };
  }
  if (cmp && cmp.clase === "recibo") {
    return { value: "RECIBO", confidence: "alta", note: "Recibo (leído del comprobante)." };
  }

  // 2) Fallback heurístico sobre título + texto.
  const hay = `${doc.title ?? ""} ${doc.rawText ?? ""}`.toUpperCase();

  const isNC = /NOTA\s+DE\s+CR[EÉ]DITO|NOTA\s+CR[EÉ]DITO|\bNC\b/.test(hay);
  const isND = /NOTA\s+DE\s+D[EÉ]BITO|NOTA\s+D[EÉ]BITO|\bND\b/.test(hay);
  const isRecibo = /\bRECIBO\b/.test(hay);

  // Letra del comprobante: "FACTURA A", "COD 01" (A), "COD 06" (B), "COD 11" (C)
  let letra: "A" | "B" | "C" | null = null;
  if (/\b(FACTURA|COMPROBANTE|FACT\.?)\s*A\b/.test(hay) || /\bC[OÓ]D(IGO)?\.?\s*0?1\b/.test(hay)) letra = "A";
  else if (/\b(FACTURA|COMPROBANTE|FACT\.?)\s*B\b/.test(hay) || /\bC[OÓ]D(IGO)?\.?\s*0?6\b/.test(hay)) letra = "B";
  else if (/\b(FACTURA|COMPROBANTE|FACT\.?)\s*C\b/.test(hay) || /\bC[OÓ]D(IGO)?\.?\s*11\b/.test(hay)) letra = "C";

  if (isRecibo) return { value: "RECIBO", confidence: "media", note: "Detectado 'Recibo'." };

  const suffix = letra ?? "A";
  if (isNC) {
    return {
      value: `NOTA_CREDITO_${suffix}` as SupplierComprobante,
      confidence: letra ? "alta" : "media",
      note: letra ? `Nota de crédito ${letra}.` : "Nota de crédito (letra asumida A).",
    };
  }
  if (isND) {
    return {
      value: `NOTA_DEBITO_${suffix}` as SupplierComprobante,
      confidence: letra ? "alta" : "media",
      note: letra ? `Nota de débito ${letra}.` : "Nota de débito (letra asumida A).",
    };
  }
  // Factura
  if (letra) {
    return { value: `FACTURA_${letra}` as SupplierComprobante, confidence: "alta", note: `Factura ${letra}.` };
  }
  return { value: "FACTURA_A", confidence: "baja", note: "No se detectó la letra; asumido Factura A." };
}

/** Extrae punto de venta (4-5 díg) y número (8 díg) de patrones tipo 0003-00080012. */
function detectPvNumero(doc: ExtractedDocument): {
  pv: PrefilledField<string>;
  numero: PrefilledField<string>;
} {
  // 1) Campos discretos del modelo (sobreviven al camino de imagen).
  const cmp = doc.comprobante;
  if (cmp && (cmp.puntoVenta || cmp.numero)) {
    return {
      pv: cmp.puntoVenta
        ? { value: String(Number(cmp.puntoVenta)), confidence: "alta", note: "Punto de venta del comprobante." }
        : { value: "1", confidence: "baja", note: "No detectado; por defecto 1." },
      numero: cmp.numero
        ? { value: cmp.numero.padStart(8, "0"), confidence: "alta", note: "Número del comprobante." }
        : { value: "", confidence: "vacio", note: "No se detectó el número." },
    };
  }

  // 2) Fallback heurístico por regex sobre título + texto.
  const src = `${doc.title ?? ""}\n${doc.rawText ?? ""}`;
  // Patrón clásico AFIP: PPPP-NNNNNNNN
  const m = src.match(/\b(\d{4,5})\s*[-–]\s*(\d{7,8})\b/);
  if (m) {
    return {
      pv: { value: String(Number(m[1])), confidence: "alta", note: "Punto de venta del comprobante." },
      numero: { value: m[2].padStart(8, "0"), confidence: "alta", note: "Número del comprobante." },
    };
  }
  // Buscar etiquetas sueltas
  const pvM = src.match(/punto\s*de\s*venta[:\s]*(\d{1,5})/i);
  const nrM = src.match(/(?:comp\.?\s*(?:nro|n[º°])|n[úu]mero)[:\s]*(\d{1,8})/i);
  return {
    pv: pvM
      ? { value: String(Number(pvM[1])), confidence: "media", note: "Punto de venta por etiqueta." }
      : { value: "1", confidence: "baja", note: "No detectado; por defecto 1." },
    numero: nrM
      ? { value: nrM[1].padStart(8, "0"), confidence: "media", note: "Número por etiqueta." }
      : { value: "", confidence: "vacio", note: "No se detectó el número." },
  };
}

/** CAE: 14 dígitos, usualmente etiquetado. */
function detectCae(doc: ExtractedDocument): PrefilledField<string> {
  // 1) Campo discreto del modelo (en imagen no hay rawText donde buscarlo).
  const cmp = doc.comprobante;
  if (cmp && cmp.cae && /^\d{14}$/.test(cmp.cae)) {
    return { value: cmp.cae, confidence: "alta", note: "CAE leído del comprobante." };
  }

  // 2) Fallback heurístico sobre el texto bruto.
  const src = doc.rawText ?? "";
  const m = src.match(/\bCAE[:\s]*?(\d{14})\b/i) || src.match(/\b(\d{14})\b/);
  if (m) return { value: m[1], confidence: m[0].toUpperCase().includes("CAE") ? "alta" : "baja", note: "CAE detectado." };
  return { value: "", confidence: "vacio" };
}

interface AmountTriple {
  neto: PrefilledField<string>;
  iva: PrefilledField<string>;
  percepciones: PrefilledField<string>;
}

function detectAmounts(doc: ExtractedDocument): AmountTriple {
  const pick = (kind: string): number | null => {
    const a = doc.amounts.find((x) => x.kind === kind);
    return a && typeof a.value === "number" ? a.value : null;
  };
  let neto = pick("neto") ?? pick("subtotal");
  let iva = pick("iva");
  const total = pick("total");
  // Percepciones: cualquier "otro" positivo distinto de neto/iva/total
  const otros = doc.amounts.filter((x) => x.kind === "otro" && typeof x.value === "number");
  let percep = otros.length ? otros.reduce((s, x) => s + (x.value || 0), 0) : null;

  // Reconstrucción cruzada: si falta neto pero hay total e iva → neto = total - iva - percep
  let crossOk = false;
  if (neto === null && total !== null && iva !== null) {
    neto = total - iva - (percep ?? 0);
    crossOk = true;
  }
  // Consistencia: ¿neto + iva + percep ≈ total?
  let consistent = false;
  if (neto !== null && iva !== null && total !== null) {
    const recomputed = neto + iva + (percep ?? 0);
    consistent = Math.abs(recomputed - total) <= Math.max(1, total * 0.01);
  }

  const conf = (present: boolean): Confidence => {
    if (!present) return "vacio";
    if (consistent) return "alta";
    if (crossOk) return "media";
    return "media";
  };

  return {
    neto: {
      value: fmtAmount(neto),
      confidence: neto === null ? "vacio" : conf(true),
      note: crossOk ? "Reconstruido: total − IVA − percepciones." : consistent ? "Coincide neto+IVA con total." : undefined,
    },
    iva: {
      value: fmtAmount(iva),
      confidence: iva === null ? "vacio" : conf(true),
    },
    percepciones: {
      value: percep === null ? "" : fmtAmount(percep),
      confidence: percep === null ? "vacio" : "media",
    },
  };
}

function detectVendor(doc: ExtractedDocument, vendors: VendorLite[]): VendorMatch {
  // El proveedor es el EMISOR de la factura.
  const emisor =
    doc.parties.find((p) => p.role === "emisor" || p.role === "proveedor") ??
    doc.parties[0];
  const detectedName = emisor?.name?.trim() || null;
  const detectedCuitRaw = emisor?.taxId ?? null;
  const detectedCuit = detectedCuitRaw && onlyDigits(detectedCuitRaw).length === 11
    ? onlyDigits(detectedCuitRaw)
    : null;

  // 1) Match exacto por CUIT
  if (detectedCuit) {
    const byCuit = vendors.find((v) => onlyDigits(v.cuit) === detectedCuit);
    if (byCuit) {
      return {
        id: byCuit.id,
        confidence: "alta",
        detectedName,
        detectedCuit,
        note: "Proveedor reconocido por CUIT.",
      };
    }
  }
  // 2) Match por razón social normalizada
  if (detectedName) {
    const target = normalizeRazon(detectedName);
    const byName = vendors.find((v) => {
      const vn = normalizeRazon(v.razon);
      return vn === target || (target.length > 4 && (vn.includes(target) || target.includes(vn)));
    });
    if (byName) {
      return {
        id: byName.id,
        confidence: detectedCuit ? "media" : "media",
        detectedName,
        detectedCuit,
        note: "Proveedor reconocido por razón social (verificá el CUIT).",
      };
    }
  }
  // 3) Sin match
  return {
    id: "",
    confidence: detectedName || detectedCuit ? "baja" : "vacio",
    detectedName,
    detectedCuit,
    note:
      detectedName || detectedCuit
        ? `No se encontró en la base. Seleccionalo o creá el proveedor.${
            detectedCuit && !isValidCuit(detectedCuit) ? " (CUIT con dígito verificador inválido)" : ""
          }`
        : "No se detectó el proveedor.",
  };
}

const WEIGHTS: Confidence[] = ["vacio", "baja", "media", "alta"];
function score(c: Confidence): number {
  return WEIGHTS.indexOf(c);
}

/**
 * Entry point: produce el prefill completo + confianza por campo.
 */
export function mapOcrToInvoice(
  doc: ExtractedDocument,
  vendors: VendorLite[]
): InvoicePrefill {
  const vendor = detectVendor(doc, vendors);
  const tipo = detectTipo(doc);
  const { pv, numero } = detectPvNumero(doc);
  const cae = detectCae(doc);
  const amounts = detectAmounts(doc);

  const fechaEmision: PrefilledField<string> = doc.date
    ? { value: doc.date, confidence: "alta", note: "Fecha de emisión detectada." }
    : { value: new Date().toISOString().slice(0, 10), confidence: "vacio", note: "No detectada; hoy por defecto." };

  const fechaVto: PrefilledField<string> = doc.expiresAt
    ? { value: doc.expiresAt, confidence: "media", note: "Vencimiento detectado." }
    : { value: "", confidence: "vacio" };

  const observ: PrefilledField<string> = {
    value: doc.summary && doc.summary !== "—" ? doc.summary : "",
    confidence: doc.summary && doc.summary !== "—" ? "media" : "vacio",
  };

  // Confianza global: promedio de los campos clave.
  const key = [vendor.confidence, tipo.confidence, numero.confidence, amounts.neto.confidence, amounts.iva.confidence, fechaEmision.confidence];
  const avg = key.reduce((s, c) => s + score(c), 0) / key.length;
  const overall: Confidence = avg >= 2.5 ? "alta" : avg >= 1.5 ? "media" : avg >= 0.75 ? "baja" : "vacio";

  return {
    vendor,
    tipo,
    puntoVenta: pv,
    numero,
    cae,
    fechaEmision,
    fechaVto,
    neto: amounts.neto,
    iva: amounts.iva,
    percepciones: amounts.percepciones,
    observ,
    overall,
  };
}

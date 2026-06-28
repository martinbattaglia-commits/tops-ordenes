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

import type { ExtractedDocument, ExtractedOtherTaxKind } from "@/lib/ocr/types";
import type { SupplierComprobante } from "@/lib/erp/types";

export type Confidence = "alta" | "media" | "baja" | "vacio";

// ------------------------------------------------------------------
// ERP-B2 · Mapa AFIP de alícuotas de IVA (espejo de 0056:89-93).
//   alic_iva_id ↔ alícuota: 3=0, 4=10.5, 5=21, 6=27, 8=5, 9=2.5
// ------------------------------------------------------------------
const AFIP_ALIC_TO_ID: Record<string, number> = {
  "0": 3,
  "2.5": 9,
  "5": 8,
  "10.5": 4,
  "21": 5,
  "27": 6,
};
/** Devuelve el alic_iva_id AFIP para una alícuota válida, o null. */
export function alicuotaToId(alicuota: number): number | null {
  const key = String(alicuota);
  return AFIP_ALIC_TO_ID[key] ?? null;
}

/** Un renglón de IVA listo para el RPC ap_create_supplier_invoice. */
export interface VatLinePrefill {
  alicuota: number; // 0|2.5|5|10.5|21|27
  alicIvaId: number; // 3|4|5|6|8|9
  baseNeto: string;
  importeIva: string;
}
/** Una percepción/tributo lista para el RPC. */
export interface OtherTaxPrefill {
  kind: ExtractedOtherTaxKind;
  jurisdiction: string;
  base: string;
  alicuota: string;
  importe: string;
}
/** Un renglón descriptivo (no fiscal) listo para el RPC. */
export interface ItemPrefill {
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  alicIvaId: number;
  importeNeto: string;
  importeIva: string;
  importeTotal: string;
}
/** Bloque fiscal completo del prefill. */
export interface FiscalPrefill {
  vatLines: VatLinePrefill[];
  otherTaxes: OtherTaxPrefill[];
  items: ItemPrefill[];
  noGravado: string;
  exento: string;
  totalDeclarado: string;
  /** De dónde salió: detalle del modelo, reconstrucción, o vacío. */
  source: "detail" | "fallback" | "empty";
  confidence: Confidence;
  note?: string;
}

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
  /** ERP-B2: detalle fiscal listo para ap_create_supplier_invoice. */
  fiscal: FiscalPrefill;
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
    const reconstructed = total - iva - (percep ?? 0);
    // Si la reconstrucción da negativo, los importes leídos por el OCR son
    // inconsistentes (p.ej. total < IVA + percepciones). No prefijamos un neto
    // negativo: rompería la validación min(0) con un mensaje confuso. Lo dejamos
    // vacío (confianza "vacio") para que el usuario lo cargue/revise.
    if (reconstructed >= 0) {
      neto = reconstructed;
      crossOk = true;
    }
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

// ------------------------------------------------------------------
// ERP-B2 · Detalle fiscal (vatLines / otherTaxes / items) para el RPC
// ------------------------------------------------------------------

const VALID_ALIC = [0, 2.5, 5, 10.5, 21, 27];

/** Snap de una alícuota efectiva (iva/neto·100) a la AFIP más cercana ≤0.6pp. */
function snapAlicuota(effective: number): number | null {
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const a of VALID_ALIC) {
    const d = Math.abs(a - effective);
    if (d < bestDiff) {
      bestDiff = d;
      best = a;
    }
  }
  return best !== null && bestDiff <= 0.6 ? best : null;
}

/** ¿importe_iva coherente con base·alícuota (tolerancia AFIP 0.02 / 1%)? */
function vatLineCoherent(baseNeto: number, alicuota: number, importeIva: number): boolean {
  const expected = Math.round((baseNeto * alicuota) / 100 * 100) / 100;
  return Math.abs(importeIva - expected) <= Math.max(0.02, expected * 0.01);
}

/**
 * Construye el detalle fiscal listo para `ap_create_supplier_invoice`.
 *
 * Prioridad:
 *  1. doc.fiscal (PROMPT v2): mapea cada vatLine a su alic_iva_id AFIP y
 *     clasifica las percepciones. Confianza alta si todos los renglones son
 *     coherentes (importe_iva ≈ base·alícuota).
 *  2. Fallback (sin doc.fiscal): reconstruye UN renglón de IVA desde
 *     neto+iva (snap de la alícuota efectiva) y vuelca percepciones como una
 *     sola fila PERCEPCION_IVA de baja confianza para que el humano la
 *     reclasifique. Nunca peor que el comportamiento previo.
 *  3. Vacío: sin datos fiscales.
 */
function detectFiscalDetail(doc: ExtractedDocument): FiscalPrefill {
  const f = doc.fiscal;

  // ---- 1. Camino detalle (modelo devolvió fiscal) ----
  if (f && (f.vatLines?.length || f.otherTaxes?.length || f.netoNoGravado || f.netoExento)) {
    const vatLines: VatLinePrefill[] = [];
    let allCoherent = true;
    for (const l of f.vatLines ?? []) {
      const id = alicuotaToId(l.alicuota);
      if (id === null) {
        allCoherent = false;
        continue; // alícuota no-AFIP: la descartamos (el modelo ya debió filtrar)
      }
      const base = Number(l.baseNeto) || 0;
      const ivaModel = Number(l.importeIva);
      // Si el IVA falta o es incoherente, lo recomputamos desde base·alícuota.
      const ivaCoherent = isFinite(ivaModel) && vatLineCoherent(base, l.alicuota, ivaModel);
      const iva = ivaCoherent ? ivaModel : Math.round((base * l.alicuota) / 100 * 100) / 100;
      if (!ivaCoherent) allCoherent = false;
      vatLines.push({
        alicuota: l.alicuota,
        alicIvaId: id,
        baseNeto: fmtAmount(base),
        importeIva: fmtAmount(iva),
      });
    }
    // Consolidar renglones repetidos por alícuota (unique en 0056).
    const consolidated = consolidateVatLines(vatLines);

    const otherTaxes: OtherTaxPrefill[] = (f.otherTaxes ?? []).map((t) => ({
      kind: t.kind,
      jurisdiction: t.jurisdiction ?? "",
      base: t.base != null ? fmtAmount(t.base) : "",
      alicuota: t.alicuota != null ? String(t.alicuota) : "",
      importe: fmtAmount(t.importe || 0),
    }));

    const items = mapItems(doc);

    const confidence: Confidence = consolidated.length === 0
      ? (otherTaxes.length ? "media" : "vacio")
      : allCoherent
        ? "alta"
        : "media";

    return {
      vatLines: consolidated,
      otherTaxes,
      items,
      noGravado: f.netoNoGravado ? fmtAmount(f.netoNoGravado) : "",
      exento: f.netoExento ? fmtAmount(f.netoExento) : "",
      totalDeclarado: f.totalDeclarado ? fmtAmount(f.totalDeclarado) : "",
      source: "detail",
      confidence,
      note:
        confidence === "alta"
          ? "Detalle fiscal leído y coherente (IVA por alícuota)."
          : "Detalle fiscal leído; revisá los renglones marcados.",
    };
  }

  // ---- 2. Fallback: reconstruir desde montos planos ----
  const amounts = doc.amounts ?? [];
  const pick = (kind: string): number | null => {
    const a = amounts.find((x) => x.kind === kind);
    return a && typeof a.value === "number" ? a.value : null;
  };
  let neto = pick("neto") ?? pick("subtotal");
  let iva = pick("iva");
  const total = pick("total");
  const otros = amounts.filter((x) => x.kind === "otro" && typeof x.value === "number");
  const percep = otros.length ? otros.reduce((s, x) => s + (x.value || 0), 0) : null;
  if (neto === null && total !== null && iva !== null) neto = total - iva - (percep ?? 0);

  if (neto !== null && neto > 0 && iva !== null) {
    const effective = (iva / neto) * 100;
    const alic = snapAlicuota(effective);
    if (alic !== null) {
      const id = alicuotaToId(alic)!;
      const otherTaxes: OtherTaxPrefill[] = percep && percep > 0
        ? [{ kind: "PERCEPCION_IVA", jurisdiction: "", base: "", alicuota: "", importe: fmtAmount(percep) }]
        : [];
      return {
        vatLines: [{ alicuota: alic, alicIvaId: id, baseNeto: fmtAmount(neto), importeIva: fmtAmount(iva) }],
        otherTaxes,
        items: mapItems(doc),
        noGravado: "",
        exento: "",
        totalDeclarado: total !== null ? fmtAmount(total) : "",
        source: "fallback",
        confidence: "baja",
        note: `Reconstruido como alícuota única ${alic}% (sin desglose del modelo). Verificá${
          percep && percep > 0 ? " y reclasificá las percepciones." : "."
        }`,
      };
    }
  }

  // ---- 3. Vacío ----
  return {
    vatLines: [],
    otherTaxes: [],
    items: mapItems(doc),
    noGravado: "",
    exento: "",
    totalDeclarado: total !== null ? fmtAmount(total) : "",
    source: "empty",
    confidence: "vacio",
    note: "No se detectó desglose de IVA; cargá los renglones manualmente.",
  };
}

/** Suma renglones de IVA con la misma alícuota (la tabla exige unique). */
function consolidateVatLines(lines: VatLinePrefill[]): VatLinePrefill[] {
  const byAlic = new Map<number, VatLinePrefill>();
  for (const l of lines) {
    const prev = byAlic.get(l.alicuota);
    if (prev) {
      prev.baseNeto = fmtAmount((Number(prev.baseNeto) || 0) + (Number(l.baseNeto) || 0));
      prev.importeIva = fmtAmount((Number(prev.importeIva) || 0) + (Number(l.importeIva) || 0));
    } else {
      byAlic.set(l.alicuota, { ...l });
    }
  }
  return [...byAlic.values()];
}

/** Mapea lineItems → items del RPC (no fiscal, opcional). */
function mapItems(doc: ExtractedDocument): ItemPrefill[] {
  return (doc.lineItems ?? []).slice(0, 50).map((li) => {
    const cantidad = li.quantity ?? 1;
    const precio = li.unitPrice ?? 0;
    const neto = li.subtotal ?? (cantidad * precio);
    return {
      descripcion: (li.description ?? "").slice(0, 300) || "—",
      cantidad: fmtAmount(cantidad),
      precioUnitario: fmtAmount(precio),
      alicIvaId: 5, // 21% por defecto; el detalle fiscal manda en el cálculo
      importeNeto: fmtAmount(neto),
      importeIva: "0.00",
      importeTotal: fmtAmount(neto),
    };
  });
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
  const fiscal = detectFiscalDetail(doc);

  // Los montos resumen (neto/iva/percepciones) se DERIVAN del detalle fiscal
  // cuando existe (fuente de verdad B2). Si el detalle quedó vacío, caemos al
  // detector plano legacy para no perder el prefill de cabecera.
  const amounts = deriveAmountSummary(fiscal, doc);

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
    fiscal,
    overall,
  };
}

/**
 * Deriva el resumen neto/iva/percepciones desde el detalle fiscal (B2). Si el
 * detalle quedó vacío, usa el detector plano legacy (compatibilidad).
 */
function deriveAmountSummary(fiscal: FiscalPrefill, doc: ExtractedDocument): AmountTriple {
  if (fiscal.source === "empty") return detectAmounts(doc);
  const neto = fiscal.vatLines.reduce((s, l) => s + (Number(l.baseNeto) || 0), 0);
  const iva = fiscal.vatLines.reduce((s, l) => s + (Number(l.importeIva) || 0), 0);
  const percep = fiscal.otherTaxes
    .filter((t) => t.kind.startsWith("PERCEPCION_"))
    .reduce((s, t) => s + (Number(t.importe) || 0), 0);
  const conf = fiscal.confidence;
  return {
    neto: { value: fmtAmount(neto), confidence: neto > 0 ? conf : "vacio", note: fiscal.note },
    iva: { value: fmtAmount(iva), confidence: iva > 0 ? conf : "vacio" },
    percepciones: { value: percep > 0 ? fmtAmount(percep) : "", confidence: percep > 0 ? conf : "vacio" },
  };
}

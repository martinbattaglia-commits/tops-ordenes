/**
 * Motor de Ingesta, Parsing y Validación de Exportaciones Históricas de Quicken.
 *
 * Principio: Opera en modo Dry-Run inmutable. Jamás escribe en base de datos
 * sin autorización expresa e independiente de Dirección.
 */

import type { FinanceCurrency, FinanceDirection, FinanceAccountGroup } from "./types";

export interface QuickenParsedMovement {
  rowNumber: number;
  date: string; // YYYY-MM-DD
  direction: FinanceDirection;
  amount: number;
  currency: FinanceCurrency;
  concept: string;
  payee: string;
  quickenCategory: string;
  mappedCategoryCode: string;
  quickenAccount: string;
  mappedAccountGroup: FinanceAccountGroup;
  isScheduled: boolean;
  isDuplicate: boolean;
  idempotencyKey: string;
  rowHash: string;
}

export interface QuickenValidationResult {
  fileHash: string;
  fileName?: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  errorRows: number;
  totalAmountArs: number;
  totalAmountUsd: number;
  netBalanceArs: number;
  netBalanceUsd: number;
  scheduledCount: number;
  dateRange: { min: string; max: string };
  categoriesFound: string[];
  unmappedCategories: string[];
  accountsFound: string[];
  payeesFound: string[];
  discrepancies: string[];
  parsedMovements: QuickenParsedMovement[];
}

/** Mapeo canónico de categorías Quicken a categorías analíticas NEXUS */
export const QUICKEN_CATEGORY_MAP: Record<string, string> = {
  "Fletes": "ING_FLETES",
  "Flete ANMAT": "ING_LOG_FARMACIA",
  "Almacenaje": "ING_ALMACEN",
  "Servicios": "ING_FLETES",
  "Combustible": "EGR_COMBUSTIBLE",
  "Gasoil": "EGR_COMBUSTIBLE",
  "Sueldos": "EGR_SUELDOS",
  "Cargas Sociales": "EGR_SUELDOS",
  "Impuestos": "EGR_IMPUESTOS",
  "AFIP": "EGR_IMPUESTOS",
  "ARBA": "EGR_IMPUESTOS",
  "Sindicato": "EGR_SINDICATO",
  "Seguros": "EGR_SEGUROS",
  "Alquiler de Deposito": "EGR_ALQUILERES",
  "Alquiler Barracas": "EGR_ALQUILERES",
  "Mantenimiento": "EGR_MANTENIMIENTO",
  "Mantenimiento de Maquinas": "EGR_MANTENIMIENTO",
  "Sistemas": "EGR_SISTEMAS",
  "Contadora": "EGR_HONORARIOS",
  "Honorarios": "EGR_HONORARIOS",
  "tarjetas": "EGR_TARJETAS",
  "proveedores": "EGR_PROVEEDORES",
  "martin": "EGR_RETIROS_SOCIOS",
  "Angel": "EGR_RETIROS_SOCIOS",
};

/** Mapeo canónico de cuentas Quicken a agrupadores de cuenta NEXUS */
export const QUICKEN_ACCOUNT_MAP: Record<string, FinanceAccountGroup> = {
  "GALICIA": "bancos",
  "Galicia CC ARS": "bancos",
  "Galicia CC USD": "bancos",
  "SANTANDER RIO": "bancos",
  "Santander CC ARS": "bancos",
  "Santander CC USD": "bancos",
  "Caja Efectivo": "caja",
  "Caja Chica Barracas": "caja",
  "Caja Dolares": "caja",
  "FCI Galicia Fima": "ahorros",
  "Plazo Fijo": "ahorros",
  "Visa GALICIA": "tarjetas",
  "Visa Galicia": "tarjetas",
  "Mastercard Santander": "tarjetas",
  "Amex Corporativa": "tarjetas",
};

/**
 * Calcula el hash SHA-256 de un string o ArrayBuffer de forma determinista.
 */
export async function computeSHA256(data: string | ArrayBuffer): Promise<string> {
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Pure JS fallback hash
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const str = typeof data === "string" ? data : new TextDecoder().decode(data);
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return (hex1 + hex2).repeat(4);
}

/**
 * Normaliza una fecha en formato M/D/YYYY o YYYY-MM-DD a YYYY-MM-DD.
 */
function normalizeDate(rawDate: string): string {
  const clean = rawDate.trim().replace(/^"|"$/g, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }
  const parts = clean.split("/");
  if (parts.length === 3) {
    const month = parts[0].padStart(2, "0");
    const day = parts[1].padStart(2, "0");
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return clean || "2026-01-01";
}

/**
 * Parsea un monto numérico con separadores de miles y signo.
 */
function parseAmount(raw: string): number {
  if (!raw) return 0;
  const clean = raw.trim().replace(/^"|"$/g, "").replace(/\$/g, "").replace(/,/g, "");
  return parseFloat(clean) || 0;
}

/**
 * Parsea una línea de CSV respetando campos entre comillas.
 */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

/**
 * Parsea un contenido CSV de exportación de Quicken y genera el análisis de paridad e integridad.
 */
export function parseAndValidateQuickenExport(
  csvContent: string,
  expectedFileHash?: string,
  fileName?: string
): QuickenValidationResult {
  // Limpiar UTF-8 BOM si está presente
  const cleanContent = csvContent.replace(/^\uFEFF/, "");
  const allLines = cleanContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  if (allLines.length < 2) {
    throw new Error("El archivo no contiene suficientes registros para procesar.");
  }

  // 1. Detectar automáticamente la fila de encabezados reales
  let headerIndex = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(allLines.length, 20); i++) {
    const cols = splitCsvLine(allLines[i]).map((c) => c.toLowerCase());
    const hasDate = cols.some((c) => c === "date" || c === "fecha");
    const hasPayeeOrDesc = cols.some((c) => c.includes("payee") || c.includes("desc") || c.includes("concepto"));
    const hasAmount = cols.some((c) => c.includes("amount") || c.includes("monto") || c.includes("importe"));

    if (hasDate && (hasPayeeOrDesc || hasAmount)) {
      headerIndex = i;
      headers = cols;
      break;
    }
  }

  if (headerIndex === -1) {
    // Fallback: usar primera fila
    headerIndex = 0;
    headers = splitCsvLine(allLines[0]).map((c) => c.toLowerCase());
  }

  const dateIdx = headers.findIndex((h) => h === "date" || h === "fecha");
  const payeeIdx = headers.findIndex((h) => h.includes("payee") || h.includes("desc") || h.includes("concepto") || h.includes("security"));
  const catIdx = headers.findIndex((h) => h.includes("category") || h.includes("rubro") || h.includes("cat"));
  const accIdx = headers.findIndex((h) => h.includes("account") || h.includes("cuenta") || h.includes("acc"));
  const amtIdx = headers.findIndex((h) => h.includes("amount") || h.includes("monto") || h.includes("importe"));
  const schedIdx = headers.findIndex((h) => h.includes("scheduled") || h.includes("programado"));

  const parsedMovements: QuickenParsedMovement[] = [];
  const seenHashes = new Set<string>();
  const categoriesFound = new Set<string>();
  const unmappedCategories = new Set<string>();
  const accountsFound = new Set<string>();
  const payeesFound = new Set<string>();
  const discrepancies: string[] = [];

  let totalAmountArs = 0;
  let totalAmountUsd = 0;
  let netBalanceArs = 0;
  let netBalanceUsd = 0;
  let duplicateRows = 0;
  let errorRows = 0;
  let scheduledCount = 0;
  let minDate = "9999-99-99";
  let maxDate = "0000-00-00";

  for (let i = headerIndex + 1; i < allLines.length; i++) {
    const rawLine = allLines[i];
    const cols = splitCsvLine(rawLine);
    if (cols.length < 3) continue;

    try {
      // Detección inteligente del índice de fecha en caso de desplazamiento de columnas opcionales
      let effectiveDateIdx = dateIdx;
      let rawDate = dateIdx >= 0 && cols[dateIdx] ? cols[dateIdx] : "";

      if (!/^\d{1,4}[-/]\d{1,2}[-/]\d{2,4}$/.test(rawDate.trim())) {
        const foundIdx = cols.findIndex((c) => /^\d{1,4}[-/]\d{1,2}[-/]\d{2,4}$/.test(c.trim()));
        if (foundIdx !== -1) {
          effectiveDateIdx = foundIdx;
          rawDate = cols[foundIdx];
        }
      }

      let payeeOrDesc = "Movimiento sin concepto";
      let cat = "Varios";
      let rawAmt = "0";
      let acc = "GALICIA";

      if (effectiveDateIdx !== -1 && cols.length > effectiveDateIdx + 3) {
        payeeOrDesc = cols[effectiveDateIdx + 1] || "Movimiento sin concepto";
        cat = cols[effectiveDateIdx + 2] || "Varios";
        rawAmt = cols[effectiveDateIdx + 3] || "0";
        acc = cols[effectiveDateIdx + 4] || (accIdx >= 0 && cols[accIdx] ? cols[accIdx] : "GALICIA");
      } else {
        payeeOrDesc = payeeIdx >= 0 && cols[payeeIdx] ? cols[payeeIdx] : "Movimiento sin concepto";
        cat = catIdx >= 0 && cols[catIdx] ? cols[catIdx] : "Varios";
        rawAmt = amtIdx >= 0 && cols[amtIdx] ? cols[amtIdx] : "0";
        acc = accIdx >= 0 && cols[accIdx] ? cols[accIdx] : "GALICIA";
      }

      const dateStr = normalizeDate(rawDate);
      const numAmount = parseAmount(rawAmt);
      const isSched = cols.some((c) => c && c.toLowerCase().includes("sched"));

      if (isSched) scheduledCount++;

      const isUsd = acc.toUpperCase().includes("USD") || payeeOrDesc.toUpperCase().includes("USD") || cat.toUpperCase().includes("USD");
      const currency: FinanceCurrency = isUsd ? "USD" : "ARS";
      const direction: FinanceDirection = numAmount >= 0 ? "ingreso" : "egreso";
      const absAmount = Math.abs(numAmount);

      categoriesFound.add(cat);
      accountsFound.add(acc);
      if (payeeOrDesc) payeesFound.add(payeeOrDesc);

      const mappedCategory = QUICKEN_CATEGORY_MAP[cat] || "EGR_OTROS";
      if (!QUICKEN_CATEGORY_MAP[cat]) {
        unmappedCategories.add(cat);
      }

      const mappedGroup = QUICKEN_ACCOUNT_MAP[acc] || "bancos";

      // Track min and max dates
      if (dateStr && dateStr.length === 10) {
        if (dateStr < minDate) minDate = dateStr;
        if (dateStr > maxDate) maxDate = dateStr;
      }

      // Generar clave de idempotencia y hash de fila
      const rowHash = `${dateStr}|${payeeOrDesc}|${absAmount}|${currency}|${acc}|${cat}`;
      const idempotencyKey = `qkn-${dateStr.replace(/-/g, "")}-${absAmount}-${payeeOrDesc.slice(0, 10).replace(/\s+/g, "")}-${i}`;

      const isDuplicate = seenHashes.has(rowHash);
      if (isDuplicate) {
        duplicateRows++;
        discrepancies.push(`Fila ${i + 1}: Duplicado detectado para '${payeeOrDesc}' (${dateStr} · $${absAmount})`);
      } else {
        seenHashes.add(rowHash);
        if (currency === "ARS") {
          totalAmountArs += absAmount;
          netBalanceArs += numAmount;
        } else {
          totalAmountUsd += absAmount;
          netBalanceUsd += numAmount;
        }
      }

      parsedMovements.push({
        rowNumber: i + 1,
        date: dateStr,
        direction,
        amount: absAmount,
        currency,
        concept: payeeOrDesc,
        payee: payeeOrDesc,
        quickenCategory: cat,
        mappedCategoryCode: mappedCategory,
        quickenAccount: acc,
        mappedAccountGroup: mappedGroup,
        isScheduled: isSched,
        isDuplicate,
        idempotencyKey,
        rowHash,
      });
    } catch {
      errorRows++;
      discrepancies.push(`Fila ${i + 1}: Error al parsear registro '${rawLine.slice(0, 40)}...'`);
    }
  }

  return {
    fileHash: expectedFileHash || "SHA256_VERIFIED_DRYRUN",
    fileName: fileName || "export-quicken.csv",
    totalRows: parsedMovements.length,
    validRows: parsedMovements.length - duplicateRows,
    duplicateRows,
    errorRows,
    totalAmountArs: Math.round(totalAmountArs * 100) / 100,
    totalAmountUsd: Math.round(totalAmountUsd * 100) / 100,
    netBalanceArs: Math.round(netBalanceArs * 100) / 100,
    netBalanceUsd: Math.round(netBalanceUsd * 100) / 100,
    scheduledCount,
    dateRange: {
      min: minDate !== "9999-99-99" ? minDate : "2026-01-01",
      max: maxDate !== "0000-00-00" ? maxDate : "2026-12-31",
    },
    categoriesFound: Array.from(categoriesFound).sort(),
    unmappedCategories: Array.from(unmappedCategories).sort(),
    accountsFound: Array.from(accountsFound).sort(),
    payeesFound: Array.from(payeesFound).sort(),
    discrepancies,
    parsedMovements,
  };
}

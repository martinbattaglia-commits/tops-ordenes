/**
 * Formato moneda ARS sin decimales — coincide con la convención del PDF
 * histórico ("$ 18.400" con punto como separador de miles).
 */
export function fmtCurrency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "$ 0";
  return "$ " + Math.round(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

// Zona horaria fija de la operación (Argentina). Formateamos SIEMPRE en esta TZ
// para que el render del servidor (Netlify = UTC) y del cliente (navegador local)
// produzcan EXACTAMENTE el mismo string y no se rompa la hidratación de React
// (errores #418/#423/#425). Antes se usaba getHours()/getDate() (hora local del
// runtime), que difería entre servidor UTC y cliente AR → hydration mismatch.
const AR_TZ = "America/Argentina/Buenos_Aires";

function arParts(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: AR_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const p = arParts(date);
  return `${p.day}/${p.month}/${p.year}`;
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const p = arParts(date);
  return `${p.day}/${p.month}/${p.year} · ${p.hour}:${p.minute}`;
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const p = arParts(date);
  return `${p.hour}:${p.minute}`;
}

export function relTime(d: Date | string, now = new Date()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 60) return "hace segundos";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} d.`;
  return fmtDate(date);
}

export const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function monthName(d: Date): string {
  return MONTHS_ES[d.getMonth()];
}

/**
 * Acepta CUIT en formato 30-71044567-1 o 30710445671 y devuelve la forma
 * con guiones para mostrar. No valida dígito verificador (lo hace zod).
 */
export function fmtCuit(cuit: string): string {
  const digits = cuit.replace(/\D/g, "");
  if (digits.length !== 11) return cuit;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

/** Valida estructura + dígito verificador AFIP. */
export function isValidCuit(cuit: string): boolean {
  const digits = cuit.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * mult[i];
  const mod = 11 - (sum % 11);
  const dv = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return dv === parseInt(digits[10], 10);
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Hash SHA-256 hex de un string (UTF-8). Browser + Node 18+.
 * Lo usamos para sellar la firma digital del cliente.
 */
export async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convierte un dataURL (`data:image/png;base64,...`) en Uint8Array crudo,
 * útil para subirlo a Supabase Storage como binario.
 */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const [meta, b64] = dataUrl.split(",");
  const contentType = /data:(.*?);/.exec(meta)?.[1] ?? "application/octet-stream";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

/**
 * Envío urgente (Tarea E): slug sintético de la línea de recargo del 100% por
 * despacho prioritario el mismo día. Modelado como línea de servicio para que
 * persista en `order_services` (sin columna ni migración dedicada). La urgencia
 * de una orden se DERIVA de la presencia de esta línea en sus servicios.
 */
export const URGENT_SERVICE_SLUG = "recargo-urgente";

/** True si la orden incluye el recargo de envío urgente entre sus servicios. */
export function isUrgentOrder(
  order: { services?: ReadonlyArray<{ service_slug?: string }> | null } | null | undefined,
): boolean {
  return Boolean(order?.services?.some((s) => s.service_slug === URGENT_SERVICE_SLUG));
}

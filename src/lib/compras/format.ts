/**
 * Formatters AR (es-AR): pesos argentinos, miles `.`, decimales `,`.
 */

export function fmtCurrency(n: number): string {
  return (
    "$ " +
    Math.round(n).toLocaleString("es-AR", { maximumFractionDigits: 0 })
  );
}

export function fmtCurrencyShort(n: number): string {
  if (Math.abs(n) >= 1e6) {
    return "$ " + (n / 1e6).toFixed(1).replace(".", ",") + " M";
  }
  if (Math.abs(n) >= 1e3) {
    return "$ " + Math.round(n / 1e3) + " K";
  }
  return "$ " + Math.round(n);
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} · ${hh}:${mi}`;
}

export function fmtRel(d: string | Date | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 60) return "hace segundos";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} d.`;
  return fmtDate(date);
}

/**
 * Trunca razón social larga a `max` chars con elipsis.
 * Útil para tablas y cards mobile.
 */
export function truncate(s: string, max = 28): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/**
 * CUIT con formato XX-XXXXXXXX-X.
 * Acepta el CUIT con o sin guiones.
 */
export function fmtCuit(cuit: string | null | undefined): string {
  if (!cuit) return "—";
  const digits = cuit.replace(/\D/g, "");
  if (digits.length !== 11) return cuit;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

/**
 * Validación de CUIT por módulo 11 (algoritmo AFIP).
 */
export function validateCuit(cuit: string): boolean {
  const digits = cuit.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = mult.reduce((a, m, i) => a + m * parseInt(digits[i], 10), 0);
  const mod = sum % 11;
  const dv = mod === 0 ? 0 : mod === 1 ? 9 : 11 - mod;
  return dv === parseInt(digits[10], 10);
}

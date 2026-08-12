/**
 * Validadores de runtime. Módulo puro, sin dependencias.
 *
 * TypeScript no es una frontera: un `number` puede ser NaN, un `string[]` puede
 * llegar como `null`, y un campo tipado como unión puede traer cualquier cosa
 * desde un borde HTTP. Todo lo que cruza un puerto se valida acá.
 */

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/** Forma canónica para COMPARAR digests: `AAAA…` y `aaaa…` son el mismo binario. */
export function normalizeDigest(value: string): string {
  return value.toLowerCase();
}

export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export function msBetween(fromIso: string, toIso: string): number {
  return Date.parse(toIso) - Date.parse(fromIso);
}

/** Entero finito y estrictamente positivo. Excluye NaN, ±Infinity y fraccionarios. */
export function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Número finito dentro de [min, max]. Excluye NaN e Infinity. */
export function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function isNonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Ventana temporal en minutos: finita, positiva y acotada. */
export function isValidWindowMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1440;
}

/** ¿Es un array de identificadores no vacíos, sin duplicados y acotado? */
export function isIdList(value: unknown, max = 32): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return false;
  if (!value.every(isNonEmptyId)) return false;
  return new Set(value.map((v) => v.trim())).size === value.length;
}

/** Lista de strings saneada y acotada. Cualquier otra cosa produce `[]`. */
export function toBoundedStringList(value: unknown, maxItems = 6, maxLen = 240): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .filter((v) => typeof v === "string" || typeof v === "number")
    .map((v) => String(v).slice(0, maxLen));
}

/** Texto acotado, o `null` si no es un string utilizable. */
export function toBoundedText(value: unknown, maxLen = 500): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length === 0 ? null : t.slice(0, maxLen);
}

/**
 * ¿La lista contiene EXACTAMENTE los elementos esperados, sin faltantes,
 * sobrantes ni duplicados?
 *
 * Sella la frontera de liberación: `["NO_CALIBRATED_THRESHOLD"]` es lo único
 * admisible. Lista vacía, duplicada o con un motivo extra ya no pasa.
 */
export function isExactSet(value: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length !== expected.length) return false;
  if (!value.every((v) => typeof v === "string")) return false;
  const got = [...(value as string[])].sort();
  const want = [...expected].sort();
  return got.every((v, i) => v === want[i]);
}

// Nexus Link · LINK-WA-002 F1a — Parser de exports de WhatsApp Business App.
// PURO (sin IO, sin dependencias de entorno): recibe el texto del export y devuelve
// mensajes normalizados. Formatos soportados (es-AR, fechas dd/mm):
//   iOS     : "[26/7/26, 14:30:12] Juan Pérez: Hola"        (con marcas U+200E/U+200F)
//   Android : "26/7/26 14:30 - Juan Pérez: Hola"
//             "26/07/2026, 2:30 p. m. - Juan Pérez: Hola"
// Multilínea: las líneas que no abren mensaje se anexan al anterior.
// Sistema (sin "Autor: ") y multimedia omitida (D4) se descartan y se CUENTAN.
// Regla de robustez: parse() nunca lanza — lo irreconocible se cuenta en unparsedLines.

export interface WaParsedMessage {
  ts: string; // ISO (hora local del export interpretada como ART)
  author: string;
  text: string;
}

export interface WaParseResult {
  messages: WaParsedMessage[];
  authors: Array<{ name: string; count: number }>;
  firstTs: string | null;
  lastTs: string | null;
  skippedSystem: number;
  skippedMedia: number;
  unparsedLines: number;
}

const INVISIBLES = /[‎‏‪-‮﻿]/g;

// "[26/7/26, 14:30:12] " (iOS) — segundos opcionales.
const IOS_HEADER =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s?m?\.?\]\s?(.*)$/i;
// "26/7/26 14:30 - " · "26/07/2026, 2:30 p. m. - " (Android).
const ANDROID_HEADER =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s?m?\.?\s+-\s(.*)$/i;

const MEDIA_MARKERS = [
  "<multimedia omitido>", "imagen omitida", "video omitido", "audio omitido",
  "sticker omitido", "gif omitido", "documento omitido", "image omitted",
  "video omitted", "audio omitted", "sticker omitted", "document omitted",
];

function isMediaPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (MEDIA_MARKERS.some((m) => t === m || t.startsWith(m))) return true;
  return /\(archivo adjunto\)\s*$/i.test(t);
}

function toIso(
  d: string, mo: string, y: string, h: string, mi: string, s: string | undefined, ampm: string | undefined,
): string | null {
  const day = Number(d); const month = Number(mo);
  let year = Number(y); if (year < 100) year += 2000;
  let hour = Number(h); const min = Number(mi); const sec = s ? Number(s) : 0;
  if (ampm) {
    const p = ampm.toLowerCase();
    if (p === "p" && hour < 12) hour += 12;
    if (p === "a" && hour === 12) hour = 0;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59) return null;
  // Hora local del export = ART (UTC-3) — el canal opera en Argentina.
  const dt = new Date(Date.UTC(year, month - 1, day, hour + 3, min, sec));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

interface HeaderMatch { ts: string; rest: string }

function matchHeader(line: string): HeaderMatch | null {
  for (const re of [IOS_HEADER, ANDROID_HEADER]) {
    const m = line.match(re);
    if (m) {
      const ts = toIso(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
      if (ts) return { ts, rest: m[8] ?? "" };
    }
  }
  return null;
}

export function parseWaExport(raw: string): WaParseResult {
  const result: WaParseResult = {
    messages: [], authors: [], firstTs: null, lastTs: null,
    skippedSystem: 0, skippedMedia: 0, unparsedLines: 0,
  };
  const lines = raw.split(/\r?\n/);
  let current: WaParsedMessage | null = null;

  const flush = () => {
    if (!current) return;
    if (isMediaPlaceholder(current.text)) result.skippedMedia += 1;
    else if (current.text.trim()) result.messages.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(INVISIBLES, "");
    if (!line.trim()) {
      if (current) current.text += "\n";
      continue;
    }
    const header = matchHeader(line);
    if (!header) {
      // Continuación multilínea del mensaje abierto; sin mensaje abierto = irreconocible.
      if (current) current.text += (current.text ? "\n" : "") + line;
      else result.unparsedLines += 1;
      continue;
    }
    flush();
    // "Autor: texto" — sin ese separador es línea de sistema (cifrado, cambios de grupo…).
    const sep = header.rest.indexOf(": ");
    if (sep <= 0) {
      result.skippedSystem += 1;
      continue;
    }
    current = {
      ts: header.ts,
      author: header.rest.slice(0, sep).trim(),
      text: header.rest.slice(sep + 2),
    };
  }
  flush();

  const counts = new Map<string, number>();
  for (const m of result.messages) counts.set(m.author, (counts.get(m.author) ?? 0) + 1);
  result.authors = Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  if (result.messages.length > 0) {
    result.firstTs = result.messages[0].ts;
    result.lastTs = result.messages[result.messages.length - 1].ts;
  }
  return result;
}

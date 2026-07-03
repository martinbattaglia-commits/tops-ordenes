// F5.2-lite · Guardrails del Copilot: redacción PII, delimitación anti-injection,
// truncado de contexto y validación de citas (diseño §8/§10/§12).
// Módulo PURO (sin IO) → testeable unitariamente.

import type { SourceChunk } from "./types";

/** Frase EXACTA de D-F5-6. Único lugar donde vive; prompts y engine la importan. */
export const NO_EVIDENCE =
  "No tengo evidencia suficiente en Nexus para afirmarlo.";

// ── Redacción PII (D-F5-4 / F-01-R) ─────────────────────────────────────────
// Doble red: el catálogo no debería traer PII; si aparece embebida en texto
// libre (mensajes de chat, summaries), se enmascara ANTES del provider y ANTES
// de persistir en auditoría.

const PII_PATTERNS: Array<{ label: string; re: RegExp }> = [
  // CUIT/CUIL 20-12345678-3 (con o sin guiones) — va antes que DNI (lo contiene).
  { label: "cuit", re: /\b(20|23|24|25|26|27|30|33|34)-?\d{8}-?\d\b/g },
  // CBU: 22 dígitos corridos.
  { label: "cbu", re: /\b\d{22}\b/g },
  // Email de terceros.
  { label: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Teléfono AR (+54 …, 11-xxxx-xxxx, etc.): 10+ dígitos con separadores.
  { label: "tel", re: /(?:\+?54[\s.-]?)?(?:9[\s.-]?)?(?:11|[2368]\d{2,3})[\s.-]?\d{3,4}[\s.-]?\d{4}\b/g },
  // DNI: 7-8 dígitos aislados. Puede sobre-redactar números sueltos: tradeoff
  // aceptado y documentado (los public_id INC-/TSK- no matchean).
  { label: "dni", re: /\b\d{7,8}\b/g },
];

export function redactPii(text: string): string {
  let out = text;
  for (const { label, re } of PII_PATTERNS) {
    out = out.replace(re, `[${label} redactado]`);
  }
  return out;
}

// ── Delimitación anti-injection (§8.3) ──────────────────────────────────────
// El contenido de Nexus entra como DATOS dentro de <nexus_source>; se escapan
// los ángulos para que ningún texto pueda cerrar/abrir bloques ni inyectar
// etiquetas. El system prompt ordena tratarlo como datos, y la defensa real es
// estructural: catálogo read-only + RLS (aunque el modelo "obedezca", no puede
// ejecutar nada ni ver datos ajenos).

function escapeAngles(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function chunkToBlock(c: SourceChunk): string {
  const head = `<nexus_source id="${c.sourceId}" entity="${escapeAngles(c.entityType)}"${
    c.publicId ? ` public_id="${escapeAngles(c.publicId)}"` : ""
  }${c.date ? ` ts="${escapeAngles(c.date)}"` : ""}>`;
  const body = escapeAngles(`${c.title}\n${c.excerpt}`);
  return `${head}\n${body}\n</nexus_source>`;
}

/** Arma el contexto delimitado, respetando el tope de caracteres (corte por
 *  chunk completo, nunca a mitad de bloque). Devuelve los chunks que entraron. */
export function buildContext(
  chunks: SourceChunk[],
  maxChars: number
): { context: string; included: SourceChunk[] } {
  const blocks: string[] = [];
  const included: SourceChunk[] = [];
  let used = 0;
  for (const c of chunks) {
    const block = chunkToBlock(c);
    if (used + block.length > maxChars) break;
    blocks.push(block);
    included.push(c);
    used += block.length + 1;
  }
  return { context: blocks.join("\n"), included };
}

// ── Validación de citas (§8 paso 5) ─────────────────────────────────────────

// Bloques de cita: cualquier [...] que contenga al menos un token "S<dígitos>".
// Los modelos reales (p.ej. Gemini) agrupan citas: [S16, S32] o rangos
// [S1-S12, S14, S17-S28]. El parser debe entender todas esas formas — no
// alcanza con [S1] simple (hallazgo de la consulta controlada 2026-07-03).
const CITATION_BLOCK_RE = /\[([^\]]*?S\d[^\]]*?)\]/g;
const CITATION_RANGE_RE = /S(\d+)\s*[-–]\s*S(\d+)/g; // S1-S12
const CITATION_SINGLE_RE = /S(\d+)/g; // S16

/** Extrae todos los sourceIds citados en la respuesta, expandiendo rangos y
 *  grupos dentro de cada bloque [...]. Devuelve ids tipo "S3". */
export function extractCitedIds(answer: string): string[] {
  const ids = new Set<string>();
  for (const block of answer.matchAll(CITATION_BLOCK_RE)) {
    let inner = block[1];
    // 1) rangos S<a>-S<b> → S<a>..S<b> (acotado para no expandir basura).
    for (const r of inner.matchAll(CITATION_RANGE_RE)) {
      const a = Number(r[1]);
      const b = Number(r[2]);
      if (b >= a && b - a <= 200) {
        for (let n = a; n <= b; n++) ids.add(`S${n}`);
      }
    }
    inner = inner.replace(CITATION_RANGE_RE, " ");
    // 2) citas sueltas S<n> restantes.
    for (const s of inner.matchAll(CITATION_SINGLE_RE)) ids.add(`S${s[1]}`);
  }
  return [...ids];
}

export interface CitationCheck {
  valid: boolean;
  /** sourceIds citados que existen. */
  used: string[];
  /** sourceIds citados que NO existen entre los chunks (alucinación de fuente). */
  invalid: string[];
}

export function validateCitations(answer: string, chunks: SourceChunk[]): CitationCheck {
  const known = new Set(chunks.map((c) => c.sourceId));
  const used = new Set<string>();
  const invalid = new Set<string>();
  for (const id of extractCitedIds(answer)) {
    if (known.has(id)) used.add(id);
    else invalid.add(id);
  }
  return { valid: invalid.size === 0, used: [...used], invalid: [...invalid] };
}

/** ¿La respuesta afirma algo de negocio sin citar nada? (meta-charla exenta) */
export function requiresCitation(answer: string): boolean {
  if (answer.trim() === NO_EVIDENCE) return false;
  return extractCitedIds(answer).length === 0;
}

/** Recorte defensivo del input del usuario (no es un límite de UX, es un guard). */
export function sanitizeQuestion(q: string, maxLen = 2000): string {
  return q.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

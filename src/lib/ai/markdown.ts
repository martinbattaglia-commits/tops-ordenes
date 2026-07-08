// Parser de markdown SEGURO y sin dependencias para el narrativo del Copilot
// (round "briefing premium" 2026-07-08). Resuelve el markdown a una estructura
// de bloques + tokens: el componente React (CopilotChat) solo mapea esto a
// elementos, sin dangerouslySetInnerHTML ni HTML crudo (cero XSS). Garantía
// dura: ningún token de texto conserva '**'/'*'/backtick — los asteriscos NUNCA
// se ven. Etiquetas ejecutivas ("Evidencia:", "Recomendación:", "Riesgo:"…) se
// devuelven como bloques/ítems etiquetados para renderizar como badges (FASE F).

// Tonos semánticos (round 16): brand=azul (KPIs/datos), ok=verde (oportunidades),
// warn=ámbar (brechas), danger=rojo (riesgos), action=violeta (recomendaciones/
// decisiones), muted=gris (evidencia/fuentes/notas).
export type BadgeTone = "brand" | "ok" | "warn" | "danger" | "muted" | "action";

export type MdInline =
  | { t: "text"; value: string }
  | { t: "bold"; value: string }
  | { t: "italic"; value: string }
  | { t: "code"; value: string }
  | { t: "link"; value: string; href: string }
  | { t: "cite"; value: string };

export interface MdListItem {
  label?: string;
  tone?: BadgeTone;
  spans: MdInline[];
}

export type MdBlock =
  | { type: "h2" | "h3"; text: string }
  | { type: "p"; spans: MdInline[] }
  | { type: "ul" | "ol"; items: MdListItem[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "label"; label: string; tone: BadgeTone; spans: MdInline[] };

const norm = (t: string): string =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const stripMarks = (s: string): string =>
  s.replace(/\*\*|__/g, "").replace(/[*_`]/g, "").trim();

/** Solo http(s) o ruta interna ('/x'); bloquea javascript:, data:, //host, etc. */
export function sanitizeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (/^\/[^/]/.test(h)) return h;
  return null;
}

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)]+\))|(\[S\d+\])/;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = rest.match(INLINE_RE);
    if (!m || m.index === undefined) {
      out.push({ t: "text", value: rest });
      break;
    }
    if (m.index > 0) out.push({ t: "text", value: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push({ t: "code", value: tok.slice(1, -1) });
    } else if (tok.startsWith("**")) {
      out.push({ t: "bold", value: tok.slice(2, -2) });
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      out.push({ t: "italic", value: tok.slice(1, -1) });
    } else if (/^\[S\d+\]$/.test(tok)) {
      out.push({ t: "cite", value: tok.slice(1, -1) });
    } else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      const href = sanitizeHref(lm[2]);
      // href peligroso → se degrada a texto plano (nunca un <a> inseguro)
      out.push(href ? { t: "link", value: lm[1], href } : { t: "text", value: lm[1] });
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out.filter((t) => !(t.t === "text" && t.value === ""));
}

const LABELS: Array<{ re: RegExp; label: string; tone: BadgeTone }> = [
  { re: /^riesgos?\b/, label: "Riesgo", tone: "danger" },
  { re: /^oportunidad(es)?\b/, label: "Oportunidad", tone: "ok" },
  {
    re: /^(recomendaci(on|ones)|acci(on|ones) recomendad[ao]s?|acci(on|ones)|recomiendo)\b/,
    label: "Acción recomendada",
    tone: "action",
  },
  { re: /^(decision(es)?|proxim[oa]s? pasos?|siguiente paso)\b/, label: "Decisión", tone: "action" },
  { re: /^evidencia\b/, label: "Evidencia", tone: "muted" },
  { re: /^impacto\b/, label: "Impacto", tone: "muted" },
  { re: /^urgencia\b/, label: "Urgencia", tone: "muted" },
  {
    re: /^(brechas?|dato(s)? faltante(s)?|faltan? dato(s)?|dato(s)? que falta)\b/,
    label: "Brecha de datos",
    tone: "warn",
  },
  { re: /^(fuentes?|referencia(s)?)\b/, label: "Fuente", tone: "muted" },
  { re: /^periodo\b/, label: "Período", tone: "brand" },
  { re: /^area\b/, label: "Área", tone: "muted" },
];

/** "Etiqueta: resto" (con o sin negrita) → {label, tone, rest}; si no, null. */
export function detectLabel(raw: string): { label: string; tone: BadgeTone; rest: string } | null {
  const line = raw.trim().replace(/^[-*•]\s+/, "");
  const colon = line.indexOf(":");
  if (colon < 1 || colon > 40) return null;
  let head = line.slice(0, colon);
  let rest = line.slice(colon + 1);
  const labelBold = /^\s*(\*\*|__)/.test(head);
  head = head.replace(/[*_]/g, "").trim();
  if (labelBold) {
    rest = rest.replace(/^\s*(\*\*|__)/, ""); //  **Etiqueta:** contenido
    rest = rest.replace(/(\*\*|__)\s*$/, ""); //  **Etiqueta: contenido**  (negrita envuelve todo)
  }
  rest = rest.trim();
  if (!rest) return null;
  const h = norm(head);
  for (const L of LABELS) if (L.re.test(h)) return { label: L.label, tone: L.tone, rest };
  return null;
}

function toItem(content: string): MdListItem {
  const lab = detectLabel(content);
  if (lab) return { label: lab.label, tone: lab.tone, spans: parseInline(lab.rest) };
  return { spans: parseInline(content) };
}

export function parseBlocks(md: string): MdBlock[] {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: MdListItem[] } | null = null;
  let tbl: string[][] | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", spans: parseInline(para.join(" ").trim()) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };
  const flushTbl = () => {
    if (tbl && tbl.length) {
      const [header, ...rows] = tbl;
      blocks.push({ type: "table", header, rows });
    }
    tbl = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTbl();
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushAll();
      continue;
    }
    // Encabezado ## / ### / ####
    const h = line.match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      flushAll();
      blocks.push({ type: h[1].length === 2 ? "h2" : "h3", text: stripMarks(h[2]) });
      continue;
    }
    // Tabla (fila con pipes); saltar la fila separadora |---|
    if (/^\|.*\|/.test(line)) {
      flushPara();
      flushList();
      if (/^\|[\s:|-]+\|?$/.test(line)) continue;
      (tbl ??= []).push(
        line.replace(/^\||\|$/g, "").split("|").map((c) => stripMarks(c.trim()))
      );
      continue;
    }
    flushTbl();
    // Listas
    const ulm = line.match(/^[-*•]\s+(.*)$/);
    const olm = line.match(/^\d+[.)]\s+(.*)$/);
    if (ulm || olm) {
      flushPara();
      const kind: "ul" | "ol" = olm ? "ol" : "ul";
      if (!list || list.type !== kind) {
        flushList();
        list = { type: kind, items: [] };
      }
      list.items.push(toItem((olm ? olm[1] : ulm![1]).trim()));
      continue;
    }
    flushList();
    // Etiqueta ejecutiva standalone → badge
    const lab = detectLabel(line);
    if (lab) {
      flushPara();
      blocks.push({ type: "label", label: lab.label, tone: lab.tone, spans: parseInline(lab.rest) });
      continue;
    }
    // Subtítulo: línea corta que termina en ':' (sin ':' interno)
    if (/^[^:*|#]{2,80}:$/.test(line)) {
      flushPara();
      blocks.push({ type: "h3", text: stripMarks(line.replace(/:$/, "")) });
      continue;
    }
    // Párrafo (líneas consecutivas se unen)
    para.push(line);
  }
  flushAll();
  return blocks;
}

// ── Round 16 · Agrupación en secciones semánticas (briefing ejecutivo) ───────
// El renderer transforma la lista plana de bloques en un briefing con TÍTULO
// premium + cajas temáticas (resumen, recomendaciones, brechas, fuentes) y
// risk/opportunity CARDS. La lógica de agrupación es pura y testeable; el
// componente React solo mapea el resultado a contenedores con color semántico.

export type SectionVariant =
  | "title"
  | "lead"
  | "summary"
  | "recommendations"
  | "gaps"
  | "sources"
  | "section";

export interface NarrativeSection {
  variant: SectionVariant;
  title: string | null;
  blocks: MdBlock[];
}

/** Clasifica el encabezado de una sección por su significado. */
export function sectionKindOf(text: string): SectionVariant {
  const t = norm(text);
  if (/resumen ejecutivo|sintesis ejecutiva|conclusion general|en resumen/.test(t)) return "summary";
  if (/recomendaci|acciones? recomendad|proximos pasos|plan de accion|que hacer/.test(t))
    return "recommendations";
  if (/brechas?|datos? faltantes?|informacion incompleta|limitacion|que falta|sin (datos|fuente)/.test(t))
    return "gaps";
  if (/fuentes?|referencias|citas/.test(t)) return "sources";
  return "section";
}

/** El primer H2 = título premium; los headings siguientes abren cajas temáticas;
 *  el cuerpo previo a cualquier heading es la sección 'lead'. */
export function groupSections(blocks: MdBlock[]): NarrativeSection[] {
  const sections: NarrativeSection[] = [];
  let cur: NarrativeSection | null = null;
  let titleUsed = false;
  const flush = () => {
    if (cur) {
      sections.push(cur);
      cur = null;
    }
  };
  for (const b of blocks) {
    if (b.type === "h2" || b.type === "h3") {
      flush();
      if (b.type === "h2" && !titleUsed) {
        titleUsed = true;
        sections.push({ variant: "title", title: b.text, blocks: [] });
        continue;
      }
      cur = { variant: sectionKindOf(b.text), title: b.text, blocks: [] };
      continue;
    }
    if (!cur) cur = { variant: "lead", title: null, blocks: [] };
    // Un Riesgo/Oportunidad rompe el resumen/lead y abre su propia sección, para
    // que las cards no queden encajadas dentro de la caja de resumen.
    const isEntity = b.type === "label" && (b.label === "Riesgo" || b.label === "Oportunidad");
    if (isEntity && (cur.variant === "summary" || cur.variant === "lead") && cur.blocks.length > 0) {
      flush();
      cur = { variant: "section", title: null, blocks: [] };
    }
    cur.blocks.push(b);
  }
  flush();
  return sections;
}

export interface EntityCard {
  type: "card";
  tone: BadgeTone;
  label: string;
  title: MdInline[];
  fields: Array<{ label: string; tone: BadgeTone; spans: MdInline[] }>;
}
export type CardOrBlock = MdBlock | EntityCard;

const CARD_ATTR = new Set(["Impacto", "Urgencia", "Evidencia", "Acción recomendada", "Área", "Decisión"]);

/** Un bloque 'label' Riesgo/Oportunidad seguido de sus atributos (Impacto,
 *  Urgencia, Evidencia, Acción…) se agrupa en UNA card. Cualquier otro bloque la
 *  cierra. Los que no forman card pasan tal cual. */
export function groupEntityCards(blocks: MdBlock[]): CardOrBlock[] {
  const out: CardOrBlock[] = [];
  let card: EntityCard | null = null;
  const close = () => {
    if (card) {
      out.push(card);
      card = null;
    }
  };
  for (const b of blocks) {
    if (b.type === "label" && (b.label === "Riesgo" || b.label === "Oportunidad")) {
      close();
      card = { type: "card", tone: b.tone, label: b.label, title: b.spans, fields: [] };
      continue;
    }
    if (card && b.type === "label" && CARD_ATTR.has(b.label)) {
      card.fields.push({ label: b.label, tone: b.tone, spans: b.spans });
      continue;
    }
    close();
    out.push(b);
  }
  close();
  return out;
}

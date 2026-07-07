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
  // CUIT/DNI PUNTUADO: grupos de dígitos separados por . / espacio / - (33.604.896.889,
  // 12.345.678). Exige >=2 grupos de 3 → no pisa precios de miles (1.234). F5.1-b.0 (fix leak).
  { label: "num", re: /\d{1,3}(?:[.\s-]\d{3}){2,}(?:[.\s-]\d{1,3})?/g },
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

/** F5.1-b.0.1.1: ¿la respuesta del modelo es VACÍA (sin contenido citable)? Un
 *  'answered' vacío no es una respuesta — el engine debe degradarlo a NO_EVIDENCE.
 *  (Hallazgo smoke b.0.1: el modelo devolvió answered vacío sin tools ni fuentes.) */
export function isEmptyAnswer(answer: string): boolean {
  return answer.trim().length === 0;
}

// ── Vacío honesto vs fallback anti-alucinación (P1a · fix/f5-2) ──────────────
// El motor colapsaba en UN solo NO_EVIDENCE tres casos distintos: (1) la tool
// corrió y devolvió 0 filas, (2) el modelo no pudo sustanciar, (3) el guard
// degradó. Para (1) — la heladera vacía — el mensaje honesto es "no encontré X
// para esta consulta", NO el fallback genérico. Esto NO relaja el guard: es más
// preciso. Habla de LA CONSULTA (no afirma que no exista nada del dominio con
// otros filtros): el modelo eligió los filtros, así que solo garantizamos que
// ESTA búsqueda determinística no devolvió registros.

const EMPTY_MESSAGE_BY_TOOL: Record<string, string> = {
  incidents_overview: "No encontré incidentes que coincidan con tu consulta en Nexus.",
  tasks_overview: "No encontré tareas que coincidan con tu consulta en Nexus.",
  workflows_stuck: "No encontré workflows trabados que coincidan con tu consulta en Nexus.",
  contracts_overview: "No encontré contratos que coincidan con tu consulta en Nexus.",
  docs_browse: "No encontré documentos ni fichas que coincidan con tu consulta en Nexus.",
  compliance_pending:
    "No encontré documentos ni casos de compliance que coincidan con tu consulta en Nexus.",
  customer_invoices_overview:
    "No encontré facturas emitidas que coincidan con tu consulta en Nexus.",
  supplier_invoices_overview:
    "No encontré facturas de proveedor que coincidan con tu consulta en Nexus.",
  purchase_orders_overview:
    "No encontré órdenes de compra que coincidan con tu consulta en Nexus.",
  suppliers_overview: "No encontré proveedores que coincidan con tu consulta en Nexus.",
  clients_health: "No encontré clientes con incidentes o tareas abiertos en Nexus.",
  ops_digest: "No encontré actividad operativa en Nexus para el período consultado.",
  my_agenda:
    "No tenés incidentes, tareas ni notificaciones pendientes asignadas en Nexus.",
  // fix/f5-2 · analytics + navegación: vacío honesto y ESPECÍFICO (no el genérico).
  billing_summary: "No encontré facturación registrada en Nexus para ese período.",
  bank_balances_overview:
    "No encontré saldos bancarios cargados en Tesorería de Nexus para esa consulta.",
  supplier_spend_overview:
    "No encontré gasto ni presupuesto de proveedores registrado en Nexus para ese período.",
  customer_revenue_overview:
    "No encontré facturación por cliente registrada en Nexus para ese período.",
  revenue_by_category_report:
    "No encontré ingresos registrados en Nexus para ese período (reporte por categoría).",
  nexus_sections_overview: "No encontré una sección de Nexus que coincida con tu consulta.",
  organization_overview: "No encontré ese cargo o persona en el organigrama de Nexus.",
};

/** Mensaje genérico (dominios mixtos, sin tools o tool sin mapa): honesto, no el
 *  fallback anti-alucinación. */
const EMPTY_GENERIC = "No encontré registros en Nexus que coincidan con tu consulta.";

/** P1a: mensaje honesto cuando la(s) tool(s) corrieron y devolvieron 0 filas.
 *  Único dominio → mensaje específico; mixto/desconocido/sin tools → genérico.
 *  Herramientas repetidas (thrashing del modelo) colapsan por `Set`. */
export function emptyResultMessage(toolsUsed: string[]): string {
  const distinct = [...new Set(toolsUsed)];
  if (distinct.length === 1) {
    return EMPTY_MESSAGE_BY_TOOL[distinct[0]] ?? EMPTY_GENERIC;
  }
  return EMPTY_GENERIC;
}

// ── Guard estructural metadata-vs-contenido (F5.1-b.0 · D5 / hallazgo H6) ────
// b.0 proyecta FICHAS DE METADATA de documentos (título, categoría, fechas), NO
// el contenido del PDF. Como esas fichas tienen un `body` citable, una pregunta
// por CONTENIDO matchea una ficha y el guard "cero citas" (engine) NO alcanza:
// el modelo podría presentar la metadata como si fuera el documento.
//
// DISEÑO DEL CONTROL (tras revisión adversarial): FAIL-CLOSED, no denylist de
// verbos (evadible por paráfrasis/inglés). Se degrada a NO_EVIDENCE si la respuesta
// TOCA una ficha (citada o recuperada) y la pregunta NO es claramente de METADATA
// (listado/existencia/vencimiento/estado). Además:
//  - usa `some` (no `every`): citar 1 ficha + 1 evento NO evade el control;
//  - desambigua por OBJETO: "resumime EL CONTRATO" (singular) = contenido; pero
//    "resumime LOS VENCIMIENTOS/DOCUMENTOS" (colección) = metadata → se permite;
//  - normaliza acentos/mayúsculas (sin \b ASCII-only);
//  - fail-closed cubre follow-ups escuetos multi-turno (mejor NO_EVIDENCE que fuga).
// El prefijo [ficha metadata] y el system prompt son defensa en profundidad.

/** entity_types que son FICHAS DE METADATA documental (b.0), no contenido. */
export const METADATA_CARD_ENTITY_TYPES = new Set<string>([
  "compliance_documento",
  "contrato",
]);

const stripAccents = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const includesAny = (haystack: string, needles: string[]): boolean =>
  needles.some((n) => haystack.includes(n));

// Vocabulario INEQUÍVOCO de "contenido del documento" (ES + EN), sobre texto normalizado.
// Incluye conectores de "según el documento" y campos de CONTENIDO (no proyectados como
// metadata): objeto, obligaciones, derechos/deberes, responsabilidad, preaviso, penalidades…
const CONTENT_TERMS = [
  "que dice", "de que trata", "que trata", "de que habla", "que establece", "que estipula", "que dispone",
  "clausula", "obligacion", "penalidad", "multa", "garantia", "cobertura", "responsabilidad",
  "condiciones del", "condiciones contractuales", "termino", "alcance del", "incumplimiento",
  "a que se compromete", "que se compromete", "nos comprometemos", "me comprometo", "comprometemos a",
  "que incluye", "que cubre", "que ampara", "objeto del", "objeto de la", "cada parte",
  "derechos", "deberes", "restriccion", "preaviso", "exige el contrato", "exige el acuerdo",
  "segun el contrato", "segun el acuerdo", "segun lo pactado", "segun el documento", "segun el convenio",
  "lo pactado", "que tiene el contrato", "que tiene el acuerdo", "puntos importantes",
  "contenido", "texto del", "texto completo", "transcrib", "que implica", "puntos clave",
  // F5.1-b.0.1.1 (hardening tras revisión adversarial): verbos de contenido/interpretación
  // por paráfrasis natural que evadían el guard cuando el objeto era "archivo".
  "menciona", "se refiere",
  // smoke 2026-07-07: interpretación condicional/consecuencias = contenido.
  "incumpl", "que pasa si", "segun la plancheta", "segun el plano",
  "monto del", "plazo del", "vigencia del contrato", "que penaliza", "leeme el", "leer el",
  // English
  "summariz", "what does it say", "what says", "the terms", "obligations", "coverage",
  "penalties", "clause", "content of", "what is in", "what's in", "tell me about the contract",
  "break down the contract", "overview of the contract", "this contract about",
];

// Verbos AMBIGUOS: sólo cuentan como contenido si el objeto es un documento SINGULAR.
const AMBIGUOUS_CONTENT_VERBS = ["resum", "detall", "explic", "desarroll", "profundiz"];
const SINGULAR_DOC_OBJECT =
  /\b(el|la|este|esta|ese|esa|del|de la|dicho|dicha|un|una|mi|su)\s+(contrato|documento|poliza|acuerdo|convenio|expediente|certificado|habilitacion|informe|adenda|anexo|reclamo|archivo|plancheta|plano)\b/;

// Señales FUERTES de intención METADATA (listado / existencia / vencimiento / campo
// proyectado poco co-optable). NO se incluyen interrogativos genéricos (cual/cuant/
// cuando/which) ni "fecha"/"organismo": actuaban de llave maestra que permitía filtrar
// contenido formulado como "cuál es… / cuánto… del contrato" (hallazgo re-review). El
// vocabulario de contenido (arriba) tiene prioridad (content OR !meta) y cierra los co-optados.
const METADATA_INTENT_TERMS = [
  "busc", "list", "mostr", "enumera", "encontr", "filtr", "orden",
  // F5.1-b.0.1.2: verbos de RECUPERACIÓN/entrega de un archivo (metadata, no contenido).
  // Sin esto, "dame/me podrías dar el archivo de X" (singular) caía en !meta y el guard lo
  // degradaba aunque docs_browse lo encontrara (hallazgo smoke). El vocabulario de CONTENIDO
  // mantiene prioridad → "dame el RESUMEN / lo que DICE el archivo" sigue degradando.
  "dame", "damelo", "pasame", "traeme", "conseguime", "podrias dar", "me das",
  // smoke 2026-07-07 (4 preguntas reales degradadas): más verbos de RECUPERACIÓN,
  // tipos documentales de plano ('plancheta'/'plano') y la SEDE como señal de
  // recuperación de un documento puntual. El vocabulario de CONTENIDO mantiene
  // prioridad: 'resumime la plancheta' / 'qué dice la habilitación' siguen degradando.
  "puedes dar", "podes dar", "puedo ver", "me consigues",
  "plancheta", "plano de", "plano ",
  "lujan", "magaldi", "3159", "1765",
  " hay", "hay ", "existe", "que documento", "que contrato",
  "documentos", "contratos", "fichas", "polizas", "expedientes", "certificados", "habilitaciones",
  // F5.1-b.0.1.1: "archivos" (PLURAL = listado) como intención metadata. A PROPÓSITO no
  // "archivo" singular: un archivo singular SIN verbo de búsqueda ("el archivo … menciona /
  // según el archivo … / a qué se refiere el archivo") es CONTENIDO y debe degradar (bypass
  // confirmado en revisión adversarial). El plural habilita "cuáles son los archivos de
  // compliance"; "buscame el archivo de X" entra igual por "busc". SINGULAR_DOC_OBJECT
  // incluye "archivo" para que "resumime EL archivo" degrade como contenido.
  "archivos",
  "vencimiento", "vence", "vencer", "vencid", "por vencer", "caduc",
  "estado", "categor", "riesgo", "sede", "deposito", "tipo de documento", "tipo de contrato",
  // F5.1-b.0.1: ESTADO de firma como METADATA (firmado / se firmó), NO el firmante. Preciso
  // A PROPÓSITO (revisión adversarial): participio "firmad(o/a/os)" y reflexivo "se firmó" —
  // NO el presente "firma" ni el adjetivo suelto "vigente", que reabrían "quién firma la
  // habilitación" o "resumime lo vigente". La vigencia como LISTA ya entra por "contratos".
  // El vocabulario de CONTENIDO mantiene prioridad (content OR !meta).
  "firmad", "se firmo",
  // English
  "show", "search", "find", "documents", "contracts", "expir", "due", "status", "list",
];

function isContentIntent(question: string): boolean {
  const q = stripAccents(question);
  if (includesAny(q, CONTENT_TERMS)) return true;
  if (includesAny(q, AMBIGUOUS_CONTENT_VERBS) && SINGULAR_DOC_OBJECT.test(q)) return true;
  return false;
}

function isMetadataIntent(question: string): boolean {
  return includesAny(stripAccents(question), METADATA_INTENT_TERMS);
}

/** ¿La respuesta corre riesgo de presentar METADATA de una ficha como si fuera el
 *  CONTENIDO del documento? Si sí → el engine debe degradar a NO_EVIDENCE (b.0 no
 *  proyecta el texto). Fail-closed. Se evalúa sobre citadas Y recuperadas para no
 *  depender de dónde el modelo puso el [S#]. `retrievedChunks` default = citadas. */
export function isMetadataContentRisk(
  question: string,
  citedChunks: Array<{ entityType: string }>,
  retrievedChunks: Array<{ entityType: string }> = citedChunks
): boolean {
  const citesFicha = citedChunks.some((c) => METADATA_CARD_ENTITY_TYPES.has(c.entityType));
  const retrievedFicha = retrievedChunks.some((c) =>
    METADATA_CARD_ENTITY_TYPES.has(c.entityType)
  );
  const content = isContentIntent(question);
  const meta = isMetadataIntent(question);
  // 1) La respuesta CITA una ficha y NO es claramente metadata → fail-closed.
  if (citesFicha && (content || !meta)) return true;
  // 2) Pregunta de CONTENIDO explícito que RECUPERÓ una ficha (aunque cite otra cosa).
  if (retrievedFicha && content && !meta) return true;
  return false;
}

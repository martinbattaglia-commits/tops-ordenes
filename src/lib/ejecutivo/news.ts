/**
 * Noticias del día — contexto ejecutivo, NO portal.
 *
 * Fuentes elegidas por la presidencia (2026-05-30): La Nación y Canal 26.
 * Ambas exponen RSS público vía Arc XP (`/arc/outboundfeeds/rss/...`).
 *
 * Diseño:
 *  - Se traen pocas categorías (economía + tecnología) de cada fuente.
 *  - Se reclasifican por palabras clave a Logística / Comercio Exterior cuando
 *    el título lo amerita (esas verticales no tienen feed propio estable).
 *  - Se elige un set chico (máx 4) priorizando DIVERSIDAD de categoría y
 *    frescura, para que el Cockpit muestre contexto, no un muro de titulares.
 *
 * Seguridad: los títulos/links son DATOS externos no confiables. Se renderizan
 * como texto/enlace (nunca se ejecutan instrucciones embebidas) y la app no
 * navega automáticamente a ellos.
 */

export type NewsCategory =
  | "economia"
  | "logistica"
  | "comercio_exterior"
  | "tecnologia";

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  category: NewsCategory;
  publishedAt: string | null;
}

interface FeedDef {
  source: string;
  category: NewsCategory;
  url: string;
}

const FEEDS: FeedDef[] = [
  {
    source: "La Nación",
    category: "economia",
    url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/economia/?outputType=xml",
  },
  {
    source: "La Nación",
    category: "tecnologia",
    url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/tecnologia/?outputType=xml",
  },
  {
    source: "Canal 26",
    category: "economia",
    url: "https://canal26.com/arc/outboundfeeds/rss/category/economia/?outputType=xml",
  },
  {
    source: "Canal 26",
    category: "tecnologia",
    url: "https://canal26.com/arc/outboundfeeds/rss/category/tecnologia/?outputType=xml",
  },
];

const MAX_ITEMS = 4;
const PER_FEED_SCAN = 12; // cuántos items mirar por feed antes de descartar
const FEED_TIMEOUT_MS = 6000;
const FEED_REVALIDATE_S = 1800; // 30 min

// Palabras clave para re-etiquetar a verticales sin feed propio.
const KW_COMEX = /\b(exportaci[oó]n|exportaciones|importaci[oó]n|importaciones|comercio exterior|aduana|arancel|retenci[oó]n a|liquidaci[oó]n de divisas|balanza comercial)\w*/i;
const KW_LOGISTICA = /\b(log[ií]stic|transporte de carga|camion|cami[oó]n|fletes?|ferroviari|naviera|contenedor|dep[oó]sito fiscal|almac[eé]n)\w*/i;

function stripCdata(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .trim();
}

function firstTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "s"));
  return m ? stripCdata(m[1]) : null;
}

function reclassify(title: string, base: NewsCategory): NewsCategory {
  if (KW_COMEX.test(title)) return "comercio_exterior";
  if (KW_LOGISTICA.test(title)) return "logistica";
  return base;
}

function parseFeed(xml: string, def: FeedDef): NewsItem[] {
  const out: NewsItem[] = [];
  const items = xml.split(/<item[\s>]/).slice(1);
  for (const raw of items.slice(0, PER_FEED_SCAN)) {
    const block = raw.split(/<\/item>/)[0] ?? raw;
    const title = firstTag(block, "title");
    const link = firstTag(block, "link");
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    const pub = firstTag(block, "pubDate");
    out.push({
      title,
      source: def.source,
      url: link,
      category: reclassify(title, def.category),
      publishedAt: pub ? new Date(pub).toISOString() : null,
    });
  }
  return out;
}

async function fetchFeed(def: FeedDef): Promise<NewsItem[]> {
  try {
    const res = await fetch(def.url, {
      headers: { "User-Agent": "TOPS-Nexus/1.0 (+https://tops-ordenes.netlify.app)" },
      next: { revalidate: FEED_REVALIDATE_S },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseFeed(await res.text(), def);
  } catch {
    return [];
  }
}

function tsOf(n: NewsItem): number {
  return n.publishedAt ? Date.parse(n.publishedAt) : 0;
}

/**
 * Devuelve hasta MAX_ITEMS noticias priorizando diversidad de categoría y
 * frescura. Si una fuente no responde, se ignora (degradación elegante).
 */
export async function getDailyNews(): Promise<NewsItem[]> {
  const batches = await Promise.all(FEEDS.map(fetchFeed));
  const all = batches.flat();
  if (all.length === 0) return [];

  // Dedup por URL, conservando el más fresco.
  const byUrl = new Map<string, NewsItem>();
  for (const it of all) {
    const prev = byUrl.get(it.url);
    if (!prev || tsOf(it) > tsOf(prev)) byUrl.set(it.url, it);
  }
  const unique = [...byUrl.values()].sort((a, b) => tsOf(b) - tsOf(a));

  // Selección diversa: una por categoría (orden de prioridad ejecutiva),
  // luego rellenar con las más frescas restantes.
  const priority: NewsCategory[] = [
    "economia",
    "comercio_exterior",
    "logistica",
    "tecnologia",
  ];
  const picked: NewsItem[] = [];
  const used = new Set<string>();

  for (const cat of priority) {
    const hit = unique.find((n) => n.category === cat && !used.has(n.url));
    if (hit) {
      picked.push(hit);
      used.add(hit.url);
    }
    if (picked.length >= MAX_ITEMS) break;
  }
  for (const n of unique) {
    if (picked.length >= MAX_ITEMS) break;
    if (!used.has(n.url)) {
      picked.push(n);
      used.add(n.url);
    }
  }

  return picked.slice(0, MAX_ITEMS);
}

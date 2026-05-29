import { env } from "@/lib/env";
import { listContacts, listDeals, listPipelines } from "./client";
import {
  mapContact,
  mapDeal,
  mapPipeline,
  type UiContact,
  type UiDeal,
  type UiPipeline,
} from "./mappers";

/**
 * Pipelines visibles en TOPS NEXUS. El tenant tiene 4 pipelines en Clientify
 * pero solo nos interesan estos 3 para operaciones internas.
 * Match case-insensitive contra el nombre del pipeline.
 */
const VISIBLE_PIPELINE_NAMES = new Set([
  "anmat",
  "alquiler de oficinas",
  "carga generales",
  "cargas generales", // tolerante a typo
]);

function isVisiblePipeline(p: UiPipeline): boolean {
  return VISIBLE_PIPELINE_NAMES.has(p.name.trim().toLowerCase());
}

/**
 * Data layer del módulo Comercial: capa pública que las pages consumen.
 * Estrategia:
 *  - Si `CLIENTIFY_API_KEY` está configurada → llama al API real.
 *  - Si no → devuelve null / arrays vacíos (las pages muestran banner "configurá la key").
 *  - Errores HTTP del API se propagan; la page los muestra al usuario.
 */

export interface PipelineSnapshot {
  pipelines: UiPipeline[];
  /** Pipeline activo (default o el primero). */
  active: UiPipeline | null;
  /** Deals del pipeline activo agrupados por stage. */
  dealsByStage: Map<number, UiDeal[]>;
  /** Todos los deals abiertos del tenant (para totales). */
  openDeals: UiDeal[];
  /** Total YTD ganado. */
  wonYtd: number;
  /** Total pipeline activo (sum amount, open). */
  pipelineTotal: number;
  /** Conteo de deals abiertos. */
  openCount: number;
  /** Top deals por amount. */
  topDeals: UiDeal[];
}

export interface ContactsPage {
  contacts: UiContact[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export function clientifyConfigured(): boolean {
  return env.clientify.configured;
}

/**
 * Snapshot del pipeline para la página Comercial.
 * Hace 3 llamadas en paralelo (pipelines + deals open + deals won).
 */
export async function getPipelineSnapshot(pipelineId?: number): Promise<PipelineSnapshot> {
  if (!env.clientify.configured) {
    return {
      pipelines: [],
      active: null,
      dealsByStage: new Map(),
      openDeals: [],
      wonYtd: 0,
      pipelineTotal: 0,
      openCount: 0,
      topDeals: [],
    };
  }

  // 1. Pipelines (siempre pequeño, sin paginar). Filtramos a los que TOPS
  //    realmente opera (excluye "Logistica Tops" que es un pipeline catch-all).
  const pipelinesRes = await listPipelines();
  const allPipelines = pipelinesRes.results.map(mapPipeline);
  const pipelines = allPipelines.filter(isVisiblePipeline);
  const active =
    (pipelineId ? pipelines.find((p) => p.id === pipelineId) : null) ??
    // Default a ANMAT si está disponible (módulo core de TOPS)
    pipelines.find((p) => p.name.toLowerCase() === "anmat") ??
    pipelines.find((p) => p.isDefault) ??
    pipelines[0] ??
    null;

  if (!active) {
    return {
      pipelines,
      active: null,
      dealsByStage: new Map(),
      openDeals: [],
      wonYtd: 0,
      pipelineTotal: 0,
      openCount: 0,
      topDeals: [],
    };
  }

  // 2. Deals del pipeline activo (status=1 → Open). Traemos hasta 200.
  // 3. Deals ganados YTD (status=2). Traemos los más recientes.
  const [openRes, wonRes] = await Promise.all([
    listDeals({ pipeline: active.id, status: 1, page_size: 200, ordering: "-modified" }),
    listDeals({ pipeline: active.id, status: 2, page_size: 200, ordering: "-actual_closed_date" }),
  ]);

  const openDeals = openRes.results.map(mapDeal);
  const wonDeals = wonRes.results.map(mapDeal);

  const dealsByStage = new Map<number, UiDeal[]>();
  for (const d of openDeals) {
    if (d.stageId == null) continue;
    const arr = dealsByStage.get(d.stageId) ?? [];
    arr.push(d);
    dealsByStage.set(d.stageId, arr);
  }

  const yearNow = new Date().getFullYear();
  const wonYtd = wonDeals
    .filter((d) => d.actualClose && new Date(d.actualClose).getFullYear() === yearNow)
    .reduce((a, d) => a + d.amount, 0);

  const pipelineTotal = openDeals.reduce((a, d) => a + d.amount, 0);

  const topDeals = [...openDeals].sort((a, b) => b.amount - a.amount).slice(0, 6);

  return {
    pipelines,
    active,
    dealsByStage,
    openDeals,
    wonYtd,
    pipelineTotal,
    openCount: openDeals.length,
    topDeals,
  };
}

/**
 * Lista de contactos paginada. Devuelve formato UI.
 */
export async function getContactsPage(opts: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<ContactsPage> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 25;

  if (!env.clientify.configured) {
    return { contacts: [], total: 0, page, pageSize, hasNext: false };
  }

  const res = await listContacts({
    page,
    page_size: pageSize,
    search: opts.search,
    ordering: "-modified",
  });

  return {
    contacts: res.results.map(mapContact),
    total: res.count,
    page,
    pageSize,
    hasNext: Boolean(res.next),
  };
}

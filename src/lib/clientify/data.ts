import { env } from "@/lib/env";
import { isVisibleCommercialPipeline } from "@/lib/comercial/pipeline-filter";
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
 * pero solo nos interesan estos 3 para operaciones internas (ANMAT / Cargas
 * Generales / Oficinas). Criterio compartido con CRM360 (fuente única).
 */
function isVisiblePipeline(p: UiPipeline): boolean {
  return isVisibleCommercialPipeline(p.name);
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
  /** Todos los deals del pipeline activo (todas las etapas/estados). */
  openDeals: UiDeal[];
  /** Total YTD ganado. */
  wonYtd: number;
  /** Total del pipeline activo (suma amount de todo el pipeline). */
  pipelineTotal: number;
  /** Conteo de deals del pipeline activo. */
  openCount: number;
  /** Top deals por amount. */
  topDeals: UiDeal[];
  /** CRM-COUNTERS: oportunidades visibles (activas con etapa) por pipeline_id —
   *  para el badge de cada pestaña. Refleja exactamente la suma de las columnas. */
  pipelineCounts: Record<number, number>;
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
      pipelineCounts: {},
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
      pipelineCounts: {},
    };
  }

  // 2. Deals del pipeline activo — TODO el pipeline (todas las etapas y estados),
  //    para reflejar la realidad comercial de Clientify (no solo abiertas).
  //    CRM-C2: filtro server-side por `pipeline_id` (el parámetro correcto; `pipeline`
  //    se ignora y devuelve el tenant completo). Sin filtro de status → pipeline completo.
  const dealsRes = await listDeals({
    pipeline_id: active.id,
    page_size: 200,
    ordering: "-modified",
  });
  const deals = dealsRes.results.map(mapDeal);

  // CRM-C3: el tablero de Clientify muestra SOLO deals activos (oculta Won/Lost
  // y cerrados equivalentes). Columnas y top = activos; header/total = pipeline completo.
  const isActive = (d: UiDeal) => d.status !== "won" && d.status !== "lost";
  const activeDeals = deals.filter(isActive);

  const dealsByStage = new Map<number, UiDeal[]>();
  for (const d of activeDeals) {
    if (d.stageId == null) continue;
    const arr = dealsByStage.get(d.stageId) ?? [];
    arr.push(d);
    dealsByStage.set(d.stageId, arr);
  }

  const yearNow = new Date().getFullYear();
  const wonYtd = deals
    .filter((d) => d.status === "won" && d.actualClose && new Date(d.actualClose).getFullYear() === yearNow)
    .reduce((a, d) => a + d.amount, 0);

  // Total del pipeline = suma de TODO ANMAT (todas las etapas/estados), coherente
  // con el encabezado de Clientify ("Total $ ... (50)").
  const pipelineTotal = deals.reduce((a, d) => a + d.amount, 0);

  // Top oportunidades abiertas = solo activos (excluye Won/Lost).
  const topDeals = [...activeDeals].sort((a, b) => b.amount - a.amount).slice(0, 6);

  // CRM-COUNTERS: badge por pestaña = oportunidades VISIBLES (activas con etapa),
  // exactamente la suma de las columnas del kanban. Reemplaza el conteo previo de
  // ETAPAS (p.stages.length). Para el pipeline activo se reutiliza el fetch ya hecho;
  // para los demás visibles se hace un count liviano por pipeline_id.
  const visibleCount = (ds: UiDeal[]) => ds.filter((d) => isActive(d) && d.stageId != null).length;
  const pipelineCounts: Record<number, number> = {};
  await Promise.all(
    pipelines.map(async (p) => {
      if (p.id === active.id) {
        pipelineCounts[p.id] = visibleCount(deals);
        return;
      }
      try {
        const r = await listDeals({ pipeline_id: p.id, page_size: 200, ordering: "-modified" });
        pipelineCounts[p.id] = visibleCount(r.results.map(mapDeal));
      } catch {
        pipelineCounts[p.id] = 0;
      }
    })
  );

  return {
    pipelines,
    active,
    dealsByStage,
    openDeals: deals,
    wonYtd,
    pipelineTotal,
    openCount: deals.length,
    topDeals,
    pipelineCounts,
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

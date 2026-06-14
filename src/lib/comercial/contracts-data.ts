/**
 * contracts-data.ts — Accesor de la cartera contractual (DB-first).
 *
 * ARQUITECTURA (Addendum): Google Drive es la fuente de verdad operativa; el
 * job diario materializa la cartera en `public.contracts` (+ contract_documents).
 * Por eso este accesor lee SIEMPRE de la base primero y NO usa datasets estáticos
 * para las métricas mientras haya datos persistidos.
 *
 * El seed auditado (`contracts-seed.ts`) queda SÓLO como carga inicial / fallback
 * de arranque: se muestra, claramente marcado «sin sincronizar», cuando la base
 * aún no tiene contratos (p. ej. antes de aplicar 0076/0077 o de la primera
 * sincronización). Una vez poblada la base, las métricas salen de datos reales.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  ContractRecord,
  ContractsPortfolio,
  ContractsSource,
  ContractTipo,
  ContractRiesgo,
  ContractEstado,
  ContractSemaforo,
  ContractMoneda,
} from "./contracts-types";
import { CONTRACTS_SEED, AUDIT_CORTE } from "./contracts-seed";
import { computeAggregates, buildAlerts, diasAVencimiento, mesesRestantes, semaforoFromDays } from "./contracts-engine";
import { getContractsSyncSummary } from "./contracts-sync/read";

/** Columnas leídas de `public.contracts` (incluye origen para el badge del tablero). */
const CONTRACTS_COLUMNS =
  "razon_social,cuit,tipo,canon,moneda,m2,ubicacion,fecha_inicio,fecha_fin," +
  "renovacion_automatica,riesgo,estado,canon_desactualizado,hallazgos,semaforo," +
  "fecha_firma,plazo_meses,preaviso_dias,ajuste,recomendacion,penalidad,source";

interface ContractRow {
  razon_social: string;
  cuit: string | null;
  tipo: ContractTipo;
  canon: number | null;
  moneda: ContractMoneda | null;
  m2: number | null;
  ubicacion: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  renovacion_automatica: boolean | null;
  riesgo: ContractRiesgo;
  estado: ContractEstado;
  canon_desactualizado: boolean | null;
  hallazgos: string | null;
  semaforo: ContractSemaforo | null;
  fecha_firma: string | null;
  plazo_meses: number | null;
  preaviso_dias: number | null;
  ajuste: string | null;
  recomendacion: string | null;
  penalidad: string | null;
  source: string | null;
}

/** Mapea una fila de `contracts` a la forma de la maqueta, recalculando derivados al corte. */
function mapRow(r: ContractRow, corte: string): ContractRecord {
  const dias = diasAVencimiento(r.fecha_fin, corte);
  const semaforo: ContractSemaforo =
    r.semaforo ?? (dias != null ? semaforoFromDays(dias) : "Negro");
  return {
    n: r.razon_social,
    cuit: r.cuit ?? "s/d",
    tipo: r.tipo,
    canon: r.canon,
    mon: r.moneda ?? "ARS",
    m2: r.m2,
    ubic: r.ubicacion ?? "—",
    ini: r.fecha_inicio,
    venc: r.fecha_fin,
    renov: Boolean(r.renovacion_automatica),
    riesgo: r.riesgo,
    estado: r.estado,
    desact: Boolean(r.canon_desactualizado),
    hall: r.hallazgos ?? "—",
    dias_venc: dias,
    meses_rest: mesesRestantes(r.fecha_fin, corte),
    semaforo,
    semaforo_label: "",
    firma: r.fecha_firma ? r.fecha_firma.split("-").reverse().join("/") : "—",
    plazo: r.plazo_meses != null ? `${r.plazo_meses} m` : "—",
    preaviso: r.preaviso_dias != null ? `${r.preaviso_dias} días` : "—",
    ajuste: r.ajuste ?? "—",
    reco: r.recomendacion ?? "—",
    pen: r.penalidad ?? "—",
  };
}

/** Lee la cartera desde la base. Devuelve null si no hay base o la tabla no existe. */
async function readContractsFromDb(corte: string): Promise<{ items: ContractRecord[]; anyDrive: boolean } | null> {
  const sb = createClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from("contracts").select(CONTRACTS_COLUMNS);
    if (error || !data) return null;
    const rows = data as unknown as ContractRow[];
    return {
      items: rows.map((r) => mapRow(r, corte)),
      anyDrive: rows.some((r) => r.source === "drive"),
    };
  } catch {
    return null;
  }
}

/**
 * Cartera completa con agregados, alertas y estado de sincronización a una fecha
 * de corte. DB-first: si la base tiene contratos, las métricas salen de ahí
 * (origen `drive` si hubo sincronización, `db` si no). Si la base está vacía o no
 * disponible, cae a la carga inicial auditada (`audit`).
 */
export async function getContractsPortfolio(corte: string = AUDIT_CORTE): Promise<ContractsPortfolio> {
  const [db, sync] = await Promise.all([readContractsFromDb(corte), getContractsSyncSummary()]);

  if (db && db.items.length > 0) {
    const source: ContractsSource = db.anyDrive ? "drive" : "db";
    return {
      items: db.items,
      aggregates: computeAggregates(db.items, corte),
      alerts: buildAlerts(db.items, corte),
      source,
      corte,
      sync,
    };
  }

  const items = CONTRACTS_SEED;
  return {
    items,
    aggregates: computeAggregates(items, corte),
    alerts: buildAlerts(items, corte),
    source: "audit",
    corte,
    sync,
  };
}

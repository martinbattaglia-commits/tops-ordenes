/**
 * Agregador del Dashboard Ejecutivo (AN-1).
 *
 * Reúne KPIs Tier A (confiables hoy) leyendo EXCLUSIVAMENTE capas de datos ya
 * funcionales — solo lectura, cero escritura, sin recálculo fiscal:
 *   · Financiero  → vistas ERP-A (tesoreria/data.ts)
 *   · Compras     → ERP-B (erp/data.ts + libro-iva-data.ts)
 *   · WMS         → Capacity Engine (wms/corporate-capacity.ts)
 *   · Operaciones → órdenes (data/orders.ts)
 *   · Comercial   → Clientify (clientify/data.ts) — fuente oficial (decisión AN-1)
 *
 * Degradación POR DOMINIO: cada bloque se resuelve con allSettled; el fallo de
 * uno (p. ej. Clientify no configurado) no rompe el resto. Cada bloque informa
 * su `ok` para que la UI muestre el estado real (nunca un cero engañoso).
 *
 * No toca ERP-A/ERP-B; no implementa Tracking, IVA avanzado, Forecast,
 * Rentabilidad ni Incidentes (fuera de alcance AN-1).
 */

import { getBankBalances, getCustomerCurrentAccount, getSupplierCurrentAccount, listCustomerOpenItems, listSupplierOpenItems, getCashflowProjection } from "@/lib/tesoreria/data";
import { listSupplierInvoices } from "@/lib/erp/data";
import { getLibroIvaCompras } from "@/lib/erp/libro-iva-data";
import { getCorporateVacancySummary } from "@/lib/wms/corporate-capacity";
import { listOrders } from "@/lib/data/orders";
import { clientifyConfigured, getPipelineSnapshot, getContactsPage } from "@/lib/clientify/data";

export interface FinancieroKpis {
  ok: boolean;
  cajaTotal: number;
  porCobrar: number;
  porPagar: number;
  cobrosTotal: number;
  pagosTotal: number;
  flujoProyectadoAcumulado: number;
  bancos: { nombre: string; cuenta: string; balance: number }[];
}
export interface ComprasKpis {
  ok: boolean;
  facturasCount: number;
  facturasTotal: number;
  ivaCreditoFiscal: number;
  percepciones: number;
  detalleVacio: boolean; // true si no hay vat_lines (IVA/percep = 0 por falta de OCR)
}
export interface WmsKpis {
  ok: boolean;
  ocupadoM2: number;
  disponibleM2: number;
  comercializableM2: number;
  vacanciaPct: number;
  vacanciaComercialPct: number;
}
export interface OperacionesKpis {
  ok: boolean;
  abiertas: number;
  cerradas: number;
  total: number;
}
export interface ComercialKpis {
  ok: boolean;
  configured: boolean;
  leads: number;
  oportunidades: number;
  pipelineTotal: number;
  ganadoYtd: number;
}

export interface ExecutiveSnapshot {
  financiero: FinancieroKpis;
  compras: ComprasKpis;
  wms: WmsKpis;
  operaciones: OperacionesKpis;
  comercial: ComercialKpis;
  generatedAt: string;
}

function sum(arr: number[]): number {
  return Math.round(arr.reduce((a, b) => a + b, 0) * 100) / 100;
}

// Estados de órdenes: abiertas (en proceso) vs cerradas (firmadas/facturadas).
const OPEN_STATUSES = new Set(["BORRADOR", "PENDIENTE_FIRMA", "EN_CURSO", "OBSERVADA"]);
const CLOSED_STATUSES = new Set(["FIRMADA", "FACTURADA"]);

async function financiero(): Promise<FinancieroKpis> {
  const [balances, custCta, supCta, custOpen, supOpen, cashflow] = await Promise.all([
    getBankBalances(),
    getCustomerCurrentAccount(),
    getSupplierCurrentAccount(),
    listCustomerOpenItems(),
    listSupplierOpenItems(),
    getCashflowProjection(),
  ]);
  const flujo = cashflow.length ? Number(cashflow[cashflow.length - 1].flujo_acumulado) || 0 : 0;
  return {
    ok: true,
    cajaTotal: sum(balances.map((b) => Number(b.balance) || 0)),
    porCobrar: sum(custOpen.map((i) => Number(i.saldo) || 0)),
    porPagar: sum(supOpen.map((i) => Number(i.saldo) || 0)),
    cobrosTotal: sum(custCta.map((c) => Number(c.total_cobrado) || 0)),
    pagosTotal: sum(supCta.map((s) => Number(s.total_pagado) || 0)),
    flujoProyectadoAcumulado: flujo,
    bancos: balances.map((b) => ({ nombre: b.bank_name, cuenta: b.account_name, balance: Number(b.balance) || 0 })),
  };
}

async function compras(): Promise<ComprasKpis> {
  const [inv, libro] = await Promise.all([
    listSupplierInvoices({ pageSize: 1 }),
    getLibroIvaCompras({ limit: 5000 }),
  ]);
  return {
    ok: true,
    facturasCount: inv.counts.todas ?? inv.total ?? 0,
    facturasTotal: Number(inv.sumTotal) || 0,
    ivaCreditoFiscal: libro.kpis.ivaCreditoFiscal,
    percepciones: libro.kpis.percepciones,
    detalleVacio: libro.kpis.cantidadComprobantes === 0,
  };
}

function wms(): WmsKpis {
  // Snapshot vacío: AN-1 no consume crm_* (decisión presidencial). Vacancia física.
  const s = getCorporateVacancySummary({});
  return {
    ok: true,
    ocupadoM2: s.ocupadoM2,
    disponibleM2: s.disponibleM2,
    comercializableM2: s.comercializableM2,
    vacanciaPct: s.vacanciaPct,
    vacanciaComercialPct: s.vacanciaComercialPct,
  };
}

async function operaciones(): Promise<OperacionesKpis> {
  const res = await listOrders({ pageSize: 1 });
  let abiertas = 0;
  let cerradas = 0;
  for (const [status, n] of Object.entries(res.counts)) {
    if (status === "todas") continue;
    if (OPEN_STATUSES.has(status)) abiertas += n as number;
    else if (CLOSED_STATUSES.has(status)) cerradas += n as number;
  }
  return { ok: true, abiertas, cerradas, total: res.counts.todas ?? res.total ?? 0 };
}

async function comercial(): Promise<ComercialKpis> {
  if (!clientifyConfigured()) {
    return { ok: true, configured: false, leads: 0, oportunidades: 0, pipelineTotal: 0, ganadoYtd: 0 };
  }
  const [snap, contacts] = await Promise.all([
    getPipelineSnapshot(),
    getContactsPage({ page: 1, pageSize: 1 }),
  ]);
  return {
    ok: true,
    configured: true,
    leads: contacts.total ?? 0,
    oportunidades: snap.openCount ?? 0,
    pipelineTotal: snap.pipelineTotal ?? 0,
    ganadoYtd: snap.wonYtd ?? 0,
  };
}

const FIN_FAIL: FinancieroKpis = { ok: false, cajaTotal: 0, porCobrar: 0, porPagar: 0, cobrosTotal: 0, pagosTotal: 0, flujoProyectadoAcumulado: 0, bancos: [] };
const COMP_FAIL: ComprasKpis = { ok: false, facturasCount: 0, facturasTotal: 0, ivaCreditoFiscal: 0, percepciones: 0, detalleVacio: true };
const WMS_FAIL: WmsKpis = { ok: false, ocupadoM2: 0, disponibleM2: 0, comercializableM2: 0, vacanciaPct: 0, vacanciaComercialPct: 0 };
const OPS_FAIL: OperacionesKpis = { ok: false, abiertas: 0, cerradas: 0, total: 0 };
const COM_FAIL: ComercialKpis = { ok: false, configured: false, leads: 0, oportunidades: 0, pipelineTotal: 0, ganadoYtd: 0 };

/** Reúne el snapshot ejecutivo; cada dominio degrada de forma independiente. */
export async function getExecutiveSnapshot(): Promise<ExecutiveSnapshot> {
  const [fin, comp, wm, ops, com] = await Promise.allSettled([
    financiero(),
    compras(),
    Promise.resolve(wms()),
    operaciones(),
    comercial(),
  ]);
  return {
    financiero: fin.status === "fulfilled" ? fin.value : FIN_FAIL,
    compras: comp.status === "fulfilled" ? comp.value : COMP_FAIL,
    wms: wm.status === "fulfilled" ? wm.value : WMS_FAIL,
    operaciones: ops.status === "fulfilled" ? ops.value : OPS_FAIL,
    comercial: com.status === "fulfilled" ? com.value : COM_FAIL,
    generatedAt: new Date().toISOString(),
  };
}

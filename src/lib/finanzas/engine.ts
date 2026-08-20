/**
 * Motor de Cálculo Financiero y Reglas Invariantes de Dominio.
 *
 * Invariantes Obligatorias:
 * 1. Cero mutación de hechos de Tesorería.
 * 2. Estricta separación ARS y USD (prohibido sumar monedas distintas sin cotización explícita).
 * 3. Transferencias internas como un único evento de dos patas (origen/destino) sin duplicación.
 * 4. Partidas proyectadas reconciliadas preservan el desvío (fecha/monto estimado vs real).
 * 5. Proyecciones a 13 semanas rodantes (directas).
 */

import type {
  FinanceCurrency,
  FinanceDirection,
  FinanceUnifiedTransaction,
  WeeklyCashflowItem,
  AccountGroupPosition,
  ProfitAndLossStatement,
  BusinessLine,
} from "./types";

/**
 * Validador estricto de multimoneda. Lanza error si se intenta operar entre monedas distintas sin tasa.
 */
export function convertCurrency(
  amount: number,
  fromCurrency: FinanceCurrency,
  toCurrency: FinanceCurrency,
  fxRate?: { rate: number; source: string; timestamp: string }
): { amount: number; fxRateApplied?: number; source?: string; timestamp?: string } {
  if (fromCurrency === toCurrency) {
    return { amount };
  }
  if (!fxRate || !fxRate.rate || fxRate.rate <= 0) {
    throw new Error(
      `INVARIANTE MULTIMONEDA: No se puede convertir de ${fromCurrency} a ${toCurrency} sin una cotización válida, fuente y fecha/hora explícitas.`
    );
  }
  const converted = fromCurrency === "USD" ? amount * fxRate.rate : amount / fxRate.rate;
  return {
    amount: Math.round(converted * 100) / 100,
    fxRateApplied: fxRate.rate,
    source: fxRate.source,
    timestamp: fxRate.timestamp,
  };
}

/**
 * Calcula el flujo de fondos de 13 semanas a partir de la posición inicial y transacciones.
 */
export function calculate13WeekCashflow(
  startDateStr: string,
  initialBalanceArs: number,
  initialBalanceUsd: number,
  transactions: FinanceUnifiedTransaction[]
): WeeklyCashflowItem[] {
  const startDate = new Date(startDateStr);
  const weeks: WeeklyCashflowItem[] = [];

  let currentBalanceArs = initialBalanceArs;
  let currentBalanceUsd = initialBalanceUsd;

  for (let w = 0; w < 13; w++) {
    const wStart = new Date(startDate);
    wStart.setDate(wStart.getDate() + w * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 6);

    const wStartStr = wStart.toISOString().slice(0, 10);
    const wEndStr = wEnd.toISOString().slice(0, 10);

    let inflowsArs = 0;
    let outflowsArs = 0;
    let inflowsUsd = 0;
    let outflowsUsd = 0;

    for (const tx of transactions) {
      if (tx.date >= wStartStr && tx.date <= wEndStr) {
        if (tx.currency === "ARS") {
          if (tx.direction === "ingreso") {
            inflowsArs += tx.amount;
          } else if (tx.direction === "egreso") {
            outflowsArs += tx.amount;
          }
          // Transferencias internas no alteran el neto consolidado de la misma moneda
        } else if (tx.currency === "USD") {
          if (tx.direction === "ingreso") {
            inflowsUsd += tx.amount;
          } else if (tx.direction === "egreso") {
            outflowsUsd += tx.amount;
          }
        }
      }
    }

    const netFlowArs = inflowsArs - outflowsArs;
    const finalBalanceArs = currentBalanceArs + netFlowArs;

    const netFlowUsd = inflowsUsd - outflowsUsd;
    const finalBalanceUsd = currentBalanceUsd + netFlowUsd;

    weeks.push({
      weekNumber: w + 1,
      weekLabel: `Semana ${w + 1} (${wStart.getDate()}/${wStart.getMonth() + 1})`,
      startDate: wStartStr,
      endDate: wEndStr,
      initialBalanceArs: currentBalanceArs,
      inflowsArs,
      outflowsArs,
      netFlowArs,
      finalBalanceArs,
      initialBalanceUsd: currentBalanceUsd,
      inflowsUsd,
      outflowsUsd,
      netFlowUsd,
      finalBalanceUsd,
    });

    currentBalanceArs = finalBalanceArs;
    currentBalanceUsd = finalBalanceUsd;
  }

  return weeks;
}

/**
 * Reconcilia un compromiso proyectado con un movimiento real ejecutado en Tesorería.
 * Preserva la evidencia del desvío sin sobreescribir el hecho real.
 */
export function reconcileProjectionWithFact(
  projection: { id: string; date: string; amount: number; concept: string },
  realFact: { id: string; date: string; amount: number; concept: string }
): {
  matched: boolean;
  varianceAmount: number;
  varianceDays: number;
  desvioStatus: 'exacto' | 'desvio_monto' | 'desvio_fecha' | 'desvio_ambos';
} {
  const pDate = new Date(projection.date);
  const rDate = new Date(realFact.date);
  const diffTime = rDate.getTime() - pDate.getTime();
  const varianceDays = Math.round(diffTime / (1000 * 3600 * 24));
  const varianceAmount = realFact.amount - projection.amount;

  const isAmountDiff = Math.abs(varianceAmount) > 0.01;
  const isDateDiff = varianceDays !== 0;

  let desvioStatus: 'exacto' | 'desvio_monto' | 'desvio_fecha' | 'desvio_ambos' = 'exacto';
  if (isAmountDiff && isDateDiff) desvioStatus = 'desvio_ambos';
  else if (isAmountDiff) desvioStatus = 'desvio_monto';
  else if (isDateDiff) desvioStatus = 'desvio_fecha';

  return {
    matched: true,
    varianceAmount,
    varianceDays,
    desvioStatus,
  };
}

/**
 * Genera el Estado de Resultados (P&L Gerencial) para un período dado.
 */
export function buildProfitAndLoss(
  period: string,
  currency: FinanceCurrency,
  transactions: { categoryCode: string; categoryName: string; categoryType: 'ingreso' | 'egreso'; costCenterLine?: BusinessLine; amount: number; isCostOfService?: boolean }[],
  budgetLines: { categoryCode: string; amount: number }[]
): ProfitAndLossStatement {
  const budgetMap = new Map(budgetLines.map(b => [b.categoryCode, b.amount]));

  const ingresosMap = new Map<string, { name: string; amount: number }>();
  const costosDirectosMap = new Map<string, { name: string; amount: number }>();
  const gastosOperativosMap = new Map<string, { name: string; amount: number }>();

  const lineasMap = new Map<BusinessLine, { ingresos: number; costos: number }>();
  const validLines: BusinessLine[] = ['cargas_generales', 'anmat', 'corporativo', 'almacenamiento', 'distribucion'];
  for (const l of validLines) {
    lineasMap.set(l, { ingresos: 0, costos: 0 });
  }

  for (const tx of transactions) {
    if (tx.categoryType === 'ingreso') {
      const cur = ingresosMap.get(tx.categoryCode) || { name: tx.categoryName, amount: 0 };
      cur.amount += tx.amount;
      ingresosMap.set(tx.categoryCode, cur);

      if (tx.costCenterLine && lineasMap.has(tx.costCenterLine)) {
        const l = lineasMap.get(tx.costCenterLine)!;
        l.ingresos += tx.amount;
      }
    } else {
      // Egreso: clasificar si es costo directo o gasto operativo
      const isDirect = tx.isCostOfService || tx.categoryCode.startsWith('EGR_COMBUSTIBLE') || tx.categoryCode.startsWith('EGR_MANT') || tx.categoryCode.startsWith('EGR_SEGUROS');
      const targetMap = isDirect ? costosDirectosMap : gastosOperativosMap;
      const cur = targetMap.get(tx.categoryCode) || { name: tx.categoryName, amount: 0 };
      cur.amount += tx.amount;
      targetMap.set(tx.categoryCode, cur);

      if (tx.costCenterLine && lineasMap.has(tx.costCenterLine)) {
        const l = lineasMap.get(tx.costCenterLine)!;
        l.costos += tx.amount;
      }
    }
  }

  const mapToCategoryList = (m: Map<string, { name: string; amount: number }>) => {
    return Array.from(m.entries()).map(([code, item]) => {
      const budgetAmount = budgetMap.get(code) || 0;
      return {
        code,
        name: item.name,
        amount: item.amount,
        budgetAmount,
        variance: item.amount - budgetAmount,
      };
    });
  };

  const ingresosList = mapToCategoryList(ingresosMap);
  const totalIngresos = ingresosList.reduce((acc, i) => acc + i.amount, 0);

  const costosList = mapToCategoryList(costosDirectosMap);
  const totalCostos = costosList.reduce((acc, i) => acc + i.amount, 0);

  const margenBruto = totalIngresos - totalCostos;
  const margenBrutoPorcentaje = totalIngresos > 0 ? Math.round((margenBruto / totalIngresos) * 1000) / 10 : 0;

  const gastosList = mapToCategoryList(gastosOperativosMap);
  const totalGastos = gastosList.reduce((acc, i) => acc + i.amount, 0);

  const ebitda = margenBruto - totalGastos;
  const ebitdaPorcentaje = totalIngresos > 0 ? Math.round((ebitda / totalIngresos) * 1000) / 10 : 0;

  const lineaLabels: Record<BusinessLine, string> = {
    cargas_generales: 'Cargas Generales',
    anmat: 'Logística ANMAT Regulada',
    almacenamiento: 'Depósito & M2',
    distribucion: 'Distribución Urbana',
    corporativo: 'Corporativo & General',
  };

  const rentabilidadPorLinea = validLines.map(linea => {
    const data = lineasMap.get(linea)!;
    const margen = data.ingresos - data.costos;
    const margenPorcentaje = data.ingresos > 0 ? Math.round((margen / data.ingresos) * 1000) / 10 : 0;
    return {
      linea,
      label: lineaLabels[linea],
      ingresos: data.ingresos,
      costos: data.costos,
      margen,
      margenPorcentaje,
    };
  });

  return {
    period,
    currency,
    ingresos: { total: totalIngresos, byCategory: ingresosList },
    costosDirectos: { total: totalCostos, byCategory: costosList },
    margenBruto,
    margenBrutoPorcentaje,
    gastosOperativos: { total: totalGastos, byCategory: gastosList },
    ebitda,
    ebitdaPorcentaje,
    rentabilidadPorLinea,
  };
}

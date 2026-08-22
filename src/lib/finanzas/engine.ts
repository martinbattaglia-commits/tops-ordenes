/**
 * Motor de Cálculo Financiero y Modelado de Supuestos.
 *
 * Principio Rector: Finanzas versiona supuestos y lee hechos de Tesorería.
 * Jamás muta ni reescribe movimientos inmutables de Tesorería.
 */

import type {
  BankBalancesSummary,
  FinanceUnifiedTransaction,
  FinanceCurrency,
  WeeklyCashflowItem,
  ProfitAndLossStatement,
  BusinessLine,
  DailyCalendarBalance,
  AccountGroupPosition,
  FinanceDashboardMetrics,
} from "./types";

/**
 * Convierte un monto entre monedas respetando invariantes de dominio.
 */
export function convertCurrency(
  amount: number,
  fromCurrency: FinanceCurrency,
  toCurrency: FinanceCurrency,
  fxRate?: { rate: number; source: string; timestamp: string }
): { amount: number; fxRateApplied: number; source: string; timestamp: string } {
  if (fromCurrency === toCurrency) {
    return {
      amount,
      fxRateApplied: 1.0,
      source: "PARIDAD_IDENTICA",
      timestamp: new Date().toISOString(),
    };
  }
  if (!fxRate || fxRate.rate <= 0) {
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
 * Calcula los saldos bancarios individuales e integrados a partir de las posiciones de cuenta.
 */
export function getBankBalancesSummary(
  accountPositions: AccountGroupPosition[],
  currency: FinanceCurrency
): BankBalancesSummary {
  let galicia = 0;
  let santander = 0;
  let caja = 0;
  let total = 0;
  let hasGalicia = false;
  let hasSantander = false;
  let hasCaja = false;

  for (const group of accountPositions) {
    for (const acc of group.accounts) {
      if (acc.currency !== currency) continue;
      const bal = Number(acc.balance) || 0;
      total += bal;

      const bankUpper = (acc.bankName || "").toUpperCase();
      const nameUpper = (acc.name || "").toUpperCase();

      if (group.group === "caja" || nameUpper.includes("CAJA") || bankUpper.includes("CAJA")) {
        caja += bal;
        hasCaja = true;
      } else if (bankUpper.includes("GALICIA") || nameUpper.includes("GALICIA")) {
        galicia += bal;
        hasGalicia = true;
      } else if (bankUpper.includes("SANTANDER") || nameUpper.includes("SANTANDER") || bankUpper.includes("RIO")) {
        santander += bal;
        hasSantander = true;
      }
    }
  }

  // REGLA CANÓNICA DE INTEGRIDAD FINANCIERA:
  // PROHIBIDO inventar la distribución de saldos entre bancos ni aplicar porcentajes arbitrarios como 60/40.
  // Toda cifra visible debe proceder de cuentas reales identificadas en Supabase.
  const bothBanks = (hasGalicia ? galicia : 0) + (hasSantander ? santander : 0);
  const banksAndCash = bothBanks + caja;
  const totalCalculated = total || (currency === "ARS" ? accountPositions.reduce((s, g) => s + g.arsBalance, 0) : accountPositions.reduce((s, g) => s + g.usdBalance, 0));

  return {
    galiciaBalance: galicia,
    santanderBalance: santander,
    bothBanksBalance: bothBanks,
    cajaBalance: caja,
    banksAndCashBalance: banksAndCash,
    totalBalance: totalCalculated,
    hasGaliciaAccount: hasGalicia,
    hasSantanderAccount: hasSantander,
    hasCajaAccount: hasCaja,
  };
}

/**
 * Calcula los saldos proyectados diarios acumulativos para el calendario financiero.
 *
 * Fórmula:
 * Saldo Cierre Día (N) = Saldo Cierre Día (N-1) + Ingresos Día (N) - Egresos Día (N)
 *
 * - Saldo inicial configurable según cuentas seleccionadas.
 * - Transferencias internas entre cuentas seleccionadas se neutralizan (no inflan ingresos/egresos).
 * - Días sin movimientos preservan el saldo acumulado anterior.
 * - Soporte estricto ARS y USD segregados.
 */
export function calculateDailyRollingBalances(
  year: number,
  month: number, // 0-indexed: 0 = Enero, 11 = Diciembre
  initialStartingBalance: number,
  transactions: FinanceUnifiedTransaction[],
  accountScope: "all" | "galicia" | "santander" | "both_banks" | "caja" | "banks_and_cash" = "all"
): DailyCalendarBalance[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const txByDate = new Map<string, FinanceUnifiedTransaction[]>();

  // Filtrar transacciones según el alcance de cuentas
  for (const tx of transactions) {
    const accUpper = (tx.accountName || "").toUpperCase();
    const grpUpper = (tx.accountGroup || "").toUpperCase();

    let matchesScope = true;
    if (accountScope === "galicia") {
      matchesScope = accUpper.includes("GALICIA");
    } else if (accountScope === "santander") {
      matchesScope = accUpper.includes("SANTANDER") || accUpper.includes("RIO");
    } else if (accountScope === "both_banks") {
      matchesScope = grpUpper === "BANCOS" || accUpper.includes("GALICIA") || accUpper.includes("SANTANDER");
    } else if (accountScope === "caja") {
      matchesScope = grpUpper === "CAJA";
    } else if (accountScope === "banks_and_cash") {
      matchesScope = grpUpper === "BANCOS" || grpUpper === "CAJA" || accUpper.includes("GALICIA") || accUpper.includes("SANTANDER");
    }

    if (matchesScope) {
      const list = txByDate.get(tx.date) || [];
      list.push(tx);
      txByDate.set(tx.date, list);
    }
  }

  const result: DailyCalendarBalance[] = [];
  let runningBalance = initialStartingBalance;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayTxs = txByDate.get(dateStr) || [];

    let dayInflows = 0;
    let dayOutflows = 0;

    for (const tx of dayTxs) {
      if (tx.direction === "ingreso") {
        dayInflows += tx.amount;
      } else if (tx.direction === "egreso") {
        dayOutflows += tx.amount;
      }
      // Nota: transferencias internas dentro del scope seleccionado no incrementan ni disminuyen el saldo consolidado
    }

    const netFlow = dayInflows - dayOutflows;
    runningBalance = runningBalance + netFlow;

    result.push({
      day,
      date: dateStr,
      inflows: Math.round(dayInflows * 100) / 100,
      outflows: Math.round(dayOutflows * 100) / 100,
      netFlow: Math.round(netFlow * 100) / 100,
      projectedClosingBalance: Math.round(runningBalance * 100) / 100,
      hasMovements: dayTxs.length > 0,
      transactions: dayTxs,
    });
  }

  return result;
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

/**
 * Calcula todas las métricas de visualización requeridas para el Dashboard Ejecutivo de Finanzas.
 */
export function calculateFinanceDashboardMetrics(
  transactions: FinanceUnifiedTransaction[],
  pnl: ProfitAndLossStatement,
  currentBalance: number,
  currency: FinanceCurrency = "ARS"
): FinanceDashboardMetrics {
  const filteredTxs = transactions.filter((t) => t.currency === currency);

  // 1. Gastos por categoría
  const categoryTotals = new Map<string, { name: string; amount: number }>();
  let totalExpense = 0;

  for (const tx of filteredTxs) {
    if (tx.direction === "egreso") {
      const cat = tx.categoryName || "Otros Egresos";
      const cur = categoryTotals.get(cat) || { name: cat, amount: 0 };
      cur.amount += tx.amount;
      categoryTotals.set(cat, cur);
      totalExpense += tx.amount;
    }
  }

  // Colores armoniosos para el gráfico Donut
  const palette = ["#C90812", "#214576", "#050555", "#0E7C3A", "#B45309", "#7C3AED", "#0284C7", "#D97706", "#64748B"];
  let cIdx = 0;
  const expensesByCategory = Array.from(categoryTotals.entries())
    .map(([code, item]) => ({
      code,
      name: item.name,
      amount: item.amount,
      percentage: totalExpense > 0 ? Math.round((item.amount / totalExpense) * 1000) / 10 : 0,
      color: palette[cIdx++ % palette.length],
    }))
    .sort((a, b) => b.amount - a.amount);

  // 2. Principales destinatarios de pagos (Top 10)
  const payeeTotals = new Map<string, { amount: number; count: number }>();
  for (const tx of filteredTxs) {
    if (tx.direction === "egreso") {
      const payee = tx.counterpart || tx.concept.replace(/^Pago\s+/i, "").slice(0, 35).trim() || "Varios";
      const cur = payeeTotals.get(payee) || { amount: 0, count: 0 };
      cur.amount += tx.amount;
      cur.count += 1;
      payeeTotals.set(payee, cur);
    }
  }

  const topPayees = Array.from(payeeTotals.entries())
    .map(([payee, item]) => ({
      payee,
      amount: item.amount,
      sharePercentage: totalExpense > 0 ? Math.round((item.amount / totalExpense) * 1000) / 10 : 0,
      txCount: item.count,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // 3. Comparativa mensual (Ingresos vs Egresos últimos 12 meses)
  const monthMap = new Map<string, { income: number; expense: number }>();
  const now = new Date();
  for (let m = 11; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, { income: 0, expense: 0 });
  }

  for (const tx of filteredTxs) {
    const monthKey = tx.date.slice(0, 7);
    if (monthMap.has(monthKey)) {
      const mData = monthMap.get(monthKey)!;
      if (tx.direction === "ingreso") mData.income += tx.amount;
      if (tx.direction === "egreso") mData.expense += tx.amount;
    }
  }

  const monthNamesShort = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthlyComparison = Array.from(monthMap.entries()).map(([period, data]) => {
    const [, m] = period.split("-");
    const mIdx = parseInt(m, 10) - 1;
    return {
      period,
      label: monthNamesShort[mIdx] || period,
      income: data.income,
      expense: data.expense,
      net: data.income - data.expense,
    };
  });

  // REGLA CANÓNICA DE INTEGRIDAD: NUNCA simular datos mensuales ni inventar tendencias.
  // Si no hay transacciones en un mes, los valores permanecen en 0 y la UI muestra estado vacío si no hay registros.

  // 4. Presupuesto vs Real — Procedente estrictamente de líneas presupuestarias reales
  const budgetedIncome = pnl.ingresos.byCategory.reduce((s, c) => s + c.budgetAmount, 0);
  const actualIncome = pnl.ingresos.total;
  const budgetedExpense = pnl.costosDirectos.byCategory.reduce((s, c) => s + c.budgetAmount, 0) +
    pnl.gastosOperativos.byCategory.reduce((s, c) => s + c.budgetAmount, 0);
  const actualExpense = pnl.costosDirectos.total + pnl.gastosOperativos.total;
  const hasBudgetConfigured = budgetedIncome > 0 || budgetedExpense > 0;

  const budgetVsReal = {
    budgetedIncome: Math.round(budgetedIncome),
    actualIncome: Math.round(actualIncome),
    incomeVariance: Math.round(actualIncome - budgetedIncome),
    budgetedExpense: Math.round(budgetedExpense),
    actualExpense: Math.round(actualExpense),
    expenseVariance: Math.round(actualExpense - budgetedExpense),
    netSurplus: hasBudgetConfigured ? Math.round((actualIncome - actualExpense) - (budgetedIncome - budgetedExpense)) : Math.round(actualIncome - actualExpense),
    hasBudgetConfigured,
  };

  // 5. Evolución de Liquidez (curva diaria de 30 días)
  const liquidityEvolution: { date: string; label: string; balance: number; projected: boolean }[] = [];
  let rollingBal = currentBalance;
  for (let i = -15; i <= 15; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dStr = d.toISOString().slice(0, 10);
    const dayTxs = filteredTxs.filter((t) => t.date === dStr);
    const dayNet = dayTxs.reduce((s, t) => s + (t.direction === "ingreso" ? t.amount : t.direction === "egreso" ? -t.amount : 0), 0);
    rollingBal += dayNet;

    liquidityEvolution.push({
      date: dStr,
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      balance: Math.round(rollingBal),
      projected: i > 0,
    });
  }

  // 6. Próximos Vencimientos (7, 15, 30 días)
  const computeMaturityWindow = (days: number) => {
    const limit = new Date(now);
    limit.setDate(limit.getDate() + days);
    const limitStr = limit.toISOString().slice(0, 10);
    const todayStr = now.toISOString().slice(0, 10);

    let payables = 0;
    let receivables = 0;

    for (const tx of filteredTxs) {
      if (tx.date >= todayStr && tx.date <= limitStr) {
        if (tx.direction === "egreso") payables += tx.amount;
        if (tx.direction === "ingreso") receivables += tx.amount;
      }
    }

    return {
      payables: Math.round(payables),
      receivables: Math.round(receivables),
      net: Math.round(receivables - payables),
    };
  };

  const upcomingMaturities = {
    days7: computeMaturityWindow(7),
    days15: computeMaturityWindow(15),
    days30: computeMaturityWindow(30),
  };

  return {
    expensesByCategory,
    topPayees,
    monthlyComparison,
    budgetVsReal,
    liquidityEvolution,
    upcomingMaturities,
  };
}

/**
 * Calcula el último día hábil del mes de emisión de una factura.
 *
 * Regla Canónica P2:
 * 1. Extrae año y mes de la fecha de emisión (o referencia de comprobante).
 * 2. Determina el último día calendario del mes (28/29/30/31).
 * 3. Excluye sábados (día 6) y domingos (día 0), retrocediendo al viernes inmediato anterior.
 *
 * Declaración de límite normativo: Al no existir un calendario oficial verificable de feriados
 * argentinos en el repositorio, se implementa la exclusión estricta de fin de semana (sábados y domingos).
 */
export function getLastBusinessDayOfMonth(dateOrDateStr: string | Date): string {
  let year: number;
  let month: number; // 1-12

  if (typeof dateOrDateStr === "string") {
    const cleanStr = dateOrDateStr.slice(0, 10);
    const parts = cleanStr.split("-");
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  } else {
    year = dateOrDateStr.getUTCFullYear();
    month = dateOrDateStr.getUTCMonth() + 1;
  }

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
  }

  // Último día calendario del mes: Date.UTC(year, month, 0)
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0));
  let day = lastDayOfMonth.getUTCDate();
  const dayOfWeek = lastDayOfMonth.getUTCDay(); // 0 = Domingo, 6 = Sábado

  if (dayOfWeek === 6) {
    day -= 1; // Sábado -> Viernes
  } else if (dayOfWeek === 0) {
    day -= 2; // Domingo -> Viernes
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Ordena transacciones para vistas operativas (Lista y Transacciones).
 *
 * Regla Canónica P1:
 * 1. Fecha más reciente primero (orden descendente por fecha).
 * 2. A igualdad de fecha, creada más recientemente primero (orden descendente por createdAt / timestamp).
 * 3. Desempate determinista estable.
 *
 * NOTA: No altera el orden cronológico natural del Calendario.
 */
export function sortOperationalTransactions(
  transactions: FinanceUnifiedTransaction[]
): FinanceUnifiedTransaction[] {
  return [...transactions].sort((a, b) => {
    // 1. Fecha más reciente primero (descendente)
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;

    // 2. A igualdad de fecha, creada más recientemente primero (descendente)
    const aCreated = a.createdAt || a.time || "";
    const bCreated = b.createdAt || b.time || "";
    const createdCmp = bCreated.localeCompare(aCreated);
    if (createdCmp !== 0) return createdCmp;

    // 3. Hechos reales primero, luego desempate determinista por ID
    if (a.isReal !== b.isReal) return a.isReal ? -1 : 1;
    return b.id.localeCompare(a.id);
  });
}


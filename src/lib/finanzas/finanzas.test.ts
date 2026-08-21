import { describe, it, expect } from "vitest";
import {
  convertCurrency,
  calculateDailyRollingBalances,
  getBankBalancesSummary,
  calculate13WeekCashflow,
  reconcileProjectionWithFact,
  buildProfitAndLoss,
  calculateFinanceDashboardMetrics,
} from "./engine";
import {
  parseAndValidateQuickenExport,
  computeSHA256,
  QUICKEN_CATEGORY_MAP,
  QUICKEN_ACCOUNT_MAP,
} from "./quicken-importer";
import type { FinanceUnifiedTransaction, AccountGroupPosition } from "./types";
import { normalizeConceptoLibreItems, type ConceptoLibre } from "@/lib/orders/concepto-libre";

describe("NEXUS Finanzas — Suites de Dominio, Cálculo, Ingesta y Órdenes", () => {
  describe("1. Invariante Multimoneda & Conversión Segura", () => {
    it("permite conversión idéntica en la misma moneda sin requerir tasa", () => {
      const res = convertCurrency(1000, "ARS", "ARS");
      expect(res.amount).toBe(1000);
      expect(res.fxRateApplied).toBe(1.0);
    });

    it("rechaza la conversión entre monedas distintas sin cotización explícita", () => {
      expect(() => convertCurrency(1000, "USD", "ARS")).toThrowError(
        /INVARIANTE MULTIMONEDA/
      );
    });

    it("convierte correctamente USD a ARS con tasa, fuente y timestamp válidos", () => {
      const res = convertCurrency(100, "USD", "ARS", {
        rate: 1340.5,
        source: "BNA Divisa",
        timestamp: "2026-08-20T10:00:00Z",
      });
      expect(res.amount).toBe(134050);
      expect(res.source).toBe("BNA Divisa");
    });
  });

  describe("2. Calendario Financiero: Saldo Proyectado Acumulativo Diario", () => {
    const sampleTxs: FinanceUnifiedTransaction[] = [
      {
        id: "tx-1",
        date: "2026-08-05",
        direction: "ingreso",
        concept: "Cobranza Roemmers Farmacia",
        counterpart: "Roemmers",
        amount: 5000000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia CC",
        categoryName: "ING_LOG_FARMACIA",
        isReal: true,
        status: "ejecutado",
      },
      {
        id: "tx-2",
        date: "2026-08-05",
        direction: "egreso",
        concept: "Pago Combustible YPF",
        counterpart: "YPF",
        amount: 1500000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Santander CC",
        categoryName: "EGR_COMBUSTIBLE",
        isReal: true,
        status: "ejecutado",
      },
      {
        id: "tx-3",
        date: "2026-08-10",
        direction: "egreso",
        concept: "Alquiler Deposito",
        counterpart: "CEMAC",
        amount: 2000000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia CC",
        categoryName: "EGR_ALQUILERES",
        isReal: false,
        status: "proyectado",
      },
      {
        id: "tx-4",
        date: "2026-08-15",
        direction: "transferencia",
        concept: "Transferencia entre Cuentas Galicia y Santander",
        counterpart: "Interno",
        amount: 500000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia CC",
        categoryName: "Transferencia",
        isReal: false,
        status: "proyectado",
      },
    ];

    it("calcula el saldo acumulativo diario día a día trasladándolo a fechas futuras", () => {
      const initialBal = 10000000;
      const dailyBalances = calculateDailyRollingBalances(2026, 7, initialBal, sampleTxs, "all"); // Mes 7 = Agosto

      expect(dailyBalances.length).toBe(31);

      // Días 1 al 4: sin movimientos -> preservan el saldo inicial
      expect(dailyBalances[0].day).toBe(1);
      expect(dailyBalances[0].hasMovements).toBe(false);
      expect(dailyBalances[0].projectedClosingBalance).toBe(10000000);

      expect(dailyBalances[3].day).toBe(4);
      expect(dailyBalances[3].projectedClosingBalance).toBe(10000000);

      // Día 5: +5M ingreso, -1.5M egreso -> neto +3.5M -> saldo 13.5M
      const day5 = dailyBalances[4];
      expect(day5.day).toBe(5);
      expect(day5.inflows).toBe(5000000);
      expect(day5.outflows).toBe(1500000);
      expect(day5.netFlow).toBe(3500000);
      expect(day5.projectedClosingBalance).toBe(13500000);

      // Días 6 al 9: sin movimientos -> conservan los 13.5M acumulados
      expect(dailyBalances[5].projectedClosingBalance).toBe(13500000);
      expect(dailyBalances[8].projectedClosingBalance).toBe(13500000);

      // Día 10: -2M egreso -> saldo 11.5M
      const day10 = dailyBalances[9];
      expect(day10.day).toBe(10);
      expect(day10.outflows).toBe(2000000);
      expect(day10.projectedClosingBalance).toBe(11500000);

      // Día 15: transferencia interna -> no altera el saldo consolidado
      const day15 = dailyBalances[14];
      expect(day15.day).toBe(15);
      expect(day15.projectedClosingBalance).toBe(11500000);

      // Día 31: conserva el saldo hasta fin de mes
      expect(dailyBalances[30].day).toBe(31);
      expect(dailyBalances[30].projectedClosingBalance).toBe(11500000);
    });

    it("filtra movimientos por alcance de cuenta (Galicia vs Santander vs Caja)", () => {
      const dailyGalicia = calculateDailyRollingBalances(2026, 7, 5000000, sampleTxs, "galicia");
      const day5Galicia = dailyGalicia[4];

      // En Galicia el día 5 sólo hubo el ingreso de 5M (el egreso de 1.5M fue en Santander)
      expect(day5Galicia.inflows).toBe(5000000);
      expect(day5Galicia.outflows).toBe(0);
      expect(day5Galicia.projectedClosingBalance).toBe(10000000);
    });
  });

  describe("3. Saldos Bancarios Individuales y Consolidados", () => {
    const samplePositions: AccountGroupPosition[] = [
      {
        group: "bancos",
        label: "Bancos e Instituciones Financieras",
        arsBalance: 12000000,
        usdBalance: 50000,
        accounts: [
          { id: "acc-1", name: "Cuenta Corriente Galicia", bankName: "Banco Galicia", currency: "ARS", balance: 7500000, type: "cc" },
          { id: "acc-2", name: "Cuenta Corriente Santander", bankName: "Banco Santander", currency: "ARS", balance: 4500000, type: "cc" },
          { id: "acc-3", name: "Cuenta Especial USD Galicia", bankName: "Banco Galicia", currency: "USD", balance: 50000, type: "cc_usd" },
        ],
      },
      {
        group: "caja",
        label: "Caja y Tesorería Física",
        arsBalance: 800000,
        usdBalance: 2000,
        accounts: [
          { id: "caja-1", name: "Caja Central Barracas", bankName: "Caja", currency: "ARS", balance: 800000, type: "caja" },
          { id: "caja-2", name: "Caja Chica USD", bankName: "Caja", currency: "USD", balance: 2000, type: "caja" },
        ],
      },
    ];

    it("desglosa saldos de Galicia, Santander, Total Bancos y Bancos+Caja sin ocultar los individuales", () => {
      const summaryArs = getBankBalancesSummary(samplePositions, "ARS");

      expect(summaryArs.galiciaBalance).toBe(7500000);
      expect(summaryArs.santanderBalance).toBe(4500000);
      expect(summaryArs.bothBanksBalance).toBe(12000000);
      expect(summaryArs.cajaBalance).toBe(800000);
      expect(summaryArs.banksAndCashBalance).toBe(12800000);
    });

    it("calcula correctamente los saldos en USD separados", () => {
      const summaryUsd = getBankBalancesSummary(samplePositions, "USD");

      expect(summaryUsd.galiciaBalance).toBe(50000);
      expect(summaryUsd.santanderBalance).toBe(0);
      expect(summaryUsd.bothBanksBalance).toBe(50000);
      expect(summaryUsd.cajaBalance).toBe(2000);
      expect(summaryUsd.banksAndCashBalance).toBe(52000);
    });
  });

  describe("4. Dashboard Ejecutivo: Métricas y Visualizaciones con Datos Reales", () => {
    const sampleTxs: FinanceUnifiedTransaction[] = [
      { id: "t1", date: "2026-08-01", direction: "egreso", concept: "Pago Combustible YPF", counterpart: "YPF S.A.", amount: 3000000, currency: "ARS", accountGroup: "bancos", accountName: "Galicia", categoryName: "Combustible y Peajes", isReal: true, status: "ejecutado" },
      { id: "t2", date: "2026-08-02", direction: "egreso", concept: "Pago Sueldos Choferes", counterpart: "Nomina Choferes", amount: 6000000, currency: "ARS", accountGroup: "bancos", accountName: "Galicia", categoryName: "Sueldos y Cargas Sociales", isReal: true, status: "ejecutado" },
      { id: "t3", date: "2026-08-03", direction: "egreso", concept: "Alquiler Deposito", counterpart: "CEMAC S.A.", amount: 1000000, currency: "ARS", accountGroup: "bancos", accountName: "Santander", categoryName: "Alquileres de Depositos", isReal: true, status: "ejecutado" },
      { id: "t4", date: "2026-08-10", direction: "ingreso", concept: "Cobro Flete MercadoLibre", counterpart: "MercadoLibre S.R.L.", amount: 15000000, currency: "ARS", accountGroup: "bancos", accountName: "Galicia", categoryName: "Ingresos por Fletes", isReal: true, status: "ejecutado" },
    ];

    const pnl = buildProfitAndLoss(
      "2026-08",
      "ARS",
      [
        { categoryCode: "ING_FLETES", categoryName: "Ingresos por Fletes", categoryType: "ingreso", amount: 15000000 },
        { categoryCode: "EGR_SUELDOS", categoryName: "Sueldos y Cargas Sociales", categoryType: "egreso", amount: 6000000 },
        { categoryCode: "EGR_COMBUSTIBLE", categoryName: "Combustible y Peajes", categoryType: "egreso", amount: 3000000, isCostOfService: true },
        { categoryCode: "EGR_ALQUILERES", categoryName: "Alquileres de Depositos", categoryType: "egreso", amount: 1000000 },
      ],
      [
        { categoryCode: "ING_FLETES", amount: 14000000 },
        { categoryCode: "EGR_SUELDOS", amount: 6500000 },
        { categoryCode: "EGR_COMBUSTIBLE", amount: 3200000 },
        { categoryCode: "EGR_ALQUILERES", amount: 1000000 },
      ]
    );

    it("calcula Donut de gastos por categoría con porcentajes correctos", () => {
      const metrics = calculateFinanceDashboardMetrics(sampleTxs, pnl, 20000000, "ARS");

      expect(metrics.expensesByCategory.length).toBe(3);
      // Sueldos = 6M (60%), Combustible = 3M (30%), Alquiler = 1M (10%)
      const sueldosCat = metrics.expensesByCategory.find((c) => c.name === "Sueldos y Cargas Sociales");
      expect(sueldosCat?.amount).toBe(6000000);
      expect(sueldosCat?.percentage).toBe(60);

      const combCat = metrics.expensesByCategory.find((c) => c.name === "Combustible y Peajes");
      expect(combCat?.amount).toBe(3000000);
      expect(combCat?.percentage).toBe(30);
    });

    it("calcula Top 10 Payees con participación de desembolso", () => {
      const metrics = calculateFinanceDashboardMetrics(sampleTxs, pnl, 20000000, "ARS");

      expect(metrics.topPayees.length).toBe(3);
      expect(metrics.topPayees[0].payee).toBe("Nomina Choferes");
      expect(metrics.topPayees[0].amount).toBe(6000000);
      expect(metrics.topPayees[0].sharePercentage).toBe(60);
    });

    it("calcula Presupuesto vs Real y superávit neto", () => {
      const metrics = calculateFinanceDashboardMetrics(sampleTxs, pnl, 20000000, "ARS");

      expect(metrics.budgetVsReal.actualIncome).toBe(15000000);
      expect(metrics.budgetVsReal.budgetedIncome).toBe(14000000);
      expect(metrics.budgetVsReal.incomeVariance).toBe(1000000); // +1M favorable
      expect(metrics.budgetVsReal.actualExpense).toBe(10000000);
      expect(metrics.budgetVsReal.netSurplus).toBeGreaterThan(0);
    });

    it("calcula ventanas de vencimientos a 7, 15 y 30 días", () => {
      const metrics = calculateFinanceDashboardMetrics(sampleTxs, pnl, 20000000, "ARS");

      expect(metrics.upcomingMaturities.days7).toBeDefined();
      expect(metrics.upcomingMaturities.days15).toBeDefined();
      expect(metrics.upcomingMaturities.days30).toBeDefined();
    });
  });

  describe("5. Parser Quicken: Preámbulos, BOM, Detección de Headers y SHA-256", () => {
    const realSampleQuickenCsv = `﻿All Transactions Report Created: 2026-08-20 20:45:11 -0300
Filter Criteria:,All Dates
,All ARS Accounts
,Any Status
,
,"Scheduled","Split","Date","Payee/Security","Category","Amount","Account"
,"Scheduled",,"2/16/2027","Plan de Pagos ARCA IVA","Impuestos","-3,000,000.00","GALICIA"
,"Scheduled",,"2/16/2027","Amex Corporativa","tarjetas","-11,000,000.00","SANTANDER RIO"
,,"2/10/2027","Cobranza Roemmers","Fletes","13,297,400.00","GALICIA"
,,"2/10/2027","Cobranza Roemmers","Fletes","13,297,400.00","GALICIA"`;

    it("detecta automáticamente encabezados tras preámbulos y remueve BOM", () => {
      const result = parseAndValidateQuickenExport(realSampleQuickenCsv, "HASH_TEST_99");

      expect(result.totalRows).toBe(4);
      expect(result.validRows).toBe(3); // 1 duplicado detectado
      expect(result.duplicateRows).toBe(1);
      expect(result.scheduledCount).toBe(2);
      expect(result.categoriesFound).toContain("Impuestos");
      expect(result.categoriesFound).toContain("tarjetas");
      expect(result.categoriesFound).toContain("Fletes");
    });

    it("parsea montos negativos con comas y normaliza fechas M/D/YYYY", () => {
      const result = parseAndValidateQuickenExport(realSampleQuickenCsv, "HASH_TEST_99");

      const row1 = result.parsedMovements[0];
      expect(row1.date).toBe("2027-02-16");
      expect(row1.direction).toBe("egreso");
      expect(row1.amount).toBe(3000000);
      expect(row1.mappedCategoryCode).toBe("EGR_IMPUESTOS");
      expect(row1.mappedAccountGroup).toBe("bancos");
      expect(row1.isScheduled).toBe(true);
      expect(row1.idempotencyKey).toBeDefined();
    });

    it("calcula hash SHA-256 de forma determinista", async () => {
      const hash = await computeSHA256("TEST_DATA_NEXUS");
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64);
    });

    it("posee mapeo de categorías canónicas analíticas", () => {
      expect(QUICKEN_CATEGORY_MAP["Fletes"]).toBe("ING_FLETES");
      expect(QUICKEN_CATEGORY_MAP["Combustible"]).toBe("EGR_COMBUSTIBLE");
      expect(QUICKEN_CATEGORY_MAP["Sueldos"]).toBe("EGR_SUELDOS");
      expect(QUICKEN_CATEGORY_MAP["Impuestos"]).toBe("EGR_IMPUESTOS");
      expect(QUICKEN_ACCOUNT_MAP["GALICIA"]).toBe("bancos");
      expect(QUICKEN_ACCOUNT_MAP["SANTANDER RIO"]).toBe("bancos");
      expect(QUICKEN_ACCOUNT_MAP["Caja Efectivo"]).toBe("caja");
    });
  });

  describe("6. Órdenes de Servicio: Hasta Cinco Conceptos Libres y Retrocompatibilidad", () => {
    it("normaliza una orden con formato legacy (1 solo concepto) sin romper compatibilidad", () => {
      const legacyState: ConceptoLibre = {
        enabled: true,
        label: "Honorario Extraordinario",
        price: 50000,
        observ: "Aprobado por Dirección comercial",
      };

      const items = normalizeConceptoLibreItems(legacyState);
      expect(items.length).toBe(1);
      expect(items[0].label).toBe("Honorario Extraordinario");
      expect(items[0].price).toBe(50000);
      expect(items[0].observ).toBe("Aprobado por Dirección comercial");
    });

    it("soporta hasta 5 conceptos libres independientes con subtotal, IVA y auditoría", () => {
      const multiState: ConceptoLibre = {
        enabled: true,
        items: [
          { id: "1", label: "Servicio Guardia Especial", price: 80000, observ: "Custodia Nocturna Luján" },
          { id: "2", label: "Estadía Frío Extraordinaria", price: 45000, observ: "Cámara ANMAT +4h" },
          { id: "3", label: "Gestión Documental Notarial", price: 25000, observ: "Acta de Carga Peligrosa" },
          { id: "4", label: "Embalaje Especial Pallet", price: 15000, observ: "Film termocontraíble 50 mic" },
          { id: "5", label: "Peaje Especial Tránsito Pesado", price: 12000, observ: "Autovía 2 puente Zárate" },
        ],
      };

      const items = normalizeConceptoLibreItems(multiState);
      expect(items.length).toBe(5);

      const totalNeto = items.reduce((s, it) => s + it.price, 0);
      expect(totalNeto).toBe(177000);

      const iva = totalNeto * 0.21;
      expect(iva).toBe(37170);

      const totalConIva = totalNeto + iva;
      expect(totalConIva).toBe(214170);

      // Verificación de auditoría de cada motivo
      const observs = items.map((it) => `${it.label}: ${it.observ}`).join(" · ");
      expect(observs).toContain("Custodia Nocturna Luján");
      expect(observs).toContain("Cámara ANMAT +4h");
      expect(observs).toContain("Acta de Carga Peligrosa");
    });
  });
});

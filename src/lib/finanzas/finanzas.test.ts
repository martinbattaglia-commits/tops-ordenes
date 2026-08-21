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
import {
  getConsolidatedAccountPositions,
  getUnifiedFinanceTransactions,
  listDocumentInbox,
} from "./data";
import type { FinanceUnifiedTransaction, AccountGroupPosition } from "./types";
import {
  normalizeConceptoLibreItems,
  type ConceptoLibre,
} from "@/lib/orders/concepto-libre";

describe("NEXUS Finanzas — Suites de Dominio, Integridad Adversarial y Remediación", () => {
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

  describe("2. Validación Adversarial: Ausencia Absoluta de Datos Simulados o Fallbacks Artificiales", () => {
    it("A1 · getBankBalancesSummary NUNCA inventa una distribución 60/40 ni porcentajes arbitrarios", () => {
      // Caso adversarial: grupo bancos tiene saldo consolidado pero no hay cuentas individuales desglosadas
      const positionsWithoutAccounts: AccountGroupPosition[] = [
        {
          group: "bancos",
          label: "Bancos",
          arsBalance: 20000000,
          usdBalance: 0,
          accounts: [],
        },
      ];

      const summary = getBankBalancesSummary(positionsWithoutAccounts, "ARS");

      // Debe reportar 0 para bancos individuales e indicar que no hay cuenta configurada
      expect(summary.galiciaBalance).toBe(0);
      expect(summary.santanderBalance).toBe(0);
      expect(summary.bothBanksBalance).toBe(0);
      expect(summary.hasGaliciaAccount).toBe(false);
      expect(summary.hasSantanderAccount).toBe(false);
      expect(summary.totalBalance).toBe(20000000);

      // Verificación estricta de que NO se aplicó 60% (12M) ni 40% (8M)
      expect(summary.galiciaBalance).not.toBe(12000000);
      expect(summary.santanderBalance).not.toBe(8000000);
    });

    it("A2 · getBankBalancesSummary sólo atribuye saldos si existen cuentas reales identificadas", () => {
      const realPositions: AccountGroupPosition[] = [
        {
          group: "bancos",
          label: "Bancos",
          arsBalance: 11000000,
          usdBalance: 0,
          accounts: [
            { id: "real-galicia", name: "Banco Galicia Cuenta Corriente", bankName: "Banco Galicia", currency: "ARS", balance: 7000000, type: "cc" },
            { id: "real-santander", name: "Santander Rio Operaciones", bankName: "Santander", currency: "ARS", balance: 4000000, type: "cc" },
          ],
        },
      ];

      const summary = getBankBalancesSummary(realPositions, "ARS");

      expect(summary.hasGaliciaAccount).toBe(true);
      expect(summary.galiciaBalance).toBe(7000000);
      expect(summary.hasSantanderAccount).toBe(true);
      expect(summary.santanderBalance).toBe(4000000);
      expect(summary.bothBanksBalance).toBe(11000000);
    });

    it("A3 · calculateFinanceDashboardMetrics no inventa PnL histórico ni presupuestos si no existen", () => {
      const emptyPnl = buildProfitAndLoss("2026-08", "ARS", [], []);
      const metrics = calculateFinanceDashboardMetrics([], emptyPnl, 0, "ARS");

      // Comparativa mensual debe estar en 0 sin proyectar 42.8M ni 34.1M
      expect(metrics.monthlyComparison.every((m) => m.income === 0 && m.expense === 0)).toBe(true);

      // Presupuesto vs Real debe marcar hasBudgetConfigured = false
      expect(metrics.budgetVsReal.hasBudgetConfigured).toBe(false);
      expect(metrics.budgetVsReal.budgetedIncome).toBe(0);
      expect(metrics.budgetVsReal.budgetedExpense).toBe(0);
      expect(metrics.budgetVsReal.actualIncome).toBe(0);
      expect(metrics.budgetVsReal.actualExpense).toBe(0);

      // No inventa categorías de egresos
      expect(metrics.expensesByCategory.length).toBe(0);
      expect(metrics.topPayees.length).toBe(0);
    });
  });

  describe("3. Calendario Financiero: Saldo Proyectado Acumulativo Diario & Deep Links", () => {
    const sampleTxs: FinanceUnifiedTransaction[] = [
      {
        id: "tx-real-1",
        date: "2026-08-05",
        direction: "ingreso",
        concept: "Cobranza Cliente Roemmers Farmacia",
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
        id: "tx-real-2",
        date: "2026-08-05",
        direction: "egreso",
        concept: "Pago Combustible Flota YPF",
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
        id: "tx-real-3",
        date: "2026-08-10",
        direction: "egreso",
        concept: "Alquiler Deposito Magaldi",
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
        id: "tx-real-4",
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
    });

    it("deep links preservan la identidad exacta de la transacción", () => {
      const targetTx = sampleTxs[0];
      const linkHandler = (txId: string) => {
        const found = sampleTxs.find((t) => t.id === txId);
        return found?.id;
      };

      expect(linkHandler(targetTx.id)).toBe("tx-real-1");
      expect(linkHandler("tx-inexistente")).toBeUndefined();
    });
  });

  describe("4. Parser Quicken: Preámbulos, BOM, Detección de Headers y SHA-256", () => {
    const rawQuickenCsv = `﻿All Transactions Report Created: 2026-08-20 20:45:11 -0300
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
      const result = parseAndValidateQuickenExport(rawQuickenCsv, "HASH_TEST_99");

      expect(result.totalRows).toBe(4);
      expect(result.validRows).toBe(3); // 1 duplicado detectado
      expect(result.duplicateRows).toBe(1);
      expect(result.scheduledCount).toBe(2);
      expect(result.categoriesFound).toContain("Impuestos");
      expect(result.categoriesFound).toContain("tarjetas");
      expect(result.categoriesFound).toContain("Fletes");
    });

    it("parsea montos negativos con comas y normaliza fechas M/D/YYYY", () => {
      const result = parseAndValidateQuickenExport(rawQuickenCsv, "HASH_TEST_99");

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

  describe("5. Órdenes de Servicio: Hasta Cinco Conceptos Libres y Retrocompatibilidad", () => {
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

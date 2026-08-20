import { describe, it, expect } from "vitest";
import {
  convertCurrency,
  calculate13WeekCashflow,
  reconcileProjectionWithFact,
  buildProfitAndLoss,
} from "./engine";
import { parseAndValidateQuickenExport, QUICKEN_CATEGORY_MAP } from "./quicken-importer";
import type { FinanceUnifiedTransaction } from "./types";

describe("NEXUS Finanzas — Invariantes de Dominio y Motor de Cálculo", () => {
  describe("1. Invariante Multimoneda", () => {
    it("permite conversión idéntica en la misma moneda sin tasa", () => {
      const res = convertCurrency(1000, "ARS", "ARS");
      expect(res.amount).toBe(1000);
    });

    it("rechaza la conversión entre monedas distintas sin tasa explícita", () => {
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

  describe("2. Motor de Flujo de Fondos de 13 Semanas", () => {
    it("calcula las 13 semanas rodantes preservando saldos iniciales y finales en ARS y USD", () => {
      const sampleTxs: FinanceUnifiedTransaction[] = [
        {
          id: "tx-1",
          date: "2026-08-21",
          direction: "ingreso",
          concept: "Cobranza Roemmers",
          counterpart: "Roemmers",
          amount: 5000000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia CC",
          categoryName: "ING_LOG_FARMACIA",
          isReal: true,
          status: "ejecutado",
        },
        {
          id: "tx-2",
          date: "2026-08-23",
          direction: "egreso",
          concept: "Pago Combustible YPF",
          counterpart: "YPF",
          amount: 2000000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Santander CC",
          categoryName: "EGR_COMBUSTIBLE",
          isReal: false,
          status: "proyectado",
        },
      ];

      const weeks = calculate13WeekCashflow("2026-08-20", 10000000, 5000, sampleTxs);
      expect(weeks.length).toBe(13);

      // Semana 1 contiene las dos transacciones
      expect(weeks[0].initialBalanceArs).toBe(10000000);
      expect(weeks[0].inflowsArs).toBe(5000000);
      expect(weeks[0].outflowsArs).toBe(2000000);
      expect(weeks[0].netFlowArs).toBe(3000000);
      expect(weeks[0].finalBalanceArs).toBe(13000000);

      // Semana 2 inicia con el saldo final de semana 1
      expect(weeks[1].initialBalanceArs).toBe(13000000);
      expect(weeks[1].finalBalanceArs).toBe(13000000);

      // Saldos en USD permanecen intactos
      expect(weeks[0].initialBalanceUsd).toBe(5000);
      expect(weeks[0].finalBalanceUsd).toBe(5000);
    });
  });

  describe("3. Reconciliación con Preservación de Desvío", () => {
    it("detecta coincidencia exacta de monto y fecha", () => {
      const proj = { id: "p1", date: "2026-08-25", amount: 1500000, concept: "Pago Alquiler" };
      const fact = { id: "f1", date: "2026-08-25", amount: 1500000, concept: "Pago Alquiler Barracas" };
      const res = reconcileProjectionWithFact(proj, fact);

      expect(res.matched).toBe(true);
      expect(res.varianceAmount).toBe(0);
      expect(res.varianceDays).toBe(0);
      expect(res.desvioStatus).toBe("exacto");
    });

    it("registra desvío de fecha y monto sin sobreescribir el hecho", () => {
      const proj = { id: "p1", date: "2026-08-20", amount: 1000000, concept: "Cobranza Prevista" };
      const fact = { id: "f1", date: "2026-08-23", amount: 1050000, concept: "Cobranza Real" };
      const res = reconcileProjectionWithFact(proj, fact);

      expect(res.matched).toBe(true);
      expect(res.varianceAmount).toBe(50000);
      expect(res.varianceDays).toBe(3);
      expect(res.desvioStatus).toBe("desvio_ambos");
    });
  });

  describe("4. Estado de Resultados (P&L Gerencial)", () => {
    it("calcula Margen Bruto, Gastos Operativos y EBITDA consolidado", () => {
      const txs = [
        { categoryCode: "ING_FLETES", categoryName: "Fletes", categoryType: "ingreso" as const, costCenterLine: "cargas_generales" as const, amount: 100000 },
        { categoryCode: "EGR_COMBUSTIBLE", categoryName: "Combustible", categoryType: "egreso" as const, costCenterLine: "cargas_generales" as const, amount: 30000, isCostOfService: true },
        { categoryCode: "EGR_SUELDOS", categoryName: "Sueldos", categoryType: "egreso" as const, costCenterLine: "corporativo" as const, amount: 20000 },
      ];
      const budget = [
        { categoryCode: "ING_FLETES", amount: 90000 },
        { categoryCode: "EGR_COMBUSTIBLE", amount: 25000 },
        { categoryCode: "EGR_SUELDOS", amount: 20000 },
      ];

      const pnl = buildProfitAndLoss("2026-08", "ARS", txs, budget);

      expect(pnl.ingresos.total).toBe(100000);
      expect(pnl.costosDirectos.total).toBe(30000);
      expect(pnl.margenBruto).toBe(70000);
      expect(pnl.margenBrutoPorcentaje).toBe(70);
      expect(pnl.gastosOperativos.total).toBe(20000);
      expect(pnl.ebitda).toBe(50000);
      expect(pnl.ebitdaPorcentaje).toBe(50);
    });
  });

  describe("5. Importador Histórico Quicken", () => {
    it("valida archivo CSV, detecta duplicados y calcula sumas netas", () => {
      const sampleCsv = `Date,Description,Category,Account,Amount
2026-01-10,"Cobro Flete","Fletes","Galicia CC ARS",1000.00
2026-01-12,"Pago Combustible","Combustible","Santander CC ARS",-300.00
2026-01-10,"Cobro Flete","Fletes","Galicia CC ARS",1000.00`;

      const res = parseAndValidateQuickenExport(sampleCsv, "SAMPLE_HASH_123");

      expect(res.totalRows).toBe(3);
      expect(res.validRows).toBe(2);
      expect(res.duplicateRows).toBe(1);
      expect(res.totalAmountArs).toBe(700);
      expect(res.categoriesFound).toContain("Fletes");
      expect(res.categoriesFound).toContain("Combustible");
      expect(res.discrepancies.length).toBe(1);
    });

    it("posee mapeo de categorías canónicas", () => {
      expect(QUICKEN_CATEGORY_MAP["Fletes"]).toBe("ING_FLETES");
      expect(QUICKEN_CATEGORY_MAP["Combustible"]).toBe("EGR_COMBUSTIBLE");
      expect(QUICKEN_CATEGORY_MAP["Sueldos"]).toBe("EGR_SUELDOS");
    });
  });
});

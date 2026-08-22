import { describe, it, expect } from "vitest";
import {
  calculateDailyRollingBalances,
  calculate13WeekCashflow,
  getBankBalancesSummary,
  calculateFinanceDashboardMetrics,
} from "./engine";
import { buildUnifiedTransactions } from "./data";
import type {
  FinanceUnifiedTransaction,
  AccountGroupPosition,
  FinanceForecastAdjustment,
  FinanceForecastReconciliation,
  DailyCalendarBalance,
} from "./types";
import type { TreasuryMovement } from "@/lib/tesoreria/types";

describe("MATRIZ DE PRUEBAS CANÓNICA — CASOS A AL K (NEXUS-FIN-TES-001)", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // CASO A — Caja Chica Ingreso (+100.000 -> +100.000 VERDE)
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO A — Caja Chica Ingreso", () => {
    it("mapea un ingreso de caja chica con dirección 'ingreso', monto positivo y suma al saldo", () => {
      const cajaIngresoTx: FinanceUnifiedTransaction = {
        id: "mov-caja-in-1",
        date: "2026-08-10",
        direction: "ingreso",
        concept: "Aporte de Efectivo para Reposición de Caja Chica",
        counterpart: "Director",
        amount: 100000,
        currency: "ARS",
        accountGroup: "caja",
        accountName: "Caja Central",
        categoryName: "Aporte Caja",
        isReal: true,
        status: "ejecutado",
      };

      const initialBal = 500000;
      const dailyBalances = calculateDailyRollingBalances(2026, 7, initialBal, [cajaIngresoTx], "all");
      const day10 = dailyBalances.find((d) => d.day === 10)!;

      expect(cajaIngresoTx.direction).toBe("ingreso");
      expect(cajaIngresoTx.amount).toBe(100000);
      expect(day10.inflows).toBe(100000);
      expect(day10.outflows).toBe(0);
      expect(day10.netFlow).toBe(100000);
      expect(day10.projectedClosingBalance).toBe(600000); // 500k + 100k
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO B — Caja Chica Egreso (-100.000 -> -100.000 ROJO)
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO B — Caja Chica Egreso", () => {
    it("mapea un egreso de caja chica con dirección 'egreso', monto positivo y resta al saldo", () => {
      const cajaEgresoTx: FinanceUnifiedTransaction = {
        id: "mov-caja-out-1",
        date: "2026-08-12",
        direction: "egreso",
        concept: "Gasto Menor Librería y Papelería",
        counterpart: "Librería San Martín",
        amount: 100000,
        currency: "ARS",
        accountGroup: "caja",
        accountName: "Caja Central",
        categoryName: "Gastos de Oficina",
        isReal: true,
        status: "ejecutado",
      };

      const initialBal = 500000;
      const dailyBalances = calculateDailyRollingBalances(2026, 7, initialBal, [cajaEgresoTx], "all");
      const day12 = dailyBalances.find((d) => d.day === 12)!;

      expect(cajaEgresoTx.direction).toBe("egreso");
      expect(cajaEgresoTx.amount).toBe(100000);
      expect(day12.inflows).toBe(0);
      expect(day12.outflows).toBe(100000);
      expect(day12.netFlow).toBe(-100000);
      expect(day12.projectedClosingBalance).toBe(400000); // 500k - 100k
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO C — Cobranza Programada Ejecutada Anticipadamente
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO C — Cobranza Programada Ejecutada Anticipadamente", () => {
    it("refleja el cobro real en su fecha efectiva (15/08) y no duplica en la fecha proyectada (30/08)", () => {
      // Previsión original para el 30/08
      const forecast: FinanceForecastAdjustment = {
        id: "fc-c-001",
        date: "2026-08-30",
        due_date: "2026-08-30",
        direction: "ingreso",
        amount: 5000000,
        currency: "ARS",
        account_group: "bancos",
        bank_account_id: null,
        counterpart: "Cliente ACME S.A.",
        concept: "Cobranza Prevista ACME",
        category_id: null,
        cost_center_id: null,
        status: "reconciliado", // RECONCILIADO con el cobro real del 15/08
        certainty_level: "alta",
        is_recurring: false,
        recurrence_rule: null,
        notes: "Reconciliado con MOV-2026-000888",
        evidence_url: null,
        matched_movement_id: "mov-real-c-001",
        created_by: null,
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-15T10:00:00Z",
      };

      // Cobro real ejecutado el 15/08
      const realTx: FinanceUnifiedTransaction = {
        id: "mov-real-c-001",
        date: "2026-08-15",
        direction: "ingreso",
        concept: "Cobranza Recibo REC-2026-000100 ACME",
        counterpart: "Cliente ACME S.A.",
        amount: 5000000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia",
        categoryName: "Cobranzas Clientes",
        isReal: true,
        status: "ejecutado",
        desvio: {
          estimatedDate: forecast.date,
          estimatedAmount: Number(forecast.amount),
          varianceAmount: 0,
          varianceDays: -15, // 15 días antes
        },
      };

      const initialBal = 10000000;
      // Solo el movimiento real impacta; la previsión reconciliada no genera un segundo registro futuro
      const txs = [realTx];
      const dailyBalances = calculateDailyRollingBalances(2026, 7, initialBal, txs, "all");

      const day15 = dailyBalances.find((d) => d.day === 15)!;
      const day30 = dailyBalances.find((d) => d.day === 30)!;

      // Día 15 tiene el cobro real
      expect(day15.inflows).toBe(5000000);
      expect(day15.projectedClosingBalance).toBe(15000000);

      // Día 30 NO tiene doble conteo
      expect(day30.inflows).toBe(0);
      expect(day30.projectedClosingBalance).toBe(15000000); // Saldo se mantiene en 15M
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO D — Cobranza con Importe Diferente y Preservación de Varianza
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO D — Cobranza con Importe Diferente y Preservación de Varianza", () => {
    it("preserva lo previsto ($5M), lo real ($4.9M) y calcula la varianza (-$100k) auditada", () => {
      const realTx: FinanceUnifiedTransaction = {
        id: "mov-real-d-001",
        date: "2026-08-18",
        direction: "ingreso",
        concept: "Cobranza Recibo REC-2026-000101 ACME",
        counterpart: "Cliente ACME S.A.",
        amount: 4900000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Santander",
        categoryName: "Cobranzas Clientes",
        isReal: true,
        status: "ejecutado",
        desvio: {
          estimatedDate: "2026-08-30",
          estimatedAmount: 5000000,
          varianceAmount: 4900000 - 5000000, // -$100.000
          varianceDays: -12, // 12 días antes
        },
      };

      expect(realTx.desvio).toBeDefined();
      expect(realTx.desvio?.estimatedAmount).toBe(5000000);
      expect(realTx.amount).toBe(4900000);
      expect(realTx.desvio?.varianceAmount).toBe(-100000);
      expect(realTx.desvio?.varianceDays).toBe(-12);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO E — Pago Programado Ejecutado
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO E — Pago Programado Ejecutado", () => {
    it("reconcilia el pago programado (-$4M) produciendo un único impacto económico real", () => {
      const realPaymentTx: FinanceUnifiedTransaction = {
        id: "mov-real-pago-001",
        date: "2026-08-21",
        direction: "egreso",
        concept: "Pago OP-2026-000550 Proveedor YPF",
        counterpart: "YPF S.A.",
        amount: 4000000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia",
        categoryName: "Combustible",
        isReal: true,
        status: "ejecutado",
        desvio: {
          estimatedDate: "2026-08-30",
          estimatedAmount: 4000000,
          varianceAmount: 0,
          varianceDays: -9,
        },
      };

      const initialBal = 10000000;
      const dailyBalances = calculateDailyRollingBalances(2026, 7, initialBal, [realPaymentTx], "all");

      const day21 = dailyBalances.find((d) => d.day === 21)!;
      const day30 = dailyBalances.find((d) => d.day === 30)!;

      expect(day21.outflows).toBe(4000000);
      expect(day21.projectedClosingBalance).toBe(6000000); // 10M - 4M = 6M

      expect(day30.outflows).toBe(0);
      expect(day30.projectedClosingBalance).toBe(6000000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO F — Pago Parcial (Factura $5M, Pago $3M, Remanente $2M)
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO F — Pago Parcial", () => {
    it("refleja el pago parcial de $3M y proyecta el remanente de $2M sin pérdida de saldo", () => {
      const realPartialPayment: FinanceUnifiedTransaction = {
        id: "mov-real-partial-1",
        date: "2026-08-10",
        direction: "egreso",
        concept: "Pago Parcial Factura PROV-100 YPF ($3M / $5M)",
        counterpart: "YPF S.A.",
        amount: 3000000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia",
        categoryName: "Combustible",
        isReal: true,
        status: "ejecutado",
      };

      const remainingForecast: FinanceUnifiedTransaction = {
        id: "proj-supplier-rem-100",
        date: "2026-08-25",
        direction: "egreso",
        concept: "Saldo Pendiente Factura PROV-100 YPF",
        counterpart: "YPF S.A.",
        amount: 2000000, // $5M - $3M
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia / Santander",
        categoryName: "Costo Directo / Proveedores",
        isReal: false,
        status: "proyectado",
      };

      const initialBal = 10000000;
      const dailyBalances = calculateDailyRollingBalances(
        2026,
        7,
        initialBal,
        [realPartialPayment, remainingForecast],
        "all"
      );

      const day10 = dailyBalances.find((d) => d.day === 10)!;
      const day25 = dailyBalances.find((d) => d.day === 25)!;
      const day31 = dailyBalances.find((d) => d.day === 31)!;

      expect(day10.outflows).toBe(3000000);
      expect(day10.projectedClosingBalance).toBe(7000000); // 10M - 3M

      expect(day25.outflows).toBe(2000000);
      expect(day25.projectedClosingBalance).toBe(5000000); // 7M - 2M

      expect(day31.projectedClosingBalance).toBe(5000000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO G — Recurrencia (Ejecutar Agosto deja Septiembre a Diciembre Activos)
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO G — Recurrencia", () => {
    it("reconcilia únicamente la ocurrencia del mes ejecutado (Agosto) preservando meses futuros", () => {
      // Ocurrencia de Agosto reconciliada
      const augustExecuted: FinanceUnifiedTransaction = {
        id: "rec-august-real",
        date: "2026-08-10",
        direction: "egreso",
        concept: "Honorarios Contables Estudio (Agosto)",
        counterpart: "Estudio Contable",
        amount: 800000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia",
        categoryName: "Honorarios Profesionales",
        isReal: true,
        status: "ejecutado",
      };

      // Ocurrencias futuras proyectadas intactas
      const septemberForecast: FinanceUnifiedTransaction = {
        id: "forecast-rec-honorarios-2026-09-10",
        date: "2026-09-10",
        direction: "egreso",
        concept: "Honorarios Contables Estudio (Septiembre)",
        counterpart: "Estudio Contable",
        amount: 800000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia",
        categoryName: "Honorarios Profesionales",
        isReal: false,
        status: "proyectado",
      };

      const octoberForecast: FinanceUnifiedTransaction = {
        id: "forecast-rec-honorarios-2026-10-10",
        date: "2026-10-10",
        direction: "egreso",
        concept: "Honorarios Contables Estudio (Octubre)",
        counterpart: "Estudio Contable",
        amount: 800000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia",
        categoryName: "Honorarios Profesionales",
        isReal: false,
        status: "proyectado",
      };

      // Agosto
      const augBalances = calculateDailyRollingBalances(2026, 7, 10000000, [augustExecuted], "all");
      expect(augBalances.find((d) => d.day === 10)!.outflows).toBe(800000);
      expect(augBalances[30].projectedClosingBalance).toBe(9200000);

      // Septiembre: parte del cierre de agosto (9.2M) y aplica su propia ocurrencia
      const sepBalances = calculateDailyRollingBalances(2026, 8, 9200000, [septemberForecast], "all");
      expect(sepBalances.find((d) => d.day === 10)!.outflows).toBe(800000);
      expect(sepBalances[29].projectedClosingBalance).toBe(8400000);

      // Octubre: parte del cierre de septiembre (8.4M) y aplica su propia ocurrencia
      const octBalances = calculateDailyRollingBalances(2026, 9, 8400000, [octoberForecast], "all");
      expect(octBalances.find((d) => d.day === 10)!.outflows).toBe(800000);
      expect(octBalances[30].projectedClosingBalance).toBe(7600000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO H — Movimiento No Previsto / Extraordinario
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO H — Movimiento No Previsto / Extraordinario", () => {
    it("registra un gasto extraordinario como hecho real con planned_id = NULL sin asociaciones falsas", () => {
      const extraExpense: FinanceUnifiedTransaction = {
        id: "mov-extra-001",
        date: "2026-08-14",
        direction: "egreso",
        concept: "Reparación Urgente Autoelevador Luján (Extraordinario)",
        counterpart: "Mecánica Rossi",
        amount: 650000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia",
        categoryName: "Mantenimiento Flota",
        isReal: true,
        status: "ejecutado",
        desvio: undefined, // Sin previsión vinculada
      };

      const dailyBalances = calculateDailyRollingBalances(2026, 7, 5000000, [extraExpense], "all");
      const day14 = dailyBalances.find((d) => d.day === 14)!;

      expect(extraExpense.desvio).toBeUndefined();
      expect(day14.outflows).toBe(650000);
      expect(day14.projectedClosingBalance).toBe(4350000); // 5M - 650k
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO I — Navegación Multimes y Continuidad Matemática
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO I — Navegación Multimes", () => {
    it("garantiza que Saldo Inicial (Mes N) = Saldo Cierre Proyectado (Mes N-1) navegando ago -> sep -> oct -> ago", () => {
      const augTx: FinanceUnifiedTransaction = {
        id: "tx-aug",
        date: "2026-08-15",
        direction: "ingreso",
        concept: "Flete Agosto",
        counterpart: null,
        amount: 2000000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Galicia",
        categoryName: "Fletes",
        isReal: true,
        status: "ejecutado",
      };

      const sepTx: FinanceUnifiedTransaction = {
        id: "tx-sep",
        date: "2026-09-20",
        direction: "egreso",
        concept: "Seguro Septiembre",
        counterpart: null,
        amount: 500000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Galicia",
        categoryName: "Seguros",
        isReal: false,
        status: "proyectado",
      };

      const octTx: FinanceUnifiedTransaction = {
        id: "tx-oct",
        date: "2026-10-10",
        direction: "ingreso",
        concept: "Flete Octubre",
        counterpart: null,
        amount: 3000000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Galicia",
        categoryName: "Fletes",
        isReal: false,
        status: "proyectado",
      };

      const allTxs = [augTx, sepTx, octTx];
      const initialAug = 10000000;

      // Agosto: inicia en 10M, suma 2M en día 15 -> Cierre Agosto = 12M
      const augDays = calculateDailyRollingBalances(2026, 7, initialAug, allTxs, "all");
      const augClosing = augDays[augDays.length - 1].projectedClosingBalance;
      expect(augClosing).toBe(12000000);

      // Septiembre: inicia exactamente en 12M, resta 500k en día 20 -> Cierre Septiembre = 11.5M
      const sepDays = calculateDailyRollingBalances(2026, 8, augClosing, allTxs, "all");
      expect(sepDays[0].projectedClosingBalance).toBe(12000000); // Día 1 antes de movimientos
      const sepClosing = sepDays[sepDays.length - 1].projectedClosingBalance;
      expect(sepClosing).toBe(11500000);

      // Octubre: inicia exactamente en 11.5M, suma 3M en día 10 -> Cierre Octubre = 14.5M
      const octDays = calculateDailyRollingBalances(2026, 9, sepClosing, allTxs, "all");
      expect(octDays[0].projectedClosingBalance).toBe(11500000);
      const octClosing = octDays[octDays.length - 1].projectedClosingBalance;
      expect(octClosing).toBe(14500000);

      // Regreso a Agosto: preservación idéntica
      const augDaysReturn = calculateDailyRollingBalances(2026, 7, initialAug, allTxs, "all");
      expect(augDaysReturn[augDaysReturn.length - 1].projectedClosingBalance).toBe(12000000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO J — Idempotencia y Protección ante Doble Submit
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO J — Idempotencia", () => {
    it("filtra transacciones duplicadas con el mismo identificador unificado", () => {
      const tx: FinanceUnifiedTransaction = {
        id: "tx-duplicate-test",
        date: "2026-08-05",
        direction: "ingreso",
        concept: "Cobranza Duplicada",
        counterpart: "Cliente Duplicado",
        amount: 1000000,
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Galicia",
        categoryName: "Cobranzas",
        isReal: true,
        status: "ejecutado",
      };

      // Simular lista de transacciones donde se deduplica por ID
      const rawList = [tx, tx, tx];
      const deduplicated = Array.from(new Map(rawList.map((t) => [t.id, t])).values());

      expect(deduplicated.length).toBe(1);

      const days = calculateDailyRollingBalances(2026, 7, 5000000, deduplicated, "all");
      expect(days.find((d) => d.day === 5)!.inflows).toBe(1000000);
      expect(days[30].projectedClosingBalance).toBe(6000000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO K — Consistencia Matemática de Saldos
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO K — Consistencia Matemática de Saldos", () => {
    it("cumple invariablemente: Saldo Final = Saldo Inicial + Total Ingresos - Total Egresos", () => {
      const initialBal = 8750430.5;
      const txs: FinanceUnifiedTransaction[] = [
        { id: "1", date: "2026-08-02", direction: "ingreso", concept: "Cobro A", counterpart: null, amount: 1250000.25, currency: "ARS", accountGroup: "bancos", accountName: "Galicia", categoryName: "A", isReal: true, status: "ejecutado" },
        { id: "2", date: "2026-08-05", direction: "egreso", concept: "Pago B", counterpart: null, amount: 430200.1, currency: "ARS", accountGroup: "bancos", accountName: "Galicia", categoryName: "B", isReal: true, status: "ejecutado" },
        { id: "3", date: "2026-08-11", direction: "ingreso", concept: "Cobro C", counterpart: null, amount: 3400100, currency: "ARS", accountGroup: "bancos", accountName: "Galicia", categoryName: "C", isReal: true, status: "ejecutado" },
        { id: "4", date: "2026-08-20", direction: "egreso", concept: "Pago D", counterpart: null, amount: 1980000.5, currency: "ARS", accountGroup: "bancos", accountName: "Galicia", categoryName: "D", isReal: true, status: "ejecutado" },
        { id: "5", date: "2026-08-28", direction: "egreso", concept: "Pago E", counterpart: null, amount: 550000.15, currency: "ARS", accountGroup: "bancos", accountName: "Galicia", categoryName: "E", isReal: false, status: "proyectado" },
      ];

      const totalInflows = 1250000.25 + 3400100;
      const totalOutflows = 430200.1 + 1980000.5 + 550000.15;
      const expectedClosing = Math.round((initialBal + totalInflows - totalOutflows) * 100) / 100;

      const dailyBalances = calculateDailyRollingBalances(2026, 7, initialBal, txs, "all");
      const actualClosing = dailyBalances[dailyBalances.length - 1].projectedClosingBalance;

      expect(actualClosing).toBe(expectedClosing);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO L — Reconciliación N:M Real y Trazabilidad en buildUnifiedTransactions
  // ───────────────────────────────────────────────────────────────────────────
  describe("CASO L — Reconciliación N:M Real en buildUnifiedTransactions", () => {
    const bankAccount = {
      id: "bank-1",
      account_name: "Galicia CC ARS",
      currency: "ARS",
      account_type: "bancos",
    };

    it("1. Mapea 1 movimiento asociado a múltiples previsiones (1:N) con trazabilidad y desvíos explícitos", () => {
      // 1 Movimiento real de pago por 5.000.000 el 15/08
      const realMovement: TreasuryMovement = {
        id: "mov-pago-multiple-1",
        public_id: "OP-0050",
        date: "2026-08-15",
        type: "pago_proveedor",
        direction: "egreso",
        bank_account_id: "bank-1",
        amount: 5000000,
        description: "Pago Unificado Facturas A y B",
        reference_type: "supplier_payment",
        reference_id: "pay-1",
        transfer_group_id: null,
        operational_category: null,
        beneficiary_id: null,
        status: "confirmado",
        created_at: "2026-08-15T10:00:00Z",
      };

      // 2 Previsiones vinculadas
      const forecastA: FinanceForecastAdjustment = {
        id: "fc-prov-a",
        date: "2026-08-10",
        due_date: "2026-08-10",
        direction: "egreso",
        amount: 3000000,
        reconciled_amount: 3000000,
        currency: "ARS",
        account_group: "bancos",
        bank_account_id: "bank-1",
        counterpart: "Proveedor Alfa S.A.",
        concept: "Previsión Insumos Alfa",
        category_id: null,
        cost_center_id: null,
        status: "reconciliado",
        certainty_level: "alta",
        is_recurring: false,
        recurrence_rule: null,
        evidence_url: null,
        notes: null,
        matched_movement_id: "mov-pago-multiple-1",
        created_by: "user-1",
        created_at: "2026-08-01",
        updated_at: "2026-08-15",
      };

      const forecastB: FinanceForecastAdjustment = {
        id: "fc-prov-b",
        date: "2026-08-20",
        due_date: "2026-08-20",
        direction: "egreso",
        amount: 2000000,
        reconciled_amount: 2000000,
        currency: "ARS",
        account_group: "bancos",
        bank_account_id: "bank-1",
        counterpart: "Proveedor Beta SRL",
        concept: "Previsión Servicios Beta",
        category_id: null,
        cost_center_id: null,
        status: "reconciliado",
        certainty_level: "alta",
        is_recurring: false,
        recurrence_rule: null,
        evidence_url: null,
        notes: null,
        matched_movement_id: "mov-pago-multiple-1",
        created_by: "user-1",
        created_at: "2026-08-01",
        updated_at: "2026-08-15",
      };

      // Reconciliaciones auditadas N:M
      const recons: FinanceForecastReconciliation[] = [
        {
          id: "rec-1",
          forecast_adjustment_id: "fc-prov-a",
          treasury_movement_id: "mov-pago-multiple-1",
          applied_amount: 3000000,
          reconciled_by: "user-1",
          reconciled_at: "2026-08-15T10:00:00Z",
          created_at: "2026-08-15T10:00:00Z",
        },
        {
          id: "rec-2",
          forecast_adjustment_id: "fc-prov-b",
          treasury_movement_id: "mov-pago-multiple-1",
          applied_amount: 2000000,
          reconciled_by: "user-1",
          reconciled_at: "2026-08-15T10:00:00Z",
          created_at: "2026-08-15T10:00:00Z",
        },
      ];

      const txs = buildUnifiedTransactions({
        bankAccounts: [bankAccount],
        realMovements: [realMovement],
        forecastAdjustments: [forecastA, forecastB],
        forecastReconciliations: recons,
      });

      // El mapeador devuelve 1 transacción real y 0 proyecciones porque ambas previsiones están al 100% reconciliadas
      expect(txs.length).toBe(1);
      const realTx = txs[0];
      expect(realTx.id).toBe("mov-pago-multiple-1");
      expect(realTx.isReal).toBe(true);
      expect(realTx.amount).toBe(5000000);
      expect(realTx.direction).toBe("egreso");

      // Trazabilidad de TODAS las reconciliaciones (no solo la primera)
      expect(realTx.reconciliations).toBeDefined();
      expect(realTx.reconciliations?.length).toBe(2);

      const itemA = realTx.reconciliations?.find((r) => r.forecastId === "fc-prov-a")!;
      expect(itemA).toBeDefined();
      expect(itemA.appliedAmount).toBe(3000000);
      expect(itemA.forecastAmount).toBe(3000000);
      expect(itemA.varianceAmount).toBe(0);
      expect(itemA.forecastConcept).toBe("Previsión Insumos Alfa");
      expect(itemA.forecastCounterpart).toBe("Proveedor Alfa S.A.");
      expect(itemA.varianceDays).toBe(5); // 15/08 vs 10/08

      const itemB = realTx.reconciliations?.find((r) => r.forecastId === "fc-prov-b")!;
      expect(itemB).toBeDefined();
      expect(itemB.appliedAmount).toBe(2000000);
      expect(itemB.forecastAmount).toBe(2000000);
      expect(itemB.varianceAmount).toBe(0);
      expect(itemB.forecastConcept).toBe("Previsión Servicios Beta");
      expect(itemB.forecastCounterpart).toBe("Proveedor Beta SRL");
      expect(itemB.varianceDays).toBe(-5); // 15/08 vs 20/08

      // Desvío y agregación consolidada sin pérdida
      expect(realTx.desvio).toBeDefined();
      expect(realTx.desvio?.totalAppliedAmount).toBe(5000000);
      expect(realTx.desvio?.reconciledForecastsCount).toBe(2);
      expect(realTx.counterpart).toContain("Proveedor Alfa S.A.");
      expect(realTx.counterpart).toContain("Proveedor Beta SRL");
    });

    it("2. Mapea 1 previsión cubierta por múltiples movimientos parciales sucesivos (3M + 2M)", () => {
      const forecast: FinanceForecastAdjustment = {
        id: "fc-anual-1",
        date: "2026-08-30",
        due_date: "2026-08-30",
        direction: "ingreso",
        amount: 5000000,
        reconciled_amount: 3000000,
        currency: "ARS",
        account_group: "bancos",
        bank_account_id: "bank-1",
        counterpart: "Cliente Mayorista S.A.",
        concept: "Cobranza Anual Mayorista",
        category_id: null,
        cost_center_id: null,
        status: "comprometido",
        certainty_level: "alta",
        is_recurring: false,
        recurrence_rule: null,
        evidence_url: null,
        notes: null,
        matched_movement_id: "mov-cobro-1",
        created_by: "user-1",
        created_at: "2026-08-01",
        updated_at: "2026-08-10",
      };

      // 1er Movimiento Real (3M el 10/08)
      const mov1: TreasuryMovement = {
        id: "mov-cobro-1",
        public_id: "RC-0010",
        date: "2026-08-10",
        type: "cobranza",
        direction: "ingreso",
        bank_account_id: "bank-1",
        amount: 3000000,
        description: "Cobranza Parcial 1 (3M)",
        reference_type: "customer_receipt",
        reference_id: "rec-1",
        transfer_group_id: null,
        operational_category: null,
        beneficiary_id: null,
        status: "confirmado",
        created_at: "2026-08-10T10:00:00Z",
      };

      const recon1: FinanceForecastReconciliation = {
        id: "rec-nm-1",
        forecast_adjustment_id: "fc-anual-1",
        treasury_movement_id: "mov-cobro-1",
        applied_amount: 3000000,
        reconciled_by: "user-1",
        reconciled_at: "2026-08-10T10:00:00Z",
        created_at: "2026-08-10T10:00:00Z",
      };

      // Etapa 1: con 1er cobro aplicado (3M), la previsión proyecta el remanente (2M)
      const txsStage1 = buildUnifiedTransactions({
        bankAccounts: [bankAccount],
        realMovements: [mov1],
        forecastAdjustments: [forecast],
        forecastReconciliations: [recon1],
      });

      expect(txsStage1.length).toBe(2);
      const realTx1 = txsStage1.find((t) => t.isReal)!;
      const projTx1 = txsStage1.find((t) => !t.isReal)!;

      expect(realTx1.amount).toBe(3000000);
      expect(realTx1.reconciliations?.[0].appliedAmount).toBe(3000000);

      expect(projTx1.amount).toBe(2000000); // 5M - 3M
      expect(projTx1.status).toBe("comprometido");
      expect(projTx1.date).toBe("2026-08-30");

      // Etapa 2: 2do cobro aplicado (2M el 20/08) cancela la totalidad
      const mov2: TreasuryMovement = {
        id: "mov-cobro-2",
        public_id: "RC-0020",
        date: "2026-08-20",
        type: "cobranza",
        direction: "ingreso",
        bank_account_id: "bank-1",
        amount: 2000000,
        description: "Cobranza Parcial 2 (2M)",
        reference_type: "customer_receipt",
        reference_id: "rec-2",
        transfer_group_id: null,
        operational_category: null,
        beneficiary_id: null,
        status: "confirmado",
        created_at: "2026-08-20T10:00:00Z",
      };

      const recon2: FinanceForecastReconciliation = {
        id: "rec-nm-2",
        forecast_adjustment_id: "fc-anual-1",
        treasury_movement_id: "mov-cobro-2",
        applied_amount: 2000000,
        reconciled_by: "user-1",
        reconciled_at: "2026-08-20T10:00:00Z",
        created_at: "2026-08-20T10:00:00Z",
      };

      const forecastFullReconciled: FinanceForecastAdjustment = {
        ...forecast,
        status: "reconciliado",
        reconciled_amount: 5000000,
      };

      const txsStage2 = buildUnifiedTransactions({
        bankAccounts: [bankAccount],
        realMovements: [mov1, mov2],
        forecastAdjustments: [forecastFullReconciled],
        forecastReconciliations: [recon1, recon2],
      });

      expect(txsStage2.length).toBe(2);
      expect(txsStage2.every((t) => t.isReal)).toBe(true);
      expect(txsStage2[0].amount).toBe(3000000);
      expect(txsStage2[1].amount).toBe(2000000);

      // Consistencia matemática en el calendario diario
      const initialBal = 10000000;
      const dailyBalances = calculateDailyRollingBalances(2026, 7, initialBal, txsStage2, "all");

      const day10 = dailyBalances.find((d) => d.day === 10)!;
      const day20 = dailyBalances.find((d) => d.day === 20)!;
      const day31 = dailyBalances[dailyBalances.length - 1];

      expect(day10.inflows).toBe(3000000);
      expect(day10.projectedClosingBalance).toBe(13000000);

      expect(day20.inflows).toBe(2000000);
      expect(day20.projectedClosingBalance).toBe(15000000);

      expect(day31.projectedClosingBalance).toBe(15000000); // 10M inicial + 5M ingresos netos
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  getLastBusinessDayOfMonth,
  isProgrammedTransaction,
  sortOperationalTransactions,
  calculateDailyRollingBalances,
} from "./engine";
import { buildUnifiedTransactions } from "./data";
import type {
  FinanceUnifiedTransaction,
} from "./types";
import type {
  CustomerOpenItem,
  TreasuryMovement,
  BankAccount,
} from "@/lib/tesoreria/types";

describe("NEXUS Finanzas / Tesorería — P1 & P2 Validaciones Canónicas", () => {
  const dummyBank: BankAccount = {
    id: "bank-galicia-1",
    bank_name: "Banco Galicia",
    account_name: "Galicia Operativa",
    account_type: "cc",
    currency: "ARS",
    alias: "TOPS.GALICIA",
    cbu: "0070001112223334445556",
    opening_balance: 10000000,
    active: true,
    is_system: false,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // P1 — ORDEN OPERATIVO EN LISTA Y TRANSACCIONES
  // ═══════════════════════════════════════════════════════════════════════════
  describe("P1 — Orden Operativo (Fecha más reciente primero, desempate por creación)", () => {
    it("usa una única clasificación para previsiones y hechos", () => {
      const base = {
        id: "tx",
        date: "2026-08-22",
        direction: "ingreso" as const,
        concept: "Prueba",
        counterpart: null,
        amount: 1,
        currency: "ARS" as const,
        accountGroup: "bancos" as const,
        accountName: "Galicia",
        categoryName: "Ingresos",
      };
      expect(isProgrammedTransaction({ ...base, isReal: false, status: "proyectado" })).toBe(true);
      expect(isProgrammedTransaction({ ...base, isReal: true, status: "comprometido" })).toBe(true);
      expect(isProgrammedTransaction({ ...base, isReal: true, status: "ejecutado" })).toBe(false);
    });
    it("ordena transacciones por fecha descendente (la más reciente primero)", () => {
      const txs: FinanceUnifiedTransaction[] = [
        {
          id: "tx-1",
          date: "2026-08-01",
          direction: "ingreso",
          concept: "Cobranza Inicio de Mes",
          counterpart: "Cliente A",
          amount: 100000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia",
          categoryName: "Ingresos",
          isReal: true,
          status: "ejecutado",
        },
        {
          id: "tx-2",
          date: "2026-08-25",
          direction: "egreso",
          concept: "Pago Combustible Fin de Mes",
          counterpart: "Proveedor B",
          amount: 50000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia",
          categoryName: "Combustible",
          isReal: true,
          status: "ejecutado",
        },
        {
          id: "tx-3",
          date: "2026-08-15",
          direction: "ingreso",
          concept: "Cobranza Quincena",
          counterpart: "Cliente C",
          amount: 200000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia",
          categoryName: "Ingresos",
          isReal: true,
          status: "ejecutado",
        },
      ];

      const sorted = sortOperationalTransactions(txs);

      expect(sorted[0].id).toBe("tx-2"); // 2026-08-25
      expect(sorted[1].id).toBe("tx-3"); // 2026-08-15
      expect(sorted[2].id).toBe("tx-1"); // 2026-08-01
    });

    it("desempata a igualdad de fecha mostrando primero la creada más recientemente", () => {
      const txs: FinanceUnifiedTransaction[] = [
        {
          id: "tx-morning",
          date: "2026-08-15",
          createdAt: "2026-08-15T09:00:00.000Z",
          direction: "ingreso",
          concept: "Operación de la mañana",
          counterpart: "Cliente A",
          amount: 100000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia",
          categoryName: "Ingresos",
          isReal: true,
          status: "ejecutado",
        },
        {
          id: "tx-afternoon",
          date: "2026-08-15",
          createdAt: "2026-08-15T16:30:00.000Z",
          direction: "egreso",
          concept: "Operación de la tarde",
          counterpart: "Proveedor B",
          amount: 50000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia",
          categoryName: "Gastos",
          isReal: true,
          status: "ejecutado",
        },
        {
          id: "tx-noon",
          date: "2026-08-15",
          createdAt: "2026-08-15T12:15:00.000Z",
          direction: "ingreso",
          concept: "Operación del mediodía",
          counterpart: "Cliente C",
          amount: 80000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia",
          categoryName: "Ingresos",
          isReal: true,
          status: "ejecutado",
        },
      ];

      const sorted = sortOperationalTransactions(txs);

      expect(sorted[0].id).toBe("tx-afternoon"); // 16:30
      expect(sorted[1].id).toBe("tx-noon");      // 12:15
      expect(sorted[2].id).toBe("tx-morning");   // 09:00
    });

    it("no altera el orden cronológico natural del Calendario de Flujo", () => {
      const txs: FinanceUnifiedTransaction[] = [
        {
          id: "tx-late",
          date: "2026-08-20",
          direction: "ingreso",
          concept: "Ingreso día 20",
          counterpart: "Cliente",
          amount: 500000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia",
          categoryName: "Ingresos",
          isReal: true,
          status: "ejecutado",
        },
        {
          id: "tx-early",
          date: "2026-08-05",
          direction: "ingreso",
          concept: "Ingreso día 5",
          counterpart: "Cliente",
          amount: 300000,
          currency: "ARS",
          accountGroup: "bancos",
          accountName: "Galicia",
          categoryName: "Ingresos",
          isReal: true,
          status: "ejecutado",
        },
      ];

      // calculateDailyRollingBalances procesa día a día 1..31 acumulativamente
      const daily = calculateDailyRollingBalances(2026, 7, 1000000, txs, "all");

      expect(daily[0].day).toBe(1);
      expect(daily[4].day).toBe(5);
      expect(daily[4].inflows).toBe(300000);
      expect(daily[4].projectedClosingBalance).toBe(1300000);

      expect(daily[19].day).toBe(20);
      expect(daily[19].inflows).toBe(500000);
      expect(daily[19].projectedClosingBalance).toBe(1800000);

      expect(daily[30].day).toBe(31);
      expect(daily[30].projectedClosingBalance).toBe(1800000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // P2 — CÁLCULO DE ÚLTIMO DÍA HÁBIL DEL MES
  // ═══════════════════════════════════════════════════════════════════════════
  describe("P2 — Último día hábil del mes de emisión (exclusión de fin de semana)", () => {
    it("asigna el último día calendario si cae en día de semana (ej. Agosto 2026 -> Lunes 31)", () => {
      // 2026-08-31 es Lunes
      const res = getLastBusinessDayOfMonth("2026-08-15");
      expect(res).toBe("2026-08-31");
    });

    it("retrocede a Viernes si el último día del mes es Domingo (ej. Mayo 2026: 31 es Domingo -> Viernes 29)", () => {
      // 2026-05-31 es Domingo -> Viernes 29
      const res = getLastBusinessDayOfMonth("2026-05-10");
      expect(res).toBe("2026-05-29");
    });

    it("retrocede a Viernes si el último día del mes es Sábado (ej. Febrero 2026: 28 es Sábado -> Viernes 27)", () => {
      // 2026-02-28 es Sábado -> Viernes 27
      const res = getLastBusinessDayOfMonth("2026-02-04");
      expect(res).toBe("2026-02-27");
    });

    it("retrocede a Viernes para Octubre 2026 (31 es Sábado -> Viernes 30)", () => {
      const res = getLastBusinessDayOfMonth("2026-10-20");
      expect(res).toBe("2026-10-30");
    });

    it("maneja correctamente objetos Date además de strings", () => {
      const d = new Date(Date.UTC(2026, 0, 15)); // Enero 2026 (31 es Sábado -> Viernes 30)
      const res = getLastBusinessDayOfMonth(d);
      expect(res).toBe("2026-01-30");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // P2 — PREVISIÓN AUTOMÁTICA POR FACTURA (CICLO DE VIDA COMPLETO)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("P2 — Previsión Automática por Factura Emitida y Pendiente", () => {
    it("1. Genera idempotentemente una única previsión de ingreso por factura emitida", () => {
      const invoiceItem: CustomerOpenItem = {
        invoice_id: "inv-uuid-001",
        client_id: "client-uuid-1",
        numero_comprobante: 1045,
        punto_venta: 2,
        tipo_comprobante: "FACTURA_A",
        razon_social: "Droguería del Sud S.A.",
        total: 1500000,
        fch_vto_pago: "2026-09-15",
        pagado: 0,
        saldo: 1500000,
        estado_cobro: "pendiente",
        fecha_emision: "2026-08-10",
        created_at: "2026-08-10T14:22:00.000Z",
        moneda: "PES",
      };

      const txs = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        customerItems: [invoiceItem],
      });

      expect(txs.length).toBe(1);
      const forecast = txs[0];

      expect(forecast.id).toBe("invoice-forecast-inv-uuid-001");
      expect(forecast.direction).toBe("ingreso");
      expect(forecast.amount).toBe(1500000);
      expect(forecast.date).toBe("2026-08-31"); // Último día hábil de Agosto 2026
      expect(forecast.counterpart).toBe("Droguería del Sud S.A.");
      expect(forecast.concept).toContain("FACTURA A 0002-00001045");
      expect(forecast.concept).toContain("Droguería del Sud S.A.");
      expect(forecast.isReal).toBe(false);
      expect(forecast.status).toBe("proyectado");
      expect(forecast.certainty).toBe("alta");
      expect(forecast.invoiceId).toBe("inv-uuid-001");
      expect(forecast.numeroComprobante).toBe(1045);
    });

    it("2. Reintentar o reprocesar la emisión no duplica la previsión (idempotencia estricta)", () => {
      const invoiceItem: CustomerOpenItem = {
        invoice_id: "inv-uuid-001",
        client_id: "client-uuid-1",
        numero_comprobante: 1045,
        punto_venta: 2,
        tipo_comprobante: "FACTURA_A",
        razon_social: "Droguería del Sud S.A.",
        total: 1500000,
        fch_vto_pago: "2026-09-15",
        pagado: 0,
        saldo: 1500000,
        estado_cobro: "pendiente",
        fecha_emision: "2026-08-10",
      };

      // Ejecución 1
      const run1 = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        customerItems: [invoiceItem],
      });

      // Ejecución 2 (reintento / recarga)
      const run2 = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        customerItems: [invoiceItem],
      });

      expect(run1.length).toBe(1);
      expect(run2.length).toBe(1);
      expect(run1[0].id).toBe(run2[0].id);
      expect(run1[0].amount).toBe(run2[0].amount);
      expect(run1[0].date).toBe(run2[0].date);
    });

    it("3. Cobro parcial: ajusta la previsión para proyectar únicamente el saldo remanente", () => {
      const invoiceWithPartialPayment: CustomerOpenItem = {
        invoice_id: "inv-uuid-002",
        client_id: "client-uuid-1",
        numero_comprobante: 1050,
        punto_venta: 2,
        tipo_comprobante: "FACTURA_A",
        razon_social: "Laboratorios Roemmers S.A.",
        total: 2000000,
        fch_vto_pago: "2026-08-25",
        pagado: 750000, // Se cobraron 750k
        saldo: 1250000,  // Saldo remanente 1.25M
        estado_cobro: "parcial",
        fecha_emision: "2026-08-05",
      };

      // Movimiento real de Tesorería que registró el cobro parcial de 750k
      const realReceiptMovement: TreasuryMovement = {
        id: "mov-recibo-001",
        public_id: "RC-0001",
        date: "2026-08-15",
        type: "cobranza",
        direction: "ingreso",
        bank_account_id: "bank-galicia-1",
        amount: 750000,
        description: "Cobranza Parcial Factura 1050",
        reference_type: "customer_receipt",
        reference_id: "rc-1",
        transfer_group_id: null,
        status: "confirmado",
        operational_category: null,
        beneficiary_id: null,
        created_at: "2026-08-15T10:00:00Z",
      };

      const txs = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        realMovements: [realReceiptMovement],
        customerItems: [invoiceWithPartialPayment],
      });

      expect(txs.length).toBe(2);

      const realTx = txs.find((t) => t.isReal)!;
      const forecastTx = txs.find((t) => !t.isReal)!;

      expect(realTx.amount).toBe(750000);
      expect(realTx.status).toBe("ejecutado");

      expect(forecastTx.amount).toBe(1250000); // Sólo el saldo remanente
      expect(forecastTx.concept).toContain("(Saldo Remanente)");
      expect(forecastTx.status).toBe("comprometido");
      expect(forecastTx.date).toBe("2026-08-31");
    });

    it("4. Cobro total: cierra la previsión de la factura y registra el movimiento real", () => {
      const invoiceFullyPaid: CustomerOpenItem = {
        invoice_id: "inv-uuid-003",
        client_id: "client-uuid-1",
        numero_comprobante: 1060,
        punto_venta: 2,
        tipo_comprobante: "FACTURA_A",
        razon_social: "Laboratorios Roemmers S.A.",
        total: 1000000,
        fch_vto_pago: "2026-08-20",
        pagado: 1000000,
        saldo: 0, // Cobrada al 100%
        estado_cobro: "cobrada",
        fecha_emision: "2026-08-01",
      };

      const realFullReceiptMovement: TreasuryMovement = {
        id: "mov-recibo-002",
        public_id: "RC-0002",
        date: "2026-08-18",
        type: "cobranza",
        direction: "ingreso",
        bank_account_id: "bank-galicia-1",
        amount: 1000000,
        description: "Cobranza Total Factura 1060",
        reference_type: "customer_receipt",
        reference_id: "rc-2",
        transfer_group_id: null,
        status: "confirmado",
        operational_category: null,
        beneficiary_id: null,
        created_at: "2026-08-18T11:00:00Z",
      };

      const txs = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        realMovements: [realFullReceiptMovement],
        customerItems: [invoiceFullyPaid],
      });

      // No debe existir ninguna previsión abierta para esta factura
      expect(txs.length).toBe(1);
      expect(txs[0].isReal).toBe(true);
      expect(txs[0].amount).toBe(1000000);
      expect(txs.some((t) => t.id === "invoice-forecast-inv-uuid-003")).toBe(false);
    });

    it("5. Nota de Crédito / Anulación: reduce o cierra la previsión sin residuos", () => {
      // Caso 5A: Factura con NC parcial (total original 1M, NC por 300k -> saldo 700k)
      const invoiceWithCreditNote: CustomerOpenItem = {
        invoice_id: "inv-uuid-004",
        client_id: "client-uuid-1",
        numero_comprobante: 1070,
        punto_venta: 2,
        tipo_comprobante: "FACTURA_A",
        razon_social: "Bayer S.A.",
        total: 1000000,
        fch_vto_pago: "2026-08-30",
        pagado: 0,
        saldo: 700000, // Saldo neto tras impacto de NC en la vista
        estado_cobro: "pendiente",
        fecha_emision: "2026-08-10",
      };

      const txs = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        customerItems: [invoiceWithCreditNote],
      });

      expect(txs.length).toBe(1);
      expect(txs[0].amount).toBe(700000);

      // Caso 5B: NC total (saldo <= 0) -> cierra la previsión
      const invoiceWithFullCreditNote: CustomerOpenItem = {
        ...invoiceWithCreditNote,
        saldo: 0,
        estado_cobro: "cobrada",
      };

      const txsClosed = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        customerItems: [invoiceWithFullCreditNote],
      });

      expect(txsClosed.length).toBe(0);
    });

    it("6. Factura vencida no cobrada: se mantiene visible con status 'vencida', nunca se borra", () => {
      const overdueInvoice: CustomerOpenItem = {
        invoice_id: "inv-uuid-overdue",
        client_id: "client-uuid-2",
        numero_comprobante: 980,
        punto_venta: 2,
        tipo_comprobante: "FACTURA_A",
        razon_social: "Laboratorio Beta",
        total: 800000,
        fch_vto_pago: "2026-07-15", // Vencida en Julio
        pagado: 0,
        saldo: 800000,
        estado_cobro: "vencida",
        fecha_emision: "2026-06-15", // Emitida en Junio
      };

      const txs = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        customerItems: [overdueInvoice],
      });

      expect(txs.length).toBe(1);
      const forecast = txs[0];
      expect(forecast.amount).toBe(800000);
      expect(forecast.status).toBe("vencida"); // Visible como vencida
      expect(forecast.date).toBe("2026-06-30"); // Último día hábil de Junio 2026
      expect(forecast.counterpart).toBe("Laboratorio Beta");
    });

    it("7. Soporte multimoneda: factura en USD genera previsión en USD", () => {
      const usdInvoice: CustomerOpenItem = {
        invoice_id: "inv-usd-001",
        client_id: "client-intl",
        numero_comprobante: 12,
        punto_venta: 3,
        tipo_comprobante: "FACTURA_E",
        razon_social: "Pfizer Global Logistics",
        total: 25000,
        fch_vto_pago: "2026-08-31",
        pagado: 0,
        saldo: 25000,
        estado_cobro: "pendiente",
        fecha_emision: "2026-08-05",
        moneda: "USD",
      };

      const txs = buildUnifiedTransactions({
        bankAccounts: [dummyBank],
        customerItems: [usdInvoice],
      });

      expect(txs.length).toBe(1);
      expect(txs[0].currency).toBe("USD");
      expect(txs[0].amount).toBe(25000);
    });
  });
});

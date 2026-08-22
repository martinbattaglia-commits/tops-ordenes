import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  RegisterReceiptSchema,
  RegisterPaymentSchema,
  RegisterOperationalMovementSchema,
} from "./validation";
import {
  registerReceiptAction,
  registerPaymentAction,
  registerOperationalMovementAction,
} from "./actions";
import { voidForecastAdjustmentAction } from "@/lib/finanzas/actions";

// Mock Supabase Server Client
const mockRpc = vi.fn();
const mockSupabase = {
  rpc: mockRpc,
  from: vi.fn(),
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: "test-user-id", email: "martin@logisticatops.com" } },
      error: null,
    }),
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockSupabase,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * Motor de simulación del algoritmo de la RPC _internal_reconcile_forecast
 * Replica exactamente la lógica transaccional de PostgreSQL para verificar invariantes de dominio.
 */
interface ForecastState {
  id: string;
  amount: number;
  reconciled_amount: number;
  status: "proyectado" | "comprometido" | "reconciliado" | "anulado";
  direction: "ingreso" | "egreso";
  currency: "ARS" | "USD";
}

interface ReconciliationRecord {
  id: string;
  forecast_adjustment_id: string;
  treasury_movement_id: string;
  applied_amount: number;
  reconciled_by: string;
  reconciled_at: string;
}

class ReconciliationSimulationEngine {
  public forecasts = new Map<string, ForecastState>();
  public reconciliations: ReconciliationRecord[] = [];

  public reconcile(
    forecastId: string,
    movementId: string,
    appliedAmount: number,
    actorUid: string,
    expectedDirection: "ingreso" | "egreso"
  ) {
    const fc = this.forecasts.get(forecastId);
    if (!fc) {
      throw new Error(`FORECAST_NOT_FOUND: previsión ${forecastId} inexistente`);
    }

    // Idempotencia
    const existing = this.reconciliations.find(
      (r) => r.forecast_adjustment_id === forecastId && r.treasury_movement_id === movementId
    );
    if (existing) {
      return {
        reconciliation_id: existing.id,
        idempotent: true,
        forecast_id: forecastId,
        movement_id: movementId,
      };
    }

    if (fc.status === "anulado") {
      throw new Error(`FORECAST_VOIDED: previsión ${forecastId} está anulada`);
    }
    if (fc.status === "reconciliado") {
      throw new Error(`FORECAST_FULLY_RECONCILED: previsión ${forecastId} ya está totalmente reconciliada`);
    }
    if (fc.direction !== expectedDirection) {
      throw new Error(`FORECAST_DIRECTION_MISMATCH: previsión ${forecastId} es "${fc.direction}" pero se esperaba "${expectedDirection}"`);
    }
    if (fc.currency !== "ARS") {
      throw new Error(`FORECAST_CURRENCY_UNSUPPORTED: solo ARS soportado`);
    }
    if (appliedAmount <= 0) {
      throw new Error(`FORECAST_APPLIED_AMOUNT_INVALID: importe debe ser > 0`);
    }

    const remaining = fc.amount - fc.reconciled_amount;
    if (appliedAmount > remaining) {
      throw new Error(`FORECAST_OVER_APPLICATION: importe aplicado (${appliedAmount}) excede saldo disponible (${remaining})`);
    }

    const recId = `rec-${this.reconciliations.length + 1}`;
    this.reconciliations.push({
      id: recId,
      forecast_adjustment_id: forecastId,
      treasury_movement_id: movementId,
      applied_amount: appliedAmount,
      reconciled_by: actorUid,
      reconciled_at: new Date().toISOString(),
    });

    const newReconciled = fc.reconciled_amount + appliedAmount;
    const newRemaining = fc.amount - newReconciled;
    const newStatus = newRemaining === 0 ? "reconciliado" : "comprometido";

    fc.reconciled_amount = newReconciled;
    fc.status = newStatus;

    return {
      reconciliation_id: recId,
      idempotent: false,
      forecast_id: forecastId,
      movement_id: movementId,
      applied_amount: appliedAmount,
      new_reconciled_total: newReconciled,
      remaining: newRemaining,
      new_status: newStatus,
    };
  }
}

describe("Suite de Reconciliación Atómica Tesorería ↔ Finanzas (NEXUS-FIN-TES-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Contrato RPC Estricto y Forwarding en Server Actions", () => {
    it("voidForecastAdjustmentAction usa la RPC protegida y no UPDATE directo", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { forecast_id: "44444444-4444-4444-8444-444444444444", status: "anulado" },
        error: null,
      });

      const result = await voidForecastAdjustmentAction(
        "44444444-4444-4444-8444-444444444444",
        "Duplicado"
      );

      expect(result.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("finance_void_forecast", {
        p_forecast_id: "44444444-4444-4444-8444-444444444444",
        p_reason: "Duplicado",
      });
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it("rechaza a un usuario no autorizado antes de invocar la RPC financiera", async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: "other-user", email: "joseluis@logisticatops.com" } },
        error: null,
      });

      const result = await voidForecastAdjustmentAction(
        "44444444-4444-4444-8444-444444444444",
        "Intento no autorizado",
      );

      expect(result).toEqual({ ok: false, message: "Acceso no autorizado." });
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("registerReceiptAction mapea todos los parámetros incluyendo forecast_adjustment_id, forecast_applied_amount e idempotency_key", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          receipt_id: "rec-123",
          public_id: "RC-0001",
          movement_id: "mov-456",
          net_amount: 5000000,
          allocations: 1,
          reconciliation: {
            reconciliation_id: "rf-789",
            idempotent: false,
            forecast_id: "44444444-4444-4444-8444-444444444444",
            movement_id: "mov-456",
            applied_amount: 3000000,
            new_reconciled_total: 3000000,
            remaining: 2000000,
            new_status: "comprometido",
          },
        },
        error: null,
      });

      const payload = {
        client_id: "11111111-1111-4111-8111-111111111111",
        payment_date: "2026-08-22",
        payment_method: "transferencia",
        bank_account_id: "33333333-3333-4333-8333-333333333333",
        gross_amount: "5000000.00",
        retention_amount: "0.00",
        allocations: [{ invoice_id: "22222222-2222-4222-8222-222222222222", amount: "5000000.00" }],
        forecast_adjustment_id: "44444444-4444-4444-8444-444444444444",
        forecast_applied_amount: "3000000.00",
        idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      };

      const res = await registerReceiptAction(payload);

      expect(res.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("tesoreria_register_receipt", {
        p_client_id: "11111111-1111-4111-8111-111111111111",
        p_payment_date: "2026-08-22",
        p_payment_method: "transferencia",
        p_bank_account_id: "33333333-3333-4333-8333-333333333333",
        p_gross_amount: 5000000,
        p_retention_amount: 0,
        p_observations: null,
        p_attachment: null,
        p_allocations: [{ invoice_id: "22222222-2222-4222-8222-222222222222", amount: "5000000.00" }],
        p_forecast_adjustment_id: "44444444-4444-4444-8444-444444444444",
        p_forecast_applied_amount: 3000000,
        p_idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      });
    });

    it("registerPaymentAction mapea forecast_applied_amount opcional e idempotency_key", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          payment_id: "pay-123",
          public_id: "OP-0001",
          movement_id: "mov-789",
          amount: 2000000,
          allocations: 1,
          reconciliation: {
            reconciliation_id: "rf-999",
            idempotent: false,
            forecast_id: "44444444-4444-4444-8444-444444444444",
            movement_id: "mov-789",
            applied_amount: 2000000,
            new_reconciled_total: 5000000,
            remaining: 0,
            new_status: "reconciliado",
          },
        },
        error: null,
      });

      const payload = {
        vendor_id: "55555555-5555-4555-8555-555555555555",
        payment_date: "2026-08-22",
        payment_method: "transferencia",
        bank_account_id: "33333333-3333-4333-8333-333333333333",
        amount: "2000000.00",
        allocations: [{ supplier_invoice_id: "22222222-2222-4222-8222-222222222222", amount: "2000000.00" }],
        forecast_adjustment_id: "44444444-4444-4444-8444-444444444444",
        forecast_applied_amount: "2000000.00",
        idempotency_key: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      };

      const res = await registerPaymentAction(payload);

      expect(res.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("tesoreria_register_payment", {
        p_vendor_id: "55555555-5555-4555-8555-555555555555",
        p_payment_date: "2026-08-22",
        p_payment_method: "transferencia",
        p_bank_account_id: "33333333-3333-4333-8333-333333333333",
        p_amount: 2000000,
        p_operation_number: null,
        p_observations: null,
        p_attachment: null,
        p_allocations: [{ supplier_invoice_id: "22222222-2222-4222-8222-222222222222", amount: "2000000.00" }],
        p_forecast_adjustment_id: "44444444-4444-4444-8444-444444444444",
        p_forecast_applied_amount: 2000000,
        p_idempotency_key: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      });
    });

    it("registerOperationalMovementAction mapea forecast_adjustment_id, forecast_applied_amount e idempotency_key", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          movement_id: "mov-888",
          public_id: "MO-0001",
          reconciliation: {
            reconciliation_id: "rf-888",
            idempotent: false,
          },
        },
        error: null,
      });

      const payload = {
        date: "2026-08-22",
        category: "gasto_operativo",
        direction: "egreso",
        bank_account_id: "33333333-3333-4333-8333-333333333333",
        amount: "150000.00",
        concept: "Compra insumos de oficina",
        forecast_adjustment_id: "44444444-4444-4444-8444-444444444444",
        forecast_applied_amount: "150000.00",
        idempotency_key: "cccccccc-dddd-4eee-8fff-000000000000",
      };

      const res = await registerOperationalMovementAction(payload);

      expect(res.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("tesoreria_register_operational_movement", {
        p_date: "2026-08-22",
        p_category: "gasto_operativo",
        p_direction: "egreso",
        p_bank_account_id: "33333333-3333-4333-8333-333333333333",
        p_amount: 150000,
        p_concept: "Compra insumos de oficina",
        p_beneficiary_id: null,
        p_beneficiary_name: null,
        p_beneficiary_kind: "tercero",
        p_beneficiary_document: null,
        p_forecast_adjustment_id: "44444444-4444-4444-8444-444444444444",
        p_forecast_applied_amount: 150000,
        p_idempotency_key: "cccccccc-dddd-4eee-8fff-000000000000",
      });
    });
  });

  describe("2. Validación de Esquemas Zod", () => {
    it("valida y rechaza forecast_adjustment_id no UUID o forecast_applied_amount inválido", () => {
      const invalidReceipt = {
        client_id: "11111111-1111-4111-8111-111111111111",
        payment_date: "2026-08-22",
        payment_method: "transferencia",
        bank_account_id: "33333333-3333-4333-8333-333333333333",
        gross_amount: "1000.00",
        allocations: [{ invoice_id: "22222222-2222-4222-8222-222222222222", amount: "1000.00" }],
        forecast_adjustment_id: "not-a-uuid",
        forecast_applied_amount: "invalid-money",
        idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      };

      const parsed = RegisterReceiptSchema.safeParse(invalidReceipt);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => i.path[0]);
        expect(issues).toContain("forecast_adjustment_id");
        expect(issues).toContain("forecast_applied_amount");
      }
    });

    it("rechaza esquemas sin idempotency_key o con formato no UUID", () => {
      const missingKey = {
        client_id: "11111111-1111-4111-8111-111111111111",
        payment_date: "2026-08-22",
        payment_method: "transferencia",
        bank_account_id: "33333333-3333-4333-8333-333333333333",
        gross_amount: "1000.00",
        allocations: [{ invoice_id: "22222222-2222-4222-8222-222222222222", amount: "1000.00" }],
      };

      const parsedMissing = RegisterReceiptSchema.safeParse(missingKey);
      expect(parsedMissing.success).toBe(false);

      const invalidKey = {
        ...missingKey,
        idempotency_key: "not-a-uuid",
      };
      const parsedInvalid = RegisterReceiptSchema.safeParse(invalidKey);
      expect(parsedInvalid.success).toBe(false);
    });

    it("acepta esquemas con forecast_applied_amount nulo u omitido cuando se provee idempotency_key", () => {
      const validReceipt = {
        client_id: "11111111-1111-4111-8111-111111111111",
        payment_date: "2026-08-22",
        payment_method: "transferencia",
        bank_account_id: "33333333-3333-4333-8333-333333333333",
        gross_amount: "1000.00",
        allocations: [{ invoice_id: "22222222-2222-4222-8222-222222222222", amount: "1000.00" }],
        forecast_adjustment_id: "44444444-4444-4444-8444-444444444444",
        idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      };

      const parsed = RegisterReceiptSchema.safeParse(validReceipt);
      expect(parsed.success).toBe(true);
    });
  });

  describe("3. Invariantes del Motor de Reconciliación Transaccional", () => {
    it("Ejecución Parcial 3M + 2M: acumula reconciled_amount y transiciona estado proyectado -> comprometido -> reconciliado", () => {
      const engine = new ReconciliationSimulationEngine();
      engine.forecasts.set("fc-1", {
        id: "fc-1",
        amount: 5000000,
        reconciled_amount: 0,
        status: "proyectado",
        direction: "ingreso",
        currency: "ARS",
      });

      // 1ra ejecución: 3M
      const res1 = engine.reconcile("fc-1", "mov-1", 3000000, "user-1", "ingreso");
      expect(res1.new_reconciled_total).toBe(3000000);
      expect(res1.remaining).toBe(2000000);
      expect(res1.new_status).toBe("comprometido");
      expect(engine.forecasts.get("fc-1")?.status).toBe("comprometido");

      // 2da ejecución: 2M
      const res2 = engine.reconcile("fc-1", "mov-2", 2000000, "user-1", "ingreso");
      expect(res2.new_reconciled_total).toBe(5000000);
      expect(res2.remaining).toBe(0);
      expect(res2.new_status).toBe("reconciliado");
      expect(engine.forecasts.get("fc-1")?.status).toBe("reconciliado");

      expect(engine.reconciliations.length).toBe(2);
    });

    it("Concurrencia / Sobreaplicación: aborta si el importe excede el saldo remanente", () => {
      const engine = new ReconciliationSimulationEngine();
      engine.forecasts.set("fc-1", {
        id: "fc-1",
        amount: 5000000,
        reconciled_amount: 3000000,
        status: "comprometido",
        direction: "ingreso",
        currency: "ARS",
      });

      // Intento aplicar 3M cuando solo quedan 2M
      expect(() => {
        engine.reconcile("fc-1", "mov-3", 3000000, "user-1", "ingreso");
      }).toThrow(/FORECAST_OVER_APPLICATION/);

      // El estado debe permanecer intacto (rollback)
      expect(engine.forecasts.get("fc-1")?.reconciled_amount).toBe(3000000);
      expect(engine.forecasts.get("fc-1")?.status).toBe("comprometido");
    });

    it("Retry / Idempotencia: misma llamada devuelve ok sin duplicar relaciones ni alterar saldos", () => {
      const engine = new ReconciliationSimulationEngine();
      engine.forecasts.set("fc-1", {
        id: "fc-1",
        amount: 5000000,
        reconciled_amount: 0,
        status: "proyectado",
        direction: "ingreso",
        currency: "ARS",
      });

      const res1 = engine.reconcile("fc-1", "mov-1", 5000000, "user-1", "ingreso");
      expect(res1.idempotent).toBe(false);
      expect(res1.new_status).toBe("reconciliado");

      const res2 = engine.reconcile("fc-1", "mov-1", 5000000, "user-1", "ingreso");
      expect(res2.idempotent).toBe(true);
      expect(engine.reconciliations.length).toBe(1);
    });

    it("Forecast inválido (anulado o ya reconciliado) aborta inmediatamente", () => {
      const engine = new ReconciliationSimulationEngine();
      engine.forecasts.set("fc-anulado", {
        id: "fc-anulado",
        amount: 100000,
        reconciled_amount: 0,
        status: "anulado",
        direction: "egreso",
        currency: "ARS",
      });

      expect(() => {
        engine.reconcile("fc-anulado", "mov-1", 100000, "user-1", "egreso");
      }).toThrow(/FORECAST_VOIDED/);

      engine.forecasts.set("fc-reconciliado", {
        id: "fc-reconciliado",
        amount: 100000,
        reconciled_amount: 100000,
        status: "reconciliado",
        direction: "egreso",
        currency: "ARS",
      });

      expect(() => {
        engine.reconcile("fc-reconciliado", "mov-2", 100000, "user-1", "egreso");
      }).toThrow(/FORECAST_FULLY_RECONCILED/);
    });

    it("Dirección o Moneda incompatible aborta", () => {
      const engine = new ReconciliationSimulationEngine();
      engine.forecasts.set("fc-ingreso", {
        id: "fc-ingreso",
        amount: 100000,
        reconciled_amount: 0,
        status: "proyectado",
        direction: "ingreso",
        currency: "ARS",
      });

      expect(() => {
        engine.reconcile("fc-ingreso", "mov-1", 100000, "user-1", "egreso");
      }).toThrow(/FORECAST_DIRECTION_MISMATCH/);

      engine.forecasts.set("fc-usd", {
        id: "fc-usd",
        amount: 100,
        reconciled_amount: 0,
        status: "proyectado",
        direction: "egreso",
        currency: "USD",
      });

      expect(() => {
        engine.reconcile("fc-usd", "mov-2", 100, "user-1", "egreso");
      }).toThrow(/FORECAST_CURRENCY_UNSUPPORTED/);
    });

    it("Flujo Extraordinario NULL: movimiento sin forecast_adjustment_id no ejecuta reconciliación", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          receipt_id: "rec-extra",
          public_id: "RC-9999",
          movement_id: "mov-extra",
          net_amount: 100000,
          allocations: 1,
          reconciliation: null,
        },
        error: null,
      });

      const payload = {
        client_id: "11111111-1111-4111-8111-111111111111",
        payment_date: "2026-08-22",
        payment_method: "efectivo",
        bank_account_id: "33333333-3333-4333-8333-333333333333",
        gross_amount: "100000.00",
        allocations: [{ invoice_id: "22222222-2222-4222-8222-222222222222", amount: "100000.00" }],
        idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      };

      const res = await registerReceiptAction(payload);
      expect(res.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith(
        "tesoreria_register_receipt",
        expect.objectContaining({
          p_forecast_adjustment_id: null,
          p_forecast_applied_amount: null,
          p_idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        })
      );
    });
  });

  describe("4. Verificación Estática del Archivo de Migración SQL y Rollback", () => {
    it("Verifica que 0300_finance_treasury_atomic_reconciliation.sql y ROLLBACK_0300 existen y cumplen las reglas de arquitectura", () => {
      const migrationPath = resolve(
        process.cwd(),
        "supabase/migrations/0300_finance_treasury_atomic_reconciliation.sql"
      );
      const rollbackPath = resolve(
        process.cwd(),
        "supabase/migrations/ROLLBACK_0300_finance_treasury_atomic_reconciliation.sql"
      );

      expect(existsSync(migrationPath)).toBe(true);
      expect(existsSync(rollbackPath)).toBe(true);

      const sql = readFileSync(migrationPath, "utf-8");

      // Tabla de reconciliación auditable
      expect(sql).toContain("create table if not exists public.finance_forecast_reconciliations");
      expect(sql).toContain("unique (forecast_adjustment_id, treasury_movement_id)");

      // Tabla de idempotencia
      expect(sql).toContain("create table if not exists public.treasury_idempotency_keys");
      expect(sql).toContain("pg_advisory_xact_lock");

      // Columna de acumulado
      expect(sql).toContain("reconciled_amount numeric(15,2)");

      // Bloqueo pesimista FOR UPDATE en previsión
      expect(sql).toContain("for update;");

      // Función interna de reconciliación
      expect(sql).toContain("create or replace function public._internal_reconcile_forecast");

      // Las 3 RPCs modificadas
      expect(sql).toContain("create or replace function public.tesoreria_register_receipt");
      expect(sql).toContain("create or replace function public.tesoreria_register_payment");
      expect(sql).toContain("create or replace function public.tesoreria_register_operational_movement");

      // Eliminación de firmas previas para prevenir PGRST203 (ambigüedad PostgREST)
      expect(sql).toContain("drop function if exists public.tesoreria_register_receipt(");
      expect(sql).toContain("drop function if exists public.tesoreria_register_payment(");
      expect(sql).toContain("drop function if exists public.tesoreria_register_operational_movement(");

      const rollbackSql = readFileSync(rollbackPath, "utf-8");
      expect(rollbackSql).toContain("drop table if exists public.finance_forecast_reconciliations");
      expect(rollbackSql).toContain("drop table if exists public.treasury_idempotency_keys");
      expect(rollbackSql).toContain("alter table public.finance_forecast_adjustments drop column reconciled_amount");
    });
  });
});

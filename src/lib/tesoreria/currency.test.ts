import { describe, it, expect } from "vitest";
import { onlyArs, sumArsBalances, cajaUsdBalance, fmtCaja, isCajaCurrency } from "./currency";
import type { BankBalance } from "./types";

// CCN-002 · D-2: estos tests son el contrato del fence monetario — si alguno
// se rompe, hay una superficie sumando ARS con USD.

const bal = (o: Partial<BankBalance>): BankBalance => ({
  bank_account_id: o.bank_account_id ?? "b1",
  bank_name: o.bank_name ?? "Banco",
  account_name: o.account_name ?? "Cuenta",
  account_type: o.account_type ?? "cuenta_corriente",
  currency: o.currency ?? "ARS",
  is_system: o.is_system ?? false,
  opening_balance: o.opening_balance ?? 0,
  balance: o.balance ?? 0,
});

const galicia = bal({ bank_account_id: "g", bank_name: "Banco Galicia", balance: 1000 });
const santander = bal({ bank_account_id: "s", bank_name: "Banco Santander", balance: 2000 });
const cajaArs = bal({ bank_account_id: "ca", bank_name: "Caja", account_type: "caja", is_system: true, balance: 500 });
const cajaUsd = bal({ bank_account_id: "cu", bank_name: "Caja", account_name: "Caja Efectivo USD", account_type: "caja", currency: "USD", is_system: true, balance: 300 });

describe("sumArsBalances (fence D-2)", () => {
  it("suma sólo ARS: una caja USD activa NO contamina el total", () => {
    expect(sumArsBalances([galicia, santander, cajaArs, cajaUsd])).toBe(3500);
  });
  it("sin USD, conserva la semántica actual (bancos + caja ARS)", () => {
    expect(sumArsBalances([galicia, santander, cajaArs])).toBe(3500);
  });
  it("lista vacía → 0", () => expect(sumArsBalances([])).toBe(0));
  it("nunca devuelve un total que incluya el saldo USD", () => {
    const conUsd = sumArsBalances([galicia, cajaUsd]);
    const sinUsd = sumArsBalances([galicia]);
    expect(conUsd).toBe(sinUsd);
  });
});

describe("onlyArs", () => {
  it("excluye toda fila USD, incluida la caja", () => {
    expect(onlyArs([galicia, cajaUsd]).map((b) => b.bank_account_id)).toEqual(["g"]);
  });
});

describe("cajaUsdBalance", () => {
  it("null cuando la caja USD no existe (pre data-op): no inventa un 0", () => {
    expect(cajaUsdBalance([galicia, santander, cajaArs])).toBeNull();
  });
  it("saldo USD cuando la caja existe", () => {
    expect(cajaUsdBalance([galicia, cajaArs, cajaUsd])).toBe(300);
  });
  it("caja USD vacía → 0 (distinto de inexistente)", () => {
    expect(cajaUsdBalance([bal({ account_type: "caja", currency: "USD", balance: 0 })])).toBe(0);
  });
  it("un banco USD (no caja) no cuenta como Caja Chica USD", () => {
    expect(cajaUsdBalance([bal({ currency: "USD", account_type: "cuenta_corriente", balance: 99 })])).toBeNull();
  });
});

describe("fmtCaja (símbolo siempre visible, por moneda)", () => {
  it("ARS conserva el formato actual", () => expect(fmtCaja("ARS", 5551693)).toBe("$ 5.551.693"));
  it("USD con prefijo US$ y centavos fijos", () => expect(fmtCaja("USD", 1234.5)).toBe("US$ 1.234,50"));
  it("caja USD vacía muestra US$ 0,00 (validación #2 de Dirección)", () => {
    expect(fmtCaja("USD", 0)).toBe("US$ 0,00");
  });
  it("ARS y USD nunca comparten representación para el mismo número", () => {
    expect(fmtCaja("ARS", 100)).not.toBe(fmtCaja("USD", 100));
  });
});

describe("isCajaCurrency", () => {
  it("acepta sólo ARS|USD", () => {
    expect(isCajaCurrency("ARS")).toBe(true);
    expect(isCajaCurrency("USD")).toBe(true);
    expect(isCajaCurrency("EUR")).toBe(false);
    expect(isCajaCurrency("")).toBe(false);
    expect(isCajaCurrency(null)).toBe(false);
  });
});

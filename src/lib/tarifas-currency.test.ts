import { describe, expect, it } from "vitest";
import { formatTariffAmount } from "@/components/tarifas/currency";

describe("formatTariffAmount", () => {
  it("distingue inequívocamente ARS de USD", () => {
    const ars = formatTariffAmount(1234.5, "ARS");
    const usd = formatTariffAmount(1234.5, "USD");
    expect(ars).toContain("$");
    expect(usd).toMatch(/US\$|USD/);
    expect(usd).not.toBe(ars);
  });
});

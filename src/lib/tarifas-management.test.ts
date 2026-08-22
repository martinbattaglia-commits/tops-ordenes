import { describe, expect, it } from "vitest";
import { groupClientRateWindows } from "@/components/tarifas/rate-management";

const CLIENT = "11111111-1111-4111-8111-111111111111";

describe("tariff management windows", () => {
  it("keeps future-only rates visible to management without making them current", () => {
    const result = groupClientRateWindows([{
      id: "22222222-2222-4222-8222-222222222222",
      client_id: CLIENT,
      service_slug: "peon",
      rate: "27000",
      min_qty: null,
      min_billing: null,
      valid_from: "2026-08-23T03:00:00.000Z",
      valid_to: null,
    }], "2026-08-22T12:00:00.000Z");

    expect(result.current[CLIENT]).toBeUndefined();
    expect(result.management[CLIENT].peon).toMatchObject({
      status: "scheduled",
      futureCount: 1,
      rate: 27000,
    });
  });

  it("shows the active rate and counts its scheduled successors", () => {
    const result = groupClientRateWindows([
      {
        id: "22222222-2222-4222-8222-222222222222", client_id: CLIENT,
        service_slug: "peon", rate: 25000, min_qty: null, min_billing: null,
        valid_from: "2026-08-20T03:00:00.000Z", valid_to: "2026-08-23T03:00:00.000Z",
      },
      {
        id: "33333333-3333-4333-8333-333333333333", client_id: CLIENT,
        service_slug: "peon", rate: 27000, min_qty: null, min_billing: null,
        valid_from: "2026-08-23T03:00:00.000Z", valid_to: null,
      },
    ], "2026-08-22T12:00:00.000Z");

    expect(result.current[CLIENT].peon.rate).toBe(25000);
    expect(result.management[CLIENT].peon).toMatchObject({
      status: "active",
      futureCount: 1,
      rate: 25000,
    });
  });
});

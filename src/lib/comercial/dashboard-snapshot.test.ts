import { describe, it, expect } from "vitest";
import { buildSnapshotRows } from "./dashboard-snapshot";
import type { UiDeal } from "@/lib/clientify/mappers";

function deal(p: Partial<UiDeal>): UiDeal {
  return {
    id: 1, title: "t", contactName: null, contactEmail: null, contactPhone: null,
    companyName: null, amount: 0, currency: "ARS", stage: "s", stageId: 1,
    pipeline: "ANMAT", pipelineId: 10, probability: 0, probabilityLabel: "",
    status: "open", statusLabel: "", ownerName: null, expectedClose: null,
    actualClose: null, createdAt: "", modifiedAt: "", tags: [], source: null, href: "",
    ...p,
  };
}

describe("buildSnapshotRows", () => {
  it("excluye won/lost del pipeline activo y expired del forecast", () => {
    const deals: UiDeal[] = [
      deal({ id: 1, pipelineId: 10, pipeline: "ANMAT", amount: 1000, probability: 50, status: "open" }),
      deal({ id: 2, pipelineId: 10, pipeline: "ANMAT", amount: 2000, probability: 80, status: "expired" }),
      deal({ id: 3, pipelineId: 10, pipeline: "ANMAT", amount: 5000, probability: 100, status: "won" }),
      deal({ id: 4, pipelineId: 10, pipeline: "ANMAT", amount: 9000, probability: 0, status: "lost" }),
    ];
    const [row] = buildSnapshotRows(deals, "run-1");
    expect(row.pipeline_id).toBe(10);
    expect(row.deals_total).toBe(4);
    expect(row.deals_active).toBe(2);          // open + expired (no won/lost)
    expect(row.total_amount).toBe(17000);      // todos (incluye open+expired+won+lost)
    expect(row.active_amount).toBe(1000);      // solo open/other (vivo real)
    expect(row.forecast_weighted).toBe(500);   // 1000*0.5 (expired excluido)
    expect(row.won_count).toBe(1);
    expect(row.won_amount).toBe(5000);
    expect(row.lost_count).toBe(1);
    expect(row.expired_count).toBe(1);
  });

  it("agrupa por pipeline_id", () => {
    const rows = buildSnapshotRows(
      [deal({ pipelineId: 10 }), deal({ pipelineId: 20, pipeline: "Cargas Generales" })],
      "run-1"
    );
    expect(rows.map((r) => r.pipeline_id).sort()).toEqual([10, 20]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only so vitest doesn't reject the import
vi.mock("server-only", () => ({}));

// Mock @/lib/supabase/server — will be controlled per-test via vi.mocked
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Mock @/lib/env — isMock() = env.app.demoMode || env.app.needsSupabase
vi.mock("@/lib/env", () => ({
  env: {
    app: { demoMode: false, needsSupabase: false },
  },
}));

import { mapTimelineRow, listTimeline } from "./data";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full raw row matching every column of v_knowledge_timeline. */
const FULL_ROW = {
  id: "evt-001",
  seq: 42,
  event_type: "purchase_order.approved",
  occurred_at: "2026-06-28T10:00:00Z",
  ingested_at: "2026-06-28T10:00:05Z",
  actor_kind: "user",
  actor_id: "usr-123",
  actor_label: "Martín Battaglia",
  entity_type: "purchase_order",
  entity_id: "po-999",
  summary: "OC #999 aprobada",
  payload: { amount: 15000, currency: "ARS" },
  visibility_key: "staff",
  source_table: "purchase_orders",
  correlation_id: "corr-abc",
} as const;

/** Expected camelCase output for FULL_ROW. */
const FULL_ENTRY = {
  id: "evt-001",
  seq: 42,
  eventType: "purchase_order.approved",
  occurredAt: "2026-06-28T10:00:00Z",
  ingestedAt: "2026-06-28T10:00:05Z",
  actorKind: "user" as const,
  actorId: "usr-123",
  actorLabel: "Martín Battaglia",
  entityType: "purchase_order",
  entityId: "po-999",
  summary: "OC #999 aprobada",
  payload: { amount: 15000, currency: "ARS" },
  visibilityKey: "staff",
  sourceTable: "purchase_orders",
  correlationId: "corr-abc",
};

// ---------------------------------------------------------------------------
// A) mapTimelineRow — pure mapper
// ---------------------------------------------------------------------------

describe("mapTimelineRow (pure mapper)", () => {
  it("maps all 15 fields correctly from a complete row", () => {
    const entry = mapTimelineRow(FULL_ROW);
    expect(entry).toEqual(FULL_ENTRY);
  });

  it("handles null actor_id, null correlation_id, non-null source_table", () => {
    const row = {
      ...FULL_ROW,
      actor_id: null,
      correlation_id: null,
      source_table: "audit_log",
      payload: { action: "updated", field: "status" },
    };
    const entry = mapTimelineRow(row);
    expect(entry.actorId).toBeNull();
    expect(entry.correlationId).toBeNull();
    expect(entry.sourceTable).toBe("audit_log");
    expect(entry.payload).toEqual({ action: "updated", field: "status" });
  });

  it("defaults payload to {} when null", () => {
    const row = { ...FULL_ROW, payload: null };
    const entry = mapTimelineRow(row as Parameters<typeof mapTimelineRow>[0]);
    expect(entry.payload).toEqual({});
  });

  it("defaults nullable fields to null when absent", () => {
    const row = {
      ...FULL_ROW,
      actor_id: null,
      actor_label: null,
      summary: null,
      source_table: null,
      correlation_id: null,
    };
    const entry = mapTimelineRow(row);
    expect(entry.actorId).toBeNull();
    expect(entry.actorLabel).toBeNull();
    expect(entry.summary).toBeNull();
    expect(entry.sourceTable).toBeNull();
    expect(entry.correlationId).toBeNull();
  });

  it("preserves seq number and eventType verbatim", () => {
    const entry = mapTimelineRow(FULL_ROW);
    expect(entry.seq).toBe(42);
    expect(entry.eventType).toBe("purchase_order.approved");
  });
});

// ---------------------------------------------------------------------------
// B) listTimeline — isMock() guard
// ---------------------------------------------------------------------------

describe("listTimeline — isMock() guard", () => {
  beforeEach(() => {
    // Reset env to non-mock for each test
    (env.app as { demoMode: boolean; needsSupabase: boolean }).demoMode = false;
    (env.app as { demoMode: boolean; needsSupabase: boolean }).needsSupabase = false;
  });

  it("returns [] immediately when demoMode is true (G11)", async () => {
    (env.app as { demoMode: boolean; needsSupabase: boolean }).demoMode = true;
    const result = await listTimeline();
    expect(result).toEqual([]);
    // createClient should not be called in mock mode
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns [] immediately when needsSupabase is true (G11)", async () => {
    (env.app as { demoMode: boolean; needsSupabase: boolean }).needsSupabase = true;
    const result = await listTimeline();
    expect(result).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns [] when createClient returns null", async () => {
    vi.mocked(createClient).mockReturnValue(null as ReturnType<typeof createClient>);
    const result = await listTimeline();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C) listTimeline — query + scope filtering
// ---------------------------------------------------------------------------

describe("listTimeline — query + scope", () => {
  beforeEach(() => {
    (env.app as { demoMode: boolean; needsSupabase: boolean }).demoMode = false;
    (env.app as { demoMode: boolean; needsSupabase: boolean }).needsSupabase = false;
  });

  function makeSupabaseMock(rows: unknown[], error: unknown = null) {
    // Build a chainable query mock
    const queryMock = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      // Terminal call resolves with data/error
      then: vi.fn().mockImplementation((resolve: (v: { data: unknown; error: unknown }) => void) =>
        resolve({ data: rows, error })
      ),
    };
    // Make it thenable (Promise-like) so await works
    const fromMock = { from: vi.fn().mockReturnValue(queryMock) };
    vi.mocked(createClient).mockReturnValue(fromMock as unknown as ReturnType<typeof createClient>);
    return { fromMock, queryMock };
  }

  it("maps returned rows through mapTimelineRow", async () => {
    makeSupabaseMock([FULL_ROW]);
    const result = await listTimeline();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(FULL_ENTRY);
  });

  it("returns [] and logs on query error (graceful degrade)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    makeSupabaseMock([], { message: "relation does not exist" });
    const result = await listTimeline();
    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[knowledge/listTimeline]"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });

  it("applies entityType and entityId filters when scope is provided", async () => {
    const { queryMock } = makeSupabaseMock([]);
    await listTimeline({ entityType: "purchase_order", entityId: "po-999" });
    expect(queryMock.eq).toHaveBeenCalledWith("entity_type", "purchase_order");
    expect(queryMock.eq).toHaveBeenCalledWith("entity_id", "po-999");
  });

  it("does not call eq when scope has no entityType/entityId", async () => {
    const { queryMock } = makeSupabaseMock([]);
    await listTimeline({});
    expect(queryMock.eq).not.toHaveBeenCalled();
  });

  it("uses scope.limit when provided", async () => {
    const { queryMock } = makeSupabaseMock([]);
    await listTimeline({ limit: 25 });
    expect(queryMock.limit).toHaveBeenCalledWith(25);
  });

  it("defaults to 100 rows when limit not specified", async () => {
    const { queryMock } = makeSupabaseMock([]);
    await listTimeline();
    expect(queryMock.limit).toHaveBeenCalledWith(100);
  });

  it("orders by seq descending", async () => {
    const { queryMock } = makeSupabaseMock([]);
    await listTimeline();
    expect(queryMock.order).toHaveBeenCalledWith("seq", { ascending: false });
  });
});

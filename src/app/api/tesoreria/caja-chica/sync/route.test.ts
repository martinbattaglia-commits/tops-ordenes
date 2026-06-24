import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CajaChicaSyncReport } from "@/lib/tesoreria/caja-chica/types";

// Mockeamos el wiring para no cargar Drive/Supabase en el test de la route.
vi.mock("@/lib/tesoreria/caja-chica/sync", () => ({ runCajaChicaSync: vi.fn() }));

import { runCajaChicaSync } from "@/lib/tesoreria/caja-chica/sync";
import { GET, POST } from "./route";

const runMock = vi.mocked(runCajaChicaSync);

const baseReport: CajaChicaSyncReport = {
  runId: "r1", trigger: "cron", status: "completed", startedAt: "2026-06-23T00:05:00Z",
  finishedAt: "2026-06-23T00:05:01Z", durationMs: 123, fileId: "F", periodos: [2026],
  rowsParsed: 10, rowsInserted: 10, rowsChanged: 0, rowsRemoved: 0, warnings: 1, errors: 0,
  dryRun: false, message: "ok",
  perPeriodo: [{
    periodo: 2026, status: "completed", rowsParsed: 10, rowsInserted: 10, rowsChanged: 0, rowsRemoved: 0,
    saldoExcel: 2982, saldoCalc: 2982, saldoDelta: 0, saldoSource: "label", warnings: 1,
  }],
  events: [],
};

const req = (qs = "", headers: Record<string, string> = {}) =>
  new Request(`https://x/api/tesoreria/caja-chica/sync${qs}`, { method: "POST", headers });

beforeEach(() => {
  runMock.mockReset();
  delete process.env.CRON_SECRET;
});

describe("route /api/tesoreria/caja-chica/sync", () => {
  it("401 si CRON_SECRET seteado y no llega el Bearer correcto", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("200 + JSON estructurado con Bearer correcto", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    runMock.mockResolvedValue(baseReport);
    const res = await POST(req("", { authorization: "Bearer s3cr3t" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({
      success: true, status: "completed",
      rowsParsed: 10, rowsInserted: 10, warnings: 1,
      saldoExcel: 2982, saldoCalc: 2982, saldoDelta: 0, durationMs: 123,
    });
    expect(j.sync_log_id).toBe("r1");
    expect(runMock).toHaveBeenCalledWith({ trigger: "cron", dryRun: false }, undefined);
  });

  it("?dry=1 → dryRun true", async () => {
    runMock.mockResolvedValue({ ...baseReport, dryRun: true });
    await GET(req("?dry=1"));
    expect(runMock).toHaveBeenCalledWith({ trigger: "cron", dryRun: true }, undefined);
  });

  it("?periodo=2027 → override [2027]", async () => {
    runMock.mockResolvedValue({ ...baseReport, periodos: [2027] });
    await GET(req("?periodo=2027"));
    expect(runMock).toHaveBeenCalledWith({ trigger: "cron", dryRun: false }, [2027]);
  });

  it("?periodo inválido → 400, no ejecuta", async () => {
    const res = await GET(req("?periodo=abc"));
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("status error → 502", async () => {
    runMock.mockResolvedValue({ ...baseReport, status: "error", message: "Descarga falló" });
    const res = await POST(req());
    expect(res.status).toBe(502);
    const j = await res.json();
    expect(j.success).toBe(false);
    expect(j.status).toBe("error");
  });

  it("excepción del engine → 502 con error", async () => {
    runMock.mockRejectedValue(new Error("kaboom"));
    const res = await POST(req());
    expect(res.status).toBe(502);
    const j = await res.json();
    expect(j.error).toContain("kaboom");
  });
});

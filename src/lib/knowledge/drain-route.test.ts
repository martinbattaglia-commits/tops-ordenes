import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * KDW-001 — Cobertura permanente del guard del worker de Knowledge.
 *
 * Superficie bajo prueba: el route handler `/api/knowledge/drain`, que el cron de
 * GitHub Actions (`knowledge-drain.yml`, cada 5 minutos) invoca con `Authorization:
 * Bearer $CRON_SECRET` y sin cookie de sesión. Como la ruta está en la allowlist del
 * middleware (ver `src/lib/supabase/middleware.test.ts`), este guard es la ÚNICA
 * frontera de autenticación del endpoint: si se afloja, la cola queda drenable
 * desde internet. De ahí que la regresión se pruebe, no se suponga.
 *
 * Regla verificada: FAIL-CLOSED. Sin `CRON_SECRET` → 503 (misconfig visible, nunca
 * abierto); credencial ausente o incorrecta → 401. Ningún caso rechazado puede
 * ejecutar `drainKnowledge`.
 */

// El drenado se mockea: ningún caso debe tocar Supabase. Que el mock se haya
// invocado o no ES la evidencia de si la request alcanzó el handler.
vi.mock("@/lib/knowledge/drain", () => ({ drainKnowledge: vi.fn() }));

import { drainKnowledge } from "@/lib/knowledge/drain";
import { GET, POST } from "@/app/api/knowledge/drain/route";
import * as rutaDrain from "@/app/api/knowledge/drain/route";

const drainMock = vi.mocked(drainKnowledge);

const SECRET = "s3cr3t";

const req = (headers: Record<string, string> = {}, qs = "?dry=1") =>
  new Request(`https://tops-ordenes.netlify.app/api/knowledge/drain${qs}`, {
    method: "POST",
    headers,
  });

const okSummary = {
  status: "ok", dry: true, claimed: 0, processed: 0, failedRetried: 0, failedDead: 0,
  retries: 0, batches: 0, pendingRemaining: 0, avgEventMs: 0, maxEventMs: 0,
  durationMs: 1, correlationId: "kdw-001", errors: [],
} as unknown as Awaited<ReturnType<typeof drainKnowledge>>;

beforeEach(() => {
  drainMock.mockReset();
  drainMock.mockResolvedValue(okSummary);
  process.env.CRON_SECRET = SECRET;
});

describe("/api/knowledge/drain — auth fail-closed (KDW-001)", () => {
  it("sin CRON_SECRET configurado → 503 y no drena", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("CRON_SECRET no configurado");
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("CRON_SECRET vacío → 503 (no se degrada a abierto)", async () => {
    process.env.CRON_SECRET = "";
    const res = await POST(req({ authorization: "Bearer " }));
    expect(res.status).toBe(503);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("CRON_SECRET sólo whitespace → 503", async () => {
    process.env.CRON_SECRET = "   ";
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("sin header Authorization → 401 y no drena", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("Bearer incorrecto → 401 y no drena", async () => {
    const res = await POST(req({ authorization: "Bearer incorrecto" }));
    expect(res.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("credencial de otro esquema (Basic) → 401 y no drena", async () => {
    const res = await POST(req({ authorization: `Basic ${SECRET}` }));
    expect(res.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("el secret sin el prefijo Bearer → 401 y no drena", async () => {
    const res = await POST(req({ authorization: SECRET }));
    expect(res.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("Bearer válido → 200 y ALCANZA el handler con dry=1", async () => {
    const res = await POST(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect(drainMock).toHaveBeenCalledTimes(1);
    expect(drainMock).toHaveBeenCalledWith({ dry: true });
  });

  it("Bearer válido sin ?dry → drena de verdad (dry=false)", async () => {
    const res = await POST(req({ authorization: `Bearer ${SECRET}` }, ""));
    expect(res.status).toBe(200);
    expect(drainMock).toHaveBeenCalledWith({ dry: false });
  });

  it("cookie de sesión válida SIN Bearer → 401: la sesión no habilita el drenado", async () => {
    // La ruta es pública en el middleware, así que este guard es la única frontera:
    // ningún usuario logueado del ERP puede drenar la cola sin el secret del cron.
    const res = await POST(req({ cookie: "sb-access-token=token-de-usuario-real" }));
    expect(res.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("GET aplica el mismo guard que POST", async () => {
    const sinAuth = await GET(req());
    expect(sinAuth.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();

    const conAuth = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(conAuth.status).toBe(200);
    expect(drainMock).toHaveBeenCalledTimes(1);
  });
});

describe("/api/knowledge/drain — superficie expuesta (KDW-001)", () => {
  it("sólo se exportan GET y POST: ningún verbo queda sin guard", () => {
    // El allowlist del middleware abre la ruta para TODOS los métodos; si mañana
    // se agrega un PUT/DELETE sin pasar por requireCronAuth, queda abierto.
    const verbos = Object.keys(rutaDrain).filter((k) =>
      ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(k),
    );
    expect(verbos.sort()).toEqual(["GET", "POST"]);
  });
});

describe("/api/knowledge/drain — contrato de la respuesta exitosa (KDW-001)", () => {
  it("el 200 conserva exactamente sus campos y su mapeo", async () => {
    const res = await POST(req({ authorization: `Bearer ${SECRET}` }));
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(
      [
        "avg_event_ms", "batches", "claimed", "correlation_id", "dry", "duration_ms",
        "errors", "failed_dead", "failed_retried", "max_event_ms", "pending_remaining",
        "processed", "retries", "status", "success",
      ].sort(),
    );
    expect(j.success).toBe(true);
    expect(j.status).toBe("ok");
    expect(j.correlation_id).toBe("kdw-001");
  });

  it("status 'error' del drenado → 502 con success=false", async () => {
    drainMock.mockResolvedValue({ ...okSummary, status: "error" } as typeof okSummary);
    const res = await POST(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(502);
    expect((await res.json()).success).toBe(false);
  });

  it("excepción del drenado → 502 controlado (no 500 crudo)", async () => {
    drainMock.mockRejectedValue(new Error("boom"));
    const res = await POST(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("boom");
  });
});

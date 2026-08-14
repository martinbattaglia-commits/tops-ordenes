/**
 * WMS UI-1 · Doble envío.
 *
 * La garantía fuerte es del servidor (CAS de versión en
 * `decide_custody_integrity`); esta guardia evita además disparar la segunda
 * llamada. Se prueba CONTANDO ejecuciones, que es lo que importa, y por eso no
 * necesita DOM.
 */
import { describe, expect, it } from "vitest";
import { createSingleFlightGuard } from "@/lib/custody/single-flight";

describe("guardia de envío único", () => {
  it("dos clics simultáneos ejecutan la acción UNA sola vez", async () => {
    const guard = createSingleFlightGuard();
    let ejecuciones = 0;
    let liberar: (v: string) => void = () => {};
    const task = () =>
      new Promise<string>((res) => {
        ejecuciones += 1;
        liberar = res;
      });

    const a = guard.run("caso:release", task);
    const b = guard.run("caso:release", task); // el doble clic
    expect(guard.isPending("caso:release")).toBe(true);
    liberar("ok");

    expect(await a).toBe("ok");
    expect(await b).toBeUndefined(); // descartado, no encolado
    expect(ejecuciones).toBe(1);
    expect(guard.pendingCount()).toBe(0);
  });

  it("acciones distintas no se bloquean entre sí", async () => {
    const guard = createSingleFlightGuard();
    const [r, q] = await Promise.all([
      guard.run("caso:release", async () => "R"),
      guard.run("caso:quarantine", async () => "Q"),
    ]);
    expect([r, q]).toEqual(["R", "Q"]);
  });

  it("un fallo libera la guardia: el botón no queda muerto", async () => {
    const guard = createSingleFlightGuard();
    await expect(guard.run("k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(guard.isPending("k")).toBe(false);
    expect(await guard.run("k", async () => "segundo intento")).toBe("segundo intento");
  });

  it("tras completarse, una nueva acción vuelve a ejecutarse", async () => {
    const guard = createSingleFlightGuard();
    let n = 0;
    await guard.run("k", async () => { n += 1; });
    await guard.run("k", async () => { n += 1; });
    expect(n).toBe(2);
  });
});

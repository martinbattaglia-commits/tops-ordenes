import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceSession } from "./session";
import { FakeVoiceEngine } from "./__fixtures__/fake-engine";
import { VoicePermissionDeniedError } from "./errors";
import type { VoiceState } from "./types";

// Higiene: si una aserción falla antes de las restauraciones inline, los fake
// timers o el spy de console.warn fugarían al test siguiente.
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(overrides: Parameters<typeof createVoiceSession>[0] = {}) {
  const engine = new FakeVoiceEngine();
  const states: VoiceState[] = [];
  const finals: string[] = [];
  const errors: Error[] = [];

  const session = createVoiceSession({ engine, ...overrides });
  session.on("state", (s) => states.push(s));
  session.on("final", (t) => finals.push(t));
  session.on("error", (e) => errors.push(e));

  return { engine, session, states, finals, errors };
}

describe("VoiceSession", () => {
  it("recorre idle → listening → processing → idle y emite el texto final", async () => {
    const { engine, session, states, finals } = setup();

    await session.start();
    expect(session.state).toBe("listening");

    engine.emitFinal("hola   mundo");
    await session.stop();

    expect(states).toEqual(["listening", "processing", "idle"]);
    expect(finals).toEqual(["Hola mundo"]); // normalize() corrió
    expect(session.state).toBe("idle");
  });

  it("emite 'final' ANTES de transicionar a idle", async () => {
    const engine = new FakeVoiceEngine();
    const session = createVoiceSession({ engine });
    const log: string[] = [];

    session.on("final", () => log.push("final"));
    session.on("state", (s) => log.push(`state:${s}`));

    await session.start();
    engine.emitFinal("listo");
    await session.stop();

    expect(log).toEqual([
      "state:listening",
      "state:processing",
      "final",
      "state:idle",
    ]);
  });

  it("acumula varios segmentos finales en una sola inserción", async () => {
    const { engine, session, finals } = setup();

    await session.start();
    engine.emitFinal("cargar diez pallets");
    engine.emitFinal("en el depósito");
    await session.stop();

    expect(finals).toEqual(["Cargar diez pallets en el depósito"]);
  });

  it("los parciales se emiten pero NO forman parte del texto final", async () => {
    const { engine, session, finals } = setup();
    const partials: string[] = [];
    session.on("partial", (t) => partials.push(t));

    await session.start();
    engine.emitPartial("carg");
    engine.emitPartial("cargar diez");
    engine.emitFinal("cargar diez pallets");
    await session.stop();

    expect(partials).toEqual(["carg", "cargar diez"]);
    expect(finals).toEqual(["Cargar diez pallets"]);
  });

  it("cancel() descarta el texto, no es un error y aborta el motor", async () => {
    const { engine, session, states, finals, errors } = setup();

    await session.start();
    engine.emitFinal("esto se descarta");
    session.cancel();

    expect(session.state).toBe("idle");
    expect(states).toEqual(["listening", "idle"]);
    expect(finals).toEqual([]);
    expect(errors).toEqual([]);
    expect(engine.abortCalls).toBe(1);
    expect(engine.stopCalls).toBe(0);
  });

  it("maxDurationMs llama stop() y CONSERVA el texto", async () => {
    vi.useFakeTimers();
    const { engine, session, finals } = setup({ maxDurationMs: 1000 });

    await session.start();
    engine.emitFinal("no me borres");

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTicks();

    expect(engine.stopCalls).toBe(1);
    expect(engine.abortCalls).toBe(0);
    expect(finals).toEqual(["No me borres"]);
    vi.useRealTimers();
  });

  it("autoStopOnSilenceMs llama stop() y se reinicia con cada parcial", async () => {
    vi.useFakeTimers();
    const { engine, session, finals } = setup({ autoStopOnSilenceMs: 1000 });

    await session.start();
    await vi.advanceTimersByTimeAsync(800);
    engine.emitPartial("sigo hablando"); // reinicia el temporizador
    await vi.advanceTimersByTimeAsync(800);
    expect(engine.stopCalls).toBe(0);

    engine.emitFinal("terminé");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTicks();

    expect(engine.stopCalls).toBe(1);
    expect(finals).toEqual(["Terminé"]);
    vi.useRealTimers();
  });

  it("el guard de processing cierra la sesión y avisa por consola si el motor no responde", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { engine, session, finals } = setup({ processingGuardMs: 3000 });
    engine.stopHangs = true;

    await session.start();
    engine.emitFinal("rescatado por el guard");
    void session.stop();

    await vi.advanceTimersByTimeAsync(3000);
    await vi.runAllTicks();

    expect(session.state).toBe("idle");
    expect(finals).toEqual(["Rescatado por el guard"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("fake"),
    );
    warn.mockRestore();
    vi.useRealTimers();
  });

  it("un error del motor lleva a 'error' y descarta el texto", async () => {
    const { engine, session, states, finals, errors } = setup();

    await session.start();
    engine.emitFinal("se pierde");
    engine.emitError({ error: "network" });

    expect(states).toEqual(["listening", "error"]);
    expect(finals).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "network" });
  });

  it("un permiso denegado lanza VoicePermissionDeniedError y no arranca el motor", async () => {
    const engine = new FakeVoiceEngine();
    const session = createVoiceSession({
      engine,
      requestStream: async () => {
        throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      },
    });

    await expect(session.start()).rejects.toBeInstanceOf(
      VoicePermissionDeniedError,
    );
    expect(engine.started).toBe(false);
    expect(session.state).toBe("idle");
  });

  it("stop() sobre una sesión que no escucha es un no-op", async () => {
    const { engine, session } = setup();
    await session.stop();
    expect(engine.stopCalls).toBe(0);
    expect(session.state).toBe("idle");
  });

  it("dispose() libera todo y deja de emitir", async () => {
    const { engine, session, states } = setup();
    await session.start();
    session.dispose();

    expect(engine.abortCalls).toBe(1);
    engine.emitFinal("nadie escucha");
    expect(states).toEqual(["listening", "idle"]);
  });

  it("un motor que falla al arrancar deja la sesión en error y libera todo", async () => {
    const engine = new FakeVoiceEngine();
    engine.start = async () => {
      throw new Error("boom del motor");
    };
    const session = createVoiceSession({ engine });
    const states: VoiceState[] = [];
    const errors: Error[] = [];
    session.on("state", (s) => states.push(s));
    session.on("error", (e) => errors.push(e));

    await session.start(); // no rechaza: la falla se reporta por eventos

    expect(session.state).toBe("error");
    expect(states).toEqual(["listening", "error"]);
    expect(errors).toHaveLength(1);
    expect(engine.abortCalls).toBe(1); // fail() abortó y liberó
  });

  it("dispose() durante el pedido de permisos aborta el arranque huérfano", async () => {
    const engine = new FakeVoiceEngine();
    let resolveStream!: (v: MediaStream | null) => void;
    const session = createVoiceSession({
      engine,
      requestStream: () => new Promise((r) => (resolveStream = r)),
    });

    const starting = session.start(); // suspendido esperando el permiso
    session.dispose(); // el dueño desaparece (desmontaje, cierre de modal)
    resolveStream(null); // el permiso llega tarde
    await starting;

    expect(engine.started).toBe(false); // el motor JAMÁS arrancó
    expect(session.state).toBe("idle"); // nada quedó grabando
  });

  it("cancel() gana si corre mientras stop() está en vuelo: el texto se descarta", async () => {
    const { engine, session, finals } = setup();
    await session.start();
    engine.emitFinal("texto condenado");

    const stopping = session.stop(); // en vuelo: esperando engine.stop()
    session.cancel(); // el usuario cancela en la ventana
    await stopping;

    expect(finals).toEqual([]); // "cancelar descarta" gana
    expect(session.state).toBe("idle");
  });
});

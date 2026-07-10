import { beforeEach, describe, expect, it } from "vitest";
import { NexusVoice } from "./nexus-voice";
import { FakeVoiceEngine } from "./__fixtures__/fake-engine";
import { VoiceSessionAlreadyRunningError } from "./errors";

/**
 * capture() no se await-ea: arranca la sesión y resuelve por eventos.
 * `await Promise.resolve()` NO alcanza — start() encadena varios microtasks
 * (requestStream, engine.start). Un macrotask los deja a todos drenados.
 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  NexusVoice.configure({ sources: [{ id: "test", isEnabled: () => true }] });
  NexusVoice.active?.dispose();
});

describe("NexusVoice.acquire", () => {
  it("es estrictamente excluyente", () => {
    const engine = new FakeVoiceEngine();
    const first = NexusVoice.acquire({ engine });

    expect(NexusVoice.active).toBe(first);
    expect(() => NexusVoice.acquire({ engine: new FakeVoiceEngine() })).toThrow(
      VoiceSessionAlreadyRunningError,
    );

    first.dispose();
    expect(NexusVoice.active).toBeNull();
  });
});

describe("NexusVoice.capture", () => {
  it("resuelve el texto normalizado", async () => {
    const engine = new FakeVoiceEngine();
    const promise = NexusVoice.capture({ engine, headless: true });

    await flush();
    engine.emitFinal("cargar   pallets");
    await NexusVoice.active!.stop();

    await expect(promise).resolves.toBe("Cargar pallets");
    expect(NexusVoice.active).toBeNull();
  });

  it("resuelve null cuando el usuario cancela, sin lanzar", async () => {
    const engine = new FakeVoiceEngine();
    const promise = NexusVoice.capture({ engine, headless: true });

    await flush();
    engine.emitFinal("descartame");
    NexusVoice.active!.cancel();

    await expect(promise).resolves.toBeNull();
  });

  it("rechaza con el error del motor", async () => {
    const engine = new FakeVoiceEngine();
    const promise = NexusVoice.capture({ engine, headless: true });

    await flush();
    engine.emitError({ error: "network" });

    await expect(promise).rejects.toMatchObject({ code: "network" });
  });

  it('conflict "reject" rechaza si hay una sesión activa', async () => {
    const held = NexusVoice.acquire({ engine: new FakeVoiceEngine() });

    await expect(
      NexusVoice.capture({
        engine: new FakeVoiceEngine(),
        headless: true,
        conflict: "reject",
      }),
    ).rejects.toBeInstanceOf(VoiceSessionAlreadyRunningError);

    held.dispose();
  });

  it("el takeover llama stop() en la sesión anterior, nunca cancel()", async () => {
    const oldEngine = new FakeVoiceEngine();
    const previous = NexusVoice.acquire({ engine: oldEngine });
    const rescued: string[] = [];
    previous.on("final", (t) => rescued.push(t));

    await previous.start();
    oldEngine.emitFinal("texto de la sesión vieja");

    const newEngine = new FakeVoiceEngine();
    const promise = NexusVoice.capture({ engine: newEngine, headless: true });
    await flush();

    // La sesión vieja finalizó limpia y entregó su texto a SU dueño.
    expect(oldEngine.stopCalls).toBe(1);
    expect(oldEngine.abortCalls).toBe(0);
    expect(rescued).toEqual(["Texto de la sesión vieja"]);

    newEngine.emitFinal("texto nuevo");
    await NexusVoice.active!.stop();
    await expect(promise).resolves.toBe("Texto nuevo");
  });

  it("una AbortSignal cancela y resuelve null", async () => {
    const engine = new FakeVoiceEngine();
    const controller = new AbortController();
    const promise = NexusVoice.capture({
      engine,
      headless: true,
      signal: controller.signal,
    });

    await flush();
    controller.abort();

    await expect(promise).resolves.toBeNull();
  });
});

describe("NexusVoice.subscribe", () => {
  it("publica la sesión de capture() no-headless y la retira al terminar", async () => {
    const engine = new FakeVoiceEngine();
    const seen: Array<string | null> = [];
    const off = NexusVoice.subscribe((s) => seen.push(s ? "sesión" : null));

    const promise = NexusVoice.capture({ engine });
    await flush();
    engine.emitFinal("hola");
    await NexusVoice.active!.stop();
    await promise;

    expect(seen).toEqual(["sesión", null]);
    off();
  });

  it("headless no publica nada", async () => {
    const engine = new FakeVoiceEngine();
    const seen: unknown[] = [];
    const off = NexusVoice.subscribe((s) => seen.push(s));

    const promise = NexusVoice.capture({ engine, headless: true });
    await flush();
    NexusVoice.active!.cancel();
    await promise;

    expect(seen).toEqual([]);
    off();
  });
});

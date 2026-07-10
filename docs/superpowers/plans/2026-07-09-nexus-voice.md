# Nexus Voice v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir Nexus Voice, un servicio de plataforma que captura voz y devuelve texto limpio, consumible desde React (Modo Campo) y desde código plano (Modo Global), sin lógica de negocio.

**Architecture:** Núcleo puro sin React en `src/lib/voice/`, con separación estricta entre `VoiceEngine` (habla con el proveedor de reconocimiento) y `VoiceSession` (administra estados, permisos, cancelación, timeouts, medidor y ciclo de vida). Sobre esa sesión única se apoyan dos consumidores: `useVoiceSession` + `VoiceField` (React) y `NexusVoice.capture()` (Promise). La inserción de texto usa el setter nativo de `value` + un evento `input` sintetizado, de modo que React no puede distinguir voz de teclado.

**Tech Stack:** TypeScript 5.6 (`target: ES2022`, `strict: true`), Next.js 14.2 App Router, React 18, Tailwind 3.4, Vitest 2.1 (entorno `node`), Web Speech API.

**Spec:** [`docs/superpowers/specs/2026-07-09-nexus-voice-design.md`](../specs/2026-07-09-nexus-voice-design.md)

**Worktree:** `~/CODE/tops-ordenes-nexus-voice` · rama `feat/nexus-voice` · base `0c361c0`

---

## Global Constraints

Cada tarea hereda estas reglas. Violarlas invalida la tarea.

- **Cero dependencias nuevas.** Ni de runtime ni de desarrollo. No se instala jsdom, ni testing-library, ni nada.
- **`src/lib/voice/` NUNCA importa React.** Ni `react`, ni `next`. Verificable con grep.
- **Las APIs del navegador viven solo en `engines/`, `meter.ts` y `dom.ts`**, cada una detrás de una detección de capacidad.
- **`normalize()` corre siempre**, después del `Punctuator`, antes de `insert()`.
- **`Escape` = Cancelar. Siempre. En toda la plataforma.** Cancelar descarta el texto.
- **`stop()` conserva el texto. `cancel()` lo descarta.** Un timeout siempre llama `stop()`, jamás `cancel()`.
- **Los resultados parciales nunca modifican el campo.** La inserción ocurre exactamente una vez, con el resultado final.
- **`punctuationStrategy` por defecto: `"none"`.** `"ai"` lanza un `Error` común (no un `VoiceError`).
- **Cuatro estados, ninguno más:** `idle` · `listening` · `processing` · `error`.
- **No tocar `main` ni el PR #46.** No pushear, no mergear, no deployar.
- **Comandos:** `npm test` (todo), `npx vitest run <archivo>` (uno), `npm run typecheck`, `npm run dev` (puerto 3030).

**Orden de eventos en la finalización** (contrato del que dependen `capture()` y el takeover): la sesión emite `final` **antes** de transicionar a `idle`. Nunca al revés.

---

## Estructura de archivos

| Archivo | Responsabilidad | Testeable en `node` |
|---|---|---|
| `src/lib/voice/types.ts` | Tipos y contratos. Sin lógica. | — |
| `src/lib/voice/errors.ts` | Taxonomía de errores. | sí |
| `src/lib/voice/machine.ts` | Reducer puro de los 4 estados. | sí |
| `src/lib/voice/normalize.ts` | Normalización determinística. | sí |
| `src/lib/voice/insert.ts` | Aritmética de inserción en el caret. | sí |
| `src/lib/voice/punctuation/{index,none,commands,provider}.ts` | Estrategias de puntuación. | sí |
| `src/lib/voice/config.ts` | Resolver de habilitación por fuentes. | sí |
| `src/lib/voice/engines/web-speech.ts` | Adaptador de Web Speech API. | no (navegador) |
| `src/lib/voice/engines/index.ts` | `resolveEngine()` + detección de soporte. | no (navegador) |
| `src/lib/voice/__fixtures__/fake-engine.ts` | `FakeVoiceEngine` para tests. | — |
| `src/lib/voice/meter.ts` | `getUserMedia` + `AnalyserNode` → nivel 0..1. | no (navegador) |
| `src/lib/voice/dom.ts` | Inserción en un `<input>`/`<textarea>` real. | no (navegador) |
| `src/lib/voice/session.ts` | `VoiceSession`. El corazón. | sí (con `FakeVoiceEngine`) |
| `src/lib/voice/nexus-voice.ts` | Fachada singleton: `acquire`, `capture`, `subscribe`. | sí |
| `src/components/voice/useVoiceSession.ts` | Binding React ↔ `VoiceSession`. | no |
| `src/components/voice/VoiceMicButton.tsx` | UI de los 4 estados + barras. | no |
| `src/components/voice/VoiceField.tsx` | Modo Campo. | no |
| `src/components/voice/VoiceOverlay.tsx` | Modo Global. | no |

Modificados: `vitest.config.ts`, `src/app/globals.css`, `src/components/shell/Shell.tsx`, `src/app/(app)/copilot/CopilotChat.tsx`, y los 14 archivos con `<textarea>`.

---

## Task 1: Tipos, errores y máquina de estados

**Files:**
- Create: `src/lib/voice/types.ts`
- Create: `src/lib/voice/errors.ts`
- Create: `src/lib/voice/machine.ts`
- Test: `src/lib/voice/machine.test.ts`
- Test: `src/lib/voice/errors.test.ts`
- Modify: `vitest.config.ts:29` (agregar el patrón de `voice`)

**Interfaces:**
- Consumes: nada.
- Produces: `VoiceState`, `VoiceAction`, `transition()`, `VoiceError` + subclases, `isAbortError()`, `toVoiceError()`, `VoiceEngine`, `VoiceEngineCapabilities`, `VoiceEngineStartContext`, `VoiceSession`, `VoiceSessionOptions`, `VoiceSessionEvents`, `VoiceMeter`, `VoiceMeterFactory`, `PunctuationStrategy`, `Punctuator`.

- [ ] **Step 1: Registrar los tests de voice en Vitest**

En `vitest.config.ts`, agregar una línea al array `include`, inmediatamente después de `"src/lib/ai/**/*.test.ts",` (línea 29):

```ts
      "src/lib/ai/**/*.test.ts",
      "src/lib/voice/**/*.test.ts",
    ],
    environment: "node",
```

- [ ] **Step 2: Escribir el test que falla**

Crear `src/lib/voice/machine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { transition } from "./machine";

describe("transition", () => {
  it("arranca la escucha desde idle", () => {
    expect(transition("idle", { type: "START" })).toBe("listening");
  });

  it("arranca la escucha desde error (reintento)", () => {
    expect(transition("error", { type: "START" })).toBe("listening");
  });

  it("STOP lleva de listening a processing", () => {
    expect(transition("listening", { type: "STOP" })).toBe("processing");
  });

  it("CANCEL lleva a idle desde listening y desde processing", () => {
    expect(transition("listening", { type: "CANCEL" })).toBe("idle");
    expect(transition("processing", { type: "CANCEL" })).toBe("idle");
  });

  it("SETTLED cierra processing en idle", () => {
    expect(transition("processing", { type: "SETTLED" })).toBe("idle");
  });

  it("FAIL lleva a error desde listening y desde processing", () => {
    expect(transition("listening", { type: "FAIL" })).toBe("error");
    expect(transition("processing", { type: "FAIL" })).toBe("error");
  });

  it("DISMISS limpia el error", () => {
    expect(transition("error", { type: "DISMISS" })).toBe("idle");
  });

  it("es total: una acción inválida no cambia el estado", () => {
    expect(transition("idle", { type: "STOP" })).toBe("idle");
    expect(transition("idle", { type: "SETTLED" })).toBe("idle");
    expect(transition("processing", { type: "START" })).toBe("processing");
    expect(transition("listening", { type: "START" })).toBe("listening");
  });
});
```

- [ ] **Step 3: Verificar que falla**

Run: `npx vitest run src/lib/voice/machine.test.ts`
Expected: FAIL — `Failed to resolve import "./machine"`

- [ ] **Step 4: Escribir `types.ts`**

```ts
/** Los cuatro estados oficiales. No se agregan estados intermedios. */
export type VoiceState = "idle" | "listening" | "processing" | "error";

export type VoiceAction =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "CANCEL" }
  | { type: "SETTLED" }
  | { type: "FAIL" }
  | { type: "DISMISS" };

export type PunctuationStrategy = "none" | "provider" | "commands" | "ai";

export interface Punctuator {
  readonly id: PunctuationStrategy;
  apply(text: string): Promise<string>;
}

export interface VoiceEngineCapabilities {
  /** ¿Emite texto mientras el usuario habla? */
  partialResults: boolean;
  /** ¿Consume el MediaStream que abre la sesión, o abre el suyo? */
  requiresMediaStream: boolean;
  /** ¿Devuelve texto ya puntuado? */
  providesPunctuation: boolean;
  locales: readonly string[] | "any";
}

export interface VoiceEngineStartContext {
  locale: string;
  /** Provisto por la sesión. Los motores que no lo necesitan lo ignoran. */
  stream: MediaStream | null;
  onPartial(text: string): void;
  /** Un motor continuo emite varios segmentos finales. La sesión los acumula. */
  onFinal(text: string): void;
  onError(error: unknown): void;
}

export interface VoiceEngine {
  readonly id: string;
  readonly capabilities: VoiceEngineCapabilities;
  isAvailable(): boolean;
  start(ctx: VoiceEngineStartContext): Promise<void>;
  /** Corte amable: esperar el resultado final. */
  stop(): Promise<void>;
  /** Corte duro: descartar. */
  abort(): void;
}

export interface VoiceMeter {
  onLevel(cb: (rms: number) => void): () => void;
  stop(): void;
}

export type VoiceMeterFactory = (stream: MediaStream) => VoiceMeter;

export interface VoiceSessionEvents {
  state: (state: VoiceState) => void;
  /** Crudo, sin normalizar. NUNCA toca el campo. */
  partial: (text: string) => void;
  level: (rms: number) => void;
  /** Puntuado + normalizado. Se emite ANTES de la transición a idle. */
  final: (text: string) => void;
  error: (error: VoiceErrorLike) => void;
}

/** Estructura mínima de un error de voz, para evitar un ciclo de imports. */
export interface VoiceErrorLike extends Error {
  readonly code: string;
}

export interface VoiceSessionOptions {
  /** Por defecto "es-AR". */
  locale?: string;
  engine?: VoiceEngine;
  createMeter?: VoiceMeterFactory;
  /** Por defecto "none". */
  punctuationStrategy?: PunctuationStrategy;
  /** Desactivado por defecto. Al vencer llama stop(), NUNCA cancel(). */
  autoStopOnSilenceMs?: number;
  /** Red de seguridad. Por defecto 120_000. Llama stop(), NUNCA cancel(). */
  maxDurationMs?: number;
  /** Por defecto 3_000. Si vence, se registra un warning interno. */
  processingGuardMs?: number;
}

export interface VoiceSession {
  readonly state: VoiceState;
  start(): Promise<void>;
  /** FINALIZAR: conserva el texto. */
  stop(): Promise<void>;
  /** CANCELAR: descarta el texto. No es un error. */
  cancel(): void;
  on<K extends keyof VoiceSessionEvents>(
    event: K,
    cb: VoiceSessionEvents[K],
  ): () => void;
  dispose(): void;
}
```

- [ ] **Step 5: Escribir `errors.ts`**

`target` es `ES2022`, así que `class X extends Error` e `instanceof` funcionan sin `setPrototypeOf`.

```ts
export type VoiceErrorCode =
  | "permission-denied"
  | "engine-unavailable"
  | "recognition"
  | "no-speech"
  | "network"
  | "no-microphone"
  | "session-already-running";

/**
 * La cancelación del usuario NO está en esta taxonomía, por definición:
 * cancel() lleva a idle y capture() resuelve null.
 */
export class VoiceError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = new.target.name;
  }
}

export class VoicePermissionDeniedError extends VoiceError {
  constructor(cause?: unknown) {
    super(
      "permission-denied",
      "Nexus necesita permiso para usar el micrófono. Habilitalo desde el candado de la barra de direcciones.",
      cause,
    );
  }
}

export class VoiceEngineUnavailableError extends VoiceError {
  constructor(cause?: unknown) {
    super(
      "engine-unavailable",
      "El dictado por voz no está disponible en este navegador.",
      cause,
    );
  }
}

export class VoiceRecognitionError extends VoiceError {
  constructor(
    code: Extract<
      VoiceErrorCode,
      "recognition" | "no-speech" | "network" | "no-microphone"
    >,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, cause);
  }
}

export class VoiceSessionAlreadyRunningError extends VoiceError {
  constructor() {
    super(
      "session-already-running",
      "Ya hay una captura de voz activa en otra parte de Nexus.",
    );
  }
}

const MESSAGES: Record<string, string> = {
  "no-speech": "No te escuchamos. Probá de nuevo.",
  network: "El reconocimiento de voz no está disponible en este momento.",
  "no-microphone": "No detectamos ningún micrófono conectado.",
  recognition: "No pudimos procesar el audio. Probá de nuevo.",
};

/**
 * ¿Esta señal del motor es un aborto que pedimos nosotros?
 *
 * `cancel()` llama a `engine.abort()`, y los motores responden emitiendo lo que
 * parece un error. NO lo es: la cancelación del usuario no forma parte de la
 * taxonomía, por definición del diseño (spec §6.1 y §11).
 *
 * Vive acá, y no dentro de cada motor, para que un motor futuro (OpenAI, Azure,
 * propio) tenga UN solo lugar al que preguntarle, en vez de tener que acordarse
 * de comparar strings por su cuenta. El invariante deja de depender de que cada
 * implementación lo respete de memoria.
 */
export function isAbortError(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  if ("error" in raw && (raw as { error: unknown }).error === "aborted") return true;
  if ("name" in raw && (raw as { name: unknown }).name === "AbortError") return true;
  return false;
}

/**
 * Traduce un error del motor a la taxonomía de Nexus Voice.
 *
 * NUNCA la invoques con un aborto intencional: filtralo antes con
 * `isAbortError()`. Si un aborto llega hasta acá, se clasifica como
 * `VoiceRecognitionError` y el usuario que solo canceló ve un error espurio.
 */
export function toVoiceError(raw: unknown): VoiceError {
  if (raw instanceof VoiceError) return raw;

  const name =
    typeof raw === "object" && raw !== null && "name" in raw
      ? String((raw as { name: unknown }).name)
      : "";
  const errorCode =
    typeof raw === "object" && raw !== null && "error" in raw
      ? String((raw as { error: unknown }).error)
      : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return new VoicePermissionDeniedError(raw);
  }
  if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
    return new VoicePermissionDeniedError(raw);
  }
  if (name === "NotFoundError" || errorCode === "audio-capture") {
    return new VoiceRecognitionError("no-microphone", MESSAGES["no-microphone"]!, raw);
  }
  if (errorCode === "no-speech") {
    return new VoiceRecognitionError("no-speech", MESSAGES["no-speech"]!, raw);
  }
  if (errorCode === "network") {
    return new VoiceRecognitionError("network", MESSAGES["network"]!, raw);
  }
  return new VoiceRecognitionError("recognition", MESSAGES["recognition"]!, raw);
}
```

- [ ] **Step 5b: Escribir `errors.test.ts`**

El invariante "cancelar nunca es un error" tiene que estar cubierto por un test, no
sostenido por la memoria de quien escriba el próximo motor.

```ts
import { describe, expect, it } from "vitest";
import {
  isAbortError,
  toVoiceError,
  VoiceError,
  VoicePermissionDeniedError,
  VoiceRecognitionError,
} from "./errors";

describe("isAbortError", () => {
  it("reconoce el aborto de Web Speech", () => {
    expect(isAbortError({ error: "aborted" })).toBe(true);
  });

  it("reconoce el AbortError del DOM", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("no confunde un error real con un aborto", () => {
    expect(isAbortError({ error: "network" })).toBe(false);
    expect(isAbortError({ error: "no-speech" })).toBe(false);
    expect(isAbortError({ name: "NotAllowedError" })).toBe(false);
  });

  it("tolera entradas basura", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("aborted")).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });
});

describe("toVoiceError", () => {
  it("mapea el permiso denegado", () => {
    expect(toVoiceError({ name: "NotAllowedError" })).toBeInstanceOf(
      VoicePermissionDeniedError,
    );
    expect(toVoiceError({ error: "not-allowed" })).toBeInstanceOf(
      VoicePermissionDeniedError,
    );
  });

  it("mapea los errores del reconocedor con su código", () => {
    expect(toVoiceError({ error: "network" })).toMatchObject({ code: "network" });
    expect(toVoiceError({ error: "no-speech" })).toMatchObject({ code: "no-speech" });
    expect(toVoiceError({ error: "audio-capture" })).toMatchObject({
      code: "no-microphone",
    });
  });

  it("cae en 'recognition' ante algo desconocido", () => {
    expect(toVoiceError(new Error("qué sé yo"))).toMatchObject({ code: "recognition" });
  });

  it("devuelve tal cual un VoiceError que ya lo era", () => {
    const original = new VoicePermissionDeniedError();
    expect(toVoiceError(original)).toBe(original);
  });

  it("preserva instanceof en las subclases (target ES2022)", () => {
    const err = new VoiceRecognitionError("network", "x");
    expect(err).toBeInstanceOf(VoiceRecognitionError);
    expect(err).toBeInstanceOf(VoiceError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("VoiceRecognitionError");
  });
});
```

- [ ] **Step 6: Escribir `machine.ts`**

```ts
import type { VoiceAction, VoiceState } from "./types";

/**
 * Reducer puro y total: toda combinación (estado, acción) devuelve un estado.
 * Una acción inválida para el estado actual lo deja intacto.
 */
export function transition(state: VoiceState, action: VoiceAction): VoiceState {
  switch (state) {
    case "idle":
      return action.type === "START" ? "listening" : "idle";

    case "listening":
      if (action.type === "STOP") return "processing";
      if (action.type === "CANCEL") return "idle";
      if (action.type === "FAIL") return "error";
      return "listening";

    case "processing":
      if (action.type === "SETTLED" || action.type === "CANCEL") return "idle";
      if (action.type === "FAIL") return "error";
      return "processing";

    case "error":
      if (action.type === "START") return "listening";
      if (action.type === "DISMISS" || action.type === "CANCEL") return "idle";
      return "error";
  }
}
```

- [ ] **Step 7: Verificar que pasa**

Run: `npx vitest run src/lib/voice/machine.test.ts`
Expected: PASS — 8 tests.

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/lib/voice/types.ts src/lib/voice/errors.ts src/lib/voice/machine.ts src/lib/voice/machine.test.ts
git commit -m "feat(voice): tipos, taxonomía de errores y máquina de estados"
```

---

## Task 2: Normalización determinística

**Files:**
- Create: `src/lib/voice/normalize.ts`
- Test: `src/lib/voice/normalize.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `normalize(input: string): string`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/voice/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalize } from "./normalize";

describe("normalize", () => {
  it("recorta y colapsa espacios", () => {
    expect(normalize("  hola   mundo  ")).toBe("Hola mundo");
  });

  it("normaliza a Unicode NFC", () => {
    const descompuesto = "an\u0303o"; // NFD: n + tilde combinante
    expect(descompuesto).not.toBe("a\u00f1o"); // distintos antes de normalizar
    expect(normalize(descompuesto)).toBe("Año");
    expect(normalize(descompuesto)).toBe(normalize("año"));
  });

  it("elimina el espacio previo a un signo de puntuación", () => {
    expect(normalize("hola , mundo")).toBe("Hola, mundo");
    expect(normalize("listo ?")).toBe("Listo?");
  });

  it("capitaliza la primera letra y las que siguen a . ! ?", () => {
    expect(normalize("hola. como estás")).toBe("Hola. Como estás");
    expect(normalize("pará! seguí")).toBe("Pará! Seguí");
    expect(normalize("¿sí? claro")).toBe("¿Sí? Claro");
  });

  it("no capitaliza dentro de un número decimal", () => {
    expect(normalize("pesan 3.5 kg")).toBe("Pesan 3.5 kg");
  });

  it("NO capitaliza cuando el dictado empieza con un número", () => {
    // En un ERP de logística se dicta la cantidad primero. Si el prefijo de la
    // mayúscula inicial se comiera los dígitos, "12 pallets" sería "12 Pallets".
    expect(normalize("12 pallets al depósito")).toBe("12 pallets al depósito");
    expect(normalize("3.5 kg pesan")).toBe("3.5 kg pesan");
    expect(normalize("35kg de mercadería")).toBe("35kg de mercadería");
    expect(normalize("1000 unidades ANMAT")).toBe("1000 unidades ANMAT");
  });

  it("sí capitaliza después de un signo de apertura", () => {
    expect(normalize("¿sí? claro")).toBe("¿Sí? Claro");
    expect(normalize("(nota importante")).toBe("(Nota importante");
    expect(normalize('"urgente" dijo el cliente')).toBe('"Urgente" dijo el cliente');
    expect(normalize("“urgente” dijo el cliente")).toBe("“Urgente” dijo el cliente");
  });

  it("capitaliza después de un salto de párrafo", () => {
    expect(normalize("fin.\n\nnueva sección")).toBe("Fin.\n\nNueva sección");
  });

  it("normaliza CRLF a LF", () => {
    expect(normalize("uno\r\ndos")).toBe("Uno\ndos");
  });

  it("preserva los saltos de línea y colapsa los espacios que los rodean", () => {
    expect(normalize("hola \n mundo")).toBe("Hola\nmundo");
    expect(normalize("uno\n\n\n\ndos")).toBe("Uno\n\ndos");
  });

  it("devuelve cadena vacía para una entrada vacía o de solo espacios", () => {
    expect(normalize("")).toBe("");
    expect(normalize("   \n  ")).toBe("");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/voice/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "./normalize"`

- [ ] **Step 3: Implementar**

Crear `src/lib/voice/normalize.ts`:

```ts
/**
 * Normalización determinística e inequívoca. Corre SIEMPRE, después del
 * Punctuator. No interpreta comandos hablados ni infiere puntuación:
 * eso es responsabilidad de src/lib/voice/punctuation/.
 */
export function normalize(input: string): string {
  let out = input.normalize("NFC");

  // Saltos de línea uniformes.
  out = out.replace(/\r\n?/g, "\n");

  // Colapsar espacios y tabulaciones (sin tocar los saltos de línea).
  out = out.replace(/[ \t]+/g, " ");

  // Los espacios que rodean un salto de línea se descartan.
  out = out.replace(/[ \t]*\n[ \t]*/g, "\n");

  // Como máximo un párrafo en blanco.
  out = out.replace(/\n{3,}/g, "\n\n");

  // Sin espacio antes de un signo de puntuación de cierre.
  out = out.replace(/[ \t]+([,.;:!?)])/g, "$1");

  out = out.trim();
  if (out.length === 0) return "";

  // Mayúscula inicial.
  //
  // El prefijo salta signos de apertura y espacios (`¿`, `¡`, `(`, comillas)
  // pero se DETIENE ante un dígito. Si aceptara cualquier no-letra (`\P{L}`),
  // "12 pallets al depósito" se convertiría en "12 Pallets al depósito": en un
  // ERP de logística el dictado arranca con la cantidad, y ese es el caso
  // normal, no el borde.
  out = out.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (_m, prefix: string, letter: string) =>
    prefix + letter.toLocaleUpperCase("es"),
  );

  // Mayúscula después de . ! ? seguidos de al menos un espacio.
  // El espacio obligatorio evita capitalizar la parte decimal de "3.5 kg".
  out = out.replace(
    /([.!?])(\s+)(\p{L})/gu,
    (_m, punct: string, gap: string, letter: string) =>
      punct + gap + letter.toLocaleUpperCase("es"),
  );

  return out;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/voice/normalize.test.ts`
Expected: PASS — 11 tests.

> Si `normalize("¿sí? claro")` falla, revisá que el `\P{L}*` de la mayúscula inicial
> deje pasar el `¿` antes de capitalizar la `s`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/normalize.ts src/lib/voice/normalize.test.ts
git commit -m "feat(voice): normalización determinística del transcripto"
```

---

## Task 3: Aritmética de inserción

**Files:**
- Create: `src/lib/voice/insert.ts`
- Test: `src/lib/voice/insert.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `planInsertion(value: string, selStart: number, selEnd: number, text: string): InsertionResult`, con `InsertionResult = { value: string; caretStart: number; caretEnd: number }`. En una inserción, `caretStart === caretEnd` (caret colapsado al final de lo insertado). En un no-op con selección activa, se devuelven `selStart`/`selEnd` intactos: la selección del usuario es **representable**, no un acuerdo tácito entre callers.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/voice/insert.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planInsertion } from "./insert";

/** Atajo para el caso común: inserción con caret colapsado al final. */
const at = (value: string, caret: number) => ({
  value,
  caretStart: caret,
  caretEnd: caret,
});

describe("planInsertion", () => {
  it("inserta en el caret agregando un espacio separador", () => {
    expect(planInsertion("Hola Juan,", 10, 10, "¿Cómo estás?")).toEqual(
      at("Hola Juan, ¿Cómo estás?", 23),
    );
  });

  it("reemplaza la selección cuando selStart !== selEnd", () => {
    expect(planInsertion("uno dos tres", 4, 7, "cuatro")).toEqual(
      at("uno cuatro tres", 10),
    );
  });

  it("no antepone espacio si el texto empieza con puntuación", () => {
    expect(planInsertion("hola", 4, 4, ", mundo")).toEqual(at("hola, mundo", 11));
  });

  it("no antepone espacio después de un carácter de apertura", () => {
    expect(planInsertion("(", 1, 1, "nota")).toEqual(at("(nota", 5));
    expect(planInsertion("dice: ", 6, 6, "sí")).toEqual(at("dice: sí", 8));
  });

  it("SÍ antepone espacio después de dos puntos secos", () => {
    // ":" es puntuación de cierre, no de apertura: "Notas:" + dictado debe dar
    // "Notas: hola", nunca "Notas:hola".
    expect(planInsertion("Notas:", 6, 6, "hola")).toEqual(at("Notas: hola", 11));
  });

  it("no antepone espacio en un campo vacío", () => {
    expect(planInsertion("", 0, 0, "primero")).toEqual(at("primero", 7));
  });

  it("agrega un espacio posterior si lo que sigue es una palabra", () => {
    expect(planInsertion("ab cd", 3, 3, "X")).toEqual(at("ab X cd", 5));
  });

  it("no agrega espacio posterior antes de puntuación", () => {
    expect(planInsertion("hola .", 5, 5, "Juan")).toEqual(at("hola Juan.", 9));
  });

  it("ignora un texto vacío o de solo espacios, preservando el caret", () => {
    expect(planInsertion("hola", 2, 2, "   ")).toEqual({
      value: "hola",
      caretStart: 2,
      caretEnd: 2,
    });
  });

  it("un no-op con selección activa PRESERVA la selección", () => {
    // Si el dictado vino vacío, el usuario no pierde lo que tenía seleccionado.
    expect(planInsertion("uno dos tres", 4, 7, "  ")).toEqual({
      value: "uno dos tres",
      caretStart: 4,
      caretEnd: 7,
    });
  });
});
```

> El caso de `"hola ."` merece una lectura atenta: con el caret en 5, `after = "."`
> es puntuación, así que no se agrega espacio de cola, y el espacio que ya existía en
> la posición 4 hace de separador delantero — por eso el caret final es 9, no 10.
> Y el último caso es el motivo de la interfaz `{caretStart, caretEnd}`: un no-op con
> selección activa la devuelve intacta, para que ningún caller pueda colapsarla.

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/voice/insert.test.ts`
Expected: FAIL — `Failed to resolve import "./insert"`

- [ ] **Step 3: Implementar**

Crear `src/lib/voice/insert.ts`:

```ts
export interface InsertionResult {
  value: string;
  /** En una inserción, caretStart === caretEnd (caret colapsado al final). */
  caretStart: number;
  /** En un no-op con selección activa, [caretStart, caretEnd] la preservan. */
  caretEnd: number;
}

/**
 * Caracteres tras los cuales NO se antepone un espacio separador.
 * ":" NO está acá a propósito: es puntuación de cierre. "Notas:" + dictado
 * debe dar "Notas: hola", nunca "Notas:hola".
 */
const OPENERS = new Set(["", " ", "\t", "\n", "(", "[", "¿", "¡", '"', "'"]);

/** Caracteres antes de los cuales NO se agrega un espacio de cola. */
const CLOSERS = new Set([",", ".", ";", ":", "!", "?", ")", "]", "\n", " ", "\t"]);

/**
 * Calcula el resultado de insertar `text` en un campo, sin tocar el DOM.
 * Si hay una selección activa, la reemplaza. Si no, inserta en el caret.
 *
 * Precondición: 0 <= selStart <= selEnd <= value.length — exactamente lo que
 * entregan selectionStart/selectionEnd de un <input>/<textarea> reales. La
 * función no sanea índices inventados.
 */
export function planInsertion(
  value: string,
  selStart: number,
  selEnd: number,
  text: string,
): InsertionResult {
  const trimmed = text.trim();
  // No-op: nada que insertar. La selección del usuario se preserva tal cual.
  if (trimmed.length === 0) {
    return { value, caretStart: selStart, caretEnd: selEnd };
  }

  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);

  const prevChar = before.slice(-1);
  const startsWithPunct = CLOSERS.has(trimmed[0]!);
  const lead = OPENERS.has(prevChar) || startsWithPunct ? "" : " ";

  const nextChar = after.slice(0, 1);
  const trail = nextChar.length > 0 && !CLOSERS.has(nextChar) ? " " : "";

  const inserted = lead + trimmed + trail;
  const caret = before.length + inserted.length;
  return { value: before + inserted + after, caretStart: caret, caretEnd: caret };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/voice/insert.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/insert.ts src/lib/voice/insert.test.ts
git commit -m "feat(voice): aritmética pura de inserción en el caret"
```

---

## Task 4: Estrategias de puntuación

**Files:**
- Create: `src/lib/voice/punctuation/none.ts`
- Create: `src/lib/voice/punctuation/provider.ts`
- Create: `src/lib/voice/punctuation/commands.ts`
- Create: `src/lib/voice/punctuation/index.ts`
- Test: `src/lib/voice/punctuation/commands.test.ts`
- Test: `src/lib/voice/punctuation/index.test.ts`

**Interfaces:**
- Consumes: `Punctuator`, `PunctuationStrategy`, `VoiceEngine` (Task 1).
- Produces: `applyCommands(text: string): string`, `resolvePunctuator(strategy: PunctuationStrategy, engine: VoiceEngine): Punctuator`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/lib/voice/punctuation/commands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyCommands } from "./commands";

describe("applyCommands", () => {
  it("interpreta comandos multi-palabra inequívocos", () => {
    expect(applyCommands("hola nueva línea mundo")).toBe("hola \n mundo");
    expect(applyCommands("uno nuevo párrafo dos")).toBe("uno \n\n dos");
    expect(applyCommands("fin punto y aparte inicio")).toBe("fin .\n inicio");
    expect(applyCommands("qué pasa signo de interrogación")).toBe("qué pasa ?");
    expect(applyCommands("cuidado signo de exclamación")).toBe("cuidado !");
  });

  it("acepta las variantes sin tilde", () => {
    expect(applyCommands("hola nueva linea mundo")).toBe("hola \n mundo");
    expect(applyCommands("uno nuevo parrafo dos")).toBe("uno \n\n dos");
  });

  it("es insensible a mayúsculas", () => {
    expect(applyCommands("hola NUEVA LÍNEA mundo")).toBe("hola \n mundo");
  });

  it("NUNCA reemplaza las palabras aisladas 'punto' y 'coma'", () => {
    expect(applyCommands("el punto de encuentro")).toBe("el punto de encuentro");
    expect(applyCommands("que coma tranquilo")).toBe("que coma tranquilo");
    expect(applyCommands("punto de venta")).toBe("punto de venta");
  });

  it("prefiere 'punto y aparte' sobre cualquier coincidencia parcial", () => {
    expect(applyCommands("listo punto y aparte")).toBe("listo .\n");
  });

  it("deja intacto un texto sin comandos", () => {
    expect(applyCommands("descargar en el depósito de Magaldi")).toBe(
      "descargar en el depósito de Magaldi",
    );
  });
});
```

Crear `src/lib/voice/punctuation/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolvePunctuator } from "./index";
import type { VoiceEngine } from "../types";

function engineWith(providesPunctuation: boolean): VoiceEngine {
  return {
    id: "fake",
    capabilities: {
      partialResults: true,
      requiresMediaStream: false,
      providesPunctuation,
      locales: "any",
    },
    isAvailable: () => true,
    start: async () => {},
    stop: async () => {},
    abort: () => {},
  };
}

describe("resolvePunctuator", () => {
  it("'none' devuelve el texto sin tocar", async () => {
    const p = resolvePunctuator("none", engineWith(false));
    expect(p.id).toBe("none");
    expect(await p.apply("el punto de encuentro")).toBe("el punto de encuentro");
  });

  it("'commands' interpreta los comandos", async () => {
    const p = resolvePunctuator("commands", engineWith(false));
    expect(await p.apply("hola nueva línea mundo")).toBe("hola \n mundo");
  });

  it("'provider' confía en el motor cuando éste puntúa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = resolvePunctuator("provider", engineWith(true));
    expect(await p.apply("Hola. Mundo.")).toBe("Hola. Mundo.");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("'provider' degrada a identidad y avisa si el motor no puntúa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = resolvePunctuator("provider", engineWith(false));
    expect(await p.apply("hola mundo")).toBe("hola mundo");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("'ai' lanza un Error común, no un VoiceError", () => {
    expect(() => resolvePunctuator("ai", engineWith(false))).toThrowError(
      /no está implementada en Nexus Voice v1/,
    );
  });
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run src/lib/voice/punctuation/`
Expected: FAIL — no se resuelven los imports.

- [ ] **Step 3: Implementar `commands.ts`**

```ts
/**
 * Solo comandos multi-palabra inequívocos.
 *
 * Deliberadamente NO se mapean las palabras aisladas "punto" ni "coma":
 * romperían "el punto de encuentro" y "que coma tranquilo". En un ERP donde se
 * dictan observaciones operativas, eso corrompe datos en silencio.
 * Ver spec §7.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // "punto y aparte" primero: contiene la palabra "punto".
  [/\bpunto y aparte\b/giu, ".\n"],
  [/\bnuevo p[áa]rrafo\b/giu, "\n\n"],
  [/\bnueva l[íi]nea\b/giu, "\n"],
  [/\bsigno de interrogaci[óo]n\b/giu, "?"],
  [/\bsigno de exclamaci[óo]n\b/giu, "!"],
];

/** Puro. La limpieza de espacios la hace normalize(), después. */
export function applyCommands(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
```

- [ ] **Step 4: Implementar `none.ts` y `provider.ts`**

`src/lib/voice/punctuation/none.ts`:

```ts
import type { Punctuator } from "../types";

/** Identidad. normalize() hace el resto, y corre siempre. */
export const nonePunctuator: Punctuator = {
  id: "none",
  apply: (text) => Promise.resolve(text),
};
```

`src/lib/voice/punctuation/provider.ts`:

```ts
import type { Punctuator, VoiceEngine } from "../types";

/**
 * Confía en la puntuación que entregue el motor. Si el motor no puntúa
 * (Web Speech API no lo hace), degrada a identidad y lo registra una vez.
 */
export function createProviderPunctuator(engine: VoiceEngine): Punctuator {
  if (!engine.capabilities.providesPunctuation) {
    console.warn(
      `[nexus-voice] el motor "${engine.id}" no provee puntuación; ` +
        `punctuationStrategy "provider" degrada a "none".`,
    );
  }
  return { id: "provider", apply: (text) => Promise.resolve(text) };
}
```

- [ ] **Step 5: Implementar `index.ts`**

```ts
import type { Punctuator, PunctuationStrategy, VoiceEngine } from "../types";
import { applyCommands } from "./commands";
import { nonePunctuator } from "./none";
import { createProviderPunctuator } from "./provider";

export { applyCommands };

export function resolvePunctuator(
  strategy: PunctuationStrategy,
  engine: VoiceEngine,
): Punctuator {
  switch (strategy) {
    case "none":
      return nonePunctuator;

    case "commands":
      return { id: "commands", apply: (t) => Promise.resolve(applyCommands(t)) };

    case "provider":
      return createProviderPunctuator(engine);

    case "ai":
      // Error del programador, no del usuario: por eso NO es un VoiceError.
      // Nunca debe llegar a la interfaz. Ver spec §7.1.
      throw new Error(
        'punctuationStrategy "ai" no está implementada en Nexus Voice v1. ' +
          "Es una decisión deliberada de producto (spec §7.1), no una limitación técnica.",
      );
  }
}
```

- [ ] **Step 6: Verificar que pasan**

Run: `npx vitest run src/lib/voice/punctuation/`
Expected: PASS — 11 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/voice/punctuation/
git commit -m "feat(voice): estrategias de puntuación none/provider/commands"
```

---

## Task 5: Resolver de habilitación

**Files:**
- Create: `src/lib/voice/config.ts`
- Test: `src/lib/voice/config.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `VoiceConfigSource`, `BuildFlagSource`, `isVoiceEnabled(sources: VoiceConfigSource[]): boolean`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/voice/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BuildFlagSource, isVoiceEnabled } from "./config";
import type { VoiceConfigSource } from "./config";

const source = (id: string, enabled: boolean): VoiceConfigSource => ({
  id,
  isEnabled: () => enabled,
});

describe("BuildFlagSource", () => {
  it('habilita solo con "1" o "true"', () => {
    expect(new BuildFlagSource("1").isEnabled()).toBe(true);
    expect(new BuildFlagSource("true").isEnabled()).toBe(true);
    expect(new BuildFlagSource("0").isEnabled()).toBe(false);
    expect(new BuildFlagSource("").isEnabled()).toBe(false);
    expect(new BuildFlagSource(undefined).isEnabled()).toBe(false);
  });
});

describe("isVoiceEnabled", () => {
  it("compone con AND: todas las fuentes deben habilitar", () => {
    expect(isVoiceEnabled([source("a", true), source("b", true)])).toBe(true);
    expect(isVoiceEnabled([source("a", true), source("b", false)])).toBe(false);
    expect(isVoiceEnabled([source("a", false), source("b", true)])).toBe(false);
  });

  it("sin fuentes está deshabilitado (fail-closed)", () => {
    expect(isVoiceEnabled([])).toBe(false);
  });

  it("una fuente futura solo puede restringir, nunca sobrescribir el flag de build", () => {
    const build = new BuildFlagSource("0");
    expect(isVoiceEnabled([build, source("org", true)])).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/voice/config.test.ts`
Expected: FAIL — `Failed to resolve import "./config"`

- [ ] **Step 3: Implementar**

Crear `src/lib/voice/config.ts`:

```ts
export interface VoiceConfigSource {
  readonly id: string;
  isEnabled(): boolean;
}

/** Nivel 1: interruptor maestro horneado en el build. */
export class BuildFlagSource implements VoiceConfigSource {
  readonly id = "build-flag";

  constructor(private readonly raw: string | undefined) {}

  isEnabled(): boolean {
    return this.raw === "1" || this.raw === "true";
  }
}

/**
 * Composición AND, fail-closed. Una fuente de Nivel 2 (organización, rol,
 * usuario) solo puede restringir; nunca sobrescribe el flag de build.
 * Ver spec §13.
 */
export function isVoiceEnabled(sources: readonly VoiceConfigSource[]): boolean {
  return sources.length > 0 && sources.every((s) => s.isEnabled());
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/voice/config.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/config.ts src/lib/voice/config.test.ts
git commit -m "feat(voice): resolver de habilitación por fuentes (composición AND)"
```

---

## Task 6: Motor Web Speech + fixture de test

**Files:**
- Create: `src/lib/voice/engines/web-speech.ts`
- Create: `src/lib/voice/engines/index.ts`
- Create: `src/lib/voice/__fixtures__/fake-engine.ts`

**Interfaces:**
- Consumes: `VoiceEngine`, `VoiceEngineStartContext`, `VoiceEngineCapabilities` (Task 1); `isAbortError` (Task 1). El motor **no** traduce errores: pasa el crudo y la sesión lo mapea con `toVoiceError()`.
- Produces: `createWebSpeechEngine(): VoiceEngine`, `resolveEngine(): VoiceEngine | null`, `isVoiceSupported(): boolean`, `FakeVoiceEngine` (clase con `emitPartial(text: string)`, `emitFinal(text: string)`, `emitError(raw: unknown)`, `started: boolean`, `stopCalls: number`, `abortCalls: number`, `stopHangs: boolean`).

> No hay tests unitarios de `web-speech.ts`: depende del navegador y no hay jsdom.
> Se verifica en la Task 9. El `FakeVoiceEngine` es lo que hace testeable la sesión.

- [ ] **Step 1: Implementar `web-speech.ts`**

```ts
import { isAbortError } from "../errors";
import type { VoiceEngine, VoiceEngineStartContext } from "../types";

/** Las tipificaciones de SpeechRecognition no están en lib.dom de TS 5.6. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function createWebSpeechEngine(): VoiceEngine {
  let recognition: SpeechRecognitionLike | null = null;

  /**
   * Chrome emite `end` tras unos segundos de silencio AUNQUE continuous sea true.
   * Sin este flag el dictado muere solo y parece un bug de Nexus. Ver spec §8.1.
   */
  let wantsToListen = false;
  let stopped: (() => void) | null = null;

  return {
    id: "web-speech",
    capabilities: {
      partialResults: true,
      requiresMediaStream: false, // abre su propio micrófono
      providesPunctuation: false, // Web Speech no puntúa en español
      locales: "any",
    },

    isAvailable: () => getCtor() !== null,

    async start(ctx: VoiceEngineStartContext) {
      const Ctor = getCtor();
      if (!Ctor) throw new Error("SpeechRecognition no disponible");

      const rec = new Ctor();
      recognition = rec;
      wantsToListen = true;

      rec.lang = ctx.locale;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]!;
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) ctx.onFinal(text);
          else ctx.onPartial(text);
        }
      };

      rec.onerror = (raw) => {
        // Un aborto es una cancelación NUESTRA, no un error del usuario.
        // El invariante vive en errors.ts, no replicado en cada motor.
        if (isAbortError(raw)) return;
        wantsToListen = false;
        ctx.onError(raw); // la sesión lo traduce con toVoiceError()
      };

      rec.onend = () => {
        if (wantsToListen) {
          // Chrome a veces lanza InvalidStateError si start() corre demasiado
          // pronto dentro del propio onend (quirk documentado). Sin este catch,
          // wantsToListen quedaría en true con un reconocedor roto y un stop()
          // posterior colgaría su Promise para siempre. El dictado debe morir
          // avisando — el usuario reintenta con un clic — no colgar en silencio.
          try {
            rec.start(); // reinicio transparente: la sesión sigue en "listening"
          } catch (raw) {
            wantsToListen = false;
            recognition = null;
            stopped?.(); // defensivo: no debería haber stop() pendiente acá
            stopped = null;
            ctx.onError(raw); // crudo; la sesión lo traduce y muestra el mensaje
          }
          return;
        }
        stopped?.();
        stopped = null;
      };

      rec.start();
    },

    stop() {
      const rec = recognition;
      if (!rec || !wantsToListen) return Promise.resolve();
      wantsToListen = false;
      return new Promise<void>((resolve) => {
        stopped = resolve;
        rec.stop(); // dispara `end` tras entregar el último resultado final
      });
    },

    abort() {
      wantsToListen = false;
      stopped = null;
      recognition?.abort();
      recognition = null;
    },
  };
}
```

- [ ] **Step 2: Implementar `engines/index.ts`**

```ts
import type { VoiceEngine } from "../types";
import { createWebSpeechEngine } from "./web-speech";

export { createWebSpeechEngine };

/** Devuelve el motor disponible, o null si el navegador no soporta ninguno. */
export function resolveEngine(): VoiceEngine | null {
  const webSpeech = createWebSpeechEngine();
  return webSpeech.isAvailable() ? webSpeech : null;
}

export function isVoiceSupported(): boolean {
  return resolveEngine() !== null;
}
```

- [ ] **Step 3: Implementar el `FakeVoiceEngine`**

Crear `src/lib/voice/__fixtures__/fake-engine.ts`. No se ejecuta en producción: solo lo importan los tests. El patrón `**/*.test.ts` del `include` de Vitest no lo levanta como suite.

```ts
import type { VoiceEngine, VoiceEngineStartContext } from "../types";

/**
 * Motor en memoria. Permite testear VoiceSession en entorno `node`,
 * sin navegador, sin jsdom y sin dependencias nuevas.
 */
export class FakeVoiceEngine implements VoiceEngine {
  readonly id = "fake";

  readonly capabilities = {
    partialResults: true,
    requiresMediaStream: false,
    providesPunctuation: false,
    locales: "any" as const,
  };

  started = false;
  stopCalls = 0;
  abortCalls = 0;

  /** Si es true, stop() no resuelve nunca: sirve para probar el guard. */
  stopHangs = false;

  private ctx: VoiceEngineStartContext | null = null;

  isAvailable(): boolean {
    return true;
  }

  async start(ctx: VoiceEngineStartContext): Promise<void> {
    this.ctx = ctx;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.stopHangs) return new Promise<void>(() => {});
    this.started = false;
  }

  abort(): void {
    this.abortCalls += 1;
    this.started = false;
    this.ctx = null;
  }

  emitPartial(text: string): void {
    this.ctx?.onPartial(text);
  }

  emitFinal(text: string): void {
    this.ctx?.onFinal(text);
  }

  emitError(raw: unknown): void {
    this.ctx?.onError(raw);
  }
}
```

- [ ] **Step 4: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores.

Run: `npm test`
Expected: PASS — las 30 pruebas de `voice` de las tareas 1-5 siguen verdes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/engines/ src/lib/voice/__fixtures__/
git commit -m "feat(voice): motor Web Speech tras la interfaz VoiceEngine + fixture de test"
```

---

## Task 7: Medidor de audio e inserción en el DOM

**Files:**
- Create: `src/lib/voice/meter.ts`
- Create: `src/lib/voice/dom.ts`

**Interfaces:**
- Consumes: `VoiceMeter`, `VoiceMeterFactory` (Task 1); `planInsertion` (Task 3).
- Produces: `createAnalyserMeter: VoiceMeterFactory`, `insertAtCursor(el: HTMLInputElement | HTMLTextAreaElement, text: string): void`.

> Ninguno de los dos tiene test unitario: son APIs del navegador. Se verifican en la Task 10.

- [ ] **Step 1: Implementar `meter.ts`**

```ts
import type { VoiceMeter } from "./types";

/**
 * Medidor REAL. Nunca una animación simulada: un medidor falso le confirmaría
 * al usuario que el micrófono capta su voz incluso cuando no capta nada, que es
 * exactamente el problema que el medidor existe para resolver. Ver spec §10.
 *
 * Si AudioContext no está disponible, el medidor devuelto es inerte (nunca
 * emite nivel) y la UI degrada a pulso. La transcripción no se ve afectada.
 */
export const createAnalyserMeter = (stream: MediaStream): VoiceMeter => {
  const AudioCtor =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)
      : undefined;

  const listeners = new Set<(rms: number) => void>();
  let raf = 0;
  let ctx: AudioContext | null = null;

  if (AudioCtor) {
    ctx = new AudioCtor();
    // Política de autoplay (Safari sobre todo): el contexto puede nacer
    // "suspended" y entonces getFloatTimeDomainData devuelve ceros ETERNOS —
    // el medidor mostraría silencio mientras el usuario habla, el falso
    // negativo exacto que existe para evitar. resume() es fire-and-forget.
    if (ctx.state === "suspended") void ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / buffer.length);
      // Escala perceptual: la voz normal ronda 0.02–0.2 de RMS.
      const level = Math.min(1, rms * 6);
      for (const cb of listeners) cb(level);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  return {
    onLevel(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      listeners.clear();
      void ctx?.close();
      ctx = null;
    },
  };
};
```

- [ ] **Step 2: Implementar `dom.ts`**

```ts
import { planInsertion } from "./insert";

type EditableElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * Escribe `value` usando el setter NATIVO del prototipo y despacha un evento
 * `input` real. React escucha `input` en la raíz del árbol, así que ejecuta el
 * onChange del componente sin poder distinguirlo de una pulsación de tecla.
 *
 * Esta es la garantía TÉCNICA de que Copilot no sabe si el texto vino de voz o
 * de teclado: no hay rama de código que auditar. Ver spec §9.
 *
 * El prototipo se elige según el tipo de elemento: un setter tomado de
 * HTMLTextAreaElement no funciona sobre un <input>, y viceversa.
 */
function setNativeValue(el: EditableElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) {
    el.value = value; // degradación: React podría no enterarse
    return;
  }
  setter.call(el, value);
}

export function insertAtCursor(el: EditableElement, text: string): void {
  const selStart = el.selectionStart ?? el.value.length;
  const selEnd = el.selectionEnd ?? el.value.length;

  const { value, caretStart, caretEnd } = planInsertion(el.value, selStart, selEnd, text);
  // No-op real: sin cambio de valor no se despacha evento ni se toca la
  // selección — el usuario conserva exactamente lo que tenía.
  if (value === el.value) return;

  setNativeValue(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));

  // React re-renderiza tras el evento y puede reposicionar el caret al final.
  // El microtask lo coloca después de ese re-render.
  queueMicrotask(() => {
    if (!el.isConnected) return;
    try {
      el.setSelectionRange(caretStart, caretEnd);
    } catch {
      // Los <input> sin selección (email, number, date…) lanzan
      // InvalidStateError. El texto ya se insertó bien; solo se omite el
      // reposicionamiento del caret. El alcance v1 excluye esos tipos, pero
      // esta guarda evita que un mal uso futuro explote dentro de un microtask.
    }
  });
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Verificar la frontera de dependencias**

Run: `grep -rn "from \"react\"\|from \"next" src/lib/voice/ ; echo "exit=$?"`
Expected: sin coincidencias, `exit=1`. `src/lib/voice/` nunca importa React.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/meter.ts src/lib/voice/dom.ts
git commit -m "feat(voice): medidor real con AnalyserNode e inserción vía setter nativo"
```

---

## Task 8: VoiceSession

El corazón. Administra estados, permisos, cancelación, timeouts, medidor, eventos y recursos. **No sabe nada del destino del texto.**

**Files:**
- Create: `src/lib/voice/session.ts`
- Test: `src/lib/voice/session.test.ts`

**Interfaces:**
- Consumes: `transition` (Task 1), `toVoiceError` + errores (Task 1), `normalize` (Task 2), `resolvePunctuator` (Task 4), `resolveEngine` (Task 6), `FakeVoiceEngine` (Task 6).
- Produces: `createVoiceSession(opts?: VoiceSessionOptions): VoiceSession`.

**Contrato de orden que el resto del sistema asume:** `settle()` emite `final` **y después** transiciona a `idle`. `capture()` (Task 9) depende de eso.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/voice/session.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createVoiceSession } from "./session";
import { FakeVoiceEngine } from "./__fixtures__/fake-engine";
import { VoicePermissionDeniedError } from "./errors";
import type { VoiceState } from "./types";

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
});
```

> El test de permisos usa una opción `requestStream` inyectable. Es la única forma
> de probar la frontera de permisos en `node` sin mocks globales de `navigator`.

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/voice/session.test.ts`
Expected: FAIL — `Failed to resolve import "./session"`

- [ ] **Step 3: Implementar**

Crear `src/lib/voice/session.ts`:

```ts
import { resolveEngine } from "./engines";
import {
  VoiceEngineUnavailableError,
  VoicePermissionDeniedError,
  VoiceRecognitionError,
  toVoiceError,
  type VoiceError,
} from "./errors";
import { transition } from "./machine";
import { normalize } from "./normalize";
import { resolvePunctuator } from "./punctuation";
import type {
  VoiceEngine,
  VoiceSession,
  VoiceSessionEvents,
  VoiceSessionOptions,
  VoiceState,
} from "./types";

/** Inyectable para poder testear la frontera de permisos sin navegador. */
type StreamRequester = () => Promise<MediaStream | null>;

export interface CreateVoiceSessionOptions extends VoiceSessionOptions {
  requestStream?: StreamRequester;
}

const DEFAULT_LOCALE = "es-AR";
const DEFAULT_MAX_DURATION_MS = 120_000;
const DEFAULT_PROCESSING_GUARD_MS = 3_000;
/** Por debajo de esto consideramos silencio, para autoStopOnSilenceMs. */
const SILENCE_LEVEL = 0.05;

function defaultRequestStream(engine: VoiceEngine): StreamRequester {
  return async () => {
    const media = globalThis.navigator?.mediaDevices;
    if (!media?.getUserMedia) {
      if (engine.capabilities.requiresMediaStream) {
        throw new VoiceRecognitionError(
          "no-microphone",
          "No detectamos ningún micrófono conectado.",
        );
      }
      return null;
    }

    try {
      return await media.getUserMedia({ audio: true });
    } catch (raw) {
      const err = toVoiceError(raw);
      // El permiso es fatal: el reconocedor también fallaría.
      if (err instanceof VoicePermissionDeniedError) throw err;
      if (engine.capabilities.requiresMediaStream) throw err;

      // El motor no necesita el stream: el medidor se apaga y el dictado sigue.
      console.warn("[nexus-voice] medidor deshabilitado:", err.code);
      return null;
    }
  };
}

export function createVoiceSession(
  opts: CreateVoiceSessionOptions = {},
): VoiceSession {
  const engine = opts.engine ?? resolveEngine();
  if (!engine) throw new VoiceEngineUnavailableError();

  const locale = opts.locale ?? DEFAULT_LOCALE;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const processingGuardMs = opts.processingGuardMs ?? DEFAULT_PROCESSING_GUARD_MS;
  const punctuator = resolvePunctuator(opts.punctuationStrategy ?? "none", engine);
  const requestStream = opts.requestStream ?? defaultRequestStream(engine);

  let state: VoiceState = "idle";
  let segments: string[] = [];
  let settled = false;
  let stream: MediaStream | null = null;
  let stopMeter: (() => void) | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let guardTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const listeners: {
    [K in keyof VoiceSessionEvents]: Set<VoiceSessionEvents[K]>;
  } = {
    state: new Set(),
    partial: new Set(),
    level: new Set(),
    final: new Set(),
    error: new Set(),
  };

  function emit<K extends keyof VoiceSessionEvents>(
    event: K,
    ...args: Parameters<VoiceSessionEvents[K]>
  ): void {
    if (disposed) return;
    for (const cb of listeners[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }

  function go(action: Parameters<typeof transition>[1]): void {
    const next = transition(state, action);
    if (next === state) return;
    state = next;
    emit("state", next);
  }

  function clearTimers(): void {
    if (maxTimer) clearTimeout(maxTimer);
    if (silenceTimer) clearTimeout(silenceTimer);
    if (guardTimer) clearTimeout(guardTimer);
    maxTimer = silenceTimer = guardTimer = null;
  }

  function releaseMic(): void {
    stopMeter?.();
    stopMeter = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  }

  function armSilence(): void {
    if (!opts.autoStopOnSilenceMs) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    // Un silencio prolongado FINALIZA (conserva el texto). Nunca cancela.
    silenceTimer = setTimeout(() => void stop(), opts.autoStopOnSilenceMs);
  }

  async function settle(): Promise<void> {
    if (settled) return;
    settled = true;

    if (guardTimer) clearTimeout(guardTimer);
    guardTimer = null;
    releaseMic();

    const raw = segments.join(" ");
    segments = [];

    const text = normalize(await punctuator.apply(raw));

    // ORDEN CONTRACTUAL: `final` primero, `idle` después. capture() depende de esto.
    if (text.length > 0) emit("final", text);
    go({ type: "SETTLED" });
  }

  function fail(raw: unknown): void {
    if (settled) return;
    settled = true;
    clearTimers();
    engine.abort();
    releaseMic();
    segments = [];

    const error: VoiceError = toVoiceError(raw);
    go({ type: "FAIL" });
    emit("error", error);
  }

  async function start(): Promise<void> {
    if (state === "listening" || state === "processing") return;
    if (!engine.isAvailable()) throw new VoiceEngineUnavailableError();

    settled = false;
    segments = [];

    // Los permisos los pide la SESIÓN, antes de que el motor exista.
    stream = await requestStream();

    go({ type: "START" });

    if (stream && opts.createMeter) {
      const meter = opts.createMeter(stream);
      const off = meter.onLevel((level) => {
        emit("level", level);
        if (level > SILENCE_LEVEL) armSilence();
      });
      stopMeter = () => {
        off();
        meter.stop();
      };
    }

    await engine.start({
      locale,
      stream,
      onPartial: (text) => {
        emit("partial", text);
        armSilence();
      },
      onFinal: (text) => {
        if (text.trim().length > 0) segments.push(text.trim());
        armSilence();
      },
      onError: fail,
    });

    maxTimer = setTimeout(() => void stop(), maxDurationMs);
    armSilence();
  }

  async function stop(): Promise<void> {
    if (state !== "listening") return;
    clearTimers();
    go({ type: "STOP" });

    guardTimer = setTimeout(() => {
      console.warn(
        `[nexus-voice] el motor "${engine.id}" no emitió el evento final ` +
          `en ${processingGuardMs}ms. Se cierra la sesión con el texto disponible.`,
      );
      void settle();
    }, processingGuardMs);

    await engine.stop();
    await settle();
  }

  function cancel(): void {
    if (state !== "listening" && state !== "processing") return;
    settled = true;
    clearTimers();
    engine.abort();
    releaseMic();
    segments = [];
    go({ type: "CANCEL" }); // NO emite `final`. NO emite `error`.
  }

  return {
    get state() {
      return state;
    },
    start,
    stop,
    cancel,
    on(event, cb) {
      listeners[event].add(cb as never);
      return () => {
        listeners[event].delete(cb as never);
      };
    },
    dispose() {
      cancel();
      disposed = true;
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/voice/session.test.ts`
Expected: PASS — 12 tests.

> `dispose()` llama `cancel()` **antes** de marcar `disposed`, para que la transición
> a `idle` todavía se emita. El test "dispose() libera todo" verifica exactamente eso.

- [ ] **Step 5: Verificar todo el núcleo**

Run: `npm test`
Expected: PASS — todas las suites, incluidas las 92 preexistentes.

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/voice/session.ts src/lib/voice/session.test.ts
git commit -m "feat(voice): VoiceSession — estados, permisos, cancelación, timeouts y medidor"
```

---

## Task 9: Fachada NexusVoice

**Files:**
- Create: `src/lib/voice/nexus-voice.ts`
- Test: `src/lib/voice/nexus-voice.test.ts`

**Interfaces:**
- Consumes: `createVoiceSession` (Task 8), `isVoiceEnabled` + `BuildFlagSource` (Task 5), `isVoiceSupported` (Task 6), `VoiceSessionAlreadyRunningError` (Task 1).
- Produces: el singleton `NexusVoice` con `configure`, `isEnabled`, `isSupported`, `active`, `subscribe`, `acquire`, `releaseActive`, `capture`.

**Contrato de exclusión:** `acquire()` es estrictamente excluyente. La política de *takeover* vive en `capture()` y en `useVoiceSession`, y ejecuta `stop()` sobre la sesión anterior — **jamás `cancel()`** — para que su dueño inserte el texto en su campo original antes de ceder el micrófono.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/voice/nexus-voice.test.ts`:

```ts
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
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/voice/nexus-voice.test.ts`
Expected: FAIL — `Failed to resolve import "./nexus-voice"`

- [ ] **Step 3: Implementar**

Crear `src/lib/voice/nexus-voice.ts`:

```ts
import { BuildFlagSource, isVoiceEnabled, type VoiceConfigSource } from "./config";
import { isVoiceSupported } from "./engines";
import { VoiceEngineUnavailableError, VoiceSessionAlreadyRunningError } from "./errors";
import { createVoiceSession, type CreateVoiceSessionOptions } from "./session";
import type { VoiceSession } from "./types";

export interface CaptureOptions extends CreateVoiceSessionOptions {
  /** "takeover" (por defecto) finaliza la sesión previa con stop(). */
  conflict?: "takeover" | "reject";
  /** true → capture() no publica la sesión; el llamador dibuja su propia UI. */
  headless?: boolean;
  signal?: AbortSignal;
}

let sources: readonly VoiceConfigSource[] = [
  new BuildFlagSource(process.env.NEXT_PUBLIC_VOICE_ENABLED),
];

let active: VoiceSession | null = null;
let presented: VoiceSession | null = null;
const subscribers = new Set<(session: VoiceSession | null) => void>();

function present(session: VoiceSession | null): void {
  presented = session;
  for (const cb of subscribers) cb(session);
}

/**
 * Un solo micrófono, una sola dueña. Ver spec §5.
 * La política de takeover NO vive acá: el núcleo nunca adivina.
 */
function acquire(opts: CreateVoiceSessionOptions = {}): VoiceSession {
  if (active) throw new VoiceSessionAlreadyRunningError();

  const inner = createVoiceSession(opts);

  // `active` y `presented` guardan el WRAPPER, no la sesión interna.
  // Comparar contra `inner` acá dejaría `presented` colgado y el overlay abierto.
  const wrapper: VoiceSession = {
    get state() {
      return inner.state;
    },
    start: () => inner.start(),
    stop: () => inner.stop(),
    cancel: () => inner.cancel(),
    on: (event, cb) => inner.on(event, cb),
    dispose: () => {
      inner.dispose();
      if (active === wrapper) active = null;
      if (presented === wrapper) present(null);
    },
  };

  active = wrapper;
  return wrapper;
}

/** Finaliza la sesión activa conservando su texto. Nunca la cancela. */
async function releaseActive(): Promise<void> {
  const current = active;
  if (!current) return;
  if (current.state === "listening") await current.stop();
  current.dispose();
}

async function capture(opts: CaptureOptions = {}): Promise<string | null> {
  if (!isEnabled() || (!opts.engine && !isSupported())) {
    throw new VoiceEngineUnavailableError();
  }

  if (active) {
    if (opts.conflict === "reject") throw new VoiceSessionAlreadyRunningError();
    await releaseActive();
  }

  const session = acquire(opts);
  if (!opts.headless) present(session);

  try {
    return await new Promise<string | null>((resolve, reject) => {
      let result: string | null = null;
      let started = false;

      // `final` se emite ANTES de la transición a idle (contrato de VoiceSession).
      session.on("final", (text) => {
        result = text;
      });
      session.on("error", reject);
      session.on("state", (state) => {
        if (state === "listening") started = true;
        else if (state === "idle" && started) resolve(result);
      });

      opts.signal?.addEventListener("abort", () => session.cancel(), {
        once: true,
      });

      session.start().catch(reject);
    });
  } finally {
    session.dispose();
  }
}

function isEnabled(): boolean {
  return isVoiceEnabled(sources);
}

function isSupported(): boolean {
  return isVoiceSupported();
}

export const NexusVoice = {
  configure(opts: { sources: readonly VoiceConfigSource[] }): void {
    sources = opts.sources;
  },
  isEnabled,
  isSupported,
  get active(): VoiceSession | null {
    return active;
  },
  subscribe(cb: (session: VoiceSession | null) => void): () => void {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
  acquire,
  releaseActive,
  capture,
};
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/voice/nexus-voice.test.ts`
Expected: PASS — 9 tests.

Run: `npm test && npm run typecheck`
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/nexus-voice.ts src/lib/voice/nexus-voice.test.ts
git commit -m "feat(voice): fachada NexusVoice con acquire estricto, takeover y capture()"
```

---

## Task 10: Capa React — hook y botón

**Files:**
- Create: `src/components/voice/useVoiceSession.ts`
- Create: `src/components/voice/VoiceMicButton.tsx`
- Modify: `src/app/globals.css` (agregar la animación del pulso al final del archivo)

**Interfaces:**
- Consumes: `NexusVoice` (Task 9), `createAnalyserMeter` (Task 7), `VoiceState` (Task 1).
- Produces: `useVoiceSession(opts: UseVoiceSessionOptions): VoiceSessionBinding` con `{ state, level, partial, error, enabled, start, stop, cancel }`; `VoiceMicButton` con props `{ state, level, error, onStart, onStop, className? }`.

- [ ] **Step 1: Implementar `useVoiceSession.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NexusVoice } from "@/lib/voice/nexus-voice";
import { createAnalyserMeter } from "@/lib/voice/meter";
import { toVoiceError } from "@/lib/voice/errors";
import type { PunctuationStrategy, VoiceSession, VoiceState } from "@/lib/voice/types";

export interface UseVoiceSessionOptions {
  /** Recibe el texto final, exactamente una vez por dictado. */
  onFinal(text: string): void;
  locale?: string;
  punctuationStrategy?: PunctuationStrategy;
  autoStopOnSilenceMs?: number;
}

export interface VoiceSessionBinding {
  state: VoiceState;
  level: number;
  partial: string;
  error: string | null;
  enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
}

export function useVoiceSession(opts: UseVoiceSessionOptions): VoiceSessionBinding {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  // En el servidor no hay `window`, así que isSupported() es false. Calcularlo
  // durante el render produciría un desajuste de hidratación: el servidor
  // dibuja el campo sin micrófono y el cliente con micrófono. Se resuelve
  // después del montaje, cuando ya no hay HTML del servidor que contradecir.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(NexusVoice.isEnabled() && NexusVoice.isSupported());
  }, []);

  const sessionRef = useRef<VoiceSession | null>(null);
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;

  const release = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setLevel(0);
    setPartial("");
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);

    // Takeover: la sesión anterior finaliza con stop() y entrega su texto a
    // SU campo original antes de ceder el micrófono. Nunca cancel(). Spec §5.
    await NexusVoice.releaseActive();

    let session: VoiceSession;
    try {
      session = NexusVoice.acquire({
        locale: opts.locale,
        punctuationStrategy: opts.punctuationStrategy,
        autoStopOnSilenceMs: opts.autoStopOnSilenceMs,
        createMeter: createAnalyserMeter,
      });
    } catch (raw) {
      setError(toVoiceError(raw).message);
      setState("error");
      return;
    }

    sessionRef.current = session;
    session.on("state", setState);
    session.on("level", setLevel);
    session.on("partial", setPartial);
    session.on("final", (text) => onFinalRef.current(text));
    session.on("error", (err) => setError(err.message));

    try {
      await session.start();
    } catch (raw) {
      setError(toVoiceError(raw).message);
      setState("error");
      release();
    }
  }, [opts.locale, opts.punctuationStrategy, opts.autoStopOnSilenceMs, release]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    await session.stop(); // conserva el texto: onFinal ya corrió
    release();
  }, [release]);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel(); // descarta el texto
    release();
    setState("idle");
  }, [release]);

  return { state, level, partial, error, enabled, start, stop, cancel };
}
```

- [ ] **Step 2: Implementar `VoiceMicButton.tsx`**

```tsx
"use client";

import type { VoiceState } from "@/lib/voice/types";

const LABELS: Record<VoiceState, string> = {
  idle: "Dictar por voz",
  listening: "Escuchando. Hacé clic para finalizar.",
  processing: "Transcribiendo…",
  error: "Error de dictado. Hacé clic para reintentar.",
};

const ANNOUNCE: Record<VoiceState, string> = {
  idle: "",
  listening: "Escuchando",
  processing: "Transcribiendo",
  error: "Error de dictado",
};

const BARS = [0.35, 0.7, 1, 0.7, 0.35];

export interface VoiceMicButtonProps {
  state: VoiceState;
  level: number;
  error: string | null;
  onStart(): void;
  onStop(): void;
  className?: string;
}

export function VoiceMicButton({
  state,
  level,
  error,
  onStart,
  onStop,
  className = "",
}: VoiceMicButtonProps) {
  const listening = state === "listening";
  const processing = state === "processing";

  return (
    <>
      <button
        type="button"
        // Evita que el campo pierda el foco: sin esto se pierde el caret y
        // la inserción "en el cursor" falla. Ver spec §8.2.
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => (listening ? onStop() : onStart())}
        disabled={processing}
        aria-pressed={listening}
        aria-label={LABELS[state]}
        title={error ?? LABELS[state]}
        className={`nx-voice-mic inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md
          text-fg-muted transition-colors hover:text-fg-primary disabled:opacity-50
          ${listening ? "nx-voice-mic--live text-tops-red" : ""}
          ${state === "error" ? "text-status-warning" : ""} ${className}`}
      >
        {processing ? (
          <span className="nx-voice-spinner h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" />
        ) : listening ? (
          <span className="flex items-end gap-[2px]" aria-hidden>
            {BARS.map((weight, i) => (
              <span
                key={i}
                className="w-[2px] rounded-full bg-current"
                style={{ height: `${4 + Math.min(1, level * weight) * 12}px` }}
              />
            ))}
          </span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <span className="sr-only" aria-live="polite">
        {ANNOUNCE[state]}
      </span>
    </>
  );
}
```

- [ ] **Step 3: Agregar los estilos**

Al final de `src/app/globals.css`:

```css
/* ---- Nexus Voice ---------------------------------------------------- */
@keyframes nx-voice-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}
@keyframes nx-voice-spin {
  to { transform: rotate(360deg); }
}

/* Pulso cuando el medidor real no está disponible (getUserMedia falló). */
.nx-voice-mic--live {
  animation: nx-voice-pulse 1.2s ease-in-out infinite;
}
.nx-voice-spinner {
  animation: nx-voice-spin 0.7s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .nx-voice-mic--live,
  .nx-voice-spinner {
    animation: none;
  }
}
```

- [ ] **Step 4: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores.

> La clase es `text-status-warning` (definida en `tailwind.config.ts`, 79 usos en el repo).
> `text-status-warn` **no existe**: Tailwind la ignoraría en silencio y el estado de error
> quedaría del mismo color que el estado normal.

- [ ] **Step 5: Commit**

```bash
git add src/components/voice/useVoiceSession.ts src/components/voice/VoiceMicButton.tsx src/app/globals.css
git commit -m "feat(voice): hook useVoiceSession y VoiceMicButton con medidor real"
```

---

## Task 11: VoiceField y cableado del Copilot

Primer punto donde se ve funcionando en el navegador.

**Files:**
- Create: `src/components/voice/VoiceField.tsx`
- Modify: `src/app/(app)/copilot/CopilotChat.tsx:1112-1120`

**Interfaces:**
- Consumes: `useVoiceSession` (Task 10), `VoiceMicButton` (Task 10), `insertAtCursor` (Task 7).
- Produces: `<VoiceField>` con props `{ children: ReactElement, className?: string }`.

- [ ] **Step 1: Implementar `VoiceField.tsx`**

```tsx
"use client";

import {
  cloneElement,
  isValidElement,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
} from "react";
import { insertAtCursor } from "@/lib/voice/dom";
import { useVoiceSession } from "./useVoiceSession";
import { VoiceMicButton } from "./VoiceMicButton";

type Editable = HTMLInputElement | HTMLTextAreaElement;

export interface VoiceFieldProps {
  /** Un único <input> o <textarea>. */
  children: ReactElement;
  /** Clases del contenedor. Ej: "flex-1 min-w-0" dentro de un flex. */
  className?: string;
}

function mergeRefs(...refs: Array<Ref<Editable> | undefined>) {
  return (node: Editable | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") {
        (ref as { current: Editable | null }).current = node;
      }
    }
  };
}

export function VoiceField({ children, className = "" }: VoiceFieldProps) {
  const elRef = useRef<Editable | null>(null);

  const voice = useVoiceSession({
    onFinal: (text) => {
      const el = elRef.current;
      if (el) insertAtCursor(el, text);
    },
  });

  if (!isValidElement(children)) return children;
  // Navegador incompatible o flag apagado: campo normal, sin micrófono roto.
  if (!voice.enabled) return children;

  const child = children as ReactElement<{
    className?: string;
    onKeyDown?: (ev: KeyboardEvent<Editable>) => void;
    onBlur?: (ev: FocusEvent<Editable>) => void;
  }>;

  const isTextarea = child.type === "textarea";

  // En React 18 `ref` NO viaja dentro de props: vive en el elemento.
  // Leerlo de child.props devolvería undefined y se perdería el ref del consumidor.
  const childRef = (child as unknown as { ref?: Ref<Editable> }).ref;

  const enhanced = cloneElement(child, {
    ref: mergeRefs(childRef, elRef),
    className: `${child.props.className ?? ""} pr-10`.trim(),
    onKeyDown: (ev: KeyboardEvent<Editable>) => {
      // Escape = Cancelar. Siempre. En toda la plataforma. Ver spec §6.1.
      if (ev.key === "Escape" && voice.state === "listening") {
        ev.preventDefault();
        ev.stopPropagation();
        voice.cancel();
        return;
      }
      child.props.onKeyDown?.(ev);
    },
    onBlur: (ev: FocusEvent<Editable>) => {
      // Perder el foco FINALIZA: conserva el texto. No es una cancelación.
      if (voice.state === "listening") void voice.stop();
      child.props.onBlur?.(ev);
    },
  });

  return (
    <div className={`relative ${className}`}>
      {enhanced}
      <div
        className={`absolute right-1.5 ${isTextarea ? "top-1.5" : "top-1/2 -translate-y-1/2"}`}
      >
        <VoiceMicButton
          state={voice.state}
          level={voice.level}
          error={voice.error}
          onStart={() => void voice.start()}
          onStop={() => void voice.stop()}
        />
      </div>

      {voice.state === "listening" && voice.partial && (
        <p className="mt-1 truncate text-[11px] italic text-fg-muted" aria-hidden>
          {voice.partial}
        </p>
      )}
      {voice.state === "error" && voice.error && (
        <p className="mt-1 text-[11px] text-tops-red" role="status">
          {voice.error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Cablear el Copilot**

En `src/app/(app)/copilot/CopilotChat.tsx`, agregar el import junto a los demás:

```tsx
import { VoiceField } from "@/components/voice/VoiceField";
```

Reemplazar el bloque de las líneas 1112-1120. **Antes:**

```tsx
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            placeholder="Preguntá por facturación, compliance, proveedores, vacancia, contratos…"
            maxLength={2000}
            className="min-w-0 flex-1 rounded-md border border-stroke-soft bg-bg-surface-alt px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none"
            aria-label="Pregunta al Copilot"
          />
```

**Después** — el `flex-1 min-w-0` pasa al contenedor y el input toma `w-full`:

```tsx
        <div className="flex gap-2">
          <VoiceField className="min-w-0 flex-1">
            <input
              value={input}
              onChange={(ev) => setInput(ev.target.value)}
              placeholder="Preguntá por facturación, compliance, proveedores, vacancia, contratos…"
              maxLength={2000}
              className="w-full rounded-md border border-stroke-soft bg-bg-surface-alt px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none"
              aria-label="Pregunta al Copilot"
            />
          </VoiceField>
```

Y cerrar el `</VoiceField>` inmediatamente después del `/>` del input, antes del `<button type="submit">`.

**No se toca ni una línea de la lógica del Copilot.** `setInput` recibe el evento `input`
sintetizado exactamente como si el usuario hubiera tecleado.

- [ ] **Step 3: Habilitar el flag y verificar en el navegador**

```bash
echo 'NEXT_PUBLIC_VOICE_ENABLED=1' >> .env.local
npm run dev
```

Abrir `http://localhost:3030/copilot` en **Chrome** y verificar, uno por uno:

1. Aparece el micrófono gris dentro del input, a la derecha.
2. Clic → el navegador pide permiso → al conceder, el ícono se vuelve rojo y **las barras se mueven al hablar**.
3. El texto parcial aparece debajo del input mientras hablás, y **el input no cambia**.
4. Clic de nuevo → spinner breve → el texto aparece **completo, capitalizado, una sola vez**.
5. Escribir "hola" a mano, poner el caret entre la `o` y el final, dictar: el texto entra **en el caret**, no al final.
6. Dictar y presionar `Escape` → **el texto se descarta**, el input queda como estaba.
7. Dictar y hacer clic fuera del input → **el texto se conserva** y se inserta.
8. Enviar la pregunta al Copilot: responde normal. No hay ninguna rama de código para voz.
9. Denegar el permiso del micrófono → mensaje amable debajo del input, sin excepción en consola.
10. Abrir la misma página en **Firefox** → **no aparece el micrófono**. El input funciona normal.

- [ ] **Step 4: Verificar tipos y tests**

Run: `npm run typecheck && npm test`
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add src/components/voice/VoiceField.tsx "src/app/(app)/copilot/CopilotChat.tsx"
git commit -m "feat(voice): VoiceField (Modo Campo) + dictado en el Copilot"
```

> `.env.local` está en `.gitignore`. No se commitea.

---

## Task 12: Cobertura — los 14 textareas

Repetitiva y mecánica. Cada archivo recibe el mismo tratamiento: envolver el `<textarea>` de **texto libre** (observaciones, notas, comentarios, descripciones) en `<VoiceField>`. **No** envolver campos que no sean prosa.

**Files:**
- Modify: `src/app/(app)/orders/new/NewOrderWizard.tsx:1000`
- Modify: `src/components/comercial/tablero/DealDetailPanel.tsx:408`
- Modify: `src/app/(app)/connect/_components/NewIncidentForm.tsx`
- Modify: `src/app/(app)/connect/_components/IncidentActions.tsx`
- Modify: `src/app/(app)/connect/_components/NewTaskForm.tsx`
- Modify: `src/app/(app)/connect/_components/TaskActions.tsx`
- Modify: `src/app/(app)/connect/_components/ThreadView.tsx`
- Modify: `src/app/(app)/connect/_components/ProfileForm.tsx`
- Modify: `src/app/(app)/compras/conciliacion/[poId]/ReconActions.tsx`
- Modify: `src/app/(app)/compras/facturas/nueva/NuevaFacturaForm.tsx`
- Modify: `src/app/(app)/compras/nueva/NewPoWizard.tsx`
- Modify: `src/app/(app)/clients/ClientsView.tsx`
- Modify: `src/app/(app)/settings/fiscal/FiscalConfigForm.tsx`
- Modify: `src/app/(app)/settings/roles/new/page.tsx`

**Interfaces:**
- Consumes: `VoiceField` (Task 11).
- Produces: nada nuevo.

- [ ] **Step 1: Confirmar que cada archivo es un Client Component**

`VoiceField` usa hooks. Un `<textarea>` con `onChange` ya implica `"use client"`, pero verificalo:

Run:
```bash
for f in $(grep -rl "<textarea" src --include="*.tsx"); do
  head -1 "$f" | grep -q "use client" || echo "SIN 'use client': $f"
done
```
Expected: sin salida. Si algún archivo aparece (probablemente `settings/roles/new/page.tsx`), **no lo envuelvas**: es un Server Component y queda fuera de alcance. Anotalo y seguí.

- [ ] **Step 2: Envolver cada textarea — patrón exacto**

Ejemplo con `src/app/(app)/orders/new/NewOrderWizard.tsx:1000`.

**Antes:**
```tsx
          <textarea
            className="textarea"
            rows={3}
            value={data.observ}
            onChange={(e) => update({ observ: e.target.value })}
          />
```

**Después:**
```tsx
          <VoiceField>
            <textarea
              className="textarea"
              rows={3}
              value={data.observ}
              onChange={(e) => update({ observ: e.target.value })}
            />
          </VoiceField>
```

Con el import correspondiente:
```tsx
import { VoiceField } from "@/components/voice/VoiceField";
```

`VoiceField` sin `className` renderiza un `<div className="relative">` de ancho completo,
que es lo que ya ocupaba el `.textarea` (`block w-full`). El layout no cambia.

Repetir para los 13 archivos restantes. **Criterio de exclusión:** si el `<textarea>`
contiene JSON, SQL, CSV o cualquier texto no-prosa, no lo envuelvas.

- [ ] **Step 3: Verificar tres campos representativos en el navegador**

Run: `npm run dev`

1. `/orders/new` → paso de observaciones: dictar, verificar inserción única y capitalizada.
2. `/comercial/tablero` → abrir un deal → observaciones: dictar, presionar `Escape`, confirmar que **no se guardó nada**.
3. `/connect` → nueva incidencia → descripción: empezar a dictar acá, y **sin finalizar** ir al Copilot y arrancar otro dictado.
   Verificar el **takeover**: el texto de la incidencia **se insertó en la incidencia** antes de que el Copilot tomara el micrófono. Nada se perdió, nada fue al campo equivocado.

- [ ] **Step 4: Verificar tipos y tests**

Run: `npm run typecheck && npm test`
Expected: todo verde.

- [ ] **Step 5: Commit**

Enumerá los archivos, uno por uno. **No uses `git add src/app src/components`**: arrastraría
cualquier archivo tocado por accidente y rompe la trazabilidad del commit.

```bash
git add \
  "src/app/(app)/orders/new/NewOrderWizard.tsx" \
  "src/components/comercial/tablero/DealDetailPanel.tsx" \
  "src/app/(app)/connect/_components/NewIncidentForm.tsx" \
  "src/app/(app)/connect/_components/IncidentActions.tsx" \
  "src/app/(app)/connect/_components/NewTaskForm.tsx" \
  "src/app/(app)/connect/_components/TaskActions.tsx" \
  "src/app/(app)/connect/_components/ThreadView.tsx" \
  "src/app/(app)/connect/_components/ProfileForm.tsx" \
  "src/app/(app)/compras/conciliacion/[poId]/ReconActions.tsx" \
  "src/app/(app)/compras/facturas/nueva/NuevaFacturaForm.tsx" \
  "src/app/(app)/compras/nueva/NewPoWizard.tsx" \
  "src/app/(app)/clients/ClientsView.tsx" \
  "src/app/(app)/settings/fiscal/FiscalConfigForm.tsx"

git status --short   # confirmá que no quedó nada sin intención
git commit -m "feat(voice): dictado en los textareas de texto libre"
```

> `settings/roles/new/page.tsx` no aparece en la lista a propósito: el Step 1 determina si
> es Server Component. Si lo es, queda fuera de alcance y no se toca.

---

## Task 13: Modo Global — VoiceOverlay y capture()

**Files:**
- Create: `src/components/voice/VoiceOverlay.tsx`
- Modify: `src/components/shell/Shell.tsx:39` (montar el overlay una sola vez)

**Interfaces:**
- Consumes: `NexusVoice.subscribe` (Task 9), `VoiceMicButton` (Task 10).
- Produces: `<VoiceOverlay />`.

- [ ] **Step 1: Implementar `VoiceOverlay.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { NexusVoice } from "@/lib/voice/nexus-voice";
import type { VoiceSession, VoiceState } from "@/lib/voice/types";

/**
 * Renderer por defecto del Modo Global. Se monta UNA sola vez en el shell y se
 * suscribe a NexusVoice. capture({ headless: true }) no publica nada y este
 * overlay no aparece: el llamador dibuja su propia interfaz.
 */
export function VoiceOverlay() {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [state, setState] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);

  useEffect(() => NexusVoice.subscribe(setSession), []);

  useEffect(() => {
    if (!session) {
      setPartial("");
      setLevel(0);
      return;
    }
    setState(session.state);
    const offs = [
      session.on("state", setState),
      session.on("partial", setPartial),
      session.on("level", setLevel),
    ];
    return () => offs.forEach((off) => off());
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const onKey = (ev: KeyboardEvent) => {
      // Escape = Cancelar. Misma regla que en Modo Campo. Ver spec §6.1.
      if (ev.key === "Escape") session.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  if (!session) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-6"
      onClick={() => session.cancel()}
      role="dialog"
      aria-modal="true"
      aria-label="Captura de voz"
    >
      <div
        className="card w-full max-w-md p-5 text-center"
        onClick={(ev) => ev.stopPropagation()}
      >
        <p className="text-eyebrow-sm uppercase text-fg-secondary">
          {state === "processing" ? "Transcribiendo…" : "Escuchando…"}
        </p>

        <div className="my-4 flex h-10 items-end justify-center gap-1" aria-hidden>
          {[0.4, 0.8, 1, 0.8, 0.4].map((weight, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-tops-red transition-[height] duration-75"
              style={{ height: `${6 + Math.min(1, level * weight) * 28}px` }}
            />
          ))}
        </div>

        <p className="min-h-[3rem] text-sm text-fg-primary">
          {partial || <span className="text-fg-muted">Hablá ahora.</span>}
        </p>

        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => session.cancel()}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={state !== "listening"}
            onClick={() => void session.stop()}
          >
            Finalizar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Montar el overlay en el shell**

En `src/components/shell/Shell.tsx` (ya es `"use client"`), agregar el import y montar el
componente inmediatamente después de `{children}` (línea 39):

```tsx
import { VoiceOverlay } from "@/components/voice/VoiceOverlay";
```

```tsx
          {children}
          <VoiceOverlay />
```

- [ ] **Step 3: Verificar en el navegador**

Run: `npm run dev`

`NexusVoice` no es alcanzable desde la consola del navegador: vive dentro de un chunk de
Next con nombre generado. Verificá con un botón temporal. Agregá esto **de forma
transitoria** en `src/app/(app)/copilot/page.tsx` y borralo antes de commitear:

```tsx
<button type="button" onClick={async () => {
  const { NexusVoice } = await import("@/lib/voice/nexus-voice");
  const texto = await NexusVoice.capture();
  console.log("capture() →", texto);
}}>Probar Modo Global</button>
```

Verificar:
1. Clic → aparece el overlay con las barras moviéndose al hablar.
2. **Finalizar** → `capture() → "El texto dictado"` en la consola.
3. Repetir y hacer clic en **Cancelar** → `capture() → null`. **Nunca una excepción.**
4. Repetir y presionar `Escape` → `capture() → null`.
5. Repetir y hacer clic en el fondo oscuro → `capture() → null`.
6. Mientras el overlay está abierto, el micrófono del Copilot no puede iniciar otra sesión.

Borrar el botón temporal antes de commitear.

- [ ] **Step 4: Verificar todo**

Run: `npm run typecheck && npm test`
Expected: todo verde.

Run: `grep -rn "from \"react\"\|from \"next" src/lib/voice/ ; echo "exit=$?"`
Expected: `exit=1`. La frontera se sostuvo hasta el final.

- [ ] **Step 5: Commit**

```bash
git add src/components/voice/VoiceOverlay.tsx src/components/shell/Shell.tsx
git commit -m "feat(voice): Modo Global — NexusVoice.capture() + VoiceOverlay"
```

---

## Criterios de aceptación de v1

Nexus Voice v1 está terminado cuando **todos** se cumplen:

- [ ] `npm test` verde, incluidas las 92 suites preexistentes. **Cero dependencias nuevas** (`git diff 0c361c0 -- package.json` vacío).
- [ ] `grep -rn "from \"react\"" src/lib/voice/` no devuelve nada.
- [ ] El input del Copilot dicta, y `CopilotChat.tsx` no contiene ninguna rama de código para voz.
- [ ] Los textareas de texto libre dictan con la misma interacción, sin código duplicado.
- [ ] `await NexusVoice.capture()` devuelve `string` al finalizar y `null` al cancelar, desde código plano.
- [ ] El texto entra **en el cursor**, una sola vez, y respeta una selección activa.
- [ ] `Escape` descarta el dictado en **ambos modos**.
- [ ] El takeover entre dos campos **preserva el texto del primero y lo inserta en su campo original**.
- [ ] Las barras de nivel se mueven con la voz real. No hay animación simulada.
- [ ] Denegar el permiso muestra un mensaje amable. Ninguna excepción llega al usuario.
- [ ] En Firefox el micrófono **no aparece** y los campos funcionan normalmente.
- [ ] `NEXT_PUBLIC_VOICE_ENABLED=0` hace desaparecer todos los micrófonos.

---

## Riesgos y contingencias

| Riesgo | Señal de que ocurrió | Contingencia |
|---|---|---|
| `cloneElement` pelea con el `<form>` flex del Copilot | El input se desborda o el botón "Preguntar" se desplaza | `VoiceField` expone una variante render-prop: `<VoiceField>{(ref, mic) => <input ref={ref}/>}</VoiceField>`. Task 11 Step 2. |
| El dictado muere a los pocos segundos | Chrome emitió `end` y no reiniciamos | Verificar el flag `wantsToListen` en `web-speech.ts`. Es la trampa 1 del spec §8. |
| El texto entra al final y no en el caret | Falta el `preventDefault()` del `mousedown` | Trampa 2 del spec §8. Revisar `VoiceMicButton`. |
| El caret salta al final tras insertar | React reposicionó en el re-render | El `queueMicrotask` de `dom.ts` lo corrige. Si persiste, subir a `setTimeout(..., 0)`. |
| Dos streams de micrófono causan eco | Audio con eco en auriculares | Pasar `{ audio: { echoCancellation: true } }` en `defaultRequestStream`. |
| `settings/roles/new/page.tsx` es Server Component | Error de build al usar hooks | No envolverlo. Queda fuera de alcance (Task 12 Step 1). |

---

## Fuera de alcance (confirmado)

Ninguna tarea de este plan implementa: Text-to-Speech, wake word, conversación continua,
inserción de parciales en vivo, multi-idioma, comandos de voz de acción,
`punctuationStrategy: "ai"`, el feature flag de Nivel 2 (organización/rol/usuario), el
primitivo React `<Input>`/`<Textarea>`, ni la migración de los campos `number`, `date`,
`checkbox`, `button` o `submit`.

La ausencia de puntuación automática es una **decisión deliberada de producto**, no una
limitación de la implementación. Ver spec §7.1.

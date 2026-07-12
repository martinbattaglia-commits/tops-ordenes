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

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

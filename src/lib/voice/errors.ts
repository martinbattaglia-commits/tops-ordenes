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

/** Traduce un error del motor a la taxonomía de Nexus Voice. */
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

/**
 * Alerta de silencio de tracking — lógica pura.
 *
 * ─── POR QUÉ EXISTE ───────────────────────────────────────────────────────
 *
 * El tracking estuvo 38 días sin recibir una sola posición y nadie se enteró:
 * última posición el 10-07-2026, detectado el 17-08-2026. No falló nada que
 * emitiera un error — simplemente dejó de entrar información, y la ausencia de
 * datos no dispara ninguna alarma por sí sola.
 *
 * ─── QUÉ HACE (Y QUÉ NO) ──────────────────────────────────────────────────
 *
 * Una vez por día: si la última posición es más vieja que el umbral, manda un
 * correo. Nada más. Sin estado, sin deduplicación, sin panel, sin severidades.
 * Si el silencio dura tres días llegan tres correos, y está bien: son tres días
 * sin tracking.
 *
 * No distingue QUÉ vehículo calló. Si no entra nada, no entra nada — y ése es
 * el único caso que esta alerta tiene que detectar.
 */

/** Umbral por defecto: 24 h evita el falso positivo del fin de semana. */
export const TRACKING_SILENCE_DEFAULT_HOURS = 24;

/** Destinatarios fijos (decisión de Dirección; sin configuración en la UI). */
export const TRACKING_SILENCE_RECIPIENTS = [
  "martin@logisticatops.com",
  "joseluis@logisticatops.com",
  "martinrinas@logisticatops.com",
] as const;

/**
 * Umbral en horas desde la variable de entorno, con default. Un valor ausente,
 * no numérico o <= 0 cae al default en vez de deshabilitar la alerta: una
 * variable mal escrita no puede apagar el aviso en silencio.
 */
export function trackingSilenceThresholdHours(
  raw: string | undefined = process.env.TRACKING_SILENCE_THRESHOLD_HOURS,
): number {
  const n = Number(raw?.trim());
  return Number.isFinite(n) && n > 0 ? n : TRACKING_SILENCE_DEFAULT_HOURS;
}

export type TrackingSilenceEvaluation =
  | { alert: false; hoursSilent: number; lastAt: string }
  | {
      alert: true;
      /** null cuando `fleet_positions` no tiene ninguna fila. */
      lastAt: string | null;
      hoursSilent: number | null;
      subject: string;
      text: string;
      html: string;
    };

function formatearFecha(iso: string): string {
  // Hora de Argentina, que es donde operan los camiones y quien lee el correo.
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}

function formatearDuracion(horas: number): string {
  if (horas < 48) return `${Math.floor(horas)} horas`;
  return `${Math.floor(horas / 24)} días`;
}

/**
 * Decide si hay que avisar y arma el mensaje. Puro: recibe el instante actual
 * en vez de leer el reloj, así la prueba no depende de cuándo corre.
 */
export function evaluateTrackingSilence(input: {
  lastCreatedAt: string | null;
  nowMs: number;
  thresholdHours: number;
}): TrackingSilenceEvaluation {
  const { lastCreatedAt, nowMs, thresholdHours } = input;

  const queRevisar = [
    "Revisar que el servidor Traccar esté levantado y reenviando a Nexus.",
    "Revisar que los equipos GPS estén encendidos y reportando.",
  ];

  if (!lastCreatedAt) {
    const subject = "Tracking sin datos: no hay ninguna posición registrada";
    const lineas = [
      "No hay NINGUNA posición registrada en el sistema de tracking.",
      "",
      ...queRevisar,
    ];
    return {
      alert: true,
      lastAt: null,
      hoursSilent: null,
      subject,
      text: lineas.join("\n"),
      html: renderHtml(subject, lineas),
    };
  }

  const lastMs = Date.parse(lastCreatedAt);
  // Una fecha ilegible se trata como silencio: preferimos un correo de más
  // antes que perder 38 días de nuevo por un dato que no se pudo interpretar.
  const hoursSilent = Number.isFinite(lastMs)
    ? (nowMs - lastMs) / 3_600_000
    : Number.POSITIVE_INFINITY;

  if (hoursSilent < thresholdHours) {
    return { alert: false, hoursSilent, lastAt: lastCreatedAt };
  }

  const cuanto = Number.isFinite(hoursSilent)
    ? formatearDuracion(hoursSilent)
    : "un tiempo indeterminado";
  const subject = `Tracking sin datos hace ${cuanto}`;
  const lineas = [
    `Hace ${cuanto} que no entra una posición nueva al tracking de flota.`,
    `Última posición recibida: ${
      Number.isFinite(lastMs) ? formatearFecha(lastCreatedAt) : lastCreatedAt
    }.`,
    "",
    ...queRevisar,
  ];

  return {
    alert: true,
    lastAt: lastCreatedAt,
    hoursSilent: Number.isFinite(hoursSilent) ? hoursSilent : null,
    subject,
    text: lineas.join("\n"),
    html: renderHtml(subject, lineas),
  };
}

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHtml(subject: string, lineas: string[]): string {
  const cuerpo = lineas
    .map((l) => (l === "" ? "<br/>" : `<p style="margin:0 0 8px">${escapar(l)}</p>`))
    .join("\n");
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a">',
    `<h2 style="font-size:16px;margin:0 0 12px">${escapar(subject)}</h2>`,
    cuerpo,
    "</div>",
  ].join("\n");
}

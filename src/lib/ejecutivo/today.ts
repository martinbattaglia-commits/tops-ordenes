/**
 * "Información del día" — contexto ejecutivo liviano para el Cockpit.
 *
 * Provee fecha/hora local (America/Argentina/Buenos_Aires) + clima actual de
 * CABA vía Open-Meteo (API gratuita, SIN API key, sin límite práctico para
 * uso interno). Diseñado como CONTEXTO ejecutivo, no como portal de noticias:
 * la sección de noticias queda como contrato estable pero pendiente hasta
 * definir las 3-4 fuentes (decisión del usuario — ver §5 del informe).
 *
 * Fuente clima: https://open-meteo.com/  (CC-BY 4.0, no requiere registro)
 */

import { getDailyNews, type NewsItem, type NewsCategory } from "./news";

export type { NewsItem, NewsCategory } from "./news";

const CABA_LAT = -34.6037;
const CABA_LNG = -58.3816;
const TZ = "America/Argentina/Buenos_Aires";

export interface WeatherNow {
  /** Temperatura actual en °C (redondeada). */
  tempC: number | null;
  /** Sensación térmica en °C. */
  feelsLikeC: number | null;
  /** Humedad relativa %. */
  humidity: number | null;
  /** Viento km/h. */
  windKmh: number | null;
  /** Código WMO de Open-Meteo. */
  code: number | null;
  /** Descripción en español del estado del cielo. */
  description: string;
  /** true = día, false = noche (afecta el ícono sugerido). */
  isDay: boolean;
}

export interface TodayInfo {
  /** ISO con offset local (-03:00). */
  nowIso: string;
  /** "viernes 30 de mayo de 2026" */
  dateLabel: string;
  /** "10:42" */
  timeLabel: string;
  weather: WeatherNow | null;
  /** Motivo si weather=null (clima no disponible). */
  weatherPendingReason?: string;
  /** Hasta 4 titulares (La Nación + Canal 26). Vacío si las fuentes fallan. */
  news: NewsItem[];
}

/**
 * Mapea el weather_code WMO de Open-Meteo a una descripción en español
 * rioplatense neutro. Tabla oficial: https://open-meteo.com/en/docs
 */
function describeWmo(code: number | null): string {
  if (code === null) return "—";
  if (code === 0) return "Despejado";
  if (code === 1) return "Mayormente despejado";
  if (code === 2) return "Parcialmente nublado";
  if (code === 3) return "Nublado";
  if (code === 45 || code === 48) return "Niebla";
  if (code >= 51 && code <= 57) return "Llovizna";
  if (code >= 61 && code <= 67) return "Lluvia";
  if (code >= 71 && code <= 77) return "Nieve";
  if (code >= 80 && code <= 82) return "Chaparrones";
  if (code === 85 || code === 86) return "Chaparrones de nieve";
  if (code === 95) return "Tormenta";
  if (code === 96 || code === 99) return "Tormenta con granizo";
  return "—";
}

function buildDateLabels(now: Date): { dateLabel: string; timeLabel: string } {
  const dateLabel = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const timeLabel = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { dateLabel, timeLabel };
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
    is_day?: number;
  };
}

async function fetchWeather(): Promise<{ weather: WeatherNow | null; reason?: string }> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${CABA_LAT}&longitude=${CABA_LNG}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
    `&timezone=${encodeURIComponent(TZ)}`;

  try {
    const res = await fetch(url, {
      // Cache 15 min: el clima no cambia minuto a minuto y evita saturar la API.
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return { weather: null, reason: `Open-Meteo respondió ${res.status}.` };
    }
    const body = (await res.json()) as OpenMeteoResponse;
    const c = body.current;
    if (!c) return { weather: null, reason: "Respuesta de clima sin datos." };

    const code = typeof c.weather_code === "number" ? c.weather_code : null;
    return {
      weather: {
        tempC: typeof c.temperature_2m === "number" ? Math.round(c.temperature_2m) : null,
        feelsLikeC:
          typeof c.apparent_temperature === "number" ? Math.round(c.apparent_temperature) : null,
        humidity:
          typeof c.relative_humidity_2m === "number" ? Math.round(c.relative_humidity_2m) : null,
        windKmh: typeof c.wind_speed_10m === "number" ? Math.round(c.wind_speed_10m) : null,
        code,
        description: describeWmo(code),
        isDay: c.is_day !== 0,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    return { weather: null, reason: `No se pudo obtener el clima: ${msg}` };
  }
}

export async function getTodayInfo(): Promise<TodayInfo> {
  const now = new Date();
  const { dateLabel, timeLabel } = buildDateLabels(now);

  // Clima y noticias en paralelo (cada uno degrada solo si falla).
  const [{ weather, reason }, news] = await Promise.all([
    fetchWeather(),
    getDailyNews(),
  ]);

  return {
    nowIso: now.toISOString(),
    dateLabel,
    timeLabel,
    weather,
    weatherPendingReason: weather ? undefined : reason,
    news,
  };
}

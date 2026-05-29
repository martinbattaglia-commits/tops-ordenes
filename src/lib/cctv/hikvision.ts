import { env } from "@/lib/env";
import { digestFetch } from "./digest";

/**
 * Cliente Hikvision ISAPI v2.0+ — específico para el NVR ERI-K216-P16
 * de TOPS Magaldi (16 canales, sub-streams 0=main/HD, 1=sub/SD).
 *
 * Endpoints utilizados:
 *   GET /ISAPI/System/deviceInfo                              → datos del NVR
 *   GET /ISAPI/Streaming/channels                              → listado canales
 *   GET /ISAPI/Streaming/channels/{ch}/picture                 → snapshot JPEG
 *
 * El channel ID en Hikvision sigue el patrón {N}0{S}, donde:
 *   - N = nº de canal (1..16)
 *   - S = stream (1=main/HD, 2=sub/SD)
 * Ejemplo: cámara D3 stream HD → "301", D3 stream SD → "302".
 *
 * Nota: el NVR responde XML por defecto (no JSON). Parseamos lo mínimo
 * necesario con regex; para producción intensiva conviene usar un XML parser.
 */

function baseUrl(): string {
  const proto = env.hikvision.useHttps ? "https" : "http";
  const port = env.hikvision.useHttps ? env.hikvision.httpsPort : env.hikvision.httpPort;
  return `${proto}://${env.hikvision.host}:${port}`;
}

function ensureConfigured(): void {
  if (!env.hikvision.configured) {
    throw new HikvisionError(503, "Hikvision NVR no configurado (HIKVISION_HOST/USER/PASSWORD)");
  }
}

export class HikvisionError extends Error {
  constructor(public status: number, message: string, public path?: string) {
    super(message);
    this.name = "HikvisionError";
  }
}

async function isapi(path: string, opts: { method?: "GET" | "POST"; timeoutMs?: number } = {}) {
  ensureConfigured();
  const url = `${baseUrl()}${path}`;
  return digestFetch(url, {
    user: env.hikvision.user,
    password: env.hikvision.password,
    method: opts.method ?? "GET",
    timeoutMs: opts.timeoutMs ?? 10_000,
  });
}

// ------------------------------------------------------------------
// Device info
// ------------------------------------------------------------------

export interface HikvisionDeviceInfo {
  deviceName: string;
  deviceID: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  firmwareReleasedDate: string;
  bootVersion?: string;
  encoderVersion?: string;
  deviceType?: string;
}

function pickXmlTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

export async function getDeviceInfo(): Promise<HikvisionDeviceInfo> {
  const res = await isapi("/ISAPI/System/deviceInfo");
  if (!res.ok) {
    throw new HikvisionError(res.status, await res.text().catch(() => res.statusText), "/ISAPI/System/deviceInfo");
  }
  const xml = await res.text();
  return {
    deviceName: pickXmlTag(xml, "deviceName"),
    deviceID: pickXmlTag(xml, "deviceID"),
    model: pickXmlTag(xml, "model"),
    serialNumber: pickXmlTag(xml, "serialNumber"),
    firmwareVersion: pickXmlTag(xml, "firmwareVersion"),
    firmwareReleasedDate: pickXmlTag(xml, "firmwareReleasedDate"),
    bootVersion: pickXmlTag(xml, "bootVersion"),
    encoderVersion: pickXmlTag(xml, "encoderVersion"),
    deviceType: pickXmlTag(xml, "deviceType"),
  };
}

// ------------------------------------------------------------------
// Channels
// ------------------------------------------------------------------

export interface HikvisionChannel {
  /** Channel ID Hikvision (ej "101", "202"). */
  id: string;
  /** Número físico del canal (1..16). */
  channelNumber: number;
  /** Stream type: main=1 (HD), sub=2 (SD). */
  streamType: 1 | 2;
  name: string;
  enabled: boolean;
  resolutionW?: number;
  resolutionH?: number;
  fps?: number;
  videoCodec?: string;
}

export async function listChannels(): Promise<HikvisionChannel[]> {
  const res = await isapi("/ISAPI/Streaming/channels");
  if (!res.ok) {
    throw new HikvisionError(res.status, await res.text().catch(() => res.statusText), "/ISAPI/Streaming/channels");
  }
  const xml = await res.text();
  const out: HikvisionChannel[] = [];
  const reChannel = /<StreamingChannel[^>]*>([\s\S]*?)<\/StreamingChannel>/g;
  let m: RegExpExecArray | null;
  while ((m = reChannel.exec(xml))) {
    const body = m[1];
    const id = pickXmlTag(body, "id");
    if (!id) continue;
    const n = parseInt(id, 10);
    const channelNumber = Math.floor(n / 100);
    const streamType = ((n % 100) === 1 ? 1 : 2) as 1 | 2;
    out.push({
      id,
      channelNumber,
      streamType,
      name: pickXmlTag(body, "channelName") || `Canal D${channelNumber}`,
      enabled: pickXmlTag(body, "enabled").toLowerCase() === "true",
      videoCodec: pickXmlTag(body, "videoCodecType"),
      resolutionW: parseInt(pickXmlTag(body, "videoResolutionWidth"), 10) || undefined,
      resolutionH: parseInt(pickXmlTag(body, "videoResolutionHeight"), 10) || undefined,
      fps: parseInt(pickXmlTag(body, "maxFrameRate"), 10) / 100 || undefined,
    });
  }
  return out.sort((a, b) => a.channelNumber - b.channelNumber || a.streamType - b.streamType);
}

/**
 * Sintetiza la lista de cámaras con metadata por defecto si el NVR no devuelve
 * StreamingChannel (algunos firmwares responden vacío hasta que se configura
 * cada canal). Garantiza que la UI siempre puede renderear los 16 canales.
 */
export async function listCamerasSafe(): Promise<HikvisionChannel[]> {
  try {
    const real = await listChannels();
    if (real.length > 0) return real;
  } catch (e) {
    console.warn("[hikvision] listChannels falló, usando fallback default:", (e as Error).message);
  }
  // Fallback: generar 16 canales con stream main por defecto
  const fallback: HikvisionChannel[] = [];
  for (let n = 1; n <= env.hikvision.channels; n++) {
    fallback.push({
      id: `${n}01`,
      channelNumber: n,
      streamType: 1,
      name: `Canal D${n}`,
      enabled: true,
      videoCodec: "H.264",
    });
  }
  return fallback;
}

// ------------------------------------------------------------------
// Snapshot
// ------------------------------------------------------------------

export async function getSnapshot(channelId: string): Promise<Buffer> {
  const res = await isapi(`/ISAPI/Streaming/channels/${channelId}/picture`, { timeoutMs: 15_000 });
  if (!res.ok) {
    throw new HikvisionError(
      res.status,
      await res.text().catch(() => res.statusText),
      `/ISAPI/Streaming/channels/${channelId}/picture`
    );
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Construye URL RTSP para un canal. Útil para clientes de video (VLC, ffmpeg)
 * que sí soportan RTSP — desde el navegador necesitaríamos un transcoder
 * a HLS/WebRTC (TODO F3).
 */
export function rtspUrl(channelId: string, includeAuth = false): string {
  const auth = includeAuth
    ? `${encodeURIComponent(env.hikvision.user)}:${encodeURIComponent(env.hikvision.password)}@`
    : "";
  return `rtsp://${auth}${env.hikvision.host}:${env.hikvision.rtspPort}/Streaming/Channels/${channelId}`;
}

// ------------------------------------------------------------------
// Diagnostic ping
// ------------------------------------------------------------------

export interface HikvisionPing {
  ok: true;
  deviceName: string;
  model: string;
  firmware: string;
  serialNumber: string;
  channels: number;
  cameras: Array<{ id: string; name: string; channelNumber: number }>;
}

export async function ping(): Promise<HikvisionPing> {
  const [device, cameras] = await Promise.all([
    getDeviceInfo(),
    listCamerasSafe().then((all) => all.filter((c) => c.streamType === 1)),
  ]);
  return {
    ok: true,
    deviceName: device.deviceName,
    model: device.model,
    firmware: `${device.firmwareVersion} (${device.firmwareReleasedDate})`,
    serialNumber: device.serialNumber,
    channels: cameras.length,
    cameras: cameras.map((c) => ({ id: c.id, name: c.name, channelNumber: c.channelNumber })),
  };
}

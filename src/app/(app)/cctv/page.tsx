import { Icon } from "@/components/Icon";
import {
  listCamerasSafe,
  getDeviceInfo,
  HikvisionError,
  type HikvisionChannel,
  type HikvisionDeviceInfo,
} from "@/lib/cctv/hikvision";
import { env } from "@/lib/env";
import { CctvGrid } from "./CctvGrid";
import { EVENTS } from "@/lib/cctv/data";

export const metadata = { title: "CCTV · Centro de monitoreo" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CctvPage() {
  if (!env.hikvision.configured) {
    return <NotConfigured />;
  }

  let cameras: HikvisionChannel[] = [];
  let device: HikvisionDeviceInfo | null = null;
  let connectionError: string | null = null;
  try {
    [cameras, device] = await Promise.all([
      listCamerasSafe().then((all) => all.filter((c) => c.streamType === 1)),
      getDeviceInfo().catch(() => null),
    ]);
  } catch (e) {
    connectionError =
      e instanceof HikvisionError ? `${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e);
  }

  // Cuando no hay nombres reales asignados, asociamos por ubicación lógica.
  // Default: 1-6 Magaldi (ANMAT), 7-12 Barracas (General), 13-16 Luján.
  const LOCATION_MAP: Record<number, { location: string; sector: string }> = {
    1: { location: "Magaldi", sector: "Recepción" },
    2: { location: "Magaldi", sector: "Muelle de carga 1" },
    3: { location: "Magaldi", sector: "ANMAT pasillo A" },
    4: { location: "Magaldi", sector: "ANMAT pasillo B" },
    5: { location: "Magaldi", sector: "Cámara fría 1" },
    6: { location: "Magaldi", sector: "Cámara fría 2" },
    7: { location: "Magaldi", sector: "Perímetro N" },
    8: { location: "Magaldi", sector: "Perímetro S" },
    9: { location: "Magaldi", sector: "Oficinas DT" },
    10: { location: "Magaldi", sector: "Pasillo central" },
    11: { location: "Magaldi", sector: "Estanterías 1" },
    12: { location: "Magaldi", sector: "Estanterías 2" },
    13: { location: "Magaldi", sector: "Acceso playa" },
    14: { location: "Magaldi", sector: "Playa camiones" },
    15: { location: "Magaldi", sector: "Acceso peatonal" },
    16: { location: "Magaldi", sector: "Despacho" },
  };

  const enriched = cameras.map((c) => {
    const loc = LOCATION_MAP[c.channelNumber] ?? { location: "Sin asignar", sector: c.name };
    return { ...c, ...loc };
  });

  // Agrupar por location
  const byLocation = new Map<string, typeof enriched>();
  for (const c of enriched) {
    const arr = byLocation.get(c.location) ?? [];
    arr.push(c);
    byLocation.set(c.location, arr);
  }

  const onlineCount = enriched.filter((c) => c.enabled).length;
  const total = enriched.length;
  const uptime = total ? Math.round((onlineCount / total) * 1000) / 10 : 0;

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">
            Security Operations Center · Hikvision {device?.model ?? "ERI-K216-P16"} · ISAPI live
          </div>
          <h1 className="page-title">Centro de monitoreo CCTV</h1>
          <p className="page-subtitle">
            {total} cámaras conectadas al NVR principal de Magaldi ·{" "}
            <span className="font-bold text-status-success">{uptime}% online</span>
            {device && (
              <span className="block text-[11px] text-fg-muted font-mono mt-0.5">
                Serial {device.serialNumber} · FW {device.firmwareVersion}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/cctv/ping" target="_blank" rel="noopener" className="btn btn-ghost btn-sm">
            <Icon name="refresh" size={14} />
            <span className="hidden sm:inline">Test NVR</span>
          </a>
          <button className="btn btn-danger btn-sm" type="button">
            <Icon name="bolt" size={14} />
            <span>Alerta panic</span>
          </button>
        </div>
      </div>

      {connectionError && (
        <div className="card p-4 border-tops-red/40 bg-tops-red/5 flex items-start gap-3">
          <Icon name="x" size={20} className="text-tops-red mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-tops-red">No se pudo conectar al NVR</div>
            <div className="text-xs text-fg-secondary mt-1">
              {connectionError} · revisá que el puerto {env.hikvision.httpPort} esté abierto al servidor de la plataforma.
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Cámaras conectadas" value={String(onlineCount)} sub={`de ${total}`} kind="success" />
        <StatCard label="Resolución máxima" value="4 MP" sub="H.264 / H.265" kind="info" />
        <StatCard label="Eventos hoy" value={String(EVENTS.length)} sub="motion + access" kind="warn" />
        <StatCard
          label="NVR status"
          value={connectionError ? "Offline" : "Online"}
          sub={device?.deviceName ?? "ERI-K216-P16"}
          kind={connectionError ? "danger" : "success"}
        />
      </div>

      {/* Camera grid + Events */}
      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)" }}>
        <div className="space-y-5">
          {Array.from(byLocation.entries()).map(([loc, cams]) => (
            <CctvGrid key={loc} location={loc} cameras={cams} />
          ))}
        </div>

        {/* Events feed */}
        <div className="card overflow-hidden flex flex-col" style={{ maxHeight: 720 }}>
          <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-fg-primary">Eventos en vivo</div>
              <div className="text-[11px] text-fg-secondary mt-0.5">
                Motion · access · alarmas · cadena de frío
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-status-success font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
              LIVE
            </span>
          </div>
          <ol className="flex-1 divide-y divide-stroke-soft overflow-y-auto">
            {EVENTS.map((e, i) => {
              const color =
                e.severity === "danger"
                  ? "text-tops-red bg-tops-red/10"
                  : e.severity === "warn"
                    ? "text-status-warning bg-status-warning/10"
                    : "text-tops-blue-700 bg-tops-blue-700/10";
              return (
                <li key={i} className="px-5 py-3 flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-md grid place-items-center flex-shrink-0 ${color}`}>
                    <Icon
                      name={
                        e.kind === "alarm"
                          ? "bolt"
                          : e.kind === "access"
                            ? "shield"
                            : e.kind === "temp"
                              ? "wand"
                              : "eye"
                      }
                      size={14}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-fg-primary truncate">{e.cameraName}</div>
                    <div className="text-[11px] text-fg-secondary line-clamp-2">{e.detail}</div>
                    <div className="text-[10px] text-fg-muted mt-0.5 uppercase tracking-wider font-bold">
                      {e.cameraId} · {e.ts}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="px-5 py-2.5 border-t border-stroke-soft text-[11px] text-fg-muted text-center font-mono">
            NVR Hikvision ERI-K216-P16 · {env.hikvision.host}:{env.hikvision.httpPort} · ISAPI
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  kind,
}: {
  label: string;
  value: string;
  sub: string;
  kind: "success" | "info" | "warn" | "danger" | "muted";
}) {
  const colorMap: Record<typeof kind, string> = {
    success: "text-status-success",
    info: "text-tops-blue-700",
    warn: "text-status-warning",
    danger: "text-tops-red",
    muted: "text-fg-muted",
  };
  return (
    <div className="card p-5">
      <div className="kpi-label">{label}</div>
      <div className={`text-3xl font-bold tabular leading-none mt-1 ${colorMap[kind]}`}>{value}</div>
      <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="p-8">
      <div className="card p-8 max-w-2xl mx-auto">
        <Icon name="eye" size={32} className="text-fg-muted mb-3" />
        <h1 className="text-xl font-bold text-fg-brand mb-2">Hikvision NVR no configurado</h1>
        <p className="text-sm text-fg-secondary mb-4">
          Para activar el centro de monitoreo, setea las variables de entorno{" "}
          <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">
            HIKVISION_HOST
          </code>
          ,{" "}
          <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">HIKVISION_USER</code>{" "}
          y{" "}
          <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">
            HIKVISION_PASSWORD
          </code>{" "}
          en <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">.env.local</code>.
        </p>
      </div>
    </div>
  );
}

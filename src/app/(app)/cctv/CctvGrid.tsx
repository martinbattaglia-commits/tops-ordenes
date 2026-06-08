"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";

interface Camera {
  id: string;
  channelNumber: number;
  name: string;
  location: string;
  sector: string;
  enabled: boolean;
  resolutionW?: number;
  resolutionH?: number;
  fps?: number;
  videoCodec?: string;
}

/**
 * Grid de cámaras por ubicación. Cada tile hace fetch de un snapshot real
 * al proxy /api/cctv/snapshot/{channelId} y lo refresca cada 10 segundos
 * mientras esté visible (IntersectionObserver). Mantiene el feed eficiente
 * incluso con 16 cámaras en pantalla.
 *
 * Click en una cámara → modal fullscreen con snapshot ampliado + metadata
 * (nombre, canal, estado, timestamp). No toca Hikvision/API/NVR/snapshots.
 */
export function CctvGrid({ location, cameras }: { location: string; cameras: Camera[] }) {
  const [selected, setSelected] = useState<Camera | null>(null);
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-stroke-soft flex items-center justify-between bg-neutral-50">
        <div className="flex items-center gap-2">
          <Icon name="building" size={14} className="text-fg-muted" />
          <span className="text-sm font-bold text-fg-primary">{location}</span>
          <span className="text-[10px] text-fg-muted font-mono">{cameras.length} cámaras</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-status-success font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
          {cameras.filter((c) => c.enabled).length}/{cameras.length} online
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
        {cameras.map((cam) => (
          <CameraTile key={cam.id} cam={cam} onOpen={() => setSelected(cam)} />
        ))}
      </div>
      {selected && <CameraModal cam={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Hook compartido: snapshot del proxy con refresh cada 10s. */
function useSnapshot(camId: string, active: boolean) {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  // Inicializa una sola vez; el IntersectionObserver del tile lo actualiza.
  const visibleRef = useRef(active);

  const refresh = () => {
    setStatus("loading");
    setError(null);
    const t = Date.now();
    const url = `/api/cctv/snapshot/${camId}?t=${t}`;
    fetch(url, { method: "HEAD" })
      .then((res) => {
        if (!res.ok) throw new Error(`NVR ${res.status}`);
        setSrc(url);
        setStatus("ok");
        setStamp(new Date().toLocaleString("es-AR"));
      })
      .catch((e) => {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return { src, status, error, stamp, refresh, setStatus, setError, visibleRef };
}

function CameraTile({ cam, onOpen }: { cam: Camera; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { src, status, error, refresh, setStatus, setError, visibleRef } = useSnapshot(cam.id, false);

  // IntersectionObserver: solo refresca cuando visible
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibleRef.current = entry.isIntersecting;
        }
      },
      { rootMargin: "100px" }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh inicial + cada 10s mientras visible
  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      if (visibleRef.current) refresh();
    }, 10_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam.id]);

  return (
    <div
      ref={ref}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      title="Ampliar cámara"
      className="relative rounded-md overflow-hidden border border-stroke-soft bg-tops-blue-900 cursor-pointer hover:ring-2 hover:ring-tops-blue-700 focus:outline-none focus:ring-2 focus:ring-tops-blue-700 transition-all"
    >
      <div
        className="aspect-video relative"
        style={{
          background:
            !cam.enabled || status === "error"
              ? "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)"
              : "linear-gradient(135deg, #050555 0%, #0a0a3a 50%, #050555 100%)",
        }}
      >
        {/* Stream real */}
        {src && status === "ok" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={cam.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => {
              setStatus("error");
              setError("Imagen no disponible");
            }}
          />
        )}

        {/* Scanline overlay */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(255,255,255,0.04) 3px, transparent 4px)",
          }}
        />

        {/* Center icon/placeholder */}
        {!src && (
          <div className="absolute inset-0 grid place-items-center">
            {status === "error" ? (
              <div className="text-center">
                <Icon name="x" size={28} className="text-tops-red mx-auto" />
                <div className="text-[10px] text-white/40 mt-1 uppercase tracking-wider">
                  {error ?? "No signal"}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <Icon name="eye" size={28} className="text-white/30 animate-pulse" />
                <div className="text-[10px] text-white/40 mt-1 uppercase tracking-wider">
                  Conectando…
                </div>
              </div>
            )}
          </div>
        )}

        {/* Hover hint: expandir */}
        <div className="absolute inset-0 z-20 grid place-items-center opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
          <span className="bg-black/60 text-white/90 rounded-full p-2">
            <Icon name="search" size={18} />
          </span>
        </div>

        {/* Overlay UI top */}
        <div className="absolute top-2 left-2 right-2 flex items-center gap-2 z-10">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === "ok"
                ? "bg-status-success animate-pulse"
                : status === "error"
                  ? "bg-tops-red"
                  : "bg-status-warning animate-pulse"
            }`}
          />
          <span className="text-[9px] font-mono font-bold text-white/90 tabular bg-black/50 px-1.5 py-0.5 rounded">
            D{cam.channelNumber}
          </span>
          {cam.resolutionW && cam.resolutionH && (
            <span className="ml-auto text-[9px] font-mono font-bold text-white/90 bg-black/50 px-1.5 py-0.5 rounded">
              {cam.resolutionH}p
            </span>
          )}
        </div>

        {/* REC indicator */}
        {status === "ok" && (
          <div className="absolute top-7 right-2 flex items-center gap-1 z-10 bg-black/50 px-1.5 py-0.5 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-tops-red animate-pulse" />
            <span className="text-[9px] font-mono font-bold text-tops-red">REC</span>
          </div>
        )}

        {/* Bottom labels */}
        <div className="absolute bottom-2 left-2 right-2 z-10 bg-gradient-to-t from-black/70 via-black/30 to-transparent -mx-2 -mb-2 px-3 pt-4 pb-2">
          <div className="text-[11px] font-bold text-white truncate">{cam.name || cam.sector}</div>
          <div className="text-[9px] text-white/70 truncate">
            {cam.sector} · {cam.videoCodec ?? "H.264"}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Modal fullscreen con snapshot ampliado + metadata. Portal a body → fixed real. */
function CameraModal({ cam, onClose }: { cam: Camera; onClose: () => void }) {
  const { src, status, error, stamp, refresh } = useSnapshot(cam.id, true);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const estado = status === "ok" ? "Online" : status === "error" ? "Offline" : "Conectando";
  const estadoColor =
    status === "ok" ? "text-status-success" : status === "error" ? "text-tops-red" : "text-status-warning";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className="relative w-full max-w-5xl bg-tops-blue-900 rounded-lg overflow-hidden border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <span
            className={`w-2 h-2 rounded-full ${
              status === "ok"
                ? "bg-status-success animate-pulse"
                : status === "error"
                  ? "bg-tops-red"
                  : "bg-status-warning animate-pulse"
            }`}
          />
          <span className="text-[10px] font-mono font-bold text-white/90 bg-black/40 px-1.5 py-0.5 rounded">
            D{cam.channelNumber}
          </span>
          <span className="text-sm font-bold text-white truncate">{cam.name || cam.sector}</span>
          <span className="text-[11px] text-white/60 truncate hidden sm:inline">
            · {cam.location} · {cam.sector}
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-white/70 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
            aria-label="Cerrar"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Snapshot ampliado */}
        <div className="relative aspect-video bg-black grid place-items-center">
          {src && status === "ok" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={cam.name} className="absolute inset-0 w-full h-full object-contain" />
          ) : (
            <div className="text-center">
              {status === "error" ? (
                <>
                  <Icon name="x" size={40} className="text-tops-red mx-auto" />
                  <div className="text-xs text-white/50 mt-2">{error ?? "No signal"}</div>
                </>
              ) : (
                <>
                  <Icon name="eye" size={40} className="text-white/30 animate-pulse mx-auto" />
                  <div className="text-xs text-white/40 mt-2">Conectando…</div>
                </>
              )}
            </div>
          )}
          {status === "ok" && (
            <div className="absolute top-3 right-3 flex items-center gap-1 z-10 bg-black/50 px-2 py-1 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-tops-red animate-pulse" />
              <span className="text-[10px] font-mono font-bold text-tops-red">REC</span>
            </div>
          )}
        </div>

        {/* Footer metadata */}
        <div className="px-4 py-3 border-t border-white/10 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-white/70">
          <span>Canal: <b className="text-white">D{cam.channelNumber}</b></span>
          <span>Estado: <b className={estadoColor}>{estado}</b></span>
          {cam.resolutionW && cam.resolutionH && (
            <span>Resolución: <b className="text-white">{cam.resolutionW}×{cam.resolutionH}</b></span>
          )}
          <span>Codec: <b className="text-white">{cam.videoCodec ?? "H.264"}</b></span>
          {stamp && <span className="sm:ml-auto">Snapshot: <b className="text-white">{stamp}</b></span>}
        </div>
      </div>
    </div>,
    document.body
  );
}

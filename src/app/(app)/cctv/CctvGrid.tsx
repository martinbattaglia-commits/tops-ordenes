"use client";

import { useEffect, useRef, useState } from "react";
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
 */
export function CctvGrid({ location, cameras }: { location: string; cameras: Camera[] }) {
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
          <CameraTile key={cam.id} cam={cam} />
        ))}
      </div>
    </div>
  );
}

function CameraTile({ cam }: { cam: Camera }) {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(false);

  // Refresca el snapshot. Bust cache con timestamp.
  const refresh = () => {
    setStatus("loading");
    setError(null);
    const t = Date.now();
    const url = `/api/cctv/snapshot/${cam.id}?t=${t}`;
    // Pre-validamos para capturar 5xx/Error y mostrar mensaje
    fetch(url, { method: "HEAD" })
      .then((res) => {
        if (!res.ok) throw new Error(`NVR ${res.status}`);
        setSrc(url);
        setStatus("ok");
      })
      .catch((e) => {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      });
  };

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
      className="relative rounded-md overflow-hidden border border-stroke-soft bg-tops-blue-900 cursor-pointer hover:ring-2 hover:ring-tops-blue-700 transition-all"
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

"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import type { TodayInfo, NewsCategory } from "@/lib/ejecutivo/today";

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  economia: "Economía",
  comercio_exterior: "Comercio Ext.",
  logistica: "Logística",
  tecnologia: "Tecnología",
};

/**
 * "Información del día" — tira de contexto ejecutivo en el Cockpit.
 *
 * Muestra fecha, hora local (reloj vivo) y clima actual de CABA. Pensado como
 * CONTEXTO, no como portal: una sola línea, sin imágenes ni feeds largos.
 * Las noticias (Economía/Logística/Comercio Exterior/Tecnología) quedan
 * preparadas en el contrato `TodayInfo.news` pero ocultas hasta definir fuentes.
 *
 * El reloj corre en cliente (cada 30 s); el clima se trae una vez de /api/today
 * (que a su vez cachea Open-Meteo 15 min).
 */

function weatherIcon(info: TodayInfo["weather"]): IconName {
  if (!info || info.code === null) return "cloud";
  const c = info.code;
  // Despejado / mayormente despejado → sol o luna según horario
  if (c <= 1) return info.isDay ? "sun" : "moon";
  return "cloud";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function TodayStrip() {
  const [info, setInfo] = useState<TodayInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [clock, setClock] = useState<string>("");

  // Reloj vivo en cliente (zona horaria CABA).
  useEffect(() => {
    const tick = () => {
      setClock(
        new Intl.DateTimeFormat("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date())
      );
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Fetch del contexto (fecha + clima) una vez.
  useEffect(() => {
    let alive = true;
    fetch("/api/today")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: TodayInfo) => {
        if (alive) setInfo(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const w = info?.weather ?? null;
  const news = info?.news ?? [];

  return (
    <div className="card overflow-hidden">
    <div className="px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      {/* Fecha */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon name="calendar" size={16} className="text-fg-muted flex-shrink-0" />
        <span className="text-sm font-bold text-fg-primary truncate">
          {info ? capitalize(info.dateLabel) : <span className="text-fg-muted">Cargando…</span>}
        </span>
      </div>

      {/* Hora viva */}
      <div className="flex items-center gap-2.5">
        <Icon name="clock" size={16} className="text-fg-muted" />
        <span className="text-sm font-bold tabular text-fg-primary">{clock || "—"}</span>
        <span className="text-[10px] text-fg-muted">CABA · GMT-3</span>
      </div>

      {/* Clima */}
      <div className="flex items-center gap-2.5 ml-auto">
        {w ? (
          <>
            <Icon name={weatherIcon(w)} size={18} className="text-tops-blue-700" />
            <span className="text-sm font-bold tabular text-fg-primary">
              {w.tempC !== null ? `${w.tempC}°` : "—"}
            </span>
            <span className="text-[12px] text-fg-secondary">{w.description}</span>
            <span className="hidden sm:inline text-[11px] text-fg-muted">
              {w.feelsLikeC !== null && <>ST {w.feelsLikeC}° · </>}
              {w.humidity !== null && <>Hum {w.humidity}% · </>}
              {w.windKmh !== null && <>Viento {w.windKmh} km/h</>}
            </span>
          </>
        ) : failed || (info && !info.weather) ? (
          <span className="text-[11px] text-fg-muted">Clima no disponible</span>
        ) : (
          <span className="text-[11px] text-fg-muted">Clima…</span>
        )}
      </div>
    </div>

    {/* Noticias del día — La Nación · Canal 26 (contexto, no portal) */}
    {news.length > 0 && (
      <div className="border-t border-stroke-soft divide-y divide-stroke-soft">
        {news.map((n) => (
          <a
            key={n.url}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-5 py-2 hover:bg-neutral-50 transition-colors group"
          >
            <span className="text-[9px] font-bold uppercase tracking-wider text-tops-blue-700 bg-tops-blue-700/10 px-1.5 py-0.5 rounded flex-shrink-0 w-24 text-center">
              {CATEGORY_LABEL[n.category]}
            </span>
            <span className="text-[12px] text-fg-primary truncate flex-1 group-hover:text-fg-link">
              {n.title}
            </span>
            <span className="text-[10px] text-fg-muted flex-shrink-0 hidden sm:inline">
              {n.source}
            </span>
            <Icon
              name="arrow-up-right"
              size={12}
              className="text-fg-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </a>
        ))}
      </div>
    )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, Marker as MapboxMarker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MOTION_TONE, type FleetMotionStatus } from "@/lib/tracking/live";
import type { FleetMapProps } from "@/lib/tracking/map/types";

/**
 * Motor de mapa MAPBOX (implementa el contrato FleetMapProps).
 *
 * Client-only: mapbox-gl se importa dinámicamente dentro del efecto (toca
 * window) → SSR-safe. Imperativo por diseño: el mapa y los marcadores se manejan
 * con refs; el movimiento en vivo entra por props y se reposiciona con setLngLat
 * (transición CSS, sin librerías de animación).
 *
 * Para sumar otro motor (MapLibre/Google): crear su archivo con la misma firma
 * FleetMapProps y registrarlo en FleetMapCanvas. Este archivo no se toca.
 */

const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";
const DEFAULT_CENTER: [number, number] = [-58.4, -34.62]; // CABA
const DEFAULT_ZOOM = 10;

function buildMarkerEl(): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.style.cssText = "cursor:pointer;border:none;padding:0;background:transparent;display:block";
  const dot = document.createElement("span");
  dot.style.display = "block";
  dot.style.borderRadius = "9999px";
  dot.style.border = "2px solid #0b1220";
  dot.style.transition = "width .15s ease,height .15s ease,box-shadow .15s ease,background .2s ease";
  el.appendChild(dot);
  return el;
}

function styleMarkerEl(el: HTMLElement, motion: FleetMotionStatus, selected: boolean): void {
  const tone = MOTION_TONE[motion];
  const dot = el.firstElementChild as HTMLElement | null;
  if (!dot) return;
  const size = selected ? 20 : 14;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  dot.style.background = tone.hex;
  dot.style.boxShadow = `0 0 0 ${selected ? 4 : 2}px ${tone.hex}55, 0 2px 6px rgba(0,0,0,.5)`;
}

export function MapboxFleetMap({ token, vehicles, selectedId, onSelect }: FleetMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, MapboxMarker>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const didFitRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Init del mapa (una vez por token).
  useEffect(() => {
    if (!token || !containerRef.current) return;
    let cancelled = false;
    let map: MapboxMap | null = null;
    let ro: ResizeObserver | null = null;
    const markers = markersRef.current;

    (async () => {
      try {
        const mapboxgl = (await import("mapbox-gl")).default;
        if (cancelled || !containerRef.current) return;
        mapboxgl.accessToken = token;
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: false,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
        map.on("load", () => {
          if (cancelled) return;
          setReady(true);
          // Forzar un resize tras load: si el contenedor todavía no tenía su
          // tamaño final al inicializar, mapbox arrancaría con viewport 0 y no
          // pediría tiles. Re-medimos para garantizar el render del basemap.
          map?.resize();
        });
        map.on("error", () => !cancelled && setFailed(true));
        mapRef.current = map;

        // ResizeObserver: re-mide ante cualquier cambio de layout (colapso de
        // sidebar, resize de ventana, navegación interna, hidratación tardía).
        // Garantiza que el viewport nunca quede en 0 → tiles siempre cargan.
        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          ro = new ResizeObserver(() => mapRef.current?.resize());
          ro.observe(containerRef.current);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      markers.forEach((m) => m.remove());
      markers.clear();
      didFitRef.current = false;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [token]);

  // Sync de marcadores con el estado de la flota.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const v of vehicles) {
        seen.add(v.id);
        let marker = markers.get(v.id);
        if (!marker) {
          const el = buildMarkerEl();
          el.addEventListener("click", () => onSelectRef.current(v.id));
          marker = new mapboxgl.Marker({ element: el }).setLngLat([v.longitude, v.latitude]).addTo(map);
          markers.set(v.id, marker);
        } else {
          marker.setLngLat([v.longitude, v.latitude]);
        }
        styleMarkerEl(marker.getElement(), v.motion, v.id === selectedId);
      }

      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }

      if (!didFitRef.current && vehicles.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        vehicles.forEach((v) => bounds.extend([v.longitude, v.latitude]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 0 });
        didFitRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicles, ready, selectedId]);

  // Vuelo al vehículo seleccionado.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId) return;
    const v = vehicles.find((x) => x.id === selectedId);
    if (v) map.flyTo({ center: [v.longitude, v.latitude], zoom: 14, duration: 800 });
  }, [selectedId, ready, vehicles]);

  return (
    <div className="relative w-full h-full min-h-[420px]">
      {/* Altura explícita (h-full + min-h), NO `absolute inset-0`: cuando
          mapbox-gl agrega `.mapboxgl-map { position: relative }` pisa el
          position:absolute y el contenedor colapsaba a height:0 → viewport 0 →
          0 tiles → mapa vacío. Con altura propia el basemap siempre renderiza. */}
      <div ref={containerRef} className="h-full w-full min-h-[420px] rounded-xl overflow-hidden" />
      {!ready && !failed && (
        <div className="absolute inset-0 grid place-items-center rounded-xl bg-bg-surface-alt animate-pulse">
          <span className="text-xs text-fg-muted">Cargando mapa…</span>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 grid place-items-center rounded-xl bg-bg-surface-alt">
          <span className="text-xs text-status-danger px-4 text-center">
            No se pudo cargar Mapbox. Verificá el token o la conexión.
          </span>
        </div>
      )}
    </div>
  );
}

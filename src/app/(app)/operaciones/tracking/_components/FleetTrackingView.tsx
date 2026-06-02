"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import type { FleetVehicle, FleetLastPosition } from "@/lib/tracking/types";
import { deriveMotionStatus, type LiveVehicle } from "@/lib/tracking/live";
import type { MapVehicle } from "@/lib/tracking/map/types";
import { useFleetRealtime } from "@/lib/tracking/realtime/useFleetRealtime";
import { FleetKpis, type FleetCounts } from "./FleetKpis";
import { FleetTable } from "./FleetTable";
import { VehiclePanel } from "./VehiclePanel";
import { FleetMapCanvas } from "./FleetMapCanvas";
import { RealtimeStatusBadge } from "./RealtimeStatusBadge";

/**
 * Orquestador de la capa visual del Tracking de Flota (client island).
 *
 * · Siembra el estado con el snapshot SSR (initialVehicles) → sin flash de vacío.
 * · Mergea posiciones en vivo vía Supabase Realtime (useFleetRealtime).
 * · Re-deriva estado live/offline con un tick periódico (recency).
 * · El mapa es agnóstico del motor: delega en FleetMapCanvas (Mapbox/MapLibre/…).
 */

interface FleetTrackingViewProps {
  initialVehicles: FleetVehicle[];
  mapToken: string;
  serverNowMs: number;
}

export function FleetTrackingView({ initialVehicles, mapToken, serverNowMs }: FleetTrackingViewProps) {
  // Overlay de posiciones en vivo (vehicleId → última posición), seed del SSR.
  const [livePositions, setLivePositions] = useState<Record<string, FleetLastPosition>>(() => {
    const seed: Record<string, FleetLastPosition> = {};
    for (const v of initialVehicles) if (v.last_position) seed[v.id] = v.last_position;
    return seed;
  });
  const [nowMs, setNowMs] = useState(serverNowMs);
  const [lastEventMs, setLastEventMs] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Tick de recency: refresca "ahora" para re-derivar offline aunque no lleguen pings.
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Realtime: cada INSERT en fleet_positions mergea la posición del vehículo.
  const onPosition = useCallback(
    (e: {
      vehicleId: string;
      latitude: number;
      longitude: number;
      speedKmh: number | null;
      battery: number | null;
      heading: number | null;
      recordedAt: string;
    }) => {
      setLivePositions((prev) => ({
        ...prev,
        [e.vehicleId]: {
          latitude: e.latitude,
          longitude: e.longitude,
          speed: e.speedKmh,
          battery: e.battery,
          heading: e.heading,
          recorded_at: e.recordedAt,
        },
      }));
      const t = Date.now();
      setNowMs(t);
      setLastEventMs(t);
    },
    []
  );
  const realtimeStatus = useFleetRealtime(onPosition);

  // View-models live.
  const liveVehicles: LiveVehicle[] = useMemo(
    () =>
      initialVehicles.map((v) => {
        const pos = livePositions[v.id] ?? v.last_position;
        return { ...v, last_position: pos, motion: deriveMotionStatus(pos, nowMs) };
      }),
    [initialVehicles, livePositions, nowMs]
  );

  const counts: FleetCounts = useMemo(
    () => ({
      total: liveVehicles.length,
      moving: liveVehicles.filter((v) => v.motion === "moving").length,
      idle: liveVehicles.filter((v) => v.motion === "idle").length,
      offline: liveVehicles.filter((v) => v.motion === "offline").length,
    }),
    [liveVehicles]
  );

  const mapVehicles: MapVehicle[] = useMemo(
    () =>
      liveVehicles
        .filter((v) => v.last_position)
        .map((v) => ({
          id: v.id,
          name: v.name,
          driver: v.driver_name,
          latitude: v.last_position!.latitude,
          longitude: v.last_position!.longitude,
          heading: v.last_position!.heading,
          motion: v.motion,
        })),
    [liveVehicles]
  );

  const selectedVehicle = useMemo(
    () => liveVehicles.find((v) => v.id === selectedId) ?? null,
    [liveVehicles, selectedId]
  );

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Operaciones · Flota</div>
          <h1 className="page-title">Tracking de flota</h1>
          <p className="page-subtitle">
            Monitoreo de vehículos en tiempo real · ingesta vía Traccar Client
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RealtimeStatusBadge status={realtimeStatus} lastEventMs={lastEventMs} nowMs={nowMs} />
        </div>
      </div>

      <FleetKpis counts={counts} />

      {/* Mapa operativo (motor desacoplado vía FleetMapCanvas) */}
      <div className="card p-0 overflow-hidden">
        <div className="relative h-[460px]">
          <FleetMapCanvas
            token={mapToken}
            vehicles={mapVehicles}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <VehiclePanel vehicle={selectedVehicle} nowMs={nowMs} onClose={() => setSelectedId(null)} />
        </div>
      </div>

      <FleetTable vehicles={liveVehicles} selectedId={selectedId} onSelect={setSelectedId} />

      {/* Ingesta Traccar — nota técnica */}
      <div className="card p-4 flex items-start gap-3">
        <Icon name="bolt" size={18} className="text-fg-muted mt-0.5 flex-shrink-0" />
        <div className="text-xs text-fg-muted">
          Los dispositivos reportan posición vía{" "}
          <strong className="text-fg-secondary">Traccar Client</strong> (protocolo OsmAnd) al
          endpoint{" "}
          <code className="font-mono text-[11px] bg-bg-surface-alt px-1.5 py-0.5 rounded">
            /api/tracking/ingest
          </code>
          . La configuración guiada vive en{" "}
          <strong className="text-fg-secondary">Settings → Tracking</strong>.
        </div>
      </div>
    </div>
  );
}

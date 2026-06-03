"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { LogisticsOrderStatus } from "@/lib/pedidos/types";
import {
  PACKING_STATUS_META,
  type PackStop,
  type PackingUnitRow,
  type PhysicalLocation,
} from "@/lib/packing/types";
import {
  createPackingUnitAction,
  packAllocationAction,
  unpackAllocationAction,
  closePackingUnitAction,
  reopenPackingUnitAction,
  confirmPackingOrderAction,
} from "../actions";

type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function locationDetail(l: PhysicalLocation): string {
  return [
    l.warehouse_code,
    l.floor_code && `Piso ${l.floor_code}`,
    l.sector_code,
    l.zone_code && `Pasillo ${l.zone_code}`,
    l.rack_code && `Rack ${l.rack_code}`,
    l.rack_level != null && `Nivel ${l.rack_level}`,
    l.position_code && `Pos ${l.position_code}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Tablero de armado de Packing. Toda mutación va por Server Action; la UI se
 * actualiza por revalidatePath() — sin router.refresh() (criterio anti-503 4A).
 * D3: bulto activo (auto si hay uno solo abierto; seleccionable si hay varios).
 * D2: "Empacar todo" oculto si hay ≥1 bulto abierto.
 */
export function PackBoard({
  orderId,
  status,
  pendingStops,
  units,
}: {
  orderId: string;
  status: LogisticsOrderStatus;
  pendingStops: PackStop[];
  units: PackingUnitRow[];
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [activeUnitId, setActiveUnitId] = useState<string | null>(null);

  const openUnits = units.filter((u) => u.status === "abierta");
  const effectiveActive =
    activeUnitId && openUnits.some((u) => u.id === activeUnitId)
      ? activeUnitId
      : openUnits.length === 1
        ? openUnits[0].id
        : null;

  const isEnPrep = status === "en_preparacion";
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setErr(null);
      const res = await fn();
      if (!res.ok) setErr(res.error);
    });

  const newUnit = () =>
    run(async () => {
      const res = await createPackingUnitAction(orderId);
      if (res.ok && res.id) setActiveUnitId(res.id);
      return res;
    });

  const packInto = (allocationId: string) =>
    run(async () => {
      if (effectiveActive) return packAllocationAction(effectiveActive, allocationId, orderId);
      // Sin bulto abierto → crear uno y empacar en el mismo paso.
      const c = await createPackingUnitAction(orderId);
      if (!c.ok) return c;
      if (c.id) setActiveUnitId(c.id);
      return packAllocationAction(c.id as string, allocationId, orderId);
    });

  const mustChoose = !effectiveActive && openUnits.length > 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {isEnPrep && (
          <button onClick={newUnit} disabled={pending} className="btn btn-ghost btn-sm">
            <Icon name="plus" size={12} stroke={2.2} /> Nuevo bulto
          </button>
        )}
        {pendingStops.length > 0 && openUnits.length === 0 && (
          <button
            onClick={() => run(() => confirmPackingOrderAction(orderId))}
            disabled={pending}
            className="btn btn-primary btn-sm"
            title="Crear un bulto, empacar todo lo pickeado y cerrarlo"
          >
            <Icon name="package" size={12} /> Empacar todo
          </button>
        )}
        {pendingStops.length > 0 && openUnits.length > 0 && (
          <span className="text-[11px] text-fg-muted inline-flex items-center gap-1.5">
            <Icon name="lock" size={11} /> Cerrá los bultos abiertos para habilitar «Empacar todo».
          </span>
        )}
        {err && <span className="text-[11px] text-status-danger" title={err}>{err}</span>}
        {mustChoose && (
          <span className="text-[11px] text-status-warning">Elegí un bulto activo para empacar.</span>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Zona A — Por empacar */}
        <div className="nx-surface card overflow-hidden">
          <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between">
            <h2 className="text-sm font-semibold">Por empacar</h2>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-bg-surface-alt text-fg-secondary">
              {pendingStops.length} paradas
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ubicación</th>
                  <th>SKU</th>
                  <th>Lote</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {pendingStops.map((s) => (
                  <tr key={s.allocation_id}>
                    <td>
                      <div className="font-mono text-[11px]">{s.location.full_code ?? "—"}</div>
                      <div className="text-[10px] text-fg-muted">{locationDetail(s.location) || "Sin ubicación"}</div>
                    </td>
                    <td className="font-mono text-xs font-semibold">{s.sku}</td>
                    <td className="font-mono text-[11px] text-fg-secondary">{s.lot_number ?? "—"}</td>
                    <td className="text-right tabular">{s.quantity.toLocaleString("es-AR")}</td>
                    <td className="text-right">
                      <button
                        onClick={() => packInto(s.allocation_id)}
                        disabled={pending || mustChoose}
                        className="btn btn-primary btn-sm"
                        title={effectiveActive ? "Empacar en el bulto activo" : "Crear un bulto y empacar"}
                      >
                        <Icon name="package" size={12} /> {effectiveActive ? "Empacar" : "Crear y empacar"}
                      </button>
                    </td>
                  </tr>
                ))}
                {pendingStops.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-fg-muted py-8 text-sm">
                      No hay paradas pendientes de empacar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Zona B — Bultos */}
        <div className="flex flex-col gap-3">
          {units.map((u) => {
            const meta = PACKING_STATUS_META[u.status];
            const isOpen = u.status === "abierta";
            const isActive = effectiveActive === u.id;
            return (
              <div key={u.id} className="nx-surface card overflow-hidden">
                <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{u.public_id}</span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                      style={{ background: `${meta.color}1a`, color: meta.color }}
                    >
                      {meta.label}
                    </span>
                    {isActive && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: "#2563eb1a", color: "#2563eb" }}>Activo</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isOpen && !isActive && (
                      <button onClick={() => setActiveUnitId(u.id)} disabled={pending} className="btn btn-ghost btn-sm" title="Marcar como bulto activo">
                        <Icon name="check" size={12} /> Activar
                      </button>
                    )}
                    {isOpen ? (
                      <button onClick={() => run(() => closePackingUnitAction(u.id, orderId))} disabled={pending} className="btn btn-ghost btn-sm" title="Sellar el bulto">
                        <Icon name="lock" size={12} /> Cerrar
                      </button>
                    ) : u.status === "cerrada" ? (
                      <button onClick={() => run(() => reopenPackingUnitAction(u.id, orderId))} disabled={pending} className="btn btn-ghost btn-sm" title="Reabrir el bulto">
                        <Icon name="refresh" size={12} /> Reabrir
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="px-4 py-2 text-[11px] text-fg-muted">
                  {u.item_count} ítems · {u.total_quantity.toLocaleString("es-AR")} unidades
                </div>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Lote</th>
                        <th className="text-right">Cantidad</th>
                        <th>Ubicación</th>
                        {isOpen && <th className="text-right">Acción</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {u.items.map((it) => (
                        <tr key={it.allocation_id}>
                          <td className="font-mono text-xs font-semibold">{it.sku}</td>
                          <td className="font-mono text-[11px] text-fg-secondary">{it.lot_number ?? "—"}</td>
                          <td className="text-right tabular">{it.quantity.toLocaleString("es-AR")}</td>
                          <td className="font-mono text-[11px] text-fg-secondary">{it.location.full_code ?? "—"}</td>
                          {isOpen && (
                            <td className="text-right">
                              <button onClick={() => run(() => unpackAllocationAction(it.allocation_id, orderId))} disabled={pending} className="btn btn-ghost btn-sm" title="Quitar del bulto">
                                <Icon name="x" size={12} /> Quitar
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {u.items.length === 0 && (
                        <tr>
                          <td colSpan={isOpen ? 5 : 4} className="text-center text-fg-muted py-4 text-xs">
                            Bulto vacío. Empacá paradas en él.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {units.length === 0 && (
            <div className="nx-surface card card-pad text-center text-fg-muted text-sm">
              Aún no hay bultos. Creá uno con «Nuevo bulto» o usá «Empacar todo».
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

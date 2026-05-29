"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { PuntoVenta, PuntoVentaTipo } from "@/lib/invoicing/types";
import { addPuntoVenta, setPuntoVentaActivo } from "./actions";

const TIPO_LABEL: Record<PuntoVentaTipo, string> = {
  WEBSERVICE: "Web Service",
  CONTROLADOR_FISCAL: "Controlador Fiscal",
  MANUAL: "Manual",
};

interface Props {
  puntosVenta: PuntoVenta[];
  canEdit: boolean;
}

export function PuntosVentaManager({ puntosVenta, canEdit }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const add = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const input = {
      numero: String(fd.get("numero") ?? ""),
      descripcion: String(fd.get("descripcion") ?? ""),
      tipo: String(fd.get("tipo") ?? "WEBSERVICE"),
    };
    start(async () => {
      const r = await addPuntoVenta(input);
      if (r.ok) {
        form.reset();
        setAdding(false);
      } else {
        setError(r.error);
      }
    });
  };

  const toggle = (id: string, activo: boolean) => {
    setError(null);
    start(async () => {
      const r = await setPuntoVentaActivo(id, activo);
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
        <h2 className="text-sm font-semibold">Puntos de venta</h2>
        {canEdit && !adding && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} /> Agregar
          </button>
        )}
      </div>

      {canEdit && adding && (
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end px-4 py-3 border-b border-border-subtle bg-neutral-50">
          <div className="w-full sm:w-28">
            <label className="field-label">Número</label>
            <input name="numero" type="number" min={1} className="input" required placeholder="4" />
          </div>
          <div className="flex-1">
            <label className="field-label">Descripción</label>
            <input name="descripcion" className="input" required placeholder="Sucursal / canal" />
          </div>
          <div className="w-full sm:w-48">
            <label className="field-label">Tipo</label>
            <select name="tipo" className="input" defaultValue="WEBSERVICE">
              <option value="WEBSERVICE">Web Service</option>
              <option value="CONTROLADOR_FISCAL">Controlador Fiscal</option>
              <option value="MANUAL">Manual</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            <Icon name={pending ? "refresh" : "check"} size={12} /> Guardar
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)} disabled={pending}>
            Cancelar
          </button>
        </form>
      )}

      {error && (
        <div className="px-4 py-2 text-sm text-status-danger bg-status-danger/10 border-b border-status-danger/20">
          {error}
        </div>
      )}

      <table className="tbl">
        <thead>
          <tr>
            <th>N°</th>
            <th>Descripción</th>
            <th>Tipo</th>
            <th>Estado</th>
            {canEdit && <th className="text-right">Acción</th>}
          </tr>
        </thead>
        <tbody>
          {puntosVenta.map((p) => (
            <tr key={p.id}>
              <td className="font-mono text-xs">{String(p.numero).padStart(5, "0")}</td>
              <td className="font-semibold">{p.descripcion}</td>
              <td className="text-xs">{TIPO_LABEL[p.tipo]}</td>
              <td>
                <span className={`badge ${p.activo ? "badge-success" : "badge-muted"}`}>
                  {p.activo ? "Activo" : "Inactivo"}
                </span>
              </td>
              {canEdit && (
                <td className="text-right">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pending}
                    onClick={() => toggle(p.id, !p.activo)}
                  >
                    <Icon name={p.activo ? "pause" : "play"} size={12} />
                    {p.activo ? "Desactivar" : "Activar"}
                  </button>
                </td>
              )}
            </tr>
          ))}
          {puntosVenta.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 5 : 4} className="text-center text-fg-muted py-8 text-sm">
                No hay puntos de venta configurados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

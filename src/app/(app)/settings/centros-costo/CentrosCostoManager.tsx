"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { CostCenter } from "@/lib/erp/types";
import { createCostCenterAction, setCostCenterActiveAction } from "./actions";

export function CentrosCostoManager({ costCenters }: { costCenters: CostCenter[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createCostCenterAction({
        code,
        name,
        description: description || null,
      });
      if (res.ok) {
        setCode("");
        setName("");
        setDescription("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function toggle(cc: CostCenter) {
    setError(null);
    startTransition(async () => {
      const res = await setCostCenterActiveAction(cc.id, !cc.active);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-6">
      {/* Alta de centro de costo */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="card p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold">Nuevo centro de costo</h2>
        {error && (
          <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
            {error}
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="field-label block mb-1.5">Código *</label>
            <input
              className="input font-mono uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CC-LOGIS"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="field-label block mb-1.5">Nombre *</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Logística & Distribución"
              required
            />
          </div>
        </div>
        <div>
          <label className="field-label block mb-1.5">Descripción</label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Opcional"
          />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={pending || !code || !name}>
            {pending ? (
              <>
                <Icon name="refresh" size={14} className="animate-spin" /> Guardando…
              </>
            ) : (
              <>
                <Icon name="plus" size={14} stroke={2.2} /> Crear centro de costo
              </>
            )}
          </button>
        </div>
      </form>

      {/* Listado */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft">
          <h2 className="text-sm font-semibold">Centros de costo</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Estado</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {costCenters.map((cc) => (
                <tr key={cc.id} className={cc.active ? "" : "opacity-55"}>
                  <td className="font-mono text-xs font-semibold">{cc.code}</td>
                  <td className="text-sm font-semibold text-fg-primary">{cc.name}</td>
                  <td className="text-xs text-fg-secondary">{cc.description ?? "—"}</td>
                  <td>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                      style={
                        cc.active
                          ? { background: "#15803D15", color: "#15803D" }
                          : { background: "#8A94A615", color: "#8A94A6" }
                      }
                    >
                      {cc.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={pending}
                      onClick={() => toggle(cc)}
                    >
                      {cc.active ? (
                        <>
                          <Icon name="pause" size={12} /> Desactivar
                        </>
                      ) : (
                        <>
                          <Icon name="check" size={12} /> Reactivar
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
              {costCenters.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-fg-muted py-8 text-sm">
                    Aún no hay centros de costo. Creá el primero arriba.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

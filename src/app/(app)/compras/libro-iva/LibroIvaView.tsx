"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { fmtCurrency } from "@/lib/utils";
import type { LibroIvaResult, LibroIvaFilters } from "@/lib/erp/libro-iva-data";

interface VendorOpt {
  id: string;
  razon: string;
  cuit: string;
}
interface CcOpt {
  id: string;
  code: string;
  name: string;
}

const ALICUOTAS = ["21", "10.5", "27", "5", "2.5", "0"];

const STATUS_LABEL: Record<string, string> = {
  cargada: "Cargada",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  anulada: "Anulada",
};

export function LibroIvaView({
  data,
  filters,
  canExport,
  vendors,
  costCenters,
}: {
  data: LibroIvaResult;
  filters: LibroIvaFilters;
  canExport: boolean;
  vendors: VendorOpt[];
  costCenters: CcOpt[];
}) {
  const router = useRouter();

  const [desde, setDesde] = useState(filters.desde ?? "");
  const [hasta, setHasta] = useState(filters.hasta ?? "");
  const [vendorId, setVendorId] = useState(filters.vendorId ?? "");
  const [cuit, setCuit] = useState(filters.cuit ?? "");
  const [alicuota, setAlicuota] = useState(filters.alicuota != null ? String(filters.alicuota) : "");
  const [costCenterId, setCostCenterId] = useState(filters.costCenterId ?? "");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (vendorId) p.set("vendorId", vendorId);
    if (cuit) p.set("cuit", cuit);
    if (alicuota) p.set("alicuota", alicuota);
    if (costCenterId) p.set("costCenterId", costCenterId);
    return p.toString();
  }, [desde, hasta, vendorId, cuit, alicuota, costCenterId]);

  function applyFilters() {
    router.push(`/compras/libro-iva${queryString ? `?${queryString}` : ""}`);
  }
  function clearFilters() {
    setDesde("");
    setHasta("");
    setVendorId("");
    setCuit("");
    setAlicuota("");
    setCostCenterId("");
    router.push("/compras/libro-iva");
  }

  const exportUrl = (format: "csv" | "xlsx") => {
    const p = new URLSearchParams(queryString);
    p.set("format", format);
    return `/api/compras/libro-iva/export?${p.toString()}`;
  };

  const k = data.kpis;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Cuentas por pagar · ERP</div>
          <h1 className="page-title">Libro IVA Compras</h1>
          <p className="page-subtitle">
            Crédito fiscal por comprobante. Período {filters.desde} → {filters.hasta}.
          </p>
        </div>
        {canExport && (
          <div className="flex items-center gap-2">
            <a href={exportUrl("csv")} className="btn btn-ghost btn-sm" download>
              <Icon name="download" size={12} /> CSV
            </a>
            <a href={exportUrl("xlsx")} className="btn btn-primary btn-sm" download>
              <Icon name="download" size={12} /> Excel
            </a>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="IVA Crédito Fiscal" value={fmtCurrency(k.ivaCreditoFiscal)} accent />
        <KpiCard label="Neto Gravado" value={fmtCurrency(k.netoGravado)} />
        <KpiCard label="Percepciones" value={fmtCurrency(k.percepciones)} />
        <KpiCard label="Comprobantes" value={String(k.cantidadComprobantes)} />
      </div>
      <div className="rounded-md bg-fg-brand/5 border border-fg-brand/15 px-4 py-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-fg-muted font-semibold">
          Total Gravado (Neto + IVA)
        </span>
        <span className="text-lg font-bold text-fg-brand tabular">{fmtCurrency(k.totalGravado)}</span>
      </div>

      {/* Filtros */}
      <div className="card p-4">
        <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Field label="Desde">
            <input type="date" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          <Field label="Proveedor">
            <select className="input appearance-none pr-8" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Todos</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.razon}
                </option>
              ))}
            </select>
          </Field>
          <Field label="CUIT">
            <input className="input font-mono" value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="30-..." />
          </Field>
          <Field label="Alícuota">
            <select className="input appearance-none pr-8" value={alicuota} onChange={(e) => setAlicuota(e.target.value)}>
              <option value="">Todas</option>
              {ALICUOTAS.map((a) => (
                <option key={a} value={a}>
                  {a}%
                </option>
              ))}
            </select>
          </Field>
          <Field label="Centro de costo">
            <select className="input appearance-none pr-8" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
              <option value="">Todos</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button type="button" onClick={applyFilters} className="btn btn-primary btn-sm">
            <Icon name="search" size={12} /> Aplicar
          </button>
          <button type="button" onClick={clearFilters} className="btn btn-ghost btn-sm">
            Limpiar
          </button>
          {data.truncated && (
            <span className="text-[11px] text-status-warning ml-2">
              Mostrando los primeros 5.000 comprobantes. Acotá el período para ver todo.
            </span>
          )}
        </div>
      </div>

      {/* Subtotales por alícuota */}
      {data.subtotales.length > 0 && (
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-wide text-fg-muted font-semibold mb-2">
            Subtotales por alícuota
          </div>
          <div className="flex flex-wrap gap-2">
            {data.subtotales.map((s) => (
              <div key={s.alicuota} className="rounded-md border border-stroke-soft px-3 py-2 text-[12px]">
                <span className="font-bold text-fg-primary">{s.alicuota}%</span>
                <span className="text-fg-muted"> · {s.comprobantes} comp.</span>
                <div className="tabular text-fg-secondary">
                  Neto {fmtCurrency(s.netoGravado)} · IVA {fmtCurrency(s.iva)} · Gravado {fmtCurrency(s.totalGravado)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-stroke-soft text-left text-fg-muted">
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Proveedor</th>
                <th className="px-3 py-2 font-semibold">CUIT</th>
                <th className="px-3 py-2 font-semibold">Comprobante</th>
                <th className="px-3 py-2 font-semibold text-right">Neto Gravado</th>
                <th className="px-3 py-2 font-semibold text-right">IVA Pagado</th>
                <th className="px-3 py-2 font-semibold text-right">Percepciones</th>
                <th className="px-3 py-2 font-semibold text-right">Total Gravado</th>
                <th className="px-3 py-2 font-semibold text-right">Total Comprob.</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-fg-muted">
                    Sin comprobantes con detalle fiscal para los filtros aplicados.
                  </td>
                </tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.invoiceId} className="border-b border-stroke-soft/60 hover:bg-neutral-50">
                  <td className="px-3 py-2 tabular">{r.fecha}</td>
                  <td className="px-3 py-2">{r.proveedor}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.cuit}</td>
                  <td className="px-3 py-2">
                    {r.comprobante}
                    {r.approvalStatus !== "aprobada" && (
                      <span className="ml-1.5 text-[9px] uppercase text-fg-muted">
                        ({STATUS_LABEL[r.approvalStatus] ?? r.approvalStatus})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{fmtCurrency(r.netoGravado)}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtCurrency(r.iva)}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtCurrency(r.percepciones)}</td>
                  <td className="px-3 py-2 text-right tabular font-semibold">{fmtCurrency(r.totalGravado)}</td>
                  <td className="px-3 py-2 text-right tabular text-fg-muted">{fmtCurrency(r.totalComprobante)}</td>
                </tr>
              ))}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-stroke-soft font-bold">
                  <td className="px-3 py-2" colSpan={4}>
                    TOTALES · {k.cantidadComprobantes} comprobantes
                  </td>
                  <td className="px-3 py-2 text-right tabular">{fmtCurrency(k.netoGravado)}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtCurrency(k.ivaCreditoFiscal)}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtCurrency(k.percepciones)}</td>
                  <td className="px-3 py-2 text-right tabular text-fg-brand">{fmtCurrency(k.totalGravado)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`card p-4 ${accent ? "border-fg-brand/30" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">{label}</div>
      <div className={`text-xl font-bold tabular mt-1 ${accent ? "text-fg-brand" : "text-fg-primary"}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

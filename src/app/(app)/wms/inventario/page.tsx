import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listInventory } from "@/lib/wms/data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";
import {
  getCanonicalPhysicalUnitQr,
  getInventoryCustodyVisibility,
} from "@/lib/custody/operation-visibility";
import { QrCard } from "../custody/_components/QrCard";

export const metadata = { title: "Inventario · WMS" };
export const dynamic = "force-dynamic";

export default async function InventarioPage({
  searchParams,
}: {
  searchParams?: { qr?: string };
}) {
  let rows: Awaited<ReturnType<typeof listInventory>>;
  try {
    rows = await listInventory();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Inventario no disponible"
        migration="0024_wms_inventory"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  // Proyección paralela: no modifica el agregado logístico ni agrega gates.
  // Sólo N2 llega a este mapa; un error no se traduce en un badge falso N1.
  const custody = await getInventoryCustodyVisibility(rows.map((row) => row.id));
  const visibleN2 = Object.values(custody.byInventoryItem).flat();
  const selectedUnit = visibleN2.find((unit) => unit.physicalUnitId === searchParams?.qr) ?? null;
  const selectedQr = selectedUnit?.caseId
    ? await getCanonicalPhysicalUnitQr(selectedUnit.physicalUnitId)
    : null;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Inventario</h1>
          <p className="page-subtitle">
            Stock de mercadería de terceros con trazabilidad por lote, vencimiento
            y ubicación física en el Digital Twin.
          </p>
        </div>
        <Link href="/wms" className="btn btn-ghost btn-sm mt-1">
          <Icon name="arrow-left" size={12} /> Dashboard
        </Link>
      </div>

      {custody.status === "unavailable" && (
        <div className="mb-4 rounded border border-status-warning p-3 text-xs text-status-warning" role="alert">
          Custodia no verificable: CPU y CINT no se ocultan como si fueran mercadería sin N2. Recargá o escalá al encargado.
        </div>
      )}

      {selectedUnit && (
        <section id="custodia-qr" className="nx-surface card card-pad mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow-tiny">Identidad física N2</div>
              <h2 className="text-base font-semibold">{selectedUnit.unitPublicId}</h2>
              {selectedUnit.caseId && (
                <Link href={`/wms/custody/${selectedUnit.caseId}`} className="text-xs underline">
                  {selectedUnit.casePublicId ?? "Ver CINT"}
                </Link>
              )}
            </div>
            <Link href="/wms/inventario" className="btn btn-ghost btn-sm">Cerrar</Link>
          </div>
          {selectedQr ? (
            <div className="mt-3 max-w-[260px]">
              <QrCard
                dataUrl={selectedQr.dataUrl}
                url={selectedQr.url}
                publicId={selectedUnit.unitPublicId}
                label="QR canónico de la unidad"
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-status-warning" role="alert">QR canónico no verificable.</p>
          )}
        </section>
      )}

      <div className="nx-surface card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft">
          <h2 className="text-sm font-semibold">Stock cargado</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Descripción</th>
                <th>Cliente</th>
                <th>Lote</th>
                <th>Vencimiento</th>
                <th className="text-right">Stock</th>
                <th>Custodia N2</th>
                <th>Ubicación física</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const custodyUnits = custody.byInventoryItem[r.id] ?? [];
                return (
                <tr key={r.id}>
                  <td className="font-mono text-xs font-semibold">{r.sku}</td>
                  <td className="text-sm">{r.description}</td>
                  <td className="text-xs text-fg-secondary">{r.client_name}</td>
                  <td className="font-mono text-[11px] text-fg-secondary">
                    {r.lot_count > 1 ? `${r.lot_count} lotes` : r.lot_number ?? "—"}
                  </td>
                  <td className="text-xs">{r.expiration_date ? fmtDate(r.expiration_date) : "—"}</td>
                  <td className="text-right tabular font-semibold text-fg-brand">
                    {r.stock_available.toLocaleString("es-AR")}
                    {r.stock_reserved > 0 && (
                      <div className="text-[10px] text-status-warning font-normal">
                        {r.stock_reserved.toLocaleString("es-AR")} reservado
                      </div>
                    )}
                  </td>
                  <td>
                    {custody.status === "unavailable" ? (
                      <span className="text-xs text-status-warning">No verificable</span>
                    ) : custodyUnits.length === 0 ? (
                      <span className="text-xs text-fg-muted">—</span>
                    ) : (
                      <div className="flex flex-col gap-2" data-custodia-n2={r.id}>
                        {custodyUnits.map((unit) => (
                          <div key={unit.physicalUnitId} className="rounded border border-stroke-soft p-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-status-warning text-status-warning">
                                N2
                              </span>
                              <span className="font-mono text-[11px] font-semibold">{unit.unitPublicId}</span>
                            </div>
                            {unit.caseId ? (
                              <Link href={`/wms/custody/${unit.caseId}`} className="text-xs underline">
                                {unit.casePublicId ?? "Ver CINT"}
                              </Link>
                            ) : (
                              <p className="text-xs text-status-warning">Caso no disponible</p>
                            )}
                            {unit.caseId && (
                              <Link
                                href={`/wms/inventario?qr=${unit.physicalUnitId}#custodia-qr`}
                                className="text-xs underline"
                              >
                                Ver / imprimir QR
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.position_id ? (
                      <Link
                        href={`/operaciones/mapa-inteligente?pos=${r.position_id}`}
                        className="btn btn-ghost btn-sm"
                        title={r.position_full_code ?? undefined}
                      >
                        <Icon name="pin" size={12} />
                        <span className="font-mono text-[11px]">
                          {r.position_full_code ?? "Ver ubicación física"}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-fg-muted">Sin ubicar</span>
                    )}
                  </td>
                </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-fg-muted py-8 text-sm">
                    Aún no hay inventario cargado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-fg-muted mt-4">
        El botón <strong>Ver ubicación física</strong> abre el{" "}
        <Link href="/operaciones/mapa-inteligente" className="underline">
          Mapa Inteligente
        </Link>{" "}
        resaltando la posición (<code className="font-mono text-[11px]">?pos=&lt;id&gt;</code>).
      </p>
    </div>
  );
}

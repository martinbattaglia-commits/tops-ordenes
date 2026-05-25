import { listOrders } from "@/lib/data/orders";
import { fmtCurrency } from "@/lib/utils";

export const metadata = { title: "Reportes" };

export default async function ReportsPage() {
  const { rows } = await listOrders({ pageSize: 1000 });
  const totalFacturado = rows
    .filter((o) => o.status === "FIRMADA" || o.status === "FACTURADA")
    .reduce((a, b) => a + b.total, 0);
  const byDepot = {
    MAGALDI: rows.filter((o) => o.depot === "MAGALDI").length,
    LUJAN: rows.filter((o) => o.depot === "LUJAN").length,
  };
  const horas = rows.reduce((a, b) => a + b.hours, 0);

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Análisis · Período actual</div>
          <h1 className="page-title">Reportes</h1>
          <p className="page-subtitle">
            Resumen operativo y financiero. Para reportes históricos completos, conectá el módulo
            de BI.
          </p>
        </div>
        <a href="/api/orders/export" className="btn btn-primary btn-sm">
          Exportar CSV completo
        </a>
      </div>

      <div className="kpi-grid">
        <div className="card kpi">
          <div className="kpi-label">Órdenes totales</div>
          <div className="kpi-value">{rows.length}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Magaldi vs Luján</div>
          <div className="kpi-value">
            {byDepot.MAGALDI} <span className="unit">/ {byDepot.LUJAN}</span>
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Horas operativas</div>
          <div className="kpi-value">
            {horas} <span className="unit">hs</span>
          </div>
        </div>
        <div className="card kpi featured-stroke">
          <div className="kpi-label">Facturación firmada</div>
          <div className="kpi-value">{fmtCurrency(totalFacturado)}</div>
        </div>
      </div>

      <div className="card mt-6 p-8 text-center">
        <div className="text-fg-muted text-sm">
          Pronto: gráficos de evolución mensual, top servicios, márgenes por cliente y export PDF
          ejecutivo.
        </div>
      </div>
    </div>
  );
}

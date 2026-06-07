import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { fmtCurrency } from "@/lib/utils";
import type { ExecutiveSnapshot } from "@/lib/analytics/executive-data";

function fmtM2(n: number): string {
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(n))} m²`;
}
function fmtPct(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}
function fmtNum(n: number): string {
  return new Intl.NumberFormat("es-AR").format(n);
}

export function ExecutiveDashboard({ snapshot }: { snapshot: ExecutiveSnapshot }) {
  const { financiero, compras, wms, operaciones, comercial } = snapshot;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Dirección · Estado de la compañía</div>
          <h1 className="page-title">Analytics Ejecutivo</h1>
          <p className="page-subtitle">
            KPIs confiables en tiempo real. Generado {new Date(snapshot.generatedAt).toLocaleString("es-AR")}.
          </p>
        </div>
      </div>

      {/* Titulares */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label="Caja disponible" value={fmtCurrency(financiero.cajaTotal)} accent ok={financiero.ok} />
        <Kpi label="Por cobrar" value={fmtCurrency(financiero.porCobrar)} ok={financiero.ok} />
        <Kpi label="Por pagar" value={fmtCurrency(financiero.porPagar)} ok={financiero.ok} />
        <Kpi label="Vacancia comercial" value={fmtPct(wms.vacanciaComercialPct)} ok={wms.ok} />
        <Kpi
          label="Pipeline abierto"
          value={comercial.configured ? fmtCurrency(comercial.pipelineTotal) : "—"}
          ok={comercial.ok}
          badge={comercial.configured ? undefined : "Clientify no configurado"}
        />
        <Kpi label="Órdenes abiertas" value={fmtNum(operaciones.abiertas)} ok={operaciones.ok} />
      </div>

      {/* Financiero + Comercial */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Financiero · Tesorería" href="/tesoreria" icon="wallet" ok={financiero.ok}>
          <Row label="Caja total" value={fmtCurrency(financiero.cajaTotal)} />
          <Row label="Cobros acumulados" value={fmtCurrency(financiero.cobrosTotal)} />
          <Row label="Pagos acumulados" value={fmtCurrency(financiero.pagosTotal)} />
          <Row label="Por cobrar (AR)" value={fmtCurrency(financiero.porCobrar)} />
          <Row label="Por pagar (AP)" value={fmtCurrency(financiero.porPagar)} />
          <Row label="Flujo proyectado (acum.)" value={fmtCurrency(financiero.flujoProyectadoAcumulado)} />
          {financiero.bancos.length > 0 && (
            <div className="mt-2 pt-2 border-t border-stroke-soft text-[11px] text-fg-muted">
              {financiero.bancos.map((b) => (
                <div key={b.cuenta} className="flex justify-between">
                  <span>{b.nombre} · {b.cuenta}</span>
                  <span className="tabular">{fmtCurrency(b.balance)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Comercial · Clientify"
          href="/comercial/pipeline"
          icon="vendors"
          ok={comercial.ok}
          note={comercial.configured ? "Fuente oficial: Clientify" : "Clientify no configurado en este entorno"}
        >
          {comercial.configured ? (
            <>
              <Row label="Leads (contactos)" value={fmtNum(comercial.leads)} />
              <Row label="Oportunidades (deals)" value={fmtNum(comercial.oportunidades)} />
              <Row label="Pipeline abierto" value={fmtCurrency(comercial.pipelineTotal)} />
              <Row label="Ganado YTD" value={fmtCurrency(comercial.ganadoYtd)} />
            </>
          ) : (
            <Empty text="Configurá CLIENTIFY_API_KEY para ver leads, oportunidades y pipeline." />
          )}
        </Section>
      </div>

      {/* WMS + Operaciones */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="WMS · Capacidad" href="/comercial/dashboard-vacancia" icon="dashboard" ok={wms.ok}>
          <Row label="m² ocupados" value={fmtM2(wms.ocupadoM2)} />
          <Row label="m² libres (físico)" value={fmtM2(wms.disponibleM2)} />
          <Row label="m² comercializables" value={fmtM2(wms.comercializableM2)} />
          <Row label="Vacancia física" value={fmtPct(wms.vacanciaPct)} />
          <Row label="Vacancia comercial" value={fmtPct(wms.vacanciaComercialPct)} strong />
        </Section>

        <Section title="Operaciones · Órdenes" href="/orders" icon="orders" ok={operaciones.ok}>
          <Row label="Órdenes abiertas" value={fmtNum(operaciones.abiertas)} strong />
          <Row label="Órdenes cerradas" value={fmtNum(operaciones.cerradas)} />
          <Row label="Total órdenes" value={fmtNum(operaciones.total)} />
        </Section>
      </div>

      {/* Compras */}
      <Section title="Compras · Cuentas a pagar (ERP-B)" href="/compras/libro-iva" icon="report" ok={compras.ok}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MiniKpi label="Facturas proveedor" value={fmtNum(compras.facturasCount)} />
          <MiniKpi label="Total facturado" value={fmtCurrency(compras.facturasTotal)} />
          <MiniKpi
            label="IVA Crédito Fiscal"
            value={fmtCurrency(compras.ivaCreditoFiscal)}
            badge={compras.detalleVacio ? "se poblará con OCR" : undefined}
          />
          <MiniKpi
            label="Percepciones"
            value={fmtCurrency(compras.percepciones)}
            badge={compras.detalleVacio ? "se poblará con OCR" : undefined}
          />
        </div>
      </Section>

      {/* Leyenda */}
      <div className="text-[11px] text-fg-muted flex flex-wrap gap-x-4 gap-y-1 border-t border-stroke-soft pt-3">
        <span><Icon name="check-circle" size={11} className="inline text-status-success" /> Confiable hoy</span>
        <span className="text-status-warning">▦ "se poblará" = la fuente existe pero aún sin datos (OCR / operación)</span>
        <span>Fuentes: ERP-A (tesorería) · ERP-B (compras) · Capacity Engine (WMS) · órdenes · Clientify (comercial).</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent, ok, badge }: { label: string; value: string; accent?: boolean; ok: boolean; badge?: string }) {
  return (
    <div className={`card p-4 ${accent ? "border-fg-brand/30" : ""} ${!ok ? "opacity-60" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">{label}</div>
      <div className={`text-xl font-bold tabular mt-1 ${accent ? "text-fg-brand" : "text-fg-primary"}`}>
        {ok ? value : "N/D"}
      </div>
      {badge && <div className="text-[9px] text-status-warning mt-0.5">{badge}</div>}
    </div>
  );
}

function Section({
  title,
  href,
  icon,
  ok,
  note,
  children,
}: {
  title: string;
  href: string;
  icon: IconName;
  ok: boolean;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon name={icon} size={15} className="text-fg-brand" />
          <h2 className="text-sm font-bold text-fg-primary">{title}</h2>
          {!ok && <span className="text-[9px] uppercase text-status-danger font-bold">sin datos</span>}
        </div>
        <Link href={href} className="text-[11px] text-fg-brand hover:underline flex items-center gap-1">
          Ver detalle <Icon name="arrow-right" size={10} />
        </Link>
      </div>
      {note && <p className="text-[10px] text-fg-muted mb-2">{note}</p>}
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-fg-secondary">{label}</span>
      <span className={`tabular ${strong ? "font-bold text-fg-brand" : "text-fg-primary"}`}>{value}</span>
    </div>
  );
}

function MiniKpi({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="rounded-md border border-stroke-soft px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">{label}</div>
      <div className="text-base font-bold tabular text-fg-primary mt-0.5">{value}</div>
      {badge && <div className="text-[9px] text-status-warning">{badge}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[12px] text-fg-muted py-2">{text}</p>;
}

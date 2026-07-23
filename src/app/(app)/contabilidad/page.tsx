import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getMotorStatus } from "@/lib/contabilidad/data";
import type { MotorStatus } from "@/lib/contabilidad/types";
import { SimulationBanner } from "./_components/SimulationBanner";

export const metadata = { title: "Contabilidad" };
export const dynamic = "force-dynamic";

const SECCIONES: Array<{ href: string; label: string; icon: IconName; desc: string }> = [
  { href: "/contabilidad/libro-diario", label: "Libro Diario", icon: "report", desc: "Asientos posteados, línea por línea, con trazabilidad al comprobante de origen." },
  { href: "/contabilidad/mayor", label: "Libro Mayor", icon: "book", desc: "Movimientos y saldo acumulado por cuenta." },
  { href: "/contabilidad/sumas-y-saldos", label: "Sumas y Saldos", icon: "calculator", desc: "Balance de comprobación por cuenta imputable." },
  { href: "/contabilidad/comprobantes-sin-asiento", label: "Comprobantes sin asiento", icon: "clock", desc: "Backlog contabilizable: lo que el motor asentaría al activarse." },
  { href: "/contabilidad/conciliacion-iva", label: "Conciliación IVA", icon: "check-circle", desc: "Libros fiscales de IVA contra cuentas contables, período por período." },
  { href: "/settings/plan-de-cuentas", label: "Plan de cuentas", icon: "tag-alt", desc: "Catálogo contable único (79 cuentas). Se administra desde Sistema." },
];

export default async function ContabilidadPage() {
  if (!(await canAccess("contabilidad.view"))) {
    return <AccesoRestringido modulo="Contabilidad" />;
  }

  let status: MotorStatus;
  try {
    status = await getMotorStatus();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Contabilidad no disponible"
        migration="0083_accounting_engine"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const kpis = [
    { label: "Asientos posteados", value: status.asientos, note: status.asientos === 0 ? "El motor nunca posteó (esperado en SIMULACIÓN)" : undefined },
    { label: "Comprobantes sin asiento", value: status.comprobantesPendientes, note: "Backlog contabilizable" },
    { label: "Asientos descuadrados", value: status.descuadrados, note: status.descuadrados === 0 ? "Control en verde" : "⚠ Revisar de inmediato" },
    { label: "Períodos contables", value: status.periodos, note: "Se crean al postear" },
    { label: "Cuentas activas", value: status.cuentasActivas, note: "Plan de cuentas" },
    { label: "Reglas de imputación", value: status.reglas, note: "accounting_rules" },
  ];

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Contabilidad · F6</div>
          <h1 className="page-title">Módulo contable</h1>
          <p className="page-subtitle">
            Motor de partida doble de TOPS Nexus: libros, balance de comprobación,
            backlog contabilizable y conciliación fiscal↔contable.
          </p>
        </div>
      </div>

      <SimulationBanner />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {kpis.map((k) => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div className="text-xs text-fg-muted">{k.label}</div>
            <div className="text-2xl font-bold text-fg-primary" style={{ fontVariantNumeric: "tabular-nums" }}>
              {k.value.toLocaleString("es-AR")}
            </div>
            {k.note && <div className="text-xs text-fg-muted mt-0.5">{k.note}</div>}
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {SECCIONES.map((s) => (
          <Link key={s.href} href={s.href} className="card block hover:opacity-90" style={{ padding: "14px 16px" }}>
            <div className="flex items-center gap-2 mb-1">
              <Icon name={s.icon} size={14} />
              <span className="text-sm font-semibold text-fg-primary">{s.label}</span>
              <Icon name="arrow-right" size={12} className="ml-auto" />
            </div>
            <p className="text-xs text-fg-muted">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

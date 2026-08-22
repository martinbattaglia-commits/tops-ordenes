import Link from "next/link";
import { Icon } from "@/components/Icon";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { getClienteFicha } from "@/lib/legajo/data";
import { listChartOfAccounts, getAccountByCode } from "@/lib/erp/accounting-data";
import type { ChartAccount } from "@/lib/erp/types";
import { ClienteFiscalEditor } from "@/components/comercial/ClienteFiscalEditor";
import { EntityConversationButton } from "@/components/connect/EntityConversationButton";
import type { CondicionIva } from "@/lib/invoicing/types";
import { createClient } from "@/lib/supabase/server";
import { ClientMasterEditor } from "./ClientMasterEditor";
import { loadServicePricing } from "@/lib/data/service-pricing";
import { ClientCustomRatesEditor } from "@/components/tarifas/ClientCustomRatesEditor";

export const metadata = { title: "Ficha de cliente" };
export const dynamic = "force-dynamic";

/**
 * Espejo de lectura de la compuerta REAL de `contractClientCustody`
 * (`has_permission("clientes.custody.contract")`, fail-closed). No autoriza
 * nada: sólo evita ofrecer en pantalla lo que el servidor va a rechazar.
 */
async function canContractCustody(): Promise<boolean> {
  const supabase = createClient();
  if (!supabase) return false;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.rpc("has_permission", {
    p_slug: "clientes.custody.contract",
  });
  return !error && data === true;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-sm text-fg-primary">{value || <span className="text-fg-muted">—</span>}</div>
    </div>
  );
}

export default async function ClienteFichaPage({ params }: { params: { id: string } }) {
  const ficha = await getClienteFicha(params.id);
  if (!ficha) {
    return (
      <div className="p-8">
        <div className="card p-6 max-w-xl">
          <h1 className="text-lg font-bold text-fg-primary mb-2">Cliente no encontrado</h1>
          <Link href="/clients" className="text-fg-link hover:underline">← Volver a Clientes</Link>
        </div>
      </div>
    );
  }
  const { cliente: c, facturas, saldo } = ficha;
  let accounts: ChartAccount[] = [];
  try {
    accounts = await listChartOfAccounts({ types: ["ingreso"], postableOnly: true });
    if (c.cuenta_contable && !accounts.some((a) => a.code === c.cuenta_contable)) {
      const saved = await getAccountByCode(c.cuenta_contable);
      if (saved) accounts = [saved, ...accounts];
    }
  } catch {
    accounts = [];
  }
  const condicionIva = (c.condicion_iva ?? "RESPONSABLE_INSCRIPTO") as CondicionIva;
  const depositoAsignado = c.deposito_asignado === "MAGALDI" || c.deposito_asignado === "LUJAN"
    ? c.deposito_asignado
    : "";

  let pricing;
  let pricingUnavailable = false;
  try {
    pricing = await loadServicePricing();
  } catch {
    pricing = null;
    pricingUnavailable = true;
  }

  const clientRatesMap = (pricing?.clientRateManagement && pricing.clientRateManagement[c.id]) ? pricing.clientRateManagement[c.id] : {};
  const rates = pricing
    ? [
        ...pricing.catalog
          .filter((service) => service.active)
          .map((service) => ({
            slug: service.slug,
            label: service.label,
            unit: service.unit,
            category: service.category || "servicios",
            requiresQuote: service.requires_quote ?? (pricing.generalRates[service.slug]?.requiresQuote ?? false),
            listRate: pricing.generalRates[service.slug]?.rate ?? null,
          })),
        ...Object.entries(pricing.generalRates)
          .filter(([slug, rate]) => slug.startsWith("transporte:") && rate.category === "transporte")
          .map(([slug, rate]) => ({
            slug,
            label: rate.label,
            unit: rate.unit,
            category: "transporte",
            requiresQuote: rate.requiresQuote,
            listRate: rate.rate,
          })),
      ]
    : [];

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6 nx-page-fade max-w-[1200px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/clients" className="text-[11px] text-fg-link hover:underline">← Clientes</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="page-title">{c.razon ?? "—"}</h1>
            {c.activo === false && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-neutral-200 text-fg-secondary">Inactivo</span>}
          </div>
          <p className="page-subtitle">Legajo digital de cliente · CUIT {c.cuit ?? "—"}</p>
        </div>
        <EntityConversationButton entityType="clients" entityId={c.id} />
      </div>

      {/* General */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="building" size={15} /> General</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Razón social" value={c.razon} />
          <Field label="Nombre comercial" value={c.nombre_comercial} />
          <Field label="CUIT" value={c.cuit} />
          <Field label="Código interno" value={c.codigo} />
          <Field label="Condición IVA" value={c.condicion_iva} />
          <Field label="Domicilio" value={c.domicilio} />
          <Field label="Localidad" value={c.localidad} />
          <Field label="Teléfono" value={c.telefono} />
          <Field label="Email" value={c.email ? <a href={`mailto:${c.email}`} className="text-fg-link hover:underline">{c.email}</a> : null} />
          <Field label="Contacto" value={c.contacto} />
          <Field label="Tags" value={(c.tags ?? []).join(" · ")} />
          <Field label="Observaciones" value={c.observaciones} />
        </div>
      </section>

      <ClientMasterEditor
        clientId={c.id}
        cuit={c.cuit ?? ""}
        activo={c.activo !== false}
        updatedAt={c.updated_at ?? c.created_at ?? ""}
        custodyLevel={c.custody_level === 2 ? 2 : 1}
        canContractCustody={await canContractCustody()}
        initial={{
          razon: c.razon ?? "",
          nombre_comercial: c.nombre_comercial ?? "",
          codigo: c.codigo ?? "",
          domicilio: c.domicilio ?? "",
          localidad: c.localidad ?? "",
          telefono: c.telefono ?? "",
          contacto: c.contacto ?? "",
          email: c.email ?? "",
          tags: (c.tags ?? []).join(", "),
          deposito_asignado: depositoAsignado,
          observaciones: c.observaciones ?? "",
          motivo: "edición de ficha nativa",
        }}
      />

      {/* Precios y Tarifas Personalizadas */}
      {pricing && (
        <section className="card p-5">
          <ClientCustomRatesEditor
            clientId={c.id}
            clientName={c.razon ?? ""}
            clientCuit={c.cuit ?? ""}
            currency={pricing.currency}
            canAdjust={pricing.canAdjust}
            services={rates}
            clientRates={clientRatesMap}
            mode="profile"
          />
        </section>
      )}
      {pricingUnavailable && (
        <section className="card p-5 border border-amber-500/30 bg-amber-500/5">
          <h2 className="font-semibold text-amber-700 dark:text-amber-300">Tarifas temporalmente no disponibles</h2>
          <p className="text-xs text-fg-muted mt-1">
            No fue posible consultar el tarifario o tus permisos. La ficha del cliente continúa disponible, pero no se realizó ningún cambio de precios.
          </p>
        </section>
      )}

      {/* Fiscal & contable (Contadora) */}
      <ClienteFiscalEditor
        clientId={c.id}
        updatedAt={c.updated_at ?? c.created_at ?? ""}
        accounts={accounts}
        initial={{ condicion_iva: condicionIva, cuenta_contable: c.cuenta_contable ?? "" }}
      />

      {/* Finanzas (real, por client_id) */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="wallet" size={15} /> Finanzas</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Field label="Facturas abiertas" value={saldo?.facturas_abiertas ?? "—"} />
          <Field label="Total facturado" value={saldo ? fmtCurrency(saldo.total_facturado ?? 0) : "—"} />
          <Field label="Próximo vencimiento" value={fmtDate(saldo?.proxima_vencimiento ?? null)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-fg-muted text-[11px] uppercase"><th className="py-1">Factura</th><th className="py-1">Tipo</th><th className="py-1">Emisión</th><th className="py-1">Vto</th><th className="py-1">Estado</th><th className="py-1 text-right">Total</th></tr></thead>
            <tbody>
              {facturas.length === 0 && <tr><td colSpan={6} className="py-4 text-fg-muted">Sin facturas registradas.</td></tr>}
              {facturas.map((f) => (
                <tr key={f.id} className="border-t border-stroke-soft/60">
                  <td className="py-2 tabular">#{f.numero_comprobante ?? f.id.slice(0, 8)}</td>
                  <td className="py-2">{f.tipo_comprobante ?? "—"}</td>
                  <td className="py-2">{fmtDate(f.created_at)}</td>
                  <td className="py-2">{fmtDate(f.fch_vto_pago)}</td>
                  <td className="py-2">{f.estado_arca ?? "—"}</td>
                  <td className="py-2 text-right tabular">{fmtCurrency(f.total ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Total adeudado — KPI destacado (verde corporativo, escala Tesorería). Misma fuente: saldo_cuenta. */}
        <div className="mt-5 pt-4 border-t border-stroke-soft flex justify-end">
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Total adeudado</div>
            <div className="text-3xl md:text-4xl font-black tabular text-status-success leading-none mt-1">
              {saldo ? fmtCurrency(saldo.saldo_cuenta ?? 0) : "—"}
            </div>
            <div className="text-[11px] text-fg-muted mt-1">Saldo total a cobrar al cliente</div>
          </div>
        </div>
      </section>

      {/* Operaciones */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="truck" size={15} /> Operaciones</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Depósito asignado" value={c.deposito_asignado} />
          <Field label="Servicios (OS)" value={<Link href="/orders" className="text-fg-link hover:underline">Ver órdenes de servicio →</Link>} />
        </div>
        <p className="text-[11px] text-fg-muted mt-2">m² ocupados: la ocupación por cliente se gestiona en WMS (vista corporativa). Trazabilidad m²-por-cliente: fase futura.</p>
      </section>

      {/* Documentación */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="folder" size={15} /> Documentación</h2>
        <p className="text-sm text-fg-secondary">Contratos, certificados y ANMAT se gestionan en el Centro Documental / Drive.</p>
        <Link href="/drive" className="inline-flex items-center gap-1 text-fg-link hover:underline mt-2 text-sm"><Icon name="drive" size={13} /> Abrir Drive corporativo</Link>
      </section>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SignaturePad, type SignaturePadHandle } from "@/components/compras/SignaturePad";
import type { Operator, ServiceCatalogItem, Depot } from "@/lib/types";
import type { OrderClientOption } from "@/lib/data/orders";
import { createOrder } from "./actions";

interface Props {
  clients: OrderClientOption[];
  operators: Operator[];
  catalog: ServiceCatalogItem[];
  depot: Depot;
  siteLabel: string;
}

export default function OperationalOrderWizard({ clients, operators, catalog, depot, siteLabel }: Props) {
  const router = useRouter();
  const pad = useRef<SignaturePadHandle>(null);
  // La sede de la cuenta es el VALOR POR DEFECTO, no un límite: Magaldi y
  // Luján están a cincuenta metros y los encargados se cubren entre sí.
  const [orderDepot, setOrderDepot] = useState<Depot>(depot);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [operatorId, setOperatorId] = useState(operators[0]?.id ?? "");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("12:00");
  const [pallets, setPallets] = useState(0);
  const [units, setUnits] = useState(0);
  const [km, setKm] = useState(0);
  const [observ, setObserv] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [signedDoc, setSignedDoc] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => clients.find((item) => item.id === clientId), [clientId, clients]);
  const serviceRows = useMemo(
    () => catalog.filter((item) => selected[item.slug] != null),
    [catalog, selected],
  );

  const toggle = (slug: string) => setSelected((current) => {
    const next = { ...current };
    if (next[slug] != null) delete next[slug];
    else next[slug] = 1;
    return next;
  });

  const submit = async () => {
    setError(null);
    if (!client || !operatorId || serviceRows.length === 0 || signedBy.trim().length < 2 || !hasInk || pad.current?.isEmpty()) {
      setError("Completá cliente, responsable, servicios y firma.");
      return;
    }
    setSubmitting(true);
    try {
      const signaturePad = pad.current;
      if (!signaturePad) throw new Error("Firma no disponible");
      const signatureData = signaturePad.toDataURL();
      const signatureHash = await signaturePad.toHash();
      const result = await createOrder({
        pricing_version_id: null,
        client: {
          id: client.id,
          razon: client.razon,
          cuit: client.cuit,
          domicilio: "",
          telefono: "",
          contacto: "",
          email: "",
        },
        depot: orderDepot,
        operator_id: operatorId,
        services: serviceRows.map((service) => ({
          service_slug: service.slug,
          label: service.label,
          qty: selected[service.slug],
          qty_requested: selected[service.slug],
          unit: service.unit,
          rate: null,
          subtotal: null,
          pricing_status: "pending_quote" as const,
          pricing_kind: "catalog" as const,
          pricing_reason: "",
          second_trip_discount: false,
          surcharge: "none" as const,
          expected_tariff_rate_id: null,
          expected_client_rate_id: null,
        })),
        h_start: start,
        h_end: end,
        pallets,
        units,
        km,
        observ,
        total: null,
        signature: {
          signed_by: signedBy.trim(),
          signed_doc: signedDoc.trim() || null,
          data_url: signatureData,
          hash: signatureHash,
          geo_lat: null,
          geo_lng: null,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/orders/${result.public_id}?created=1`);
    } catch {
      setError("No se pudo confirmar la orden.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <div className="eyebrow-tiny">Cockpit operativo · {siteLabel}</div>
        <h1 className="page-title">Nueva orden de servicio</h1>
        <p className="page-subtitle">Registrá la prestación y sus cantidades. La cotización se resuelve por el circuito autorizado.</p>
      </div>

      <div className="card card-pad space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="space-y-1 text-sm font-semibold">Cliente
            <select className="input" value={clientId} onChange={(event) => setClientId(event.target.value)}>
              {clients.map((item) => <option key={item.id} value={item.id}>{item.razon} · {item.cuit}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-semibold">Responsable
            <select className="input" value={operatorId} onChange={(event) => setOperatorId(event.target.value)}>
              {operators.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
            </select>
          </label>
        </div>
        <label className="space-y-1 text-sm font-semibold">Sede de la orden
          <select
            className="input"
            value={orderDepot}
            onChange={(event) => setOrderDepot(event.target.value as Depot)}
          >
            <option value="LUJAN">Luján</option>
            <option value="MAGALDI">Agustín Magaldi 765</option>
          </select>
          <span className="block text-xs font-normal text-fg-secondary">
            Tu sede es {siteLabel}. Podés cargar órdenes de la otra nave cuando la cubrís.
          </span>
        </label>
      </div>

      <div className="card card-pad">
        <h2 className="font-bold text-fg-brand mb-3">Servicios y cantidades</h2>
        <div className="space-y-2">
          {catalog.map((service) => {
            const active = selected[service.slug] != null;
            return <div key={service.slug} className="rounded-lg border border-stroke-soft p-3 flex flex-wrap items-center gap-3">
              <label className="flex flex-1 min-w-[220px] items-center gap-2 font-semibold text-sm">
                <input type="checkbox" checked={active} onChange={() => toggle(service.slug)} />
                <span>{service.label}</span>
              </label>
              {active && <input
                className="input w-28"
                type="number"
                min="0.01"
                step="0.01"
                aria-label={`Cantidad ${service.label}`}
                value={selected[service.slug]}
                onChange={(event) => setSelected((current) => ({ ...current, [service.slug]: Math.max(0.01, Number(event.target.value) || 0.01) }))}
              />}
              <span className="text-xs text-fg-muted">{service.unit}</span>
              <span className="text-xs font-bold text-status-warning">PENDIENTE DE COTIZACIÓN</span>
            </div>;
          })}
        </div>
      </div>

      <div className="card card-pad space-y-3">
        <h2 className="font-bold text-fg-brand">Datos de prestación</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <label className="text-xs font-semibold">Inicio<input className="input mt-1" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="text-xs font-semibold">Fin<input className="input mt-1" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label className="text-xs font-semibold">Pallets<input className="input mt-1" type="number" min="0" value={pallets} onChange={(e) => setPallets(Math.max(0, Number(e.target.value) || 0))} /></label>
          <label className="text-xs font-semibold">Unidades<input className="input mt-1" type="number" min="0" value={units} onChange={(e) => setUnits(Math.max(0, Number(e.target.value) || 0))} /></label>
          <label className="text-xs font-semibold">Km<input className="input mt-1" type="number" min="0" value={km} onChange={(e) => setKm(Math.max(0, Number(e.target.value) || 0))} /></label>
        </div>
        <textarea className="input min-h-24" maxLength={2000} value={observ} onChange={(e) => setObserv(e.target.value)} placeholder="Observaciones operativas" />
      </div>

      <div className="card card-pad space-y-3">
        <h2 className="font-bold text-fg-brand">Firma de conformidad</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <input className="input" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Nombre del firmante" />
          <input className="input" value={signedDoc} onChange={(e) => setSignedDoc(e.target.value)} placeholder="Documento (opcional)" />
        </div>
        <SignaturePad ref={pad} hint="Firma de conformidad" onChange={setHasInk} height={180} />
      </div>

      {error && <div className="rounded-lg border border-tops-red/30 bg-tops-red/5 p-3 text-sm text-tops-red">{error}</div>}
      <button className="btn btn-primary w-full" type="button" disabled={submitting} onClick={submit}>
        {submitting ? "Confirmando…" : "Confirmar orden operativa"}
      </button>
    </div>
  );
}

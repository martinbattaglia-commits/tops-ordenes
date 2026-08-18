"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import {
  contractClientCustody,
  setClientActivo,
  updateClientMaster,
} from "@/app/(app)/clients/actions";

interface EditorState {
  razon: string;
  nombre_comercial: string;
  codigo: string;
  domicilio: string;
  localidad: string;
  telefono: string;
  contacto: string;
  email: string;
  tags: string;
  deposito_asignado: "MAGALDI" | "LUJAN" | "";
  observaciones: string;
  motivo: string;
}

interface Props {
  clientId: string;
  cuit: string;
  activo: boolean;
  updatedAt: string;
  custodyLevel: 1 | 2;
  /** Permiso `clientes.custody.contract`, medido server-side. La compuerta real sigue en la base. */
  canContractCustody: boolean;
  initial: EditorState;
}

export function ClientMasterEditor({ clientId, cuit, activo: initialActive, updatedAt, custodyLevel: initialCustodyLevel, canContractCustody, initial }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(initial);
  const [version, setVersion] = useState(updatedAt);
  const [active, setActive] = useState(initialActive);
  const [custodyLevel, setCustodyLevel] = useState<1 | 2>(initialCustodyLevel);
  const [stateReason, setStateReason] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const tags = form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const result = await updateClientMaster({
        ...form,
        id: clientId,
        tags,
        expected_updated_at: version,
      });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setVersion(result.client.updated_at ?? version);
      setForm((current) => ({
        ...current,
        razon: result.client.razon,
        nombre_comercial: result.client.nombre_comercial ?? "",
        codigo: result.client.codigo ?? "",
        domicilio: result.client.domicilio ?? "",
        localidad: result.client.localidad ?? "",
        telefono: result.client.telefono ?? "",
        contacto: result.client.contacto ?? "",
        email: result.client.email ?? "",
        tags: (result.client.tags ?? []).join(", "),
        deposito_asignado: result.client.deposito_asignado ?? "",
        observaciones: result.client.observaciones ?? "",
      }));
      setEditing(false);
      setMessage({ kind: "ok", text: "Ficha nativa actualizada y auditada." });
      router.refresh();
    });
  };

  const contractCustody = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await contractClientCustody(clientId, version);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      // La RPC devuelve la fila con su nuevo `updated_at`: sin refrescar la
      // versión, el próximo guardado de la ficha chocaría contra el CAS.
      setVersion(result.updated_at);
      setCustodyLevel(2);
      setMessage({ kind: "ok", text: "Custodia digital reforzada contratada y auditada." });
      router.refresh();
    });
  };

  const changeState = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await setClientActivo(clientId, !active, stateReason);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setActive((current) => !current);
      setStateReason("");
      setMessage({
        kind: "ok",
        text: active ? "Cliente desactivado sin borrar su historial." : "Cliente reactivado.",
      });
      router.refresh();
    });
  };

  return (
    <section className="card p-5" aria-labelledby="client-master-heading">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 id="client-master-heading" className="font-semibold flex items-center gap-2">
            <Icon name="building" size={15} /> Registro maestro nativo
          </h2>
          <p className="text-[11px] text-fg-muted mt-1">
            Los cambios se guardan junto con su evento de auditoría. El CUIT es la identidad canónica y no se edita desde esta ficha.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setEditing((value) => !value);
            setMessage(null);
          }}
          disabled={pending}
        >
          <Icon name={editing ? "x" : "pen"} size={14} /> {editing ? "Cancelar" : "Editar ficha"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Razón social" required>
          <input className="input" value={form.razon} onChange={(event) => set("razon", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="CUIT">
          <input className="input font-mono" value={cuit} readOnly disabled />
        </Field>
        <Field label="Nombre comercial">
          <input className="input" value={form.nombre_comercial} onChange={(event) => set("nombre_comercial", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="Código interno">
          <input className="input" value={form.codigo} onChange={(event) => set("codigo", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="Domicilio">
          <input className="input" value={form.domicilio} onChange={(event) => set("domicilio", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="Localidad">
          <input className="input" value={form.localidad} onChange={(event) => set("localidad", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="Contacto">
          <input className="input" value={form.contacto} onChange={(event) => set("contacto", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="Teléfono">
          <input className="input" value={form.telefono} onChange={(event) => set("telefono", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={(event) => set("email", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="Depósito habitual">
          <select className="input" value={form.deposito_asignado} onChange={(event) => set("deposito_asignado", event.target.value as EditorState["deposito_asignado"])} disabled={!editing || pending}>
            <option value="">Sin asignar</option>
            <option value="MAGALDI">Magaldi</option>
            <option value="LUJAN">Luján</option>
          </select>
        </Field>
        <Field label="Tags" help="Separados por coma">
          <input className="input" value={form.tags} onChange={(event) => set("tags", event.target.value)} disabled={!editing || pending} />
        </Field>
        <Field label="Motivo de la edición">
          <input className="input" value={form.motivo} onChange={(event) => set("motivo", event.target.value)} disabled={!editing || pending} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Observaciones internas">
            <textarea className="textarea" rows={3} value={form.observaciones} onChange={(event) => set("observaciones", event.target.value)} disabled={!editing || pending} />
          </Field>
        </div>
      </div>

      {editing && (
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={pending || !version || form.razon.trim().length < 2}>
            <Icon name="check" size={14} /> {pending ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-stroke-soft">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <Icon name="shield" size={13} /> Custodia digital
        </div>
        {custodyLevel === 2 ? (
          <div>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-status-success/10 text-status-success">
              Reforzada contratada · nivel 2
            </span>
            <p className="text-[11px] text-fg-muted mt-1.5">
              El nivel contratado eleva, nunca degrada: la baja del servicio no se ofrece desde esta ficha y es una decisión de Dirección.
            </p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1">
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-neutral-200 text-fg-secondary">
                Estándar · nivel 1
              </span>
              <p className="text-[11px] text-fg-muted mt-1.5">
                Contratar aplica a la mercadería que ingrese desde ahora: foto de egreso obligatoria, análisis y compuerta. Requiere el permiso de contratación de custodia.
              </p>
            </div>
            {canContractCustody ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={contractCustody}
                disabled={pending || !version}
              >
                <Icon name="shield" size={14} /> {pending ? "Contratando…" : "Contratar custodia reforzada"}
              </button>
            ) : (
              <p className="text-[11px] text-fg-muted">
                La contratación requiere el permiso de contratación de custodia: pedila a quien lo tenga.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 pt-4 border-t border-stroke-soft">
        <div className="text-xs font-semibold mb-2">Estado del cliente</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="input flex-1"
            value={stateReason}
            onChange={(event) => setStateReason(event.target.value)}
            placeholder={active ? "Motivo obligatorio de desactivación" : "Motivo obligatorio de reactivación"}
            disabled={pending}
          />
          <button
            type="button"
            className={active ? "btn btn-danger btn-sm" : "btn btn-primary btn-sm"}
            onClick={changeState}
            disabled={pending || !stateReason.trim()}
          >
            {active ? "Desactivar cliente" : "Reactivar cliente"}
          </button>
        </div>
        <p className="text-[11px] text-fg-muted mt-1">Desactivar nunca elimina la fila ni sus órdenes; registra motivo, actor y estado anterior.</p>
      </div>

      {message && (
        <div role={message.kind === "error" ? "alert" : "status"} className={`mt-3 rounded-md px-3 py-2 text-sm ${message.kind === "error" ? "bg-status-danger/10 text-status-danger" : "bg-status-success/10 text-status-success"}`}>
          {message.text}
        </div>
      )}
    </section>
  );
}

function Field({ label, required, help, children }: { label: string; required?: boolean; help?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-fg-secondary">
      <span>{label}{required ? " *" : ""}</span>
      <div className="mt-1">{children}</div>
      {help && <span className="text-[10px] text-fg-muted">{help}</span>}
    </label>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { VoiceField } from "@/components/voice/VoiceField";
import type { FiscalConfig, PuntoVenta } from "@/lib/invoicing/types";
import { updateFiscalConfig } from "./actions";

const COND_IVA_OPTIONS: { value: FiscalConfig["condicion_iva"]; label: string }[] = [
  { value: "RESPONSABLE_INSCRIPTO", label: "Responsable Inscripto" },
  { value: "MONOTRIBUTO", label: "Monotributo" },
  { value: "EXENTO", label: "Exento" },
  { value: "CONSUMIDOR_FINAL", label: "Consumidor Final" },
  { value: "NO_RESPONSABLE", label: "No Responsable" },
  { value: "NO_CATEGORIZADO", label: "No Categorizado" },
];

const AMBIENTE_OPTIONS: { value: FiscalConfig["ambiente"]; label: string }[] = [
  { value: "SANDBOX", label: "SANDBOX (Mock — sin validez fiscal)" },
  { value: "HOMOLOGACION", label: "HOMOLOGACIÓN (testing ARCA)" },
  { value: "PRODUCCION", label: "PRODUCCIÓN (validez fiscal real)" },
];

interface Props {
  config: FiscalConfig;
  puntosVenta: PuntoVenta[];
  canEdit: boolean;
  arcaConfigured: boolean;
}

export function FiscalConfigForm({ config, puntosVenta, canEdit, arcaConfigured }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      razon_social: String(fd.get("razon_social") ?? ""),
      nombre_fantasia: String(fd.get("nombre_fantasia") ?? ""),
      cuit: String(fd.get("cuit") ?? ""),
      ingresos_brutos: String(fd.get("ingresos_brutos") ?? ""),
      inicio_actividades: String(fd.get("inicio_actividades") ?? ""),
      domicilio_comercial: String(fd.get("domicilio_comercial") ?? ""),
      localidad: String(fd.get("localidad") ?? ""),
      provincia: String(fd.get("provincia") ?? ""),
      condicion_iva: String(fd.get("condicion_iva") ?? ""),
      ambiente: String(fd.get("ambiente") ?? ""),
      cert_alias: String(fd.get("cert_alias") ?? ""),
      default_punto_venta: String(fd.get("default_punto_venta") ?? ""),
      pie_legal: String(fd.get("pie_legal") ?? ""),
    };
    start(async () => {
      const r = await updateFiscalConfig(input);
      if (r.ok) setInfo("Configuración fiscal guardada.");
      else setError(r.error);
    });
  };

  const disabled = !canEdit || pending;

  return (
    <form onSubmit={submit} className="card card-pad">
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Razón social" required>
            <input name="razon_social" className="input" required defaultValue={config.razon_social} />
          </Field>
          <Field label="Nombre de fantasía">
            <input name="nombre_fantasia" className="input" defaultValue={config.nombre_fantasia ?? ""} />
          </Field>
          <Field label="CUIT" required>
            <input
              name="cuit"
              className="input font-mono"
              required
              placeholder="33-60489698-9"
              defaultValue={config.cuit}
            />
          </Field>
          <Field label="Ingresos Brutos">
            <input name="ingresos_brutos" className="input" defaultValue={config.ingresos_brutos ?? ""} />
          </Field>
          <Field label="Inicio de actividades">
            <input
              name="inicio_actividades"
              type="date"
              className="input"
              defaultValue={config.inicio_actividades ?? ""}
            />
          </Field>
          <Field label="Condición frente al IVA" required>
            <select name="condicion_iva" className="input" defaultValue={config.condicion_iva}>
              {COND_IVA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Domicilio comercial">
            <input name="domicilio_comercial" className="input" defaultValue={config.domicilio_comercial ?? ""} />
          </Field>
          <Field label="Localidad">
            <input name="localidad" className="input" defaultValue={config.localidad ?? ""} />
          </Field>
          <Field label="Provincia">
            <input name="provincia" className="input" defaultValue={config.provincia ?? ""} />
          </Field>
          <Field label="Punto de venta por defecto">
            <select
              name="default_punto_venta"
              className="input"
              defaultValue={config.default_punto_venta ?? ""}
            >
              <option value="">— Sin definir —</option>
              {puntosVenta
                .filter((p) => p.activo)
                .map((p) => (
                  <option key={p.id} value={p.numero}>
                    {String(p.numero).padStart(5, "0")} · {p.descripcion}
                  </option>
                ))}
            </select>
          </Field>
        </div>

        <div className="border-t border-border-subtle pt-4">
          <div className="text-eyebrow-sm uppercase text-fg-muted mb-3">Ambiente ARCA</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Ambiente de emisión" required>
              <select name="ambiente" className="input" defaultValue={config.ambiente}>
                {AMBIENTE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Alias del certificado (cert_alias)">
              <input
                name="cert_alias"
                className="input font-mono"
                placeholder="ej: verotin-prod"
                defaultValue={config.cert_alias ?? ""}
              />
            </Field>
          </div>
          <p className="text-xs text-fg-muted mt-2">
            La clave privada X.509 nunca se guarda en la base ni en el repo: se entrega como
            secret del entorno (<code className="font-mono">ARCA_CERT_PEM</code> /{" "}
            <code className="font-mono">ARCA_KEY_PEM</code> en serverless, o{" "}
            <code className="font-mono">ARCA_CERT_PATH</code> /{" "}
            <code className="font-mono">ARCA_KEY_PATH</code> en hosts con filesystem).
            Estado de credenciales:{" "}
            <span className={arcaConfigured ? "text-status-success font-semibold" : "text-status-warning font-semibold"}>
              {arcaConfigured ? "presentes en el entorno" : "no presentes — sólo SANDBOX/Homologación"}
            </span>
            .
          </p>
        </div>

        <Field label="Pie legal del comprobante">
          <VoiceField>
            <textarea
              name="pie_legal"
              className="input min-h-[72px]"
              defaultValue={config.pie_legal ?? ""}
            />
          </VoiceField>
        </Field>
      </fieldset>

      {error && (
        <div className="mt-4 rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
          {error}
        </div>
      )}
      {info && (
        <div className="mt-4 rounded-md bg-status-success/10 text-status-success text-sm px-3 py-2 border border-status-success/20">
          {info}
        </div>
      )}

      {canEdit && (
        <div className="mt-4 flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            <Icon name={pending ? "refresh" : "check"} size={14} />
            {pending ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      )}
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
    </div>
  );
}

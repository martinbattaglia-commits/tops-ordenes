"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { fmtCurrency } from "@/lib/utils";
import {
  calculateIncomeTaxRetention,
  CONCEPTO_LABEL,
  CONCEPTOS_GRAVADOS,
  CONCEPTOS_EXCLUIDOS_AUTOMATICO,
  type Concepto,
  type RetenciónConfig,
  type EscalaTramo,
  type RetenciónResult,
} from "@/lib/compras/retencion-ganancias";
import {
  fetchRetenciónContextAction,
  saveRetenciónAction,
  saveVendorConceptoGananciasAction,
  type RetenciónContext,
} from "@/app/(app)/compras/facturas/nueva/retencion-actions";
// Servicio único de exclusión/vigencia (reqs. 5 y 6) — evita duplicar lógica.
import { certificadoVigente } from "@/lib/fiscal/exclusion-retenciones";

// ─── Props ────────────────────────────────────────────────────

interface Props {
  tipoComprobante:    string;
  netoGravado:        number;
  totalFactura:       number;
  vendorId:           string;
  fechaEmision:       string;
  supplierInvoiceId?: string;
}

// ─── Semáforo ─────────────────────────────────────────────────

type SemaforoColor = "verde" | "naranja" | "rojo";

interface SemaforoInfo {
  emoji:    string;
  titulo:   string;
  bgBorder: string;
  textColor: string;
  iconName: "check-circle" | "bolt" | "shield";
}

const SEMAFORO: Record<SemaforoColor, SemaforoInfo> = {
  verde:   { emoji: "🟢", titulo: "No corresponde retener",  bgBorder: "bg-status-success/10 border-status-success/30", textColor: "text-status-success", iconName: "check-circle" },
  naranja: { emoji: "🟠", titulo: "Corresponde retener",     bgBorder: "bg-status-warning/10 border-status-warning/30", textColor: "text-status-warning", iconName: "bolt"         },
  rojo:    { emoji: "🔴", titulo: "Revisar manualmente",     bgBorder: "bg-status-danger/10  border-status-danger/30",  textColor: "text-status-danger",  iconName: "shield"       },
};

function computeSemaforo(
  result: RetenciónResult,
  alertas: AlertItem[],
  ctx: RetenciónContext,
  fecha: string,
): SemaforoColor {
  if (certificadoVigente(ctx.vendor.cert_exclusion_hasta, fecha || new Date().toISOString().slice(0, 10)))
    return "rojo";
  if (ctx.retenciónExistente && result.corresponde) return "rojo";
  if (alertas.some((a) => a.type === "danger"))     return "rojo";
  return result.corresponde ? "naranja" : "verde";
}

// ─── Alertas ──────────────────────────────────────────────────

interface AlertItem { type: "warn" | "info" | "danger"; msg: string }

function isMonotributista(tipoComprobante: string, ctx: RetenciónContext): boolean {
  return tipoComprobante === "FACTURA_C" || ctx.vendor.cond_iva?.toLowerCase() === "monotributista";
}

function buildAlertas(
  ctx: RetenciónContext,
  tipoComprobante: string,
  fecha: string,
  result: RetenciónResult,
): AlertItem[] {
  const items: AlertItem[] = [];

  if (isMonotributista(tipoComprobante, ctx))
    items.push({ type: "info", msg: "Proveedor Monotributista (Factura C). No corresponde retención de Ganancias." });

  if (ctx.vendor.exento_ganancias)
    items.push({ type: "info", msg: "Proveedor exento de retención de Ganancias por resolución individual." });

  if (ctx.vendor.cert_exclusion_hasta) {
    const vigencia  = new Date(ctx.vendor.cert_exclusion_hasta);
    const fmtFecha  = vigencia.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
    if (certificadoVigente(ctx.vendor.cert_exclusion_hasta, fecha || new Date().toISOString().slice(0, 10))) {
      items.push({ type: "warn", msg: `Certificado de Exclusión vigente hasta el ${fmtFecha}. Verificar con el estudio contable antes de practicar retención.` });
    } else {
      items.push({ type: "info", msg: `Certificado de Exclusión vencido el ${fmtFecha}. Corresponde retención normal.` });
    }
  }

  if (ctx.retenciónExistente && result.corresponde)
    items.push({ type: "warn", msg: "Ya se registró una retención a este proveedor en el período. Verificar duplicado con el estudio contable." });

  if (!result.corresponde && ctx.acumuladoPrevio > 0 && result.minimo > 0 && !isMonotributista(tipoComprobante, ctx)) {
    const pct = Math.round((result.acumuladoTotal / result.minimo) * 100);
    if (pct >= 70)
      items.push({ type: "info", msg: `Acumulado al ${pct}% del mínimo (${fmtCurrency(result.minimo)}). Una próxima factura podría generar retención.` });
  }
  return items;
}

// ─── Primitivos UI ────────────────────────────────────────────

function CalcLine({ label, value, sub = false, big = false, warn = false, highlight = false }: {
  label: string; value: string; sub?: boolean; big?: boolean; warn?: boolean; highlight?: boolean;
}) {
  return (
    <div className={[
      "flex justify-between items-baseline gap-3 py-1.5",
      "border-b border-stroke-soft/40 last:border-0 text-xs",
      sub       ? "pl-3" : "",
      highlight ? "-mx-3 px-3 bg-fg-brand/8 rounded" : "",
    ].join(" ")}>
      <span className={sub ? "text-fg-muted" : big ? "font-semibold text-fg-primary" : "text-fg-secondary"}>
        {label}
      </span>
      <span className={[
        "font-mono tabular-nums font-semibold",
        warn      ? "text-status-warning" :
        highlight ? "text-fg-brand font-bold" :
        big       ? "text-fg-primary" :
                    "text-fg-secondary",
      ].join(" ")}>
        {value}
      </span>
    </div>
  );
}

function Alert({ type, children }: { type: "warn" | "info" | "danger"; children: React.ReactNode }) {
  const styles = {
    warn:   "bg-status-warning/10 border-status-warning/30 text-status-warning",
    info:   "bg-fg-brand/8 border-fg-brand/20 text-fg-brand",
    danger: "bg-status-danger/10 border-status-danger/25 text-status-danger",
  } as const;
  const icons = { warn: "bolt", info: "sparkle", danger: "bolt" } as const;
  return (
    <div className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px] leading-snug ${styles[type]}`}>
      <Icon name={icons[type]} size={12} className="mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ─── Setup de concepto ────────────────────────────────────────

function ConceptoSetup({ vendorName, onSave, saving }: {
  vendorName: string; onSave: (c: Concepto) => void; saving: boolean;
}) {
  const [local, setLocal] = useState<Concepto>("honorarios");
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-fg-secondary leading-relaxed">
        <strong className="text-fg-primary">{vendorName}</strong> no tiene configurado el concepto de retención.
        Seleccionalo una vez y quedará guardado para futuras facturas.
      </p>
      <div className="flex gap-2 items-center">
        <select
          className="input appearance-none pr-8 text-xs flex-1"
          value={local}
          onChange={(e) => setLocal(e.target.value as Concepto)}
        >
          <optgroup label="Sujetos a retención (Factura A)">
            {CONCEPTOS_GRAVADOS.map((c) => (<option key={c} value={c}>{CONCEPTO_LABEL[c]}</option>))}
          </optgroup>
          <optgroup label="Conceptos excluidos">
            {CONCEPTOS_EXCLUIDOS_AUTOMATICO.map((c) => (<option key={c} value={c}>{CONCEPTO_LABEL[c]}</option>))}
            <option value="excluido">Excluido (otro motivo)</option>
          </optgroup>
        </select>
        <button
          type="button"
          className="btn btn-primary btn-sm flex-shrink-0"
          disabled={saving}
          onClick={() => onSave(local)}
        >
          {saving ? <Icon name="refresh" size={12} className="animate-spin" /> : "Guardar"}
        </button>
      </div>
    </div>
  );
}

// ─── Modal "Ver normativa aplicada" ──────────────────────────

function NormativaModal({ normativaVersion, config, escala, onClose }: {
  normativaVersion: string;
  config: RetenciónConfig;
  escala: EscalaTramo[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card max-w-lg w-full mx-4 p-5 space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-fg-primary">Normativa aplicada al cálculo</h3>
            <p className="text-xs text-fg-muted mt-0.5">
              Parámetros vigentes desde <strong>{normativaVersion}</strong>
            </p>
          </div>
          <button type="button" className="text-fg-muted hover:text-fg-primary" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider mb-1.5">
            Mínimos no sujetos y alícuotas
          </p>
          <div className="rounded-lg border border-stroke-soft overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-bg-surface">
                <tr>
                  <th className="text-left px-3 py-2 text-fg-muted font-semibold">Concepto</th>
                  <th className="text-right px-3 py-2 text-fg-muted font-semibold">Mínimo</th>
                  <th className="text-right px-3 py-2 text-fg-muted font-semibold">Alícuota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke-soft/50">
                {[
                  { label: "Honorarios",   min: config.minHonorarios,  rate: "Escala progresiva" },
                  { label: "Mercaderías",  min: config.minMercaderias, rate: `${config.rateMercaderias}%` },
                  { label: "Servicios",    min: config.minServicios,   rate: `${config.rateServicios}%` },
                  { label: "Alquileres",   min: config.minAlquileres,  rate: `${config.rateAlquileres}%` },
                ].map((r) => (
                  <tr key={r.label}>
                    <td className="px-3 py-2 text-fg-secondary">{r.label}</td>
                    <td className="px-3 py-2 text-right font-mono text-fg-primary">{fmtCurrency(r.min)}</td>
                    <td className="px-3 py-2 text-right font-mono text-fg-primary">{r.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider mb-1.5">
            Escala progresiva — Honorarios
          </p>
          <div className="rounded-lg border border-stroke-soft overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-bg-surface">
                <tr>
                  <th className="text-left  px-3 py-2 text-fg-muted font-semibold">Desde</th>
                  <th className="text-left  px-3 py-2 text-fg-muted font-semibold">Hasta</th>
                  <th className="text-right px-3 py-2 text-fg-muted font-semibold">Fijo</th>
                  <th className="text-right px-3 py-2 text-fg-muted font-semibold">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke-soft/50">
                {escala.map((t, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-mono text-fg-secondary">{fmtCurrency(t.desde)}</td>
                    <td className="px-3 py-2 font-mono text-fg-secondary">
                      {t.hasta == null ? "Sin límite" : fmtCurrency(t.hasta)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-fg-primary">{fmtCurrency(t.fijo)}</td>
                    <td className="px-3 py-2 text-right font-mono text-fg-primary">{t.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-[10px] text-fg-muted leading-relaxed">
          Parámetros actualizables sin modificar código desde la tabla{" "}
          <code className="text-fg-brand">ganancias_retention_params</code>.
        </p>
      </div>
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────

export function RetenciongananciasPanel({
  tipoComprobante, netoGravado, totalFactura, vendorId, fechaEmision, supplierInvoiceId,
}: Props) {
  const [ctx, setCtx]                   = useState<RetenciónContext | null>(null);
  const [loading, setLoading]           = useState(false);
  const [expanded, setExpanded]         = useState(false);
  const [showNormativa, setShowNormativa] = useState(false);
  const [savingConc, startSaveConc]     = useTransition();
  const [savingRet,  startSaveRet]      = useTransition();
  const [savedRet,   setSavedRet]       = useState(false);
  const prevVendor                      = useRef<string>("");
  const prevInvoiceId                   = useRef<string | undefined>(undefined);
  const resultRef                       = useRef<RetenciónResult | null>(null);

  useEffect(() => {
    if (!vendorId || vendorId === prevVendor.current) return;
    prevVendor.current = vendorId;
    setSavedRet(false);
    setLoading(true);
    fetchRetenciónContextAction(vendorId, fechaEmision || new Date().toISOString().slice(0, 10))
      .then(setCtx)
      .finally(() => setLoading(false));
  }, [vendorId, fechaEmision]);

  useEffect(() => {
    if (!supplierInvoiceId || supplierInvoiceId === prevInvoiceId.current) return;
    if (!resultRef.current) return;
    prevInvoiceId.current = supplierInvoiceId;
    const r = resultRef.current;
    startSaveRet(async () => {
      await saveRetenciónAction(supplierInvoiceId, r, fechaEmision);
      setSavedRet(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierInvoiceId]);

  function handleSaveConcepto(c: Concepto) {
    if (!ctx) return;
    startSaveConc(async () => {
      const res = await saveVendorConceptoGananciasAction(vendorId, c);
      if (res.ok)
        setCtx((prev) => prev ? { ...prev, vendor: { ...prev.vendor, concepto_ganancias: c } } : prev);
    });
  }

  if (loading) {
    return (
      <div className="card p-4 flex items-center gap-2 text-xs text-fg-muted">
        <Icon name="refresh" size={13} className="animate-spin text-fg-brand" />
        Cargando asistente fiscal…
      </div>
    );
  }
  if (!ctx) return null;

  const concepEfectivo: Concepto | null = ctx.vendor.concepto_ganancias;

  if (!concepEfectivo) {
    return (
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Icon name="calculator" size={14} className="text-fg-brand" />
          <span className="text-xs font-bold text-fg-primary">Asistente Fiscal · Ganancias</span>
        </div>
        <ConceptoSetup
          vendorName={ctx.vendor.razon || "Proveedor"}
          onSave={handleSaveConcepto}
          saving={savingConc}
        />
      </div>
    );
  }

  const result: RetenciónResult = calculateIncomeTaxRetention({
    tipoComprobante,
    concepto:         concepEfectivo,
    netoGravado,
    acumuladoPrevio:  ctx.acumuladoPrevio,
    totalFactura,
    exentoProveedor:  ctx.vendor.exento_ganancias,
    config:           ctx.config,
    escala:           ctx.escala,
    normativaVersion: ctx.normativaVersion,
  });
  resultRef.current = result;

  const alertas       = buildAlertas(ctx, tipoComprobante, fechaEmision, result);
  const semColor      = computeSemaforo(result, alertas, ctx, fechaEmision);
  const sem           = SEMAFORO[semColor];
  const esAutomatico  = result.confianza === "automatico" && alertas.filter((a) => a.type !== "info").length === 0;

  return (
    <>
      {showNormativa && (
        <NormativaModal
          normativaVersion={ctx.normativaVersion}
          config={ctx.config}
          escala={ctx.escala}
          onClose={() => setShowNormativa(false)}
        />
      )}

      <div className="card overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stroke-soft bg-bg-surface">
          <Icon name="calculator" size={13} className="text-fg-brand" />
          <span className="text-xs font-bold text-fg-primary tracking-wide">Asistente Fiscal · Ganancias</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[10px] text-fg-muted">{CONCEPTO_LABEL[concepEfectivo]}</span>
            <button
              type="button"
              className="text-[10px] text-fg-brand hover:underline"
              onClick={() =>
                setCtx((prev) =>
                  prev ? { ...prev, vendor: { ...prev.vendor, concepto_ganancias: null } } : prev
                )
              }
            >
              cambiar
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Semáforo principal */}
          <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${sem.bgBorder}`}>
            <Icon name={sem.iconName} size={18} className={`flex-shrink-0 mt-0.5 ${sem.textColor}`} />
            <div className="flex-1 min-w-0">
              <div className={`text-xs font-bold tracking-wide ${sem.textColor}`}>
                {sem.emoji} {sem.titulo}
              </div>
              <p className="text-[11px] text-fg-secondary mt-1 leading-snug">
                {result.resumenEjecutivo}
              </p>
            </div>
            {result.retencion > 0 && (
              <div className="text-right flex-shrink-0 pl-2 border-l border-stroke-soft/60">
                <div className="text-[10px] text-fg-muted font-medium uppercase tracking-wide">Retención</div>
                <div className={`text-base font-bold font-mono tabular-nums ${sem.textColor}`}>
                  {fmtCurrency(result.retencion)}
                </div>
                <div className="text-[10px] text-fg-muted">Neto: {fmtCurrency(result.netoPagar)}</div>
              </div>
            )}
          </div>

          {/* Nivel de confianza */}
          <div className={`flex items-center gap-1.5 text-[11px] ${esAutomatico ? "text-status-success" : "text-status-warning"}`}>
            <Icon name={esAutomatico ? "check-circle" : "bolt"} size={11} />
            {esAutomatico
              ? "Resultado calculado automáticamente."
              : "Requiere validación contable antes de procesar el pago."}
          </div>

          {/* Acumulado mensual */}
          {ctx.acumuladoPrevio > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              <Icon name="report" size={11} />
              Acumulado previo del mes:{" "}
              <strong className="text-fg-secondary tabular-nums">{fmtCurrency(ctx.acumuladoPrevio)}</strong>
            </div>
          )}

          {/* Alertas */}
          {alertas.length > 0 && (
            <div className="space-y-1.5">
              {alertas.map((a, i) => (<Alert key={i} type={a.type}>{a.msg}</Alert>))}
            </div>
          )}

          {/* Detalle expandible */}
          {netoGravado > 0 && (
            <>
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11px] text-fg-muted hover:text-fg-secondary transition-colors w-full"
                onClick={() => setExpanded((v) => !v)}
              >
                <Icon
                  name="chevron-down"
                  size={12}
                  className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                />
                {expanded ? "Ocultar detalle del cálculo" : "Ver detalle paso a paso"}
              </button>

              {expanded && (
                <div className="rounded-lg border border-stroke-soft p-3 space-y-0">
                  <CalcLine label="Neto gravado (esta factura)"        value={fmtCurrency(result.netoGravado)} />
                  <CalcLine label="Acumulado pagado en el mes"         value={fmtCurrency(result.acumuladoPrevio)} />
                  <CalcLine label="Total acumulado"                    value={fmtCurrency(result.acumuladoTotal)} big />
                  {result.minimo > 0 && (
                    <CalcLine label="(−) Mínimo no sujeto"            value={fmtCurrency(result.minimo)} />
                  )}
                  {result.baseImponible > 0 && (
                    <CalcLine label="Base imponible"                   value={fmtCurrency(result.baseImponible)} big />
                  )}
                  {result.corresponde && result.metodo === "escala" && (
                    <>
                      <CalcLine label="Tramo aplicado"                value={result.tramoTxt} sub />
                      <CalcLine label="Importe fijo del tramo"        value={fmtCurrency(result.fijo)} sub />
                      <CalcLine label="Excedente del límite inferior" value={fmtCurrency(result.excedente)} sub />
                      <CalcLine label="% s/ excedente"                value={`${result.alicuota}%`} sub />
                      <CalcLine label="Monto del porcentaje"          value={fmtCurrency(result.pctMonto)} sub />
                    </>
                  )}
                  {result.corresponde && result.metodo === "lineal" && (
                    <>
                      <CalcLine label="Importe sujeto a retención"    value={fmtCurrency(result.excedente)} />
                      <CalcLine label="Alícuota"                      value={`${result.alicuota}%`} />
                    </>
                  )}
                  {result.retencion > 0 && (
                    <CalcLine label="Retención total"                 value={fmtCurrency(result.retencion)} warn big />
                  )}
                  {result.totalFactura > 0 && (
                    <CalcLine label="Total factura (c/IVA)"           value={fmtCurrency(result.totalFactura)} />
                  )}
                  <CalcLine label="Neto a pagar"                      value={fmtCurrency(result.netoPagar)} highlight />

                  <div className="pt-2 mt-1 border-t border-stroke-soft/40 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-fg-muted">
                      Normativa vigente desde: <strong>{ctx.normativaVersion || "—"}</strong>
                    </span>
                    <span className="text-[10px] text-fg-muted">
                      {result.metodo === "escala"
                        ? "Escala progresiva"
                        : result.metodo === "lineal"
                        ? "Alícuota fija"
                        : "Excluido"}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Botón "Ver normativa" */}
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] text-fg-muted hover:text-fg-secondary transition-colors"
            onClick={() => setShowNormativa(true)}
          >
            <Icon name="file-pdf" size={11} />
            Ver normativa aplicada · vigente desde {ctx.normativaVersion || "—"}
          </button>

          {/* Estado de persistencia */}
          {savingRet && (
            <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              <Icon name="refresh" size={11} className="animate-spin" /> Registrando retención…
            </div>
          )}
          {savedRet && !savingRet && (
            <div className="flex items-center gap-1.5 text-[11px] text-status-success">
              <Icon name="check-circle" size={11} /> Retención registrada con trazabilidad completa.
            </div>
          )}

          <p className="text-[10px] text-fg-muted leading-relaxed">
            ⚠️ Orientativo. Las retenciones definitivas deben validarse con el estudio contable.
          </p>
        </div>
      </div>
    </>
  );
}

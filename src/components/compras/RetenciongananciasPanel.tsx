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
  type RetenciónResult,
} from "@/lib/compras/retencion-ganancias";
import {
  fetchRetenciónContextAction,
  saveRetenciónAction,
  saveVendorConceptoGananciasAction,
  type RetenciónContext,
} from "@/app/(app)/compras/facturas/nueva/retencion-actions";

// ─── Props ────────────────────────────────────────────────────

interface Props {
  tipoComprobante:    string;
  netoGravado:        number;
  totalFactura:       number;
  vendorId:           string;
  fechaEmision:       string;
  supplierInvoiceId?: string;
}

// ─── Sub-componentes ──────────────────────────────────────────

function CalcLine({
  label, value, sub = false, big = false, warn = false, highlight = false,
}: {
  label: string; value: string;
  sub?: boolean; big?: boolean; warn?: boolean; highlight?: boolean;
}) {
  return (
    <div className={[
      "flex justify-between items-baseline gap-3 py-1.5",
      "border-b border-stroke-soft/40 last:border-0 text-xs",
      sub       ? "pl-3"                     : "",
      highlight ? "-mx-3 px-3 bg-fg-brand/8 rounded" : "",
    ].join(" ")}>
      <span className={[
        sub       ? "text-fg-muted"    :
        big       ? "font-semibold text-fg-primary" :
                    "text-fg-secondary",
      ].join(" ")}>
        {label}
      </span>
      <span className={[
        "font-mono tabular-nums font-semibold",
        warn      ? "text-status-warning" :
        highlight ? "text-fg-brand font-bold" :
        big       ? "text-fg-primary"     :
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

// ─── Alertas ──────────────────────────────────────────────────

interface AlertItem { type: "warn" | "info" | "danger"; msg: string }

function buildAlertas(
  ctx: RetenciónContext,
  tipoComprobante: string,
  fecha: string,
  result: RetenciónResult,
): AlertItem[] {
  const items: AlertItem[] = [];

  // Monotributista detectado por condición IVA o tipo de comprobante
  const esMonotributista =
    tipoComprobante === "FACTURA_C" ||
    ctx.vendor.cond_iva?.toLowerCase() === "monotributista";
  if (esMonotributista)
    items.push({ type: "info", msg: "Proveedor Monotributista (Factura C). No corresponde retención de Ganancias." });

  // Proveedor exento
  if (ctx.vendor.exento_ganancias)
    items.push({ type: "info", msg: "Proveedor exento de retención de Ganancias por resolución individual." });

  // Certificado de exclusión
  if (ctx.vendor.cert_exclusion_hasta) {
    const vigencia = new Date(ctx.vendor.cert_exclusion_hasta);
    const hoy      = new Date(fecha || new Date().toISOString().slice(0, 10));
    if (vigencia >= hoy) {
      const fmtFecha = vigencia.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
      items.push({ type: "warn", msg: `Certificado de Exclusión de Retención vigente hasta el ${fmtFecha}. Verificar antes de practicar retención.` });
    } else {
      const fmtFecha = vigencia.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      items.push({ type: "info", msg: `Certificado de Exclusión vencido el ${fmtFecha}. Corresponde retención normal.` });
    }
  }

  // Ya existe retención en el mes
  if (ctx.retenciónExistente && result.corresponde)
    items.push({ type: "warn", msg: "Ya se registró una retención a este proveedor en el mismo período. Verificar acumulado." });

  // Acumulado > 0 pero igual no retiene (cerca del mínimo)
  if (!result.corresponde && ctx.acumuladoPrevio > 0 && result.minimo > 0) {
    const pct = Math.round((result.acumuladoTotal / result.minimo) * 100);
    if (pct >= 70)
      items.push({ type: "info", msg: `Acumulado mensual al ${pct}% del mínimo no sujeto (${fmtCurrency(result.minimo)}). Una próxima factura podría generar retención.` });
  }

  return items;
}

// ─── Concepto selector inline ─────────────────────────────────

function ConceptoSetup({
  vendorName,
  onSave,
  saving,
}: {
  vendorName: string;
  onSave: (c: Concepto) => void;
  saving: boolean;
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
            {CONCEPTOS_GRAVADOS.map((c) => (
              <option key={c} value={c}>{CONCEPTO_LABEL[c]}</option>
            ))}
          </optgroup>
          <optgroup label="Conceptos excluidos">
            {CONCEPTOS_EXCLUIDOS_AUTOMATICO.map((c) => (
              <option key={c} value={c}>{CONCEPTO_LABEL[c]}</option>
            ))}
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

// ─── Panel principal ──────────────────────────────────────────

export function RetenciongananciasPanel({ tipoComprobante, netoGravado, totalFactura, vendorId, fechaEmision, supplierInvoiceId }: Props) {
  const [ctx, setCtx]               = useState<RetenciónContext | null>(null);
  const [loading, setLoading]       = useState(false);
  const [expanded, setExpanded]     = useState(false);
  const [savingConc, startSaveConc] = useTransition();
  const [savingRet,  startSaveRet]  = useTransition();
  const [savedRet,   setSavedRet]   = useState(false);
  const prevVendor                  = useRef<string>("");
  const prevInvoiceId               = useRef<string | undefined>(undefined);

  // ── Cargar contexto cuando cambia proveedor o fecha ──────
  useEffect(() => {
    if (!vendorId || vendorId === prevVendor.current) return;
    prevVendor.current = vendorId;
    setSavedRet(false);
    setLoading(true);
    fetchRetenciónContextAction(vendorId, fechaEmision || new Date().toISOString().slice(0, 10))
      .then(setCtx)
      .finally(() => setLoading(false));
  }, [vendorId, fechaEmision]);

  // ── Guardar retención al recibir el ID de la factura creada ──
  useEffect(() => {
    if (!supplierInvoiceId || supplierInvoiceId === prevInvoiceId.current) return;
    if (!ctx || !result) return;
    prevInvoiceId.current = supplierInvoiceId;
    startSaveRet(async () => {
      await saveRetenciónAction(supplierInvoiceId, result, fechaEmision);
      setSavedRet(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierInvoiceId]);

  // ── Guardar concepto al proveedor ─────────────────────────
  function handleSaveConcepto(c: Concepto) {
    if (!ctx) return;
    startSaveConc(async () => {
      const res = await saveVendorConceptoGananciasAction(vendorId, c);
      if (res.ok) {
        setCtx((prev) => prev ? { ...prev, vendor: { ...prev.vendor, concepto_ganancias: c } } : prev);
      }
    });
  }

  // ── Loading state ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="card p-4 flex items-center gap-2 text-xs text-fg-muted">
        <Icon name="refresh" size={13} className="animate-spin text-fg-brand" />
        Cargando asistente fiscal…
      </div>
    );
  }

  if (!ctx) return null;

  // ── Sin concepto configurado → setup inline ───────────────
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

  // ── Calcular resultado ────────────────────────────────────
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

  const alertas = buildAlertas(ctx, tipoComprobante, fechaEmision, result);

  const isWarn = result.estado === "warn";
  const statusBg  = isWarn
    ? "bg-status-warning/10 border-status-warning/30"
    : "bg-status-success/10 border-status-success/30";
  const statusText = isWarn ? "text-status-warning" : "text-status-success";
  const statusIcon = isWarn ? "bolt" : "check-circle";
  const statusTxt  = isWarn ? "Corresponde retención" : "No corresponde retención";

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stroke-soft bg-bg-surface">
        <Icon name="calculator" size={13} className="text-fg-brand" />
        <span className="text-xs font-bold text-fg-primary tracking-wide">Asistente Fiscal · Ganancias</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-fg-muted">
            {CONCEPTO_LABEL[concepEfectivo]}
          </span>
          <button
            type="button"
            className="text-[10px] text-fg-brand hover:underline"
            title="Cambiar concepto de este proveedor"
            onClick={() => setCtx((prev) => prev ? { ...prev, vendor: { ...prev.vendor, concepto_ganancias: null } } : prev)}
          >
            cambiar
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Status banner */}
        <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${statusBg}`}>
          <Icon name={statusIcon} size={16} className={`flex-shrink-0 ${statusText}`} />
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold tracking-wide ${statusText}`}>{statusTxt}</div>
            <div className="text-[11px] text-fg-muted mt-0.5 leading-snug line-clamp-2">{result.motivo}</div>
          </div>
          {result.retencion > 0 && (
            <div className="text-right flex-shrink-0 pl-2 border-l border-stroke-soft/60">
              <div className="text-[10px] text-fg-muted font-medium uppercase tracking-wide">Retención</div>
              <div className={`text-base font-bold font-mono tabular-nums ${statusText}`}>
                {fmtCurrency(result.retencion)}
              </div>
              <div className="text-[10px] text-fg-muted">
                Neto: {fmtCurrency(result.netoPagar)}
              </div>
            </div>
          )}
        </div>

        {/* Acumulado rápido (siempre visible si hay previo) */}
        {ctx.acumuladoPrevio > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            <Icon name="report" size={11} />
            Acumulado previo este mes: <strong className="text-fg-secondary tabular-nums">{fmtCurrency(ctx.acumuladoPrevio)}</strong>
          </div>
        )}

        {/* Alertas */}
        {alertas.length > 0 && (
          <div className="space-y-1.5">
            {alertas.map((a, i) => (
              <Alert key={i} type={a.type}>{a.msg}</Alert>
            ))}
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
                <CalcLine label="Neto gravado (esta factura)"      value={fmtCurrency(result.netoGravado)} />
                <CalcLine label="Acumulado pagado en el mes"       value={fmtCurrency(result.acumuladoPrevio)} />
                <CalcLine label="Total acumulado"                  value={fmtCurrency(result.acumuladoTotal)} big />
                {result.minimo > 0 && (
                  <CalcLine label="(−) Mínimo no sujeto"          value={fmtCurrency(result.minimo)} />
                )}
                {result.baseImponible > 0 && (
                  <CalcLine label="Base imponible"                 value={fmtCurrency(result.baseImponible)} big />
                )}
                {result.corresponde && result.metodo === "escala" && (
                  <>
                    <CalcLine label="Tramo aplicado"               value={result.tramoTxt} sub />
                    <CalcLine label="Importe fijo del tramo"       value={fmtCurrency(result.fijo)}      sub />
                    <CalcLine label="Excedente del límite inferior" value={fmtCurrency(result.excedente)} sub />
                    <CalcLine label={`% s/ excedente`}             value={`${result.alicuota}%`}          sub />
                    <CalcLine label="Monto del porcentaje"         value={fmtCurrency(result.pctMonto)}  sub />
                  </>
                )}
                {result.corresponde && result.metodo === "lineal" && (
                  <>
                    <CalcLine label="Importe sujeto a retención"   value={fmtCurrency(result.excedente)} />
                    <CalcLine label="Alícuota"                     value={`${result.alicuota}%`} />
                  </>
                )}
                {result.retencion > 0 && (
                  <CalcLine label="Retención total"                value={fmtCurrency(result.retencion)} warn big />
                )}
                {result.totalFactura > 0 && (
                  <CalcLine label="Total factura (c/IVA)"          value={fmtCurrency(result.totalFactura)} />
                )}
                <CalcLine label="Neto a pagar"                     value={fmtCurrency(result.netoPagar)} highlight />

                {/* Footer de auditoría */}
                <div className="pt-2 mt-1 border-t border-stroke-soft/40 flex items-center justify-between">
                  <span className="text-[10px] text-fg-muted">
                    Normativa vigente desde:{" "}
                    <strong>{ctx.normativaVersion || "—"}</strong>
                  </span>
                  <span className="text-[10px] text-fg-muted">
                    {result.metodo === "escala" ? "Escala progresiva" : result.metodo === "lineal" ? "Alícuota fija" : "Excluido"}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

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
  );
}

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { fmtDate } from "@/lib/utils";
import { montoEnLetras } from "@/lib/invoicing/calc";
import {
  COMPROBANTE_LABEL,
  COMPROBANTE_LETRA,
  type CustomerInvoice,
  type FiscalConfig,
} from "@/lib/invoicing/types";
import { fmtCuit } from "@/lib/compras/format";
import { registerDocFonts } from "@/lib/doc-system/fonts";
import { DOC, FONT } from "@/lib/doc-system/tokens";
import {
  DocFooter,
  DocHeader,
  DocStatusStamp,
  Field,
  SectionTitle,
  TotalBlock,
  ValidationBlock,
  WarnBox,
  docPage,
} from "@/lib/doc-system/pdf/components";

/**
 * PDF fiscal — design system institucional navy/rojo del doc-system
 * (referencia de Dirección REF-NC, 2026-07-28). SOLO capa visual: datos,
 * cálculos, QR RG 4892, CAE y lógica de negocio intactos (mismos props que
 * la versión anterior "Command Center").
 */

registerDocFonts();

const styles = StyleSheet.create({
  grid: { flexDirection: "row", borderWidth: 0.75, borderColor: DOC.rule, marginTop: 8 },
  gridCell: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRightWidth: 0.75,
    borderRightColor: DOC.rule,
  },
  gridCellLast: { borderRightWidth: 0 },
  twoCols: { flexDirection: "row", gap: 18 },
  col: { flex: 1 },
  partyLine: { fontSize: 8.5, color: DOC.textSec, marginBottom: 4 },

  thRow: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: DOC.navy,
    paddingBottom: 3,
    marginTop: 8,
  },
  th: {
    color: DOC.label,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: DOC.rule,
  },
  cellDesc: { flex: 1, paddingRight: 6 },
  descLabel: { fontSize: 9, fontWeight: 700, color: DOC.ink },
  cellQty: { width: 40, textAlign: "right", fontFamily: FONT.mono, fontSize: 8.5 },
  cellUnit: { width: 78, textAlign: "right", fontFamily: FONT.mono, fontSize: 8.5 },
  cellIva: { width: 40, textAlign: "center", color: DOC.textSec, fontFamily: FONT.mono, fontSize: 8 },
  cellSubtotal: {
    width: 84,
    textAlign: "right",
    fontFamily: FONT.mono,
    fontSize: 8.5,
    fontWeight: 600,
    color: DOC.navy,
  },
  negative: { color: DOC.red },

  observText: { fontSize: 8, color: DOC.textSec, lineHeight: 1.5, marginTop: 6 },
  letrasText: { fontSize: 8.5, color: DOC.ink, lineHeight: 1.4 },

  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: DOC.rule,
  },
  sumLabel: { fontSize: 8.5, color: DOC.textSec },
  sumValue: { fontSize: 8.5, fontFamily: FONT.mono, color: DOC.ink },
});

interface Props {
  invoice: CustomerInvoice;
  config: FiscalConfig;
  qrDataUrl: string;
}

function fmtNroComprobante(pv: number, nro: number | null): string {
  return `${String(pv).padStart(5, "0")}-${String(nro ?? 0).padStart(8, "0")}`;
}

/** $1.234.567,89 — total con símbolo (es-AR), solo presentación. */
function money(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(n)
    .replace(/\s/g, "");
}

/** 1.234.567,89 — importe sin símbolo para tabla y resumen (es-AR). */
function num(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

const COND_IVA_LABEL: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "IVA Responsable Inscripto",
  MONOTRIBUTO: "Responsable Monotributo",
  EXENTO: "IVA Sujeto Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
  NO_RESPONSABLE: "IVA No Responsable",
  NO_CATEGORIZADO: "IVA No Categorizado",
};

/** Prefijo de trazabilidad: FACTURA_A → FA · NOTA_CREDITO_A → NCA · etc. */
function docPrefix(tipo: CustomerInvoice["tipo_comprobante"]): string {
  const parts = tipo.split("_");
  const letra = parts.pop() ?? "";
  return parts.map((p) => p[0]).join("") + letra;
}

/** Título de banda: "FACTURA" · "NOTA DE\nCRÉDITO" · "NOTA DE\nDÉBITO". */
function docTitle(tipo: CustomerInvoice["tipo_comprobante"]): string {
  if (tipo.startsWith("NOTA_CREDITO")) return "NOTA DE\nCRÉDITO";
  if (tipo.startsWith("NOTA_DEBITO")) return "NOTA DE\nDÉBITO";
  return "FACTURA";
}

export function InvoicePdfDocument({ invoice, config, qrDataUrl }: Props) {
  const letra = COMPROBANTE_LETRA[invoice.tipo_comprobante];
  const label = COMPROBANTE_LABEL[invoice.tipo_comprobante];
  const items = invoice.items ?? [];
  const isSandbox = invoice.ambiente !== "PRODUCCION";
  const nro = fmtNroComprobante(invoice.punto_venta, invoice.numero_comprobante);
  const alicuotas = Array.from(new Set(items.map((i) => Number(i.alicuota_iva))));
  const ivaLabel = alicuotas.length === 1 ? `IVA ${alicuotas[0]}%` : "IVA";
  const enLetras = montoEnLetras(invoice.total);
  const enLetrasSentence = enLetras.charAt(0) + enLetras.slice(1).toLowerCase();
  const monedaNote =
    invoice.moneda === "PES" || invoice.moneda === "ARS"
      ? "PESOS ARGENTINOS"
      : invoice.moneda;
  const sandboxBanner = `COMPROBANTE EMITIDO EN AMBIENTE ${invoice.ambiente} · SIN VALIDEZ FISCAL`;

  return (
    <Document
      title={`${label} ${nro}`}
      author={config.razon_social}
      subject="Comprobante electrónico ARCA"
    >
      <Page size="A4" style={docPage.page}>
        <DocHeader
          context="COMPROBANTE ORIGINAL"
          title={docTitle(invoice.tipo_comprobante)}
          badge={letra}
          badgeSub={`CÓD ${String(invoice.cbte_tipo_arca).padStart(2, "0")}`}
          docNumber={`N.° ${nro}`}
        />
        {invoice.anulada ? (
          <DocStatusStamp
            label="COMPROBANTE ANULADO"
            note="SIN EFECTO FISCAL · NO UTILIZAR"
          />
        ) : null}

        <View style={docPage.body}>
          {/* 01 · Datos del comprobante */}
          <SectionTitle num={1} title="Datos del comprobante" />
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <Field label="Fecha de emisión" value={fmtDate(invoice.created_at)} mono />
            </View>
            <View style={styles.gridCell}>
              <Field
                label="Vencimiento"
                value={invoice.fch_vto_pago ? fmtDate(invoice.fch_vto_pago) : null}
                mono
              />
            </View>
            <View style={styles.gridCell}>
              <Field label="Período facturado" value={invoice.periodo} mono />
            </View>
            <View style={[styles.gridCell, styles.gridCellLast]}>
              <Field label="Moneda" value={invoice.moneda === "PES" ? "ARS" : invoice.moneda} />
            </View>
          </View>

          {/* 02 · Emisor / 03 · Facturado a */}
          <View style={styles.twoCols}>
            <View style={styles.col}>
              <SectionTitle num={2} title="Emisor" />
              <View style={{ marginTop: 8 }}>
                <Text
                  style={{ fontSize: 10.5, fontWeight: 800, color: DOC.navy, marginBottom: 3 }}
                >
                  {config.razon_social}
                </Text>
                <Text style={styles.partyLine}>
                  {config.nombre_fantasia ?? "Logística TOPS"} ·{" "}
                  {COND_IVA_LABEL[config.condicion_iva]}
                </Text>
                {config.domicilio_comercial ? (
                  <Text style={styles.partyLine}>
                    {config.domicilio_comercial}
                    {config.localidad ? `\n${config.localidad}` : ""}
                  </Text>
                ) : null}
                <View style={styles.twoCols}>
                  <Field label="CUIT" value={fmtCuit(config.cuit)} mono />
                  {config.ingresos_brutos ? (
                    <Field label="Ingresos brutos" value={config.ingresos_brutos} mono />
                  ) : null}
                </View>
              </View>
            </View>
            <View style={styles.col}>
              <SectionTitle num={3} title="Facturado a" />
              <View style={{ marginTop: 8 }}>
                <Text
                  style={{ fontSize: 10.5, fontWeight: 800, color: DOC.navy, marginBottom: 3 }}
                >
                  {invoice.razon_social}
                </Text>
                <Text style={styles.partyLine}>{COND_IVA_LABEL[invoice.condicion_iva]}</Text>
                {invoice.domicilio_cliente ? (
                  <Text style={styles.partyLine}>{invoice.domicilio_cliente}</Text>
                ) : null}
                <Field label="CUIT" value={fmtCuit(invoice.cuit_cliente)} mono />
              </View>
            </View>
          </View>

          {/* 04 · Detalle de servicios */}
          <SectionTitle num={4} title="Detalle de servicios" />
          <View style={styles.thRow}>
            <Text style={[styles.th, { flex: 1 }]}>Descripción</Text>
            <Text style={[styles.th, { width: 40, textAlign: "right" }]}>Cant.</Text>
            <Text style={[styles.th, { width: 78, textAlign: "right" }]}>P. Unitario</Text>
            <Text style={[styles.th, { width: 40, textAlign: "center" }]}>IVA</Text>
            <Text style={[styles.th, { width: 84, textAlign: "right" }]}>Subtotal</Text>
          </View>
          {items.map((it, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <View style={styles.cellDesc}>
                <Text style={styles.descLabel}>{it.descripcion}</Text>
              </View>
              <Text style={styles.cellQty}>{it.cantidad}</Text>
              <Text
                style={[styles.cellUnit, ...(it.precio_unitario < 0 ? [styles.negative] : [])]}
              >
                {num(it.precio_unitario)}
              </Text>
              <Text style={styles.cellIva}>{it.alicuota_iva}%</Text>
              <Text
                style={[styles.cellSubtotal, ...(it.importe_neto < 0 ? [styles.negative] : [])]}
              >
                {num(it.importe_neto)}
              </Text>
            </View>
          ))}

          {/* 05 · Observaciones y pago / 06 · Resumen */}
          <View style={styles.twoCols} wrap={false}>
            <View style={styles.col}>
              <SectionTitle num={5} title="Observaciones y pago" />
              {invoice.observ ? <Text style={styles.observText}>{invoice.observ}</Text> : null}
              {invoice.fch_serv_desde && invoice.fch_serv_hasta ? (
                <Text style={styles.observText}>
                  Servicio prestado {fmtDate(invoice.fch_serv_desde)} →{" "}
                  {fmtDate(invoice.fch_serv_hasta)}.
                </Text>
              ) : null}
              <View style={{ marginTop: 8 }}>
                <Field label="Importe en letras">
                  <Text style={styles.letrasText}>{enLetrasSentence}.</Text>
                </Field>
                <View style={[styles.twoCols, { marginTop: 4 }]}>
                  <View style={styles.col}>
                    <Field
                      label="Documento"
                      value={`DOC-${docPrefix(invoice.tipo_comprobante)}-${nro}`}
                      mono
                    />
                  </View>
                  <View style={styles.col}>
                    <Field
                      label="Envío de comprobantes"
                      value="administracion@logisticatops.com"
                    />
                  </View>
                </View>
              </View>
            </View>
            <View style={styles.col}>
              <SectionTitle num={6} title="Resumen" />
              <View style={{ marginTop: 6 }}>
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>Neto gravado</Text>
                  <Text style={styles.sumValue}>{num(invoice.subtotal)}</Text>
                </View>
                {invoice.importe_no_gravado > 0 && (
                  <View style={styles.sumRow}>
                    <Text style={styles.sumLabel}>No gravado</Text>
                    <Text style={styles.sumValue}>{num(invoice.importe_no_gravado)}</Text>
                  </View>
                )}
                {invoice.importe_exento > 0 && (
                  <View style={styles.sumRow}>
                    <Text style={styles.sumLabel}>Exento</Text>
                    <Text style={styles.sumValue}>{num(invoice.importe_exento)}</Text>
                  </View>
                )}
                {invoice.percepciones > 0 && (
                  <View style={styles.sumRow}>
                    <Text style={styles.sumLabel}>Percepciones</Text>
                    <Text style={styles.sumValue}>{num(invoice.percepciones)}</Text>
                  </View>
                )}
                {invoice.tributos > 0 && (
                  <View style={styles.sumRow}>
                    <Text style={styles.sumLabel}>Otros tributos</Text>
                    <Text style={styles.sumValue}>{num(invoice.tributos)}</Text>
                  </View>
                )}
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>{ivaLabel}</Text>
                  <Text style={styles.sumValue}>{num(invoice.iva)}</Text>
                </View>
                <TotalBlock amount={money(invoice.total)} note={monedaNote} />
              </View>
            </View>
          </View>

          {/* 07 · Validación fiscal */}
          <View wrap={false}>
            <SectionTitle num={7} title="Validación fiscal" />
            <ValidationBlock qrDataUrl={qrDataUrl || null} qrCaption="QR AFIP">
              <View style={{ flexDirection: "row", gap: 14 }}>
                <View style={{ width: 168 }}>
                  <View style={styles.twoCols}>
                    <Field label="CAE N.°" value={invoice.cae} mono />
                    <Field
                      label="Vto. del CAE"
                      value={
                        invoice.fecha_vencimiento_cae
                          ? fmtDate(invoice.fecha_vencimiento_cae)
                          : null
                      }
                      mono
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  {isSandbox ? (
                    <WarnBox title={sandboxBanner} text={config.pie_legal ?? ""} />
                  ) : config.pie_legal ? (
                    <WarnBox title="Condiciones" text={config.pie_legal} />
                  ) : null}
                </View>
              </View>
            </ValidationBlock>
          </View>
        </View>

        <DocFooter
          docLine={`${label} · ${nro} · Emitido por Nexus`}
          extra={isSandbox ? `${invoice.ambiente} · SIN VALIDEZ FISCAL` : undefined}
        />
      </Page>
    </Document>
  );
}

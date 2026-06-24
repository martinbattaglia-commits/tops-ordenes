import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
  Svg,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Rect,
  Line,
  Circle,
} from "@react-pdf/renderer";
import { fmtDate } from "@/lib/utils";
import { montoEnLetras } from "@/lib/invoicing/calc";
import {
  COMPROBANTE_LABEL,
  COMPROBANTE_LETRA,
  type CustomerInvoice,
  type FiscalConfig,
} from "@/lib/invoicing/types";
import {
  INTER_REGULAR,
  INTER_SEMIBOLD,
  INTER_BOLD,
  INTER_EXTRABOLD,
  JBMONO_REGULAR,
  JBMONO_SEMIBOLD,
  JBMONO_BOLD,
} from "./assets/invoice-fonts";
import { LOGO_TOPS_VERTICAL, LOGO_CONNECT_NEXUS } from "./assets/invoice-logos";

/**
 * PDF fiscal — diseño institucional "Command Center · Alta legibilidad"
 * (handoff de diseño aprobado, 2026-06-12). SOLO capa visual: datos, cálculos,
 * QR RG 4892, CAE y lógica de negocio intactos (mismos props que la versión
 * anterior). Tokens y medidas según README del paquete de diseño, escalados
 * de 880px → A4 (595pt, factor ≈0.676).
 */

Font.register({
  family: "Inter",
  fonts: [
    { src: INTER_REGULAR, fontWeight: 400 },
    { src: INTER_SEMIBOLD, fontWeight: 600 },
    { src: INTER_BOLD, fontWeight: 700 },
    { src: INTER_EXTRABOLD, fontWeight: 800 },
  ],
});
Font.register({
  family: "JetBrains Mono",
  fonts: [
    { src: JBMONO_REGULAR, fontWeight: 400 },
    { src: JBMONO_SEMIBOLD, fontWeight: 600 },
    { src: JBMONO_BOLD, fontWeight: 700 },
  ],
});
// Sin partición de palabras en valores monetarios / IDs.
Font.registerHyphenationCallback((word) => [word]);

// ---- Tokens del design system (README §Design Tokens) ---------------------
const C = {
  navyCanvas: "#0a0f1e",
  navySeal0: "#040555",
  navySeal1: "#0a1238",
  darkCell: "#0d1426",
  ink: "#0a1238",
  red: "#ef4444",
  blueDeep: "#1f33c8",
  blueMid: "#3e62f4",
  blueLight: "#6188fc",
  cyan: "#06b6d4",
  cyanText: "#22d3ee",
  cyanDark: "#0e7490",
  emerald: "#10b981",
  emeraldText: "#34d399",
  amberText: "#fbbf24",
  slate600: "#475569",
  slate500: "#64748b",
  slate700: "#334155",
  muted: "#94a3b8",
  hairline: "#e2e8f0",
  hairlineSoft: "#f1f5f9",
  white95: "rgba(255,255,255,0.95)",
  white96: "rgba(255,255,255,0.96)",
  white93: "rgba(255,255,255,0.93)",
  white92: "rgba(255,255,255,0.92)",
  label95: "rgba(203,213,225,0.95)",
  label92: "rgba(203,213,225,0.92)",
};

const RAIL_W = 43; // 64px
const FOOTER_H = 52; // banda inferior fija
const PAD_X = 27; // 40px

const styles = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 9,
    color: C.ink,
    backgroundColor: "#ffffff",
    paddingLeft: RAIL_W,
    paddingBottom: FOOTER_H + 14,
  },
  mono: { fontFamily: "JetBrains Mono" },

  // ---- Rail lateral (fijo en todas las páginas) ----
  rail: {
    position: "absolute",
    left: 0,
    top: 0,
    width: RAIL_W,
    height: "100%",
  },
  railText: {
    position: "absolute",
    left: -130,
    top: 415,
    width: 303,
    textAlign: "center",
    transform: "rotate(-90deg)",
    fontSize: 7.4,
    fontWeight: 700,
    letterSpacing: 2.5,
    color: C.white92,
  },

  // ---- Header (banda oscura) ----
  header: { position: "relative", backgroundColor: C.navyCanvas, padding: `20 ${PAD_X}` },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
  },
  eyebrow: {
    fontSize: 8.1,
    fontWeight: 700,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: C.red,
    marginBottom: 5.5,
  },
  title: { fontSize: 20.3, fontWeight: 800, color: "#ffffff", letterSpacing: -0.4 },
  titleLetra: { color: C.blueLight },
  nroMono: {
    fontFamily: "JetBrains Mono",
    fontSize: 9.5,
    color: C.white95,
    marginTop: 5.5,
  },
  logosWrap: { flexDirection: "row", alignItems: "center", gap: 11 },
  logoTops: { width: 39, height: 39, borderRadius: 8 },
  logoConnect: { width: 48, height: 39, borderRadius: 8 },
  chips: { flexDirection: "column", gap: 5.5, alignItems: "flex-end" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4.7,
    paddingVertical: 3.4,
    paddingHorizontal: 7.4,
    borderRadius: 4,
    borderWidth: 0.8,
  },
  chipText: { fontSize: 6.8, fontWeight: 700, letterSpacing: 0.7 },
  chipDot: { width: 4, height: 4, borderRadius: 2 },

  dateBar: {
    flexDirection: "row",
    marginTop: 16,
    borderRadius: 6,
    borderWidth: 0.8,
    // rgba(148,163,184,0.14) sobre #0a0f1e (react-pdf no soporta alpha en bordes)
    borderColor: "#252e44",
    overflow: "hidden",
  },
  dateCell: {
    flex: 1,
    backgroundColor: C.darkCell,
    paddingVertical: 8.8,
    paddingHorizontal: 10.8,
  },
  dateCellSep: { borderLeftWidth: 0.8, borderLeftColor: "#252e44" },
  dateLabel: {
    fontSize: 6.4,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: C.label95,
    marginBottom: 2.7,
  },
  dateValue: { fontFamily: "JetBrains Mono", fontSize: 9.5, fontWeight: 600, color: "#ffffff" },

  // ---- Body ----
  body: { padding: `20 ${PAD_X}`, gap: 17.6 },

  parties: { flexDirection: "row", gap: 11 },
  card: {
    flex: 1,
    borderWidth: 0.8,
    borderColor: C.hairline,
    borderLeftWidth: 2,
    borderRadius: 6.8,
    paddingVertical: 12,
    paddingHorizontal: 13.5,
  },
  cardLabel: {
    fontSize: 6.8,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6.8,
  },
  cardName: { fontSize: 10.1, fontWeight: 800, color: C.ink, marginBottom: 2 },
  cardDetail: { fontSize: 8.1, color: C.slate500, lineHeight: 1.7 },

  table: { borderWidth: 0.8, borderColor: C.hairline, borderRadius: 6.8, overflow: "hidden" },
  tHead: {
    flexDirection: "row",
    backgroundColor: C.hairlineSoft,
    borderBottomWidth: 0.8,
    borderBottomColor: C.hairline,
  },
  th: {
    fontSize: 7.1,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: C.slate600,
    paddingVertical: 8,
  },
  tRow: { flexDirection: "row", alignItems: "center" },
  tRowBorder: { borderTopWidth: 0.8, borderTopColor: C.hairlineSoft },
  colDesc: { flex: 1, paddingHorizontal: 12 },
  colCant: { width: 43, textAlign: "center", paddingHorizontal: 7 },
  colUnit: { width: 95, textAlign: "right", paddingHorizontal: 11 },
  colIva: { width: 43, textAlign: "center", paddingHorizontal: 7 },
  colImp: { width: 95, textAlign: "right", paddingHorizontal: 12 },
  cellTitle: { fontSize: 9.1, fontWeight: 700, color: C.ink },
  cellMono: { fontFamily: "JetBrains Mono", fontSize: 9.1, color: C.slate700 },
  cellMonoMuted: { fontFamily: "JetBrains Mono", fontSize: 8.4, color: C.muted },
  cellMonoStrong: { fontFamily: "JetBrains Mono", fontSize: 9.1, fontWeight: 700, color: C.ink },

  totals: { flexDirection: "row", gap: 13.5, alignItems: "stretch" },
  letrasCard: {
    flex: 1,
    borderWidth: 0.8,
    borderColor: C.hairline,
    borderRadius: 6.8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  letrasLabel: {
    fontSize: 6.8,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: C.muted,
    marginBottom: 4,
  },
  letrasText: { fontSize: 8.4, fontWeight: 600, color: C.slate700, lineHeight: 1.5 },

  totalBlock: {
    width: 230,
    borderRadius: 8,
    overflow: "hidden",
    paddingVertical: 13.5,
    paddingHorizontal: 16,
    position: "relative",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalRowText: { fontSize: 8.4, color: C.white96 },
  totalRowMono: { fontFamily: "JetBrains Mono", fontSize: 8.4, color: C.white96 },
  totalDivider: {
    borderBottomWidth: 0.8,
    borderBottomColor: "rgba(255,255,255,0.18)",
    marginBottom: 5.5,
    paddingBottom: 4,
  },
  totalFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 2,
  },
  totalLabel: {
    fontSize: 8.1,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#ffffff",
  },
  totalAmount: { fontFamily: "JetBrains Mono", fontSize: 17.6, fontWeight: 700, color: "#ffffff" },

  trace: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13.5,
    paddingTop: 13.5,
    borderTopWidth: 0.8,
    borderTopColor: C.hairlineSoft,
  },
  qrBox: { width: 57, height: 57, borderRadius: 6, backgroundColor: C.navySeal1, padding: 4 },
  qrImg: { width: 49, height: 49, borderRadius: 2 },
  traceBlocks: { flexDirection: "row", gap: 24, flexWrap: "wrap", flex: 1 },
  traceLabel: {
    fontSize: 6.4,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: C.muted,
    marginBottom: 2.7,
  },
  traceValue: { fontFamily: "JetBrains Mono", fontSize: 10.1, fontWeight: 700, color: C.ink },
  traceValueSm: { fontFamily: "JetBrains Mono", fontSize: 8.4, color: C.slate700 },
  traceSub: { fontSize: 7.8, color: C.muted, marginTop: 2 },

  pieLegal: { fontSize: 6.8, color: C.muted, lineHeight: 1.5 },

  // ---- Footer (banda oscura, fija) ----
  footer: {
    position: "absolute",
    left: RAIL_W,
    right: 0,
    bottom: 0,
    height: FOOTER_H,
    backgroundColor: C.navyCanvas,
    paddingVertical: 13.5,
    paddingHorizontal: PAD_X,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
  },
  footerLeft: { fontSize: 7.8, color: C.white93, lineHeight: 1.7 },
  footerRight: { fontSize: 6.8, color: C.label92, textAlign: "right", letterSpacing: 0.3 },
});

interface Props {
  invoice: CustomerInvoice;
  config: FiscalConfig;
  qrDataUrl: string;
}

function fmtNroComprobante(pv: number, nro: number | null): string {
  return `${String(pv).padStart(5, "0")}-${String(nro ?? 0).padStart(8, "0")}`;
}

/** $1.234.567,89 — moneda con decimales en mono (es-AR), solo presentación. */
function money(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(n)
    .replace(/ /g, "");
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

/** Grilla + aurora del header (textura del diseño) como SVG. */
function HeaderTexture({ width, height }: { width: number; height: number }) {
  const step = 19; // 28px × 0.676
  const vLines = Array.from({ length: Math.ceil(width / step) }, (_, i) => (i + 1) * step);
  const hLines = Array.from({ length: Math.ceil(height / step) }, (_, i) => (i + 1) * step);
  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
      <Defs>
        <RadialGradient id="aurora" cx="1" cy="0" r="1">
          <Stop offset="0" stopColor={C.blueMid} stopOpacity={0.22} />
          <Stop offset="0.6" stopColor={C.blueMid} stopOpacity={0} />
          <Stop offset="1" stopColor={C.blueMid} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {vLines.map((x) => (
        <Line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} stroke="#94a3b8" strokeOpacity={0.06} strokeWidth={0.6} />
      ))}
      {hLines.map((y) => (
        <Line key={`h${y}`} x1={0} y1={y} x2={width} y2={y} stroke="#94a3b8" strokeOpacity={0.06} strokeWidth={0.6} />
      ))}
      <Rect x={0} y={0} width={width} height={height} fill="url(#aurora)" />
    </Svg>
  );
}

export function InvoicePdfDocument({ invoice, config, qrDataUrl }: Props) {
  const letra = COMPROBANTE_LETRA[invoice.tipo_comprobante];
  const label = COMPROBANTE_LABEL[invoice.tipo_comprobante];
  // "Factura A" → base "Factura " + letra coloreada (conserva el espacio).
  const labelBase = label.endsWith(` ${letra}`) ? label.slice(0, -1) : `${label} `;
  const items = invoice.items ?? [];
  const isSandbox = invoice.ambiente !== "PRODUCCION";
  const nro = fmtNroComprobante(invoice.punto_venta, invoice.numero_comprobante);
  const alicuotas = Array.from(new Set(items.map((i) => Number(i.alicuota_iva))));
  const ivaLabel = alicuotas.length === 1 ? `IVA ${alicuotas[0]}%` : "IVA";
  const enLetras = montoEnLetras(invoice.total);
  const enLetrasSentence = enLetras.charAt(0) + enLetras.slice(1).toLowerCase();
  const contentW = 595 - RAIL_W; // ancho útil a la derecha del rail

  return (
    <Document
      title={`${label} ${nro}`}
      author={config.razon_social}
      subject="Comprobante electrónico ARCA"
    >
      <Page size="A4" style={styles.page}>
        {/* ---- Rail lateral fijo (branding NEXUS) ---- */}
        <View style={styles.rail} fixed>
          <Svg width={RAIL_W} height={842} style={{ position: "absolute", top: 0, left: 0 }}>
            <Defs>
              <LinearGradient id="railGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.navySeal0} />
                <Stop offset="1" stopColor={C.navySeal1} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={RAIL_W} height={842} fill="url(#railGrad)" />
            <Circle cx={RAIL_W / 2} cy={22} r={2.7} fill={C.emerald} />
            <Circle cx={RAIL_W / 2} cy={22} r={5.4} fill={C.emerald} fillOpacity={0.2} />
            <Circle cx={RAIL_W / 2} cy={820} r={2.7} fill={C.emerald} />
            <Circle cx={RAIL_W / 2} cy={820} r={5.4} fill={C.emerald} fillOpacity={0.2} />
          </Svg>
          <Text style={styles.railText}>TOPS NEXUS · LOGISTICS OPERATING SYSTEM</Text>
        </View>

        {/* ---- Header ---- */}
        <View style={styles.header}>
          <HeaderTexture width={contentW} height={150} />
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.eyebrow}>
                {config.nombre_fantasia ?? "Logística TOPS"} · {config.razon_social}
              </Text>
              <Text style={styles.title}>
                {labelBase}
                <Text style={styles.titleLetra}>{letra}</Text>
              </Text>
              <Text style={styles.nroMono}>
                N.º {nro} · CÓD {String(invoice.cbte_tipo_arca).padStart(2, "0")}
              </Text>
            </View>
            <View style={styles.logosWrap}>
              <Image src={LOGO_TOPS_VERTICAL} style={styles.logoTops} />
              <Image src={LOGO_CONNECT_NEXUS} style={styles.logoConnect} />
            </View>
            <View style={styles.chips}>
              {invoice.anulada ? (
                <View
                  style={[
                    styles.chip,
                    { backgroundColor: "rgba(239,68,68,0.14)", borderColor: "rgba(239,68,68,0.4)" },
                  ]}
                >
                  <View style={[styles.chipDot, { backgroundColor: C.red }]} />
                  <Text style={[styles.chipText, { color: C.red }]}>ANULADA</Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.chip,
                    { backgroundColor: "rgba(16,185,129,0.14)", borderColor: "rgba(16,185,129,0.4)" },
                  ]}
                >
                  <View style={[styles.chipDot, { backgroundColor: C.emerald }]} />
                  <Text style={[styles.chipText, { color: C.emeraldText }]}>EMITIDA</Text>
                </View>
              )}
              <View
                style={[
                  styles.chip,
                  { backgroundColor: "rgba(6,182,212,0.12)", borderColor: "rgba(6,182,212,0.38)" },
                ]}
              >
                <Text style={[styles.chipText, { color: C.cyanText }]}>ANMAT · COMPLIANCE</Text>
              </View>
              {isSandbox && (
                <View
                  style={[
                    styles.chip,
                    { backgroundColor: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.38)" },
                  ]}
                >
                  <Text style={[styles.chipText, { color: C.amberText }]}>
                    {invoice.ambiente}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.dateBar}>
            <View style={styles.dateCell}>
              <Text style={styles.dateLabel}>Emisión</Text>
              <Text style={styles.dateValue}>{fmtDate(invoice.created_at)}</Text>
            </View>
            <View style={[styles.dateCell, styles.dateCellSep]}>
              <Text style={styles.dateLabel}>Vencimiento</Text>
              <Text style={styles.dateValue}>
                {invoice.fch_vto_pago ? fmtDate(invoice.fch_vto_pago) : "—"}
              </Text>
            </View>
            <View style={[styles.dateCell, styles.dateCellSep]}>
              <Text style={styles.dateLabel}>Período</Text>
              <Text style={styles.dateValue}>{invoice.periodo ?? "—"}</Text>
            </View>
          </View>
        </View>

        {/* ---- Body ---- */}
        <View style={styles.body}>
          {/* Emisor / Cliente */}
          <View style={styles.parties}>
            <View style={[styles.card, { borderLeftColor: C.blueDeep }]}>
              <Text style={[styles.cardLabel, { color: C.blueDeep }]}>Emisor</Text>
              <Text style={styles.cardName}>{config.razon_social}</Text>
              <Text style={styles.cardDetail}>
                {COND_IVA_LABEL[config.condicion_iva]}
                {config.domicilio_comercial
                  ? `\n${config.domicilio_comercial}${config.localidad ? `, ${config.localidad}` : ""}`
                  : ""}
                {"\n"}
                <Text style={styles.mono}>CUIT {config.cuit}</Text>
                {config.ingresos_brutos ? ` · IIBB ${config.ingresos_brutos}` : ""}
              </Text>
            </View>
            <View style={[styles.card, { borderLeftColor: C.cyan }]}>
              <Text style={[styles.cardLabel, { color: C.cyanDark }]}>Cliente</Text>
              <Text style={styles.cardName}>{invoice.razon_social}</Text>
              <Text style={styles.cardDetail}>
                {COND_IVA_LABEL[invoice.condicion_iva]}
                {invoice.domicilio_cliente ? `\n${invoice.domicilio_cliente}` : ""}
                {"\n"}
                <Text style={styles.mono}>
                  CUIT {invoice.cuit_cliente ?? "—"}
                </Text>
              </Text>
            </View>
          </View>

          {/* Tabla de servicios */}
          <View style={styles.table}>
            <View style={styles.tHead}>
              <Text style={[styles.th, styles.colDesc]}>Descripción</Text>
              <Text style={[styles.th, styles.colCant]}>Cant.</Text>
              <Text style={[styles.th, styles.colUnit]}>P. Unit.</Text>
              <Text style={[styles.th, styles.colIva]}>IVA</Text>
              <Text style={[styles.th, styles.colImp]}>Importe</Text>
            </View>
            {items.map((it, i) => (
              <View key={i} style={[styles.tRow, ...(i > 0 ? [styles.tRowBorder] : [])]}>
                <View style={[styles.colDesc, { paddingVertical: 10.8 }]}>
                  <Text style={styles.cellTitle}>{it.descripcion}</Text>
                </View>
                <Text style={[styles.cellMono, styles.colCant]}>{it.cantidad}</Text>
                <Text style={[styles.cellMono, styles.colUnit]}>{money(it.precio_unitario)}</Text>
                <Text style={[styles.cellMonoMuted, styles.colIva]}>{it.alicuota_iva}%</Text>
                <Text style={[styles.cellMonoStrong, styles.colImp]}>{money(it.importe_neto)}</Text>
              </View>
            ))}
          </View>

          {/* Observaciones (ancla a OS + observación de la OS) */}
          {invoice.observ ? (
            <View
              style={{
                marginTop: 10,
                borderWidth: 0.8,
                borderColor: C.hairline,
                borderLeftWidth: 2.4,
                borderLeftColor: C.slate500,
                paddingVertical: 7,
                paddingHorizontal: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 7.5,
                  color: C.slate500,
                  letterSpacing: 0.4,
                  marginBottom: 2.5,
                }}
              >
                Observaciones
              </Text>
              <Text style={{ fontSize: 8.4, color: C.slate700, lineHeight: 1.5 }}>
                {invoice.observ}
              </Text>
            </View>
          ) : null}

          {/* Totales */}
          <View style={styles.totals} wrap={false}>
            <View style={styles.letrasCard}>
              <Text style={styles.letrasLabel}>Importe en letras</Text>
              <Text style={styles.letrasText}>{enLetrasSentence}</Text>
            </View>
            <View style={styles.totalBlock}>
              <Svg
                width={230}
                height={190}
                style={{ position: "absolute", top: 0, left: 0 }}
              >
                <Defs>
                  <LinearGradient id="totalGrad" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor={C.navySeal0} />
                    <Stop offset="0.6" stopColor={C.blueDeep} />
                    <Stop offset="1" stopColor={C.blueMid} />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={230} height={190} fill="url(#totalGrad)" />
              </Svg>
              <View style={styles.totalRow}>
                <Text style={styles.totalRowText}>Subtotal neto gravado</Text>
                <Text style={styles.totalRowMono}>{money(invoice.subtotal)}</Text>
              </View>
              {invoice.importe_no_gravado > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalRowText}>No gravado</Text>
                  <Text style={styles.totalRowMono}>{money(invoice.importe_no_gravado)}</Text>
                </View>
              )}
              {invoice.importe_exento > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalRowText}>Exento</Text>
                  <Text style={styles.totalRowMono}>{money(invoice.importe_exento)}</Text>
                </View>
              )}
              {invoice.percepciones > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalRowText}>Percepciones</Text>
                  <Text style={styles.totalRowMono}>{money(invoice.percepciones)}</Text>
                </View>
              )}
              {invoice.tributos > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalRowText}>Otros tributos</Text>
                  <Text style={styles.totalRowMono}>{money(invoice.tributos)}</Text>
                </View>
              )}
              <View style={[styles.totalRow, styles.totalDivider]}>
                <Text style={styles.totalRowText}>{ivaLabel}</Text>
                <Text style={styles.totalRowMono}>{money(invoice.iva)}</Text>
              </View>
              <View style={styles.totalFinal}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalAmount}>{money(invoice.total)}</Text>
              </View>
            </View>
          </View>

          {/* Trazabilidad: QR fiscal + CAE */}
          <View style={styles.trace} wrap={false}>
            <View style={styles.qrBox}>
              {qrDataUrl ? (
                <Image src={qrDataUrl} style={styles.qrImg} />
              ) : (
                <Text style={{ fontSize: 6, color: "#ffffff" }}>Sin QR</Text>
              )}
            </View>
            <View style={styles.traceBlocks}>
              <View>
                <Text style={styles.traceLabel}>CAE N.º</Text>
                <Text style={styles.traceValue}>{invoice.cae ?? "—"}</Text>
                <Text style={styles.traceSub}>
                  Vto. CAE{" "}
                  {invoice.fecha_vencimiento_cae
                    ? fmtDate(invoice.fecha_vencimiento_cae)
                    : "—"}
                </Text>
              </View>
              <View>
                <Text style={[styles.traceLabel, { color: C.cyan }]}>Trazabilidad</Text>
                <Text style={styles.traceValueSm}>
                  DOC-{docPrefix(invoice.tipo_comprobante)}-{nro}
                </Text>
                {invoice.fch_serv_desde && invoice.fch_serv_hasta && (
                  <Text style={styles.traceSub}>
                    Servicio {fmtDate(invoice.fch_serv_desde)} → {fmtDate(invoice.fch_serv_hasta)}
                  </Text>
                )}
                {isSandbox && (
                  <Text style={[styles.traceSub, { color: C.red, fontWeight: 700 }]}>
                    COMPROBANTE EMITIDO EN AMBIENTE {invoice.ambiente} — SIN VALIDEZ FISCAL
                  </Text>
                )}
              </View>
            </View>
          </View>

          {config.pie_legal && <Text style={styles.pieLegal}>{config.pie_legal}</Text>}
        </View>

        {/* ---- Footer fijo (banda oscura) ---- */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>
            logisticatops.com · administracion@logisticatops.com
            {"\n"}
            {config.razon_social} · CUIT {config.cuit}
            {config.domicilio_comercial ? ` · ${config.domicilio_comercial}` : ""}
            {config.localidad ? `, ${config.localidad}` : ""}
          </Text>
          <Text style={styles.footerRight}>
            Emitido por TOPS NEXUS
            {isSandbox ? "\nSin validez fiscal · ambiente sandbox" : ""}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

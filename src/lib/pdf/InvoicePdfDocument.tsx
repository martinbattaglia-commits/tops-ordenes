import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { montoEnLetras } from "@/lib/invoicing/calc";
import {
  COMPROBANTE_LABEL,
  COMPROBANTE_LETRA,
  type CustomerInvoice,
  type FiscalConfig,
} from "@/lib/invoicing/types";

/**
 * PDF fiscal de comprobante ARCA con el recuadro de letra al centro, datos
 * del emisor (desde fiscal_config, NUNCA hardcodeados), CAE + vencimiento y
 * QR fiscal obligatorio. Layout estilo factura electrónica AFIP/ARCA.
 */

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#0B1220", padding: 28 },

  // Cabecera con recuadro de letra al medio.
  header: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#0B1220",
  },
  headerLeft: { flex: 1, padding: 10, borderRightWidth: 1, borderRightColor: "#0B1220" },
  headerRight: { flex: 1, padding: 10 },
  letraBox: {
    position: "absolute",
    top: 0,
    left: "50%",
    marginLeft: -26,
    width: 52,
    height: 52,
    borderWidth: 1,
    borderColor: "#0B1220",
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  letra: { fontSize: 30, fontWeight: 900, color: "#0B1220" },
  codCbte: { fontSize: 6.5, color: "#0B1220", textAlign: "center" },

  wordmark: { fontSize: 20, fontWeight: 900, color: "#050555", letterSpacing: -0.5 },
  meta: { fontSize: 8, color: "#374151", lineHeight: 1.5, marginTop: 4 },

  cbteTitle: { fontSize: 13, fontWeight: 700, color: "#0B1220" },
  cbteMeta: { fontSize: 8.5, color: "#0B1220", lineHeight: 1.6, marginTop: 6 },

  receptorBox: {
    borderWidth: 1,
    borderColor: "#0B1220",
    borderTopWidth: 0,
    padding: 10,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  field: { width: "50%", marginBottom: 3 },
  fieldLabel: { fontSize: 7, color: "#6B7280" },
  fieldValue: { fontSize: 9, color: "#0B1220", fontWeight: 700 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: "#050555",
    color: "white",
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontSize: 8,
    marginTop: 10,
  },
  th: { color: "white", fontWeight: 700 },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontSize: 8.5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#DDE3EC",
  },

  totalsBox: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end" },
  totalsTable: { width: 240 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalsLabel: { fontSize: 9, color: "#374151" },
  totalsValue: { fontSize: 9, color: "#0B1220", fontWeight: 700 },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#0B1220",
  },
  grandTotal: { fontSize: 13, fontWeight: 900, color: "#050555" },

  enLetras: { marginTop: 8, fontSize: 8, color: "#374151", fontStyle: "italic" },

  caeFooter: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#0B1220",
    paddingTop: 10,
  },
  caeLabel: { fontSize: 8, color: "#6B7280" },
  caeValue: { fontSize: 13, fontWeight: 700, color: "#0B1220", fontFamily: "Courier" },
  pieLegal: { marginTop: 12, fontSize: 7, color: "#6B7280", lineHeight: 1.5 },
  sandboxTag: {
    marginTop: 6,
    fontSize: 7.5,
    color: "#C90812",
    fontWeight: 700,
  },
});

interface Props {
  invoice: CustomerInvoice;
  config: FiscalConfig;
  qrDataUrl: string;
}

function fmtNroComprobante(pv: number, nro: number | null): string {
  const pvStr = String(pv).padStart(5, "0");
  const nroStr = String(nro ?? 0).padStart(8, "0");
  return `${pvStr}-${nroStr}`;
}

const COND_IVA_LABEL: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "IVA Responsable Inscripto",
  MONOTRIBUTO: "Responsable Monotributo",
  EXENTO: "IVA Sujeto Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
  NO_RESPONSABLE: "IVA No Responsable",
  NO_CATEGORIZADO: "IVA No Categorizado",
};

export function InvoicePdfDocument({ invoice, config, qrDataUrl }: Props) {
  const letra = COMPROBANTE_LETRA[invoice.tipo_comprobante];
  const items = invoice.items ?? [];
  const isSandbox = invoice.ambiente !== "PRODUCCION";

  return (
    <Document
      title={`${COMPROBANTE_LABEL[invoice.tipo_comprobante]} ${fmtNroComprobante(
        invoice.punto_venta,
        invoice.numero_comprobante
      )}`}
      author={config.razon_social}
      subject="Comprobante electrónico ARCA"
    >
      <Page size="A4" style={styles.page}>
        {/* Recuadro de letra (A/B/C/E) */}
        <View style={styles.letraBox}>
          <Text style={styles.letra}>{letra}</Text>
          <Text style={styles.codCbte}>Cód. {invoice.cbte_tipo_arca}</Text>
        </View>

        {/* HEADER bicolumna */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.wordmark}>
              {config.nombre_fantasia ?? config.razon_social}
            </Text>
            <Text style={styles.meta}>
              {config.razon_social}
              {"\n"}
              {COND_IVA_LABEL[config.condicion_iva]}
              {"\n"}
              {config.domicilio_comercial ?? "—"}
              {config.localidad ? ` — ${config.localidad}` : ""}
              {"\n"}
              CUIT: {config.cuit}
              {config.ingresos_brutos ? `  ·  IIBB: ${config.ingresos_brutos}` : ""}
              {config.inicio_actividades
                ? `\nInicio de actividades: ${fmtDate(config.inicio_actividades)}`
                : ""}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.cbteTitle}>
              {COMPROBANTE_LABEL[invoice.tipo_comprobante]}
            </Text>
            <Text style={styles.cbteMeta}>
              N°: {fmtNroComprobante(invoice.punto_venta, invoice.numero_comprobante)}
              {"\n"}
              Fecha de emisión: {fmtDate(invoice.created_at)}
              {invoice.periodo ? `\nPeríodo: ${invoice.periodo}` : ""}
              {invoice.fch_serv_desde && invoice.fch_serv_hasta
                ? `\nServicio: ${fmtDate(invoice.fch_serv_desde)} al ${fmtDate(
                    invoice.fch_serv_hasta
                  )}`
                : ""}
              {invoice.fch_vto_pago
                ? `\nVto. de pago: ${fmtDate(invoice.fch_vto_pago)}`
                : ""}
            </Text>
          </View>
        </View>

        {/* RECEPTOR */}
        <View style={styles.receptorBox}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>RAZÓN SOCIAL</Text>
            <Text style={styles.fieldValue}>{invoice.razon_social}</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>CUIT / DOC</Text>
            <Text style={styles.fieldValue}>{invoice.cuit_cliente ?? "—"}</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>CONDICIÓN IVA</Text>
            <Text style={styles.fieldValue}>
              {COND_IVA_LABEL[invoice.condicion_iva]}
            </Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>DOMICILIO</Text>
            <Text style={styles.fieldValue}>{invoice.domicilio_cliente ?? "—"}</Text>
          </View>
        </View>

        {/* DETALLE */}
        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 4 }]}>Descripción</Text>
          <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>Cant.</Text>
          <Text style={[styles.th, { flex: 1.5, textAlign: "right" }]}>P. Unit.</Text>
          <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>IVA %</Text>
          <Text style={[styles.th, { flex: 1.5, textAlign: "right" }]}>Importe</Text>
        </View>
        {items.map((it, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={{ flex: 4 }}>{it.descripcion}</Text>
            <Text style={{ flex: 1, textAlign: "right" }}>{it.cantidad}</Text>
            <Text style={{ flex: 1.5, textAlign: "right" }}>
              {fmtCurrency(it.precio_unitario)}
            </Text>
            <Text style={{ flex: 1, textAlign: "right" }}>{it.alicuota_iva}</Text>
            <Text style={{ flex: 1.5, textAlign: "right", fontWeight: 700 }}>
              {fmtCurrency(it.importe_neto)}
            </Text>
          </View>
        ))}

        {/* TOTALES */}
        <View style={styles.totalsBox}>
          <View style={styles.totalsTable}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal neto gravado</Text>
              <Text style={styles.totalsValue}>{fmtCurrency(invoice.subtotal)}</Text>
            </View>
            {invoice.importe_no_gravado > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>No gravado</Text>
                <Text style={styles.totalsValue}>
                  {fmtCurrency(invoice.importe_no_gravado)}
                </Text>
              </View>
            )}
            {invoice.importe_exento > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Exento</Text>
                <Text style={styles.totalsValue}>
                  {fmtCurrency(invoice.importe_exento)}
                </Text>
              </View>
            )}
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>IVA</Text>
              <Text style={styles.totalsValue}>{fmtCurrency(invoice.iva)}</Text>
            </View>
            {invoice.percepciones > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Percepciones</Text>
                <Text style={styles.totalsValue}>{fmtCurrency(invoice.percepciones)}</Text>
              </View>
            )}
            {invoice.tributos > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Otros tributos</Text>
                <Text style={styles.totalsValue}>{fmtCurrency(invoice.tributos)}</Text>
              </View>
            )}
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotal}>TOTAL</Text>
              <Text style={styles.grandTotal}>{fmtCurrency(invoice.total)}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.enLetras}>{montoEnLetras(invoice.total)}</Text>

        {/* CAE + QR */}
        <View style={styles.caeFooter}>
          <View style={{ width: 90 }}>
            {qrDataUrl ? (
              <Image src={qrDataUrl} style={{ width: 84, height: 84 }} />
            ) : (
              <Text style={styles.caeLabel}>Sin QR</Text>
            )}
          </View>
          <View style={{ flex: 1, paddingLeft: 14 }}>
            <Text style={styles.caeLabel}>CAE N°</Text>
            <Text style={styles.caeValue}>{invoice.cae ?? "—"}</Text>
            <Text style={[styles.caeLabel, { marginTop: 4 }]}>
              Fecha Vto. CAE:{" "}
              {invoice.fecha_vencimiento_cae
                ? fmtDate(invoice.fecha_vencimiento_cae)
                : "—"}
            </Text>
            {isSandbox && (
              <Text style={styles.sandboxTag}>
                COMPROBANTE EMITIDO EN AMBIENTE {invoice.ambiente} — SIN VALIDEZ
                FISCAL
              </Text>
            )}
          </View>
        </View>

        {config.pie_legal && <Text style={styles.pieLegal}>{config.pie_legal}</Text>}
      </Page>
    </Document>
  );
}

import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { fmtCurrency, fmtDate, fmtDateTime } from "@/lib/utils";
import type { Order } from "@/lib/types";

/**
 * PDF generado server-side con react-pdf. Refleja la maqueta del handoff
 * (header bicolor, tabla bordó-azul, firma + QR + disclaimer al pie).
 */

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0B1220",
    padding: 32,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10,
    marginBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: "#050555",
  },
  wordmarkRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 4 },
  wordmark: { fontSize: 22, fontWeight: 900, color: "#050555", letterSpacing: -0.5 },
  wordmarkSub: { fontSize: 8, color: "#C90812", fontWeight: 700, marginLeft: 4, marginBottom: 2 },
  meta: { fontSize: 8, color: "#5A6577", lineHeight: 1.5 },
  rightHead: { textAlign: "right" },
  osTag: {
    fontSize: 8,
    color: "#C90812",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  osNumber: { fontSize: 16, fontWeight: 700, color: "#050555", fontFamily: "Courier", marginBottom: 4 },
  sectionLabel: {
    fontSize: 7.5,
    color: "#8A94A6",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    marginBottom: 5,
  },
  block: { marginBottom: 12 },
  row2: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  fieldLabel: { fontSize: 7, color: "#8A94A6", marginBottom: 1 },
  fieldValue: { fontSize: 10, color: "#0B1220" },
  fieldValueBold: { fontSize: 10, color: "#0B1220", fontWeight: 700 },
  tableHead: {
    flexDirection: "row",
    backgroundColor: "#050555",
    color: "white",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 9,
    fontWeight: 700,
  },
  th: { color: "white", fontWeight: 700 },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: "#DDE3EC",
  },
  totalRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 8, fontSize: 9 },
  footer: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: "#DDE3EC",
    flexDirection: "row",
    gap: 12,
  },
  signatureBox: {
    flex: 1,
    borderBottomWidth: 0.8,
    borderBottomColor: "#0B1220",
    height: 50,
    justifyContent: "flex-end",
  },
  obs: {
    fontSize: 8,
    color: "#0B1220",
    backgroundColor: "#F7F8FB",
    padding: 6,
    borderRadius: 3,
    lineHeight: 1.5,
  },
  disclaimer: {
    marginTop: 10,
    padding: 6,
    backgroundColor: "#F7F8FB",
    fontSize: 7,
    color: "#5A6577",
    lineHeight: 1.5,
  },
});

interface Props {
  order: Order;
  qrDataUrl: string;
}

export function OrderPdfDocument({ order, qrDataUrl }: Props) {
  const depotLabel = order.depot === "MAGALDI" ? "Magaldi · CABA" : "Luján · BsAs";

  return (
    <Document
      title={`${order.public_id} — Logística TOPS`}
      author="Logística TOPS — Verotin S.A."
      subject="Comprobante de servicio"
    >
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.headerRow}>
          <View>
            <View style={styles.wordmarkRow}>
              <Text style={styles.wordmark}>TOPS</Text>
              <Text style={styles.wordmarkSub}>LOGÍSTICA</Text>
            </View>
            <Text style={styles.meta}>
              Verotin S.A. · IVA Responsable Inscripto{"\n"}
              Agustín Magaldi 1765 — CABA · Argentina{"\n"}
              Tel/Fax: 4302-3944 · www.logisticatops.com
            </Text>
          </View>
          <View style={styles.rightHead}>
            <Text style={styles.osTag}>Orden de Servicio</Text>
            <Text style={styles.osNumber}>{order.public_id}</Text>
            <Text style={styles.meta}>
              Fecha: {fmtDate(order.date)}
              {"\n"}
              COD SAP: {order.short_id}
            </Text>
          </View>
        </View>

        {/* CLIENTE */}
        <View style={styles.block}>
          <Text style={styles.sectionLabel}>Datos del cliente</Text>
          <View style={styles.row2}>
            <View style={{ flex: 2 }}>
              <Text style={styles.fieldLabel}>RAZÓN SOCIAL</Text>
              <Text style={styles.fieldValueBold}>{order.client?.razon ?? "—"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>C.U.I.T.</Text>
              <Text style={styles.fieldValue}>{order.client?.cuit ?? "—"}</Text>
            </View>
          </View>
          <View style={[styles.row2, { marginTop: 6 }]}>
            <View style={{ flex: 2 }}>
              <Text style={styles.fieldLabel}>DOMICILIO</Text>
              <Text style={styles.fieldValue}>{order.client?.domicilio ?? "—"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>CONTACTO</Text>
              <Text style={styles.fieldValue}>{order.client?.contacto ?? "—"}</Text>
            </View>
          </View>
        </View>

        {/* OPERATIVO */}
        <View style={styles.block}>
          <Text style={styles.sectionLabel}>Datos operativos</Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>DEPÓSITO</Text>
              <Text style={styles.fieldValue}>{depotLabel}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>RESPONSABLE</Text>
              <Text style={styles.fieldValue}>{order.operator?.full_name ?? "—"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>HORA INICIO</Text>
              <Text style={styles.fieldValue}>{order.h_start ?? "—"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>HORA FIN</Text>
              <Text style={styles.fieldValue}>{order.h_end ?? "—"}</Text>
            </View>
          </View>
        </View>

        {/* SERVICIOS */}
        <View style={styles.block}>
          <Text style={styles.sectionLabel}>Detalle del servicio</Text>
          <View style={styles.tableHead}>
            <Text style={[styles.th, { flex: 3 }]}>Servicio</Text>
            <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>Cant.</Text>
            <Text style={[styles.th, { flex: 1 }]}>Unidad</Text>
            <Text style={[styles.th, { flex: 1.5, textAlign: "right" }]}>Tarifa</Text>
            <Text style={[styles.th, { flex: 1.5, textAlign: "right" }]}>Subtotal</Text>
          </View>
          {(order.services ?? []).map((s, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={{ flex: 3 }}>{s.label}</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>{s.qty}</Text>
              <Text style={{ flex: 1 }}>{s.unit}</Text>
              <Text style={{ flex: 1.5, textAlign: "right" }}>{fmtCurrency(s.rate)}</Text>
              <Text style={{ flex: 1.5, textAlign: "right", fontWeight: 700 }}>
                {fmtCurrency(s.subtotal)}
              </Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={{ flex: 4, fontSize: 8, color: "#5A6577" }}>
              Pallets: {order.pallets} · Unidades: {order.units} · Km: {order.km}
            </Text>
            <Text style={{ flex: 2, textAlign: "right", fontWeight: 700, color: "#050555" }}>
              Total estimado
            </Text>
            <Text
              style={{
                flex: 1.5,
                textAlign: "right",
                fontWeight: 700,
                color: "#050555",
                fontSize: 11,
              }}
            >
              {fmtCurrency(order.total)}
            </Text>
          </View>
        </View>

        {order.observ && (
          <View style={styles.block}>
            <Text style={styles.sectionLabel}>Observaciones</Text>
            <Text style={styles.obs}>{order.observ}</Text>
          </View>
        )}

        {/* FOOTER */}
        <View style={styles.footer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionLabel}>Conforme del cliente</Text>
            <View style={styles.signatureBox}>
              {order.signature_url && order.signature_url.startsWith("http") && (
                <Image src={order.signature_url} style={{ height: 45, objectFit: "contain" }} />
              )}
            </View>
            <Text style={{ fontSize: 8, color: "#5A6577", marginTop: 3 }}>
              {order.signed_by
                ? `${order.signed_by} · ${fmtDateTime(order.signed_at ?? order.date)}`
                : "Pendiente"}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionLabel}>Geolocalización</Text>
            <Text style={{ fontSize: 8, color: "#5A6577", lineHeight: 1.5 }}>
              {order.geo_lat && order.geo_lng
                ? `${order.geo_lat.toFixed(4)}, ${order.geo_lng.toFixed(4)}`
                : "—"}
              {"\n"}
              IP: {order.ip ?? "—"}
              {"\n"}
              {order.signature_hash && `Hash sha256: ${order.signature_hash.slice(0, 14)}…`}
            </Text>
          </View>
          <View style={{ width: 80 }}>
            <Text style={styles.sectionLabel}>Verificar</Text>
            <Image src={qrDataUrl} style={{ width: 70, height: 70 }} />
          </View>
        </View>

        <Text style={styles.disclaimer}>
          SEGURO DE LAS MERCADERÍAS: Las mercaderías serán aseguradas por cuenta y riesgo del
          cliente, sin responsabilidad por los riesgos y/o daños que pudieran producirse durante
          el curso de su transporte, carga y/o descarga, con renuncia expresa del cliente y de la
          Cía. Aseguradora contratada a repetir y/o hacer cualquier reclamo eventual contra
          Logística TOPS.
        </Text>
      </Page>
    </Document>
  );
}

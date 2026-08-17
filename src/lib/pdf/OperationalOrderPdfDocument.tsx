import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Order } from "@/lib/types";
import { ORG } from "@/lib/org";
import { fmtDate } from "@/lib/utils";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: "#111827" },
  title: { fontSize: 20, fontWeight: 700, color: "#050555", marginBottom: 6 },
  meta: { color: "#4b5563", marginBottom: 16 },
  section: { fontSize: 11, fontWeight: 700, color: "#050555", marginTop: 14, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.5, borderBottomColor: "#d1d5db", paddingVertical: 6 },
  note: { marginTop: 18, padding: 10, backgroundColor: "#f3f4f6", color: "#4b5563" },
});

export function OperationalOrderPdfDocument({ order }: { order: Order }) {
  return <Document title={`${order.public_id} · registro operativo`}>
    <Page size="A4" style={styles.page}>
      <Text style={styles.title}>{ORG.brand} · ORDEN DE SERVICIO</Text>
      <Text style={styles.meta}>{order.public_id} · {fmtDate(order.date)} · {order.depot}</Text>
      <Text style={styles.section}>Cliente</Text>
      <Text>{order.client?.razon ?? "—"} · {order.client?.cuit ?? "—"}</Text>
      <Text style={styles.section}>Prestación</Text>
      {(order.services ?? []).map((line, index) => <View key={line.id ?? index} style={styles.row}>
        <Text>{line.label}</Text>
        <Text>{line.qty_requested ?? line.qty} {line.unit}</Text>
      </View>)}
      <Text style={styles.section}>Conformidad</Text>
      <Text>Firmante: {order.signed_by ?? "—"} · {order.signed_at ? fmtDate(order.signed_at) : "—"}</Text>
      <Text style={styles.note}>Documento operativo sin información comercial. Cotización: pendiente de resolución por un usuario autorizado.</Text>
    </Page>
  </Document>;
}

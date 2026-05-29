import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { PurchaseOrder } from "@/lib/types-po";
import { fmtCurrency, fmtDateTime, fmtCuit } from "@/lib/compras/format";
import { ORG } from "@/lib/org";

/**
 * Documento PDF de Orden de Compra — server side via @react-pdf/renderer.
 * Layout idéntico al PdfPreview pero en formato A4 imprimible.
 */

const C = {
  blue900: "#050555",
  blue700: "#214576",
  red: "#C90812",
  text: "#0B1220",
  textSec: "#5A6577",
  muted: "#8A94A6",
  stroke: "#DDE3EC",
  strokeSoft: "#EEF1F6",
  bg: "#F7F8FB",
  white: "#FFFFFF",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9, color: C.text },
  accent: { position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: C.red },
  header: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: C.stroke, marginTop: 6 },
  brandRow: { flexDirection: "row", alignItems: "flex-end" },
  brand: { fontSize: 22, fontWeight: 900, color: C.blue900, letterSpacing: -0.5 },
  brandTag: { fontSize: 7, color: C.red, fontWeight: 700, marginLeft: 4, marginBottom: 3, letterSpacing: 2 },
  meta: { fontSize: 7.5, color: C.textSec, lineHeight: 1.45, marginTop: 4, maxWidth: 280 },
  rightHead: { alignItems: "flex-end" },
  eyebrow: { fontSize: 8, color: C.red, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" },
  ocNum: { fontSize: 18, color: C.blue900, fontWeight: 700, fontFamily: "Courier", marginTop: 2 },
  rightMeta: { fontSize: 8, color: C.textSec, marginTop: 2 },
  sectionLabel: { fontSize: 7.5, color: C.red, fontWeight: 700, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 5, marginTop: 12 },
  vendorRow: { flexDirection: "row", gap: 12 },
  vendorCol1: { flex: 1.7 },
  vendorCol2: { flex: 1 },
  vendorCol3: { flex: 1 },
  kvLabel: { fontSize: 7, color: C.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 1 },
  kvValue: { fontSize: 9, color: C.text, marginBottom: 4 },
  kvValueStrong: { fontSize: 9, color: C.blue900, fontWeight: 700, marginBottom: 4 },
  kvMono: { fontFamily: "Courier", fontSize: 9, color: C.text, marginBottom: 4 },
  destCard: { backgroundColor: C.bg, padding: 8, flexDirection: "row", gap: 8, borderRadius: 4 },
  destCol: { flex: 1 },

  table: { marginTop: 12 },
  thead: { flexDirection: "row", backgroundColor: C.blue900, color: C.white, paddingVertical: 4, paddingHorizontal: 6 },
  th: { color: C.white, fontSize: 7.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 },
  tr: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.strokeSoft },
  td: { fontSize: 8.5, color: C.text },
  cellN: { width: 22, color: C.muted, fontFamily: "Courier" },
  cellProd: { flex: 1, paddingRight: 4 },
  cellQty: { width: 36, textAlign: "right" },
  cellUnit: { width: 30, color: C.textSec },
  cellPrice: { width: 60, textAlign: "right" },
  cellSubtotal: { width: 80, textAlign: "right", color: C.blue900, fontWeight: 700 },
  prodLabel: { fontSize: 9, fontWeight: 700, color: C.text },
  prodSku: { fontSize: 7, color: C.muted, fontFamily: "Courier", marginTop: 1 },

  totals: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end" },
  totalsBlock: { width: 200 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totLabel: { fontSize: 8.5, color: C.textSec },
  totValue: { fontSize: 8.5, color: C.text, fontWeight: 700 },
  totFinal: { borderTopWidth: 1.5, borderTopColor: C.blue900, marginTop: 4, paddingTop: 6 },
  totFinalLabel: { fontSize: 11, color: C.blue900, fontWeight: 700 },
  totFinalValue: { fontSize: 12, color: C.blue900, fontWeight: 700 },

  footer: { position: "absolute", left: 36, right: 36, bottom: 28, flexDirection: "row", gap: 10 },
  footerCol: { flex: 1, borderTopWidth: 1, borderTopColor: C.stroke, paddingTop: 6 },
  footerColQr: { width: 100, borderTopWidth: 1, borderTopColor: C.stroke, paddingTop: 6, alignItems: "center" },
  footLabel: { fontSize: 7, color: C.muted, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 3 },
  sigText: { fontSize: 14, fontWeight: 700, color: C.blue900, fontStyle: "italic" },
  sigName: { fontSize: 8.5, color: C.text, fontWeight: 700, marginTop: 4 },
  sigRole: { fontSize: 7.5, color: C.muted },
  hash: { position: "absolute", left: 36, right: 36, bottom: 12, fontSize: 6.5, color: C.muted, fontFamily: "Courier" },
  qr: { width: 80, height: 80 },
  observ: { marginTop: 8, backgroundColor: C.bg, padding: 8, borderRadius: 4, fontSize: 8, color: C.textSec, lineHeight: 1.5 },
});

interface Props {
  po: PurchaseOrder;
  signatureDataUrl?: string | null;
  qrDataUrl?: string | null;
}

export function PoPdfDocument({ po, signatureDataUrl, qrDataUrl }: Props) {
  const items = po.items ?? [];
  return (
    <Document
      title={`Orden de Compra ${po.public_id}`}
      author={ORG.emitter.name}
      subject="Orden de Compra"
      creator="TOPS Compras"
      producer="TOPS Compras"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.accent} />

        <View style={styles.header}>
          <View>
            <View style={styles.brandRow}>
              <Text style={styles.brand}>TOPS</Text>
              <Text style={styles.brandTag}>COMPRAS</Text>
            </View>
            <Text style={styles.meta}>
              {ORG.legalName} · CUIT {ORG.cuit} · {ORG.iva}
              {"\n"}
              {ORG.address}
              {"\n"}
              {ORG.phone} · {ORG.website}
            </Text>
          </View>
          <View style={styles.rightHead}>
            <Text style={styles.eyebrow}>Orden de Compra</Text>
            <Text style={styles.ocNum}>{po.public_id}</Text>
            <Text style={styles.rightMeta}>{fmtDateTime(po.date)}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Proveedor</Text>
        <View style={styles.vendorRow}>
          <View style={styles.vendorCol1}>
            <Text style={styles.kvLabel}>Razón social</Text>
            <Text style={styles.kvValueStrong}>{po.vendor?.razon ?? "—"}</Text>
            <Text style={styles.kvLabel}>Domicilio</Text>
            <Text style={styles.kvValue}>{po.vendor?.domicilio ?? "—"}</Text>
          </View>
          <View style={styles.vendorCol2}>
            <Text style={styles.kvLabel}>CUIT</Text>
            <Text style={styles.kvMono}>{fmtCuit(po.vendor?.cuit ?? "")}</Text>
            <Text style={styles.kvLabel}>Teléfono</Text>
            <Text style={styles.kvValue}>{po.vendor?.telefono ?? "—"}</Text>
          </View>
          <View style={styles.vendorCol3}>
            <Text style={styles.kvLabel}>Contacto</Text>
            <Text style={styles.kvValue}>{po.vendor?.contacto ?? "—"}</Text>
            <Text style={styles.kvLabel}>Email</Text>
            <Text style={styles.kvValue}>{po.vendor?.email ?? "—"}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Destino y condiciones</Text>
        <View style={styles.destCard}>
          <View style={styles.destCol}>
            <Text style={styles.kvLabel}>Destino</Text>
            <Text style={styles.kvValue}>{po.destino ?? "—"}</Text>
          </View>
          <View style={styles.destCol}>
            <Text style={styles.kvLabel}>Cond. pago</Text>
            <Text style={styles.kvValue}>{po.cond_pago}</Text>
          </View>
          <View style={styles.destCol}>
            <Text style={styles.kvLabel}>Entrega</Text>
            <Text style={styles.kvValue}>{po.entrega ?? "—"}</Text>
          </View>
          <View style={styles.destCol}>
            <Text style={styles.kvLabel}>Categoría</Text>
            <Text style={styles.kvValue}>{po.categoria ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, styles.cellN]}>N°</Text>
            <Text style={[styles.th, styles.cellProd]}>Producto / Servicio</Text>
            <Text style={[styles.th, styles.cellQty]}>Cant.</Text>
            <Text style={[styles.th, styles.cellUnit]}>Un.</Text>
            <Text style={[styles.th, styles.cellPrice]}>P. Unit.</Text>
            <Text style={[styles.th, styles.cellSubtotal]}>Subtotal</Text>
          </View>
          {items.map((it, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={[styles.td, styles.cellN]}>{String(i + 1).padStart(2, "0")}</Text>
              <View style={styles.cellProd}>
                <Text style={styles.prodLabel}>{it.label}</Text>
                {it.sku && <Text style={styles.prodSku}>{it.sku}</Text>}
              </View>
              <Text style={[styles.td, styles.cellQty]}>{it.qty}</Text>
              <Text style={[styles.td, styles.cellUnit]}>{it.unit}</Text>
              <Text style={[styles.td, styles.cellPrice]}>{fmtCurrency(it.price)}</Text>
              <Text style={[styles.td, styles.cellSubtotal]}>{fmtCurrency(it.subtotal)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsBlock}>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>Subtotal neto</Text>
              <Text style={styles.totValue}>{fmtCurrency(po.neto)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>IVA 21%</Text>
              <Text style={styles.totValue}>{fmtCurrency(po.iva)}</Text>
            </View>
            <View style={[styles.totRow, styles.totFinal]}>
              <Text style={styles.totFinalLabel}>TOTAL</Text>
              <Text style={styles.totFinalValue}>{fmtCurrency(po.total)}</Text>
            </View>
          </View>
        </View>

        {po.observ && (
          <View style={styles.observ}>
            <Text>{po.observ}</Text>
          </View>
        )}

        <View style={styles.footer}>
          <View style={styles.footerCol}>
            <Text style={styles.footLabel}>Autorizado por</Text>
            {signatureDataUrl ? (
              <Image src={signatureDataUrl} style={{ width: 110, height: 38 }} />
            ) : (
              <Text style={styles.sigText}>José Luis</Text>
            )}
            <Text style={styles.sigName}>{ORG.emitter.name}</Text>
            <Text style={styles.sigRole}>{ORG.emitter.role}</Text>
            {po.signed_at && <Text style={styles.sigRole}>{fmtDateTime(po.signed_at)}</Text>}
          </View>
          <View style={styles.footerCol}>
            <Text style={styles.footLabel}>Recibido y verificado</Text>
            {po.recibido_por ? (
              <>
                <Text style={styles.sigName}>{po.recibido_por}</Text>
                {po.recibido_at && <Text style={styles.sigRole}>{fmtDateTime(po.recibido_at)}</Text>}
                {po.factura_id && <Text style={[styles.sigRole, { fontFamily: "Courier", marginTop: 2 }]}>Factura {po.factura_id}</Text>}
              </>
            ) : (
              <Text style={styles.sigRole}>Aclaración / DNI / fecha</Text>
            )}
          </View>
          <View style={styles.footerColQr}>
            <Text style={styles.footLabel}>Validar OC</Text>
            {qrDataUrl ? <Image src={qrDataUrl} style={styles.qr} /> : <View style={[styles.qr, { backgroundColor: C.bg }]} />}
          </View>
        </View>

        <Text style={styles.hash}>
          SHA-256 {po.integrity_hash ?? "—"} · Drive {po.drive_file_id ?? "—"} · Generado por TOPS Compras
        </Text>
      </Page>
    </Document>
  );
}

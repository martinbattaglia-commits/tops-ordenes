import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { PurchaseOrder } from "@/lib/types-po";
import { PO_PRICE_STATE_LABEL } from "@/lib/compras/pricing";
import { fmtCurrency, fmtDateTime, fmtCuit } from "@/lib/compras/format";
import { ORG } from "@/lib/org";
import { registerDocFonts } from "@/lib/doc-system/fonts";
import { DOC, FONT } from "@/lib/doc-system/tokens";
import {
  DocFooter,
  DocHeader,
  Field,
  SectionTitle,
  TotalBlock,
  ValidationBlock,
  WarnBox,
  docPage,
} from "@/lib/doc-system/pdf/components";

/**
 * Documento PDF de Orden de Compra — server side via @react-pdf/renderer.
 * Layout según referencia de Dirección (REF-OC, 2026-07-28), componentes
 * compartidos del doc-system. El contenido funcional (datos, cálculos,
 * numeración, hash) es idéntico al layout anterior.
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
  cellN: { width: 26, color: DOC.labelSoft, fontFamily: FONT.mono, fontSize: 8 },
  cellProd: { flex: 1, paddingRight: 6 },
  cellQty: { width: 38, textAlign: "right", fontFamily: FONT.mono, fontSize: 8.5 },
  cellUnit: { width: 32, textAlign: "center", color: DOC.textSec, fontSize: 8 },
  cellPrice: { width: 66, textAlign: "right", fontFamily: FONT.mono, fontSize: 8.5 },
  cellSubtotal: {
    width: 84,
    textAlign: "right",
    fontFamily: FONT.mono,
    fontSize: 8.5,
    fontWeight: 600,
    color: DOC.navy,
  },
  prodLabel: { fontSize: 9, fontWeight: 700, color: DOC.ink },
  prodSku: { fontSize: 7, color: DOC.labelSoft, fontFamily: FONT.mono },

  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: DOC.rule,
  },
  sumLabel: { fontSize: 8.5, color: DOC.textSec },
  sumValue: { fontSize: 8.5, fontFamily: FONT.mono, color: DOC.ink },

  sigImage: { width: 110, height: 30 },
  sigLine: { borderTopWidth: 0.75, borderTopColor: DOC.ink, marginTop: 14, paddingTop: 3 },
  sigName: { fontSize: 8.5, color: DOC.ink, fontWeight: 700 },
  sigRole: { fontSize: 7.5, color: DOC.labelSoft },
  sigHint: { fontSize: 7.5, color: DOC.label, marginTop: 4 },

  hashValue: { fontFamily: FONT.mono, fontSize: 6.5, color: DOC.ink },
  observText: { fontSize: 8, color: DOC.textSec, lineHeight: 1.5, marginTop: 6 },
});

interface Props {
  po: PurchaseOrder;
  signatureDataUrl?: string | null;
  qrDataUrl?: string | null;
}

export function PoPdfDocument({ po, signatureDataUrl, qrDataUrl }: Props) {
  const items = po.items ?? [];
  const year = po.date ? String(new Date(po.date).getFullYear()) : "";
  return (
    <Document
      title={`Orden de Compra ${po.public_id}`}
      author={po.emisor_name}
      subject="Orden de Compra"
      creator="TOPS Compras"
      producer="TOPS Compras"
    >
      <Page size="A4" style={docPage.page}>
        <DocHeader
          context="TOPS Compras"
          title={"ORDEN DE\nCOMPRA"}
          badge="OC"
          badgeSub={year}
          docNumber={`N.° ${po.public_id}`}
        />

        <View style={docPage.body}>
          <SectionTitle num={1} title="Datos de la orden" />
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <Field label="Fecha de emisión" value={fmtDateTime(po.date)} mono />
            </View>
            <View style={styles.gridCell}>
              <Field label="Categoría" value={po.categoria} />
            </View>
            <View style={[styles.gridCell, styles.gridCellLast]}>
              <Field label="Moneda" value="ARS" mono />
            </View>
          </View>

          <View style={styles.twoCols}>
            <View style={styles.col}>
              <SectionTitle num={2} title="Emisor" />
              <View style={{ marginTop: 8 }}>
                <Field label="Razón social" value={ORG.legalName} strong />
                <Text style={{ fontSize: 8.5, color: DOC.textSec, marginBottom: 4 }}>
                  {ORG.brand} · {ORG.iva}
                </Text>
                <Text style={{ fontSize: 8.5, color: DOC.textSec, marginBottom: 6 }}>
                  {ORG.address}
                </Text>
                <View style={styles.twoCols}>
                  <Field label="CUIT" value={fmtCuit(ORG.cuit)} mono />
                  <Field label="Teléfonos" value={ORG.phone} mono />
                </View>
              </View>
            </View>
            <View style={styles.col}>
              <SectionTitle num={3} title="Proveedor" />
              <View style={{ marginTop: 8 }}>
                <Field label="Razón social" value={po.vendor?.razon} strong />
                <Field label="Domicilio" value={po.vendor?.domicilio} />
                <View style={styles.twoCols}>
                  <Field label="CUIT" value={fmtCuit(po.vendor?.cuit ?? "")} mono />
                  <Field label="Teléfono" value={po.vendor?.telefono} />
                </View>
                <View style={styles.twoCols}>
                  <Field label="Contacto" value={po.vendor?.contacto} />
                  <Field label="Email" value={po.vendor?.email} />
                </View>
              </View>
            </View>
          </View>

          <SectionTitle num={4} title="Destino y condiciones" />
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <Field label="Destino" value={po.destino} />
            </View>
            <View style={styles.gridCell}>
              <Field label="Cond. de pago" value={po.cond_pago} />
            </View>
            <View style={[styles.gridCell, styles.gridCellLast]}>
              <Field label="Entrega" value={po.entrega} />
            </View>
          </View>

          <SectionTitle num={5} title="Detalle de productos y servicios" />
          <View style={styles.thRow}>
            <Text style={[styles.th, { width: 26 }]}>N.°</Text>
            <Text style={[styles.th, { flex: 1 }]}>Producto / Servicio</Text>
            <Text style={[styles.th, { width: 38, textAlign: "right" }]}>Cant.</Text>
            <Text style={[styles.th, { width: 32, textAlign: "center" }]}>Un.</Text>
            <Text style={[styles.th, { width: 66, textAlign: "right" }]}>P. Unitario</Text>
            <Text style={[styles.th, { width: 84, textAlign: "right" }]}>Subtotal</Text>
          </View>
          {items.map((it, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={styles.cellN}>{String(i + 1).padStart(2, "0")}</Text>
              <View style={styles.cellProd}>
                <Text style={styles.prodLabel}>
                  {it.label}
                  {it.sku ? <Text style={styles.prodSku}>  ({it.sku})</Text> : null}
                </Text>
                {it.price_state !== "known" ? (
                  <Text style={styles.prodSku}>
                    {PO_PRICE_STATE_LABEL[it.price_state]}{it.price_reason ? ` · ${it.price_reason}` : ""}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.cellQty}>{it.qty}</Text>
              <Text style={styles.cellUnit}>{it.unit}</Text>
              <Text style={styles.cellPrice}>{fmtCurrency(it.price)}</Text>
              <Text style={styles.cellSubtotal}>{fmtCurrency(it.subtotal)}</Text>
            </View>
          ))}

          {po.observ ? (
            <>
              <SectionTitle num={6} title="Observaciones" />
              <Text style={styles.observText}>{po.observ}</Text>
            </>
          ) : null}

          <View style={styles.twoCols} wrap={false}>
            <View style={styles.col}>
              <SectionTitle num={po.observ ? 7 : 6} title="Autorizaciones" />
              <View style={{ marginTop: 8, flexDirection: "row", gap: 14 }}>
                <View style={{ flex: 1 }}>
                  <Field label="Autorizado por">
                    {signatureDataUrl ? (
                      <Image src={signatureDataUrl} style={styles.sigImage} />
                    ) : (
                      <View style={{ height: 30 }} />
                    )}
                  </Field>
                  <View style={styles.sigLine}>
                    <Text style={styles.sigName}>{po.signed_by ?? po.emisor_name}</Text>
                    <Text style={styles.sigRole}>{po.emisor_role}</Text>
                    {po.signed_at ? <Text style={styles.sigRole}>{fmtDateTime(po.signed_at)}</Text> : null}
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Recibido y verificado">
                    <View style={{ height: 38 }} />
                  </Field>
                  <View style={styles.sigLine}>
                    {po.recibido_por ? (
                      <>
                        <Text style={styles.sigName}>{po.recibido_por}</Text>
                        {po.recibido_at ? <Text style={styles.sigRole}>{fmtDateTime(po.recibido_at)}</Text> : null}
                        {po.factura_id ? (
                          <Text style={[styles.sigRole, { fontFamily: FONT.mono, marginTop: 2 }]}>
                            Factura {po.factura_id}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <Text style={styles.sigHint}>Aclaración / DNI / fecha</Text>
                    )}
                  </View>
                </View>
              </View>
            </View>
            <View style={styles.col}>
              <SectionTitle num={po.observ ? 8 : 7} title="Resumen" />
              <View style={{ marginTop: 6 }}>
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>{po.price_state === "estimated" ? "Neto estimado" : "Subtotal neto"}</Text>
                  <Text style={styles.sumValue}>{fmtCurrency(po.neto ?? po.planning_neto)}</Text>
                </View>
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>IVA 21%</Text>
                  <Text style={styles.sumValue}>{fmtCurrency(po.iva ?? po.planning_iva)}</Text>
                </View>
                <TotalBlock amount={po.price_state === "pending" ? "PRECIO PENDIENTE" : fmtCurrency(po.total ?? po.planning_total)} />
              </View>
            </View>
          </View>

          <View wrap={false}>
            <SectionTitle num={po.observ ? 9 : 8} title="Validación documental" />
            <ValidationBlock qrDataUrl={qrDataUrl} qrCaption="Validar OC">
              <View>
                <Field label="Hash SHA-256">
                  <Text style={styles.hashValue}>{po.integrity_hash ?? "—"}</Text>
                </Field>
                <Field label="Drive">
                  <Text style={styles.hashValue}>{po.drive_file_id ?? "—"}</Text>
                </Field>
              </View>
              <WarnBox
                title="Generado por TOPS Compras"
                text="Documento interno de compras. La recepción de mercadería o servicio debe verificarse contra esta orden antes de conformar la factura del proveedor."
              />
            </ValidationBlock>
          </View>
        </View>

        <DocFooter docLine={`Orden de compra ${po.public_id} · TOPS Compras`} />
      </Page>
    </Document>
  );
}

import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { fmtCurrency, fmtCuit, fmtDate, fmtDateTime, isUrgentOrder } from "@/lib/utils";
import { ivaEstimate } from "@/lib/pricing/calculator";
import type { Order } from "@/lib/types";
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
 * Documento PDF de Orden de Servicio — server side via @react-pdf/renderer.
 * Layout según el sistema documental de Dirección (doc-system, 2026-07-28),
 * mismo patrón que PoPdfDocument. El contenido funcional (datos, cálculos,
 * QR, firma, hash, geolocalización y cláusula de seguro) es idéntico al
 * layout anterior.
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

  urgent: {
    color: DOC.red,
    fontSize: 7.5,
    fontWeight: 800,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 6,
  },

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
  cellSvc: { flex: 1, paddingRight: 6 },
  svcLabel: { fontSize: 9, fontWeight: 700, color: DOC.ink },
  cellQty: { width: 38, textAlign: "right", fontFamily: FONT.mono, fontSize: 8.5 },
  cellUnit: { width: 36, textAlign: "center", color: DOC.textSec, fontSize: 8 },
  cellRate: { width: 70, textAlign: "right", fontFamily: FONT.mono, fontSize: 8.5 },
  cellSubtotal: {
    width: 84,
    textAlign: "right",
    fontFamily: FONT.mono,
    fontSize: 8.5,
    fontWeight: 600,
    color: DOC.navy,
  },
  tableMeta: { fontSize: 7.5, color: DOC.labelSoft, marginTop: 5 },

  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: DOC.rule,
  },
  sumLabel: { fontSize: 8.5, color: DOC.textSec },
  sumValue: { fontSize: 8.5, fontFamily: FONT.mono, color: DOC.ink },

  sigImage: { height: 34, objectFit: "contain", objectPositionX: 0 },
  sigLine: { borderTopWidth: 0.75, borderTopColor: DOC.ink, marginTop: 10, paddingTop: 3 },
  sigName: { fontSize: 8.5, color: DOC.ink, fontWeight: 700 },
  sigRole: { fontSize: 7.5, color: DOC.labelSoft },
  sigHint: { fontSize: 7.5, color: DOC.label },

  geoText: { fontSize: 8, color: DOC.textSec, lineHeight: 1.5 },
  geoMono: { fontFamily: FONT.mono, fontSize: 7 },

  /** Rótulo local para la columna Resumen (sub-bloque de la sección 07). */
  subHead: {
    color: DOC.label,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },

  observText: { fontSize: 8, color: DOC.textSec, lineHeight: 1.5, marginTop: 6 },
});

interface Props {
  order: Order;
  qrDataUrl: string;
}

export function OrderPdfDocument({ order, qrDataUrl }: Props) {
  const depotLabel = order.depot === "MAGALDI" ? "Magaldi · CABA" : "Luján · BsAs";
  // order.total es NETO (sin IVA). Discriminamos IVA 21% (estimación; la
  // facturación fiscal real corre por el módulo de Facturación/ARCA).
  const ivaMonto = ivaEstimate(order.total);
  const totalConIva = order.total + ivaMonto;
  const year = order.date ? String(new Date(order.date).getFullYear()) : "";
  const hasObserv = Boolean(order.observ);

  return (
    <Document
      title={`${order.public_id} — Logística TOPS`}
      author={`${ORG.brand} — ${ORG.legalName}`}
      subject="Comprobante de servicio"
      creator="TOPS Operaciones"
      producer="TOPS Operaciones"
    >
      <Page size="A4" style={docPage.page}>
        <DocHeader
          context="TOPS Operaciones"
          title={"ORDEN DE\nSERVICIO"}
          badge="OS"
          badgeSub={year}
          docNumber={`N.° ${order.public_id}`}
        />

        <View style={docPage.body}>
          <SectionTitle num={1} title="Datos de la orden" />
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <Field label="Fecha de emisión" value={fmtDate(order.date)} mono />
            </View>
            {order.short_id ? (
              <View style={styles.gridCell}>
                <Field label="COD SAP" value={order.short_id} mono />
              </View>
            ) : null}
            <View style={[styles.gridCell, styles.gridCellLast]}>
              <Field label="Moneda" value="ARS" mono />
            </View>
          </View>
          {isUrgentOrder(order) ? <Text style={styles.urgent}>Urgente · +100%</Text> : null}

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
              <SectionTitle num={3} title="Cliente" />
              <View style={{ marginTop: 8 }}>
                <Field label="Razón social" value={order.client?.razon} strong />
                <Field label="Domicilio" value={order.client?.domicilio} />
                <View style={styles.twoCols}>
                  <Field label="CUIT" value={fmtCuit(order.client?.cuit ?? "")} mono />
                  <Field label="Contacto" value={order.client?.contacto} />
                </View>
              </View>
            </View>
          </View>

          <SectionTitle num={4} title="Datos operativos" />
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <Field label="Depósito" value={depotLabel} />
            </View>
            <View style={styles.gridCell}>
              <Field label="Responsable" value={order.operator?.full_name} />
            </View>
            <View style={styles.gridCell}>
              <Field label="Hora inicio" value={order.h_start} mono />
            </View>
            <View style={[styles.gridCell, styles.gridCellLast]}>
              <Field label="Hora fin" value={order.h_end} mono />
            </View>
          </View>

          <SectionTitle num={5} title="Detalle del servicio" />
          <View style={styles.thRow}>
            <Text style={[styles.th, { flex: 1 }]}>Servicio</Text>
            <Text style={[styles.th, { width: 38, textAlign: "right" }]}>Cant.</Text>
            <Text style={[styles.th, { width: 36, textAlign: "center" }]}>Un.</Text>
            <Text style={[styles.th, { width: 70, textAlign: "right" }]}>Tarifa</Text>
            <Text style={[styles.th, { width: 84, textAlign: "right" }]}>Subtotal</Text>
          </View>
          {(order.services ?? []).map((s, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <View style={styles.cellSvc}>
                <Text style={styles.svcLabel}>{s.label}</Text>
              </View>
              <Text style={styles.cellQty}>{s.qty}</Text>
              <Text style={styles.cellUnit}>{s.unit}</Text>
              <Text style={styles.cellRate}>{fmtCurrency(s.rate)}</Text>
              <Text style={styles.cellSubtotal}>{fmtCurrency(s.subtotal)}</Text>
            </View>
          ))}
          <Text style={styles.tableMeta}>
            Pallets: {order.pallets} · Unidades: {order.units} · Km: {order.km}
          </Text>

          {hasObserv ? (
            <>
              <SectionTitle num={6} title="Observaciones" />
              <Text style={styles.observText}>{order.observ}</Text>
            </>
          ) : null}

          <View wrap={false}>
          <SectionTitle num={hasObserv ? 7 : 6} title="Conforme del cliente" />
          <View style={styles.twoCols}>
            <View style={styles.col}>
              <View style={{ marginTop: 8 }}>
                {order.signature_url && order.signature_url.startsWith("http") ? (
                  <Image src={order.signature_url} style={styles.sigImage} />
                ) : (
                  <View style={{ height: 34 }} />
                )}
                <View style={styles.sigLine}>
                  {order.signed_by ? (
                    <>
                      <Text style={styles.sigName}>{order.signed_by}</Text>
                      <Text style={styles.sigRole}>
                        {fmtDateTime(order.signed_at ?? order.date)}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.sigHint}>Pendiente</Text>
                  )}
                </View>
                <View style={{ marginTop: 8 }}>
                  <Field label="Geolocalización · IP · Hash">
                    <Text style={styles.geoText}>
                      {order.geo_lat && order.geo_lng
                        ? `${order.geo_lat.toFixed(4)}, ${order.geo_lng.toFixed(4)}`
                        : "—"}
                      {"\n"}
                      IP: {order.ip ?? "—"}
                      {order.signature_hash ? (
                        <Text style={styles.geoMono}>
                          {"\n"}Hash sha256: {order.signature_hash.slice(0, 14)}…
                        </Text>
                      ) : null}
                    </Text>
                  </Field>
                </View>
              </View>
            </View>
            <View style={styles.col}>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.subHead}>Resumen</Text>
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>Subtotal neto</Text>
                  <Text style={styles.sumValue}>{fmtCurrency(order.total)}</Text>
                </View>
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>IVA 21%</Text>
                  <Text style={styles.sumValue}>{fmtCurrency(ivaMonto)}</Text>
                </View>
                <TotalBlock amount={fmtCurrency(totalConIva)} />
              </View>
            </View>
          </View>
          </View>

          <View wrap={false}>
            <SectionTitle num={hasObserv ? 8 : 7} title="Validación documental" />
            <ValidationBlock qrDataUrl={qrDataUrl} qrCaption="Verificar OS">
              <WarnBox
                title="Seguro de las mercaderías"
                text="Las mercaderías serán aseguradas por cuenta y riesgo del cliente, sin responsabilidad por los riesgos y/o daños que pudieran producirse durante el curso de su transporte, carga y/o descarga, con renuncia expresa del cliente y de la Cía. Aseguradora contratada a repetir y/o hacer cualquier reclamo eventual contra Logística TOPS."
              />
            </ValidationBlock>
          </View>
        </View>

        <DocFooter docLine={`Orden de servicio ${order.public_id} · TOPS Operaciones`} />
      </Page>
    </Document>
  );
}

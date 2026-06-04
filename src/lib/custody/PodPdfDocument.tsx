import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { ORG } from "@/lib/org";
import { fmtDateTime } from "@/lib/utils";
import { STAGE_META, EVENT_TYPE_META } from "@/lib/custody/types";
import type { CustodyStage, CustodyEventType } from "@/lib/custody/types";

/**
 * POD-PDF server-side (GATE 5.3 · B4) — @react-pdf/renderer. Mismo patrón que
 * PoPdfDocument/OrderPdfDocument (Compras/Pedidos). Documento probatorio: embebe
 * shipment, receptor, fecha, firma, timeline, resumen de hash-chain, evidencias y
 * QR de resolución. Render a Buffer en pod-pdf.ts; sube a custody-pod y se sirve
 * por emit_custody_signed_url (auditado). NO usa window.print().
 */

const C = {
  green: "#16a34a",
  blue900: "#050555",
  text: "#0B1220",
  textSec: "#5A6577",
  muted: "#69738A",
  stroke: "#DDE3EC",
  strokeSoft: "#EEF1F6",
  bg: "#F7F8FB",
  white: "#FFFFFF",
  ok: "#16a34a",
  bad: "#C90812",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9, color: C.text },
  accent: { position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: C.green },
  header: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: C.stroke, marginTop: 6 },
  brandRow: { flexDirection: "row", alignItems: "flex-end" },
  brand: { fontSize: 22, fontWeight: 900, color: C.blue900, letterSpacing: -0.5 },
  brandTag: { fontSize: 7, color: C.green, fontWeight: 700, marginLeft: 4, marginBottom: 3, letterSpacing: 2 },
  meta: { fontSize: 7.5, color: C.textSec, lineHeight: 1.45, marginTop: 4, maxWidth: 280 },
  rightHead: { alignItems: "flex-end" },
  eyebrow: { fontSize: 8, color: C.green, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" },
  podNum: { fontSize: 18, color: C.blue900, fontWeight: 700, fontFamily: "Courier", marginTop: 2 },
  rightMeta: { fontSize: 8, color: C.textSec, marginTop: 2 },
  sectionLabel: { fontSize: 7.5, color: C.green, fontWeight: 700, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 5, marginTop: 14 },
  row: { flexDirection: "row", gap: 12 },
  col: { flex: 1 },
  kvLabel: { fontSize: 7, color: C.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 1 },
  kvValue: { fontSize: 9, color: C.text, marginBottom: 4 },
  kvValueStrong: { fontSize: 10, color: C.blue900, fontWeight: 700, marginBottom: 4 },
  card: { backgroundColor: C.bg, padding: 8, borderRadius: 4 },

  tlRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: C.strokeSoft },
  tlStage: { width: 78, fontSize: 8, fontWeight: 700 },
  tlEvent: { flex: 1, fontSize: 8.5, color: C.text },
  tlWhen: { width: 110, fontSize: 7.5, color: C.textSec, textAlign: "right" },
  tlNote: { fontSize: 7.5, color: C.muted, marginTop: 1 },

  sigBox: { marginTop: 4, borderWidth: 1, borderColor: C.stroke, borderRadius: 4, padding: 8, alignItems: "center", width: 220 },
  sigImg: { width: 180, height: 70, objectFit: "contain" },
  sigPlaceholder: { fontSize: 8, color: C.muted, fontStyle: "italic" },

  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  photoCard: { width: 120, borderWidth: 1, borderColor: C.stroke, borderRadius: 4, padding: 4 },
  photoImg: { width: 112, height: 84, objectFit: "cover" },
  photoCap: { fontSize: 6.5, color: C.muted, marginTop: 2 },

  chainRow: { flexDirection: "row", gap: 12, marginTop: 2 },
  chainPill: { fontSize: 8.5, fontWeight: 700, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },

  qrWrap: { alignItems: "center", width: 110 },
  qr: { width: 90, height: 90 },
  qrCap: { fontSize: 6.5, color: C.muted, marginTop: 2, textAlign: "center" },

  footer: { position: "absolute", left: 36, right: 36, bottom: 30, borderTopWidth: 1, borderTopColor: C.stroke, paddingTop: 6, flexDirection: "row", justifyContent: "space-between" },
  footText: { fontSize: 6.5, color: C.muted, lineHeight: 1.4 },
  hash: { position: "absolute", left: 36, right: 36, bottom: 14, fontSize: 6, color: C.muted, fontFamily: "Courier" },
});

export interface PodPdfTimelineRow {
  stage: CustodyStage;
  event_type: CustodyEventType;
  occurred_at: string;
  notes: string | null;
  geo: { lat: number; lng: number } | null;
}

export interface PodPdfPhoto {
  dataUrl: string;
  caption: string;
}

export interface PodPdfData {
  podPublicId: string;
  shipmentPublicId: string | null;
  shipmentId: string;
  receiverName: string;
  receiverDocument: string | null;
  observations: string | null;
  signedAt: string | null;
  timeline: PodPdfTimelineRow[];
  signatureDataUrl: string | null;
  photos: PodPdfPhoto[];
  qrDataUrl: string | null;
  chainValid: boolean;
  chainEventsChecked: number;
  events: number;
  evidences: number;
  generatedAt: string;
}

export function PodPdfDocument(d: PodPdfData) {
  return (
    <Document
      title={`POD ${d.podPublicId}`}
      author={ORG.legalName}
      subject="Proof Of Delivery — Cadena de Custodia"
      creator="TOPS NEXUS · Custodia"
      producer="TOPS NEXUS · Custodia"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.accent} />

        <View style={styles.header}>
          <View>
            <View style={styles.brandRow}>
              <Text style={styles.brand}>TOPS</Text>
              <Text style={styles.brandTag}>CUSTODIA</Text>
            </View>
            <Text style={styles.meta}>
              {ORG.legalName} · CUIT {ORG.cuit}
              {"\n"}
              {ORG.address}
              {"\n"}
              {ORG.phone} · {ORG.website}
            </Text>
          </View>
          <View style={styles.rightHead}>
            <Text style={styles.eyebrow}>Proof Of Delivery</Text>
            <Text style={styles.podNum}>{d.podPublicId}</Text>
            <Text style={styles.rightMeta}>Despacho {d.shipmentPublicId ?? d.shipmentId}</Text>
            {d.signedAt && <Text style={styles.rightMeta}>Firmado {fmtDateTime(d.signedAt)}</Text>}
          </View>
        </View>

        {/* Receptor */}
        <Text style={styles.sectionLabel}>Receptor</Text>
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.kvLabel}>Nombre</Text>
            <Text style={styles.kvValueStrong}>{d.receiverName}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.kvLabel}>Documento</Text>
            <Text style={styles.kvValue}>{d.receiverDocument ?? "—"}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.kvLabel}>Fecha de firma</Text>
            <Text style={styles.kvValue}>{d.signedAt ? fmtDateTime(d.signedAt) : "—"}</Text>
          </View>
        </View>
        {d.observations ? (
          <View style={[styles.card, { marginTop: 6 }]}>
            <Text style={styles.kvLabel}>Observaciones</Text>
            <Text style={[styles.kvValue, { marginBottom: 0 }]}>{d.observations}</Text>
          </View>
        ) : null}

        {/* Firma */}
        <Text style={styles.sectionLabel}>Firma del receptor</Text>
        <View style={styles.sigBox}>
          {d.signatureDataUrl ? (
            <Image src={d.signatureDataUrl} style={styles.sigImg} />
          ) : (
            <Text style={styles.sigPlaceholder}>Sin firma embebida (no registrada o acceso PII restringido).</Text>
          )}
        </View>

        {/* Integridad / hash-chain */}
        <Text style={styles.sectionLabel}>Integridad (hash-chain)</Text>
        <View style={styles.chainRow}>
          <Text
            style={[
              styles.chainPill,
              { backgroundColor: d.chainValid ? "#16a34a1a" : "#C908121a", color: d.chainValid ? C.ok : C.bad },
            ]}
          >
            {d.chainValid ? "CADENA VÁLIDA" : "CADENA INVÁLIDA"}
          </Text>
          <Text style={[styles.kvValue, { marginBottom: 0 }]}>
            {d.chainEventsChecked} eventos verificados · {d.events} eventos · {d.evidences} evidencias
          </Text>
        </View>

        {/* Timeline */}
        <Text style={styles.sectionLabel}>Línea de tiempo (cadena de custodia)</Text>
        <View>
          {d.timeline.length === 0 && <Text style={styles.kvValue}>Sin eventos registrados.</Text>}
          {d.timeline.map((t, i) => (
            <View key={i} style={styles.tlRow} wrap={false}>
              <Text style={[styles.tlStage, { color: STAGE_META[t.stage]?.color ?? C.text }]}>
                {STAGE_META[t.stage]?.label ?? t.stage}
              </Text>
              <View style={styles.tlEvent}>
                <Text>{EVENT_TYPE_META[t.event_type]?.label ?? t.event_type}</Text>
                {t.notes ? <Text style={styles.tlNote}>{t.notes}</Text> : null}
                {t.geo ? <Text style={styles.tlNote}>geo {t.geo.lat.toFixed(5)}, {t.geo.lng.toFixed(5)}</Text> : null}
              </View>
              <Text style={styles.tlWhen}>{fmtDateTime(t.occurred_at)}</Text>
            </View>
          ))}
        </View>

        {/* Evidencias + QR */}
        <View style={[styles.row, { marginTop: 0 }]}>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>Evidencias</Text>
            <View style={styles.photos}>
              {d.photos.length === 0 && <Text style={styles.kvValue}>Sin fotos embebidas.</Text>}
              {d.photos.map((p, i) => (
                <View key={i} style={styles.photoCard} wrap={false}>
                  <Image src={p.dataUrl} style={styles.photoImg} />
                  <Text style={styles.photoCap}>{p.caption}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.qrWrap}>
            <Text style={styles.sectionLabel}>Verificación</Text>
            {d.qrDataUrl ? <Image src={d.qrDataUrl} style={styles.qr} /> : <View style={[styles.qr, { backgroundColor: C.bg }]} />}
            <Text style={styles.qrCap}>Escaneá para ver la custodia</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footText}>
            Documento probatorio generado por TOPS NEXUS · Cadena de Custodia (Gate 5).{"\n"}
            Firma electrónica simple (prueba de recepción). Generado {fmtDateTime(d.generatedAt)}.
          </Text>
        </View>
        <Text style={styles.hash}>
          Integridad: SHA-256 del PDF registrado en la cadena de custodia (custody-pod) · verificable con verify_custody_chain.
        </Text>
      </Page>
    </Document>
  );
}

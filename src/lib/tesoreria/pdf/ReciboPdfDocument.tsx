import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { fmtCurrency } from "@/lib/utils";
import { ORG } from "@/lib/org";
import { registerDocFonts } from "@/lib/doc-system/fonts";
import { DOC, FONT } from "@/lib/doc-system/tokens";
import {
  DocFooter,
  DocHeader,
  SectionTitle,
  TotalBlock,
  WarnBox,
  docPage,
} from "@/lib/doc-system/pdf/components";
import { importeEnLetras } from "./importe-letras";

/**
 * RECIBO (badge RC·COB) — comprobante de cobranza de Tesorería
 * (customer_receipts REC-YYYY-NNNNNN, mig 0053). Layout según referencia de
 * Dirección (REF-RECIBO, 2026-07-28), componentes compartidos del doc-system.
 * Es un FORMULARIO: vuelca los datos existentes del recibo y deja líneas y
 * casilleros en blanco donde el dato no existe. Sin QR (no hay URL pública).
 *
 * ⚠️ Colisión conocida de prefijo `REC-` con las recepciones WMS (0025):
 * se muestra el public_id tal cual, sin resolverla.
 */

registerDocFonts();

const s = StyleSheet.create({
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

  label: {
    color: DOC.label,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  value: { color: DOC.ink, fontSize: 9.5, minHeight: 12 },
  valueMono: { fontFamily: FONT.mono, fontSize: 9 },
  valueStrong: { color: DOC.navy, fontWeight: 700 },
  blank: { height: 12, borderBottomWidth: 0.75, borderBottomColor: DOC.rule },
  // Sin flex por defecto: dentro de un contenedor columna, flex:1 colapsa y
  // superpone los campos (react-pdf). En filas se pide explícito con `grow`.
  fieldWrap: {},
  fieldGrow: { flex: 1 },
  fieldsRow: { flexDirection: "row", gap: 14, marginTop: 8 },

  emitterName: { fontSize: 11, fontWeight: 800, color: DOC.navy },
  emitterLine: { fontSize: 8.5, color: DOC.textSec, marginBottom: 2 },

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
    alignItems: "flex-end",
    minHeight: 17,
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: DOC.rule,
  },
  cellN: { width: 26, color: DOC.labelSoft, fontFamily: FONT.mono, fontSize: 8 },
  cellComp: { flex: 1, fontSize: 8.5, fontWeight: 700, color: DOC.ink },
  cellFecha: { width: 70, fontFamily: FONT.mono, fontSize: 8.5 },
  cellImporte: {
    width: 90,
    textAlign: "right",
    fontFamily: FONT.mono,
    fontSize: 8.5,
    fontWeight: 600,
    color: DOC.navy,
  },

  cbRow: { flexDirection: "row", gap: 4, marginTop: 8 },
  cbItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  cbBox: {
    width: 8,
    height: 8,
    borderWidth: 0.75,
    borderColor: DOC.labelSoft,
    borderRadius: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cbInner: { width: 4.4, height: 4.4, backgroundColor: DOC.navy },
  cbLabel: { fontSize: 7.5, color: DOC.textSec },

  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: DOC.rule,
  },
  sumLabel: { fontSize: 8.5, color: DOC.textSec },
  sumValue: { fontSize: 8.5, fontFamily: FONT.mono, color: DOC.ink },

  sigRow: { flexDirection: "row", gap: 18, marginTop: 26 },
  sigCol: { flex: 1 },
  sigLine: { borderTopWidth: 0.75, borderTopColor: DOC.labelSoft, paddingTop: 3 },
  sigName: {
    fontSize: 7,
    color: DOC.navy,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sigHint: { fontSize: 7, color: DOC.labelSoft, marginTop: 1 },

  voided: {
    color: DOC.red,
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 6,
  },
});

function Field({
  label,
  value,
  mono = false,
  strong = false,
  grow = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  strong?: boolean;
  /** flex:1 — usar SOLO dentro de filas (fieldsRow/twoCols). */
  grow?: boolean;
}) {
  return (
    <View style={grow ? s.fieldGrow : s.fieldWrap}>
      <Text style={s.label}>{label}</Text>
      {value ? (
        <Text style={[s.value, mono ? s.valueMono : {}, strong ? s.valueStrong : {}]}>
          {value}
        </Text>
      ) : (
        <View style={s.blank} />
      )}
    </View>
  );
}

function Check({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <View style={s.cbItem}>
      <View style={s.cbBox}>{checked ? <View style={s.cbInner} /> : null}</View>
      <Text style={s.cbLabel}>{label}</Text>
    </View>
  );
}

export interface ReciboComprobante {
  /** Ej. «Factura A 00003-00001234». */
  comprobante: string;
  fecha: string | null;
  importeImputado: number;
}

export type ReciboMedioPago = "efectivo" | "transferencia" | "cheque" | "echeq";

export interface ReciboData {
  /** Ingresos Brutos del emisor, leído de `fiscal_config` (no hardcodear:
   *  la Factura usa la misma fuente y deben coincidir siempre). */
  ingresosBrutos: string | null;
  /** N.° = public_id del recibo (REC-2026-000001, prefijo compartido con WMS). */
  numero: string;
  fecha: string | null;
  lugar: string;
  moneda: string;
  /** Recibimos de (cliente). */
  clienteRazon: string | null;
  clienteCuit: string | null;
  clienteDomicilio: string | null;
  comprobantes: ReciboComprobante[];
  medioPago: ReciboMedioPago;
  /** Cuenta destino (banco · titular · alias/CBU) para transferencias. */
  bancoLinea: string | null;
  /** Importe acreditado por el medio principal (neto). */
  importeMedio: number | null;
  retencion: number;
  sumaImputada: number;
  /** Total recibido (bruto). */
  total: number;
  observaciones: string | null;
  anulado: boolean;
}

export function ReciboPdfDocument({ data }: { data: ReciboData }) {
  const rows: (ReciboComprobante | null)[] = [...data.comprobantes];
  while (rows.length < 5) rows.push(null);
  const chequeChecked = data.medioPago === "cheque" || data.medioPago === "echeq";

  return (
    <Document
      title={`Recibo ${data.numero} — ${ORG.brand}`}
      author={`${ORG.brand} — ${ORG.legalName}`}
      subject="Comprobante de cobranza"
      creator="TOPS Administración"
      producer="TOPS Administración"
    >
      <Page size="A4" style={docPage.page}>
        <DocHeader
          context="TOPS Administración"
          title="RECIBO"
          badge="RC"
          badgeSub="COB"
          subtitle="Comprobante de cobranza"
        />

        <View style={docPage.body}>
          <SectionTitle num={1} title="Datos del recibo" />
          <View style={s.grid}>
            <View style={s.gridCell}>
              <Field label="Recibo N.°" value={data.numero} mono />
            </View>
            <View style={s.gridCell}>
              <Field label="Fecha" value={data.fecha} mono />
            </View>
            <View style={s.gridCell}>
              <Field label="Lugar" value={data.lugar} strong />
            </View>
            <View style={[s.gridCell, s.gridCellLast]}>
              <Field label="Moneda" value={data.moneda} mono />
            </View>
          </View>
          {data.anulado ? <Text style={s.voided}>Recibo anulado</Text> : null}

          <View style={s.twoCols}>
            <View style={s.col}>
              <SectionTitle num={2} title="Recibimos por cuenta de" />
              <View style={{ marginTop: 8 }}>
                <Text style={s.emitterName}>{ORG.legalName.toUpperCase()}</Text>
                <Text style={[s.emitterLine, { marginTop: 2 }]}>
                  {ORG.brand} · IVA {ORG.iva}
                </Text>
                <Text style={s.emitterLine}>Agustín Magaldi 1765 (C1286AFM)</Text>
                <Text style={[s.emitterLine, { marginBottom: 6 }]}>CABA · Argentina</Text>
                <View style={s.twoCols}>
                  <Field label="CUIT" value={ORG.cuit} mono grow />
                  <Field label="Ingresos Brutos" value={data.ingresosBrutos} mono grow />
                </View>
              </View>
            </View>
            <View style={s.col}>
              <SectionTitle num={3} title="Recibimos de" />
              <View style={{ marginTop: 8 }}>
                <Field label="Razón social / Nombre" value={data.clienteRazon} strong />
                <View style={{ height: 6 }} />
                <View style={s.twoCols}>
                  <Field label="CUIT / DNI" value={data.clienteCuit} mono grow />
                  <Field label="Cuenta corriente N.°" grow />
                </View>
                <View style={{ height: 6 }} />
                <Field label="Domicilio" value={data.clienteDomicilio} />
              </View>
            </View>
          </View>

          <SectionTitle num={4} title="Comprobantes que se cancelan" />
          <View style={s.thRow}>
            <Text style={[s.th, { width: 26 }]}>N.°</Text>
            <Text style={[s.th, { flex: 1 }]}>Comprobante</Text>
            <Text style={[s.th, { width: 70 }]}>Fecha</Text>
            <Text style={[s.th, { width: 90, textAlign: "right" }]}>Importe imputado</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={s.cellN}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={s.cellComp}>{r?.comprobante ?? ""}</Text>
              <Text style={s.cellFecha}>{r?.fecha ?? ""}</Text>
              <Text style={s.cellImporte}>
                {r ? fmtCurrency(r.importeImputado) : ""}
              </Text>
            </View>
          ))}

          <SectionTitle num={5} title="Medios de pago" />
          <View style={s.cbRow}>
            <Check label="Efectivo" checked={data.medioPago === "efectivo"} />
            <Check label="Transferencia" checked={data.medioPago === "transferencia"} />
            <Check label="Cheque / e-cheq" checked={chequeChecked} />
            <Check label="Retención" checked={data.retencion > 0} />
          </View>
          <View style={s.fieldsRow}>
            <View style={{ flex: 3 }}>
              <Field label="Banco / Titular · CBU o alias" value={data.bancoLinea} />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Importe"
                value={data.importeMedio != null ? fmtCurrency(data.importeMedio) : null}
                mono
              />
            </View>
          </View>
          <View style={s.fieldsRow}>
            <View style={{ flex: 3 }}>
              <Field label="Cheque N.° · Banco · Fecha de pago" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Importe" />
            </View>
          </View>

          <View style={s.twoCols}>
            <View style={s.col}>
              <SectionTitle num={6} title="Observaciones" />
              <View style={{ marginTop: 8 }}>
                <Field
                  label="Importe en letras"
                  value={data.total > 0 ? importeEnLetras(data.total) : null}
                />
                <View style={{ height: 8 }} />
                <Field label="Detalle / Referencia" value={data.observaciones} />
              </View>
            </View>
            <View style={s.col}>
              <SectionTitle num={7} title="Total recibido" />
              <View style={{ marginTop: 6 }}>
                <View style={s.sumRow}>
                  <Text style={s.sumLabel}>Suma imputada</Text>
                  <Text style={s.sumValue}>
                    {data.sumaImputada > 0 ? fmtCurrency(data.sumaImputada) : ""}
                  </Text>
                </View>
                <View style={s.sumRow}>
                  <Text style={s.sumLabel}>Retenciones</Text>
                  <Text style={s.sumValue}>
                    {data.retencion > 0 ? fmtCurrency(data.retencion) : ""}
                  </Text>
                </View>
                <TotalBlock amount={fmtCurrency(data.total)} />
              </View>
            </View>
          </View>

          <View wrap={false}>
            <SectionTitle num={8} title="Conformidades" />
            <View style={s.sigRow}>
              <View style={s.sigCol}>
                <View style={s.sigLine}>
                  <Text style={s.sigName}>Recibió · Logística TOPS</Text>
                  <Text style={s.sigHint}>Aclaración / legajo / sello</Text>
                </View>
              </View>
              <View style={s.sigCol}>
                <View style={s.sigLine}>
                  <Text style={s.sigName}>Entregó</Text>
                  <Text style={s.sigHint}>Aclaración / DNI / fecha</Text>
                </View>
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <WarnBox
                title="Documento no válido como factura"
                text="Comprobante de cobranza. Los valores recibidos se acreditan una vez efectivizados; los cheques se reciben en carácter de pago a cuenta y sujetos a su acreditación. La imputación se registra en Nexus contra los comprobantes indicados."
              />
            </View>
          </View>
        </View>

        <DocFooter
          docLine={`Recibo ${data.numero} · TOPS Administración`}
          extra="Original · Duplicado"
        />
      </Page>
    </Document>
  );
}

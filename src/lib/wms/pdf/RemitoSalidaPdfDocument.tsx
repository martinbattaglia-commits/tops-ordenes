import { Document, Page, View } from "@react-pdf/renderer";
import { ORG } from "@/lib/org";
import { registerDocFonts } from "@/lib/doc-system/fonts";
import {
  DocFooter,
  DocHeader,
  SectionTitle,
  WarnBox,
  docPage,
} from "@/lib/doc-system/pdf/components";
import {
  CheckRow,
  EmitterBlock,
  FormField,
  RemitoTable,
  SignatureBlock,
  remitoStyles as s,
  type DepotInfo,
  type RemitoLine,
} from "./remito-common";

/**
 * REMITO DE SALIDA (badge RS·EGR) — despachos WMS (DSP-YYYY-NNNN, mig 0035).
 * Layout según referencia de Dirección (REF-REMITO, 2026-07-28), componentes
 * compartidos del doc-system. Es un FORMULARIO: vuelca los datos existentes del
 * despacho y deja líneas/casilleros en blanco donde el dato no existe.
 */

registerDocFonts();

export interface RemitoSalidaData {
  /** N.° de remito = public_id del shipment (DSP-2026-0001). */
  numero: string;
  fecha: string | null;
  horaSalida: string | null;
  depot: DepotInfo | null;
  /** Destinatario = depositante del pedido (client_name). */
  destinatarioRazon: string | null;
  /** Orden de servicio interna que origina el egreso (pedido PED-…). */
  ordenServicio: string | null;
  transportista: string | null;
  chofer: string | null;
  dominio: string | null;
  lineas: RemitoLine[];
  observaciones: string | null;
  /** Firma del destinatario si la entrega ya fue confirmada (received_by_name). */
  conformeDestinatario: string | null;
}

export function RemitoSalidaPdfDocument({ data }: { data: RemitoSalidaData }) {
  const depotLabel = data.depot?.label ?? null;
  return (
    <Document
      title={`Remito de salida ${data.numero} — ${ORG.brand}`}
      author={`${ORG.brand} — ${ORG.legalName}`}
      subject="Remito de salida"
      creator="TOPS Operaciones"
      producer="TOPS Operaciones"
    >
      <Page size="A4" style={docPage.page}>
        <DocHeader
          context="TOPS Operaciones"
          title={"REMITO DE\nSALIDA"}
          badge="RS"
          badgeSub="EGR"
          subtitle={`Despacho de mercadería${depotLabel ? ` · ${depotLabel}` : ""}`}
        />

        <View style={docPage.body}>
          <SectionTitle num={1} title="Datos del remito" />
          <View style={s.fieldsRow}>
            <FormField label="Remito N.°" value={data.numero} mono grow />
            <FormField label="Fecha" value={data.fecha} mono grow />
            <FormField label="Hora de salida" value={data.horaSalida} mono grow />
            <FormField label="Depósito origen" value={depotLabel} strong grow />
          </View>

          <View style={s.twoCols}>
            <View style={s.col}>
              <SectionTitle num={2} title="Emisor" />
              <EmitterBlock depot={data.depot} />
            </View>
            <View style={s.col}>
              <SectionTitle num={3} title="Destinatario" />
              <View style={{ marginTop: 8 }}>
                <FormField label="Razón social" value={data.destinatarioRazon} strong />
                <View style={{ height: 6 }} />
                <View style={s.twoCols}>
                  <FormField label="CUIT" grow />
                  <FormField label="Orden de servicio" value={data.ordenServicio} mono grow />
                </View>
                <View style={{ height: 6 }} />
                <FormField label="Domicilio de entrega" />
              </View>
            </View>
          </View>

          <SectionTitle num={4} title="Transporte y entrega" />
          <View style={s.fieldsRow}>
            <FormField label="Transportista" value={data.transportista} grow />
            <FormField label="Chofer" value={data.chofer} grow />
            <FormField label="Dominio" value={data.dominio} mono grow />
            <FormField label="Zona / AMBA" grow />
          </View>

          <SectionTitle num={5} title="Detalle de mercadería despachada" />
          <RemitoTable lines={data.lineas} headerLabel="Descripción de la mercadería" />

          <SectionTitle num={6} title="Control de despacho" />
          <CheckRow
            items={[
              { label: "Picking verificado" },
              { label: "Bultos precintados" },
              { label: "Rótulos conformes" },
              { label: "Producto ANMAT" },
            ]}
          />
          <View style={{ marginTop: 10 }}>
            <FormField
              label="Observaciones / Condiciones de entrega"
              value={data.observaciones}
            />
          </View>

          <View wrap={false}>
            <SectionTitle num={7} title="Conformidades" />
            <View style={s.sigRow}>
              <SignatureBlock
                name="Despachó · Logística TOPS"
                hint="Aclaración / legajo / hora"
              />
              <SignatureBlock name="Transportista" hint="Aclaración / DNI" />
              <SignatureBlock
                name="Conforme del destinatario"
                hint={data.conformeDestinatario ?? "Aclaración / sello / fecha"}
              />
            </View>
            <View style={{ marginTop: 12 }}>
              <WarnBox
                title="Documento no válido como factura"
                text="Comprobante interno de movimiento de mercadería. El despacho se registra en Nexus y queda trazado contra la orden de servicio indicada. El destinatario debe firmar la conformidad al momento de la entrega."
              />
            </View>
          </View>
        </View>

        <DocFooter
          docLine={`Remito de salida ${data.numero} · TOPS Operaciones`}
          extra="Original · Duplicado"
        />
      </Page>
    </Document>
  );
}

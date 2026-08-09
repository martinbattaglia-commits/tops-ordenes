import { Document, Page, Text, View } from "@react-pdf/renderer";
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
 * REMITO DE ENTRADA (badge RE·ING) — recepciones WMS (REC-YYYY-NNNN, mig 0025).
 * Layout según referencia de Dirección (REF-REMITO, 2026-07-28), componentes
 * compartidos del doc-system. Es un FORMULARIO: vuelca los datos existentes de
 * la recepción y deja líneas/casilleros en blanco donde el dato no existe.
 */

registerDocFonts();

export interface RemitoEntradaData {
  /** N.° de remito = public_id de la recepción (REC-2026-0001). */
  numero: string;
  fecha: string | null;
  horaArribo: string | null;
  depot: DepotInfo | null;
  /** Remitente = depositante (client_name). */
  remitenteRazon: string | null;
  /** Remito origen del proveedor/cliente (numero_remito). */
  remitoOrigen: string | null;
  /** OC / referencia (numero_oc). */
  referencia: string | null;
  transportista: string | null;
  chofer: string | null;
  dominio: string | null;
  lineas: RemitoLine[];
  observaciones: string | null;
  /** business_unit === 'ANMAT' → marca el casillero Producto ANMAT. */
  productoAnmat: boolean;
}

export function RemitoEntradaPdfDocument({ data }: { data: RemitoEntradaData }) {
  const depotLabel = data.depot?.label ?? null;
  return (
    <Document
      title={`Remito de entrada ${data.numero} — ${ORG.brand}`}
      author={`${ORG.brand} — ${ORG.legalName}`}
      subject="Remito de entrada"
      creator="TOPS Operaciones"
      producer="TOPS Operaciones"
    >
      <Page size="A4" style={docPage.page}>
        <DocHeader
          context="TOPS Operaciones"
          title={"REMITO DE\nENTRADA"}
          badge="RE"
          badgeSub="ING"
          subtitle={`Recepción de mercadería${depotLabel ? ` · ${depotLabel}` : ""}`}
        />

        <View style={docPage.body}>
          <SectionTitle num={1} title="Datos del remito" />
          <View style={s.fieldsRow}>
            <FormField label="Remito N.°" value={data.numero} mono grow />
            <FormField label="Fecha" value={data.fecha} mono grow />
            <FormField label="Hora de arribo" value={data.horaArribo} mono grow />
            <FormField label="Depósito" value={depotLabel} strong grow />
          </View>

          <View style={s.twoCols}>
            <View style={s.col}>
              <SectionTitle num={2} title="Recibe" />
              <EmitterBlock depot={data.depot} />
            </View>
            <View style={s.col}>
              <SectionTitle num={3} title="Remitente" />
              <View style={{ marginTop: 8 }}>
                <FormField label="Razón social" value={data.remitenteRazon} strong />
                <View style={{ height: 6 }} />
                <FormField label="CUIT" />
                <View style={{ height: 6 }} />
                <View style={s.twoCols}>
                  <FormField label="Remito origen N.°" value={data.remitoOrigen} mono grow />
                  <FormField
                    label="Orden de servicio / Referencia"
                    value={data.referencia}
                    mono
                    grow
                  />
                </View>
              </View>
            </View>
          </View>

          <SectionTitle num={4} title="Transporte" />
          <View style={s.fieldsRow}>
            <FormField label="Transportista" value={data.transportista} grow />
            <FormField label="Chofer" value={data.chofer} grow />
            <FormField label="DNI" grow />
            <FormField label="Dominio" value={data.dominio} mono grow />
          </View>

          <SectionTitle num={5} title="Detalle de mercadería recibida" />
          <RemitoTable lines={data.lineas} headerLabel="Descripción de la mercadería" />

          <SectionTitle num={6} title="Control de recepción" />
          <CheckRow
            items={[
              { label: "Embalaje conforme" },
              { label: "Precintos íntegros" },
              { label: "Cadena de frío" },
              { label: "Producto ANMAT", checked: data.productoAnmat },
            ]}
          />
          <View style={{ marginTop: 10 }}>
            <FormField label="Observaciones / Discrepancias" value={data.observaciones} />
          </View>

          <View wrap={false}>
            <SectionTitle num={7} title="Conformidades" />
            <View style={s.sigRow}>
              <SignatureBlock
                name="Recibió · Logística TOPS"
                hint="Aclaración / legajo / hora"
              />
              <SignatureBlock name="Transportista" hint="Aclaración / DNI" />
              <SignatureBlock name="Control de calidad" hint="Aclaración / fecha" />
            </View>
            <View style={{ marginTop: 12 }}>
              <WarnBox
                title="Documento no válido como factura"
                text="Comprobante interno de movimiento de mercadería. La recepción se registra en Nexus y queda trazada contra la orden de servicio indicada. Toda discrepancia debe consignarse en el punto 06 al momento de la descarga."
              />
            </View>
          </View>
        </View>

        <DocFooter
          docLine={`Remito de entrada ${data.numero} · TOPS Operaciones`}
          extra="Original · Duplicado"
        />
      </Page>
    </Document>
  );
}

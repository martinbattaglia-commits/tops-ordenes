import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { ORG } from "@/lib/org";
import { LOGO_WHITE_TRANSPARENT } from "../assets/logo";
import { DOC, FONT } from "../tokens";

/**
 * Componentes react-pdf compartidos por todos los documentos del sistema.
 * Anatomía según referencias de Dirección: banda navy con logo y badge,
 * secciones numeradas `01 · …`, bloque TOTAL navy, validación QR+hash y
 * footer navy de tres columnas.
 */

const s = StyleSheet.create({
  band: {
    backgroundColor: DOC.navy,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 30,
    paddingTop: 18,
    paddingBottom: 14,
  },
  logo: { width: 54, height: 54, objectFit: "contain" },
  tagline: {
    color: DOC.onNavySoft,
    fontSize: 5.5,
    fontWeight: 600,
    letterSpacing: 2,
    marginTop: 6,
  },
  headRight: { alignItems: "flex-end" },
  context: {
    color: DOC.red,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  titleRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  title: {
    color: DOC.white,
    fontSize: 19,
    fontWeight: 800,
    textAlign: "right",
    letterSpacing: 0.3,
    lineHeight: 1.05,
  },
  badge: {
    backgroundColor: DOC.white,
    borderRadius: 2,
    marginLeft: 8,
    paddingVertical: 3,
    paddingHorizontal: 5,
    alignItems: "center",
  },
  badgeMain: { color: DOC.navy, fontSize: 12, fontWeight: 800, lineHeight: 1 },
  badgeSub: { color: DOC.navy, fontSize: 4.5, fontWeight: 700, letterSpacing: 0.5, marginTop: 1 },
  docNumber: { color: DOC.white, fontFamily: FONT.mono, fontSize: 7.5, marginTop: 6 },
  redRule: { height: 3, backgroundColor: DOC.red },
  subBand: {
    backgroundColor: DOC.navy,
    paddingHorizontal: 30,
    paddingVertical: 4,
    alignItems: "flex-end",
  },
  subText: {
    color: DOC.onNavySoft,
    fontSize: 5.5,
    fontWeight: 600,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },

  sectionWrap: { marginTop: 10 },
  sectionText: {
    color: DOC.red,
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  sectionRule: { height: 1.5, backgroundColor: DOC.navy, marginTop: 3 },

  fieldLabel: {
    color: DOC.label,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  fieldValue: { color: DOC.ink, fontSize: 9.5 },
  fieldStrong: { color: DOC.navy, fontWeight: 700 },
  fieldMono: { fontFamily: FONT.mono, fontSize: 9 },

  totalBlock: {
    backgroundColor: DOC.navy,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  totalLabel: { color: DOC.red, fontSize: 7, fontWeight: 800, letterSpacing: 1.4 },
  totalNote: { color: DOC.onNavySoft, fontSize: 5.5, letterSpacing: 1, marginTop: 2 },
  totalAmount: { color: DOC.white, fontFamily: FONT.mono, fontSize: 15, fontWeight: 700 },

  warnBox: { borderLeftWidth: 3, borderLeftColor: DOC.red, paddingLeft: 8 },
  warnTitle: {
    color: DOC.red,
    fontSize: 6.5,
    fontWeight: 800,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  warnText: { color: DOC.textSec, fontSize: 6.5, lineHeight: 1.5 },

  validation: { flexDirection: "row", gap: 14, marginTop: 6 },
  qrCol: { alignItems: "center", width: 70 },
  qr: { width: 62, height: 62 },
  qrCaption: {
    color: DOC.labelSoft,
    fontSize: 5,
    fontWeight: 700,
    letterSpacing: 1.2,
    marginTop: 3,
    textTransform: "uppercase",
  },
  validationBody: { flex: 1, justifyContent: "center", gap: 6 },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: DOC.navy,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 30,
    paddingVertical: 10,
  },
  footerCol: { flex: 1 },
  footerBrand: {
    color: DOC.white,
    fontSize: 7,
    fontWeight: 800,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  footerSoft: { color: DOC.onNavySoft, fontSize: 5.5, marginTop: 2 },
  footerPage: { color: DOC.onNavySoft, fontFamily: FONT.mono, fontSize: 6 },
});

/** Estilos de página compartidos: aplicar en cada documento. */
export const docPage = StyleSheet.create({
  page: {
    fontFamily: FONT.sans,
    fontSize: 9,
    color: DOC.ink,
    paddingBottom: 52,
  },
  body: { paddingHorizontal: 30, paddingTop: 2 },
});

const stamp = StyleSheet.create({
  /* Sello de estado del documento: se repite en TODAS las páginas (`fixed`)
     porque un comprobante anulado tiene efecto fiscal y no puede depender de
     que el lector llegue a la última hoja. */
  band: {
    backgroundColor: DOC.red,
    paddingVertical: 5,
    paddingHorizontal: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  text: {
    color: DOC.white,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 3,
  },
  note: { color: DOC.white, fontSize: 7, fontWeight: 700, letterSpacing: 0.6 },
});

/** Franja roja de estado, fija en todas las páginas (p. ej. ANULADA). */
export function DocStatusStamp({ label, note }: { label: string; note?: string }) {
  return (
    <View style={stamp.band} fixed>
      <Text style={stamp.text}>{label}</Text>
      {note ? <Text style={stamp.note}>{note}</Text> : null}
    </View>
  );
}

export function DocHeader({
  context,
  title,
  badge,
  badgeSub,
  docNumber,
  subtitle,
}: {
  context: string;
  title: string;
  badge: string;
  badgeSub?: string;
  docNumber?: string;
  subtitle?: string;
}) {
  return (
    <View>
      <View style={s.band}>
        <View>
          <Image src={LOGO_WHITE_TRANSPARENT} style={s.logo} />
          <Text style={s.tagline}>
            {ORG.legalName.toUpperCase()} · DESDE {ORG.since}
          </Text>
        </View>
        <View style={s.headRight}>
          <Text style={s.context}>{context}</Text>
          <View style={s.titleRow}>
            <Text style={s.title}>{title}</Text>
            <View style={s.badge}>
              <Text style={s.badgeMain}>{badge}</Text>
              {badgeSub ? <Text style={s.badgeSub}>{badgeSub}</Text> : null}
            </View>
          </View>
          {docNumber ? <Text style={s.docNumber}>{docNumber}</Text> : null}
        </View>
      </View>
      <View style={s.redRule} />
      {subtitle ? (
        <View style={s.subBand}>
          <Text style={s.subText}>{subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function SectionTitle({ num, title }: { num: number | string; title: string }) {
  const n = String(num).padStart(2, "0");
  return (
    <View style={s.sectionWrap}>
      <Text style={s.sectionText}>
        {n} · {title}
      </Text>
      <View style={s.sectionRule} />
    </View>
  );
}

export function Field({
  label,
  value,
  mono = false,
  strong = false,
  children,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  strong?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={{ marginBottom: 5 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children ?? (
        <Text style={[s.fieldValue, mono ? s.fieldMono : {}, strong ? s.fieldStrong : {}]}>
          {value === null || value === undefined || value === "" ? "—" : String(value)}
        </Text>
      )}
    </View>
  );
}

export function TotalBlock({
  amount,
  label = "TOTAL",
  note = "PESOS ARGENTINOS",
}: {
  amount: string;
  label?: string;
  note?: string;
}) {
  return (
    <View style={s.totalBlock}>
      <View>
        <Text style={s.totalLabel}>{label}</Text>
        <Text style={s.totalNote}>{note}</Text>
      </View>
      <Text style={s.totalAmount}>{amount}</Text>
    </View>
  );
}

export function WarnBox({ title, text }: { title: string; text: string }) {
  return (
    <View style={s.warnBox}>
      <Text style={s.warnTitle}>{title}</Text>
      <Text style={s.warnText}>{text}</Text>
    </View>
  );
}

export function ValidationBlock({
  qrDataUrl,
  qrCaption,
  children,
}: {
  qrDataUrl?: string | null;
  qrCaption: string;
  children: ReactNode;
}) {
  return (
    <View style={s.validation}>
      <View style={s.qrCol}>
        {qrDataUrl ? (
          <Image src={qrDataUrl} style={s.qr} />
        ) : (
          <View style={[s.qr, { backgroundColor: DOC.bgSoft }]} />
        )}
        <Text style={s.qrCaption}>{qrCaption}</Text>
      </View>
      <View style={s.validationBody}>{children}</View>
    </View>
  );
}

export function DocFooter({ docLine, extra }: { docLine: string; extra?: string }) {
  return (
    <View style={s.footer} fixed>
      <View style={s.footerCol}>
        <Text style={s.footerBrand}>Logística TOPS</Text>
        <Text style={s.footerSoft}>
          Buenos Aires, Argentina · {ORG.website} · {ORG.phone}
        </Text>
      </View>
      <View style={s.footerCol}>
        <Text style={s.footerBrand}>{ORG.legalName}</Text>
        <Text style={s.footerSoft}>{docLine}</Text>
      </View>
      <View style={{ alignItems: "flex-end", width: 80 }}>
        {extra ? <Text style={s.footerSoft}>{extra}</Text> : null}
        <Text
          style={s.footerPage}
          render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
        />
      </View>
    </View>
  );
}

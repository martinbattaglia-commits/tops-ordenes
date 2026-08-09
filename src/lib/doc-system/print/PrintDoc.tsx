import { ORG } from "@/lib/org";
import { DOC } from "../tokens";

/**
 * Encabezado y pie institucionales para vistas imprimibles (HTML, no react-pdf).
 * Son `print-only`: no aparecen en pantalla, así que las pantallas operativas
 * quedan intactas y sólo cambia lo que sale por la impresora.
 *
 * Anatomía equivalente a la de los PDF del doc-system (banda navy, regla roja,
 * pie de tres columnas), para que un reporte impreso y un comprobante se lean
 * como el mismo sistema.
 *
 * Nota: en HTML no hay numeración de página confiable entre navegadores, así
 * que el encabezado y el pie se imprimen una vez, al principio y al final.
 */

export function PrintDocHeader({
  context,
  title,
  subtitle,
}: {
  context: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="print-only">
      <div
        className="print-doc-header"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          background: DOC.navy,
          color: DOC.white,
          padding: "10mm 8mm 6mm",
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.02em" }}>
            <span style={{ color: DOC.red }}>LOGISTICA</span> TOPS
          </div>
          <div
            style={{
              fontSize: 6.5,
              fontWeight: 600,
              letterSpacing: "0.2em",
              color: DOC.onNavySoft,
              marginTop: 3,
            }}
          >
            {ORG.legalName.toUpperCase()} · DESDE {ORG.since}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              color: DOC.red,
              fontSize: 7,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            {context}
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{title}</div>
          {subtitle ? (
            <div style={{ fontSize: 8, color: DOC.onNavySoft, marginTop: 3 }}>{subtitle}</div>
          ) : null}
        </div>
      </div>
      <div className="print-doc-rule" style={{ height: 3, background: DOC.red }} />
    </div>
  );
}

export function PrintDocFooter({ docLine }: { docLine: string }) {
  return (
    <div className="print-only" style={{ marginTop: "6mm" }}>
      <div
        className="print-doc-footer"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: DOC.navy,
          color: DOC.white,
          padding: "5mm 8mm",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 7,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Logística TOPS
          </div>
          <div style={{ fontSize: 6, color: DOC.onNavySoft, marginTop: 2 }}>
            Buenos Aires, Argentina · {ORG.website} · {ORG.phone}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 7,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            {ORG.legalName}
          </div>
          <div style={{ fontSize: 6, color: DOC.onNavySoft, marginTop: 2 }}>{docLine}</div>
        </div>
      </div>
    </div>
  );
}

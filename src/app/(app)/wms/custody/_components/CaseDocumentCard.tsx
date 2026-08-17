import { Icon } from "@/components/Icon";
import { fmtDateTime } from "@/lib/utils";
import type { CustodyDocument } from "@/lib/custody/certificate-emission";

/**
 * 2-C-2 · EL DOCUMENTO PROBATORIO DEL CASO.
 *
 * Es la superficie que faltaba: `evaluateCertificateEligibility` decidía entre
 * certificado y acta desde hacía dos bloques y nadie la llamaba, así que el
 * documento no existía para nadie fuera de los tests.
 *
 * ─── NO REEMPLAZA AL POD, Y POR ESO ESTÁ SEPARADO ────────────────────────
 *
 * El POD prueba la ENTREGA, con la firma de quien recibe, y vive en su propia
 * compuerta. Éste prueba la INTEGRIDAD de la unidad bajo custodia y sale de la
 * decisión humana. Conviven, y ninguno bloquea al otro.
 *
 * ─── EL ACTA NO ES UN ERROR ──────────────────────────────────────────────
 *
 * Un caso liberado por override humano no alcanza la barra probatoria completa,
 * y entonces el documento correcto es un ACTA DE INSPECCIÓN, no un certificado.
 * La pantalla lo dice con esas palabras y enumera qué faltó — ya traducido a qué
 * hacer, no a un código.
 */
export function CaseDocumentCard({ doc }: { doc: CustodyDocument }) {
  const esCertificado = doc.isCertificate;
  const titulo = esCertificado ? "Certificado de integridad" : "Acta de inspección";
  const icono = esCertificado ? "shield" : "report";

  return (
    <section
      className="card mt-4 p-4"
      aria-labelledby="documento-title"
      data-documento={esCertificado ? "certificado" : "acta"}
    >
      <div className="flex items-center gap-2">
        <Icon name={icono} className="h-5 w-5" />
        <h2 id="documento-title" className="text-sm font-semibold uppercase tracking-wide">
          Documento probatorio
        </h2>
      </div>

      <p className="mt-2 text-lg font-bold" data-documento-titulo="true">
        {titulo}
      </p>

      {esCertificado ? (
        <p className="mt-1 text-sm">
          El caso cumple todas las condiciones probatorias: cadena verificada, análisis
          en modo real, decisión humana coherente y evidencia de inspección canónica.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm">
            Este caso no alcanza la barra del certificado. Se emite un acta de
            inspección, que deja constancia de lo actuado y de lo que faltó.
          </p>
          {doc.reasons.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm" data-documento-motivos="true">
              {doc.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {doc.persisted ? (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs" data-documento-asiento="true">
          <dt className="font-semibold">Emitido</dt>
          <dd>{fmtDateTime(doc.persisted.issuedAt)}</dd>
          <dt className="font-semibold">Base de la liberación</dt>
          <dd>
            {doc.persisted.basis === "vision_policy"
              ? "Política de visión"
              : doc.persisted.basis === "human_override"
                ? "Override humano"
                : "Liberación previa al análisis"}
          </dd>
        </dl>
      ) : (
        <p className="mt-4 text-xs">
          {doc.missingPersistedRow
            ? "El caso figura liberado y no se encontró el asiento del certificado. Avisá a supervisión."
            : "Todavía no hay asiento: el documento se emite con la decisión humana de liberación."}
        </p>
      )}
    </section>
  );
}

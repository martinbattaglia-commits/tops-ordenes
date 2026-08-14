import { Icon } from "@/components/Icon";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";
import { PodDownloadButton } from "./PodDownloadButton";

/**
 * Compuerta del POD. Mientras no exista una decisión humana de LIBERACIÓN, el
 * POD no se ofrece: no se muestra deshabilitado «por las dudas», se muestra
 * bloqueado y se dice por qué.
 */
export function CasePodGate({
  view,
  shipmentId,
  hasPdf,
}: {
  view: CustodyCaseView;
  shipmentId: string | null;
  hasPdf: boolean;
}) {
  if (view.podBlocked || !shipmentId) {
    return (
      <div className="card p-3" role="status">
        <p className="flex items-center gap-2 text-xs text-status-warning">
          <Icon name="lock" size={12} aria-hidden="true" />
          <span>{view.podBlockedReason ?? "POD bloqueado"}</span>
        </p>
      </div>
    );
  }
  return <PodDownloadButton shipmentId={shipmentId} hasPdf={hasPdf} />;
}

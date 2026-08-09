// Nexus Link · LINK-WA-002 F1a — Importador de WhatsApp Comercial Histórico.
// Gate FAIL-CLOSED: sólo rol admin (D2); las server actions re-validan siempre.
// Descubrible para admin desde el home de Nexus Link; sin rediseñar el sidebar.

import { getProfileRole } from "@/lib/rbac/boot-permissions";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccessWaCommercialImport } from "@/lib/connect/wa-import/access";
import { WaImportForm } from "../_components/WaImportForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Importar WhatsApp histórico" };

export default async function WaImportPage() {
  const role = await getProfileRole();
  if (!canAccessWaCommercialImport(role)) {
    return <AccesoRestringido modulo="Importador de WhatsApp histórico" />;
  }
  return (
    <div className="mx-auto w-full max-w-2xl overflow-y-auto px-5 py-6">
      <div className="eyebrow-tiny">Nexus Link · LINK-WA-002</div>
      <h1 className="page-title">Importar WhatsApp histórico</h1>
      <p className="page-subtitle">
        Subí el export de un chat («Exportar chat» → Sin archivos). El hilo se crea como
        canal WhatsApp, nace en Archivo y sólo lo ven administradores. Nada toca el
        teléfono, Meta ni Clientify.
      </p>
      <div className="mt-4">
        <WaImportForm />
      </div>
    </div>
  );
}

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listPositionOptions } from "@/lib/wms/data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { NewReceptionForm } from "./NewReceptionForm";

export const metadata = { title: "Nueva recepción · WMS" };
export const dynamic = "force-dynamic";

export default async function NuevaRecepcionPage() {
  let positions: Awaited<ReturnType<typeof listPositionOptions>>;
  try {
    positions = await listPositionOptions();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Nueva recepción no disponible"
        migration="0020_wms_physical_model · 0025_wms_receptions"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Recepciones</div>
          <h1 className="page-title">Nueva recepción</h1>
          <p className="page-subtitle">
            Cargá la cabecera y los ítems. Al crear, la recepción queda en
            <strong> pendiente</strong>; confirmás desde el listado para impactar el inventario.
          </p>
        </div>
        <Link href="/wms/recepciones" className="btn btn-ghost btn-sm mt-1">
          <Icon name="arrow-left" size={12} /> Recepciones
        </Link>
      </div>

      <NewReceptionForm positions={positions} />
    </div>
  );
}

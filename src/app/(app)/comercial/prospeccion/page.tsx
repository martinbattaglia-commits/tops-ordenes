import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import {
  listProspectsWithScores,
  getQualificationSummary,
} from "@/lib/prospeccion/read/qualification-data";
import { ProspeccionView } from "./ProspeccionView";

export const metadata = { title: "Prospección Inteligente · Comercial" };
export const dynamic = "force-dynamic";

export default async function ProspeccionPage() {
  if (!(await canAccess("prospeccion.view"))) {
    return <AccesoRestringido modulo="Comercial · Prospección Inteligente" />;
  }

  const [{ items }, summary] = await Promise.all([
    listProspectsWithScores(),
    getQualificationSummary(),
  ]);

  const [canCreate, canApprove, canExport] = await Promise.all([
    canAccess("prospeccion.create"),
    canAccess("prospeccion.approve"),
    canAccess("prospeccion.export"),
  ]);

  return (
    <ProspeccionView
      items={items}
      summary={summary}
      canCreate={canCreate}
      canApprove={canApprove}
      canExport={canExport}
    />
  );
}

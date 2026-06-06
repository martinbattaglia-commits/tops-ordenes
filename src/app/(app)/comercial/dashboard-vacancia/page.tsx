import { DashboardVacanciaView } from "./DashboardVacanciaView";
import { getCommittedSnapshot } from "@/lib/comercial/committed-capacity";

export const metadata = { title: "Dashboard Corporativo de Vacancia · TOPS" };
export const dynamic = "force-dynamic";

/**
 * Dashboard Corporativo de Vacancia TOPS — consolida Luján 3159 + Magaldi 1765.
 * Consume el motor `corporate-capacity.ts` + el CommittedSnapshot del CRM
 * (F2.1-4). Si el CRM no tiene compromisos/tabla, el snapshot es {} → vacancia
 * física (activación segura). No destructivo.
 */
export default async function DashboardVacanciaPage() {
  const committed = await getCommittedSnapshot();
  return <DashboardVacanciaView committed={committed} />;
}

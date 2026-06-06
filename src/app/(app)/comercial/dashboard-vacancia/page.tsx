import { DashboardVacanciaView } from "./DashboardVacanciaView";

export const metadata = { title: "Dashboard Corporativo de Vacancia · TOPS" };

/**
 * Dashboard Corporativo de Vacancia TOPS — consolida Luján 3159 + Magaldi 1765.
 * Consume EXCLUSIVAMENTE el motor `src/lib/wms/corporate-capacity.ts`.
 * Vista nueva, no destructiva. Sin Supabase.
 */
export default function DashboardVacanciaPage() {
  return <DashboardVacanciaView />;
}

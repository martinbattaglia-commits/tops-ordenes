import { getTableroData } from "@/lib/comercial/dashboard-data";
import { KpiCards } from "@/components/comercial/tablero/KpiCards";
import { FunnelChart } from "@/components/comercial/tablero/FunnelChart";
import { DealsTable } from "@/components/comercial/tablero/DealsTable";

export const metadata = { title: "Tablero Comercial · Clientify" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TableroPage() {
  const data = await getTableroData();

  if (!data.configured) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Tablero Comercial</h1>
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Clientify no está configurado (<code>CLIENTIFY_API_KEY</code>). El tablero se activa
          cuando la integración esté seteada y el cron de las 21:00 haya corrido al menos una vez.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-400">Comercial · CRM</div>
          <h1 className="text-2xl font-bold">Tablero de Oportunidades</h1>
        </div>
        <div className="text-xs text-slate-400">
          Última sync: {data.lastSync ? new Date(data.lastSync).toLocaleString("es-AR") : "—"}
        </div>
      </header>

      <KpiCards kpis={data.kpis} trends={data.trends} />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FunnelChart deals={data.deals} />
      </section>
      <DealsTable deals={data.deals} />
    </div>
  );
}

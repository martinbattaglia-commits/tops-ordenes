import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getLibroDiario } from "@/lib/contabilidad/data";
import { SOURCE_LABEL, type DiarioRow } from "@/lib/contabilidad/types";

export const metadata = { title: "Libro diario" };
export const dynamic = "force-dynamic";

export default async function LibroDiarioPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const periodo = typeof searchParams?.periodo === "string" ? searchParams.periodo : null;

  let rows: DiarioRow[];
  try {
    rows = await getLibroDiario(periodo);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Libro diario no disponible"
        migration="0086_accounting_reports"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  // Agrupar por asiento.
  const byEntry = new Map<string, DiarioRow[]>();
  for (const r of rows) {
    const arr = byEntry.get(r.entryId) ?? [];
    arr.push(r);
    byEntry.set(r.entryId, arr);
  }
  const totalDebe = rows.reduce((a, r) => a + r.debit, 0);
  const totalHaber = rows.reduce((a, r) => a + r.credit, 0);

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Libro diario</h1>
        <p className="text-sm text-fg-secondary">
          {byEntry.size} asientos · {rows.length} líneas{periodo ? ` · período ${periodo}` : ""}.
          Debe {fmtCurrency(totalDebe)} = Haber {fmtCurrency(totalHaber)}.
        </p>
      </header>

      {byEntry.size === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">
          No hay asientos posteados{periodo ? ` para ${periodo}` : ""}.
        </div>
      ) : (
        <div className="space-y-4">
          {[...byEntry.entries()].map(([entryId, lines]) => {
            const head = lines[0];
            return (
              <div key={entryId} className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-bg-subtle border-b border-border-subtle">
                  <div className="text-sm">
                    <span className="font-bold text-fg-brand">Asiento N° {head.entryNumber ?? "—"}</span>
                    <span className="text-fg-muted"> · {head.entryDate}</span>
                    <span className="text-fg-muted"> · {SOURCE_LABEL[head.sourceType] ?? head.sourceType}</span>
                  </div>
                  <div className="text-xs text-fg-secondary">{head.asientoDescripcion}</div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th className="px-4 py-1.5">Cuenta</th>
                      <th className="px-4 py-1.5">Detalle</th>
                      <th className="px-4 py-1.5 text-right">Debe</th>
                      <th className="px-4 py-1.5 text-right">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={`${l.entryId}-${l.lineNo}`} className="border-t border-border-subtle/40">
                        <td className="px-4 py-1.5">
                          <span className="font-mono text-xs text-fg-muted">{l.cuentaCodigo}</span>{" "}
                          {l.cuentaNombre}
                          {l.centroCosto ? <span className="text-xs text-fg-muted"> · {l.centroCosto}</span> : null}
                        </td>
                        <td className="px-4 py-1.5 text-fg-secondary">{l.lineaDescripcion}</td>
                        <td className="px-4 py-1.5 text-right">{l.debit ? fmtCurrency(l.debit) : ""}</td>
                        <td className="px-4 py-1.5 text-right">{l.credit ? fmtCurrency(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

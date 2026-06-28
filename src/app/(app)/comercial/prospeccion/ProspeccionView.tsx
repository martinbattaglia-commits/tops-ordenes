"use client";

// Vista de la bandeja de Prospección (F0): tabla READ-ONLY + wizard de import drag&drop.
// Componente de borde: sin reglas de negocio; orquesta UI + llama al engine + server action vía ImportWizard.
import type { ProspectListItem, ProspectsSource } from "@/lib/prospeccion/read/prospects-data";
import { ImportWizard } from "./ImportWizard";

const STATUS_LABEL: Record<string, string> = {
  raw: "Capturado", imported: "Importado", enriquecido: "Enriquecido", scoreado: "Calificado",
  con_ia: "En revisión", aprobado: "Aprobado", sincronizado: "Sincronizado",
  cliente_creado: "Cliente", rechazado: "Rechazado", duplicado: "Duplicado",
};

export function ProspeccionView({
  items,
  source,
  canCreate,
}: {
  items: ProspectListItem[];
  source: ProspectsSource;
  canCreate: boolean;
}) {
  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Prospección Inteligente</h1>
          <p className="text-sm text-gray-500">
            Bandeja read-only (F0) · LinkedIn / CSV → Nexus → (aprobación humana) → CRM. Nada va directo a Clientify.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            source === "supabase" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          Fuente: {source === "supabase" ? "Supabase" : "muestra local"}
        </span>
      </header>

      {canCreate && <ImportWizard />}

      <section className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Short ID</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Contacto</th>
              <th className="px-3 py-2">Cargo</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">CUIT</th>
              <th className="px-3 py-2">Creado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  Sin prospectos todavía. Importá un CSV o cargá uno manual.
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs">{p.shortId ?? "—"}</td>
                  <td className="px-3 py-2">{STATUS_LABEL[p.status] ?? p.status}</td>
                  <td className="px-3 py-2">{p.companyName ?? "—"}</td>
                  <td className="px-3 py-2">{p.fullName ?? "—"}</td>
                  <td className="px-3 py-2">{p.cargo ?? "—"}</td>
                  <td className="px-3 py-2">{p.email ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.cuit ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{p.createdAt.slice(0, 10)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}


"use client";

// Vista de la bandeja de Prospección (F0): tabla READ-ONLY + panel de import (CSV/manual).
// Componente de borde: sin reglas de negocio; invoca la server action `importProspectsAction`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importProspectsAction,
  type ImportProspectsActionResult,
} from "@/lib/prospeccion/adapters/driving/import-actions";
import type { ProspectListItem, ProspectsSource } from "@/lib/prospeccion/read/prospects-data";

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

      {canCreate && <ImportPanel />}

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

function ImportPanel() {
  const [source, setSource] = useState("csv");
  const [csvText, setCsvText] = useState("");
  const [msg, setMsg] = useState<ImportProspectsActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onImport = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await importProspectsAction({ source, csvText });
      setMsg(res);
      if (res.ok) {
        setCsvText("");
        // CR-HIGH #5: revalidatePath del servidor no repinta este client component (recibió items
        // por props); router.refresh() vuelve a ejecutar el server component y trae la bandeja fresca.
        router.refresh();
      }
    });
  };

  return (
    <section className="rounded-lg border border-gray-200 p-4">
      <h2 className="mb-2 text-sm font-semibold">Importar prospectos (CSV / pegado)</h2>
      <p className="mb-2 text-xs text-gray-500">
        Encabezado + filas. Columnas reconocidas: empresa, cuit, website, nombre, cargo, email, telefono, linkedin.
      </p>
      <div className="mb-2 flex items-center gap-2">
        <label className="text-xs text-gray-600">Origen</label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="csv">CSV</option>
          <option value="manual">Manual</option>
          <option value="paste">Pegado</option>
          <option value="linkedin_sales_navigator">LinkedIn Sales Navigator (export)</option>
        </select>
      </div>
      <textarea
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        rows={5}
        placeholder={"empresa,cuit,email,nombre,cargo\nACME,30701112234,laura@acme.test,Laura Gómez,Operaciones"}
        className="mb-2 w-full rounded border border-gray-300 p-2 font-mono text-xs"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={onImport}
          disabled={pending || csvText.trim() === ""}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Importando…" : "Importar"}
        </button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.message}</span>
        )}
      </div>
    </section>
  );
}

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listClients } from "@/lib/data/orders";

export const metadata = { title: "Clientes" };

export default async function ClientsPage() {
  const clients = await listClients();

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Maestro · {clients.length} clientes</div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">
            Razón social, CUIT, contacto y email para envío automático de comprobantes.
          </p>
        </div>
        <button className="btn btn-primary btn-sm">
          <Icon name="plus" size={14} stroke={2.2} />
          <span>Nuevo cliente</span>
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>CUIT</th>
                <th>Contacto</th>
                <th>Email</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td className="cell-cliente">
                    <span className="font-semibold">{c.razon}</span>
                    <span className="cuit">{c.domicilio}</span>
                  </td>
                  <td className="font-mono text-xs">{c.cuit}</td>
                  <td className="text-sm">{c.contacto ?? "—"}</td>
                  <td className="text-sm">{c.email ?? "—"}</td>
                  <td>
                    <div className="flex gap-1">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            t === "ANMAT"
                              ? "bg-tops-red/10 text-tops-red"
                              : "bg-tops-blue-700/10 text-tops-blue-700"
                          }`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-stroke-soft">
          {clients.map((c) => (
            <div key={c.id} className="p-4">
              <div className="font-semibold text-fg-primary">{c.razon}</div>
              <div className="text-xs text-fg-muted font-mono mb-1">{c.cuit}</div>
              <div className="text-xs text-fg-secondary">
                {c.contacto ?? "—"} · {c.email ?? "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-fg-muted mt-4">
        Para crear / editar clientes desde el CRM, conectá Clientify desde{" "}
        <Link href="/settings" className="text-fg-link">
          Configuración
        </Link>
        .
      </p>
    </div>
  );
}

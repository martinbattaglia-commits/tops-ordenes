import { redirect } from "next/navigation";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/utils";
import { InviteUserForm } from "./InviteUserForm";
import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";

export const metadata = { title: "Usuarios" };
export const dynamic = "force-dynamic";

interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "operaciones" | "supervisor" | "cliente";
  active: boolean;
  created_at: string;
  last_seen_at: string | null;
}

export default async function UsersPage() {
  if (!(await canAccess("sistema.view"))) return <AccesoRestringido modulo="Sistema · Usuarios" />;
  if (env.app.demoMode) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl">
        <div className="card card-pad">
          <h1 className="text-xl font-bold text-fg-brand mb-1">Usuarios</h1>
          <p className="text-fg-secondary text-sm">
            La gestión de usuarios requiere Supabase configurado. Estás en modo demo.
          </p>
        </div>
      </div>
    );
  }

  const supabase = createClient();
  if (!supabase) redirect("/settings");

  const { data: me } = await supabase.auth.getUser();
  if (!me.user) redirect("/login");

  const { data: meProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", me.user.id)
    .maybeSingle();
  if (meProfile?.role !== "admin") {
    return (
      <div className="p-4 lg:p-8 max-w-2xl">
        <div className="card card-pad text-center">
          <Icon name="lock" size={28} className="mx-auto mb-2 text-fg-muted" />
          <h1 className="text-xl font-bold text-fg-brand mb-1">Acceso restringido</h1>
          <p className="text-fg-secondary text-sm">
            Solo los administradores pueden gestionar usuarios.
          </p>
        </div>
      </div>
    );
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active, created_at, last_seen_at")
    .order("created_at", { ascending: false });

  return (
    <div className="p-4 lg:p-8 max-w-4xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Equipo · {profiles?.length ?? 0} usuarios</div>
          <h1 className="page-title">Usuarios</h1>
          <p className="page-subtitle">
            Invitá nuevos miembros y asignales un rol. Cada usuario recibe un email
            con un magic link para definir su contraseña.
          </p>
        </div>
      </div>

      <InviteUserForm />

      <div className="card overflow-hidden mt-4">
        <table className="tbl">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Último acceso</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p: Profile) => (
              <tr key={p.id}>
                <td className="font-semibold">{p.full_name ?? "—"}</td>
                <td className="text-xs font-mono">{p.email ?? "—"}</td>
                <td>
                  <span className="badge badge-info">{p.role}</span>
                </td>
                <td>
                  <span className={`badge ${p.active ? "badge-success" : "badge-muted"}`}>
                    {p.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="text-xs text-fg-secondary">
                  {p.last_seen_at ? fmtDateTime(p.last_seen_at) : "Nunca"}
                </td>
              </tr>
            ))}
            {(!profiles || profiles.length === 0) && (
              <tr>
                <td colSpan={5} className="text-center text-fg-muted py-8 text-sm">
                  Aún no hay usuarios. Invitá al primero arriba.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

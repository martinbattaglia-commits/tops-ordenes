import Link from "next/link";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";
import { EmpleadoForm } from "@/components/rrhh/EmpleadoForm";

export const metadata = { title: "Nuevo empleado · RRHH" };
export const dynamic = "force-dynamic";

export default async function NuevoEmpleadoPage() {
  if (!(await canAccess("rrhh.edit"))) return <AccesoRestringido modulo="RRHH · Alta de empleado" />;
  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <Link href="/rrhh/empleados" className="text-[11px] text-fg-link hover:underline">← Empleados</Link>
          <h1 className="page-title mt-1">Alta de empleado</h1>
          <p className="page-subtitle">Legajo digital · Capital Humano. Los datos sensibles quedan protegidos por rol (RLS).</p>
        </div>
      </div>
      <EmpleadoForm />
    </div>
  );
}

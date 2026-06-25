import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { listProspects } from "@/lib/prospeccion/read/prospects-data";
import { ProspeccionView } from "./ProspeccionView";

export const metadata = { title: "Prospección Inteligente · Comercial" };
export const dynamic = "force-dynamic";

/**
 * Bandeja de Prospección Inteligente (F0) — primer lugar donde Comercial ve prospectos
 * importados (CSV/manual). Read-only + panel de import. "Nada va directo a Clientify":
 * el prospecto vive en `prospeccion_prospects` y solo tras aprobación humana (F1+) se sincroniza.
 * Fuente Supabase (`prospeccion_prospects`, RLS) con fallback a muestra local mientras las
 * migraciones 0088/0089 estén entregadas pero NO aplicadas.
 */
export default async function ProspeccionPage() {
  if (!(await canAccess("prospeccion.view"))) {
    return <AccesoRestringido modulo="Comercial · Prospección Inteligente" />;
  }
  const { items, source } = await listProspects();
  const canCreate = await canAccess("prospeccion.create");
  return <ProspeccionView items={items} source={source} canCreate={canCreate} />;
}

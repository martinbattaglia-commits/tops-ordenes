import Link from "next/link";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getFiscalConfig, listPuntosVenta } from "@/lib/invoicing/data";
import { FiscalConfigForm } from "./FiscalConfigForm";
import { PuntosVentaManager } from "./PuntosVentaManager";

export const metadata = { title: "Configuración fiscal" };

export default async function FiscalSettingsPage() {
  const [config, puntosVenta] = await Promise.all([
    getFiscalConfig(),
    listPuntosVenta({ includeInactive: true }),
  ]);

  // Gating: en producción sólo admin edita. En demo, vista de sólo lectura.
  let isAdmin = false;
  if (!env.app.demoMode) {
    const supabase = createClient();
    if (supabase) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: meProfile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        isAdmin = meProfile?.role === "admin";
      }
    }
  }

  const canEdit = !env.app.demoMode && isAdmin;

  return (
    <div className="p-4 lg:p-8 max-w-4xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Facturación · ARCA</div>
          <h1 className="page-title">Configuración fiscal</h1>
          <p className="page-subtitle">
            Datos del emisor, puntos de venta y ambiente de emisión. Estos datos se
            imprimen en cada comprobante electrónico — no se hardcodean en el código.
          </p>
        </div>
        <Link href="/billing" className="btn btn-ghost btn-sm mt-1">
          <Icon name="bill" size={12} /> Ir a Facturación
        </Link>
      </div>

      {env.app.demoMode && (
        <div className="mb-4 rounded-md bg-status-warning/10 text-status-warning text-sm px-3 py-2 border border-status-warning/20">
          Modo demo: la configuración se muestra de sólo lectura. Configurá Supabase para
          editarla y persistirla.
        </div>
      )}
      {!env.app.demoMode && !canEdit && (
        <div className="mb-4 rounded-md bg-neutral-50 text-fg-secondary text-sm px-3 py-2 border border-stroke-soft flex items-center gap-2">
          <Icon name="lock" size={14} className="text-fg-muted" />
          Sólo los administradores pueden editar la configuración fiscal. La estás viendo
          en modo lectura.
        </div>
      )}

      <FiscalConfigForm
        config={config}
        puntosVenta={puntosVenta}
        canEdit={canEdit}
        arcaConfigured={env.arca.configured}
      />

      <div className="mt-6">
        <PuntosVentaManager puntosVenta={puntosVenta} canEdit={canEdit} />
      </div>

      <p className="text-xs text-fg-muted mt-4">
        Ambiente actual de la app:{" "}
        <span className="font-semibold">{config.ambiente}</span>. WSAA/WSFEv1 apuntan a los
        hosts oficiales de ARCA; en SANDBOX se usa el Mock ARCA Service sin validez fiscal.
      </p>
    </div>
  );
}

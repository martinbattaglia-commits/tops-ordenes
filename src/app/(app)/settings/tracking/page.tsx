import Link from "next/link";
import { Icon } from "@/components/Icon";
import { env } from "@/lib/env";
import { getProvider, DEFAULT_PROVIDER_ID } from "@/lib/tracking/provider";
import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";

export const metadata = { title: "Tracking · Configuración" };
export const dynamic = "force-dynamic";

/**
 * Settings → Tracking (PLACEHOLDER estructural).
 *
 * Deja lista la estructura de configuración del módulo de tracking sin conectar
 * nada todavía: provider, endpoint, API key (estado, jamás el valor), device IDs
 * y estado de conexión. Los campos de edición están deshabilitados — la gestión
 * real (alta de dispositivos, rotación de token) se entrega en una fase próxima.
 */
export default async function TrackingSettingsPage() {
  if (!(await canAccess("sistema.view"))) return <AccesoRestringido modulo="Sistema · Tracking" />;
  const provider = getProvider(DEFAULT_PROVIDER_ID);
  const ingestUrl = `${env.app.url}/api/tracking/ingest`;
  const tokenConfigured = env.tracking.configured;
  const mapConfigured = env.tracking.mapEnabled;
  const realtimeConfigured = env.supabase.configured;

  return (
    <div className="p-4 lg:p-8 max-w-3xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Sistema · Integraciones</div>
          <h1 className="page-title">Tracking</h1>
          <p className="page-subtitle">
            Configuración del módulo de seguimiento de flota. Estructura preparada;
            la administración de dispositivos y credenciales llega en una fase próxima.
          </p>
        </div>
        <Link href="/operaciones/tracking" className="btn btn-ghost btn-sm mt-1">
          <Icon name="arrow-left" size={12} /> Ir al tracking
        </Link>
      </div>

      <div className="card card-pad mb-4 flex items-start gap-3 border-status-warning/30 bg-status-warning/5">
        <Icon name="bolt" size={18} className="text-status-warning mt-0.5 flex-shrink-0" />
        <div className="text-sm text-fg-secondary">
          <strong className="text-fg-brand">Placeholder no conectado.</strong> Esta pantalla deja la
          estructura lista. Los campos no guardan cambios todavía; las credenciales se configuran por
          variables de entorno (<code className="font-mono text-[11px]">.env.local</code> / Netlify).
        </div>
      </div>

      {/* Proveedor */}
      <Section title="Proveedor de datos" icon="truck">
        <Field label="Provider activo">
          <input
            className="input w-full"
            value={provider ? provider.label : "—"}
            disabled
            readOnly
          />
        </Field>
        <p className="text-xs text-fg-muted mt-1">
          Arquitectura desacoplada (Provider → Engine → Persistence → Realtime). Soporta sumar
          Teltonika / Queclink / Ruptela sin refactor.
        </p>
      </Section>

      {/* Conexión */}
      <Section title="Conexión de ingesta" icon="bolt">
        <Field label="Endpoint">
          <input className="input w-full font-mono text-xs" value={ingestUrl} disabled readOnly />
        </Field>
        <Field label="API Key (token de ingesta)">
          <input
            className="input w-full font-mono"
            type="password"
            value={tokenConfigured ? "configurada-en-entorno" : ""}
            placeholder="No configurada — setear TRACKING_INGEST_TOKEN"
            disabled
            readOnly
          />
        </Field>
        <StatusRow label="Token de ingesta" ok={tokenConfigured}
          value={tokenConfigured ? "Configurada" : "No configurada"} />
      </Section>

      {/* Dispositivos */}
      <Section title="Dispositivos (Device IDs)" icon="pin">
        <p className="text-sm text-fg-secondary mb-3">
          Cada vehículo se vincula a un{" "}
          <code className="font-mono text-[11px]">device_identifier</code> (ID del Traccar Client).
          La administración desde esta pantalla se habilita en una fase próxima.
        </p>
        <div className="rounded-lg border border-dashed border-stroke-soft p-6 text-center">
          <div className="w-10 h-10 rounded-lg bg-bg-surface-alt text-fg-muted grid place-items-center mx-auto mb-2">
            <Icon name="pin" size={18} />
          </div>
          <div className="text-sm font-semibold text-fg-secondary">Gestión de dispositivos</div>
          <p className="text-xs text-fg-muted mt-1">
            Alta, edición y vínculo device → vehículo. Por ahora se cargan vía SQL.
          </p>
        </div>
      </Section>

      {/* Estado de conexión */}
      <Section title="Estado de conexión" icon="dashboard">
        <StatusRow label="Mapa (Mapbox)" ok={mapConfigured}
          value={mapConfigured ? "Token presente" : "Sin token (fallback AmbaMap)"} />
        <StatusRow label="Realtime (Supabase)" ok={realtimeConfigured}
          value={realtimeConfigured ? "Conectado" : "No configurado"} />
        <StatusRow label="Ingesta de posiciones" ok={tokenConfigured}
          value={tokenConfigured ? "Habilitada" : "Deshabilitada"} />
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: Parameters<typeof Icon>[0]["name"];
  children: React.ReactNode;
}) {
  return (
    <div className="card card-pad mb-4">
      <div className="flex items-center gap-2 text-base font-bold text-fg-brand mb-3">
        <Icon name={icon} size={16} className="text-fg-muted" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3 last:mb-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-stroke-soft/60 last:border-0">
      <span className="text-sm text-fg-secondary">{label}</span>
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${ok ? "text-status-success" : "text-fg-muted"}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-status-success" : "bg-fg-muted/40"}`} />
        {value}
      </span>
    </div>
  );
}

import { env } from "@/lib/env";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Configuración" };

export default function SettingsPage() {
  return (
    <div className="p-4 lg:p-8 max-w-3xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Cuenta · Sistema</div>
          <h1 className="page-title">Configuración</h1>
          <p className="page-subtitle">
            Estado de integraciones, reglas de envío y preferencias del sistema.
          </p>
        </div>
      </div>

      <Section title="Estado del sistema">
        <Row
          label="Modo de operación"
          value={env.app.demoMode ? "DEMO (sin Supabase)" : "Producción"}
          ok={!env.app.demoMode}
        />
        <Row label="Supabase" value={env.supabase.configured ? "Conectado" : "No configurado"} ok={env.supabase.configured} />
        <Row label="Resend (emails)" value={env.email.resendKey ? "API key presente" : "Sin API key"} ok={Boolean(env.email.resendKey)} />
        <Row label="App URL pública" value={env.app.url} />
      </Section>

      <Section title="Reglas de envío automático">
        <p className="text-sm text-fg-secondary mb-3">
          Cuando se firma una orden, el sistema envía el comprobante a:
        </p>
        <Recipients label="Siempre" emails={[env.email.admin.ruth, env.email.admin.joseluis]} />
        <Recipients label="Si depósito = Magaldi" emails={[env.email.depot.magaldi]} />
        <Recipients label="Si depósito = Luján" emails={[env.email.depot.lujan]} />
        <Recipients label="Cliente" emails={["(email registrado en su ficha)"]} />
      </Section>

      <Section title="Datos de la empresa">
        <Row label="Razón social" value="Verotin S.A." />
        <Row label="CUIT" value="30-69010113-1" />
        <Row label="Domicilio" value="Agustín Magaldi 1765, CABA" />
        <Row label="Depósitos" value="Magaldi (CABA) · Luján (BsAs)" />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad mb-4">
      <div className="text-base font-bold text-fg-brand mb-3">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-stroke-soft last:border-b-0">
      <span className="text-sm text-fg-secondary">{label}</span>
      <span className="text-sm font-semibold flex items-center gap-1.5">
        {ok != null && (
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              ok ? "bg-status-success" : "bg-status-warning"
            }`}
          />
        )}
        {value}
      </span>
    </div>
  );
}

function Recipients({ label, emails }: { label: string; emails: string[] }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="text-eyebrow-sm uppercase text-fg-muted w-32 shrink-0 pt-0.5">{label}</div>
      <div className="flex flex-wrap gap-1.5 flex-1">
        {emails.map((e) => (
          <span
            key={e}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-neutral-50 border border-stroke-soft"
          >
            <Icon name="mail" size={11} className="text-fg-muted" /> {e}
          </span>
        ))}
      </div>
    </div>
  );
}

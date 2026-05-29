import Link from "next/link";
import { checkDriveEnv, pingDrive } from "@/lib/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Drive · TOPS Órdenes",
  description: "Estado de la integración con Google Drive corporativo",
};

/**
 * /drive
 *
 * Página de diagnóstico de la integración Drive. Server component: hace la
 * verificación en cada request y renderiza el estado.
 */
export default async function DrivePage() {
  const env = checkDriveEnv();
  const ping = env.ok ? await pingDrive() : null;
  const connected = ping?.connected === true;
  const checkedAt = new Date();

  return (
    <main className="min-h-screen bg-bg-page p-6 md:p-12">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="text-tops-red text-eyebrow uppercase mb-1">
              Integraciones
            </div>
            <h1 className="text-3xl font-bold text-fg-brand">
              Google Drive corporativo
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="text-fg-link text-sm font-semibold hover:underline"
          >
            ← Volver al panel
          </Link>
        </div>

        <section
          className={
            "rounded-xl border p-6 mb-6 " +
            (connected
              ? "bg-emerald-50 border-emerald-200"
              : "bg-rose-50 border-rose-200")
          }
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className={
                "inline-block h-3 w-3 rounded-full " +
                (connected ? "bg-emerald-500" : "bg-rose-500")
              }
            />
            <span
              className={
                "text-lg font-bold " +
                (connected ? "text-emerald-800" : "text-rose-800")
              }
            >
              {connected ? "Drive conectado" : "Drive desconectado"}
            </span>
          </div>
          {!connected && ping?.error ? (
            <p className="mt-3 text-sm text-rose-700 font-mono break-all">
              {ping.error}
            </p>
          ) : null}
        </section>

        <section className="bg-white border border-stroke-soft rounded-xl p-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-fg-muted mb-4">
            Detalle
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <div>
              <dt className="text-fg-muted">Folder ID configurado</dt>
              <dd className="font-mono text-fg-brand break-all">
                {env.folderId
                  ? process.env.GOOGLE_DRIVE_FOLDER_ID
                  : "— sin configurar —"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Nombre de la carpeta</dt>
              <dd className="font-semibold text-fg-brand">
                {ping?.folderName ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Service Account</dt>
              <dd className="font-mono text-xs text-fg-brand break-all">
                {env.clientEmail
                  ? process.env.GOOGLE_CLIENT_EMAIL
                  : "— sin configurar —"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Última verificación</dt>
              <dd className="text-fg-brand">
                {checkedAt.toLocaleString("es-AR", {
                  timeZone: "America/Argentina/Buenos_Aires",
                  dateStyle: "short",
                  timeStyle: "medium",
                })}
                {" "}
                <span className="text-fg-muted">(hora Argentina)</span>
              </dd>
            </div>
          </dl>

          <h2 className="text-sm font-bold uppercase tracking-wide text-fg-muted mt-8 mb-4">
            Variables de entorno
          </h2>
          <ul className="text-sm space-y-2">
            <EnvRow label="GOOGLE_CLIENT_EMAIL" ok={env.clientEmail} />
            <EnvRow label="GOOGLE_PRIVATE_KEY" ok={env.privateKey} />
            <EnvRow label="GOOGLE_DRIVE_FOLDER_ID" ok={env.folderId} />
          </ul>

          <div className="mt-8 pt-6 border-t border-stroke-soft text-xs text-fg-muted">
            Endpoint de diagnóstico:{" "}
            <Link href="/api/drive/ping" className="text-fg-link font-semibold">
              /api/drive/ping
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function EnvRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden
        className={
          "inline-block h-2 w-2 rounded-full " +
          (ok ? "bg-emerald-500" : "bg-rose-500")
        }
      />
      <span className="font-mono text-fg-brand">{label}</span>
      <span
        className={
          "ml-auto text-xs font-semibold " +
          (ok ? "text-emerald-700" : "text-rose-700")
        }
      >
        {ok ? "configurada" : "FALTA"}
      </span>
    </li>
  );
}

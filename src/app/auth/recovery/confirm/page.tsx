import type { Metadata } from "next";
import { cookies } from "next/headers";
import RecoveryLanding from "../RecoveryLanding";
import {
  PASSWORD_RECOVERY_TOKEN_COOKIE,
  passwordRecoveryErrorMessage,
} from "@/lib/supabase/auth-recovery";

export const metadata: Metadata = {
  title: "Confirmar recuperación",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default function RecoveryConfirmationPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const hasContext = Boolean(cookies().get(PASSWORD_RECOVERY_TOKEN_COOKIE)?.value);
  const error = searchParams?.error ?? (hasContext ? undefined : "invalid");
  return (
    <main className="min-h-screen grid place-items-center bg-bg-page p-6">
      <div className="card card-pad w-full max-w-sm">
        <div className="text-eyebrow uppercase text-tops-red mb-1">Acceso corporativo</div>
        <h1 className="text-2xl font-bold text-fg-brand mb-1">Confirmar recuperación</h1>
        {error ? (
          <div className="space-y-4">
            <div className="rounded-md bg-status-warning/10 text-status-warning text-sm px-3 py-2 border border-status-warning/20">
              {passwordRecoveryErrorMessage(error)}
            </div>
            <a href="/auth/forgot-password" className="btn btn-secondary w-full text-center">
              Enviar un nuevo enlace
            </a>
          </div>
        ) : (
          <RecoveryLanding />
        )}
      </div>
    </main>
  );
}

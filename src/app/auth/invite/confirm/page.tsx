import type { Metadata } from "next";
import { cookies } from "next/headers";
import InviteLanding from "../InviteLanding";
import {
  PASSWORD_INVITE_TOKEN_COOKIE,
  passwordRecoveryErrorMessage,
} from "@/lib/supabase/auth-recovery";

export const metadata: Metadata = {
  title: "Aceptar invitación",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default function InviteConfirmationPage({ searchParams }: { searchParams?: { error?: string } }) {
  const hasContext = Boolean(cookies().get(PASSWORD_INVITE_TOKEN_COOKIE)?.value);
  const error = searchParams?.error ?? (hasContext ? undefined : "invalid");

  return (
    <main className="min-h-screen grid place-items-center bg-bg-page p-6">
      <div className="card card-pad w-full max-w-sm">
        <div className="text-eyebrow uppercase text-tops-red mb-1">Acceso corporativo</div>
        <h1 className="text-2xl font-bold text-fg-brand mb-1">Aceptar invitación</h1>
        {error ? (
          <div className="rounded-md bg-status-warning/10 text-status-warning text-sm px-3 py-2 border border-status-warning/20">
            {passwordRecoveryErrorMessage(error)}
          </div>
        ) : <InviteLanding />}
      </div>
    </main>
  );
}

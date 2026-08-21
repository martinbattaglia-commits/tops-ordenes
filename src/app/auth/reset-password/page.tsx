import type { Metadata } from "next";
import { cookies } from "next/headers";
import ResetForm from "./ResetForm";
import { createClient } from "@/lib/supabase/server";
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_INVITE_COOKIE,
  passwordRecoveryErrorMessage,
  verifyAuthTransitionToken,
  extractSessionId,
} from "@/lib/supabase/auth-recovery";

export const metadata: Metadata = { title: "Definir nueva contraseña" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const cookieStore = cookies();
  const recoveryRaw = cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value;
  const inviteRaw = cookieStore.get(PASSWORD_INVITE_COOKIE)?.value;

  let currentUser;
  let currentSessionId: string | null = null;
  const supabase = createClient();
  if (supabase) {
    try {
      const userRes = await supabase.auth.getUser();
      currentUser = userRes.data?.user;
      const sessionRes = await supabase.auth.getSession();
      currentSessionId = extractSessionId(sessionRes.data?.session);
    } catch {
      currentUser = undefined;
      currentSessionId = null;
    }
  }

  const currentAuth =
    currentUser && currentSessionId
      ? { userId: currentUser.id, sessionId: currentSessionId, email: currentUser.email }
      : undefined;

  const recoveryRes = recoveryRaw
    ? await verifyAuthTransitionToken(recoveryRaw, "recovery", currentAuth)
    : { valid: false };
  const inviteRes = inviteRaw
    ? await verifyAuthTransitionToken(inviteRaw, "invite", currentAuth)
    : { valid: false };

  const authorized = recoveryRes.valid !== inviteRes.valid;

  const initialError = searchParams?.error
    ? passwordRecoveryErrorMessage(searchParams.error)
    : undefined;

  return (
    <main className="min-h-screen grid place-items-center bg-bg-page p-6">
      <div className="card card-pad w-full max-w-sm">
        <div className="text-eyebrow uppercase text-tops-red mb-1">Acceso corporativo</div>
        <h1 className="text-2xl font-bold text-fg-brand mb-1">Nueva contraseña</h1>
        <p className="text-sm text-fg-secondary mb-5">
          Mínimo 8 caracteres. Te recomendamos usar un password manager.
        </p>
        <ResetForm authorized={authorized} initialError={initialError} />
      </div>
    </main>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmInvitation } from "./actions";
import { passwordRecoveryErrorMessage } from "@/lib/supabase/auth-recovery-shared";

export default function InviteLanding() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirm = () => startTransition(async () => {
    setError(null);
    const result = await confirmInvitation();
    if (!result.ok) {
      setError(passwordRecoveryErrorMessage(result.error));
      return;
    }
    router.replace("/auth/reset-password");
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-secondary">
        Confirmá la invitación para definir personalmente tu contraseña inicial.
      </p>
      {error && <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">{error}</div>}
      <button type="button" className="btn btn-primary w-full" disabled={pending} onClick={confirm}>
        {pending ? "Validando invitación…" : "Aceptar invitación y crear contraseña"}
      </button>
    </div>
  );
}

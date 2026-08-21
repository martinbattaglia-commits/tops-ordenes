"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmPasswordRecovery } from "./actions";
import { passwordRecoveryErrorMessage } from "@/lib/supabase/auth-recovery-shared";

export default function RecoveryLanding() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await confirmPasswordRecovery();
      if (!result.ok) {
        setError(passwordRecoveryErrorMessage(result.error));
        return;
      }
      router.replace("/auth/reset-password");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-secondary">
        Para proteger el enlace frente a escáneres automáticos de correo, la recuperación
        comienza únicamente cuando confirmás esta acción.
      </p>

      {error && (
        <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
          {error}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={pending}
        onClick={confirm}
      >
        {pending ? "Validando enlace…" : "Continuar y crear contraseña"}
      </button>

      <Link href="/auth/forgot-password" className="btn btn-secondary w-full text-center">
        Enviar un nuevo enlace
      </Link>
    </div>
  );
}

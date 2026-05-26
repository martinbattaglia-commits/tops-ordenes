import type { Metadata } from "next";
import Link from "next/link";
import ForgotForm from "./ForgotForm";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-bg-page p-6">
      <div className="card card-pad w-full max-w-sm">
        <div className="text-eyebrow uppercase text-tops-red mb-1">Acceso corporativo</div>
        <h1 className="text-2xl font-bold text-fg-brand mb-1">Recuperar contraseña</h1>
        <p className="text-sm text-fg-secondary mb-5">
          Ingresá tu email corporativo y te enviamos un link para resetearla.
        </p>
        <ForgotForm />
        <div className="mt-6 pt-4 border-t border-stroke-soft text-center text-xs">
          <Link href="/login" className="text-fg-link font-semibold">
            ← Volver al login
          </Link>
        </div>
      </div>
    </main>
  );
}

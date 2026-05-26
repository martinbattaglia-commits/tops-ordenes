import type { Metadata } from "next";
import ResetForm from "./ResetForm";

export const metadata: Metadata = { title: "Definir nueva contraseña" };

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-bg-page p-6">
      <div className="card card-pad w-full max-w-sm">
        <div className="text-eyebrow uppercase text-tops-red mb-1">Acceso corporativo</div>
        <h1 className="text-2xl font-bold text-fg-brand mb-1">Nueva contraseña</h1>
        <p className="text-sm text-fg-secondary mb-5">
          Mínimo 8 caracteres. Te recomendamos usar un password manager.
        </p>
        <ResetForm />
      </div>
    </main>
  );
}

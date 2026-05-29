import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { from?: string; error?: string };
}) {
  return (
    <main className="min-h-screen w-full flex">
      {/* Panel izquierdo — marca (oculto mobile) */}
      <aside
        className="hidden lg:flex relative flex-1 text-white bg-tops-blue-900"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(5,5,85,0.92), rgba(5,5,85,0.65) 60%, rgba(5,5,85,0.95)), url(/icons/login-bg.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="flex flex-col justify-between p-12 w-full max-w-2xl">
          <div className="flex items-center gap-3">
            <BrandWhite />
          </div>
          <div>
            <div className="text-tops-red text-eyebrow uppercase mb-4">
              Operaciones inteligentes · 2026
            </div>
            <h1 className="text-5xl font-bold uppercase leading-[1.05] tracking-tight mb-6">
              Órdenes de servicio,
              <br />
              completamente digitales.
            </h1>
            <p className="text-white/80 text-lg leading-relaxed max-w-md mb-8">
              Reemplazá el papel: generá, firmá y centralizá cada orden desde el celular del
              operario. Plataforma oficial de Logística TOPS.
            </p>
            <div className="flex gap-8 pt-4 border-t border-white/15">
              <Stat label="Metros cuadrados" value="15.000" />
              <Stat label="Órdenes este mes" value="324" />
              <Stat label="Tasa firma digital" value="97,2 %" />
            </div>
          </div>
          <div className="text-xs text-white/55">
            Verotin S.A. · CUIT 30-69010113-1 · Agustín Magaldi 1765, CABA
          </div>
        </div>
      </aside>

      {/* Panel derecho — form */}
      <section className="flex-1 lg:flex-none lg:w-[480px] flex flex-col justify-center items-center px-6 py-10 bg-white">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="text-tops-red text-eyebrow uppercase mb-1">Acceso corporativo</div>
            <h2 className="text-3xl font-bold text-fg-brand">Iniciá sesión</h2>
            <p className="text-fg-secondary text-sm mt-1">
              Ingresá con tu email corporativo de Logística TOPS.
            </p>
          </div>
          <LoginForm redirectTo={searchParams?.from} initialError={searchParams?.error} />
          <div className="mt-8 pt-6 border-t border-stroke-soft text-center text-xs text-fg-muted">
            ¿Problemas para ingresar?{" "}
            <a href="mailto:soporte@logisticatops.com" className="text-fg-link font-semibold">
              soporte@logisticatops.com
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-bold tabular tracking-tight">{value}</div>
      <div className="text-xs uppercase tracking-[0.12em] text-white/55 mt-0.5 font-bold">
        {label}
      </div>
    </div>
  );
}

function BrandWhite() {
  return (
    <div className="flex items-end gap-2">
      <span className="text-2xl font-black uppercase tracking-tight">TOPS</span>
      <span className="text-xs uppercase tracking-[0.18em] font-bold text-tops-red mb-1">
        Órdenes
      </span>
    </div>
  );
}

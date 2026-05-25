import Link from "next/link";
import { Icon } from "@/components/Icon";

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center bg-bg-page p-6">
      <div className="text-center max-w-md">
        <div className="text-7xl font-black text-tops-blue-900 tracking-tight mb-2">404</div>
        <h1 className="text-xl font-bold text-fg-brand mb-2">Página no encontrada</h1>
        <p className="text-sm text-fg-secondary mb-6">
          El recurso solicitado no existe o fue movido. Si llegaste acá desde un comprobante
          impreso, verificá el número de orden.
        </p>
        <Link href="/dashboard" className="btn btn-primary">
          <Icon name="arrow-left" size={14} /> Volver al panel
        </Link>
      </div>
    </div>
  );
}

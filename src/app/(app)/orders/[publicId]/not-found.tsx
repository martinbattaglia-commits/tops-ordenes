import Link from "next/link";
import { Icon } from "@/components/Icon";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] grid place-items-center p-8">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto rounded-full bg-status-warning/10 text-status-warning grid place-items-center mb-4">
          <Icon name="x" size={28} />
        </div>
        <h1 className="text-2xl font-bold text-fg-brand mb-2">Orden no encontrada</h1>
        <p className="text-fg-secondary mb-6">
          El comprobante que buscás no existe o fue cancelado. Verificá el número o volvé al listado.
        </p>
        <Link href="/orders" className="btn btn-primary">
          <Icon name="arrow-left" size={14} /> Volver al listado
        </Link>
      </div>
    </div>
  );
}

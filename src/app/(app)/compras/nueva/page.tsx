import { listVendors, listProducts } from "@/lib/compras/data";
import { NewPoWizard } from "./NewPoWizard";

export const metadata = { title: "Nueva orden de compra" };
export const dynamic = "force-dynamic";

export default async function NewPoPage() {
  // Cargamos vendors y products en paralelo, pero blindamos cada lado:
  // si la query falla (RLS, vista no resuelta, etc.) el wizard arranca
  // igual con esa lista vacía en lugar de tirar 500 al usuario.
  const [vendors, products] = await Promise.all([
    listVendors().catch((e) => {
      console.error("[compras/nueva] listVendors falló:", e);
      return [] as Awaited<ReturnType<typeof listVendors>>;
    }),
    listProducts().catch((e) => {
      console.error("[compras/nueva] listProducts falló:", e);
      return [] as Awaited<ReturnType<typeof listProducts>>;
    }),
  ]);
  return <NewPoWizard vendors={vendors} products={products} />;
}

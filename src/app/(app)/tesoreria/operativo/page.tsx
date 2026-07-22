import { redirect } from "next/navigation";

/**
 * Ruta histórica del alta de movimientos operativos.
 *
 * Resolución de Dirección (2026-07-22): la navegación de Movimientos es ÚNICA y vive
 * en `/tesoreria/movimientos`, que absorbió el formulario de alta, el historial, el
 * filtro por tipo y la anulación. Esta ruta se conserva sólo para no romper enlaces
 * previos (marcadores, `revalidatePath`, correos) y redirige de forma permanente.
 */
export default function MovimientoOperativoRedirect() {
  redirect("/tesoreria/movimientos");
}

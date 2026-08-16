import type { ServiceUnit } from "@/lib/types";

/**
 * Metadatos visuales deliberadamente libres de tarifas para el bundle cliente.
 *
 * Las CLAVES son las del catálogo (`services-catalog.ts`) y no se renombran:
 * el wizard busca por clave y, si no la encuentra, cae a un fallback que
 * titula la sección con la clave cruda en minúscula. Renombrar `admin` a
 * `otros` dejó así a los dos servicios administrativos del catálogo.
 */
export const SERVICE_CATEGORIES = [
  { key: "personal", label: "Personal", icon: "user" },
  { key: "especial", label: "Servicios especiales", icon: "forklift" },
  { key: "carga", label: "Carga, descarga, picking", icon: "package" },
  { key: "desconsolidado", label: "Desconsolidado", icon: "package" },
  { key: "almacenamiento", label: "Almacenamiento", icon: "building" },
  { key: "coworking", label: "Oficinas y coworking", icon: "building" },
  { key: "admin", label: "Administrativos", icon: "bill" },
] as const;

/**
 * Reglas operativas del tarifario, tal como se muestran al usuario.
 *
 * FUENTE ÚNICA. Vivían en `pricing/vehicles.ts` y al moverlas acá quedaron
 * truncadas a cuatro: se perdieron los porcentajes concretos de recargo fuera
 * de horario, la regla de hora extra de peón, los peajes y el aviso de IVA.
 * Son contenido comercial y legal visible, no texto decorativo.
 *
 * Ninguna contiene una tarifa: los únicos números son porcentajes relativos y
 * un conteo de clientes. Sin el precio base, un porcentaje no permite derivar
 * ningún importe, así que tenerlas acá no reintroduce tarifas al navegador del
 * encargado. El aislamiento real es del servidor: `data/service-pricing.ts`
 * devuelve el catálogo con `rate: null` y `pricesVisible: false` para un
 * principal.
 */
export const TRANSPORT_RULES = [
  "Precios expresados por viaje completo (no por hora).",
  "Segundo viaje al 50% del valor original.",
  "Reparto hasta 4 clientes. Si supera, queda sujeto a cotización.",
  "Recargo fuera de horario (camión): 17–19 hs +25%, 19–21 hs +50%, después de 21 hs +100%.",
  "Recargo hora extra (peón): 17–19 hs +50%, después de 19 hs +100%.",
  "Peajes se cotizan aparte cuando aplican.",
  "Los valores NO incluyen IVA.",
] as const;

/**
 * Etiqueta de unidad para mostrar junto a una cantidad.
 *
 * Son abreviaturas invariables a propósito: la UI las concatena con el número
 * sin poder pluralizarlas, de modo que una palabra en singular produce "3
 * hora", "5 pallet" y "2 unidad". "3 hs" y "5 pal" funcionan con cualquier
 * cantidad.
 */
export function unitLabel(unit: ServiceUnit | string): string {
  return ({
    hs: "hs",
    km: "km",
    pal: "pal",
    mes: "mes",
    un: "un",
    m2: "m²",
    m3: "m³",
    tn: "tn",
    viaje: "viaje",
  } as Record<string, string>)[unit] ?? unit;
}

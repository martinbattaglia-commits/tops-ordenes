/**
 * RECONOCIMIENTO DE FORMATO POR CONTENIDO · módulo puro, sin dependencias.
 *
 * ─── POR QUÉ SE EXTRAJO ──────────────────────────────────────────────────
 *
 * `sniffCustodyVisionMime` vivía en `productive-vision-evaluation.ts`, que
 * importa `CustodyVisionProviderError` como VALOR desde `openai-vision-provider`
 * —el cliente HTTP de OpenAI—. Como `physical-ingress.ts` necesita el sniffer
 * para validar la foto antes de subirla, **todo el que registraba evidencia
 * arrastraba el proveedor de visión a su grafo estático**: recepciones desde
 * 2-A, y despachos desde 2-C-1.
 *
 * Nadie lo había medido. El guard de clausura del repositorio
 * —`clients-native-only.test.ts`— está enraizado en el maestro de clientes y
 * `wms/despachos` no figura entre sus orígenes, así que la arista existía y no
 * la veía ningún control. La encontró el guard que 2-C-2 agregó
 * (`custody-analysis-boundary.test.ts`) la primera vez que corrió.
 *
 * La función no tenía ninguna razón para estar ahí: son números mágicos de
 * cabecera, sin red, sin estado y sin proveedor. Acá no importa nada.
 */

/** Los tres formatos que la Adenda admite como evidencia fotográfica. */
export type CustodyVisionMimeType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Reconoce el formato por los BYTES, no por lo que declare el navegador ni por
 * la extensión del archivo. Es la única forma admisible en un módulo
 * probatorio: el `Content-Type` de un formulario es dato del cliente.
 *
 * Devuelve `null` para cualquier cosa que no sea uno de los tres formatos.
 */
export function sniffCustodyVisionMime(bytes: Uint8Array): CustodyVisionMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
      && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
      && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46
      && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45
      && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

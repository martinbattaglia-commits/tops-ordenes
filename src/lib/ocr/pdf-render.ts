/**
 * Render de la PRIMERA página de un PDF a PNG, para el camino OCR `pdf_image`.
 *
 * ¿POR QUÉ EXISTE ESTE MÓDULO?
 * El camino normal de facturas es `extractFromPdf` → pdf-parse → texto → chat.
 * Pero un PDF ESCANEADO (una "foto" del comprobante metida en un PDF) no tiene
 * capa de texto: pdf-parse devuelve ~0 chars y la extracción por texto es
 * imposible. Antes eso terminaba en un 422 "PDF sin texto extraíble". Acá
 * rasterizamos la primera página y la mandamos al MISMO pipeline Vision que ya
 * usan las imágenes (JPG/PNG), reutilizando idéntico esquema JSON y mapper.
 *
 * ¿POR QUÉ SOLO LA PRIMERA PÁGINA?
 * Una factura/NC/ND argentina entra en una carilla: encabezado (proveedor,
 * CUIT, punto de venta, número), totales (neto/IVA/total) y el CAE van todos en
 * la página 1. Rasterizar todas las páginas multiplicaría CPU, memoria, tokens
 * de Vision y costo sin aportar datos fiscales. Acotar a la primera página
 * mantiene el request dentro de límites serverless previsibles.
 *
 * COMPATIBILIDAD Next 14 / Netlify:
 *  - pdfjs-dist (build `legacy`) y @napi-rs/canvas se importan de forma PEREZOSA
 *    dentro de la función, nunca arriba: la carga eager rompe el bundling RSC.
 *    Misma disciplina que `extractFromPdf` con pdf-parse.
 *  - @napi-rs/canvas trae binario prebuilt `linux-x64-gnu` (runtime de Netlify
 *    Functions) y está marcado como serverComponentsExternalPackages para que
 *    Node lo requiera nativo en vez de bundlearlo.
 *
 * BEST-EFFORT: cualquier error (PDF cifrado, corrupto, binario que no carga)
 * se traga y devuelve `null`. El caller (`extractFromPdf`) conserva entonces el
 * 422 actual → la UI cae a carga manual. Este módulo NUNCA lanza.
 */

const TARGET_DPI = 150; // suficiente para OCR de comprobantes; PDF userspace = 72 DPI.
const MAX_EDGE_PX = 2200; // techo del lado mayor: acota memoria/tokens/costo Vision.

/**
 * Rasteriza la primera página del PDF y la devuelve como data URL PNG
 * (`data:image/png;base64,...`), lista para el pipeline Vision. Devuelve `null`
 * ante cualquier fallo (best-effort; nunca lanza).
 */
export async function renderFirstPageToPng(
  pdfBuffer: Buffer
): Promise<string | null> {
  try {
    // Imports perezosos: igual que pdf-parse, evitan romper el bundling RSC.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      // En Node usamos el "fake worker" en el mismo hilo (no hay Web Worker).
      // No descargamos fuentes/cmaps remotos: un escaneo es un raster, las
      // fuentes embebidas no aportan al OCR y evitamos egress de red.
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;

    let png: Buffer | null = null;
    try {
      const page = await doc.getPage(1);

      // Calcular escala: apuntamos a TARGET_DPI pero clampeamos el lado mayor a
      // MAX_EDGE_PX para no explotar memoria/tokens con PDFs de hoja grande.
      const base = page.getViewport({ scale: 1 });
      const dpiScale = TARGET_DPI / 72;
      const longestAtDpi = Math.max(base.width, base.height) * dpiScale;
      const scale =
        longestAtDpi > MAX_EDGE_PX ? (MAX_EDGE_PX / Math.max(base.width, base.height)) : dpiScale;

      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");

      // Fondo blanco: un PDF escaneado puede no pintar todos los píxeles y el
      // canvas arranca transparente → Vision lee mejor sobre blanco.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        // @napi-rs/canvas expone Canvas + contexto 2D compatibles con lo que
        // pdfjs espera. pdfjs v5 pide `canvas`; pasamos también el contexto.
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      png = await canvas.encode("png");
    } finally {
      // Liberar recursos del documento pase lo que pase.
      await doc.destroy().catch(() => {});
    }

    if (!png || png.byteLength === 0) return null;
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    // Best-effort: PDF cifrado/corrupto o binario que no carga → null.
    return null;
  }
}

import QRCode from "qrcode";

/**
 * QR Layer de la Cadena de Custodia (GATE 5). Server-side: genera el QR LOCALMENTE
 * con la lib `qrcode` (sin enviar el token opaco a terceros). El QR codifica la URL
 * de resolución `/c/{token}`; el token nunca se expone fuera del propio QR.
 */

/** Base absoluta para QR escaneables (configurar NEXT_PUBLIC_SITE_URL en prod). */
function siteBase(): string {
  const b = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return b && b.length > 0 ? b.replace(/\/$/, "") : "";
}

/** URL de resolución del QR (opaca: solo el token, sin IDs internos). */
export function custodyTokenUrl(token: string, base?: string): string {
  const root = (base ?? siteBase()).replace(/\/$/, "");
  return `${root}/c/${token}`;
}

/** Genera el QR como data URL PNG a partir del token (server-side). */
export async function custodyQrDataUrl(token: string, base?: string): Promise<string> {
  const url = custodyTokenUrl(token, base);
  return QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" });
}

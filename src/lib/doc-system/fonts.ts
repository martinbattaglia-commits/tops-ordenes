import { Font } from "@react-pdf/renderer";
import {
  MONTSERRAT_REGULAR,
  MONTSERRAT_SEMIBOLD,
  MONTSERRAT_BOLD,
  MONTSERRAT_EXTRABOLD,
} from "./assets/montserrat";
import { JBMONO_REGULAR, JBMONO_SEMIBOLD, JBMONO_BOLD } from "@/lib/pdf/assets/invoice-fonts";
import { FONT } from "./tokens";

let registered = false;

/** Registra el pack tipográfico único del doc-system (idempotente). */
export function registerDocFonts(): void {
  if (registered) return;
  registered = true;
  const ttf = (b64: string) => `data:font/truetype;base64,${b64}`;
  Font.register({
    family: FONT.sans,
    fonts: [
      { src: ttf(MONTSERRAT_REGULAR), fontWeight: 400 },
      { src: ttf(MONTSERRAT_SEMIBOLD), fontWeight: 600 },
      { src: ttf(MONTSERRAT_BOLD), fontWeight: 700 },
      { src: ttf(MONTSERRAT_EXTRABOLD), fontWeight: 800 },
    ],
  });
  Font.register({
    family: FONT.mono,
    fonts: [
      { src: JBMONO_REGULAR, fontWeight: 400 },
      { src: JBMONO_SEMIBOLD, fontWeight: 600 },
      { src: JBMONO_BOLD, fontWeight: 700 },
    ],
  });
  // Importes, CUIT y hashes nunca se cortan con guiones.
  Font.registerHyphenationCallback((word) => [word]);
}

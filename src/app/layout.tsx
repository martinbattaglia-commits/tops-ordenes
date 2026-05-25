import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

/**
 * Montserrat actúa como fallback de Gotham (la primaria corporativa,
 * cargada desde /public/fonts vía @font-face). Next/font la sirve
 * self-host con preload + display:swap y elimina layout-shift.
 */
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3030"),
  title: {
    default: "TOPS Órdenes — Logística TOPS",
    template: "%s · TOPS Órdenes",
  },
  description:
    "Sistema digital de órdenes de servicio operativas — Logística TOPS (Verotin S.A.)",
  applicationName: "TOPS Órdenes",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TOPS Órdenes",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: "TOPS Órdenes",
    title: "TOPS Órdenes — Logística TOPS",
    description:
      "Sistema digital de órdenes de servicio operativas para Logística TOPS (Verotin S.A.)",
  },
};

export const viewport: Viewport = {
  themeColor: "#050555",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={montserrat.variable}>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator && location.protocol === 'https:') {
              window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(() => {});
              });
            }`,
          }}
        />
      </body>
    </html>
  );
}

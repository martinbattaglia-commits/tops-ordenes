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
    default: "TOPS NEXUS — Logistics Operating System · Logística TOPS",
    template: "%s · TOPS NEXUS",
  },
  description:
    "Plataforma operativa corporativa de Logística TOPS (Verotin S.A.). Compras, servicios, CRM, CCTV, ANMAT, documental y analytics — todo en un único Operating System.",
  applicationName: "TOPS NEXUS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TOPS NEXUS",
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
    siteName: "TOPS NEXUS",
    title: "TOPS NEXUS — Logistics Operating System",
    description:
      "Cockpit corporativo de Logística TOPS (Verotin S.A., desde 1985). Operaciones 3PL, compras, ANMAT compliance, CCTV y documental, todo bajo una identidad enterprise única.",
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

/**
 * Script "no-FOUC" para dark mode: aplica la clase `dark` en <html>
 * antes de que React hidrate, evitando flash blanco si el usuario tiene
 * preferencia oscura guardada.
 */
const themeBootstrap = `(function(){try{var t=localStorage.getItem('tops-theme');var d=t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');document.documentElement.setAttribute('data-theme','dark')}else{document.documentElement.setAttribute('data-theme','light')}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={montserrat.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
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

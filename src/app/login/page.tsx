import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import LoginExperience from "./LoginExperience";
import "./login-theme.css";

/**
 * Tipografías del nuevo acceso corporativo (UI 2026). Inter como sans y
 * JetBrains Mono para datos/reloj/KPIs — self-host vía next/font, sin
 * layout-shift. Quedan expuestas como CSS vars y consumidas por
 * login-theme.css (--tn-font-sans / --tn-font-mono), scopeadas al login.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Acceso corporativo",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { from?: string; error?: string };
}) {
  return (
    <main className={`tn-login ${inter.variable} ${jetbrains.variable}`}>
      <LoginExperience
        redirectTo={searchParams?.from}
        initialError={searchParams?.error}
      />
    </main>
  );
}

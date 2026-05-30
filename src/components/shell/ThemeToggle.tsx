"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Dark mode toggle persistente en localStorage.
 *
 * Cómo funciona:
 *  - Lee preferencia inicial: localStorage `tops-theme` → sino, prefers-color-scheme del SO.
 *  - Aplica clase `dark` en <html> para que Tailwind y los tokens .dark de globals.css
 *    se activen automáticamente.
 *  - El sidebar mantiene fondo azul-900 siempre (es el "lock visual" de la marca);
 *    solo cambian las superficies del contenido.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (typeof window !== "undefined"
      ? window.localStorage.getItem("tops-theme")
      : null) as "light" | "dark" | null;
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = stored ?? (prefersDark ? "dark" : "light");
    setTheme(initial);
    applyTheme(initial);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem("tops-theme", next);
    } catch {}
  };

  if (!mounted) {
    // Skeleton para evitar flash mientras hidrata
    return <span className="w-9 h-9 rounded-md bg-neutral-50 border border-stroke-soft" aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-stroke-soft text-fg-secondary hover:bg-neutral-50 hover:text-fg-primary transition-colors"
      aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
      title={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
      <span className="sr-only">{theme === "dark" ? "Modo oscuro activo" : "Modo claro activo"}</span>
    </button>
  );
}

function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.setAttribute("data-theme", "dark");
  } else {
    root.classList.remove("dark");
    root.setAttribute("data-theme", "light");
  }
}

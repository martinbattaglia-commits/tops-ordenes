"use client";

import { useEffect, useRef, useState } from "react";

type Fmt = "int" | "currency";

function format(v: number, fmt: Fmt, final: boolean): string {
  if (fmt === "currency") {
    return "$ " + Math.round(v).toLocaleString("es-AR", { maximumFractionDigits: 0 });
  }
  // int: en el frame final reproduce exactamente el formato del page (sin forzar
  // redondeo, para no divergir si el valor trae decimales). Durante la animación
  // muestra enteros limpios.
  return final
    ? v.toLocaleString("es-AR")
    : Math.round(v).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

/**
 * Cifra animada 0 → `to` para KPIs. easeOutCubic, sin rebote (Bloomberg/Stripe).
 * SSR-safe: el primer render muestra el valor final (sin mismatch de hidratación).
 * Respeta prefers-reduced-motion: si está activo no anima.
 */
export function CountUp({ to, format: fmt, durationMs = 900 }: { to: number; format: Fmt; durationMs?: number }) {
  const [display, setDisplay] = useState(() => format(to, fmt, true));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(format(to, fmt, true));
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        setDisplay(format(to * eased, fmt, false));
        raf = requestAnimationFrame(tick);
      } else {
        setDisplay(format(to, fmt, true));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, fmt, durationMs]);

  return <>{display}</>;
}

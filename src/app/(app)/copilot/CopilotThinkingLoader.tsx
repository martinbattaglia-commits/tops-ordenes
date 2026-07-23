"use client";

// Loader "pensando" del Copilot (round loader 2026-07-08): animación TOPS Nexus
// sobria, alineada como respuesta del asistente. Chica, muteada, loop, sin
// controles, sin overlay pantalla completa. Respeta prefers-reduced-motion:
// bajo reduce-motion no reproduce el video y muestra el logo QUIETO (poster).
// Assets locales optimizados en /public/copilot (mp4 23K sin audio + poster).

const GENERAL_SUB = "Consultando datos, cruzando fuentes y preparando la respuesta.";
const COMPLEX_SUB = "Cruzando información de facturación, contratos, compliance y operación…";

const VIDEO_SRC = "/copilot/tops-nexus-loader.mp4";
const POSTER_SRC = "/copilot/tops-nexus-loader-poster.png";

export function CopilotThinkingLoader({ complex = false }: { complex?: boolean }) {
  return (
    <div
      className="card flex max-w-[92%] items-center gap-3 px-3 py-2.5"
      // Glow discreto (hex + alpha; regla repo: no /opacity sobre tokens var()).
      style={{ boxShadow: "0 0 0 1px #3b82f61f, 0 10px 28px -14px #3b82f566" }}
      role="status"
      aria-live="polite"
      aria-label="Nexus está analizando tu consulta"
    >
      <div className="relative shrink-0 overflow-hidden rounded-lg bg-bg-surface-alt">
        {/* Animación: solo con motion permitido. Muteada, loop, sin controles. */}
        <video
          className="block h-14 w-auto motion-reduce:hidden"
          src={VIDEO_SRC}
          poster={POSTER_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          controls={false}
          disablePictureInPicture
          tabIndex={-1}
          aria-hidden
        />
        {/* Fallback estático (reduce-motion): logo quieto, mismo tamaño. */}
        <div
          className="hidden h-14 w-[100px] bg-contain bg-center bg-no-repeat motion-reduce:block"
          style={{ backgroundImage: `url('${POSTER_SRC}')` }}
          aria-hidden
        />
      </div>

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary">
          Nexus está analizando tu consulta
          <span className="inline-flex items-center gap-0.5" aria-hidden>
            <span className="h-1 w-1 rounded-full bg-fg-link motion-safe:animate-pulse" />
            <span
              className="h-1 w-1 rounded-full bg-fg-link motion-safe:animate-pulse"
              style={{ animationDelay: "0.15s" }}
            />
            <span
              className="h-1 w-1 rounded-full bg-fg-link motion-safe:animate-pulse"
              style={{ animationDelay: "0.3s" }}
            />
          </span>
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-fg-muted">
          {complex ? COMPLEX_SUB : GENERAL_SUB}
        </p>
      </div>
    </div>
  );
}

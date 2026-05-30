import Image from "next/image";

/**
 * Loading screen global — pantalla de transición entre rutas.
 *
 * Identidad visual: logo oficial Logística TOPS + wordmark "TOPS NEXUS"
 * + tagline "Sistema Operativo". Estilo Apple Enterprise / Stripe / Arc —
 * sobrio, premium, con halo corporativo azul/rojo y barra de progreso
 * con animación suave (no genérica).
 */
export default function Loading() {
  return (
    <div className="loading-shell">
      <div className="loading-stage">
        {/* Halo radial de fondo (azul TOPS) */}
        <div className="loading-halo" aria-hidden />

        {/* Logo oficial con shimmer */}
        <div className="loading-mark">
          <Image
            src="/icons/logo-isologo-primary.png"
            alt="Logística TOPS"
            width={140}
            height={140}
            priority
            className="loading-logo"
          />
        </div>

        {/* Wordmark */}
        <div className="loading-wordmark">
          <span className="loading-product">TOPS NEXUS</span>
          <span className="loading-tagline">Sistema Operativo</span>
        </div>

        {/* Barra de progreso indeterminada */}
        <div className="loading-track" role="progressbar" aria-label="Cargando">
          <span className="loading-bar" />
        </div>

        <div className="loading-footer">Inicializando módulos · Logística TOPS · Verotin S.A.</div>
      </div>

      <style>{`
        .loading-shell {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 30% 20%, rgba(33, 69, 118, 0.08), transparent 55%),
            radial-gradient(circle at 75% 80%, rgba(201, 8, 18, 0.06), transparent 55%),
            var(--bg-page, #f7f7fa);
          z-index: 100;
        }
        .loading-stage {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 22px;
          padding: 40px 56px;
          isolation: isolate;
        }
        .loading-halo {
          position: absolute;
          inset: -40px;
          background: radial-gradient(circle at 50% 35%, rgba(5, 5, 85, 0.10), transparent 60%);
          filter: blur(20px);
          z-index: -1;
        }
        .loading-mark {
          position: relative;
          width: 140px;
          height: 140px;
          display: grid;
          place-items: center;
        }
        .loading-logo {
          width: 140px;
          height: 140px;
          object-fit: contain;
          animation: nexus-breathe 2.4s ease-in-out infinite;
          filter: drop-shadow(0 12px 24px rgba(5, 5, 85, 0.18));
        }
        .loading-wordmark {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          margin-top: 4px;
        }
        .loading-product {
          font-size: 20px;
          font-weight: 900;
          letter-spacing: 0.22em;
          color: #050555;
          background: linear-gradient(110deg, #050555 0%, #214576 35%, #C90812 70%, #050555 100%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: nexus-sheen 4s ease-in-out infinite;
        }
        .loading-tagline {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--fg-muted, #6b7080);
        }
        .loading-track {
          width: 220px;
          height: 3px;
          border-radius: 999px;
          background: rgba(5, 5, 85, 0.08);
          overflow: hidden;
          position: relative;
        }
        .loading-bar {
          position: absolute;
          inset-block: 0;
          width: 42%;
          background: linear-gradient(90deg, transparent, #C90812 30%, #050555 70%, transparent);
          border-radius: 999px;
          animation: nexus-slide 1.4s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }
        .loading-footer {
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--fg-muted, #6b7080);
          opacity: 0.7;
          margin-top: 6px;
        }
        @keyframes nexus-breathe {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.04); opacity: 0.92; }
        }
        @keyframes nexus-sheen {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes nexus-slide {
          0% { left: -45%; }
          60% { left: 100%; }
          100% { left: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .loading-logo,
          .loading-product,
          .loading-bar { animation: none; }
        }
      `}</style>
    </div>
  );
}

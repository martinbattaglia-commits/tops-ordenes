/**
 * Acceso directo a TOPS CONNECT — Portal B2B de Clientes (ecosistema hijo de NEXUS).
 *
 * Branding: asset oficial TOPS Connect reproducido 1:1 desde el splash del portal
 * (hexágono de red #3e62f4/#6188fc + doble chevrón #ffffff/#e11b27 sobre tile navy
 * #101c52→#0a1238; wordmark TOPS 900 rojo + Connect 500). No reinterpretar.
 *
 * Abre https://connect.logisticatops.com en pestaña nueva — la sesión de NEXUS
 * queda intacta (origen distinto, sin navegación interna).
 */
const TOPS_CONNECT_URL = "https://connect.logisticatops.com";

function TopsConnectMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ overflow: "visible" }}>
      <g stroke="#3e62f4" strokeWidth="1.4" opacity="0.5">
        <line x1="14" y1="16" x2="50" y2="8" />
        <line x1="50" y1="8" x2="86" y2="18" />
        <line x1="14" y1="16" x2="12" y2="84" />
        <line x1="86" y1="18" x2="88" y2="82" />
        <line x1="12" y1="84" x2="50" y2="92" />
        <line x1="50" y1="92" x2="88" y2="82" />
      </g>
      <g fill="#6188fc">
        <circle cx="50" cy="8" r="3" />
        <circle cx="14" cy="16" r="3" />
        <circle cx="86" cy="18" r="3" />
        <circle cx="12" cy="84" r="3" />
        <circle cx="88" cy="82" r="3" />
        <circle cx="50" cy="92" r="3" />
      </g>
      <polygon points="16,44 50,20 50,32 16,56" fill="#ffffff" />
      <polygon points="50,20 84,44 84,56 50,32" fill="#e11b27" />
      <polygon points="24,66 50,46 50,58 24,78" fill="#ffffff" />
      <polygon points="50,46 76,66 76,78 50,58" fill="#e11b27" />
    </svg>
  );
}

export function TopsConnectButton() {
  return (
    <a
      href={TOPS_CONNECT_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="TOPS Connect — Portal B2B de Clientes (se abre en pestaña nueva)"
      aria-label="Abrir TOPS Connect, portal de clientes, en una pestaña nueva"
      className="nx-connect-btn group"
    >
      <span
        className="grid place-items-center w-7 h-7 rounded-[8px] flex-shrink-0"
        style={{
          background: "linear-gradient(160deg, #101c52 0%, #0a1238 100%)",
          boxShadow: "0 4px 12px -4px rgba(31, 51, 200, 0.6)",
        }}
      >
        <TopsConnectMark size={19} />
      </span>
      <span className="hidden md:flex items-baseline gap-[0.14em] text-[13px] leading-none tracking-[-0.02em] pr-0.5">
        <span className="font-black" style={{ color: "#e11b27" }}>
          TOPS
        </span>
        <span className="font-medium text-fg-primary">Connect</span>
      </span>
      <svg
        viewBox="0 0 24 24"
        width="11"
        height="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="hidden md:block text-fg-muted transition-transform duration-200 group-hover:translate-x-[1px] group-hover:-translate-y-[1px]"
      >
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </svg>
    </a>
  );
}

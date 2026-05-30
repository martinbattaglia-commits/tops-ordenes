"use client";

import { LOCATIONS, type LocationStatus } from "@/lib/ejecutivo/locations";

/**
 * Mapa estilizado de CABA con las 2 locaciones operativas de TOPS.
 *
 * Coordenadas geográficas reales (lat/lng) → traducidas linealmente al viewBox
 * SVG. No es cartográfico: el objetivo es comunicar presencia urbana con
 * precisión relativa entre sedes, no precisión sub-cuadra.
 *
 *  · Magaldi:        Agustín Magaldi 1765 · Barracas, CABA  (~ -34.6443, -58.3781)
 *  · Pedro de Luján: Pedro de Luján 3159 · CABA              (~ -34.6447, -58.4625)
 *
 * Ambas están en Capital Federal — no hay sedes en Provincia.
 */

const PINS: Record<string, { x: number; y: number }> = {
  magaldi: { x: 380, y: 215 },
  lujan: { x: 296, y: 225 },
};

export function AmbaMap({ locations = LOCATIONS }: { locations?: LocationStatus[] }) {
  return (
    <svg viewBox="0 0 480 320" className="w-full h-auto">
      {/* Fondo: tinta sutil tipo carta náutica */}
      <defs>
        <linearGradient id="amba-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--bg-surface-alt)" />
          <stop offset="100%" stopColor="var(--bg-surface)" />
        </linearGradient>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(33,69,118,0.05)" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="caba-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(5,5,85,0.08)" />
          <stop offset="100%" stopColor="rgba(5,5,85,0)" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="480" height="320" fill="url(#amba-bg)" rx={10} />
      <rect x="0" y="0" width="480" height="320" fill="url(#grid)" rx={10} />

      {/* Río de la Plata (al noreste de CABA) */}
      <path
        d="M 410 30 Q 460 110 480 220 L 480 320 L 360 320 Q 400 200 410 30 Z"
        fill="rgba(33,69,118,0.08)"
      />
      <text x="445" y="200" fontSize="9" fill="#214576" opacity={0.5} textAnchor="middle">
        Río de la Plata
      </text>

      {/* CABA outline — ocupa ~70% del ancho útil para dar contexto urbano */}
      <ellipse
        cx="335"
        cy="218"
        rx="105"
        ry="78"
        fill="url(#caba-glow)"
        stroke="rgba(5,5,85,0.18)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <text
        x="265"
        y="160"
        fontSize="10"
        fill="var(--fg-muted)"
        textAnchor="start"
        fontWeight={700}
        letterSpacing="0.12em"
      >
        CABA
      </text>

      {/* Eje corredor sur (Av. Sáenz / Vélez Sarsfield / Av. Eva Perón) que conecta
          Pedro de Luján con Magaldi — todo dentro de Capital. */}
      <path
        d={`M ${PINS.lujan.x} ${PINS.lujan.y} Q ${(PINS.lujan.x + PINS.magaldi.x) / 2} ${PINS.lujan.y + 28} ${PINS.magaldi.x} ${PINS.magaldi.y}`}
        fill="none"
        stroke="rgba(201,8,18,0.28)"
        strokeWidth={1.5}
        strokeDasharray="3 3"
      />
      <text
        x={(PINS.lujan.x + PINS.magaldi.x) / 2}
        y={PINS.lujan.y + 48}
        fontSize="8"
        fill="var(--fg-muted)"
        textAnchor="middle"
      >
        Corredor sur · CABA
      </text>

      {/* Locations */}
      {locations.map((loc) => {
        const pin = PINS[loc.id];
        if (!pin) return null;
        const color =
          loc.tag === "ANMAT" ? "#C90812" : loc.tag === "General" ? "#050555" : "#214576";
        const labelOffsetY = -14;
        const subOffsetY = 22;
        return (
          <g key={loc.id}>
            <circle cx={pin.x} cy={pin.y} r={16} fill={color} opacity={0.15}>
              <animate attributeName="r" values="14;22;14" dur="3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.18;0.04;0.18" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx={pin.x} cy={pin.y} r={6} fill={color} stroke="white" strokeWidth={2} />
            <text
              x={pin.x}
              y={pin.y + labelOffsetY}
              fontSize="10"
              fill={color}
              textAnchor="middle"
              fontWeight={800}
            >
              {loc.name}
            </text>
            <text
              x={pin.x}
              y={pin.y + subOffsetY}
              fontSize="8"
              fill="var(--fg-muted)"
              textAnchor="middle"
            >
              {loc.tag}{loc.occupancyPct !== null ? ` · ${loc.occupancyPct}%` : ""}
            </text>
          </g>
        );
      })}

      {/* Compass */}
      <g transform="translate(440 270)" opacity={0.4}>
        <circle r="14" fill="none" stroke="var(--fg-muted)" strokeWidth={0.5} />
        <text fontSize="9" fill="var(--fg-muted)" textAnchor="middle" y={-4} fontWeight={700}>
          N
        </text>
        <line x1="0" y1="-12" x2="0" y2="12" stroke="var(--fg-muted)" strokeWidth={0.5} />
      </g>
    </svg>
  );
}

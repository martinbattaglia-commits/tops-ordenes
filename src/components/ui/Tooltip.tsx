"use client";

import type { ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TooltipProps {
  content: string;
  position?: "top" | "bottom";
  children: ReactNode;
  maxWidth?: number; // default 220
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * CSS-only hover tooltip — no JavaScript events, no external libraries.
 * Uses Tailwind group-hover to reveal an absolutely positioned tooltip bubble.
 * Supports top (default) and bottom positioning.
 */
export function Tooltip({
  content,
  position = "top",
  children,
  maxWidth = 220,
}: TooltipProps) {
  const isTop = position === "top";

  return (
    <div className="relative inline-block group/tooltip">
      {children}

      {/* Tooltip bubble */}
      <span
        role="tooltip"
        style={{ maxWidth: `${maxWidth}px` }}
        className={[
          // Positioning
          "pointer-events-none absolute left-1/2 -translate-x-1/2 z-50",
          isTop
            ? "bottom-full mb-2 -translate-y-0"
            : "top-full mt-2",
          // Appearance
          "rounded bg-gray-900 px-2 py-1 text-xs leading-snug text-white shadow-lg",
          // Transition
          "opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150",
          // Text
          "whitespace-normal break-words text-center",
        ].join(" ")}
      >
        {content}

        {/* Arrow */}
        <span
          aria-hidden="true"
          className={[
            "pointer-events-none absolute left-1/2 -translate-x-1/2 border-4 border-transparent",
            isTop
              ? "top-full border-t-gray-900"
              : "bottom-full border-b-gray-900",
          ].join(" ")}
        />
      </span>
    </div>
  );
}

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        // TOPS brand
        tops: {
          blue: {
            900: "#050555",
            700: "#214576",
          },
          red: "#C90812",
          white: "#FFFFFF",
        },
        // Neutrales (derived)
        neutral: {
          0: "#FFFFFF",
          50: "#F7F8FB",
          100: "#EEF1F6",
          200: "#DDE3EC",
          300: "#C2CAD6",
          400: "#8A94A6",
          500: "#5A6577",
          700: "#2A3340",
          900: "#0B1220",
        },
        // Semantic
        status: {
          success: "#0E7C3A",
          warning: "#B45309",
          danger: "#C90812",
          info: "#214576",
        },
        fg: {
          DEFAULT: "#0B1220",
          primary: "#0B1220",
          secondary: "#5A6577",
          muted: "#8A94A6",
          inverse: "#FFFFFF",
          brand: "#050555",
          accent: "#C90812",
          link: "#214576",
        },
        bg: {
          page: "#F7F8FB",
          surface: "#FFFFFF",
          "surface-alt": "#EEF1F6",
          brand: "#050555",
          "brand-alt": "#214576",
          accent: "#C90812",
        },
        stroke: {
          soft: "#DDE3EC",
          strong: "#C2CAD6",
          brand: "#214576",
        },
      },
      borderRadius: {
        xs: "2px",
        sm: "4px",
        md: "6px",
        lg: "10px",
        xl: "16px",
        pill: "999px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(5, 5, 85, 0.06)",
        sm: "0 2px 6px rgba(5, 5, 85, 0.08)",
        md: "0 6px 18px rgba(5, 5, 85, 0.10)",
        lg: "0 18px 40px rgba(5, 5, 85, 0.16)",
        "inset-soft": "inset 0 0 0 1px rgba(5, 5, 85, 0.06)",
        "ring-brand": "0 0 0 3px rgba(33, 69, 118, 0.18)",
      },
      fontFamily: {
        sans: [
          "Gotham",
          "var(--font-montserrat)",
          "Montserrat",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        rounded: ["Gotham Rounded", "Gotham", "var(--font-montserrat)", "Montserrat", "sans-serif"],
        mono: [
          "ui-monospace",
          "JetBrains Mono",
          "SF Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        "display-xl": ["72px", { lineHeight: "1.02", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-lg": ["56px", { lineHeight: "1.05", letterSpacing: "-0.015em", fontWeight: "700" }],
        eyebrow: ["12px", { lineHeight: "1.2", letterSpacing: "0.14em", fontWeight: "700" }],
        "eyebrow-sm": ["10px", { lineHeight: "1.2", letterSpacing: "0.16em", fontWeight: "700" }],
      },
      transitionTimingFunction: {
        "enter": "cubic-bezier(0.22, 1, 0.36, 1)",
        "exit": "cubic-bezier(0.4, 0, 1, 1)",
      },
      keyframes: {
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "toast-in": "toast-in 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        "fade-in": "fade-in 240ms ease-out",
        "slide-up": "slide-up 320ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;

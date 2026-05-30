import type { SVGProps } from "react";

export type IconName =
  | "dashboard"
  | "orders"
  | "plus"
  | "clients"
  | "report"
  | "bill"
  | "gear"
  | "search"
  | "bell"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up-right"
  | "trend-up"
  | "trend-down"
  | "check"
  | "check-circle"
  | "x"
  | "download"
  | "send"
  | "mail"
  | "phone"
  | "truck"
  | "forklift"
  | "package"
  | "building"
  | "pin"
  | "clock"
  | "calendar"
  | "filter"
  | "menu"
  | "menu-dots"
  | "eye"
  | "pen"
  | "export"
  | "qr"
  | "lock"
  | "user"
  | "sparkle"
  | "logout"
  | "chevron-down"
  | "chevron-right"
  | "refresh"
  | "paperclip"
  | "bolt"
  | "whatsapp"
  | "share"
  | "copy"
  | "trash"
  | "cart"
  | "vendors"
  | "drive"
  | "wand"
  | "cloud-check"
  | "cloud"
  | "file-pdf"
  | "wallet"
  | "tag"
  | "tag-alt"
  | "database"
  | "shield"
  | "pause"
  | "play"
  | "minus"
  | "folder"
  | "users"
  | "google"
  | "sun"
  | "moon";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "stroke"> {
  name: IconName;
  size?: number;
  stroke?: number;
}

export function Icon({ name, size = 18, stroke = 1.6, ...rest }: IconProps) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...rest,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "orders":
      return (
        <svg {...common}>
          <path d="M8 3h8l1 3v15a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V6l1-3Z" />
          <path d="M9 9h6M9 13h6M9 17h4" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "clients":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <circle cx="17" cy="9.5" r="2.5" />
          <path d="M15 19a4 4 0 0 1 6 0" />
        </svg>
      );
    case "report":
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <rect x="7" y="11" width="3" height="6" />
          <rect x="12" y="7" width="3" height="10" />
          <rect x="17" y="13" width="3" height="4" />
        </svg>
      );
    case "bill":
      return (
        <svg {...common}>
          <path d="M5 3h11l3 3v15l-3-2-2 2-2-2-2 2-2-2-3 2V3Z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case "gear":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8Z" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...common}>
          <path d="M19 12H5M11 5l-7 7 7 7" />
        </svg>
      );
    case "arrow-up-right":
      return (
        <svg {...common}>
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
      );
    case "trend-up":
      return (
        <svg {...common}>
          <path d="M3 17 9 11l4 4 8-8" />
          <path d="M14 4h7v7" />
        </svg>
      );
    case "trend-down":
      return (
        <svg {...common}>
          <path d="M3 7 9 13l4-4 8 8" />
          <path d="M14 20h7v-7" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 5 5L20 7" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 4v12M7 11l5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M22 2 11 13" />
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
        </svg>
      );
    case "mail":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      );
    case "phone":
      return (
        <svg {...common}>
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.7a2 2 0 0 1-.4 2L8 9.5a16 16 0 0 0 6 6l1-1.3a2 2 0 0 1 2-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2.1Z" />
        </svg>
      );
    case "truck":
      return (
        <svg {...common}>
          <path d="M14 16V5a1 1 0 0 0-1-1H2v12h2" />
          <path d="M14 8h4l4 4v4h-2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
          <path d="M9 18h6" />
        </svg>
      );
    case "forklift":
      return (
        <svg {...common}>
          <path d="M3 17V5h7v8h5" />
          <path d="M15 13V7l4 3v3" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="16" cy="19" r="2" />
          <path d="M19 17V5" />
          <path d="M19 5h-2" />
        </svg>
      );
    case "package":
      return (
        <svg {...common}>
          <path d="m3 7 9-4 9 4-9 4-9-4Z" />
          <path d="M3 7v10l9 4 9-4V7" />
          <path d="m3 7 9 4 9-4M12 11v10" />
        </svg>
      );
    case "building":
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="1" />
          <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
        </svg>
      );
    case "pin":
      return (
        <svg {...common}>
          <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 3v4M16 3v4" />
        </svg>
      );
    case "filter":
      return (
        <svg {...common}>
          <path d="M3 5h18l-7 9v6l-4-2v-4L3 5Z" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
    case "menu-dots":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="19" cy="12" r="1.4" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "pen":
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
        </svg>
      );
    case "export":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 9 5-5 5 5M12 4v12" />
        </svg>
      );
    case "qr":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3M20 14v0M14 20h3M20 17v4M17 20h4" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 1 1 8 0v3" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5M21 12H9" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      );
    case "paperclip":
      return (
        <svg {...common}>
          <path d="m21 11-9.5 9.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5L9 18" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-1.3 4.5L21 21l-5.1-1.3a8.4 8.4 0 1 1 5.1-8.2Z" />
          <path d="M8 9.5c.5 2.5 2 4 4.5 4.5" />
        </svg>
      );
    case "share":
      return (
        <svg {...common}>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
        </svg>
      );
    case "cart":
      return (
        <svg {...common}>
          <circle cx="9" cy="20" r="1.4" />
          <circle cx="17" cy="20" r="1.4" />
          <path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6" />
        </svg>
      );
    case "vendors":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="13" rx="1.5" />
          <path d="M8 7V5a4 4 0 0 1 8 0v2" />
          <path d="M3 11h18" />
        </svg>
      );
    case "drive":
      return (
        <svg {...common}>
          <path d="M8 3h8l5 9-4 7H7l-4-7z" />
          <path d="M8 3l4 9M16 3l-4 9M3 12h18" />
        </svg>
      );
    case "wand":
      return (
        <svg {...common}>
          <path d="M3 21l9-9" />
          <path d="M15 7l2-2 2 2-2 2zM7 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
        </svg>
      );
    case "cloud-check":
      return (
        <svg {...common}>
          <path d="M7 18a5 5 0 0 1-1-9.9A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5 9H7" />
          <path d="m10 15 2 2 4-4" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...common}>
          <path d="M7 18a5 5 0 0 1-1-9.9A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5 9H7" />
        </svg>
      );
    case "file-pdf":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 14h1.5a1.5 1.5 0 0 1 0 3H9zM13 14v3M13 14h2M16 17v-3h2M16 16h1.6" strokeWidth={1.4} />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="14" rx="2" />
          <path d="M3 10h18M16 14h2" />
        </svg>
      );
    case "tag":
    case "tag-alt":
      return (
        <svg {...common}>
          <path d="M3 12 12 3h7a2 2 0 0 1 2 2v7l-9 9z" />
          <circle cx="16" cy="8" r="1.5" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M7 5l12 7-12 7z" />
        </svg>
      );
    case "minus":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
        </svg>
      );
    case "google":
      return (
        <svg {...common}>
          <path d="M21 12.2c0-.7-.06-1.2-.2-1.8H12v3.4h5.1a4.4 4.4 0 0 1-1.9 2.9v2.4h3.1c1.8-1.7 2.7-4.1 2.7-6.9Z" />
          <path d="M12 21c2.4 0 4.5-.8 6-2.2l-3.1-2.4c-.9.6-2 .9-2.9.9-2.2 0-4.2-1.5-4.8-3.6H4v2.4A9 9 0 0 0 12 21Z" />
          <path d="M7.2 13.7a5.4 5.4 0 0 1 0-3.4V7.9H4a9 9 0 0 0 0 8.2l3.2-2.4Z" />
          <path d="M12 6.6c1.3 0 2.4.5 3.3 1.3l2.5-2.5A9 9 0 0 0 4 7.9l3.2 2.4C7.8 8.1 9.8 6.6 12 6.6Z" />
        </svg>
      );
    case "sun":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      );
    case "moon":
      return (
        <svg {...common}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

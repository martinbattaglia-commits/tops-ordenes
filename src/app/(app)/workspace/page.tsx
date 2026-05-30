import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { PRODUCT } from "@/lib/org";

export const metadata = { title: "Google Workspace" };

/* ── Iconos oficiales de marca (SVG inline, multicolor) ──────────────────── */

function GoogleGLogo() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">
      <path
        fill="#ffc107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#ff3d00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4caf50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976d2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C39.5 36.5 44 30.9 44 24c0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

function GmailLogo() {
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7a3 3 0 0 0 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z" />
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A3.299 3.299 0 0 0 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A3.299 3.299 0 0 1 45 12.298z" />
    </svg>
  );
}

function CalendarLogo() {
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
      <path
        fill="#fff"
        stroke="#dadce0"
        strokeWidth="1"
        d="M37 42H11a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5h26a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5z"
      />
      <path fill="#1e88e5" d="M11 6h26a5 5 0 0 1 5 5v3H6v-3a5 5 0 0 1 5-5z" />
      <text
        x="24"
        y="34"
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        fill="#1a73e8"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        31
      </text>
    </svg>
  );
}

function DriveLogo() {
  return (
    <svg viewBox="0 0 87.3 78" width="34" height="34" aria-hidden="true">
      <path
        fill="#0066da"
        d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z"
      />
      <path
        fill="#00ac47"
        d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z"
      />
      <path
        fill="#ea4335"
        d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.5l5.85 11.5z"
      />
      <path
        fill="#00832d"
        d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"
      />
      <path
        fill="#2684fc"
        d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
      />
      <path
        fill="#ffba00"
        d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z"
      />
    </svg>
  );
}

function MeetLogo() {
  return (
    <svg viewBox="0 0 87.5 72" width="34" height="34" aria-hidden="true">
      <path fill="#00832d" d="M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z" />
      <path fill="#0066da" d="M0 51.5V66a6 6 0 0 0 6 6h14.5l3-10.96-3-9.54-9.95-3z" />
      <path fill="#e94235" d="M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z" />
      <path fill="#2684fc" d="M20.5 20.5H0v31h20.5z" />
      <path
        fill="#00ac47"
        d="M82.6 8.68L69.5 19.42v33.66l13.16 10.79c1.97 1.54 4.84.14 4.84-2.37V11c0-2.53-2.94-3.92-4.9-2.32zM49.5 36v15.5h-29V72h43a6 6 0 0 0 6-6V53.08z"
      />
      <path fill="#ffba00" d="M63.5 0h-43v20.5h29V36l20-16.57V6a6 6 0 0 0-6-6z" />
    </svg>
  );
}

function ContactsLogo() {
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
      <rect x="8" y="8" width="32" height="32" rx="6" fill="#fff" stroke="#dadce0" strokeWidth="1" />
      <circle cx="24" cy="20" r="5.5" fill="#4285f4" />
      <path fill="#4285f4" d="M14.5 33c0-4.4 4.25-7.5 9.5-7.5s9.5 3.1 9.5 7.5v1h-19z" />
      <rect x="2.5" y="15" width="5" height="2.4" rx="1.2" fill="#1a73e8" />
      <rect x="2.5" y="23" width="5" height="2.4" rx="1.2" fill="#1a73e8" />
      <rect x="40.5" y="15" width="5" height="2.4" rx="1.2" fill="#1a73e8" />
      <rect x="40.5" y="23" width="5" height="2.4" rx="1.2" fill="#1a73e8" />
    </svg>
  );
}

function GeminiLogo() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
      <defs>
        <linearGradient id="gws-gemini" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4285f4" />
          <stop offset="0.5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gws-gemini)"
        d="M12 0c0 6.627-5.373 12-12 12 6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z"
      />
    </svg>
  );
}

/* ── Datos de los accesos directos ──────────────────────────────────────── */

interface Tool {
  key: string;
  name: string;
  description: string;
  url: string;
  badge: string;
  logo: ReactNode;
  /** Color de marca y derivados para el glow/borde en hover (custom props CSS). */
  accent: string;
  glow: string;
  border: string;
}

const TOOLS: Tool[] = [
  {
    key: "gmail",
    name: "Gmail",
    description: "Correo corporativo y bandejas de equipo.",
    url: "https://mail.google.com",
    badge: "Comunicación",
    logo: <GmailLogo />,
    accent: "rgba(234,67,53,0.30)",
    glow: "rgba(234,67,53,0.40)",
    border: "rgba(234,67,53,0.45)",
  },
  {
    key: "calendar",
    name: "Calendar",
    description: "Agenda corporativa y gestión de reuniones.",
    url: "https://calendar.google.com",
    badge: "Productividad",
    logo: <CalendarLogo />,
    accent: "rgba(26,115,232,0.30)",
    glow: "rgba(26,115,232,0.40)",
    border: "rgba(26,115,232,0.45)",
  },
  {
    key: "drive",
    name: "Drive",
    description: "Documentación corporativa y archivos.",
    url: "https://drive.google.com",
    badge: "Documentación",
    logo: <DriveLogo />,
    accent: "rgba(255,186,0,0.30)",
    glow: "rgba(255,186,0,0.38)",
    border: "rgba(255,186,0,0.50)",
  },
  {
    key: "meet",
    name: "Meet",
    description: "Videoconferencias y reuniones.",
    url: "https://meet.google.com",
    badge: "Reuniones",
    logo: <MeetLogo />,
    accent: "rgba(0,131,45,0.30)",
    glow: "rgba(0,131,45,0.38)",
    border: "rgba(0,131,45,0.45)",
  },
  {
    key: "contacts",
    name: "Contacts",
    description: "Directorio corporativo.",
    url: "https://contacts.google.com",
    badge: "Contactos",
    logo: <ContactsLogo />,
    accent: "rgba(66,133,244,0.30)",
    glow: "rgba(66,133,244,0.40)",
    border: "rgba(66,133,244,0.45)",
  },
  {
    key: "gemini",
    name: "Gemini",
    description: "Asistente de inteligencia artificial de Google.",
    url: "https://gemini.google.com",
    badge: "Inteligencia Artificial",
    logo: <GeminiLogo />,
    accent: "rgba(155,114,203,0.32)",
    glow: "rgba(155,114,203,0.42)",
    border: "rgba(155,114,203,0.48)",
  },
];

/* Estado de integración (informativo · no consume APIs). */
interface IntegrationState {
  label: string;
  status: string;
  tone: "ok" | "soon" | "off";
}

const INTEGRATION: IntegrationState[] = [
  { label: "Enlaces directos", status: "Activo", tone: "ok" },
  { label: "SSO Workspace", status: "Próximamente", tone: "soon" },
  { label: "APIs Google", status: "No conectado", tone: "off" },
];

/* Dashboard de estado por servicio (informativo · no consume APIs). */
type ServiceTone = "ok" | "soon" | "off";

interface ServiceStatus {
  name: string;
  status: string;
  tone: ServiceTone;
  logo: ReactNode;
}

const SERVICE_STATUS: ServiceStatus[] = [
  { name: "Gmail", status: "Activo", tone: "ok", logo: <GmailLogo /> },
  { name: "Calendar", status: "Activo", tone: "ok", logo: <CalendarLogo /> },
  { name: "Drive", status: "Activo", tone: "ok", logo: <DriveLogo /> },
  { name: "Meet", status: "Próximamente", tone: "soon", logo: <MeetLogo /> },
  { name: "Gemini", status: "No conectado", tone: "off", logo: <GeminiLogo /> },
];

/* Widgets visuales — datos de ejemplo (mockup). Sin OAuth, sin APIs, sin backend. */
const MOCK_EVENTS = [
  { time: "09:00", title: "Reunión operativa · depósito Magaldi", tone: "bg-tops-red" },
  { time: "11:30", title: "Auditoría ANMAT · cadena de frío", tone: "bg-amber-400" },
  { time: "15:00", title: "Llamada proveedor logístico", tone: "bg-tops-blue-700" },
  { time: "17:30", title: "Cierre de remitos del día", tone: "bg-emerald-400" },
];

const MOCK_MAILS = [
  { from: "Operaciones", subject: "Coordinación de entrega · ruta CABA", time: "8:42", unread: true },
  { from: "Proveedor SRL", subject: "Remito firmado · OC-1042", time: "Ayer", unread: true },
  { from: "Compliance", subject: "Vencimiento habilitación ANMAT", time: "Ayer", unread: false },
  { from: "Verotin S.A.", subject: "Conciliación facturación mayo", time: "Lun", unread: false },
];

const MOCK_DOCS = [
  { name: "Contrato_Verotin_2026.pdf", meta: "PDF · 1.2 MB", icon: "file-pdf" as const },
  { name: "Habilitacion_ANMAT_Magaldi.pdf", meta: "PDF · 840 KB", icon: "file-pdf" as const },
  { name: "Reporte_Operativo_Mayo.xlsx", meta: "Hoja de cálculo · 220 KB", icon: "report" as const },
  { name: "Procedimientos_Deposito.docx", meta: "Documento · 96 KB", icon: "orders" as const },
];

const GEMINI_ACTIONS: { label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { label: "Redactar Email", icon: "mail" },
  { label: "Crear Minuta", icon: "pen" },
  { label: "Generar Propuesta Comercial", icon: "bolt" },
  { label: "Resumir Documento", icon: "file-pdf" },
];

/* ── V3 · Centro operativo corporativo (todo simulado · sin APIs) ────────── */

/* KPIs ejecutivos por servicio. */
interface WorkspaceKpi {
  key: string;
  service: string;
  label: string;
  value: string;
  logo: ReactNode;
  accent: string;
  glow: string;
  border: string;
}

const WORKSPACE_KPIS: WorkspaceKpi[] = [
  {
    key: "gmail",
    service: "Gmail",
    label: "Correos pendientes",
    value: "12",
    logo: <GmailLogo />,
    accent: "rgba(234,67,53,0.30)",
    glow: "rgba(234,67,53,0.40)",
    border: "rgba(234,67,53,0.45)",
  },
  {
    key: "calendar",
    service: "Calendar",
    label: "Reuniones hoy",
    value: "4",
    logo: <CalendarLogo />,
    accent: "rgba(26,115,232,0.30)",
    glow: "rgba(26,115,232,0.40)",
    border: "rgba(26,115,232,0.45)",
  },
  {
    key: "drive",
    service: "Drive",
    label: "Documentos recientes",
    value: "28",
    logo: <DriveLogo />,
    accent: "rgba(255,186,0,0.30)",
    glow: "rgba(255,186,0,0.38)",
    border: "rgba(255,186,0,0.50)",
  },
  {
    key: "gemini",
    service: "Gemini",
    label: "Acciones IA disponibles",
    value: "6",
    logo: <GeminiLogo />,
    accent: "rgba(155,114,203,0.32)",
    glow: "rgba(155,114,203,0.42)",
    border: "rgba(155,114,203,0.48)",
  },
  {
    key: "meet",
    service: "Meet",
    label: "Próxima reunión",
    value: "15:00",
    logo: <MeetLogo />,
    accent: "rgba(0,131,45,0.30)",
    glow: "rgba(0,131,45,0.38)",
    border: "rgba(0,131,45,0.45)",
  },
];

/* Activity Center · timeline simulada. */
interface ActivityItem {
  key: string;
  title: string;
  detail: string;
  time: string;
  icon: Parameters<typeof Icon>[0]["name"];
  tone: string;
}

const WORKSPACE_ACTIVITY: ActivityItem[] = [
  { key: "doc", title: "Documento subido", detail: "Contrato_Verotin_2026.pdf · Drive", time: "hace 8 min", icon: "folder", tone: "text-amber-500" },
  { key: "meeting", title: "Reunión creada", detail: "Auditoría ANMAT · cadena de frío", time: "hace 25 min", icon: "calendar", tone: "text-tops-blue-700" },
  { key: "mail", title: "Correo recibido", detail: "Operaciones · coordinación ruta CABA", time: "hace 40 min", icon: "mail", tone: "text-tops-red" },
  { key: "gemini", title: "Gemini utilizado", detail: "Resumen de documento operativo", time: "hace 1 h", icon: "sparkle", tone: "text-[#9b72cb]" },
  { key: "contact", title: "Contacto agregado", detail: "Proveedor SRL · directorio corporativo", time: "hace 2 h", icon: "user", tone: "text-emerald-500" },
];

/* Gemini Operations Center · cards de capacidades IA (futuras). */
const GEMINI_OPERATIONS: { key: string; label: string; description: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { key: "propuesta", label: "Generar propuesta comercial", description: "Borrador comercial a partir de un brief.", icon: "bolt" },
  { key: "minuta", label: "Generar minuta de reunión", description: "Resumen y acuerdos de una reunión.", icon: "pen" },
  { key: "resumen", label: "Resumir documento", description: "Síntesis ejecutiva de un archivo.", icon: "file-pdf" },
  { key: "email", label: "Redactar email", description: "Correo corporativo con tono adecuado.", icon: "mail" },
  { key: "procedimiento", label: "Crear procedimiento operativo", description: "SOP estructurado para el depósito.", icon: "orders" },
  { key: "contrato", label: "Generar contrato", description: "Plantilla contractual base.", icon: "shield" },
];

/* Quick Links · accesos rápidos (abren en pestaña nueva). */
const QUICK_LINKS: { label: string; url: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { label: "Gmail", url: "https://mail.google.com", icon: "mail" },
  { label: "Calendar", url: "https://calendar.google.com", icon: "calendar" },
  { label: "Drive", url: "https://drive.google.com", icon: "folder" },
  { label: "Meet", url: "https://meet.google.com", icon: "eye" },
  { label: "Contacts", url: "https://contacts.google.com", icon: "users" },
  { label: "Gemini", url: "https://gemini.google.com", icon: "sparkle" },
  { label: "Admin Console", url: "https://admin.google.com", icon: "shield" },
  { label: "Google Keep", url: "https://keep.google.com", icon: "tag" },
  { label: "Google Tasks", url: "https://tasks.google.com", icon: "check-circle" },
];

/* Health Monitor · estado de salud por servicio (mock). */
type HealthTone = "up" | "warn" | "down";

interface HealthService {
  name: string;
  status: string;
  tone: HealthTone;
  uptime: string;
  logo: ReactNode;
}

const HEALTH_SERVICES: HealthService[] = [
  { name: "Gmail", status: "Operativo", tone: "up", uptime: "99.9%", logo: <GmailLogo /> },
  { name: "Calendar", status: "Operativo", tone: "up", uptime: "99.8%", logo: <CalendarLogo /> },
  { name: "Drive", status: "Operativo", tone: "up", uptime: "99.9%", logo: <DriveLogo /> },
  { name: "Meet", status: "Advertencia", tone: "warn", uptime: "97.4%", logo: <MeetLogo /> },
  { name: "Gemini", status: "Desconectado", tone: "down", uptime: "—", logo: <GeminiLogo /> },
];

function healthDot(tone: HealthTone) {
  if (tone === "up") return "bg-emerald-400 shadow-[0_0_0_3px_rgba(54,194,117,0.22)]";
  if (tone === "warn") return "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.20)]";
  return "bg-tops-red shadow-[0_0_0_3px_rgba(229,57,53,0.18)]";
}

function healthText(tone: HealthTone) {
  if (tone === "up") return "text-emerald-500";
  if (tone === "warn") return "text-amber-500";
  return "text-tops-red";
}

/* Servicios contemplados para una futura integración SSO (no implementada). */
const SSO_FUTURE = ["Gmail", "Calendar", "Drive", "Meet", "Contacts", "Gemini"];

function toneDot(tone: ServiceTone) {
  if (tone === "ok") return "bg-emerald-400 shadow-[0_0_0_3px_rgba(54,194,117,0.22)]";
  if (tone === "soon") return "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.20)]";
  return "bg-fg-secondary/40";
}

function toneText(tone: ServiceTone) {
  if (tone === "ok") return "text-emerald-500";
  if (tone === "soon") return "text-amber-500";
  return "text-fg-secondary";
}

export default function WorkspacePage() {
  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-8">
      {/* ── Dashboard Workspace · header ─────────────────────────────────── */}
      <section className="card overflow-hidden relative">
        <div
          className="absolute inset-0 pointer-events-none opacity-90"
          style={{
            background:
              "radial-gradient(ellipse at top right, rgba(66,133,244,0.12), transparent 58%), radial-gradient(ellipse at bottom left, rgba(33,69,118,0.12), transparent 60%)",
          }}
        />
        <div className="relative p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 shrink-0 rounded-2xl bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm">
              <GoogleGLogo />
            </div>
            <div className="flex-1 min-w-0">
              <div className="eyebrow-tiny">{PRODUCT.name} · Accesos corporativos</div>
              <h1 className="page-title">Google Workspace</h1>
              <p className="page-subtitle max-w-2xl">
                Hub corporativo de las herramientas de Google que utiliza Logística TOPS. Cada acceso
                abre el servicio oficial en una pestaña nueva.
              </p>
            </div>
          </div>

          {/* Estado de integración */}
          <div className="mt-6">
            <div className="eyebrow-tiny mb-2">Estado de integración</div>
            <div className="gws-shine flex flex-wrap gap-2 rounded-xl border border-stroke-soft bg-bg-surface/60 p-2">
              {INTEGRATION.map((it) => (
                <div
                  key={it.label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-surface border border-stroke-soft"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${toneDot(it.tone)}`} />
                  <span className="text-[12px] font-semibold text-fg-primary">{it.label}</span>
                  <span className="text-[11px] text-fg-secondary">· {it.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Workspace Search Hub · buscador global (visual, sin backend) ──── */}
      <section className="gws-card card overflow-hidden relative p-5 md:p-6">
        <div
          className="absolute inset-0 pointer-events-none opacity-80"
          style={{
            background:
              "radial-gradient(ellipse at center left, rgba(66,133,244,0.10), transparent 60%)",
          }}
        />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="eyebrow-tiny">Workspace Search Hub</div>
            <p className="text-[13px] text-fg-secondary">
              Búsqueda global en correos, reuniones, documentos y contactos.
            </p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded shrink-0">
            Simulado
          </span>
        </div>
        <div className="relative mt-4 gws-shine flex items-center gap-3 rounded-xl border border-stroke-soft bg-bg-surface/70 px-4 py-3 shadow-sm">
          <Icon name="search" size={18} className="text-fg-secondary shrink-0" />
          <span className="flex-1 text-[13px] text-fg-secondary truncate">
            Buscar correos, reuniones, documentos o contactos…
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-1.5 py-0.5 rounded">
            ⌘K
          </span>
        </div>
      </section>

      {/* ── Workspace KPIs · indicadores ejecutivos (simulado, sin APIs) ──── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Workspace KPIs</div>
            <p className="text-[13px] text-fg-secondary">Indicadores operativos por servicio.</p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded">
            Simulado
          </span>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {WORKSPACE_KPIS.map((kpi, i) => (
            <div
              key={kpi.key}
              style={
                {
                  "--gws-accent": kpi.accent,
                  "--gws-glow": kpi.glow,
                  "--gws-border": kpi.border,
                  animationDelay: `${i * 45}ms`,
                } as CSSProperties
              }
              className="gws-card gws-stagger card p-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="gws-icon-tile w-10 h-10 shrink-0 rounded-lg bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm">
                  {kpi.logo}
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-1.5 py-0.5 rounded">
                  {kpi.service}
                </span>
              </div>
              <div>
                <div className="text-2xl font-black text-fg-primary tracking-tight tabular-nums leading-none">
                  {kpi.value}
                </div>
                <div className="text-[11px] font-semibold text-fg-secondary mt-1 leading-snug">
                  {kpi.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Workspace Dashboard · estado por servicio (visual, sin APIs) ──── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Workspace Dashboard</div>
            <p className="text-[13px] text-fg-secondary">Estado de cada servicio · informativo.</p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded">
            Sin consumo de APIs
          </span>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {SERVICE_STATUS.map((s, i) => (
            <div
              key={s.name}
              style={{ animationDelay: `${i * 45}ms` } as CSSProperties}
              className="gws-card gws-stagger card p-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="gws-icon-tile w-10 h-10 shrink-0 rounded-lg bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm">
                  {s.logo}
                </div>
                <span className={`w-2 h-2 rounded-full ${toneDot(s.tone)}`} />
              </div>
              <div>
                <div className="text-[13px] font-black text-fg-primary tracking-tight">{s.name}</div>
                <div className={`text-[11px] font-semibold ${toneText(s.tone)}`}>{s.status}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Workspace Hub · grid ejecutivo de las 6 herramientas ─────────── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Workspace Hub</div>
            <p className="text-[13px] text-fg-secondary">Accesos directos a las 6 herramientas.</p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded">
            {TOOLS.length} apps
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool, i) => (
            <a
              key={tool.key}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Abrir ${tool.name} en una pestaña nueva`}
              style={
                {
                  "--gws-accent": tool.accent,
                  "--gws-glow": tool.glow,
                  "--gws-border": tool.border,
                  animationDelay: `${i * 55}ms`,
                } as CSSProperties
              }
              className="gws-card gws-stagger card p-5 flex flex-col gap-4 group focus:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="gws-icon-tile w-14 h-14 shrink-0 rounded-xl bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm">
                  {tool.logo}
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-1.5 py-0.5 rounded">
                  {tool.badge}
                </span>
              </div>

              <div className="flex-1">
                <div className="text-base font-black text-fg-primary tracking-tight">{tool.name}</div>
                <p className="text-[13px] text-fg-secondary mt-1 leading-snug">{tool.description}</p>
              </div>

              <span className="btn btn-primary btn-sm btn-shimmer w-full justify-center pointer-events-none">
                <span>Abrir</span>
                <Icon name="arrow-right" size={14} stroke={2.2} />
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* ── Gemini Operations Center · capacidades IA (futuras, sin APIs) ── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="gws-icon-tile w-10 h-10 shrink-0 rounded-lg bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm">
              <GeminiLogo />
            </div>
            <div>
              <div className="eyebrow-tiny">Gemini Operations Center</div>
              <p className="text-[13px] text-fg-secondary">
                Capacidades de IA para operación corporativa.
              </p>
            </div>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded shrink-0">
            Próximamente
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GEMINI_OPERATIONS.map((op, i) => (
            <div
              key={op.key}
              style={
                {
                  "--gws-accent": "rgba(155,114,203,0.32)",
                  "--gws-glow": "rgba(155,114,203,0.42)",
                  "--gws-border": "rgba(155,114,203,0.48)",
                  animationDelay: `${i * 50}ms`,
                } as CSSProperties
              }
              className="gws-card gws-stagger card p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="gws-icon-tile w-11 h-11 shrink-0 rounded-xl bg-fg-secondary/[0.07] border border-stroke-soft grid place-items-center text-[#9b72cb]">
                  <Icon name={op.icon} size={18} />
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-1.5 py-0.5 rounded">
                  Próximamente
                </span>
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-black text-fg-primary tracking-tight leading-tight">
                  {op.label}
                </div>
                <p className="text-[12px] text-fg-secondary mt-1 leading-snug">{op.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Widgets visuales · datos de ejemplo (mockup, sin APIs) ───────── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Workspace insights</div>
            <p className="text-[13px] text-fg-secondary">
              Widgets de ejemplo de la experiencia futura.
            </p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded shrink-0">
            Datos de ejemplo
          </span>
        </div>
        <p className="text-[12px] text-fg-secondary max-w-2xl">
          Los datos son ilustrativos: hoy no se consultan datos reales ni se consumen APIs de Google.
        </p>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Próximos eventos */}
          <div
            style={{ animationDelay: "0ms" } as CSSProperties}
            className="gws-card gws-stagger card p-5 flex flex-col gap-4"
          >
            <WidgetHeader title="Próximos eventos" source="Calendar" icon="calendar" />
            <div className="flex flex-col gap-2.5">
              {MOCK_EVENTS.map((e) => (
                <div key={e.time} className="flex items-center gap-3">
                  <span className={`w-1.5 h-9 rounded-full ${e.tone}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold text-fg-primary tabular-nums">{e.time}</div>
                    <div className="text-[12px] text-fg-secondary truncate">{e.title}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Correos recientes */}
          <div
            style={{ animationDelay: "55ms" } as CSSProperties}
            className="gws-card gws-stagger card p-5 flex flex-col gap-4"
          >
            <WidgetHeader title="Correos recientes" source="Gmail" icon="mail" />
            <div className="flex flex-col divide-y divide-stroke-soft -my-1">
              {MOCK_MAILS.map((m) => (
                <div key={m.subject} className="flex items-start gap-3 py-2">
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                      m.unread ? "bg-tops-red" : "bg-fg-secondary/30"
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[12px] truncate ${
                          m.unread ? "font-bold text-fg-primary" : "font-semibold text-fg-secondary"
                        }`}
                      >
                        {m.from}
                      </span>
                      <span className="text-[10px] text-fg-secondary shrink-0">{m.time}</span>
                    </div>
                    <div className="text-[12px] text-fg-secondary truncate">{m.subject}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Documentos recientes */}
          <div
            style={{ animationDelay: "110ms" } as CSSProperties}
            className="gws-card gws-stagger card p-5 flex flex-col gap-4"
          >
            <WidgetHeader title="Documentos recientes" source="Drive" icon="folder" />
            <div className="flex flex-col gap-1.5">
              {MOCK_DOCS.map((d) => (
                <div
                  key={d.name}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-fg-secondary/[0.06] transition-colors"
                >
                  <div className="w-8 h-8 shrink-0 rounded-md bg-bg-surface border border-stroke-soft grid place-items-center text-fg-secondary">
                    <Icon name={d.icon} size={15} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-fg-primary truncate">{d.name}</div>
                    <div className="text-[10px] text-fg-secondary">{d.meta}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Gemini Quick Actions */}
        <div
          style={{ animationDelay: "150ms" } as CSSProperties}
          className="gws-card gws-stagger card p-5 flex flex-col gap-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="gws-icon-tile w-10 h-10 shrink-0 rounded-lg bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm">
                <GeminiLogo />
              </div>
              <div>
                <div className="text-[13px] font-black text-fg-primary tracking-tight">
                  Gemini · Acciones rápidas
                </div>
                <div className="text-[11px] text-fg-secondary">
                  UX preparada para futuras integraciones de IA.
                </div>
              </div>
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-1.5 py-0.5 rounded shrink-0">
              Próximamente
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {GEMINI_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                disabled
                aria-disabled="true"
                className="group flex items-center gap-3 rounded-xl border border-stroke-soft bg-bg-surface px-3.5 py-3 text-left transition-all hover:border-tops-blue-700/40 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-95"
              >
                <span className="w-9 h-9 shrink-0 rounded-lg bg-fg-secondary/[0.07] border border-stroke-soft grid place-items-center text-tops-blue-700 transition-colors group-hover:bg-tops-blue-700/10">
                  <Icon name={a.icon} size={16} />
                </span>
                <span className="text-[12.5px] font-semibold text-fg-primary leading-tight">
                  {a.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workspace Activity Center · timeline (simulada, sin APIs) ─────── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Workspace Activity Center</div>
            <p className="text-[13px] text-fg-secondary">Actividad reciente del espacio de trabajo.</p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded">
            Simulado
          </span>
        </div>

        <div className="gws-card card p-5">
          <ol className="relative flex flex-col gap-4 before:absolute before:left-[18px] before:top-2 before:bottom-2 before:w-px before:bg-stroke-soft">
            {WORKSPACE_ACTIVITY.map((a, i) => (
              <li
                key={a.key}
                style={{ animationDelay: `${i * 45}ms` } as CSSProperties}
                className="gws-stagger relative flex items-start gap-4"
              >
                <span
                  className={`relative z-[1] w-9 h-9 shrink-0 rounded-full bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm ${a.tone}`}
                >
                  <Icon name={a.icon} size={15} />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-fg-primary tracking-tight truncate">
                      {a.title}
                    </span>
                    <span className="text-[10px] text-fg-secondary shrink-0">{a.time}</span>
                  </div>
                  <div className="text-[12px] text-fg-secondary truncate">{a.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Workspace Quick Links · accesos rápidos (pestaña nueva) ───────── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Workspace Quick Links</div>
            <p className="text-[13px] text-fg-secondary">Accesos rápidos a los servicios de Google.</p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded">
            {QUICK_LINKS.length} accesos
          </span>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK_LINKS.map((link, i) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Abrir ${link.label} en una pestaña nueva`}
              style={{ animationDelay: `${i * 35}ms` } as CSSProperties}
              className="gws-card gws-stagger card p-3.5 flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700/50"
            >
              <span className="gws-icon-tile w-9 h-9 shrink-0 rounded-lg bg-bg-surface border border-stroke-soft grid place-items-center text-tops-blue-700">
                <Icon name={link.icon} size={16} />
              </span>
              <span className="text-[13px] font-semibold text-fg-primary truncate flex-1">
                {link.label}
              </span>
              <Icon
                name="arrow-up-right"
                size={14}
                className="text-fg-secondary opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0"
              />
            </a>
          ))}
        </div>
      </section>

      {/* ── Workspace Health Monitor · estado de salud (mock, sin APIs) ───── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Workspace Health Monitor</div>
            <p className="text-[13px] text-fg-secondary">Estado de salud de los servicios.</p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded">
            Mock data
          </span>
        </div>

        <div className="gws-card card divide-y divide-stroke-soft">
          {HEALTH_SERVICES.map((s, i) => (
            <div
              key={s.name}
              style={{ animationDelay: `${i * 40}ms` } as CSSProperties}
              className="gws-stagger flex items-center gap-3 p-4"
            >
              <div className="gws-icon-tile w-9 h-9 shrink-0 rounded-lg bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm">
                {s.logo}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-black text-fg-primary tracking-tight">{s.name}</div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${healthDot(s.tone)}`} />
                  <span className={`text-[11px] font-semibold ${healthText(s.tone)}`}>
                    {s.status}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[13px] font-bold text-fg-primary tabular-nums">{s.uptime}</div>
                <div className="text-[10px] text-fg-secondary uppercase tracking-wider">Uptime</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Nota de arquitectura SSO (preparación, no implementación) ────── */}
      <section className="card p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-fg-secondary">
            <Icon name="lock" size={12} /> Futuro · SSO Google Workspace
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-1.5 py-0.5 rounded">
            No implementado
          </span>
        </div>
        <p className="text-[12px] text-fg-secondary leading-relaxed">
          Estos accesos son enlaces directos: no modifican la autenticación actual, no usan OAuth ni
          consumen APIs de Google. La arquitectura queda preparada para evaluar, en una fase futura,
          un inicio de sesión único (SSO) para{" "}
          <span className="font-semibold text-fg-primary">{SSO_FUTURE.join(" · ")}</span>.
        </p>
      </section>
    </div>
  );
}

function WidgetHeader({
  title,
  source,
  icon,
}: {
  title: string;
  source: string;
  icon: Parameters<typeof Icon>[0]["name"];
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-bg-surface border border-stroke-soft grid place-items-center text-fg-secondary">
          <Icon name={icon} size={16} />
        </div>
        <div>
          <div className="text-[13px] font-bold text-fg-primary tracking-tight">{title}</div>
          <div className="text-[11px] text-fg-secondary">{source}</div>
        </div>
      </div>
      <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-1.5 py-0.5 rounded shrink-0">
        Ejemplo
      </span>
    </div>
  );
}

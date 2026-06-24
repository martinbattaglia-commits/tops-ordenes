/**
 * Enlaces al Google Workspace corporativo.
 *
 * Gmail, Calendar y Drive soportan el path oficial `/a/<dominio>/`, que fuerza
 * la sesión del Workspace de la empresa (evita el selector de cuentas / la
 * cuenta personal). Meet, Contacts y Gemini no tienen ese path → usar la URL
 * canónica `https://<sub>.google.com`.
 *
 * Fuente única para topbar, Accesos Google y el Command Center del Cockpit.
 */
import { ORG } from "@/lib/org";

/** Dominio del Workspace corporativo (p. ej. `logisticatops.com`). */
export const WS_DOMAIN = ORG.googleWorkspaceDomain;

/** URL a un servicio Google forzando la sesión del Workspace de la empresa. */
export const ws = (sub: string) => `https://${sub}.google.com/a/${WS_DOMAIN}/`;

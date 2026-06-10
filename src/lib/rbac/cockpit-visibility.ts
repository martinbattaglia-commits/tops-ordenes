/**
 * Visibilidad condicional DENTRO del único Cockpit (/ejecutivo).
 *
 * No hay split de superficies: un solo Cockpit con bloques que se muestran u
 * ocultan según permiso. Los bloques operativos (Vacancia, Accesos Google, CCTV,
 * Tracking de flota, Organigrama) son visibles para todos los roles operativos;
 * los bloques financieros/ejecutivos (Cash Flow, Facturación, Cobranza, Analytics
 * Ejecutivo) sólo para quien tenga el permiso ejecutivo.
 *
 * Se apoya en el permiso EXISTENTE `cockpit.view` (no se inventan dominios):
 *   · Debe concederse a SUPER_ADMIN + ADMIN_OPERATIVO.
 *   · Comercial, Finanzas y encargados de depósito NO lo tienen → ven sólo lo operativo.
 *
 * Nota: con RBAC dormido (user_roles vacío) checkPermission hace fail-open y
 * devuelve true (estado FASE 1 conocido). El cierre efectivo es operacional
 * (seed user_roles + RBAC_ENFORCE=1).
 */
import { getBootPermissions } from "./boot-permissions";

/**
 * ¿Puede ver los bloques financieros/ejecutivos del Cockpit? (super_admin + admin_operativo)
 *
 * F1+F2 (2026-06-09): delega en getBootPermissions() — misma semántica que el
 * checkPermission("cockpit.view") previo, pero deduplicada por request (cache)
 * y con presupuesto duro anti-cuelgue. checkPermission sigue vigente para las
 * API routes (drive, libro-iva), que no pasan por acá.
 */
export async function canViewExecutiveFinancialBlocks(): Promise<boolean> {
  return (await getBootPermissions()).exec;
}

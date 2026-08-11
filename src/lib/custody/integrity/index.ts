/**
 * Validación de Integridad de Custodia — API pública del módulo.
 *
 * REVISIÓN 3 tras el C4 final. Superficie deliberadamente acotada: tipos,
 * políticas puras, contratos de puerto y casos de uso. Los adaptadores de
 * prueba (repositorio en memoria, proveedores sintéticos) **no se exportan
 * acá**: viven en `./test-doubles` y hay que importarlos explícitamente, para
 * que no puedan usarse como vía alternativa desde el resto de la aplicación.
 *
 * NO es enforcement productivo. Faltan el adaptador Supabase, la RPC
 * transaccional, el adaptador real de sesión/RBAC, el loader de evidencia, la
 * atestación completa en `verify_custody_chain` y la migración. Ver
 * `docs/handoff/WMS-CUSTODY-IA-PRODUCTIZATION.md`.
 */

export * from "./types";
export * from "./validation";
export * from "./evidence";
export * from "./chain";
export * from "./provider";
export * from "./decision";
export * from "./release-policy";
export * from "./human-decision";
export * from "./certificate-policy";
export * from "./flags";
export * from "./ports";
export * from "./provider-registry";
export * from "./canonical";
export { caseBinding } from "./sealed";
export * from "./use-cases";

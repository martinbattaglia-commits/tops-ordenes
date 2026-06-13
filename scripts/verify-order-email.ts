/**
 * Verificación PURA del flujo de notificaciones de OS (Tarea B).
 * No toca DB ni red. Ejecutar: `npx tsx scripts/verify-order-email.ts`
 *
 * Cubre: plan de 4 destinatarios por rol, ruteo de depósito por sede,
 * deduplicación por tag, y contenido diferenciado por rol.
 */
import { orderEmailPlan, dedupeOrderEmails, renderRoleHtml } from "../src/lib/order-email";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${name}`);
  }
}

// Direcciones tal como las resuelve env.email (defaults actualizados al spec).
const ADDR = {
  depotMagaldi: "despachos-magaldi@logisticatops.com",
  depotLujan: "despachos-lujan@logisticatops.com",
  director: "joseluis@logisticatops.com",
  facturacion: "ruth@logisticatops.com",
};

const baseOrder: any = {
  public_id: "OS-201601",
  depot: "MAGALDI",
  date: "2026-06-13T10:00:00Z",
  total: 872000,
  h_start: "08:00",
  h_end: "12:00",
  client: { razon: "Bidcom S.A.", email: "logistica@bidcom.com.ar" },
  operator: { full_name: "Ruth Carrasquero" },
  services: [
    { label: "Balancín 1720 · CABA → CABA", qty: 1, unit: "viaje", rate: 436000, subtotal: 872000 },
  ],
};

console.log("\n[1] Plan de 4 destinatarios — sede MAGALDI con email de cliente");
const planM = orderEmailPlan(baseOrder, baseOrder.client.email, ADDR);
check("genera 4 destinatarios", planM.length === 4);
check("depósito → despachos-magaldi@", planM.find((p) => p.role === "deposito")?.to === ADDR.depotMagaldi);
check("director → joseluis@", planM.find((p) => p.role === "director")?.to === ADDR.director);
check("facturación → ruth@", planM.find((p) => p.role === "facturacion")?.to === ADDR.facturacion);
check("cliente → email de la ficha", planM.find((p) => p.role === "cliente")?.to === "logistica@bidcom.com.ar");
check("tags estables (depot/director/facturacion/cliente)",
  JSON.stringify(planM.map((p) => p.tag).sort()) === JSON.stringify(["cliente", "depot", "director", "facturacion"]));
check("subjects diferenciados por rol", new Set(planM.map((p) => p.subject)).size === 4);

console.log("\n[2] Ruteo de depósito por sede — LUJAN");
const planL = orderEmailPlan({ ...baseOrder, depot: "LUJAN" }, baseOrder.client.email, ADDR);
check("depósito → despachos-lujan@", planL.find((p) => p.role === "deposito")?.to === ADDR.depotLujan);

console.log("\n[3] Cliente sin email → solo 3 destinatarios internos");
const planNoClient = orderEmailPlan(baseOrder, "", ADDR);
check("3 destinatarios (sin cliente)", planNoClient.length === 3);
check("no incluye rol cliente", !planNoClient.some((p) => p.role === "cliente"));

console.log("\n[4] Deduplicación por tag (anti-duplicados)");
const alreadySent = new Set(["director", "depot"]);
const pending = dedupeOrderEmails(planM, alreadySent);
check("descarta los ya enviados (depot, director)", pending.length === 2);
check("quedan facturación y cliente", JSON.stringify(pending.map((p) => p.tag).sort()) === JSON.stringify(["cliente", "facturacion"]));
const pendingAll = dedupeOrderEmails(planM, new Set(["depot", "director", "facturacion", "cliente"]));
check("orden ya notificada por completo → 0 pendientes", pendingAll.length === 0);

console.log("\n[5] Contenido diferenciado por rol");
const htmlDepot = renderRoleHtml(baseOrder, "deposito", "https://x/OS-201601");
const htmlDirector = renderRoleHtml(baseOrder, "director", "https://x/OS-201601");
const htmlFact = renderRoleHtml(baseOrder, "facturacion", "https://x/OS-201601");
const htmlCliente = renderRoleHtml(baseOrder, "cliente", "https://x/OS-201601");
check("depósito menciona responsable operativo", /Responsable operativo/.test(htmlDepot));
check("director incluye 'Servicios contratados'", /Servicios contratados/.test(htmlDirector));
check("facturación incluye 'Importe estimado'", /Importe estimado/.test(htmlFact));
check("cliente NO expone servicios internos", !/Servicios contratados/.test(htmlCliente));
check("los 4 cuerpos son distintos", new Set([htmlDepot, htmlDirector, htmlFact, htmlCliente]).size === 4);
check("PDF link presente cuando hay pdfUrl", /Descargar comprobante/.test(renderRoleHtml(baseOrder, "cliente", "https://x", "https://pdf")));

console.log("\n[6] Envío urgente — banner en los emails (Tarea E)");
const htmlUrgent = renderRoleHtml(baseOrder, "deposito", "https://x", undefined, true);
const htmlNormal = renderRoleHtml(baseOrder, "deposito", "https://x", undefined, false);
check("urgente=true muestra banner 'ENVÍO URGENTE'", /ENVÍO URGENTE/.test(htmlUrgent) && /\+100%/.test(htmlUrgent));
check("urgente=false NO muestra banner", !/ENVÍO URGENTE/.test(htmlNormal));
check("el banner aparece en todos los roles", ["deposito","director","facturacion","cliente"].every(r => /ENVÍO URGENTE/.test(renderRoleHtml(baseOrder, r as any, "https://x", undefined, true))));

console.log(`\n──────────────────────────────\nRESULTADO: ${pass} PASS · ${fail} FAIL\n`);
if (fail > 0) process.exit(1);

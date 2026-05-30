#!/usr/bin/env node
/**
 * Bootstrap idempotente del entorno Supabase NEXUS.
 *
 * - Crea buckets faltantes (po-pdfs, po-signatures)
 * - Re-aplica seeds de RBAC (0009): 22 permisos + 7 roles + asignaciones
 * - Seedea vendors + products del catálogo demo (si las tablas están vacías)
 *
 * Idempotente: se puede correr cuantas veces se quiera, no duplica nada.
 *
 * Uso: node scripts/supabase-bootstrap.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env.local"), "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ============================================================
// 1. STORAGE BUCKETS
// ============================================================
console.log("\n🪣 Buckets de Storage");
const REQUIRED_BUCKETS = [
  { id: "po-pdfs", public: true, allowedMimeTypes: ["application/pdf"], fileSizeLimit: 5_242_880 },
  { id: "po-signatures", public: false, allowedMimeTypes: ["image/png"], fileSizeLimit: 524_288 },
];
const { data: existing = [] } = await supabase.storage.listBuckets();
const existingIds = new Set(existing?.map((b) => b.id) ?? []);
for (const b of REQUIRED_BUCKETS) {
  if (existingIds.has(b.id)) {
    console.log(`  ${b.public ? "🌍" : "🔒"} ${b.id} (existe)`);
    continue;
  }
  const { error } = await supabase.storage.createBucket(b.id, {
    public: b.public,
    allowedMimeTypes: b.allowedMimeTypes,
    fileSizeLimit: b.fileSizeLimit,
  });
  console.log(`  ${error ? "❌" : "✅"} ${b.id} ${error ? "— " + error.message : "creado"}`);
}

// ============================================================
// 2. RBAC SEEDS — permisos
// ============================================================
console.log("\n🔐 Permisos");
const PERMISSIONS = [
  ["cockpit.view", "cockpit", "view", "Ver cockpit ejecutivo", "Acceso al panel /ejecutivo"],
  ["cockpit.export", "cockpit", "export", "Exportar reportes ejecutivos", null],
  ["compras.view", "compras", "view", "Ver órdenes de compra", null],
  ["compras.create", "compras", "create", "Crear OC", null],
  ["compras.edit", "compras", "edit", "Editar OC en borrador", null],
  ["compras.sign", "compras", "sign", "Firmar OC", "Único permiso para emitir firma digital"],
  ["compras.export", "compras", "export", "Exportar CSV / PDF", null],
  ["compras.delete", "compras", "delete", "Anular OC", null],
  ["servicios.view", "servicios", "view", "Ver órdenes de servicio", null],
  ["servicios.create", "servicios", "create", "Crear OS", null],
  ["servicios.sign", "servicios", "sign", "Firmar OS", null],
  ["comercial.view", "comercial", "view", "Ver pipeline + contactos", null],
  ["comercial.edit", "comercial", "edit", "Editar contactos / deals", null],
  ["compliance.view", "compliance", "view", "Ver ANMAT cockpit", null],
  ["compliance.edit", "compliance", "edit", "Editar credenciales ANMAT", null],
  ["cctv.view", "cctv", "view", "Ver cámaras", null],
  ["cctv.admin", "cctv", "admin", "Administrar NVR", null],
  ["documental.view", "documental", "view", "Ver centro documental", null],
  ["documental.create", "documental", "create", "Subir documentos", null],
  ["documental.delete", "documental", "delete", "Borrar documentos", null],
  ["analytics.view", "analytics", "view", "Ver reportes & finanzas", null],
  ["sistema.admin", "sistema", "admin", "Administración del sistema", null],
];
const permsRows = PERMISSIONS.map(([slug, module, action, label, description]) => ({
  slug,
  module,
  action,
  label,
  description,
}));
const { error: permsErr, data: permsData } = await supabase
  .from("permissions")
  .upsert(permsRows, { onConflict: "slug" })
  .select("id, slug");
if (permsErr) {
  console.log(`  ❌ ${permsErr.message}`);
  process.exit(1);
}
console.log(`  ✅ ${permsData.length} permisos sincronizados`);
const permIdBySlug = Object.fromEntries(permsData.map((p) => [p.slug, p.id]));

// ============================================================
// 3. RBAC SEEDS — roles
// ============================================================
console.log("\n👥 Roles");
const ROLES = [
  ["director_ops", "Director de Operaciones", "Único habilitado a firmar OC. Acceso total operativo.", "#C90812"],
  ["admin", "Administración", "Equipo de administración financiera y compliance.", "#214576"],
  ["operaciones", "Operaciones", "Encargados de depósito, picking, recepción.", "#050555"],
  ["compliance", "Compliance / DT", "Director técnico, auditorías ANMAT, documental.", "#0E7C3A"],
  ["comercial", "Comercial", "Equipo CRM, ventas, pipeline Clientify.", "#B45309"],
  ["seguridad", "Seguridad / CCTV", "Monitoreo Verisure 24/7, eventos CCTV.", "#3a6db0"],
  ["cliente_b2b", "Cliente B2B", "Solo lectura de sus propias OS/OC (rol futuro F3).", "#8A94A6"],
];
const rolesRows = ROLES.map(([slug, name, description, color]) => ({
  slug,
  name,
  description,
  color,
  is_system: true,
}));
const { error: rolesErr, data: rolesData } = await supabase
  .from("roles")
  .upsert(rolesRows, { onConflict: "slug" })
  .select("id, slug");
if (rolesErr) {
  console.log(`  ❌ ${rolesErr.message}`);
  process.exit(1);
}
console.log(`  ✅ ${rolesData.length} roles sincronizados`);
const roleIdBySlug = Object.fromEntries(rolesData.map((r) => [r.slug, r.id]));

// ============================================================
// 4. RBAC SEEDS — role_permissions
// ============================================================
console.log("\n🔗 Role × Permission");
const ROLE_PERMS = {
  director_ops: PERMISSIONS.map(([slug]) => slug), // todos
  admin: PERMISSIONS.map(([slug]) => slug).filter((s) => s !== "compras.sign"),
  operaciones: [
    "cockpit.view",
    "compras.view",
    "compras.create",
    "servicios.view",
    "servicios.create",
    "servicios.sign",
    "cctv.view",
    "documental.view",
  ],
  compliance: [
    "cockpit.view",
    "compliance.view",
    "compliance.edit",
    "documental.view",
    "documental.create",
    "cctv.view",
  ],
  comercial: ["cockpit.view", "comercial.view", "comercial.edit"],
  seguridad: ["cockpit.view", "cctv.view", "cctv.admin"],
  cliente_b2b: ["servicios.view"],
};
const rpRows = [];
for (const [roleSlug, permSlugs] of Object.entries(ROLE_PERMS)) {
  for (const permSlug of permSlugs) {
    rpRows.push({
      role_id: roleIdBySlug[roleSlug],
      permission_id: permIdBySlug[permSlug],
    });
  }
}
const { error: rpErr, count } = await supabase
  .from("role_permissions")
  .upsert(rpRows, { onConflict: "role_id,permission_id" })
  .select("*", { count: "exact", head: true });
if (rpErr) {
  console.log(`  ❌ ${rpErr.message}`);
  process.exit(1);
}
console.log(`  ✅ ${rpRows.length} relaciones role × permission sincronizadas`);

// ============================================================
// 5. VENDORS SEED
// ============================================================
console.log("\n🏭 Vendors (proveedores)");
const VENDORS = [
  ["Pallets Sur S.R.L.", "30-71204562-3", "Carlos Pellegrini 2380, Avellaneda", "011 4204-7800", "Diego Vázquez", "ventas@palletssur.com.ar", "Insumos depósito", "30 días", ["Pallets", "Embalaje"]],
  ["Aceros Punta Lara S.A.", "30-50893420-1", "Av. Mitre 4200, Avellaneda", "011 4222-9100", "Ing. Luciano Bravo", "compras@acerospl.com.ar", "Estructura", "60 días", ["Racks", "Estructura"]],
  ["Combustibles AMBA S.A.", "30-70182334-9", "Av. Hipólito Yrigoyen 12380, Lanús", "011 4225-3400", "Marcelo Fernández", "cuentas@combustiblesamba.com", "Combustible", "15 días", ["Gasoil", "Nafta"]],
  ["Tecno Importadora SRL", "30-70888412-5", "Bernardo de Irigoyen 870, CABA", "011 5263-8800", "Sofía Romero", "comercial@tecnoimport.com.ar", "IT / Tecnología", "30 días", ["Cámaras", "Hardware"]],
  ["Higiene Industrial Galicia", "30-69453021-7", "Av. Caseros 3590, CABA", "011 4912-7700", "Cecilia Otero", "pedidos@hi-galicia.com", "ANMAT / Limpieza", "30 días", ["ANMAT", "Limpieza"]],
  ["Repuestos Hijos S.A.", "30-58729104-2", "Pavón 4520, CABA", "011 4922-3300", "José Manuel Pino", "admin@repuestoshijos.com.ar", "Repuestos", "45 días", ["Autoelevadores", "Repuestos"]],
  ["Etiquetas ANMAT Argentina", "30-71098234-0", "Bolívar 1860, CABA", "011 4304-1200", "Lic. Andrea Pellegrini", "ventas@etiquetasanmat.com", "ANMAT / Trazabilidad", "30 días", ["ANMAT", "Etiquetas"]],
  ["Servigas Industrial", "30-60187452-9", "Av. Vélez Sarsfield 980, CABA", "011 4301-5566", "Hernán Vacca", "industria@servigas.com.ar", "Servicios", "30 días", ["Gas", "Servicios"]],
  ["Distribuidora Norte Office", "30-71304582-1", "Av. Belgrano 1490, CABA", "011 4381-2200", "Patricia Lamela", "ventas@dnorteoffice.com", "Oficina", "30 días", ["Papelería", "Mobiliario"]],
  ["Seguridad Punto Sur", "30-65487125-3", "Av. San Juan 3920, CABA", "011 4308-4400", "Cap. Roberto Suárez", "admin@puntosur-sec.com", "Seguridad", "30 días", ["Vigilancia", "Alarmas"]],
];
const vendorRows = VENDORS.map(([razon, cuit, domicilio, telefono, contacto, email, categoria, cond_pago, tags]) => ({
  razon,
  cuit,
  domicilio,
  telefono,
  contacto,
  email,
  categoria,
  cond_pago,
  tags,
}));
const { error: vErr, data: vData } = await supabase
  .from("vendors")
  .upsert(vendorRows, { onConflict: "cuit" })
  .select("id, cuit, razon");
if (vErr) {
  console.log(`  ❌ ${vErr.message}`);
} else {
  console.log(`  ✅ ${vData.length} vendors sincronizados`);
}
const vendorIdByCuit = Object.fromEntries((vData ?? []).map((v) => [v.cuit, v.id]));

// ============================================================
// 6. PRODUCTS SEED
// ============================================================
console.log("\n📦 Products (catálogo)");
const PRODUCTS = [
  ["PAL-EUR-001", "Pallet europeo 1200x800 madera", "un", 12500, "30-71204562-3", "Insumos depósito"],
  ["PAL-AME-001", "Pallet americano 1200x1000 madera", "un", 14800, "30-71204562-3", "Insumos depósito"],
  ["FIL-STR-23", "Film stretch 23 micrones x 250 m", "rollo", 8900, "30-71204562-3", "Insumos depósito"],
  ["CIN-ADH-48", "Cinta adhesiva 48 mm x 100 m", "un", 1450, "30-71204562-3", "Insumos depósito"],
  ["COMB-GAS-PR", "Gasoil Premium · entrega en planta", "lt", 1280, "30-70182334-9", "Combustible"],
  ["COMB-NAF-SP", "Nafta súper · entrega en planta", "lt", 1410, "30-70182334-9", "Combustible"],
  ["CAM-IP-4K", "Cámara IP 4K Hikvision DS-2CD3T46G2", "un", 142000, "30-70888412-5", "IT / Tecnología"],
  ["NVR-32CH", "NVR 32 canales 4K Hikvision", "un", 488000, "30-70888412-5", "IT / Tecnología"],
  ["LIM-DEG-5L", "Desengrasante industrial bidón 5 L", "un", 7200, "30-69453021-7", "ANMAT / Limpieza"],
  ["LIM-DET-20", "Detergente neutro ANMAT 20 L", "un", 28500, "30-69453021-7", "ANMAT / Limpieza"],
  ["RP-AUT-HOR", "Horquilla autoelevador Toyota 8FG25", "un", 188000, "30-58729104-2", "Repuestos"],
  ["RP-AUT-BAT", "Batería tracción 48V 600Ah", "un", 1740000, "30-58729104-2", "Repuestos"],
  ["ETQ-RFID-50", "Etiqueta RFID ANMAT 50mm — rollo x 1000", "rollo", 28000, "30-71098234-0", "ANMAT / Trazabilidad"],
  ["ETQ-TERM-100", "Etiqueta térmica 100x150 — rollo x 500", "rollo", 6800, "30-71098234-0", "ANMAT / Trazabilidad"],
  ["GAS-CIL-45", "Cilindro gas industrial 45 kg", "un", 96000, "30-60187452-9", "Servicios"],
  ["OFF-RES-A4", "Resma papel A4 75gr · paquete", "un", 3850, "30-71304582-1", "Oficina"],
  ["OFF-TON-NEG", "Tóner HP 26X negro original", "un", 124000, "30-71304582-1", "Oficina"],
  ["RACK-SEL-3T", "Estantería selectiva 3 niveles 3T", "un", 425000, "30-50893420-1", "Estructura"],
  ["RACK-VIG", "Viga porta-pallet 2700 mm", "un", 18900, "30-50893420-1", "Estructura"],
  ["SEG-GUA-NOC", "Servicio vigilancia nocturna (8 hs)", "guardia", 78000, "30-65487125-3", "Seguridad"],
];
const productRows = PRODUCTS.map(([sku, label, unit, price, vendorCuit, categoria]) => ({
  sku,
  label,
  unit,
  price,
  vendor_id: vendorIdByCuit[vendorCuit] ?? null,
  categoria,
}));
const { error: pErr, data: pData } = await supabase
  .from("products")
  .upsert(productRows, { onConflict: "sku" })
  .select("id, sku");
if (pErr) {
  console.log(`  ❌ ${pErr.message}`);
} else {
  console.log(`  ✅ ${pData.length} products sincronizados`);
}

console.log("\n✨ Bootstrap completo\n");

import type {
  Vendor,
  Product,
  PurchaseOrder,
  POItem,
  POEvent,
  POEmailSend,
  PoStatus,
} from "@/lib/types-po";
import type { NotificationItem } from "@/lib/types";
import { PRODUCTS_CATALOG } from "./products-catalog";
import { ORG } from "@/lib/org";

/**
 * Datos mock del módulo Órdenes de Compra. Reproducen el seed del handoff
 * de diseño para que la app sea visualmente idéntica al prototipo cuando
 * Supabase no está configurado (`NEXT_PUBLIC_DEMO_MODE=1` o sin keys).
 */

export const MOCK_VENDORS: Vendor[] = [
  {
    id: "v01",
    razon: "Pallets Sur S.R.L.",
    cuit: "30-71204562-3",
    domicilio: "Carlos Pellegrini 2380, Avellaneda",
    telefono: "011 4204-7800",
    contacto: "Diego Vázquez",
    email: "ventas@palletssur.com.ar",
    categoria: "Insumos depósito",
    cond_pago: "30 días",
    tags: ["Pallets", "Embalaje"],
    avatar: "P",
    active: true,
    created_at: "2024-02-12T00:00:00Z",
    oc_count: 47,
    ytd_spend: 5_840_000,
    last_oc_at: "2026-05-18T00:00:00Z",
  },
  {
    id: "v02",
    razon: "Aceros Punta Lara S.A.",
    cuit: "30-50893420-1",
    domicilio: "Av. Mitre 4200, Avellaneda",
    telefono: "011 4222-9100",
    contacto: "Ing. Luciano Bravo",
    email: "compras@acerospl.com.ar",
    categoria: "Estructura",
    cond_pago: "60 días",
    tags: ["Racks", "Estructura"],
    avatar: "A",
    active: true,
    created_at: "2024-03-04T00:00:00Z",
    oc_count: 18,
    ytd_spend: 4_120_000,
    last_oc_at: "2026-05-22T00:00:00Z",
  },
  {
    id: "v03",
    razon: "Combustibles AMBA S.A.",
    cuit: "30-70182334-9",
    domicilio: "Av. Hipólito Yrigoyen 12380, Lanús",
    telefono: "011 4225-3400",
    contacto: "Marcelo Fernández",
    email: "cuentas@combustiblesamba.com",
    categoria: "Combustible",
    cond_pago: "15 días",
    tags: ["Gasoil", "Nafta"],
    avatar: "C",
    active: true,
    created_at: "2023-08-20T00:00:00Z",
    oc_count: 132,
    ytd_spend: 6_920_000,
    last_oc_at: "2026-05-24T00:00:00Z",
  },
  {
    id: "v04",
    razon: "Tecno Importadora SRL",
    cuit: "30-70888412-5",
    domicilio: "Bernardo de Irigoyen 870, CABA",
    telefono: "011 5263-8800",
    contacto: "Sofía Romero",
    email: "comercial@tecnoimport.com.ar",
    categoria: "IT / Tecnología",
    cond_pago: "30 días",
    tags: ["Cámaras", "Hardware"],
    avatar: "T",
    active: true,
    created_at: "2024-09-01T00:00:00Z",
    oc_count: 24,
    ytd_spend: 2_980_000,
    last_oc_at: "2026-05-15T00:00:00Z",
  },
  {
    id: "v05",
    razon: "Higiene Industrial Galicia",
    cuit: "30-69453021-7",
    domicilio: "Av. Caseros 3590, CABA",
    telefono: "011 4912-7700",
    contacto: "Cecilia Otero",
    email: "pedidos@hi-galicia.com",
    categoria: "ANMAT / Limpieza",
    cond_pago: "30 días",
    tags: ["ANMAT", "Limpieza"],
    avatar: "H",
    active: true,
    created_at: "2023-11-10T00:00:00Z",
    oc_count: 86,
    ytd_spend: 1_540_000,
    last_oc_at: "2026-05-19T00:00:00Z",
  },
  {
    id: "v06",
    razon: "Repuestos Hijos S.A.",
    cuit: "30-58729104-2",
    domicilio: "Pavón 4520, CABA",
    telefono: "011 4922-3300",
    contacto: "José Manuel Pino",
    email: "admin@repuestoshijos.com.ar",
    categoria: "Repuestos",
    cond_pago: "45 días",
    tags: ["Autoelevadores", "Repuestos"],
    avatar: "R",
    active: true,
    created_at: "2024-01-08T00:00:00Z",
    oc_count: 64,
    ytd_spend: 3_410_000,
    last_oc_at: "2026-05-21T00:00:00Z",
  },
  {
    id: "v07",
    razon: "Etiquetas ANMAT Argentina",
    cuit: "30-71098234-0",
    domicilio: "Bolívar 1860, CABA",
    telefono: "011 4304-1200",
    contacto: "Lic. Andrea Pellegrini",
    email: "ventas@etiquetasanmat.com",
    categoria: "ANMAT / Trazabilidad",
    cond_pago: "30 días",
    tags: ["ANMAT", "Etiquetas"],
    avatar: "E",
    active: true,
    created_at: "2025-02-14T00:00:00Z",
    oc_count: 38,
    ytd_spend: 980_000,
    last_oc_at: "2026-05-23T00:00:00Z",
  },
  {
    id: "v08",
    razon: "Servigas Industrial",
    cuit: "30-60187452-9",
    domicilio: "Av. Vélez Sarsfield 980, CABA",
    telefono: "011 4301-5566",
    contacto: "Hernán Vacca",
    email: "industria@servigas.com.ar",
    categoria: "Servicios",
    cond_pago: "30 días",
    tags: ["Gas", "Servicios"],
    avatar: "S",
    active: true,
    created_at: "2022-07-30T00:00:00Z",
    oc_count: 12,
    ytd_spend: 1_120_000,
    last_oc_at: "2026-05-17T00:00:00Z",
  },
  {
    id: "v09",
    razon: "Distribuidora Norte Office",
    cuit: "30-71304582-1",
    domicilio: "Av. Belgrano 1490, CABA",
    telefono: "011 4381-2200",
    contacto: "Patricia Lamela",
    email: "ventas@dnorteoffice.com",
    categoria: "Oficina",
    cond_pago: "30 días",
    tags: ["Papelería", "Mobiliario"],
    avatar: "D",
    active: true,
    created_at: "2024-06-18T00:00:00Z",
    oc_count: 29,
    ytd_spend: 612_000,
    last_oc_at: "2026-05-20T00:00:00Z",
  },
  {
    id: "v10",
    razon: "Seguridad Punto Sur",
    cuit: "30-65487125-3",
    domicilio: "Av. San Juan 3920, CABA",
    telefono: "011 4308-4400",
    contacto: "Cap. Roberto Suárez",
    email: "admin@puntosur-sec.com",
    categoria: "Seguridad",
    cond_pago: "30 días",
    tags: ["Vigilancia", "Alarmas"],
    avatar: "S",
    active: true,
    created_at: "2023-02-22T00:00:00Z",
    oc_count: 41,
    ytd_spend: 2_240_000,
    last_oc_at: "2026-05-16T00:00:00Z",
  },
];

export const MOCK_PRODUCTS: Product[] = PRODUCTS_CATALOG;

function pseudo(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const STATUSES_POOL: PoStatus[] = [
  "firmada",
  "firmada",
  "firmada",
  "enviada",
  "enviada",
  "pendiente",
  "borrador",
  "conciliada",
];

const DEPOTS_POOL = ["MAGALDI", "MAGALDI", "MAGALDI", "LUJAN"] as const;

function makeMockOrders(): PurchaseOrder[] {
  const out: PurchaseOrder[] = [];
  const rng = pseudo(127);
  const today = new Date("2026-05-25T11:30:00");
  for (let i = 0; i < 64; i++) {
    rng();
    const vendor = MOCK_VENDORS[Math.floor(rng() * MOCK_VENDORS.length)];
    const status = STATUSES_POOL[Math.floor(rng() * STATUSES_POOL.length)];
    const dateOff = Math.floor(rng() * 24);
    const d = new Date(today.getTime() - dateOff * 86400000 - rng() * 18000000);
    const items: POItem[] = [];
    const nItems = 1 + Math.floor(rng() * 4);
    for (let j = 0; j < nItems; j++) {
      const prod = MOCK_PRODUCTS[Math.floor(rng() * MOCK_PRODUCTS.length)];
      const qty = 1 + Math.floor(rng() * 24);
      items.push({
        sku: prod.sku,
        label: prod.label,
        unit: prod.unit,
        qty,
        price: prod.price,
        subtotal: qty * prod.price,
        pos: j,
      });
    }
    const neto = items.reduce((a, b) => a + b.subtotal, 0);
    const iva = Math.round(neto * 0.21);
    const total = neto + iva;
    const depot = DEPOTS_POOL[Math.floor(rng() * DEPOTS_POOL.length)];
    const shortId = 284 + 64 - i;
    const signed = (["firmada", "enviada", "conciliada"] as PoStatus[]).includes(status);
    out.push({
      id: `mock-po-${shortId}`,
      short_id: shortId,
      public_id: `OC-2026-${String(shortId).padStart(4, "0")}`,
      date: d.toISOString(),
      depot,
      destino: depot === "MAGALDI" ? "Depósito Magaldi · CABA" : "Depósito Luján · BsAs",
      entrega: "Inmediata",
      categoria: vendor.categoria,
      cond_pago: vendor.cond_pago,
      status,
      vendor_id: vendor.id,
      emisor_name: ORG.emitter.name,
      emisor_email: ORG.emitter.email,
      emisor_role: ORG.emitter.role,
      observ: "",
      neto,
      iva,
      total,
      signed_by: signed ? ORG.emitter.name : null,
      signed_at: signed ? new Date(d.getTime() + 12 * 60 * 1000).toISOString() : null,
      signature_url: null,
      signature_hash: signed ? "a7d3f29c4b1e8a92" : null,
      integrity_hash: "sha256-9f3a8c…",
      pdf_url: null,
      drive_folder:
        ORG.driveRoot +
        "/" +
        ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio"][d.getMonth()] +
        "/" +
        vendor.razon,
      drive_file_id: null,
      factura_id:
        status === "conciliada"
          ? "A-0003-" + String(80012 + i).padStart(8, "0")
          : null,
      supplier_invoice_id: null,
      recibido_por: status === "conciliada" ? "Carlos Méndez · Magaldi" : null,
      recibido_at:
        status === "conciliada"
          ? new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString()
          : null,
      created_at: d.toISOString(),
      created_by: null,
      vendor,
      items,
    });
  }
  const sorted = out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  // Featured live order
  const featured = sorted[0];
  if (featured) {
    featured.observ =
      "Entrega coordinada para martes 27 entre 08:00 y 11:00 hs en muelle 3. Pallets europeos de madera tratada (NIMF-15) según norma ANMAT. Requerimos remito de calidad.";
    featured.status = "enviada";
    featured.signed_by = ORG.emitter.name;
    featured.signed_at = "2026-05-25T11:14:00Z";
  }
  return sorted;
}

export const MOCK_PURCHASE_ORDERS: PurchaseOrder[] = makeMockOrders();

export function buildMockEvents(po: PurchaseOrder): POEvent[] {
  const events: POEvent[] = [
    {
      order_id: po.id,
      ts: po.created_at,
      kind: "created",
      actor: ORG.emitter.name,
      actor_email: ORG.emitter.email,
      ip: null,
      meta: { source: "wizard" },
    },
  ];
  if (po.signed_at) {
    events.push({
      order_id: po.id,
      ts: po.signed_at,
      kind: "signed",
      actor: po.signed_by,
      actor_email: ORG.emitter.email,
      ip: null,
      meta: { hash: po.signature_hash },
    });
    events.push({
      order_id: po.id,
      ts: po.signed_at,
      kind: "sent_email",
      actor: "system",
      actor_email: null,
      ip: null,
      meta: { to: [po.vendor?.email, ORG.admin.email, ORG.emitter.email] },
    });
    events.push({
      order_id: po.id,
      ts: po.signed_at,
      kind: "drive_synced",
      actor: "system",
      actor_email: null,
      ip: null,
      meta: { folder: po.drive_folder },
    });
  }
  if (po.recibido_at) {
    events.push({
      order_id: po.id,
      ts: po.recibido_at,
      kind: "received",
      actor: po.recibido_por,
      actor_email: null,
      ip: null,
      meta: { invoice: po.factura_id },
    });
  }
  return events;
}

export function buildMockEmails(po: PurchaseOrder): POEmailSend[] {
  if (!po.signed_at) return [];
  const ts = po.signed_at;
  const recipients = [
    { tag: "Proveedor", email: po.vendor?.email ?? "" },
    { tag: "Dirección", email: ORG.emitter.email },
    { tag: "Administración", email: ORG.admin.email },
  ];
  return recipients
    .filter((r) => r.email)
    .map((r, i) => ({
      order_id: po.id,
      to_email: r.email,
      tag: r.tag,
      status: "opened" as const,
      provider_id: `re_${po.short_id}_${i}`,
      error: null,
      sent_at: ts,
      opened_at: ts,
    }));
}

export const MOCK_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    kind: "signed",
    title: "OC-2026-0347 firmada",
    message: "José Luis Battaglia · Pallets Sur S.R.L.",
    created_at: "2026-05-25T11:14:00Z",
    read: false,
  },
  {
    id: "n2",
    kind: "new",
    title: "Email entregado a 3 destinatarios",
    message: "OC-2026-0347 → proveedor + admin + dirección",
    created_at: "2026-05-25T11:14:00Z",
    read: false,
  },
  {
    id: "n3",
    kind: "warn",
    title: "OC-2026-0339 sin factura",
    message: "Hace 14 días sin remito ni factura del proveedor",
    created_at: "2026-05-25T09:18:00Z",
    read: false,
  },
];

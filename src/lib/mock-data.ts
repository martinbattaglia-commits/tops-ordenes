import type { Client, NotificationItem, Operator, Order, OrderService } from "./types";
import { SERVICES_CATALOG } from "./services-catalog";

/**
 * Datos mock que alimentan la app en demo mode (sin Supabase configurado).
 * Coinciden con el handoff visual original.
 */

export const MOCK_CLIENTS: Client[] = [
  {
    id: "c01",
    razon: "Bidcom S.A.",
    cuit: "30-71044567-1",
    domicilio: "Av. Boyacá 280, CABA",
    telefono: "011 5263-9800",
    contacto: "Mariano Stella",
    email: "logistica@bidcom.com.ar",
    tags: ["IT", "Ecommerce"],
    created_at: "2024-01-15T10:00:00Z",
  },
  {
    id: "c02",
    razon: "Laboratorios Bagó",
    cuit: "30-50104871-2",
    domicilio: "Bernardo de Irigoyen 248, CABA",
    telefono: "011 4338-6300",
    contacto: "Dra. Inés Carrera",
    email: "compras@bago.com.ar",
    tags: ["ANMAT", "Farma"],
    created_at: "2024-01-15T10:00:00Z",
  },
  {
    id: "c03",
    razon: "Newsan Argentina",
    cuit: "30-50057391-2",
    domicilio: "Costa Rica 5639, CABA",
    telefono: "011 4842-5500",
    contacto: "Hernán Vilches",
    email: "logistica@newsan.com.ar",
    tags: ["IT", "Importación"],
    created_at: "2024-01-15T10:00:00Z",
  },
  {
    id: "c04",
    razon: "L'Oréal Argentina",
    cuit: "30-50000681-3",
    domicilio: "Av. del Libertador 6680, CABA",
    telefono: "011 4789-8000",
    contacto: "Florencia Méndez",
    email: "operaciones@loreal.com.ar",
    tags: ["ANMAT", "Cosmética"],
    created_at: "2024-01-15T10:00:00Z",
  },
  {
    id: "c05",
    razon: "Mercado Libre",
    cuit: "30-70308853-4",
    domicilio: "Arias 3751, CABA",
    telefono: "011 4640-8000",
    contacto: "Lucas Bonifaz",
    email: "logistica@meli.com",
    tags: ["Ecommerce", "IT"],
    created_at: "2024-01-15T10:00:00Z",
  },
  {
    id: "c06",
    razon: "Roemmers S.A.I.C.F.",
    cuit: "30-50095521-3",
    domicilio: "Fray Justo Sarmiento 2350, CABA",
    telefono: "011 4856-8333",
    contacto: "Andrea Romero",
    email: "logistica@roemmers.com.ar",
    tags: ["ANMAT", "Farma"],
    created_at: "2024-01-15T10:00:00Z",
  },
  {
    id: "c07",
    razon: "Garbarino S.A.",
    cuit: "30-54006559-2",
    domicilio: "Av. Corrientes 5680, CABA",
    telefono: "011 4860-7100",
    contacto: "Federico Astrada",
    email: "compras@garbarino.com",
    tags: ["Ecommerce"],
    created_at: "2024-01-15T10:00:00Z",
  },
];

export const MOCK_OPERATORS: Operator[] = [
  { id: "op1", full_name: "Carlos Méndez", role: "Jefe de depósito · Magaldi", avatar: "CM", depot: "MAGALDI" },
  { id: "op2", full_name: "Sergio Acuña", role: "Jefe de depósito · Luján", avatar: "SA", depot: "LUJAN" },
  { id: "op3", full_name: "Javier Domínguez", role: "Supervisor", avatar: "JD", depot: null },
  { id: "op4", full_name: "Maximiliano Rojas", role: "Maquinista", avatar: "MR", depot: "MAGALDI" },
];

function pseudo(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function makeMockOrders(): Order[] {
  const out: Order[] = [];
  const rng = pseudo(42);
  const today = new Date("2026-05-25T11:30:00");
  const statuses = ["FIRMADA", "FIRMADA", "FIRMADA", "FIRMADA", "PENDIENTE_FIRMA", "EN_CURSO", "OBSERVADA"] as const;
  const depots = ["MAGALDI", "MAGALDI", "LUJAN"] as const;

  for (let i = 0; i < 48; i++) {
    rng();
    const cl = MOCK_CLIENTS[Math.floor(rng() * MOCK_CLIENTS.length)];
    const depot = cl.tags.includes("ANMAT") ? "MAGALDI" : depots[Math.floor(rng() * depots.length)];
    const status = statuses[Math.floor(rng() * statuses.length)];
    const services: OrderService[] = [];
    const nSvc = 1 + Math.floor(rng() * 2);
    for (let j = 0; j < nSvc; j++) {
      const s = SERVICES_CATALOG[Math.floor(rng() * SERVICES_CATALOG.length)];
      const qty = s.unit === "mes" ? 1 : 1 + Math.floor(rng() * 8);
      services.push({
        service_slug: s.slug,
        label: s.label,
        qty,
        unit: s.unit,
        rate: s.rate,
        subtotal: qty * s.rate,
      });
    }
    const dateOff = Math.floor(rng() * 18);
    const d = new Date(today.getTime() - dateOff * 86400000 - rng() * 18000000);
    const hStart = 7 + Math.floor(rng() * 9);
    const dur = 1 + Math.floor(rng() * 6);
    const total = services.reduce((a, b) => a + b.subtotal, 0);
    const op = MOCK_OPERATORS[Math.floor(rng() * MOCK_OPERATORS.length)];
    const shortId = 201518 + 48 - i;

    out.push({
      id: `mock-${shortId}`,
      public_id: `OS-${String(shortId).padStart(6, "0")}`,
      short_id: shortId,
      date: d.toISOString(),
      depot,
      status,
      client_id: cl.id,
      operator_id: op.id,
      h_start: `${String(hStart).padStart(2, "0")}:00`,
      h_end: `${String(hStart + dur).padStart(2, "0")}:00`,
      hours: dur,
      pallets: services[0].unit === "pal" ? services[0].qty : Math.floor(rng() * 24),
      units: Math.floor(rng() * 320),
      km: services.some((s) => s.service_slug === "transporte" || s.service_slug === "semi") ? Math.floor(20 + rng() * 80) : 0,
      observ: i === 0 ? "Carga consolidada con remito 0001-00284571. Cliente espera entrega ANMAT con cadena de frío 2-8 °C." : "",
      total,
      signed_by: status === "FIRMADA" ? cl.contacto : null,
      signed_doc: null,
      signed_at: status === "FIRMADA" ? d.toISOString() : null,
      signature_url: null,
      signature_hash: status === "FIRMADA" ? "a7d3f29c4b1e8a92" : null,
      pdf_url: null,
      geo_lat: status === "FIRMADA" ? -34.6168 : null,
      geo_lng: status === "FIRMADA" ? -58.4582 : null,
      ip: status === "FIRMADA" ? "190.55.214.12" : null,
      created_at: d.toISOString(),
      created_by: null,
      client: cl,
      operator: op,
      services,
    });
  }
  return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export const MOCK_ORDERS = makeMockOrders();

export const MOCK_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    kind: "signed",
    title: "Orden OS-201566 firmada",
    message: "Mariano Stella · Bidcom S.A.",
    created_at: "2026-05-25T11:14:00Z",
    read: false,
  },
  {
    id: "n2",
    kind: "new",
    title: "Nueva orden creada",
    message: "OS-201565 · Laboratorios Bagó · Magaldi",
    created_at: "2026-05-25T10:42:00Z",
    read: false,
  },
  {
    id: "n3",
    kind: "observed",
    title: "Orden observada",
    message: "OS-201562 — diferencia en cantidad de pallets",
    created_at: "2026-05-25T09:18:00Z",
    read: false,
  },
];

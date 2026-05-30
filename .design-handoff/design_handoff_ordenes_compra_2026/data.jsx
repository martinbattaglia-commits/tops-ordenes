// data.jsx — Mock data + shared helpers for TOPS Órdenes de Compra prototype.

const PROVEEDORES = [
  { id: 'p01', razon: 'Pallets Sur S.R.L.', cuit: '30-71204562-3', domicilio: 'Carlos Pellegrini 2380, Avellaneda', telefono: '011 4204-7800', contacto: 'Diego Vázquez', email: 'ventas@palletssur.com.ar', categoria: 'Insumos depósito', tags: ['Pallets', 'Embalaje'], lastOrder: '2026-05-18', orders: 47, avatar: 'P', cond: '30 días' },
  { id: 'p02', razon: 'Aceros Punta Lara S.A.', cuit: '30-50893420-1', domicilio: 'Av. Mitre 4200, Avellaneda', telefono: '011 4222-9100', contacto: 'Ing. Luciano Bravo', email: 'compras@acerospl.com.ar', categoria: 'Estructura', tags: ['Racks', 'Estructura'], lastOrder: '2026-05-22', orders: 18, avatar: 'A', cond: '60 días' },
  { id: 'p03', razon: 'Combustibles AMBA S.A.', cuit: '30-70182334-9', domicilio: 'Av. Hipólito Yrigoyen 12380, Lanús', telefono: '011 4225-3400', contacto: 'Marcelo Fernández', email: 'cuentas@combustiblesamba.com', categoria: 'Combustible', tags: ['Gasoil', 'Nafta'], lastOrder: '2026-05-24', orders: 132, avatar: 'C', cond: '15 días' },
  { id: 'p04', razon: 'Tecno Importadora SRL', cuit: '30-70888412-5', domicilio: 'Bernardo de Irigoyen 870, CABA', telefono: '011 5263-8800', contacto: 'Sofía Romero', email: 'comercial@tecnoimport.com.ar', categoria: 'IT / Tecnología', tags: ['Cámaras', 'Hardware'], lastOrder: '2026-05-15', orders: 24, avatar: 'T', cond: '30 días' },
  { id: 'p05', razon: 'Higiene Industrial Galicia', cuit: '30-69453021-7', domicilio: 'Av. Caseros 3590, CABA', telefono: '011 4912-7700', contacto: 'Cecilia Otero', email: 'pedidos@hi-galicia.com', categoria: 'ANMAT / Limpieza', tags: ['ANMAT', 'Limpieza'], lastOrder: '2026-05-19', orders: 86, avatar: 'H', cond: '30 días' },
  { id: 'p06', razon: 'Repuestos Hijos S.A.', cuit: '30-58729104-2', domicilio: 'Pavón 4520, CABA', telefono: '011 4922-3300', contacto: 'José Manuel Pino', email: 'admin@repuestoshijos.com.ar', categoria: 'Repuestos', tags: ['Autoelevadores', 'Repuestos'], lastOrder: '2026-05-21', orders: 64, avatar: 'R', cond: '45 días' },
  { id: 'p07', razon: 'Etiquetas ANMAT Argentina', cuit: '30-71098234-0', domicilio: 'Bolívar 1860, CABA', telefono: '011 4304-1200', contacto: 'Lic. Andrea Pellegrini', email: 'ventas@etiquetasanmat.com', categoria: 'ANMAT / Trazabilidad', tags: ['ANMAT', 'Etiquetas'], lastOrder: '2026-05-23', orders: 38, avatar: 'E', cond: '30 días' },
  { id: 'p08', razon: 'Servigas Industrial', cuit: '30-60187452-9', domicilio: 'Av. Vélez Sarsfield 980, CABA', telefono: '011 4301-5566', contacto: 'Hernán Vacca', email: 'industria@servigas.com.ar', categoria: 'Servicios', tags: ['Gas', 'Servicios'], lastOrder: '2026-05-17', orders: 12, avatar: 'S', cond: '30 días' },
  { id: 'p09', razon: 'Distribuidora Norte Office', cuit: '30-71304582-1', domicilio: 'Av. Belgrano 1490, CABA', telefono: '011 4381-2200', contacto: 'Patricia Lamela', email: 'ventas@dnorteoffice.com', categoria: 'Oficina', tags: ['Papelería', 'Mobiliario'], lastOrder: '2026-05-20', orders: 29, avatar: 'D', cond: '30 días' },
  { id: 'p10', razon: 'Seguridad Punto Sur', cuit: '30-65487125-3', domicilio: 'Av. San Juan 3920, CABA', telefono: '011 4308-4400', contacto: 'Cap. Roberto Suárez', email: 'admin@puntosur-sec.com', categoria: 'Seguridad', tags: ['Vigilancia', 'Alarmas'], lastOrder: '2026-05-16', orders: 41, avatar: 'S', cond: '30 días' },
];

// Catálogo de productos típicos (para autocompletar líneas)
const PRODUCTOS = [
  { sku: 'PAL-EUR-001', label: 'Pallet europeo 1200x800 madera', unit: 'un', price: 12500, vendor: 'p01' },
  { sku: 'PAL-AME-001', label: 'Pallet americano 1200x1000 madera', unit: 'un', price: 14800, vendor: 'p01' },
  { sku: 'FIL-STR-23', label: 'Film stretch 23 micrones x 250 m', unit: 'rollo', price: 8900, vendor: 'p01' },
  { sku: 'CIN-ADH-48', label: 'Cinta adhesiva 48 mm x 100 m', unit: 'un', price: 1450, vendor: 'p01' },
  { sku: 'COMB-GAS-PR', label: 'Gasoil Premium · entrega en planta', unit: 'lt', price: 1280, vendor: 'p03' },
  { sku: 'COMB-NAF-SP', label: 'Nafta súper · entrega en planta', unit: 'lt', price: 1410, vendor: 'p03' },
  { sku: 'CAM-IP-4K', label: 'Cámara IP 4K Hikvision DS-2CD3T46G2', unit: 'un', price: 142000, vendor: 'p04' },
  { sku: 'NVR-32CH', label: 'NVR 32 canales 4K Hikvision', unit: 'un', price: 488000, vendor: 'p04' },
  { sku: 'LIM-DEG-5L', label: 'Desengrasante industrial bidón 5 L', unit: 'un', price: 7200, vendor: 'p05' },
  { sku: 'LIM-DET-20', label: 'Detergente neutro ANMAT 20 L', unit: 'un', price: 28500, vendor: 'p05' },
  { sku: 'RP-AUT-HOR', label: 'Horquilla autoelevador Toyota 8FG25', unit: 'un', price: 188000, vendor: 'p06' },
  { sku: 'RP-AUT-BAT', label: 'Batería tracción 48V 600Ah', unit: 'un', price: 1740000, vendor: 'p06' },
  { sku: 'ETQ-RFID-50', label: 'Etiqueta RFID ANMAT 50mm — rollo x 1000', unit: 'rollo', price: 28000, vendor: 'p07' },
  { sku: 'ETQ-TERM-100', label: 'Etiqueta térmica 100x150 — rollo x 500', unit: 'rollo', price: 6800, vendor: 'p07' },
  { sku: 'GAS-CIL-45', label: 'Cilindro gas industrial 45 kg', unit: 'un', price: 96000, vendor: 'p08' },
  { sku: 'OFF-RES-A4', label: 'Resma papel A4 75gr · paquete', unit: 'un', price: 3850, vendor: 'p09' },
  { sku: 'OFF-TON-NEG', label: 'Tóner HP 26X negro original', unit: 'un', price: 124000, vendor: 'p09' },
  { sku: 'RACK-SEL-3T', label: 'Estantería selectiva 3 niveles 3T', unit: 'un', price: 425000, vendor: 'p02' },
  { sku: 'RACK-VIG', label: 'Viga porta-pallet 2700 mm', unit: 'un', price: 18900, vendor: 'p02' },
];

const APROBADORES = [
  { id: 'jl', name: 'José Luis Battaglia', role: 'Director de Operaciones', avatar: 'JL', email: 'joseluis@logisticatops.com' },
];

const ADMINISTRACION = [
  { id: 'rc', name: 'Ruth Cardozo', role: 'Administración · Verotin S.A.', avatar: 'RC', email: 'ruth@logisticatops.com' },
];

const DEPOTS = ['Magaldi', 'Magaldi', 'Magaldi', 'Luján'];
const COND_PAGO = ['30 días', '60 días', '90 días', 'Contado', 'Anticipado'];

const STATUSES = ['firmada', 'firmada', 'firmada', 'enviada', 'enviada', 'pendiente', 'borrador', 'conciliada'];

function pseudo(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function makeOrders() {
  const out = [];
  const rng = pseudo(127);
  const today = new Date('2026-05-25T11:30:00');
  for (let i = 0; i < 64; i++) {
    const r = rng();
    const p = PROVEEDORES[Math.floor(rng() * PROVEEDORES.length)];
    const status = STATUSES[Math.floor(rng() * STATUSES.length)];
    const dateOff = Math.floor(rng() * 24);
    const d = new Date(today.getTime() - dateOff * 86400000 - rng() * 18000000);
    // pick 1-4 items from products
    const items = [];
    const nItems = 1 + Math.floor(rng() * 4);
    for (let j = 0; j < nItems; j++) {
      const prod = PRODUCTOS[Math.floor(rng() * PRODUCTOS.length)];
      const qty = 1 + Math.floor(rng() * 24);
      items.push({
        sku: prod.sku, label: prod.label, unit: prod.unit,
        qty, price: prod.price, total: qty * prod.price,
        desc: '',
      });
    }
    const neto = items.reduce((a, b) => a + b.total, 0);
    const iva = Math.round(neto * 0.21);
    const total = neto + iva;
    const depot = DEPOTS[Math.floor(rng() * DEPOTS.length)];
    out.push({
      id: 'OC-2026-' + String(284 + 64 - i).padStart(4, '0'),
      shortId: 284 + 64 - i,
      date: d,
      providerId: p.id,
      proveedor: p.razon,
      cuit: p.cuit,
      condPago: p.cond,
      categoria: p.categoria,
      depot,
      destino: depot === 'Magaldi' ? 'Depósito Magaldi · CABA' : 'Depósito Luján · BsAs',
      entrega: 'Inmediata',
      emisor: APROBADORES[0],
      items, neto, iva, total,
      status,
      observ: '',
      signedBy: ['firmada','enviada','conciliada'].includes(status) ? APROBADORES[0].name : null,
      signedAt: ['firmada','enviada','conciliada'].includes(status) ? new Date(d.getTime() + 1000 * 60 * 12) : null,
      recibido: status === 'conciliada' ? 'Carlos Méndez · Magaldi' : null,
      facturaId: status === 'conciliada' ? 'A-0003-' + String(80012 + i).padStart(8, '0') : null,
      driveFolder: 'Órdenes de Compra 2026/' + ['Enero','Febrero','Marzo','Abril','Mayo'][d.getMonth()] + '/' + p.razon,
    });
  }
  return out.sort((a, b) => b.date - a.date);
}

const ORDERS = makeOrders();

// Featured "live" order for detail view (latest, made interesting)
ORDERS[0].observ = 'Entrega coordinada para martes 27 entre 08:00 y 11:00 hs en muelle 3. Pallets europeos de madera tratada (NIMF-15) según norma ANMAT. Requerimos remito de calidad.';
ORDERS[0].status = 'enviada';
ORDERS[0].signedBy = APROBADORES[0].name;
ORDERS[0].signedAt = new Date('2026-05-25T11:14:00');

// ----- helpers -----
const fmtCurrency = (n) => '$ ' + Math.round(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const fmtCurrencyShort = (n) => {
  if (n >= 1e6) return '$ ' + (n / 1e6).toFixed(1).replace('.', ',') + ' M';
  if (n >= 1e3) return '$ ' + (n / 1e3).toFixed(0) + ' K';
  return '$ ' + Math.round(n);
};
const fmtDate = (d) => {
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
};
const fmtDateTime = (d) => {
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} · ${hh}:${mi}`;
};
const relTime = (d) => {
  const now = new Date('2026-05-25T11:30:00');
  const diff = (now - d) / 1000;
  if (diff < 60) return 'hace seg.';
  if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + ' min';
  if (diff < 86400) return 'hace ' + Math.floor(diff / 3600) + ' h';
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} d.`;
  return fmtDate(d);
};

const STATUS_META = {
  borrador:    { label: 'Borrador',     cls: 'badge-muted' },
  pendiente:   { label: 'Pendiente',    cls: 'badge-warning' },
  firmada:     { label: 'Firmada',      cls: 'badge-success' },
  enviada:     { label: 'Enviada',      cls: 'badge-info' },
  conciliada:  { label: 'Conciliada',   cls: 'badge-success' },
  anulada:     { label: 'Anulada',      cls: 'badge-danger' },
};

// Sample notifications
const NOTIFS_INITIAL = [
  { id: 1, kind: 'signed',  title: 'OC-2026-0347 firmada', msg: 'José Luis Battaglia · Pallets Sur S.R.L.', time: relTime(new Date('2026-05-25T11:14:00')) },
  { id: 2, kind: 'new',     title: 'Email entregado a 3 destinatarios', msg: 'OC-2026-0347 → proveedor + admin + dirección', time: relTime(new Date('2026-05-25T11:14:00')) },
  { id: 3, kind: 'warn',    title: 'OC-2026-0339 sin factura', msg: 'Hace 14 días sin remito ni factura del proveedor', time: relTime(new Date('2026-05-25T09:18:00')) },
];

Object.assign(window, {
  PROVEEDORES, PRODUCTOS, APROBADORES, ADMINISTRACION, COND_PAGO, ORDERS,
  fmtCurrency, fmtCurrencyShort, fmtDate, fmtDateTime, relTime,
  STATUS_META, NOTIFS_INITIAL,
});

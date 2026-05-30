-- =========================================================================
-- TOPS NEXUS — Seed RBAC + Vendors + Products + Schema reload
-- =========================================================================
-- Ejecutar este archivo ENTERO desde el SQL Editor de Supabase Dashboard.
-- Idempotente: se puede correr cuantas veces se quiera, no duplica nada.
--
-- https://app.supabase.com/project/arsksytgdnzukbmfgkju/sql/new
-- =========================================================================

-- ============================================================
-- 1. Permisos (22 rows)
-- ============================================================
insert into public.permissions (slug, module, action, label, description) values
  ('cockpit.view',          'cockpit',    'view',   'Ver cockpit ejecutivo',         'Acceso al panel /ejecutivo'),
  ('cockpit.export',        'cockpit',    'export', 'Exportar reportes ejecutivos',  null),
  ('compras.view',          'compras',    'view',   'Ver órdenes de compra',         null),
  ('compras.create',        'compras',    'create', 'Crear OC',                      null),
  ('compras.edit',          'compras',    'edit',   'Editar OC en borrador',         null),
  ('compras.sign',          'compras',    'sign',   'Firmar OC',                     'Único permiso para emitir firma digital'),
  ('compras.export',        'compras',    'export', 'Exportar CSV / PDF',            null),
  ('compras.delete',        'compras',    'delete', 'Anular OC',                     null),
  ('servicios.view',        'servicios',  'view',   'Ver órdenes de servicio',       null),
  ('servicios.create',      'servicios',  'create', 'Crear OS',                      null),
  ('servicios.sign',        'servicios',  'sign',   'Firmar OS',                     null),
  ('comercial.view',        'comercial',  'view',   'Ver pipeline + contactos',      null),
  ('comercial.edit',        'comercial',  'edit',   'Editar contactos / deals',      null),
  ('compliance.view',       'compliance', 'view',   'Ver ANMAT cockpit',             null),
  ('compliance.edit',       'compliance', 'edit',   'Editar credenciales ANMAT',     null),
  ('cctv.view',             'cctv',       'view',   'Ver cámaras',                   null),
  ('cctv.admin',            'cctv',       'admin',  'Administrar NVR',               null),
  ('documental.view',       'documental', 'view',   'Ver centro documental',         null),
  ('documental.create',     'documental', 'create', 'Subir documentos',              null),
  ('documental.delete',     'documental', 'delete', 'Borrar documentos',             null),
  ('analytics.view',        'analytics',  'view',   'Ver reportes & finanzas',       null),
  ('sistema.admin',         'sistema',    'admin',  'Administración del sistema',    null)
on conflict (slug) do nothing;

-- ============================================================
-- 2. Roles (7 rows del sistema)
-- ============================================================
insert into public.roles (slug, name, description, color, is_system) values
  ('director_ops',  'Director de Operaciones', 'Único habilitado a firmar OC. Acceso total operativo.', '#C90812', true),
  ('admin',         'Administración',          'Equipo de administración financiera y compliance.',     '#214576', true),
  ('operaciones',   'Operaciones',             'Encargados de depósito, picking, recepción.',           '#050555', true),
  ('compliance',    'Compliance / DT',         'Director técnico, auditorías ANMAT, documental.',       '#0E7C3A', true),
  ('comercial',     'Comercial',               'Equipo CRM, ventas, pipeline Clientify.',               '#B45309', true),
  ('seguridad',     'Seguridad / CCTV',        'Monitoreo Verisure 24/7, eventos CCTV.',                '#3a6db0', true),
  ('cliente_b2b',   'Cliente B2B',             'Solo lectura de sus propias OS/OC (rol futuro F3).',    '#8A94A6', true)
on conflict (slug) do nothing;

-- ============================================================
-- 3. Role × Permission mapping
-- ============================================================
-- Director de Operaciones: TODO
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'director_ops'
on conflict do nothing;

-- Admin: todo menos firmar OC
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'admin' and p.slug not in ('compras.sign')
on conflict do nothing;

-- Operaciones
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'operaciones' and p.slug in (
    'cockpit.view', 'compras.view', 'compras.create',
    'servicios.view', 'servicios.create', 'servicios.sign',
    'cctv.view', 'documental.view'
  )
on conflict do nothing;

-- Compliance / DT
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'compliance' and p.slug in (
    'cockpit.view', 'compliance.view', 'compliance.edit',
    'documental.view', 'documental.create', 'cctv.view'
  )
on conflict do nothing;

-- Comercial
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'comercial' and p.slug in (
    'cockpit.view', 'comercial.view', 'comercial.edit'
  )
on conflict do nothing;

-- Seguridad
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'seguridad' and p.slug in (
    'cockpit.view', 'cctv.view', 'cctv.admin'
  )
on conflict do nothing;

-- Cliente B2B
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.slug = 'cliente_b2b' and p.slug = 'servicios.view'
on conflict do nothing;

-- ============================================================
-- 4. Vendors (10 proveedores reales)
-- ============================================================
insert into public.vendors (razon, cuit, domicilio, telefono, contacto, email, categoria, cond_pago, tags) values
  ('Pallets Sur S.R.L.', '30-71204562-3', 'Carlos Pellegrini 2380, Avellaneda', '011 4204-7800', 'Diego Vázquez', 'ventas@palletssur.com.ar', 'Insumos depósito', '30 días', ARRAY['Pallets','Embalaje']),
  ('Aceros Punta Lara S.A.', '30-50893420-1', 'Av. Mitre 4200, Avellaneda', '011 4222-9100', 'Ing. Luciano Bravo', 'compras@acerospl.com.ar', 'Estructura', '60 días', ARRAY['Racks','Estructura']),
  ('Combustibles AMBA S.A.', '30-70182334-9', 'Av. Hipólito Yrigoyen 12380, Lanús', '011 4225-3400', 'Marcelo Fernández', 'cuentas@combustiblesamba.com', 'Combustible', '15 días', ARRAY['Gasoil','Nafta']),
  ('Tecno Importadora SRL', '30-70888412-5', 'Bernardo de Irigoyen 870, CABA', '011 5263-8800', 'Sofía Romero', 'comercial@tecnoimport.com.ar', 'IT / Tecnología', '30 días', ARRAY['Cámaras','Hardware']),
  ('Higiene Industrial Galicia', '30-69453021-7', 'Av. Caseros 3590, CABA', '011 4912-7700', 'Cecilia Otero', 'pedidos@hi-galicia.com', 'ANMAT / Limpieza', '30 días', ARRAY['ANMAT','Limpieza']),
  ('Repuestos Hijos S.A.', '30-58729104-2', 'Pavón 4520, CABA', '011 4922-3300', 'José Manuel Pino', 'admin@repuestoshijos.com.ar', 'Repuestos', '45 días', ARRAY['Autoelevadores','Repuestos']),
  ('Etiquetas ANMAT Argentina', '30-71098234-0', 'Bolívar 1860, CABA', '011 4304-1200', 'Lic. Andrea Pellegrini', 'ventas@etiquetasanmat.com', 'ANMAT / Trazabilidad', '30 días', ARRAY['ANMAT','Etiquetas']),
  ('Servigas Industrial', '30-60187452-9', 'Av. Vélez Sarsfield 980, CABA', '011 4301-5566', 'Hernán Vacca', 'industria@servigas.com.ar', 'Servicios', '30 días', ARRAY['Gas','Servicios']),
  ('Distribuidora Norte Office', '30-71304582-1', 'Av. Belgrano 1490, CABA', '011 4381-2200', 'Patricia Lamela', 'ventas@dnorteoffice.com', 'Oficina', '30 días', ARRAY['Papelería','Mobiliario']),
  ('Seguridad Punto Sur', '30-65487125-3', 'Av. San Juan 3920, CABA', '011 4308-4400', 'Cap. Roberto Suárez', 'admin@puntosur-sec.com', 'Seguridad', '30 días', ARRAY['Vigilancia','Alarmas'])
on conflict (cuit) do nothing;

-- ============================================================
-- 5. Products (catálogo seed)
-- ============================================================
insert into public.products (sku, label, unit, price, vendor_id, categoria)
select
  v.sku, v.label, v.unit, v.price,
  (select id from public.vendors where cuit = v.vendor_cuit limit 1),
  v.categoria
from (values
  ('PAL-EUR-001', 'Pallet europeo 1200x800 madera', 'un', 12500::numeric, '30-71204562-3', 'Insumos depósito'),
  ('PAL-AME-001', 'Pallet americano 1200x1000 madera', 'un', 14800::numeric, '30-71204562-3', 'Insumos depósito'),
  ('FIL-STR-23', 'Film stretch 23 micrones x 250 m', 'rollo', 8900::numeric, '30-71204562-3', 'Insumos depósito'),
  ('CIN-ADH-48', 'Cinta adhesiva 48 mm x 100 m', 'un', 1450::numeric, '30-71204562-3', 'Insumos depósito'),
  ('COMB-GAS-PR', 'Gasoil Premium · entrega en planta', 'lt', 1280::numeric, '30-70182334-9', 'Combustible'),
  ('COMB-NAF-SP', 'Nafta súper · entrega en planta', 'lt', 1410::numeric, '30-70182334-9', 'Combustible'),
  ('CAM-IP-4K', 'Cámara IP 4K Hikvision DS-2CD3T46G2', 'un', 142000::numeric, '30-70888412-5', 'IT / Tecnología'),
  ('NVR-32CH', 'NVR 32 canales 4K Hikvision', 'un', 488000::numeric, '30-70888412-5', 'IT / Tecnología'),
  ('LIM-DEG-5L', 'Desengrasante industrial bidón 5 L', 'un', 7200::numeric, '30-69453021-7', 'ANMAT / Limpieza'),
  ('LIM-DET-20', 'Detergente neutro ANMAT 20 L', 'un', 28500::numeric, '30-69453021-7', 'ANMAT / Limpieza'),
  ('RP-AUT-HOR', 'Horquilla autoelevador Toyota 8FG25', 'un', 188000::numeric, '30-58729104-2', 'Repuestos'),
  ('RP-AUT-BAT', 'Batería tracción 48V 600Ah', 'un', 1740000::numeric, '30-58729104-2', 'Repuestos'),
  ('ETQ-RFID-50', 'Etiqueta RFID ANMAT 50mm — rollo x 1000', 'rollo', 28000::numeric, '30-71098234-0', 'ANMAT / Trazabilidad'),
  ('ETQ-TERM-100', 'Etiqueta térmica 100x150 — rollo x 500', 'rollo', 6800::numeric, '30-71098234-0', 'ANMAT / Trazabilidad'),
  ('GAS-CIL-45', 'Cilindro gas industrial 45 kg', 'un', 96000::numeric, '30-60187452-9', 'Servicios'),
  ('OFF-RES-A4', 'Resma papel A4 75gr · paquete', 'un', 3850::numeric, '30-71304582-1', 'Oficina'),
  ('OFF-TON-NEG', 'Tóner HP 26X negro original', 'un', 124000::numeric, '30-71304582-1', 'Oficina'),
  ('RACK-SEL-3T', 'Estantería selectiva 3 niveles 3T', 'un', 425000::numeric, '30-50893420-1', 'Estructura'),
  ('RACK-VIG', 'Viga porta-pallet 2700 mm', 'un', 18900::numeric, '30-50893420-1', 'Estructura'),
  ('SEG-GUA-NOC', 'Servicio vigilancia nocturna (8 hs)', 'guardia', 78000::numeric, '30-65487125-3', 'Seguridad')
) as v(sku, label, unit, price, vendor_cuit, categoria)
on conflict (sku) do nothing;

-- ============================================================
-- 6. Schema reload — fuerza a PostgREST a re-leer el catálogo
-- ============================================================
notify pgrst, 'reload schema';

-- ============================================================
-- 7. Verificación final
-- ============================================================
select 'permissions' as tabla, count(*) as filas from public.permissions
union all
select 'roles', count(*) from public.roles
union all
select 'role_permissions', count(*) from public.role_permissions
union all
select 'vendors', count(*) from public.vendors
union all
select 'products', count(*) from public.products;

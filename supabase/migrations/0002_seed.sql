-- =========================================================================
-- Seed inicial — catálogo de servicios y operadores
-- Idempotente: usa upsert por slug / nombre.
-- =========================================================================

insert into public.services_catalog (slug, label, unit, rate) values
  ('autoelevador',           'Autoelevador con uñas',    'hs', 12500),
  ('transporte',             'Transporte AMBA',          'km',   850),
  ('semi',                   'Semi (camión grande)',     'hs', 18200),
  ('chasis',                 'Chasis',                   'hs', 14600),
  ('peon',                   'Peón por hora',            'hs',  6800),
  ('picking',                'Picking',                  'pal', 1450),
  ('desconsolidado',         'Desconsolidado',           'hs', 19400),
  ('carga',                  'Carga',                    'pal',  980),
  ('descarga',               'Descarga',                 'pal',  980),
  ('distribucion',           'Distribución',             'km',   920),
  ('anmat',                  'Servicios ANMAT',          'hs', 16800),
  ('operaciones-especiales', 'Operaciones especiales',   'hs', 22500),
  ('otros',                  'Otros servicios',          'un',     0)
on conflict (slug) do update
  set label = excluded.label, unit = excluded.unit, rate = excluded.rate, updated_at = now();

insert into public.operators (full_name, role, avatar, depot) values
  ('Carlos Méndez',     'Jefe de depósito · Magaldi', 'CM', 'MAGALDI'),
  ('Sergio Acuña',      'Jefe de depósito · Luján',    'SA', 'LUJAN'),
  ('Javier Domínguez',  'Supervisor',                  'JD', null),
  ('Maximiliano Rojas', 'Maquinista',                  'MR', 'MAGALDI')
on conflict do nothing;

-- =========================================================================
-- 0023_lujan_cubiculos.sql
-- Seed operativo de los cubículos ANMAT de PEDRO_LUJAN_3159 (P1 y P2).
--
-- Referencia: croquis operativo aprobado (addendum FASE 4A, 2026-06-02). El
-- plano municipal (sectores D7/D6) es la verdad legal/estructural; este seed es
-- la realidad OPERATIVA: cada piso superior está subdividido en 12 cubículos
-- idénticos servidos por montacargas. Ver docs/digital-twin-blueprint.md §10.
--
-- ⚠️ REQUIERE 0020 aplicada (tablas físicas + sectores D7/D6 sembrados).
-- Modelo: cubículo = warehouse_position (sin tablas nuevas).
--   sector(D7|D6) → zone('MC') → rack('A' izq | 'B' der) → position(C01..C12)
--   Fila A = C01..C06 · Fila B = C07..C12 · pasillo central · idéntico P1/P2.
--
-- Idempotente (on conflict do nothing). Crea EXACTAMENTE 24 posiciones
-- (12 en P1, 12 en P2). status=disponible, surface_m2/volume_m3=NULL (carga
-- definitiva con relevamiento físico).
-- =========================================================================

-- ---- Zona Montacargas ('MC') bajo cada sector superior --------------------
insert into public.warehouse_zones (sector_id, code, name, zone_type)
select s.id, 'MC', 'Montacargas', 'almacenamiento'::warehouse_zone_type_t
from public.warehouse_sectors s
join public.warehouse_floors fl on fl.id = s.floor_id
join public.warehouses w on w.id = fl.warehouse_id
where w.code = 'PEDRO_LUJAN_3159'
  and ( (fl.code = 'P1' and s.code = 'D7')
     or (fl.code = 'P2' and s.code = 'D6') )
on conflict (sector_id, code) do nothing;

-- ---- Racks A (fila izquierda) y B (fila derecha) en cada zona MC -----------
insert into public.warehouse_racks (zone_id, code, name)
select z.id, r.code, r.name
from public.warehouse_zones z
join public.warehouse_sectors s on s.id = z.sector_id
join public.warehouse_floors fl on fl.id = s.floor_id
join public.warehouses w on w.id = fl.warehouse_id
cross join (values ('A','Fila izquierda'), ('B','Fila derecha')) as r(code, name)
where w.code = 'PEDRO_LUJAN_3159' and z.code = 'MC'
  and ( (fl.code = 'P1' and s.code = 'D7')
     or (fl.code = 'P2' and s.code = 'D6') )
on conflict (zone_id, code) do nothing;

-- ---- 24 cubículos = posiciones (C01..C06 en A, C07..C12 en B), P1 y P2 -----
insert into public.warehouse_positions (rack_id, code, status, surface_m2, volume_m3)
select rk.id, p.code, 'disponible'::warehouse_position_status_t, null, null
from public.warehouse_racks rk
join public.warehouse_zones z on z.id = rk.zone_id
join public.warehouse_sectors s on s.id = z.sector_id
join public.warehouse_floors fl on fl.id = s.floor_id
join public.warehouses w on w.id = fl.warehouse_id
cross join (values
  ('A','C01'), ('A','C02'), ('A','C03'), ('A','C04'), ('A','C05'), ('A','C06'),
  ('B','C07'), ('B','C08'), ('B','C09'), ('B','C10'), ('B','C11'), ('B','C12')
) as p(rack_code, code)
where w.code = 'PEDRO_LUJAN_3159' and z.code = 'MC' and rk.code = p.rack_code
  and ( (fl.code = 'P1' and s.code = 'D7')
     or (fl.code = 'P2' and s.code = 'D6') )
on conflict (rack_id, code) do nothing;

notify pgrst, 'reload schema';

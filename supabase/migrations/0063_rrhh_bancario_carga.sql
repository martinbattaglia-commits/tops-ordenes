-- CAPITAL HUMANO · CH5 — Carga inicial de datos bancarios (de los recibos 05/2026).
-- ⚠️ PII SENSIBLE (cuentas). RLS: solo rrhh.admin / dueño (migración 0058).
-- Resuelve empleado_id por CUIL. Idempotente (NOT EXISTS por empleado+cuenta).
-- Legajos 25/26/27 cobran en EFECTIVO → sin cuenta (no se cargan).
-- Aplicar DESPUÉS de 0062. NO aplicado a producción desde la sesión.

insert into public.rrhh_empleado_bancario (empleado_id, banco, cuenta, vigente_desde)
select e.id, v.banco, v.cuenta, e.fecha_ingreso
from public.rrhh_empleados e
join (values
  ('20-14824517-8','Banco Galicia y Bs.As.'   ,'400318521513'),
  ('20-18345361-1','Banco Galicia y Bs.As.'   ,'400651711517'),
  ('20-28032178-9','Banco Galicia y Bs.As.'   ,'803740'),
  ('20-17833256-3','Banco Galicia y Bs.As.'   ,'401087661518'),
  ('23-94837779-9','Banco Galicia y Bs.As.'   ,'4013600179'),
  ('20-94838520-2','Banco Galicia y Bs.As.'   ,'4013601813'),
  ('20-95021287-0','Banco Galicia y Bs.As.'   ,'401334285'),
  ('20-24011564-7','Banco Galicia y Bs.As.'   ,'4016815763'),
  ('27-29245752-4','Banco Galicia y Bs.As.'   ,'4018410164'),
  ('20-04416209-2','Banco Santander Rio'      ,'8800000080374'),
  ('20-95555080-4','Banco Galicia y Bs.As.'   ,'4020727-6 151-9'),
  ('20-41969130-6','Banco Galicia y Bs.As.'   ,'4020726-8 151-5'),
  ('23-12644035-9','Banco Galicia y Bs.As.'   ,'4021160-5 151-8'),
  ('27-96182735-9','Banco Galicia y Bs.As.'   ,'4023815-5 151-8'),
  ('27-28311907-1','Banco Galicia y Bs.As.'   ,'402495051510'),
  ('27-19102426-0','Banco Galicia y Bs.As.'   ,'4025219-0 151-9')
) as v(cuil, banco, cuenta) on v.cuil = e.cuil
where not exists (
  select 1 from public.rrhh_empleado_bancario b
  where b.empleado_id = e.id and b.cuenta = v.cuenta
);

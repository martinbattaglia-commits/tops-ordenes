# CAPITAL-HUMANO-DATA-MODEL

**Fecha:** 2026-06-08 · Complementa ARCHITECTURE.md. Diseño de datos: **reusar** lo existente + **extender** lo justo.

---

## 1. Tablas EXISTENTES (migraciones 0056–0060) — se reusan tal cual

### `rrhh_empleados` (legajo)
Datos personales/laborales + `estado (activo/licencia/baja)`, `depot`, `modalidad_contratacion`, `estado_civil`, `supervisor_id`, `profile_id` (link a auth/profile para Mi Espacio). Cols verificadas en código (EMP_COLS): `id, public_id, profile_id, apellido_nombre, dni, cuil, categoria, seccion, depot, convenio, fecha_ingreso, fecha_reconocida, supervisor_id, obra_social, estado`.
- `fecha_reconocida` = antigüedad reconocida (puede diferir de `fecha_ingreso`) → **base del cálculo de vacaciones**.

### `rrhh_empleado_bancario` / `rrhh_empleado_historial`
Datos bancarios (RLS solo `rrhh.admin`/dueño) e historial de cambios (append-only).

### `rrhh_solicitudes` + `rrhh_horas_extra_detalle` + `rrhh_solicitud_eventos`
Workflow de solicitudes. Enums: `solicitud_tipo_t`, `solicitud_estado_t (borrador/pendiente_supervisor/pendiente_rrhh/aprobada/rechazada/cancelada/anulada)`, `permiso_subtipo_t`, `licencia_subtipo_t`, `recargo_t`. Campo `computa_ausentismo`.

### `rrhh_novedades`
Resultado aprobado (periodo, tipo `novedad_tipo_t`, cantidad, `origen_solicitud_id`, `confirmada`). **Fuente de los saldos** (se suma, no se recalcula en cliente).

### `rrhh_documents` + `rrhh_document_audit`
Documental versionado + auditoría + Storage (`emit_rrhh_signed_url`).

---

## 2. EXTENSIONES propuestas (migraciones nuevas 0062+)

### 2.1 Vacaciones — entitlement y saldos (vistas, no recálculo en TS)

```sql
-- Política de entitlement por antigüedad (LCT art. 150) — tabla paramétrica (no hardcode)
create table public.rrhh_vacaciones_escala (
  id            serial primary key,
  anios_min     int not null,        -- inclusive
  anios_max     int,                 -- null = sin tope
  dias          int not null,
  unique (anios_min)
);
insert into public.rrhh_vacaciones_escala (anios_min, anios_max, dias) values
  (0,5,14), (5,10,21), (10,20,28), (20,null,35);

-- Saldo de vacaciones por empleado y período (VISTA derivada; el saldo vive en la base)
create view public.rrhh_vacaciones_saldo as
select
  e.id as empleado_id,
  p.anio as periodo,
  -- entitlement según antigüedad a la fecha de corte del período
  esc.dias as dias_correspondientes,
  coalesce(sum(n.cantidad) filter (where n.tipo='vacaciones' and n.confirmada), 0) as dias_tomados,
  esc.dias - coalesce(sum(n.cantidad) filter (where n.tipo='vacaciones' and n.confirmada),0) as dias_disponibles,
  coalesce(sum(n.cantidad) filter (where n.tipo='vacaciones' and not n.confirmada),0) as dias_planificados
from public.rrhh_empleados e
  cross join (select distinct extract(year from periodo)::int anio from public.rrhh_novedades) p
  join lateral (
     select dias from public.rrhh_vacaciones_escala s
     where date_part('year', age( make_date(p.anio,1,1), e.fecha_reconocida)) >= s.anios_min
       and (s.anios_max is null or date_part('year', age( make_date(p.anio,1,1), e.fecha_reconocida)) < s.anios_max)
     order by s.anios_min desc limit 1
  ) esc on true
  left join public.rrhh_novedades n on n.empleado_id=e.id and extract(year from n.periodo)::int=p.anio
group by e.id, p.anio, esc.dias;
```
> Antigüedad = `age(corte, fecha_reconocida)`. `dias_disponibles/tomados/planificados` derivados de `rrhh_novedades` (ya existente). **Cero cálculo en React** (igual que Tesorería).

### 2.2 Vacaciones — planificación / fraccionamiento (la planilla anual)
```sql
create table public.rrhh_vacaciones_periodo (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid not null references public.rrhh_empleados(id),
  anio          int not null,
  fecha_desde   date not null,
  fecha_hasta   date not null,
  dias          numeric(4,1) not null check (dias > 0),   -- admite 3.5 (medio día) visto en planilla
  estado        text not null default 'planificado',       -- planificado/notificado/gozado
  solicitud_id  uuid references public.rrhh_solicitudes(id),
  notificado_pdf_id uuid references public.rrhh_documents(id), -- "Período de Descanso Anual"
  created_at    timestamptz default now()
);
-- Control de superposición: índice/relación para detectar choques por depot/sector (validación en RPC).
```
> Modela la planilla (un empleado → varios períodos/año = fraccionamiento `X+Y`). La ventana legal **1-oct→30-abr** se valida en el RPC (warning, no bloqueo duro salvo configuración).

### 2.3 Firma digital (espejo OC/OS)
```sql
alter table public.rrhh_solicitudes
  add column integrity_hash text,     -- sha256 del contenido canónico (al aprobar/firmar)
  add column firma_empleado    jsonb, -- {actor_id, ts, hash}
  add column firma_supervisor  jsonb,
  add column firma_director     jsonb,
  add column pdf_document_id   uuid references public.rrhh_documents(id);
```
> `integrity_hash` se calcula igual que `compras/totals.ts` (sha256 de JSON canónico). Cada firma sella `{actor_id, ts, integrity_hash}`. El PDF institucional queda asociado en `pdf_document_id`.

### 2.4 Importación / recibos (Módulo 2) — **schema TENTATIVO (a confirmar con recibo real)**
```sql
create table public.rrhh_recibo_import (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null,
  source_file   text,
  -- campos extraídos (a validar contra un recibo real — NO asumidos como definitivos):
  apellido_nombre text, cuil text, categoria text, remuneracion numeric(14,2),
  fecha_ingreso date, periodo text,
  empleado_id   uuid references public.rrhh_empleados(id), -- match/merge
  status        text default 'pendiente',                  -- pendiente/matcheado/creado/descartado
  raw           jsonb,                                      -- payload crudo del parser
  created_at    timestamptz default now()
);
```
> ⚠️ Bloqueante R1: sin un recibo real no se fija el parser. Esta tabla es el *staging* de importación; el mapeo de columnas se confirma al recibir el documento.

---

## 3. RPCs nuevas (fail-closed, auditadas)

| RPC | Propósito |
|---|---|
| `rrhh_empleado_crear(p_payload jsonb)` | Alta de empleado (valida unicidad DNI/CUIL, registra en historial). |
| `rrhh_empleado_actualizar(p_id, p_patch jsonb)` | Modificación auditada (a `rrhh_empleado_historial`). |
| `rrhh_empleado_baja(p_id, p_fecha, p_motivo)` | Baja (estado→baja, fecha_egreso). |
| `rrhh_vacaciones_planificar(p_empleado, p_anio, p_periodos jsonb)` | Carga/edita períodos; valida superposición + ventana legal + saldo. |
| `rrhh_vacaciones_notificar(p_periodo_id)` | Genera "Período de Descanso Anual" (PDF) + estado→notificado. |
| `rrhh_sign_solicitud(p_id, p_nivel)` | Calcula `integrity_hash`, sella firma del nivel, avanza estado (reusa lógica L1/L2). |
| `rrhh_recibo_import_commit(p_batch)` | Crea empleados desde el staging matcheado. |

> Las RPCs de solicitudes existentes (`crear/enviar/aprobar_l1/l2/rechazar/cancelar/anular`) **se reusan**; `rrhh_sign_solicitud` las complementa con el sello de integridad.

---

## 4. Seed / carga inicial
- Roster real (17, de la planilla) → alta vía `rrhh_empleado_crear` o import.
- Escala de vacaciones → `rrhh_vacaciones_escala` (seed determinístico, en migración).
- Vacaciones 2026 → `rrhh_vacaciones_periodo` desde la planilla (requiere xlsx fuente para fechas).
- ⚠️ Fechas de ingreso/recibos: pendientes de la fuente real (no asumir).

---

## 5. Integridad / RLS
- Todas las tablas nuevas: RLS espejando R3–R5 (empleado→propio, supervisor→equipo, `rrhh.*`→según permiso). `rrhh_vacaciones_periodo` y saldos visibles en Mi Espacio solo para el propio empleado.
- `rrhh_recibo_import` y bancario: solo `rrhh.admin`.

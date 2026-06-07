-- =========================================================================
-- 0057_ap_workflow_permissions.sql — ERP-B1 · Workflow AP + RBAC (Gate 2)
--
-- Separa la dimensión de APROBACIÓN (persistida) de la dimensión de PAGO
-- (derivada en supplier_open_items, ERP-A). Resuelve el "double truth" (P1)
-- por semántica, SIN tocar ERP-A.
--
--   · status (legacy, 0014) — queda DEPRECADO. Solo se mantiene para
--     compatibilidad con la vista supplier_open_items (0054:394, filtra
--     `where si.status <> 'anulada'`). La RPC ap_void (0058) espeja
--     status='anulada' para que ERP-A siga excluyendo las anuladas.
--   · approval_status (NUEVO) — fuente de verdad del workflow de aprobación.
--   · estado_pago — DERIVADO en supplier_open_items (NO se persiste).
--
-- Requiere el valor de enum permission_module_t='cuentas_pagar' ya committeado
-- en 0056 (mismo patrón 0052→0053).
--
-- NATURALEZA: ADITIVA. No toca ERP-A.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Enum de estado de APROBACIÓN (tipo nuevo → uso en la misma migración OK)
-- -------------------------------------------------------------------------
do $$ begin
  create type public.ap_approval_status_t as enum (
    'cargada',      -- alta confirmada (OCR + humano). Estado inicial.
    'en_revision',  -- enviada a validación contable
    'aprobada',     -- aprobada para pago
    'anulada'       -- baja lógica (append-only; no DELETE)
  );
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. Columna approval_status + migración de datos desde el status legacy
-- -------------------------------------------------------------------------
alter table public.supplier_invoices
  add column if not exists approval_status public.ap_approval_status_t not null default 'cargada';

-- Mapeo de los datos existentes (status legacy → approval_status):
--   pendiente/conciliada → cargada/en_revision · pagada/aprobada → aprobada · anulada → anulada
update public.supplier_invoices
set approval_status = case status
  when 'pendiente'  then 'cargada'
  when 'conciliada' then 'en_revision'
  when 'aprobada'   then 'aprobada'
  when 'pagada'     then 'aprobada'   -- 'pagada' no es estado de aprobación; el pago se deriva
  when 'anulada'    then 'anulada'
  else 'cargada'
end::public.ap_approval_status_t
where true;

create index if not exists si_approval_status_idx on public.supplier_invoices (approval_status);

comment on column public.supplier_invoices.status is
  'DEPRECADO (ERP-B1): usar approval_status. Se conserva solo por compat con supplier_open_items (filtra anulada). ap_void espeja status=anulada.';
comment on column public.supplier_invoices.approval_status is
  'Fuente de verdad del workflow de aprobación AP. El estado de PAGO es derivado en supplier_open_items.estado_pago (nunca se duplica).';

-- -------------------------------------------------------------------------
-- 3. Auditoría append-only de transiciones de aprobación
-- -------------------------------------------------------------------------
create table if not exists public.supplier_invoice_audit (
  id bigserial primary key,
  supplier_invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  ts timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,                       -- 'crear'|'enviar_revision'|'aprobar'|'reabrir'|'anular'
  from_status public.ap_approval_status_t,
  to_status   public.ap_approval_status_t,
  note text
);
create index if not exists sia_invoice_idx on public.supplier_invoice_audit (supplier_invoice_id, ts desc);

-- DELETE prohibido (append-only) — reutiliza el guard financiero de ERP-A (0053:77).
drop trigger if exists trg_sia_no_delete on public.supplier_invoice_audit;
create trigger trg_sia_no_delete
  before delete on public.supplier_invoice_audit
  for each row execute function public.tg_forbid_delete_financial();

alter table public.supplier_invoice_audit enable row level security;
drop policy if exists "sia read internal" on public.supplier_invoice_audit;
create policy "sia read internal"
  on public.supplier_invoice_audit for select
  using (public.current_role() in ('admin','operaciones','supervisor'));
-- INSERT solo vía RPC security-definer (sin policy de insert → bloqueado a clientes directos).

-- =========================================================================
-- 4. RBAC — catálogo de permisos 'cuentas_pagar' + mapeo a roles.
--    Acciones del enum permission_action_t (fijo): la review→edit, approve→sign,
--    anular→delete. Requiere permission_module_t='cuentas_pagar' (0056).
-- =========================================================================
insert into public.permissions (slug, module, action, label, description) values
  ('cuentas_pagar.view',   'cuentas_pagar', 'view',   'Ver cuentas a pagar',        'Listar/consultar facturas de proveedor y saldos'),
  ('cuentas_pagar.create', 'cuentas_pagar', 'create', 'Cargar factura de proveedor','Alta con detalle fiscal (OCR + confirmación humana)'),
  ('cuentas_pagar.edit',   'cuentas_pagar', 'edit',   'Enviar a revisión / editar', 'Transición a en_revision y edición en borrador'),
  ('cuentas_pagar.sign',   'cuentas_pagar', 'sign',   'Aprobar factura',            'Aprobar para pago (transición a aprobada)'),
  ('cuentas_pagar.delete', 'cuentas_pagar', 'delete', 'Anular factura',             'Anulación lógica (append-only)'),
  ('cuentas_pagar.export', 'cuentas_pagar', 'export', 'Exportar IVA compras',       'Libro IVA compras / export contador')
on conflict (slug) do nothing;

-- director_ops: control total AP
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'director_ops' and p.module = 'cuentas_pagar'
on conflict do nothing;

-- admin (administración financiera): control total AP
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'admin' and p.module = 'cuentas_pagar'
on conflict do nothing;

-- operaciones: cargar/ver/editar (sin aprobar ni anular)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'operaciones'
  and p.slug in ('cuentas_pagar.view','cuentas_pagar.create','cuentas_pagar.edit')
on conflict do nothing;

-- compliance: ver + exportar
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'compliance'
  and p.slug in ('cuentas_pagar.view','cuentas_pagar.export')
on conflict do nothing;

notify pgrst, 'reload schema';

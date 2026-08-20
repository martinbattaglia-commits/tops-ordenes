-- 0261a_finance_permission_enums.sql — Módulo Nativo Finanzas · Enums RBAC
-- Precursora aislada para habilitar los valores de enum requeridos por 0262.

alter type public.permission_module_t
  add value if not exists 'finanzas';

alter type public.permission_action_t
  add value if not exists 'plan';

alter type public.permission_action_t
  add value if not exists 'approve';

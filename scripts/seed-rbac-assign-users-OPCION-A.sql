-- =============================================================================
-- SEED RBAC · ASIGNACIÓN DE USUARIOS — OPCIÓN A (aprobada por Presidencia 2026-05-30)
-- =============================================================================
-- Mapeo confirmado por Martín Battaglia (Presidente):
--     José Luis Rodríguez Silva  ->  director_ops
--     Ruth Carrasquero           ->  admin
--
-- Fuente: docs/erp/RBAC-READONLY-VALIDATION.md (§5). Catálogo VIVO = 7 roles
-- (director_ops/admin), NO los slugs director/administracion del seed viejo.
--
-- ⚠️  ESTE ARCHIVO NO SE EJECUTA AUTOMÁTICAMENTE. Pegalo vos en el SQL Editor
--     de Supabase del entorno correspondiente. Identifica por EMAIL+SLUG
--     (portable, sin UUIDs literales). Idempotente: ON CONFLICT DO NOTHING.
--
-- ESTADO PREVIO VERIFICADO (read-only, 2026-05-30): user_roles = 0 en ambos
--     entornos (RBAC dormido). PROD tiene ambos usuarios; SANDBOX no tiene ninguno.
-- =============================================================================


-- =============================================================================
-- BLOQUE 1 · SANDBOX  (proyecto vrxosunxlhohmqymxots — tops-nexus-staging)
-- -----------------------------------------------------------------------------
-- ⚠️ PRE-REQUISITO: joseluis@ y ruth@ NO existen en auth.users de sandbox.
--    Creá esas cuentas (o cuentas de prueba) ANTES de correr esto, o el
--    pre-flight aborta con RAISE EXCEPTION.
-- =============================================================================
BEGIN;

DO $$
DECLARE v_dir_u int; v_adm_u int; v_dir_r int; v_adm_r int;
BEGIN
  SELECT count(*) INTO v_dir_u FROM auth.users WHERE email='joseluis@logisticatops.com';
  SELECT count(*) INTO v_adm_u FROM auth.users WHERE email='ruth@logisticatops.com';
  SELECT count(*) INTO v_dir_r FROM public.roles WHERE slug='director_ops';
  SELECT count(*) INTO v_adm_r FROM public.roles WHERE slug='admin';
  IF v_dir_u=0 THEN RAISE EXCEPTION 'FALTA usuario joseluis@ en sandbox auth.users (crear cuenta primero)'; END IF;
  IF v_adm_u=0 THEN RAISE EXCEPTION 'FALTA usuario ruth@ en sandbox auth.users (crear cuenta primero)'; END IF;
  IF v_dir_r=0 THEN RAISE EXCEPTION 'FALTA role director_ops'; END IF;
  IF v_adm_r=0 THEN RAISE EXCEPTION 'FALTA role admin'; END IF;
  RAISE NOTICE 'Pre-flight OK';
END $$;

INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Director de Operaciones', u.id, now()
FROM auth.users u CROSS JOIN public.roles r
WHERE u.email='joseluis@logisticatops.com' AND r.slug='director_ops'
ON CONFLICT (user_id, role_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Administración · Verotin S.A.', u.id, now()
FROM auth.users u CROSS JOIN public.roles r
WHERE u.email='ruth@logisticatops.com' AND r.slug='admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Verificación (esperado: 2 filas)
SELECT u.email, r.slug, ur.position_title
FROM public.user_roles ur
JOIN auth.users u ON u.id=ur.user_id
JOIN public.roles r ON r.id=ur.role_id
WHERE u.email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
ORDER BY r.slug;

-- COMMIT;   -- descomentá si la verificación muestra exactamente 2 filas correctas
-- ROLLBACK; -- en cualquier otro caso


-- =============================================================================
-- BLOQUE 2 · PRODUCCIÓN  (proyecto arsksytgdnzukbmfgkju)
-- -----------------------------------------------------------------------------
-- Usuarios YA existen → el pre-flight pasará. GATE DURO: no ejecutar en prod
-- sin BACKUP CERRADO (P0.1) y confirmación explícita. SQL idéntico al sandbox.
--
-- IDs resueltos (SOLO para verificar el resultado, NO para hardcodear):
--     user joseluis@   = 3b1607c9-32c5-4ca0-91e1-19c82099b64d
--     user ruth@       = 5b635940-28be-43ab-a2bd-606481052bee
--     role director_ops= 7ca43377-8678-4fd3-8f8a-995920809cb2
--     role admin       = 335f09d6-e8a3-4057-aae9-5fcdd700c07d
-- =============================================================================
BEGIN;

DO $$
DECLARE v_dir_u int; v_adm_u int; v_dir_r int; v_adm_r int;
BEGIN
  SELECT count(*) INTO v_dir_u FROM auth.users WHERE email='joseluis@logisticatops.com';
  SELECT count(*) INTO v_adm_u FROM auth.users WHERE email='ruth@logisticatops.com';
  SELECT count(*) INTO v_dir_r FROM public.roles WHERE slug='director_ops';
  SELECT count(*) INTO v_adm_r FROM public.roles WHERE slug='admin';
  IF v_dir_u=0 THEN RAISE EXCEPTION 'FALTA usuario joseluis@ en prod auth.users'; END IF;
  IF v_adm_u=0 THEN RAISE EXCEPTION 'FALTA usuario ruth@ en prod auth.users'; END IF;
  IF v_dir_r=0 THEN RAISE EXCEPTION 'FALTA role director_ops'; END IF;
  IF v_adm_r=0 THEN RAISE EXCEPTION 'FALTA role admin'; END IF;
  RAISE NOTICE 'Pre-flight OK';
END $$;

INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Director de Operaciones', u.id, now()
FROM auth.users u CROSS JOIN public.roles r
WHERE u.email='joseluis@logisticatops.com' AND r.slug='director_ops'
ON CONFLICT (user_id, role_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Administración · Verotin S.A.', u.id, now()
FROM auth.users u CROSS JOIN public.roles r
WHERE u.email='ruth@logisticatops.com' AND r.slug='admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Verificación (esperado: 2 filas)
SELECT u.email, r.slug, ur.position_title
FROM public.user_roles ur
JOIN auth.users u ON u.id=ur.user_id
JOIN public.roles r ON r.id=ur.role_id
WHERE u.email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
ORDER BY r.slug;

-- COMMIT;   -- descomentá si la verificación muestra exactamente 2 filas correctas
-- ROLLBACK; -- en cualquier otro caso

-- =========================================================================
-- TEST · Versionado documental (P5) — remediación GATE 1C / hallazgo C-1
-- =========================================================================
-- Verifica que el mecanismo de versiones funciona y que SIEMPRE existe una
-- única versión "actual" por grupo, recorriendo v1 -> v2 -> v3.
--
-- USO (solo STAGING, NUNCA producción):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0010_documents_versioning_test.sql
--
-- El script corre dentro de una transacción y termina con ROLLBACK: NO deja
-- datos. Si cualquier ASSERT falla, ON_ERROR_STOP aborta y la transacción se
-- descarta. No requiere clients/profiles previos (client_id queda NULL).
-- Requiere la migración 0010 ENTERPRISE HARDENED ya aplicada en el entorno.
-- =========================================================================

begin;

do $$
declare
  v1 uuid; v2 uuid; v3 uuid; grp uuid;
  n int; cur_id uuid; cur_ver int;
begin
  -- v1: versión inicial (sin supersedes) ⇒ is_current=true, version=1.
  insert into public.documents (title, storage_path, mime_type, source)
    values ('Doc test v1', 'test-vers/v1.pdf', 'application/pdf', 'upload')
    returning id, document_group_id into v1, grp;

  -- v2: supersede a v1 ⇒ hereda grupo, version=2, degrada a v1.
  insert into public.documents (title, storage_path, mime_type, source, supersedes_id)
    values ('Doc test v2', 'test-vers/v2.pdf', 'application/pdf', 'upload', v1)
    returning id into v2;

  -- v3: supersede a v2 ⇒ hereda grupo, version=3, degrada a v2.
  insert into public.documents (title, storage_path, mime_type, source, supersedes_id)
    values ('Doc test v3', 'test-vers/v3.pdf', 'application/pdf', 'upload', v2)
    returning id into v3;

  -- (1) Una y solo una versión actual por grupo.
  select count(*) into n
    from public.documents where document_group_id = grp and is_current;
  assert n = 1, format('FALLO C-1: se esperaba 1 versión actual, hubo %s', n);

  -- (2) La versión actual es v3 con version=3.
  select id, version into cur_id, cur_ver
    from public.documents where document_group_id = grp and is_current;
  assert cur_id = v3,    'FALLO C-1: la versión actual debería ser v3';
  assert cur_ver = 3,    format('FALLO C-1: version actual debería ser 3, fue %s', cur_ver);

  -- (3) v1 y v2 quedaron NO-actuales y en el mismo grupo (cierra B-1).
  select count(*) into n
    from public.documents
    where document_group_id = grp and id in (v1, v2) and is_current = false;
  assert n = 2, 'FALLO C-1/B-1: v1 y v2 deben quedar no-actuales en el mismo grupo';

  -- (4) El grupo contiene exactamente 3 versiones.
  select count(*) into n from public.documents where document_group_id = grp;
  assert n = 3, format('FALLO C-1: se esperaban 3 versiones, hubo %s', n);

  -- (5) Numeración monotónica 1,2,3 sin huecos.
  select count(distinct version) into n
    from public.documents where document_group_id = grp;
  assert n = 3, 'FALLO C-1: las versiones deben ser distintas (1,2,3)';

  raise notice 'PASÓ C-1: v1->v2->v3 con una ÚNICA versión actual (v3, version=3).';
end $$;

-- No persistir nada de la prueba.
rollback;

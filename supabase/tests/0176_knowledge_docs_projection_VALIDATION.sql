-- 0176/0177 — KIT DE VALIDACIÓN (SOLO LECTURA). F5.1-b.0.
-- Correr en el SQL Editor DESPUÉS de aplicar 0176/0177 y el apply, en la ventana autorizada.
-- NINGUNA sentencia escribe. Cada bloque imprime PASS/FAIL o un conteo esperado.
-- ─────────────────────────────────────────────────────────────────────────────

-- V0. DRY-RUN antes del apply: revisar impacto SIN escribir.
select public.ai_docs_backfill_dryrun();

-- ── Los siguientes checks se corren DESPUÉS del apply ──────────────────────────

-- V1. Conteo proyectado = esperado (569 compliance + 228 contratos = 797).
select 'V1 conteo' as check,
       (select count(*) from public.searchable_items where entity_type = 'compliance_documento') as compliance,
       (select count(*) from public.searchable_items where entity_type = 'contrato')             as contratos,
       case when (select count(*) from public.searchable_items where entity_type in ('compliance_documento','contrato')) = 797
            then 'PASS' else 'REVISAR (≠797: puede variar si cambió la fuente)' end as veredicto;

-- V2. REGLA DURA: 0 filas con visibility_key permisiva (public_auth) o fuera de lo aprobado.
select 'V2 visibility_key' as check,
       (select count(*) from public.searchable_items
         where entity_type in ('compliance_documento','contrato')
           and visibility_key = 'public_auth') as public_auth,
       (select count(*) from public.searchable_items
         where entity_type in ('compliance_documento','contrato')
           and visibility_key not in ('perm:compliance.view','perm:comercial.view')) as fuera_de_politica,
       case when (select count(*) from public.searchable_items
                   where entity_type in ('compliance_documento','contrato')
                     and (visibility_key = 'public_auth'
                          or visibility_key not in ('perm:compliance.view','perm:comercial.view'))) = 0
            then 'PASS' else 'FAIL' end as veredicto;

-- V3. VK: ningún contrato quedó en 'staff' (fuente única, no knowledge_visibility_for).
select 'V3 contratos no-staff' as check,
       (select count(*) from public.searchable_items where entity_type = 'contrato' and visibility_key = 'staff') as en_staff,
       case when (select count(*) from public.searchable_items where entity_type = 'contrato' and visibility_key = 'staff') = 0
            then 'PASS' else 'FAIL' end as veredicto;

-- V4. H4 PII: 0 dígitos-PII en body tras redacción — corridas ≥7 contiguas Y punteadas
--     (33.604.896.889 / 12.345.678). El patrón punteado cierra el leak hallado en review.
select 'V4 pii en body' as check,
       (select count(*) from public.searchable_items
         where entity_type in ('compliance_documento','contrato')
           and (body ~ '[0-9]{7,}' or body ~ '[0-9]{1,3}([.[:space:]-][0-9]{3}){2,}')) as filas_con_pii,
       case when (select count(*) from public.searchable_items
                   where entity_type in ('compliance_documento','contrato')
                     and (body ~ '[0-9]{7,}' or body ~ '[0-9]{1,3}([.[:space:]-][0-9]{3}){2,}')) = 0
            then 'PASS' else 'FAIL (revisar patrón de redacción)' end as veredicto;
-- Muestra de sospechosos (si V4 falla):
-- select public_id, body from public.searchable_items
--  where entity_type in ('compliance_documento','contrato')
--    and (body ~ '[0-9]{7,}' or body ~ '[0-9]{1,3}([.[:space:]-][0-9]{3}){2,}') limit 20;

-- V5. B1 public_id: 0 nulos (coalesce garantiza no-null).
select 'V5 public_id no-null' as check,
       (select count(*) from public.searchable_items
         where entity_type in ('compliance_documento','contrato') and public_id is null) as nulos,
       case when (select count(*) from public.searchable_items
                   where entity_type in ('compliance_documento','contrato') and public_id is null) = 0
            then 'PASS' else 'FAIL' end as veredicto;

-- V6. B2 entity_date: el día calendario proyectado coincide con la fuente (muestra compliance).
select 'V6 entity_date tz' as check, cd.id, cd.fecha_vencimiento as fuente,
       (si.entity_date at time zone 'America/Argentina/Buenos_Aires')::date as proyectado_ar,
       case when cd.fecha_vencimiento is null
              or (si.entity_date at time zone 'America/Argentina/Buenos_Aires')::date = cd.fecha_vencimiento
            then 'PASS' else 'FAIL' end as veredicto
from public.compliance_documents cd
join public.searchable_items si on si.entity_type = 'compliance_documento' and si.entity_id = cd.id::text
where cd.fecha_vencimiento is not null
order by cd.id limit 5;

-- V7. Idempotencia: re-correr apply NO duplica (unique) — comparar conteo antes/después.
--   Ejecutar manualmente:
--   select public.ai_docs_backfill_apply();  -- 2ª corrida
--   luego re-correr V1: el conteo debe ser idéntico.

-- V8. H3 huérfanos: 0 filas proyectadas cuyo documento fuente ya no exista.
select 'V8 huerfanos' as check,
       (select count(*) from public.searchable_items si
         where si.entity_type = 'compliance_documento'
           and not exists (select 1 from public.compliance_documents d where d.id::text = si.entity_id))
       + (select count(*) from public.searchable_items si
         where si.entity_type = 'contrato'
           and not exists (select 1 from public.contract_documents d where d.id::text = si.entity_id)) as huerfanos,
       'esperado 0 tras apply completo' as nota;

-- V9. RLS (aislamiento). Reemplazar :uid_operaciones y :uid_admin por uuids reales.
--   Como authenticated con un usuario SIN comercial.view/compliance.view → 0 filas.
--   Correr en dos sesiones/roles; acá el patrón (NO ejecutar tal cual sin setear GUC):
-- set local role authenticated;
-- select set_config('request.jwt.claims', json_build_object('sub', :'uid_sin_perms')::text, true);
-- select count(*) from public.searchable_items where entity_type in ('compliance_documento','contrato');
--   → esperado 0 para un usuario sin knowledge.view (gate) o sin perm de fila.

-- V10. Marcador [ficha metadata] presente en el body (D5) — muestra.
select 'V10 ficha metadata' as check,
       (select count(*) from public.searchable_items
         where entity_type in ('compliance_documento','contrato') and body like '[ficha metadata]%') as con_marcador,
       (select count(*) from public.searchable_items where entity_type in ('compliance_documento','contrato')) as total,
       case when (select count(*) from public.searchable_items where entity_type in ('compliance_documento','contrato') and body like '[ficha metadata]%')
                 = (select count(*) from public.searchable_items where entity_type in ('compliance_documento','contrato'))
            then 'PASS' else 'FAIL' end as veredicto;

-- V11. D3: los 6 pilotos tienen los 3 permisos documentales efectivos (via rol o admin).
--     AMBAS cuentas de Martín (martin@ / martin.battaglia@) deben quedar ALINEADAS con
--     knowledge.view + compliance.view + comercial.view (es la misma persona, Dirección).
select 'V11 acceso piloto' as check, pr.email, pr.role,
       (pr.role = 'admin') as es_admin,
       coalesce((
         select array_agg(distinct p.slug order by p.slug)
         from public.user_roles ur
         join public.role_permissions rp on rp.role_id = ur.role_id
         join public.permissions p on p.id = rp.permission_id
         where ur.user_id = pr.id and p.slug in ('knowledge.view','compliance.view','comercial.view')
       ), array[]::text[]) as perms_via_rol
from public.profiles pr
where lower(pr.email) in ('martin@logisticatops.com','martin.battaglia@logisticatops.com',
  'joseluis@logisticatops.com','cynthia@logisticatops.com','ruth@logisticatops.com','martinrinas@logisticatops.com')
order by pr.email;
-- Esperado tras 0177: perms_via_rol = {comercial.view, compliance.view, knowledge.view} para
-- todos (o es_admin=true). martin.battaglia@ debe dejar de estar vacío.

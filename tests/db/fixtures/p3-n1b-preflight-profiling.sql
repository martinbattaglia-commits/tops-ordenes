-- =========================================================================
-- P3-N1B · PREFLIGHT DE PERFILADO — 100 % SOLO LECTURA.
--
-- Mide la cobertura que los gates de 0220 van a exigir, SIN tocar datos y
-- SIN exponer datos comerciales: devuelve exclusivamente AGREGADOS (conteos).
-- Ninguna razón social, CUIT, email, contacto ni nombre individual.
--
-- Uso en producción: Martín lo pega en el SQL Editor DESPUÉS de aplicar 0219
-- y ANTES de intentar 0220. Los gates de 0220 sólo pasan si TODAS las métricas
-- `*_sin_client_id` y `identidades_duplicadas` son 0.
--
-- Uso en el harness: t-n1b-03 lo ejecuta dentro de una transacción
-- `read only` para demostrar que no contiene escritura alguna.
-- =========================================================================

select
  -- ── Cobertura de identidad canónica (gates G-1/G-2/G-3) ──
  (select count(*) from public.inventory_items)                          as items_total,
  (select count(*) from public.inventory_items  where client_id is null) as items_sin_client_id,
  (select count(*) from public.receptions)                               as recepciones_total,
  (select count(*) from public.receptions       where client_id is null) as recepciones_sin_client_id,
  (select count(*) from public.logistics_orders)                         as pedidos_total,
  (select count(*) from public.logistics_orders where client_id is null) as pedidos_sin_client_id,

  -- ── Unicidad canónica (gate G-4; GROUP BY iguala NULLs de posición) ──
  (select count(*) from (
     select 1 from public.inventory_items
     group by client_id, sku, position_id having count(*) > 1
   ) d)                                                                  as identidades_duplicadas,

  -- ── Riesgo de la identidad legacy: nombres que colisionarían ──
  (select count(*) from (
     select client_name from public.inventory_items
     group by client_name having count(distinct client_id) > 1
   ) d)                                                                  as nombres_compartidos_por_varios_clientes,

  -- ── Proyección de business_unit (ADR-P3-06 / N-7) ──
  (select count(*) from public.inventory_items where business_unit is not null)    as items_con_linea_proyectada,
  (select count(*) from public.inventory_items where business_unit is null)        as items_sin_linea,
  (select count(*) from public.inventory_items ii
     where not exists (select 1 from public.reception_items ri
                        where ri.inventory_item_id = ii.id))                       as items_sin_vinculo_de_recepcion,
  (select count(*) from public.inventory_bu_anomalies where resolved_at is null)   as anomalias_multi_bu_abiertas,
  (select count(*) from public.inventory_bu_anomalies where resolved_at is not null) as anomalias_multi_bu_resueltas,
  (select count(*) from public.inventory_items where business_unit = 'CORPORATE')  as items_corporate_no_resolubles,

  -- ── Tres poblaciones de M-03 (sólo demostrable desde 0219 en adelante) ──
  (select count(*) from public.receptions where business_unit = 'GENERAL' and business_unit_source = 'declared')  as general_declarado,
  (select count(*) from public.receptions where business_unit = 'GENERAL' and business_unit_source = 'defaulted') as general_por_omision,
  (select count(*) from public.receptions where business_unit = 'GENERAL' and business_unit_source = 'unknown')   as general_no_demostrable,
  (select count(*) from public.receptions where business_unit = 'ANMAT')                                          as recepciones_anmat,
  (select count(*) from public.receptions where business_unit = 'CORPORATE')                                      as recepciones_corporate;

# LIBRO-IVA-VENTAS-CONTROL — Queries de consulta y control (FASE 2)

**Fecha:** 2026-06-12 · **Requiere:** migración 0073 aplicada (las queries usan las vistas; hasta entonces, reemplazar la vista por su cuerpo).
**Uso:** Contadora / estudio contable / auditoría — SQL Editor de Supabase o futuro export de V3/V4. Todas son de SOLO LECTURA.

## 1 — Consulta mensual (mes corriente)
```sql
select * from libro_iva_ventas
where periodo = to_char(current_date, 'YYYY-MM')
order by alicuota_iva desc;
```

## 2 — Por período fiscal (parámetro)
```sql
-- Detalle de comprobantes del período
select fecha, tipo_comprobante, punto_venta, numero_comprobante, cliente, cuit,
       neto_gravado, iva_total, importe_exento, importe_no_gravado, total_comprobante,
       comprobante_asociado
from customer_invoice_fiscal
where periodo = '2026-06'          -- ← período a consultar
order by fecha, punto_venta, numero_comprobante;

-- Totales del período (pie del libro)
select periodo, sum(neto_gravado) neto, sum(iva_debito_fiscal) iva_debito, sum(total_gravado) total
from libro_iva_ventas where periodo = '2026-06' group by periodo;
```

## 3 — Por cliente
```sql
select cliente, cuit,
       count(*)            as comprobantes,
       sum(neto_gravado)   as neto_gravado,
       sum(iva_total)      as iva_debito,
       sum(total_comprobante) as total_facturado
from customer_invoice_fiscal
where periodo between '2026-01' and '2026-12'   -- ← rango
group by cliente, cuit
order by total_facturado desc;
```

## 4 — Por tipo de comprobante (facturas vs NC vs ND)
```sql
select periodo, tipo_comprobante,
       count(*) comprobantes,
       sum(neto_gravado) neto, sum(iva_total) iva, sum(total_comprobante) total
from customer_invoice_fiscal
group by periodo, tipo_comprobante
order by periodo desc, tipo_comprobante;
```

## 5 — Control de diferencias (la query de la verificación matemática)
```sql
-- Debe devolver CERO filas. Cualquier fila = romper el vidrio.
select ci.id, ci.punto_venta, ci.numero_comprobante,
       vl.neto - ci.subtotal as delta_neto,
       vl.iva  - ci.iva      as delta_iva
from customer_invoices ci
join (select invoice_id, sum(neto_gravado) neto, sum(iva_importe) iva
      from customer_invoice_vat_lines group by invoice_id) vl on vl.invoice_id = ci.id
where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
  and (abs(vl.neto - ci.subtotal) > 0.02 or abs(vl.iva - ci.iva) > 0.02);
```
Control triple agregado (libro ≡ vat_lines ≡ cabecera) — ejecutado 2026-06-12 contra producción: **931.266,00 / 931.266,00 / 931.266,00 (IVA) · 4.434.600 ×3 (neto) · MAX |Δ| 0,00**.

## 6 — Exportación contable (CSV para el estudio)
```sql
-- En el SQL Editor: Run + botón "Export → CSV". Columnas estilo libro RG.
select fecha                              as "Fecha",
       periodo                            as "Período",
       replace(tipo_comprobante::text,'_',' ') as "Comprobante",
       lpad(punto_venta::text, 5, '0') || '-' || lpad(numero_comprobante::text, 8, '0') as "Número",
       cliente                            as "Razón Social",
       cuit                               as "CUIT",
       condicion_iva                      as "Cond. IVA",
       neto_21   as "Neto 21%",  iva_21   as "IVA 21%",
       neto_10_5 as "Neto 10,5%", iva_10_5 as "IVA 10,5%",
       neto_27   as "Neto 27%",  iva_27   as "IVA 27%",
       importe_exento     as "Exento",
       importe_no_gravado as "No Gravado",
       percepciones       as "Percepciones",
       iva_total          as "Total IVA",
       total_comprobante  as "Total",
       cae                as "CAE",
       comprobante_asociado as "Comp. Asociado"
from customer_invoice_fiscal
where periodo = '2026-06'                 -- ← período a exportar
order by fecha, punto_venta, numero_comprobante;
```

> Nota de vigencia: todas las queries heredan el corte de validez fiscal (`fiscal_ambiente()`) — al pasar a PRODUCCIÓN excluyen los comprobantes SANDBOX automáticamente.

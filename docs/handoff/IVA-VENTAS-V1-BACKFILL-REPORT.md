# IVA-VENTAS-V1-BACKFILL-REPORT — Reconstrucción del histórico y diferencias

**Fecha:** 2026-06-12 · **Rama:** `feature/iva-ventas-v1` · **Migración:** 0072 §6–§7 (NO aplicada)

## §1 — Fórmula del backfill (única, sin recálculo de impuestos)
```sql
insert into customer_invoice_vat_lines (invoice_id, alic_iva_id, alicuota_iva, neto_gravado, iva_importe)
select invoice_id, alic_iva_id, alicuota_iva, sum(importe_neto), sum(importe_iva)
from invoice_items group by invoice_id, alic_iva_id, alicuota_iva
on conflict (invoice_id, alic_iva_id) do nothing;
```
El importe canónico es **lo ya persistido por renglón** (= lo declarado a ARCA). No se recalcula IVA: se agrupa. Por eso la identidad con la cabecera cierra por construcción (la cabecera se calculó sumando los mismos renglones).

## §2 — Prueba de equivalencia (ejecutada, mock)
Caso **V6** de la suite (`scripts/qa/iva-ventas-v1-test.ts`): para una factura de 9 renglones con centavos impares al 21%, la agrupación `GROUP BY` de los items reproduce **exactamente** las `vat_lines` que emite la puerta transaccional, y **V4/V4b/V5** prueban Σ líneas = cabecera con diferencia $0,00 (también en multi-alícuota 21/10.5/0). Resultado: **10/10 PASS**.

## §3 — Universo real a backfillear (leído de producción el 2026-06-12)
| Comprobante | Estado | Total | Alícuotas esperadas |
|---|---|---|---|
| Factura A 00002-00000001 · Martin Rinas | AUTORIZADO (SANDBOX) | $4.422.308 | 1 línea al 21% |
| Factura A 00002-00000002 · Verotin SA | AUTORIZADO (SANDBOX) | $89.298 | 1 línea al 21% |

Universo mínimo (2 comprobantes, mono-alícuota) — riesgo de divergencia: bajo. Diferencias esperadas: **$0,00** en ambos.

## §4 — Dry-run de verificación (para ejecutar en la sesión de revisión — solo SELECT)
```sql
-- Diferencias que produciría el backfill (sin escribir nada):
select ci.id, ci.punto_venta, ci.numero_comprobante, ci.estado_arca, ci.ambiente,
       ci.subtotal  as neto_cabecera,
       ci.iva       as iva_cabecera,
       coalesce(bf.neto, 0) as neto_backfill,
       coalesce(bf.iva, 0)  as iva_backfill,
       coalesce(bf.neto, 0) - ci.subtotal as delta_neto,
       coalesce(bf.iva, 0)  - ci.iva      as delta_iva,
       coalesce(bf.lineas, 0) as lineas
from customer_invoices ci
left join (
  select invoice_id, sum(importe_neto) neto, sum(importe_iva) iva, count(distinct alic_iva_id) lineas
  from invoice_items group by invoice_id
) bf on bf.invoice_id = ci.id
order by ci.created_at;
-- Criterio de éxito: |delta_neto| ≤ 0.02 y |delta_iva| ≤ 0.02 y lineas ≥ 1 en todas las filas.
```
> Nota de protocolo: el dry-run contra producción no se ejecutó en esta fase porque la directiva V1 ordena **detenerse y presentar evidencia** antes de cualquier acción sobre producción. La consulta es de solo lectura y está lista para correrse en tu revisión; además es redundante con la red de seguridad de §5.

## §5 — Red de seguridad: la migración se auto-verifica (fail-fast)
0072 §7 ejecuta esta misma comparación **dentro de la migración**: si cualquier comprobante con renglones queda sin líneas o fuera de ±0,02, la migración **FALLA** con el detalle (`BACKFILL_VAT_IDENTITY_FAIL: <id> [PV-Nro]: Δneto=... Δiva=... lineas=...`) y no deja estado intermedio (transacción única). Es imposible aplicar 0072 con un backfill que no cierre.

## §6 — Idempotencia y replay
`ON CONFLICT DO NOTHING`: re-aplicar 0072 no duplica líneas; comprobantes emitidos por la RPC después del backfill ya traen su detalle (UNIQUE invoice+alícuota lo garantiza).

# ERP_B1_IMPLEMENTATION_REVIEW

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fase:** ERP-B1 · Fundación de Datos AP — Implementación
**Fecha:** 2026-06-07
**Base de diseño:** `docs/handoff/ERP_B1_ARCHITECTURE_DESIGN.md` (aprobado, READY)
**Naturaleza:** Se escribieron 4 migraciones nuevas. **No se modificó producción** (las migraciones se aplican manualmente, igual que 0052-0055). No se tocó ERP-A. No se implementó OCR avanzado, ni Libro IVA UI, ni Analytics.

**Estado de ejecución (honesto):** las 4 migraciones están **escritas y revisadas estáticamente** (dollar-quoting balanceado, parity de grants, cross-refs verificadas, alineación a convenciones 0009/0011/0052/0053/0054). **NO han sido ejecutadas todavía contra PostgreSQL.** El único paso pendiente para cerrar B1 es aplicarlas + smoke-test en `arsksytgdnzukbmfgkju` (script al final).

---

## 1 · MIGRACIONES

| Archivo | Gate | Contenido | Naturaleza |
|---|---|---|---|
| `supabase/migrations/0056_ap_fiscal_detail.sql` | B1-G1 | Detalle fiscal: enum `ap_other_tax_t`, columnas cabecera (`importe_no_gravado/exento/tributos`), tablas `supplier_invoice_vat_lines`, `supplier_invoice_other_taxes`, `supplier_invoice_items`, guard `ap.via_rpc`, RLS. **+ ADD VALUE `permission_module_t='cuentas_pagar'` (aislado).** | Aditiva |
| `supabase/migrations/0057_ap_workflow_permissions.sql` | B1-G2 | Enum `ap_approval_status_t`, columna `approval_status` + migración de datos, `supplier_invoice_audit` (append-only), seed RBAC `cuentas_pagar.*` + mapeo a roles. | Aditiva |
| `supabase/migrations/0058_ap_rpcs.sql` | B1-G3 | RPCs: `ap_create_supplier_invoice` (reconciliación + validación dura), `ap__transition` (interno), `ap_submit_for_review`, `ap_approve`, `ap_reopen`, `ap_void`. | Aditiva |
| `supabase/migrations/0059_iva_compras_views.sql` | B1-G4 | Vistas `security_invoker`: `supplier_invoice_fiscal`, `libro_iva_compras`, `supplier_ap_status`. | Aditiva, solo lectura |

**Orden de aplicación OBLIGATORIO (hazard de enum):** aplicar y **COMMITEAR 0056 antes de 0057**. Postgres prohíbe usar un valor nuevo de enum (`permission_module_t='cuentas_pagar'`) en la misma transacción del `ALTER TYPE ADD VALUE`. Mismo patrón probado en 0052→0053. Luego 0058, luego 0059.

**Convenciones honradas (con cita):** RPC-First + `set_config('ap.via_rpc','on')` (espejo `0054:166`), guard de detalle vía RPC (espejo `guard_allocation_insert` `0053:86`), append-only con `tg_forbid_delete_financial` (`0053:77`), `has_permission` (`0009:164`), seed permisos (`0053:674`), AFIP `alic_iva_id` (`0011:220-221`), `numeric(14,2)` (= `0014:64-67`).

---

## 2 · RPCs

| RPC | Permiso | Función |
|---|---|---|
| `ap_create_supplier_invoice(p_header, p_vat_lines, p_other_taxes, p_items)` | `cuentas_pagar.create` | Alta atómica cabecera+detalle. **Deriva** neto/iva/percepciones/tributos del detalle; calcula total; **valida dura** `total_declarado = total_derivado (±0.02)`; cabecera queda reconciliada por construcción. Devuelve `{invoice_id, public_id, neto, iva, percepciones, tributos, total}`. |
| `ap_submit_for_review(id, note)` | `cuentas_pagar.edit` | `cargada → en_revision` |
| `ap_approve(id, note)` | `cuentas_pagar.sign` | `{cargada,en_revision} → aprobada` |
| `ap_reopen(id, note)` | `cuentas_pagar.sign` | `aprobada → en_revision` |
| `ap_void(id, reason)` | `cuentas_pagar.delete` | `→ anulada`; **bloquea si hay pagos confirmados** (lee `payment_allocations`/`supplier_payments`); espeja `status='anulada'` (compat ERP-A); exige motivo. |
| `ap__transition(...)` | *(interno, revocado de public)* | Helper: lock `FOR UPDATE` + validación de transición + audit. |

Todas: `security definer`, `set search_path=public,pg_temp`, guard `has_permission` fail-closed, audit en `supplier_invoice_audit`.

---

## 3 · VISTAS

| Vista | Deriva | Propósito |
|---|---|---|
| `supplier_invoice_fiscal` | neto_gravado, no_gravado, exento, iva_pagado, percepciones, tributos, **total_derivado** vs total_cabecera | Triple obligatoria por factura, derivada del detalle; permite reconciliar cabecera↔detalle. |
| `libro_iva_compras` | por `(periodo, alic_iva_id, alicuota)`: comprobantes, neto_gravado, **iva_credito_fiscal**, total_gravado | Libro IVA Compras / crédito fiscal por alícuota. Excluye anuladas. |
| `supplier_ap_status` | `approval_status` × `estado_pago` → **estado_operativo** (cargada/revision/aprobada/pendiente_pago/pagada/anulada) | Une las dos dimensiones SIN duplicar verdad. Lee `supplier_open_items` (ERP-A) sin modificarla. |

Las 3 son `security_invoker=true` (respetan RLS) y derivadas (D5: nunca tablas).

---

## 4 · WORKFLOW AP

**Dos dimensiones, nunca mezcladas (resuelve P1):**
- **Aprobación (persistida)** → `supplier_invoices.approval_status`: `cargada → en_revision → aprobada` (+ `anulada`), transicionada solo por RPCs con lock + audit.
- **Pago (derivada)** → `supplier_open_items.estado_pago` (ERP-A, sin cambios): `pendiente/parcial/pagada/vencida`.

**Estados operativos pedidos, derivados en `supplier_ap_status`:**
`cargada`=approval cargada · `revisión`=en_revision · `aprobada`=aprobada+sin pago · `pendiente_pago`=aprobada+saldo>0 · `pagada`=estado_pago pagada · `anulada`=approval anulada.

**Legacy `status` (0014):** DEPRECADO. Se conserva solo para que `supplier_open_items` (que filtra `status<>'anulada'`) siga correcta; `ap_void` lo espeja a `'anulada'`. Documentado en comentarios de columna.

**Migración de datos:** las 4 facturas reales (`status='pendiente'`) → `approval_status='cargada'`. Sin pérdida.

---

## 5 · INTEGRACIÓN TESORERÍA

**ERP-A NO se modifica.** Verificado:
- `supplier_payments`, `payment_allocations`, `tesoreria_register_payment`, `supplier_open_items`: **sin cambios** (cero ALTER/CREATE OR REPLACE sobre ellos en 0056-0059).
- `ap_void` **lee** (no escribe) `payment_allocations`+`supplier_payments` para bloquear anulación de facturas con pagos confirmados.
- La cabecera `total` (que usa `tesoreria_register_payment` para el saldo, `0054:197-208`) sigue siendo la caché canónica reconciliada por `ap_create`. El cálculo de saldo de ERP-A permanece correcto.
- Única escritura deliberada a un objeto compartido: `supplier_invoices.status='anulada'` en `ap_void` (valor de enum existente, requerido para la consistencia de la vista de ERP-A). No altera estructura ni lógica de ERP-A.

---

## 6 · AUDITORÍA ADVERSARIAL

Hallazgos del auto-review (y su resolución):

| # | Riesgo detectado | Resolución / estado |
|---|---|---|
| A1 | `ALTER TYPE ADD VALUE` + uso en misma transacción → error PG | Aislado: ADD VALUE en 0056, uso en 0057. Documentado orden de commit. ✅ |
| A2 | Casts de header con `''` (`punto_venta`, `fecha_emision`, `importe_no_gravado/exento`, `total`) → excepción | Endurecidos con `nullif(...,'')`. ✅ |
| A3 | Cabecera podría divergir del detalle | `ap_create` deriva cabecera del detalle; detalle solo escribible vía RPC (guard `ap.via_rpc`). Divergencia imposible por construcción. ✅ |
| A4 | IVA por línea incoherente con base·alícuota | CHECK `abs(importe_iva − round(base·alic/100,2)) ≤ 0.02` por fila. ✅ |
| A5 | Alícuota inválida | CHECK par AFIP `(alic_iva_id,alicuota) ∈ {(3,0),(4,10.5),(5,21),(6,27),(8,5),(9,2.5)}`. ✅ |
| A6 | Anular factura ya pagada | `ap_void` bloquea si `Σ allocations confirmadas > 0`. ✅ |
| A7 | Borrado destruiría historia de auditoría | `supplier_invoice_audit` con `tg_forbid_delete_financial`; FK `on delete cascade` ⇒ el borrado de una factura con audit queda **bloqueado** (append-only efectivo). Documentado. ✅ (efecto deseado) |
| A8 | RPC interna expuesta | `ap__transition` revocada de `public`; solo invocable por las RPCs definer. ✅ |
| A9 | Doble verdad de estado | Aprobación persistida vs pago derivado; `supplier_ap_status` los combina sin duplicar. ✅ |
| A10 | RLS permitiría escribir detalle salteando reconciliación | Guard `ap.via_rpc` en INSERT/UPDATE de las 3 tablas de detalle bloquea escritura directa aun a roles internos. ✅ |
| **A11** | **SQL no ejecutado contra PG** — riesgo de error en runtime no detectable por review estático | **ABIERTO.** Requiere aplicar + smoke-test en prod (script §8 abajo). Es el único bloqueante para cerrar B1. ⚠️ |

---

## 7 · RIESGOS

### P0 — Bloqueantes
| # | Riesgo | Mitigación |
|---|---|---|
| P0-1 | **Migraciones sin ejecutar** (A11): un error de runtime rompería el apply | Aplicar 0056→0059 en orden, commit entre 0056 y 0057, correr smoke-test §8. Hasta entonces B1 no cierra. |
| P0-2 | Aplicar 0056 y 0057 en una sola transacción → error de enum | Confirmar que el proceso de apply commitea por archivo (como 0052-0055). |

### P1 — Operación/compliance
| # | Riesgo | Mitigación |
|---|---|---|
| P1-1 | Backend/UI aún leen `status` legacy (no `approval_status`) | Fuera de alcance B1 (DB-only). B-backend/UI debe migrar a `approval_status`/`supplier_ap_status`. Hasta entonces la UI no refleja el nuevo workflow (no rompe nada). |
| P1-2 | OCR actual no llena `vat_lines`/`other_taxes` | B3 (OCR avanzado) — fuera de alcance B1. Mientras tanto el alta puede hacerse con 1 vat_line (degradación). |

### P2 — Robustez
| # | Riesgo | Mitigación |
|---|---|---|
| P2-1 | `ap_create` asume `p_vat_lines`/`p_other_taxes` son arrays JSON | Contrato de la RPC; validar tipo en el adaptador server-action (B-backend). |
| P2-2 | Sin tests automatizados | El proyecto no tiene runner; smoke-test SQL §8 cubre el camino crítico. Suite formal en B6. |

### P3 — Incremental
| # | Riesgo | Mitigación |
|---|---|---|
| P3-1 | `numeric(14,2)` (no `15,2` como sugería el diseño) | Decisión deliberada: igualar `supplier_invoices` (0014) y evitar reescritura de columnas existentes. Capacidad ~10^12, suficiente. |
| P3-2 | Edición de detalle requiere RPC de edición (aún no existe) | B-backend agregará `ap_update_supplier_invoice` (mismo patrón). En B1 el alta es inmutable salvo anulación. |

---

## 8 · SMOKE-TEST (post-aplicación, NO modifica prod — usa BEGIN/ROLLBACK)

> Ejecutar en Supabase SQL Editor de `arsksytgdnzukbmfgkju` **después** de aplicar 0056→0059. Todo dentro de una transacción que se revierte: valida comportamiento sin persistir datos.

```sql
begin;
-- usar un vendor real existente
with v as (select id from public.vendors limit 1)
select public.ap_create_supplier_invoice(
  jsonb_build_object('vendor_id',(select id from v),'numero','SMOKE-0001',
                     'tipo_comprobante','FACTURA_A','fecha_emision','2026-06-07',
                     'importe_no_gravado',0,'importe_exento',0),
  '[{"alic_iva_id":5,"alicuota_iva":21,"base_neto":1000,"importe_iva":210},
    {"alic_iva_id":4,"alicuota_iva":10.5,"base_neto":500,"importe_iva":52.5}]'::jsonb,
  '[{"tax_kind":"PERCEPCION_IIBB","jurisdiction":"CABA","base":1500,"alicuota":3,"importe":45}]'::jsonb,
  '[]'::jsonb
) as creado;
-- esperado: neto=1500, iva=262.5, percepciones=45, total=1807.5
select periodo, alic_iva_id, neto_gravado, iva_credito_fiscal from public.libro_iva_compras where periodo='2026-06';
select estado_operativo, approval_status, estado_pago from public.supplier_ap_status where public_id like 'FP-%' order by 1 desc limit 5;
rollback;  -- nada queda persistido
```
**Criterio de PASS:** la RPC devuelve `total=1807.5`; `libro_iva_compras` muestra 2 alícuotas (21 y 10.5); `supplier_ap_status` muestra `estado_operativo='cargada'`. Errores esperados a probar aparte: alícuota inválida → CHECK; total declarado distinto → `TOTAL_MISMATCH`; insert directo en `supplier_invoice_vat_lines` → `AP_DETAIL_VIA_RPC_ONLY`.

---

## VEREDICTO

# ⛔ NOT READY FOR ERP-B2

**Motivo (evidencia, no supuesto):** las 4 migraciones están escritas, son aditivas, están alineadas a las convenciones del proyecto y pasan revisión estática y adversarial — **pero NO han sido ejecutadas contra `arsksytgdnzukbmfgkju`** (riesgo A11/P0-1). El estándar del proyecto (ERP-A se declaró completo solo tras verificación en prod) exige ejecución + smoke-test antes de construir B2 encima.

**Paso único para flipear a READY (estimado: minutos):**
1. Aplicar `0056` y **commitear**; luego `0057`, `0058`, `0059` (en orden) en `arsksytgdnzukbmfgkju`.
2. Correr el smoke-test §8 (BEGIN/ROLLBACK — no persiste).
3. Si PASS → ERP-B1 cerrado → **READY FOR ERP-B2**.

> Restricción cumplida: se escribieron migraciones (no se aplicaron a prod). No se tocó ERP-A. No se implementó OCR avanzado, Libro IVA UI ni Analytics.

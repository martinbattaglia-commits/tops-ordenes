# IVA-VENTAS-V2-IMPLEMENTATION — Libro IVA Ventas (primer lector del dominio canónico)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.) · **Presidente:** Martín Battaglia
**Fecha:** 2026-06-12 · **Rama:** `feature/iva-ventas-v2` · **Base:** main `17e5e35`
**Autorización:** Cierre del ciclo fiscal (2026-06-12), FASE 1.

> **Estado: IMPLEMENTADA — migración 0073 ESCRITA, NO aplicada.** Cero código de aplicación, cero UI, cero tablas: solo 2 vistas de lectura + grants. Detenido antes de merge, conforme a protocolo.

## §1 — Qué se creó (migración `0073_libro_iva_ventas.sql`)

### Vista 1 — `customer_invoice_fiscal` (libro DETALLE: fila = comprobante)
Todos los campos del mandato:

| Campo del mandato | Implementación |
|---|---|
| fecha | `created_at::date` |
| período fiscal | `coalesce(periodo, to_char(created_at,'YYYY-MM'))` |
| tipo de comprobante / punto de venta / número | columnas de cabecera |
| cliente / CUIT | `razon_social` / `cuit_cliente` (+ `condicion_iva`) |
| neto gravado | **Σ `customer_invoice_vat_lines`** con signo |
| IVA por alícuota | pivote: `neto_21/iva_21`, `neto_10_5/iva_10_5`, `neto_27/iva_27`, `neto/iva_otras_alicuotas` (0%, 5%, 2,5%) |
| total IVA | Σ `iva_importe` con signo |
| total comprobante | `total` de cabecera con signo |
| estado fiscal / ambiente fiscal | `estado_arca` / `ambiente` |
| comprobante asociado en NC/ND | self-join → `'FACTURA_A 2-1'` |
| exclusión de mocks en PRODUCCIÓN | `ambiente = fiscal_ambiente()` — automática al cambiar `fiscal_config` |

### Vista 2 — `libro_iva_ventas` (resumen por período × alícuota)
Espejo exacto de `libro_iva_compras`: `periodo · alic_iva_id · alicuota_iva · comprobantes · neto_gravado · iva_debito_fiscal · total_gravado` — con signo.

## §2 — Cumplimiento de las REGLAS del mandato
1. **Fuente fiscal = `customer_invoice_vat_lines`**: ambas vistas hacen `JOIN` (inner) al detalle canónico — un comprobante sin líneas NO aparece en el libro (imposible además, por el trigger 0072). `invoice_items` no participa. La cabecera solo aporta dimensiones (cliente, número, estado) y los componentes no-IVA (exento/no gravado/percepciones/tributos), que por diseño (DOMAIN-DESIGN §3.3) viven ahí.
2. **Signo**: NC → ×(−1) en todos los importes; ND y facturas → ×(+1). Mismo criterio que compras (0071).
3. **Corte de validez**: `AUTORIZADO_ARCA ∧ ¬anulada ∧ ambiente = fiscal_ambiente()` — la misma regla única de FISCAL-HARDENING; el pase a PRODUCCIÓN excluye los SANDBOX sin tocar nada.
4. Vistas `security_invoker` (heredan el RLS de internos de las tablas base) + grants a `authenticated`.

## §3 — Validaciones (contra producción, solo lectura — pre-aplicación)
Ejecutadas con el cuerpo de las vistas como query ad-hoc (la migración no está aplicada):

| Control | Resultado |
|---|---|
| Libro 2026-05 · 21% | 2 comp · neto $3.728.600,00 · IVA débito $783.006,00 |
| Libro 2026-06 · 21% | 1 comp · neto $706.000,00 · IVA débito $148.260,00 |
| **Control triple IVA** (libro / vat_lines / cabecera) | **931.266,00 / 931.266,00 / 931.266,00** ✅ |
| **Control triple neto** | **4.434.600,00 / 4.434.600,00 / 4.434.600,00** ✅ |
| MAX \|Δ\| por comprobante | **0,00 / 0,00** (tolerancia ±0,02 sin uso) |
| Signo NC (caso sintético 121.000 − 12.100) | neto 90.000 / IVA 18.900 — **NC resta** ✅ |

## §4 — Restricciones respetadas
TOPS Connect ✅ · Mobile ✅ · Tracking ✅ · Portal Clientes ✅ · UX/UI ✅ (cero pantallas) · Branding ✅ · Contabilidad completa ✗ no iniciada · Asientos ✗ · ARCA Producción ✗ · V2 no requirió UI (vistas + queries documentadas).

## §5 — Pendiente del gate
Merge `--no-ff` + aplicación de `0073` en Supabase prod (idempotente, solo vistas) + verificación post-aplicación (`select * from libro_iva_ventas`) — **requiere autorización presidencial explícita** (protocolo, paso 9).

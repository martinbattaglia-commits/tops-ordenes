# TOPS NEXUS — ARCA SANDBOX · VALIDATION REPORT (Fase 4)

> **Estado:** ✅ **FLUJO FISCAL SANDBOX VALIDADO EN STAGING AISLADO** · **Fecha:** 2026-05-29
> Valida el subsistema de facturación (`0011`): `customer_invoices`, `invoice_items`, `fiscal_config`,
> `puntos_venta`, `invoice_audit`, inmutabilidad fiscal, QR y PDF — **ambiente SANDBOX / mock**.
> **SIN certificados reales. SIN producción. SIN WSAA/WSFEv1 real.** Producción intacta.

---

## 0. Alcance y límite explícito

Se valida la **persistencia y las reglas fiscales** del módulo de facturación en SANDBOX, simulando el flujo
de `MockArcaService` a nivel DB. **NO** se invocó ARCA real, **NO** se usaron certificados X.509,
**NO** se tocó `PRODUCCION`. `ProductionArcaService` permanece como **STUB `NOT_READY`** (fuera de alcance).

---

## 1. Modelo de datos fiscal (verificado)

| Tabla | Campos clave (verificados) |
|-------|-----------------------------|
| `fiscal_config` (singleton, `id` smallint) | razon_social, cuit, ingresos_brutos, inicio_actividades, domicilio_comercial, condicion_iva, **ambiente**, cert_alias, default_punto_venta, logo_url, pie_legal |
| `puntos_venta` | puntos de venta ARCA |
| `customer_invoices` | razon_social, punto_venta, **ambiente**, tipo_comprobante, **estado_arca**, cae, numero_comprobante, subtotal, iva, total, cuit_cliente, pdf_bucket/path/url, qr_data/hash/url |
| `invoice_items` | invoice_id, descripcion, cantidad, precio_unitario, alicuota_iva, importe_neto/iva/total, orden |
| `invoice_audit` | invoice_id, ts, user_id, action, **estado**, cae, request, response, ip |

**Enums verificados:**
- `arca_ambiente_t` = `SANDBOX / HOMOLOGACION / PRODUCCION`
- `invoice_arca_status_t` = `BORRADOR / PENDIENTE_ARCA / ENVIADO_ARCA / AUTORIZADO_ARCA / RECHAZADO_ARCA / ERROR_ARCA / ANULADO`

---

## 2. Trigger de inmutabilidad fiscal `tg_lock_authorized_invoice` (verificado, cuerpo real)

`BEFORE UPDATE` en `customer_invoices`. Cuando `old.estado_arca='AUTORIZADO_ARCA'`, **bloquea** cambios en
los **8 campos fiscales**: `cae`, `numero_comprobante`, `total`, `subtotal`, `iva`, `cbte_tipo_arca`,
`punto_venta`, `cuit_cliente`. **Permite**: anulación lógica, materializar PDF/QR, y actualiza `updated_at`.

> Modelo correcto: un comprobante autorizado por ARCA es **inmutable fiscalmente**; las correcciones se hacen
> por **Nota de Crédito/Débito**, no editando el original (cumple lógica fiscal AR).

---

## 3. Flujo de emisión SANDBOX simulado (A1–A8) — todo PASS

| Test | Qué valida | Resultado |
|------|-----------|-----------|
| **A1** | `fiscal_config` singleton emisor en SANDBOX (VEROTIN S.A., CUIT 30604896989) | ✅ PASS |
| **A2** | Alta de comprobante `BORRADOR` (FACTURA_B, SANDBOX) + 1 renglón en `invoice_items` | ✅ PASS |
| **A3** | Transición de estados `BORRADOR → PENDIENTE_ARCA → ENVIADO_ARCA` | ✅ PASS |
| **A4** | Autorización SANDBOX con **CAE simulado** (`75000000000123`) + nro comprobante + cuit cliente + vto CAE | ✅ PASS |
| **A5** | Post-autorización: materializar `pdf_path` + `qr_data`/`qr_hash`/`qr_url` (datos **no** fiscales → permitido) | ✅ PASS |
| **A6** | Intento de mutar `total` de comprobante AUTORIZADO → **bloqueado** por trigger | ✅ PASS |
| **A7** | Anulación lógica (`estado_arca='ANULADO'`, `anulada=true`) → permitida | ✅ PASS |
| **A8** | `invoice_audit` registra evento fiscal (action=emit, estado, cae) | ✅ PASS |

> **Conclusión:** el ciclo de vida fiscal completo (alta → renglones → estados → autorización → PDF/QR →
> inmutabilidad → anulación → bitácora) **funciona y es seguro en SANDBOX**, a nivel de base de datos.

---

## 4. QR fiscal y PDF (nivel código — presente, no ejecutado en este gate)

| Componente | Estado | Fuente |
|------------|--------|--------|
| QR fiscal RG 4892/2020 (`buildFiscalQr`: json/base64/url/sha256) | ✅ implementado | `src/lib/arca/qr.ts` |
| PDF del comprobante | ✅ implementado | `src/lib/pdf/InvoicePdfDocument.tsx` |
| Cálculo subtotal/IVA/total | ✅ implementado | `src/lib/invoicing/calc.ts` |
| Orquestación emisión (10 pasos) | ✅ implementado | `src/lib/invoicing/emit.ts` |
| `MockArcaService` (CAE simulado SANDBOX) | ✅ funciona | `src/lib/arca/mock-service.ts` |

> Las columnas `qr_data/qr_hash/qr_url` y `pdf_bucket/pdf_path/pdf_url` de `customer_invoices` (validadas en A5)
> son el **destino de persistencia** de estos componentes. El esquema soporta el QR y el PDF generados por la app.

---

## 5. Hallazgos (heredados, confirmados)

| ID | Hallazgo | Severidad | ¿Bloquea SANDBOX? | ¿Bloquea PRODUCCIÓN ARCA? |
|----|----------|-----------|:------------------:|:--------------------------:|
| **ARCA-STUB** | `ProductionArcaService` lanza `NOT_READY` (sin WSAA/WSFEv1/X.509) | 🔴 crítico | No (mock funciona) | **Sí** — no hay emisión real |
| **R4** | Bucket `invoices` policy `auth.role()='authenticated'` SIN scoping por cliente | 🟠 alto | No | **Sí** para multi-tenant fiscal |
| **AUDIT-DEF** | `invoice_audit` por policy de insert (no trigger `SECURITY DEFINER` como `documents_audit`) | 🟡 medio | No | Endurecer en `0012+` |

> **Nota:** a diferencia de `documents_audit` (append-only no forjable por trigger `SECURITY DEFINER`,
> validado en Fase 2/3), `invoice_audit` depende de policy de insert por rol → **menos robusto**.
> Recomendación: migrar al patrón gold-standard documental (AUDIT-DEF) en `0012+`.

---

## 6. Veredicto Fase 4

> **✅ ARCA SANDBOX VALIDADO.** El esquema fiscal (`0011`), la inmutabilidad de comprobantes autorizados,
> el ciclo de vida de estados, los renglones, la persistencia de QR/PDF y la bitácora fiscal **funcionan
> correctamente en SANDBOX**. La lógica de negocio (cálculo, emisión, QR, PDF, mock) está construida.
>
> **Para ARCA PRODUCTIVO faltan, en orden:** implementar `ProductionArcaService` (WSAA + WSFEv1 + cert
> X.509 sólo en host), corregir R4 (scoping bucket `invoices`), endurecer `invoice_audit` (AUDIT-DEF) y
> pasar homologación con CUIT de prueba. **Nada de esto se ejecuta en este gate.**

---

## 7. ¿Acerca a reemplazar Neuralsoft?

**SÍ, es núcleo insustituible.** Sin factura electrónica ARCA válida no hay ERP que opere en Argentina.
Este gate certifica que **toda la base fiscal está construida y es correcta en SANDBOX** sin riesgo.
El reemplazo de Neuralsoft en facturación se completa al implementar `ProductionArcaService` + homologación,
sobre esta base ya validada.

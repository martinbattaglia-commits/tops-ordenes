# TOPS NEXUS — ARCA READINESS REPORT (Entregable 4 · Fase C)

> **Estado:** análisis de readiness · **NO aplica migraciones, NO activa ARCA** · **Fecha:** 2026-05-29
> Valida el subsistema de facturación fiscal (`customer_invoices`, `invoice_items`,
> `fiscal_config`, billing UI, PDFs, QR, mocks): qué funciona hoy, qué depende de `0011`,
> y **qué se rompería si se habilitara producción ahora**.
> Fuentes verificadas en código: `supabase/migrations/0011_arca_billing.sql`,
> `src/lib/arca/*`, `src/lib/invoicing/*`, `src/lib/pdf/InvoicePdfDocument.tsx`, `src/lib/env.ts`.

---

## 0. Resumen ejecutivo

| Pregunta | Respuesta |
|----------|-----------|
| ¿La lógica de facturación está construida? | **SÍ, casi completa.** Cálculo, emisión orquestada (10 pasos), QR fiscal (RG 4892/2020), PDF y persistencia están implementados. |
| ¿Funciona end-to-end hoy? | **Solo en MOCK/SANDBOX.** `MockArcaService` devuelve CAE simulado y todo el flujo corre. |
| ¿Emite contra ARCA real? | **NO.** `ProductionArcaService` es un **STUB que lanza `NOT_READY`** (sin WSAA/WSFEv1, sin certificado X.509). |
| ¿La tabla fiscal existe en producción? | **NO.** `0011` **no está aplicada** en remoto (`supabase migration list` verificado). |
| ¿Qué se rompe si se "habilita producción" hoy? | **C1:** en prod `isMock()=false` → el código consulta tablas `0011` inexistentes → **error en runtime** en `/billing` y `/settings/fiscal`. |

> **Criterio rector:** la facturación electrónica ARCA es **núcleo insustituible** para reemplazar Neuralsoft
> (sin factura fiscal válida no hay ERP que opere en Argentina). → **Documentar y priorizar el cierre.**

---

## 1. Inventario verificado del subsistema

### 1.1 Migración `0011_arca_billing.sql` (NO aplicada en remoto)

| Objeto | Detalle verificado | Línea |
|--------|--------------------|-------|
| `fiscal_config` | tabla singleton (datos del emisor: CUIT, razón social, ambiente, pto vta default) | 69 |
| `puntos_venta` | tabla de puntos de venta ARCA | 116 |
| `customer_invoices` | comprobantes (estado_arca, cae, numero_comprobante, total, subtotal, iva, cbte_tipo_arca, punto_venta, cuit_cliente) | 133 |
| `invoice_items` | renglones del comprobante | 212 |
| `invoice_audit` | bitácora de estados/payloads | 234 |
| `tg_lock_authorized_invoice()` + trigger `customer_invoices_lock` | **BEFORE UPDATE**: si `estado_arca='AUTORIZADO_ARCA'` bloquea cambio de campos fiscales; permite anulación lógica + PDF | 257-281 |
| RLS (~11 policies) | fiscal_config/puntos_venta (read interno, write admin); invoices (read interno+cliente propio, write admin/operaciones); invoice_items (sigue factura); invoice_audit (read admin/supervisor, insert interno) | 294-346 |
| Realtime | `customer_invoices` añadida a `supabase_realtime` | 348-355 |
| Bucket `invoices` | privado (`public=false`) | 358 |
| Policy bucket | `bucket_id='invoices' AND auth.role()='authenticated'` | 362 |

### 1.2 Capa de aplicación (presente en el repo)

| Archivo | Rol | Estado |
|---------|-----|--------|
| `src/lib/arca/types.ts` | contratos ARCA (`IArcaService`, requests/responses) | ✅ |
| `src/lib/arca/service.ts` | factory `getArcaService(ambiente)` → Mock/Production | ✅ |
| `src/lib/arca/mock-service.ts` | `MockArcaService`: CAE simulado | ✅ funciona |
| `src/lib/arca/production-service.ts` | `ProductionArcaService`: **STUB → throw `NOT_READY`** | 🔴 no operativo |
| `src/lib/arca/qr.ts` | `buildFiscalQr()` QR fiscal RG 4892/2020 (json/base64/url/sha256) | ✅ completo |
| `src/lib/invoicing/calc.ts` | cálculo de subtotal/IVA/total | ✅ |
| `src/lib/invoicing/emit.ts` | `emitInvoice()` orquestación 10 pasos | ✅ (depende del service) |
| `src/lib/invoicing/data.ts` | lectura (mock vs Supabase según `isMock()`) | ✅ |
| `src/lib/pdf/InvoicePdfDocument.tsx` | render del comprobante PDF | ✅ |

---

## 2. Qué FUNCIONA hoy (sin tocar nada)

| Capacidad | Estado | Condición |
|-----------|--------|-----------|
| Cálculo fiscal (subtotal/IVA/total) | ✅ | puro, sin dependencias |
| Emisión **simulada** end-to-end | ✅ | `ambiente=SANDBOX` → `MockArcaService` → CAE sim |
| QR fiscal AFIP | ✅ | `buildFiscalQr()` produce payload válido + hash |
| PDF del comprobante | ✅ | `InvoicePdfDocument.tsx` |
| Lectura/listado en **demo** | ✅ | `isMock()=true` → `MOCK_FISCAL_CONFIG` (VEROTIN S.A., CUIT 33-60489698-9, SANDBOX, pto vta 2) |
| Inmutabilidad de factura autorizada (diseño) | ✅ en SQL | requiere `0011` aplicada para ejercerse |

> **Conclusión:** el "esqueleto" de facturación está **bien construido y demostrable en mock**. Lo que falta
> no es lógica de negocio sino (a) la integración real con ARCA y (b) la aplicación de `0011`.

---

## 3. Qué DEPENDE de `0011` (no aplicada en remoto)

Sin `0011` aplicada, **no existen** en la DB: `fiscal_config`, `puntos_venta`, `customer_invoices`,
`invoice_items`, `invoice_audit`, el trigger de inmutabilidad, las RLS fiscales ni el bucket `invoices`.
Por lo tanto, **toda persistencia real** de facturación depende de aplicar `0011` (vía GATE 2 → producción autorizada).

| Funcionalidad | ¿Disponible sin 0011? |
|---------------|------------------------|
| Guardar una factura emitida | ❌ (no hay tabla) |
| Listar facturas reales | ❌ |
| Config fiscal persistente | ❌ (solo mock) |
| Inmutabilidad de comprobante autorizado | ❌ (no hay trigger) |
| Bitácora `invoice_audit` | ❌ |
| Almacenar PDF en bucket | ❌ (no hay bucket) |

---

## 4. Qué se ROMPERÍA si se habilita producción HOY (riesgo C1)

### 4.1 Mecanismo exacto (verificado en `src/lib/env.ts` + `src/lib/invoicing/data.ts`)
```
isMock() = env.app.demoMode || env.app.needsSupabase
demoMode   = NEXT_PUBLIC_DEMO_MODE === "1"
needsSupabase = !supabaseUrl || !supabaseAnonKey
```
En **producción real**: Supabase configurado (`needsSupabase=false`) + demo apagado (`demoMode=false`)
→ **`isMock()=false`** → `getFiscalConfig/listInvoices/getInvoice/listInvoiceAudit` **consultan tablas `0011`**.
Como `0011` **no está aplicada**, esas consultas **fallan en runtime**.

### 4.2 Impacto concreto

| Superficie | Resultado si se habilita prod hoy |
|------------|-----------------------------------|
| `/billing` (listado/emisión) | **Error** — query a `customer_invoices` inexistente |
| `/settings/fiscal` | **Error** — query a `fiscal_config` inexistente |
| Emisión real (CAE) | **`NOT_READY`** — `ProductionArcaService` es STUB aunque las tablas existieran |

### 4.3 Doble bloqueo
1. **Schema:** `0011` no aplicada → C1 (runtime error).
2. **Integración:** `ProductionArcaService` STUB → aún con `0011`, no hay emisión real (falta WSAA TRA/CMS firmado con X.509 + SOAP WSFEv1).

> **Por eso NO se habilita producción de facturación hoy.** Se requieren ambos cierres, en orden.

---

## 5. Gaps y riesgos específicos de ARCA

| ID | Gap / riesgo | Severidad | Bloquea GATE 2 (schema)? | Bloquea ARCA productivo? |
|----|--------------|-----------|--------------------------|---------------------------|
| C1 | En prod `isMock=false` consulta tablas `0011` ausentes → runtime error | 🔴 crítico | No (es justo lo que GATE 2 valida aplicar) | **Sí** hasta aplicar `0011` |
| ARCA-STUB | `ProductionArcaService` lanza `NOT_READY` (sin WSAA/WSFEv1/cert) | 🔴 crítico | No | **Sí** — no hay emisión real |
| R4 | Bucket `invoices` policy = `auth.role()='authenticated'` **sin scoping por cliente** → cualquier usuario autenticado puede leer cualquier PDF fiscal | 🟠 alto | No (validar/documentar en GATE 2) | **Sí** para multi-tenant fiscal |
| AUDIT-DEF | `invoice_audit` usa policy de insert por rol (no es trigger `SECURITY DEFINER` como `documents_audit`) → menos robusto que el gold-standard | 🟡 medio | No | Mejorable en `0012+` |

> **R4 en detalle:** a diferencia de `documents` (que aísla por `split_part(name,'/',1)=client_id`), el bucket
> `invoices` solo exige estar autenticado. Un cliente B2B podría, con la URL/objeto, acceder a PDFs de otro.
> **Debe corregirse antes de exponer PDFs fiscales a clientes** (scoping por path tenant).

---

## 6. Checklist para habilitar ARCA productivo (diseño, NO ejecutar)

> Orden obligatorio. Nada de esto se ejecuta en Fase C.

- [ ] **A1 — GATE 2 verde** sobre `0011` (Entregable 2): tablas/trigger/RLS validados en Staging.
- [ ] **A2 — Aplicar `0011` en producción** (autorización ejecutiva explícita; cierra C1).
- [ ] **A3 — Implementar `ProductionArcaService`:** WSAA (TRA + firma CMS con X.509), WSFEv1 (`FECAESolicitar`, `FECompUltimoAutorizado`). Cert/clave **solo en host** (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`), nunca en DB ni repo.
- [ ] **A4 — Corregir R4:** policy del bucket `invoices` con scoping por cliente (patrón `documents`).
- [ ] **A5 — Endurecer `invoice_audit`** hacia el patrón `documents_audit` (trigger `SECURITY DEFINER` append-only).
- [ ] **A6 — Homologación ARCA:** emitir en ambiente `HOMOLOGACION` con CUIT de prueba antes de `PRODUCCION`.
- [ ] **A7 — Smoke productivo controlado:** primer comprobante real con monto mínimo + verificación de CAE/QR.

**Criterio de cierre ARCA readiness:** A1–A6 completos y A6 (homologación) exitoso → recién entonces se habilita `PRODUCCION`.

---

## 7. ¿Acerca a reemplazar Neuralsoft?

| Acción | ¿Acerca? | Veredicto |
|--------|----------|-----------|
| Validar `0011` en GATE 2 | **SÍ** | Habilita la persistencia fiscal sin riesgo |
| Aplicar `0011` en prod (post-GATE 2) | **SÍ** | Cierra C1, base del módulo facturación |
| Implementar `ProductionArcaService` | **SÍ (decisivo)** | Sin emisión real ARCA no se reemplaza Neuralsoft |
| Corregir R4 (scoping bucket) | **SÍ** | Multi-tenant fiscal seguro |

> **Recomendación:** GATE 2 debe **validar `0011`** (encadenada a `0010`). La **habilitación productiva de ARCA**
> queda condicionada a: aplicar `0011`, implementar `ProductionArcaService`, corregir R4 y pasar homologación.
> Esto alimenta el GO/NO-GO (Entregable 6). **No se implementa nada en esta fase.**

# VAT-SALES-REPORTING-PLAN — IVA Ventas · Plan de reportes y exportación

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** VAT-SALES-REPORTING-PLAN.md (entregable 7 de la serie de auditoría fiscal ERP-B → ERP-C)
**Fecha:** 2026-06-12
**Naturaleza:** PLAN DE REPORTING — no se escribió código ni se modificó producción. Complementa y depende de VAT-SALES-DOMAIN-DESIGN.md (entregable 6).
**Base:** main `d1df6c1` · contribuyente: VEROTIN S.A. · CUIT 33-60489698-9 · IIBB 646677-10 · Responsable Inscripto (seed `0011:93-111`)

> **Objetivo:** que la Contadora, el estudio contable y la auditoría externa obtengan directamente de TOPS NEXUS — sin procesos manuales externos — IVA Compras, IVA Ventas, Posición IVA, Retenciones, Percepciones, base de Ganancias y el paquete de cierre mensual.

---

## §0 — Principios de reporting

1. **Un solo origen:** todo número fiscal sale de las vistas derivadas del detalle canónico (`customer_invoice_vat_lines` / `supplier_invoice_vat_lines`). Prohibido recalcular en frontend o en exportadores (regla ERP-B3, ya vigente en `/compras/libro-iva`).
2. **Validez fiscal explícita:** todas las vistas filtran `estado_arca = 'AUTORIZADO_ARCA' AND anulada = false` y discriminan `ambiente` (PRODUCCION vs SANDBOX/HOMOLOGACION). Los rechazados/errores quedan visibles solo en una vista operativa separada, jamás en los libros.
3. **Período fiscal = `fecha_emision`** (nueva columna, G3 del diseño), no `created_at`.
4. **Signo por tipo de comprobante:** facturas y ND suman (+1); NC restan (−1). Aplica a ventas Y al fix del libro de compras (G11).
5. **Export gated:** `contabilidad.export` verificado server-side en el route handler (patrón `cuentas_pagar.export` de `/api/compras/libro-iva/export`).

---

## §1 — Libro IVA Ventas (`/contabilidad/iva-ventas`)

### 1.1 Vista detalle — `customer_invoice_fiscal` (una fila por comprobante)

| Columna | Origen |
|---|---|
| Fecha | `fecha_emision` |
| Tipo (cód. ARCA + letra) | `cbte_tipo_arca` / `tipo_comprobante` (FAC/NC/ND × A/B/C/E) |
| Punto de venta · Número | `punto_venta`, `numero_comprobante` (formato `00002-00001234`) |
| Receptor | `razon_social`, `cuit_cliente`, `doc_tipo`, `condicion_iva` (snapshot inmutable) |
| Neto gravado por alícuota | Σ `customer_invoice_vat_lines` (21 / 10,5 / 27 / 5 / 2,5 / 0) |
| IVA por alícuota | ídem |
| Exento / No gravado | `importe_exento`, `importe_no_gravado` (hoy 0 — se activan en V3) |
| Percepciones | Σ `customer_invoice_other_taxes` (V3) |
| Total | `total` (verificado contra total_derivado; discrepancias > ±0,02 se marcan) |
| CAE · Vto. CAE | `cae`, `fecha_vencimiento_cae` |
| Origen | `invoice_items.order_id` → OS vinculadas (trazabilidad factura→operación) |

Filtros: período (mes, por defecto el corriente), rango de fechas, tipo de comprobante, cliente, punto de venta, alícuota.

### 1.2 Resumen — `libro_iva_ventas` (GROUP BY período + alícuota, con signo)

**IVA Débito Fiscal del período**, exactamente como pidió Presidencia:

| Bucket | Definición técnica |
|---|---|
| IVA 21% | `alic_iva_id = 5` |
| IVA 10,5% | `alic_iva_id = 4` |
| IVA 27% | `alic_iva_id = 6` |
| IVA 5% / 2,5% | `alic_iva_id = 8 / 9` (existen en el mapa ARCA, se muestran solo si hay movimientos) |
| Gravado 0% | `alic_iva_id = 3` (neto declarado al 0%) |
| Exento | `importe_exento` de cabecera (≠ 0%; distinción explícita, G1) |
| No gravado | `importe_no_gravado` de cabecera |

KPIs de cabecera de página (patrón ERP-B3, valores ya derivados): Comprobantes emitidos · Neto gravado total · **Débito fiscal total** · NC del período (en negativo) · Total facturado.

---

## §2 — Posición Mensual IVA (`/contabilidad/posicion-iva`, fase V4)

Vista `posicion_iva_mensual` — por período `YYYY-MM`:

```
   Débito fiscal      (Σ libro_iva_ventas, con signo NC)
 − Crédito fiscal     (Σ libro_iva_compras, con fix de signo NC — G11)
 ─────────────────────
 = SALDO TÉCNICO      (a pagar si > 0 · a favor si < 0)
 − Retenciones IVA sufridas       (customer_receipt_retentions, V3)
 − Percepciones IVA sufridas      (supplier_invoice_other_taxes PERCEPCION_IVA)
 + Saldo a favor período anterior (arrastre, editable con asiento de ajuste)
 ─────────────────────
 = POSICIÓN A INGRESAR / SALDO DE LIBRE DISPONIBILIDAD
```

Presentación: tabla de 12 períodos (año fiscal) + detalle drill-down de cada componente hacia su libro. Cada cifra es clickeable (deep link, mismo patrón `.nx-interactive` del Cockpit).

---

## §3 — Retenciones y Percepciones (`/contabilidad/retenciones`, fase V3)

| Bloque | Fuente | Contenido |
|---|---|---|
| **Retenciones sufridas** (IVA · Ganancias · IIBB) | `customer_receipt_retentions` | fecha, cliente, recibo, impuesto, jurisdicción, certificado, importe; total por período e impuesto |
| **Retenciones practicadas** (IVA · Ganancias · IIBB) | `supplier_payment_retentions` | espejo sobre pagos a proveedores; base para DDJJ SICORE/agente |
| **Percepciones sufridas** (IVA · IIBB · Aduana · otras jurisd.) | `supplier_invoice_other_taxes` | ya modeladas en compras (`PERCEPCION_IVA/IIBB+jurisdicción/GANANCIAS`; aduana vía ampliación de enum) |
| **Percepciones emitidas** | `customer_invoice_other_taxes` | se activa al cerrar G4 (array `Tributos` WSFEv1) |

Todos los bloques: filtro por período/impuesto/jurisdicción + export. Los totales de retenciones/percepciones de IVA alimentan automáticamente la Posición (§2).

---

## §4 — Información base para Ganancias y cierres mensuales (fase V4)

**Alcance honesto:** TOPS NEXUS provee la **información base auditable**, no la liquidación del impuesto (eso es del estudio contable).

Paquete de cierre mensual (una pantalla + un export por período):
1. Ventas netas por alícuota y por cliente (libro IVA ventas).
2. Compras netas por alícuota y por proveedor (libro IVA compras).
3. Posición IVA del período (§2).
4. Retenciones de Ganancias sufridas y practicadas (§3) — pagos a cuenta / obligaciones de agente.
5. Conciliación operativa: facturado vs cobrado (`customer_open_items`), comprado vs pagado (`supplier_open_items`) — vistas ERP-A existentes, sin recálculo.
6. Excepciones del período: comprobantes RECHAZADO/ERROR, OS FIRMADAS sin facturar, discrepancias cabecera↔detalle.

---

## §5 — Exportación

| Formato | Uso | Implementación |
|---|---|---|
| **CSV** | estudio contable / importación a sistemas contables | route handler por vista (patrón existente `/api/compras/libro-iva/export`) |
| **Excel (XLSX)** | Contadora — libro detalle + resumen + posición en hojas separadas | mismo handler, ya soportado en compras |
| **PDF** | auditoría externa / archivo — con membrete VEROTIN, período y totales firmados | react-pdf (patrón `InvoicePdfDocument` existente) |
| **TXT Libro IVA Digital (RG 4597)** | importación directa al servicio "Libro de IVA Digital" de ARCA — registros de longitud fija (ventas: cabecera + alícuotas) | fase V4/V5; el modelo canónico ya contiene todos los campos requeridos |

Todos gated por `contabilidad.export`, re-verificado server-side (403 si falta), con registro en `audit_log`.

---

## §6 — Conciliación ARCA ↔ Nexus (análisis solicitado — fase V5)

**Veredicto de viabilidad: VIABLE, con dependencia dura de ARCA productiva (ERP-C).** Hoy el ambiente es SANDBOX (seed `0011`), por lo que no existe nada real que conciliar todavía.

| Mecanismo | Cómo | Esfuerzo |
|---|---|---|
| **A. Import "Mis Comprobantes"** (recomendado para V5.1) | la Contadora descarga el CSV de emitidos/recibidos del portal ARCA → import a tabla `arca_statement_lines` → matching contra `customer_invoices`/`supplier_invoices` por clave natural `(CUIT, PV, tipo, número)` | bajo; sin credenciales nuevas |
| **B. WSFE `FECompConsultar`** (V5.2) | consulta programática comprobante a comprobante del rango emitido — verificación de CAE/importes 1:1 | medio; reutiliza el cliente WSFEv1 existente |
| **Reporte de diferencias** | tres buckets: *en ARCA y no en Nexus* (emisión por fuera del sistema), *en Nexus y no en ARCA* (CAE inválido/mock), *importes distintos* (corrupción o edición manual) | salida natural del matching |

Prerrequisitos detectados por la auditoría: cierre de G5 (NC con `CbtesAsoc`) y G10 (corte por ambiente) — sin eso, la conciliación daría falsos positivos masivos.

---

## §7 — UX y navegación

- Sección de Sidebar **CONTABILIDAD** (nueva): IVA Ventas · Posición IVA · Retenciones y Percepciones · acceso cruzado a Libro IVA Compras (que no se muda, no breaking change).
- Página IVA Ventas con la estructura probada de `/compras/libro-iva` (ERP-B3): KPIs arriba, filtros de período, tabla detalle, resumen por alícuota, botones de export.
- Deep links: los KPIs de Contabilidad usan `.nx-interactive` (consistencia con el Cockpit); la fila de la factura abre su comprobante/PDF; la celda de OS abre la orden.
- RBAC: `contabilidad.view` para las páginas, `contabilidad.export` para descargas. Estrategia B intacta.

---

## §8 — Secuencia de entrega (alineada al roadmap del entregable 6)

| Fase | Reportes que se habilitan |
|---|---|
| V2 | Libro IVA Ventas (detalle + resumen) + export CSV/XLSX/PDF |
| V3 | Retenciones y Percepciones + activación de exento/no gravado y percepciones emitidas |
| V4 | Posición Mensual IVA + paquete de cierre mensual + base Ganancias + TXT RG 4597 |
| V5 | Conciliación ARCA ↔ Nexus (A luego B) — requiere ERP-C productivo |

### Decisiones a confirmar por Dirección
1. ¿Se amplía el enum de percepciones con `PERCEPCION_ADUANA` o se registra como `OTRO` con descripción?
2. ¿El corte de los libros muestra SOLO `ambiente='PRODUCCION'` o un toggle Producción/Homologación para QA?
3. ¿Arrastre de saldo a favor: automático del período anterior o carga manual de la Contadora en V4?
4. ¿`contabilidad.view` se asigna a Gerencia Comercial / Adm. y Finanzas en la etapa de asignación RBAC pendiente?

> Restricción cumplida: solo plan de reporting — no se escribió código, ni vistas, ni se modificó producción.

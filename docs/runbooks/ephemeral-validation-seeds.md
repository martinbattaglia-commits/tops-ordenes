# EPHEMERAL VALIDATION — Catálogo de datos sintéticos (seeds de prueba)

> Complemento de `ephemeral-validation-package.md`. Define el **set mínimo de datos ficticios**
> para las pruebas funcionales de la cadena `0082–0101` en el **entorno efímero descartable**.
>
> 🔒 **Reglas absolutas de este catálogo:**
> - **100% sintético/ficticio.** Ningún dato proviene de la base productiva `arsksytgdnzukbmfgkju`.
> - **Sin PII** (nombres reales, CUITs reales, domicilios reales, emails reales). Todo inventado.
> - **Sin SQL ejecutable** en este documento: es un **catálogo de valores**; Martín los carga en el
>   efímero por la UI o por las RPC existentes (las mismas que usa la app), no por scripts nuevos.
> - **No** copiar importes, razones sociales ni identificadores reales.
> - Los CUITs de abajo son **placeholders ficticios** (marcar "(ficticio)"); si la UI exige un CUIT
>   con dígito verificador válido, generar uno de prueba con un validador, **nunca** uno real.

---

## 0. Cómo se cargan (sin SQL nuevo)

| Dato | Vía de carga en el efímero |
|---|---|
| Clientes / Proveedores | UI de altas, o las tablas `clients`/`vendors` por el flujo normal |
| Factura de venta (AUTORIZADO) | Flujo de emisión existente / RPC `ventas_persist_invoice` (en SANDBOX, CAE mock) |
| Factura de compra (aprobada) | RPC `ap_create_supplier_invoice` + transición a `aprobada` |
| Pago con retención | UI `/contabilidad/pagos-retenciones` (RPC `tesoreria_register_supplier_payment_neto`) |
| Percepción de venta | UI `/contabilidad/percepciones-cargar` (RPC `ventas_persist_other_taxes`) |
| Tarifas | UI tarifas / tabla `customer_service_rates` |
| Billing run | UI `/contabilidad/billing` |
| Usuario RBAC de prueba | Supabase Auth (signup) + asignación en `user_roles` |

> Cuentas bancarias **no** se cargan: ya las seedea `0053` (CAJA + Santander + Galicia, saldo 0).

---

## 1. Clientes ficticios (`clients`)

| Campo | Cliente CL-TEST-1 | Cliente CL-TEST-2 |
|---|---|---|
| razon | `CLIENTE DE PRUEBA UNO SA` | `CLIENTE DE PRUEBA DOS SRL` |
| cuit | `30-11111111-2` (ficticio) | `30-22222222-3` (ficticio) |
| condicion_iva | `RESPONSABLE_INSCRIPTO` | `MONOTRIBUTO` |
| domicilio | `Calle Falsa 100, Piso Test` | `Av. Sintética 200` |
| localidad | `CABA (test)` | `Luján (test)` |
| email | `qa+cliente1@example.test` | `qa+cliente2@example.test` |

> CL-TEST-1 (RI) → habilita **FACTURA_A**; CL-TEST-2 (Monotributo) → **FACTURA_B**.

---

## 2. Proveedores ficticios (`vendors`)

| Campo | Proveedor PV-TEST-1 | Proveedor PV-TEST-2 |
|---|---|---|
| razon | `PROVEEDOR DE PRUEBA UNO SA` | `PROVEEDOR DE PRUEBA DOS SA` |
| cuit | `30-33333333-4` (ficticio) | `30-44444444-5` (ficticio) |
| categoria | `Servicios (test)` | `Insumos (test)` |
| cond_pago | `30 días` | `Contado` |
| email | `qa+prov1@example.test` | `qa+prov2@example.test` |

---

## 3. Órdenes logísticas ficticias (`logistics_orders` + `logistics_order_items`)

| Campo (cabecera) | OL-TEST-1 | OL-TEST-2 |
|---|---|---|
| client_name | `CLIENTE DE PRUEBA UNO SA` (texto; ver nota) | `CLIENTE INEXISTENTE TEST` |
| customer_ref | `REF-TEST-001` | `REF-TEST-002` |
| status | `entregado` | `despachado` |
| requested_date | fecha de prueba (mes en curso) | fecha de prueba |

| Línea | OL-TEST-1 |
|---|---|
| sku | `SKU-TEST-001` |
| description | `Mercadería de prueba` |
| quantity_requested | `10` |

> **Propósito de diseño:** OL-TEST-1 usa un `client_name` que coincide con un cliente real-ficticio
> (para probar el match sugerido del pricing); OL-TEST-2 usa un nombre **sin** coincidencia (para
> probar el caso "no priceable: sin cliente"). Confirma que el pricing **no inventa** cliente.

---

## 4. Facturas ficticias

### 4.1. Factura de VENTA (AUTORIZADO_ARCA, ambiente SANDBOX/mock)
| Campo | Valor (ficticio) |
|---|---|
| cliente | CL-TEST-1 (`RESPONSABLE_INSCRIPTO`) |
| tipo_comprobante | `FACTURA_A` |
| concepto | `2` (servicios) |
| neto gravado (subtotal) | `100000.00` |
| alícuota IVA | `21%` → `alic_iva_id = 5` |
| iva | `21000.00` |
| percepciones / tributos | `0` (se prueban aparte en §6) |
| total | `121000.00` |
| estado_arca | `AUTORIZADO_ARCA` (CAE **mock** de SANDBOX) |
| cost_center_id | `UN-LOGISTICA` (para probar resultado por CC) |

> Debe nacer con su línea de IVA canónica (la RPC de emisión lo asegura). Sirve para: libro IVA
> ventas, asiento de venta, percepción (§6), y vínculo orden→factura.

### 4.2. Factura de COMPRA (aprobada)
| Campo | Valor (ficticio) |
|---|---|
| proveedor | PV-TEST-1 |
| tipo_comprobante | `FACTURA_A` · punto_venta `1` · numero `00000001` |
| neto | `50000.00` |
| alícuota IVA | `21%` → `alic_iva_id = 5` · iva `10500.00` |
| total | `60500.00` |
| approval_status | `aprobada` |
| cost_center_id | `CC-OPER` |

> Sirve para: libro IVA compras, asiento de compra, y **pago con retención** (§5).

---

## 5. Pago a proveedor con retención (prueba de tesorería nativa)
| Campo | Valor (ficticio) |
|---|---|
| proveedor | PV-TEST-1 |
| factura imputada | la de §4.2 (bruto `60500.00`) |
| imputación (bruto) | `60500.00` |
| retención | `RETENCION_GANANCIAS`, importe `2000.00` |
| neto egresado (banco) | `58500.00` |
| banco | `Banco Santander` (seed 0053) |

> **Resultado esperado:** CxP de la factura cancela por **60500** (bruto), banco egresa **58500**
> (neto), retención **2000** a depositar; `v_pagos_retencion_residual` **vacío**.

---

## 6. Percepción de venta (prueba de desglose fiscal)
| Campo | Valor (ficticio) |
|---|---|
| factura | la de §4.1 |
| tax_type | `PERCEPCION_IIBB` |
| jurisdiction | `Buenos Aires (test)` |
| base | `100000.00` · alícuota `3%` |
| importe | `3000.00` |

> Para probar el desglose, la cabecera de la factura debe contemplar la percepción (o cargarse en
> una factura de prueba cuya cabecera ya incluya `percepciones = 3000`). Verifica
> `v_percepciones_ventas` y la conciliación fiscal vs contable.

---

## 7. Tarifas ficticias (`customer_service_rates`)
| Campo | TARIFA-TEST-1 |
|---|---|
| cliente | CL-TEST-1 |
| servicio | `SVC-ALM-PALLET` (seed 0096, almacenaje mensual) |
| unit_price | `1500.00` |
| vat_rate | `21` |
| billing_frequency | `monthly` |
| valid_from | primer día del mes en curso |
| valid_to | (vacío = vigente) |
| cost_center_id | `UN-ALMACENAJE` |

> Sirve para el **billing run recurrente**: al calcular recurrente, debe generar 1 ítem para
> CL-TEST-1 / SVC-ALM-PALLET con neto `1500`, IVA `315`, bruto `1815`. Probar también el EXCLUDE:
> intentar una segunda tarifa activa solapada para el mismo cliente/servicio **debe fallar**.

---

## 8. Usuarios RBAC de prueba

| Usuario | Email (ficticio) | Rol asignado (`user_roles`) | Para probar |
|---|---|---|---|
| QA-ADMIN | `qa+admin@example.test` | `admin` (o `director_ops`) | todas las acciones write (contabilidad/tesorería/billing) |
| QA-LECTOR | `qa+lector@example.test` | `compliance` | solo lectura (que las acciones write fallen por permiso) |

> Creación: alta por **Supabase Auth** (signup en el efímero) + mapeo en `user_roles` al rol
> correspondiente. **Sin** emails ni identidades reales. QA-ADMIN cubre `contabilidad.*`,
> `tesoreria.create`, `pedidos.edit` por herencia del rol. QA-LECTOR valida el corte de RBAC.

---

## 9. Matriz: seed → prueba que habilita

| Seed | Prueba funcional (runbook §5 / package §5) |
|---|---|
| Clientes/Proveedores | altas, condición IVA, tipo de comprobante |
| Factura venta §4.1 | libro IVA ventas, asiento de venta, resultado por CC, percepción §6 |
| Factura compra §4.2 | libro IVA compras, asiento de compra, pago con retención §5 |
| Pago con retención §5 | bruto/retención/neto, **sin residual**, tesorería vs contable |
| Percepción §6 | desglose de percepciones, fiscal vs contable |
| Orden logística §3 | vínculo orden→factura, pricing "no priceable" con motivo |
| Tarifa §7 | billing run recurrente, borrador de factura (BORRADOR), EXCLUDE anti-solape |
| Usuarios §8 | RBAC (write con QA-ADMIN, corte con QA-LECTOR) |

---

## 10. Limpieza
Al cerrar GO/NO-GO, **destruir el entorno efímero** (no hay que borrar estos datos uno por uno:
se descarta el proyecto/instancia completo). Estos seeds **nunca** se cargan en
`arsksytgdnzukbmfgkju`.

---

*Catálogo de datos sintéticos. Sin PII, sin datos reales, sin SQL ejecutable. Solo para el entorno
efímero de validación.*

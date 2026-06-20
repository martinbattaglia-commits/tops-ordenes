# Diseño técnico F14 — Pricing automático de órdenes logísticas

> **Naturaleza:** DISEÑO. No es implementación. No crea migraciones, no modifica código,
> no toca producción. Especifica cómo pasar el pricing logístico de "safe partial"
> (Fase 13) a pricing automático real, cuando existan los datos.
> **Pre-requisito duro:** aplicar y validar en staging la cadena `0082–0101` ANTES de
> implementar F14 (F14 se construye sobre 0096–0101).

---

## 1. Problema a resolver

Hoy (post Fase 13) el pricing de órdenes logísticas **no puede ejecutarse automáticamente**
porque `logistics_orders` (0030) carece de los datos fiscales necesarios:

| Falta | Estado actual |
|---|---|
| Cliente | sólo `client_name` **text** (no `client_id`, no FK a `clients`) |
| Servicio facturable | no hay vínculo a `billable_services` |
| Cantidad fiscal | `logistics_order_items.quantity_requested` es operativa, sin unidad fiscal confiable |
| Tarifa | no hay relación a `customer_service_rates` |

Por eso `billing_price_logistics_order` (0099) devuelve casi siempre **"no priceable"** con
motivos, y `v_logistics_orders_pricing` marca `priceable=false`. **Es correcto**: el sistema
no inventa cliente/servicio/precio/cantidad.

---

## 2. Objetivo de F14

Cerrar la brecha de datos para habilitar, **sólo cuando todo esté validado**:

1. Mapear orden logística → **cliente real** (`clients.id`).
2. Mapear orden logística → **servicio facturable** (`billable_services.id`).
3. Calcular **cantidad fiscal** (con unidad).
4. Buscar **tarifa vigente** (`customer_service_rates`).
5. **Simular precio** (read-only).
6. Generar **`billing_run_item`** sólo si el mapeo está completo y validado.
7. **No** emitir factura automáticamente.
8. **No** contabilizar automáticamente.

> El asiento contable sigue naciendo sólo de una **factura autorizada** por el flujo de
> ventas existente. F14 sólo alimenta el **billing run** (borradores).

---

## 3. Modelo de datos propuesto (aditivo, a diseñar en migraciones futuras)

> Todo aditivo. No se altera `logistics_orders` en su semántica operativa (módulo validado).

### Opción recomendada: tabla de perfil de facturación por orden
`logistics_order_billing_profile` (1:1 con la orden; separa lo fiscal de lo operativo):

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `logistics_order_id` | uuid FK → logistics_orders **UNIQUE** | 1 perfil por orden |
| `client_id` | uuid FK → clients NULL | match validado (no `client_name`) |
| `client_match_source` | text | `manual` \| `suggested` \| `confirmed` |
| `client_match_confidence` | numeric(4,3) NULL | si el match fue asistido |
| `service_id` | uuid FK → billable_services NULL | servicio facturable asignado |
| `quantity` | numeric(15,3) NULL | cantidad fiscal |
| `quantity_unit` | text NULL | m2/m3/pallet/posicion/orden/bulto/kg/manual |
| `quantity_source` | text | `order_items` \| `manual` \| `wms` \| `contract` |
| `rate_id` | uuid FK → customer_service_rates NULL | tarifa resuelta (snapshot del id) |
| `cost_center_id` | uuid FK → cost_centers NULL | |
| `status` | enum | `unmapped` \| `mapped` \| `priceable` \| `billed` \| `not_billable` |
| `notes` | text | |
| `created_at/by · updated_at` | | |

**Por qué tabla aparte y no columnas en `logistics_orders`:** mantiene el módulo operativo
intacto, aísla lo fiscal, y permite RLS/permiso propio (`pedidos.edit`/`contabilidad.edit`)
sin tocar las policies de pedidos.

### Alternativa (más invasiva, no recomendada de entrada)
Columnas aditivas en `logistics_orders` (`client_id`, `billing_service_id`, …). Se descarta
por acoplar lo operativo con lo fiscal y por tocar una tabla validada.

### Relaciones
```
logistics_orders 1──1 logistics_order_billing_profile
   profile.client_id   → clients
   profile.service_id  → billable_services
   profile.rate_id     → customer_service_rates   (resuelta vía customer_service_rate_for)
   profile.cost_center_id → cost_centers
billing_run_items.source_type='logistics_order', source_id=logistics_order_id
   (dedup ya existente por (run, cliente, servicio, source) — 0098)
```

---

## 4. Estrategia de matching de cliente

- **Nunca** usar `client_name` (texto) como verdad: sólo como **sugerencia**.
- Pipeline: (1) match exacto `lower(razon)=lower(client_name)` → sugerencia con confianza alta;
  (2) match por CUIT si la orden lo tuviera (no hoy); (3) si 0 o >1 → requiere **mapeo manual**.
- Guardar `client_match_source` (`suggested`/`manual`/`confirmed`) y `client_match_confidence`.
- **Regla:** un perfil sólo pasa a `mapped`/`priceable` con `client_id` **confirmado por humano**.

---

## 5. Estrategia de servicio facturable

Asignación orden → `billable_services`, por reglas + override manual:

| Situación de la orden | Servicio sugerido |
|---|---|
| Recepción / ingreso de mercadería | `movimiento_inbound` (SVC-IN) |
| Despacho / salida | `movimiento_outbound` (SVC-OUT) |
| Almacenaje del período | `almacenaje_mensual` / `m2` / `m3` |
| Movimiento interno | `movimiento_*` |
| Servicio especial | `servicio_especial` |
| No facturable | marcar `status='not_billable'` |

- La sugerencia es heurística (por estado/tipo de orden); **el humano confirma**.
- Un mismo orden podría generar **varios** ítems (p. ej. inbound + almacenaje) → en F14 esto
  sería un perfil con N líneas de servicio (extensión: `logistics_order_billing_lines`).
  Para la primera iteración, **1 servicio por orden** (simplicidad), N como mejora.

---

## 6. Estrategia de cantidad

Origen de la cantidad fiscal según el servicio:

| Unidad | Fuente posible |
|---|---|
| m² / m³ | contrato (`contracts.m2`) / dato manual |
| pallet / posición | WMS (packing/posiciones) / manual |
| orden / bulto | `logistics_order_items` (conteo) |
| kg | peso de ítems (si existiera) / manual |
| cantidad manual | ingresada por el operador |

- `quantity_source` registra de dónde salió.
- **Fallback "no priceable"** si no hay cantidad confiable (no se asume 1 salvo abono fijo).

---

## 7. Reglas de seguridad (no-negociables)

- ❌ No inventar **cliente** (sin `client_id` confirmado → no priceable).
- ❌ No inventar **precio** (sin tarifa vigente → no priceable).
- ❌ No inventar **tarifa**.
- ❌ No inventar **cantidad** (sin fuente confiable → no priceable).
- ❌ No **emitir factura** (sólo billing_run_item → borrador → flujo de ventas).
- ❌ No **contabilizar** (sólo la factura autorizada genera asiento).
- ✅ Todo arranca en **simulación** read-only.

---

## 8. Flujo propuesto

```
1. Detectar órdenes candidatas (despachadas/entregadas, sin perfil 'billed'/'not_billable')
2. Matchear cliente   → profile.client_id (confirmación humana)
3. Asignar servicio   → profile.service_id (sugerencia + confirmación)
4. Calcular cantidad  → profile.quantity + quantity_unit + quantity_source
5. Buscar tarifa      → customer_service_rate_for(client, service, fecha) → profile.rate_id
6. Simular precio     → billing_price_logistics_order (ya read-only, extendido a usar el perfil)
7. Generar billing_run_item  (sólo si priceable: cliente+servicio+tarifa+cantidad OK)
8. Revisión humana    (aprobar/excluir en el billing run — 0098)
9. Borrador de factura (billing_run_create_draft_invoice — 0100)
10. Emisión por flujo de ventas existente (ARCA) → recién ahí se contabiliza
```

`billing_price_logistics_order` (0099) se **extendería** para leer
`logistics_order_billing_profile` (en vez de exigir `p_service_id` por parámetro), pero su
naturaleza **read-only (STABLE)** se mantiene.

---

## 9. UI propuesta

| Pantalla | Función |
|---|---|
| Órdenes no priceables | lista con motivo (ya existe `/contabilidad/pricing-logistica`; se enriquece con acciones de mapeo) |
| Mapeo de cliente | sugerencia + confirmación de `client_id` por orden |
| Asignación de servicio | sugerencia + selección de `billable_service` |
| Cantidad | ingresar/confirmar cantidad + unidad + fuente |
| Simulación de precio | preview read-only (cliente/servicio/tarifa/cantidad/neto/IVA/bruto) |
| Aprobación para billing | generar `billing_run_item` desde perfiles priceables |

> Reutiliza el patrón existente (server component + client view + server action + RPC).

---

## 10. Validaciones necesarias

- **No duplicación**: `UNIQUE(logistics_order_id)` en el perfil; dedup de `billing_run_items`
  por `(run, cliente, servicio, source=logistics_order_id)` (ya en 0098).
- **No priceable sin datos**: priceable sólo con `client_id` + `service_id` + `rate_id` + `quantity` > 0.
- **billing_run_item trazable**: `source_type='logistics_order'`, `source_id=order_id`, `rate_id`.
- **Factura borrador trazable**: vía `invoice_items.billing_run_item_id` (0100).
- **No emisión automática**: el ítem nace en billing run; la factura es BORRADOR hasta emisión humana.
- **Kit read-only** F14: perfiles sin cliente confirmado no generan ítems; sin tarifa → no priceable;
  sin duplicación; simulación no escribe.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Cliente mal matcheado | confirmación humana obligatoria; nunca usar `client_name` como verdad |
| Tarifa incorrecta | snapshot de `rate_id`; mostrar vigencia; EXCLUDE evita ambigüedad |
| Cantidad mal calculada | `quantity_source` explícito; fallback no priceable |
| Unidad fiscal equivocada | unidad del servicio (`billable_services.unit`) vs unidad de la cantidad — validar coherencia |
| Facturación duplicada | UNIQUE de perfil + dedup de billing items + vínculo orden↔factura (0093) |
| Mezcla operación/fiscalidad | tabla de perfil separada; no tocar `logistics_orders` operativa |
| Pricing automático prematuro | F14 sólo tras validar 0082–0101 en staging; primero simulación |

---

## 12. Recomendación final

1. **No implementar F14** hasta aplicar y validar en staging la cadena `0082–0101`.
2. Implementar F14 en **commit separado**, en este orden incremental:
   - **(a) Modo simulación**: tabla de perfil + mapeo (cliente/servicio/cantidad) + extender
     `billing_price_logistics_order` para leer el perfil. Sin generar ítems.
   - **(b) `billing_run_item`**: generar ítems sólo desde perfiles priceables (validados).
   - **(c) Borrador de factura**: reusar `billing_run_create_draft_invoice` (0100) — sin emisión.
3. Mantener todas las reglas de seguridad de §7 (nunca inventar cliente/precio/servicio/cantidad).

---

*Documento de diseño. No constituye implementación. Sin migraciones, sin código funcional,
sin cambios en producción. Sujeto a validación previa de staging y a aprobación.*

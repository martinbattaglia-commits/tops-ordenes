# Informe A — Prevención de Facturas Duplicadas (Cuentas por Pagar)

| | |
|---|---|
| **Fecha** | 2026-06-28 |
| **Módulo** | Compras · Cuentas por Pagar — Alta de factura de proveedor (`/compras/facturas/nueva`) |
| **Origen** | Observación durante la validación funcional del circuito de Conciliación OC↔Factura |
| **Estado** | ✅ Investigación CONCLUIDA — sin acción urgente |
| **Decisión (Martín B.)** | Integridad ya cubierta a nivel BD/RPC/Backend. La mejora de UX (chequeo proactivo en el formulario) pasa al **backlog de mejoras** para una próxima Release. **No implementar ahora.** |
| **Rama** | `feat/conciliacion-oc` (sin push / merge / deploy) |

---

## ⚠️ Corrección de una conclusión previa

Durante el cierre del incidente de validación se afirmó, de forma **incorrecta**, que:
> "Actualmente pueden registrarse facturas duplicadas / no hay restricción de unicidad."

La verificación contra el esquema y los datos reales **desmiente** esa afirmación. Las dos facturas que se habían señalado como "duplicado" **no lo son**:

| Comprobante | Tipo | **Punto de venta** | Número | Total |
|---|---|---|---|---|
| FP-2026-0025 | Factura A | **1** | 00000469 | $5.500.000 |
| FP-2026-0022 | Factura A | **54** | 00000469 | $5.500.000 |

Mismo proveedor y mismo número, pero **distinto punto de venta** ⇒ son comprobantes legítimamente distintos. La consulta de duplicados reales por la clave de negocio devolvió **0 filas**.

---

## Causa (estado real del control de duplicados)

El sistema **ya previene duplicados en 2 de los 3 niveles** solicitados:

| Nivel | Estado | Mecanismo (evidencia) |
|---|---|---|
| **Base de datos** | ✅ Ya existe | Constraint `supplier_invoices_vendor_id_tipo_comprobante_punto_venta_nu_key` = `UNIQUE (vendor_id, tipo_comprobante, punto_venta, numero)`. Un duplicado real es **físicamente imposible** de insertar. |
| **Backend / RPC** | ✅ Ya existe | `ap_create_supplier_invoice` envuelve el INSERT en `exception when unique_violation then raise exception 'DUPLICATE_INVOICE: ...'`. |
| **Capa de traducción** | ✅ Ya existe | `humanizeApRpcError` (`src/lib/erp/errors.ts:11-12`) mapea `DUPLICATE_INVOICE` → *"Ya existe un comprobante con ese tipo, punto de venta y número para este proveedor."* |
| **Formulario (UX)** | ❌ Falta | `clientValidate()` (`NuevaFacturaForm.tsx`) **no** chequea existencia previa. El usuario descubre el duplicado **recién al confirmar** (mensaje del backend). No hay aviso proactivo. |

### Sobre el CUIT
La clave única usa `vendor_id`, y cada proveedor tiene un único `cuit` (relación 1:1 en `vendors`). **El CUIT ya está cubierto implícitamente** por `vendor_id`. Incluir el CUIT crudo sólo protegería un caso distinto: el mismo CUIT cargado bajo **dos registros de proveedor diferentes** (duplicación del *maestro* de proveedores), que es un tema de deduplicación del maestro, no del alta de facturas.

---

## Impacto

- **Integridad de datos:** ya garantizada. No pueden coexistir dos facturas con (proveedor, tipo, PV, número) idénticos. *Beneficio adicional:* esta clave también **bloquea el doble-submit** descrito en el Informe B — un reintento no puede crear un duplicado.
- **UX:** subóptima sólo en el borde — el aviso de duplicado llega tarde (al confirmar, no antes de enviar).
- **Severidad:** **Baja.** Cero riesgo de datos; sólo una oportunidad de pulir el feedback temprano.

---

## Solución propuesta (única mejora real: nivel formulario)

Chequeo proactivo de duplicados antes del envío:

1. Server action `checkDuplicateInvoiceAction(vendor_id, tipo, punto_venta, numero)` → `SELECT 1` por la clave de negocio → `{ exists: boolean, public_id?: string }`.
2. En `NuevaFacturaForm`: disparar el chequeo on-blur del número (debounced) y al submit; mostrar una advertencia inline (*"Ya cargaste FP-XXXX con este número para este proveedor"*), deshabilitando el botón o exigiendo confirmación explícita.
3. La BD y el RPC siguen siendo la autoridad final (defensa en profundidad intacta).

---

## Complejidad

**Baja.** 1 server action nueva (~20 líneas) + ~30 líneas en el formulario + 1 test. **Sin migración, sin tocar el RPC ni la BD** (ya están). Estimado: ~2–3 h con tests.

---

## Recomendación

- **No se requiere ninguna acción de integridad de datos** — ya resuelto a nivel BD + RPC + backend, de forma robusta y atómica.
- El chequeo proactivo es una **mejora de UX opcional y de baja prioridad** → **planificada para una próxima Release** (decisión tomada).
- Ítem de backlog separado (no urgente): unicidad de **CUIT en el maestro `vendors`**, si interesa prevenir el alta de proveedores duplicados (ahí sí aporta el CUIT crudo).

---

## Anexo — Evidencia

- `pg_constraint` / `pg_indexes` sobre `public.supplier_invoices`: `UNIQUE (vendor_id, tipo_comprobante, punto_venta, numero)`.
- RPC `public.ap_create_supplier_invoice(jsonb,jsonb,jsonb,jsonb)`: bloque `exception when unique_violation` → `DUPLICATE_INVOICE`.
- `src/lib/erp/errors.ts:11-12`: traducción a mensaje de usuario.
- Consulta `GROUP BY (vendor_id, tipo_comprobante, punto_venta, numero) HAVING count(*)>1` → **0 filas**.
- FP-2026-0025 (PV 1) vs FP-2026-0022 (PV 54), ambos Nº 00000469 — distinto punto de venta.

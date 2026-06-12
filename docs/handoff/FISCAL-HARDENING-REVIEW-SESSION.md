# FISCAL-HARDENING-REVIEW-SESSION — Sesión de revisión con impacto contable y fiscal

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** FISCAL-HARDENING-REVIEW-SESSION.md (entregable 9; sesión de revisión previa a la migración 0071)
**Fecha:** 2026-06-12
**Naturaleza:** SESIÓN DE REVISIÓN — cero código, cero migraciones. Cierra con la solicitud de aprobación explícita para escribir `0071_fiscal_hardening.sql`.
**Evidencia:** lectura en vivo de producción (nexus.logisticatops.com, 2026-06-12): `/billing`, `/compras/libro-iva`, `/tesoreria/cobranzas`, Cockpit.

> **Objetivo:** revisar H1–H4 con ejemplos concretos en pesos sobre los datos reales del sistema, para decidir con evidencia la ejecución de la fase.

---

## §0 — Estado fiscal real de producción (leído hoy)

| Dato | Valor real (2026-06-12) |
|---|---|
| Comprobantes de venta emitidos | **2 — ambos SANDBOX** (CAE mock, "sin validez fiscal" según la propia pantalla) |
| Factura A 00002-00000001 · Martin Rinas (CUIT 20-34425248-4) | **$ 4.422.308** · 29/05/2026 · CAE 73950024860004 (mock) |
| Factura A 00002-00000002 · Verotin SA (CUIT propio) | **$ 89.298** · 29/05/2026 · CAE 71231620914309 (mock) |
| Cobranzas registradas contra esas facturas mock | #2 **COBRADA** ($89.298) · #1 **PARCIAL** (imputados ~$2.100.000) — con cuentas bancarias reales (Galicia/Santander) |
| **Total a cobrar en Tesorería** | **$ 2.322.308 — 100% proveniente de la factura mock #1** |
| OS firmadas pendientes de facturar | **$ 3.051.000 neto** (Martin Rinas: 6 OS $2.345.000 · Verotin: 1 OS $706.000) |
| Libro IVA Compras (junio) | 1 comprobante en $0 · **cero NC cargadas** |

Lectura ejecutiva: **el problema H2 no es teórico — ya está ocurriendo**. La cuenta corriente de clientes, el cashflow proyectado del Cockpit y el registro de cobranzas operan hoy sobre comprobantes sin validez fiscal.

---

## §1 — H1 · NC/ND ARCA (hoy es imposible rectificar un comprobante)

**Qué pasa hoy:** los tipos NC/ND existen, pero (a) el esquema de emisión descarta `comprobante_asociado_id`; (b) nunca se envía `CbtesAsoc` a ARCA — RG 4540 lo exige → **en producción real toda NC/ND sería rechazada**; (c) no existe ninguna acción de anulación. El mock SANDBOX las aprobaría, ocultando el problema hasta el primer caso real.

**Ejemplo concreto (con la factura real #1):** Factura A por **$4.422.308** (neto $3.654.800 + IVA 21% **$767.508**). Supongamos que la tarifa estaba mal o el cliente impugna el servicio:

| Camino | Resultado hoy |
|---|---|
| Emitir NC-A por el total | **Rechazada por ARCA** (sin comprobante asociado) |
| Anular | **No existe** la acción |
| Corregir el importe | **Bloqueado** por el trigger de inmutabilidad (correcto) |

**Impacto contable/fiscal:** el débito fiscal de **$767.508 queda firme** en el Libro IVA Ventas aunque la operación se caiga comercialmente → IVA ingresado de más e irrecuperable sin documento rectificativo, o corrección "por afuera" en la DDJJ que **no concilia con los libros del sistema** (observación directa de auditoría). En el caso inverso (facturar de menos y no poder emitir ND): débito subdeclarado → **omisión de impuesto (art. 45, Ley 11.683: multa de hasta el 100% del gravamen omitido) + intereses resarcitorios**.

**Con el fix:** NC/ND con `CbtesAsoc`, validaciones de tope contra el saldo no acreditado, y anulación por NC total append-only — el patrón fiscal correcto.

---

## §2 — H2 · SANDBOX vs Producción (el caso ya está ocurriendo)

**Qué pasa hoy (números reales):** la vista `customer_open_items` y los consumidores de `customer_invoices` **no filtran por ambiente**. Resultado en producción, hoy:

- Tesorería reclama **$2.322.308** de una factura **mock**.
- Se registraron cobranzas reales (~$2.100.000 + $89.298) **imputadas a comprobantes sin validez fiscal**, contra cuentas bancarias reales.
- El Cockpit proyecta cashflow con esos saldos.

**Proyección del daño si no se corrige antes de ERP-C (ARCA productivo):** al pasar `fiscal_config.ambiente` a `PRODUCCION`, el futuro `libro_iva_ventas` sumaría el stock SANDBOX: sobre los $4.511.606 mock existentes hay **$783.005 de IVA débito inexistente** que entraría a la Posición IVA y a la DDJJ — declaración sobre CAE inválidos, en cualquier dirección un pasivo fiscal o un crédito ficticio.

**Impacto contable adicional:** mientras tanto, la conciliación bancaria real (cobros Galicia/Santander) está anclada a documentos de prueba — al depurar los mock habrá que reimputar esas cobranzas (lo contempla el plan: las filas mock no se borran — append-only — solo salen del corte).

**Con el fix:** regla de corte única (`estado_arca + anulada + ambiente = fiscal_config.ambiente`) en KPIs, tesorería y libros; los comprobantes de prueba quedan visibles solo en `/billing` con badge `SANDBOX`.

---

## §3 — H3 · IVA Compras (NC suma crédito en vez de restar)

**Qué pasa hoy:** las vistas del Libro IVA Compras no manejan signo: una **Nota de Crédito de proveedor SUMA crédito fiscal** en lugar de restarlo.

**Estado real:** el libro de junio tiene 1 comprobante en $0 y **cero NC cargadas** → **impacto actual: $0. Es la ventana ideal para corregir antes de la primera NC real.**

**Ejemplo concreto (próxima NC que llegue):** factura de combustible $121.000 (IVA **$21.000**) y NC del proveedor por $12.100 (IVA **$2.100**) por litros no entregados:

| | Crédito fiscal computado |
|---|---|
| Libro actual (suma la NC) | **$23.100** ❌ |
| Correcto (resta la NC) | **$18.900** ✅ |
| Diferencia por comprobante | **$4.200 de crédito computado de más** |

Cada NC infla el crédito → **Posición IVA subdeclarada** → ante fiscalización: ajuste retroactivo + intereses + multa por omisión. Con NC recurrentes (combustible, repuestos, diferencias de tarifa), el error compone mes a mes y obliga a rectificativas en cadena.

**Con el fix:** factor de signo en las vistas (datos intactos, importes siempre positivos — el signo es semántica de la vista, mismo criterio que usará IVA Ventas).

---

## §4 — H4 · Doble facturación de OS

**Qué pasa hoy:** la emisión obtiene el CAE **primero** y marca las OS `FACTURADA` **después**, con un update best-effort que ante error solo escribe un log. **Hay precedente real de esa falla en este sistema:** el test E2E del WMS (2026-06-11) documentó server actions que devuelven 503 intermitente con la mutación aplicada (bug B1) — exactamente el modo de falla que dejaría las OS sin marcar.

**Ejemplo concreto (con las OS reales pendientes):** Martin Rinas tiene 6 OS firmadas por **$2.345.000 neto**. Secuencia:

1. Click "Emitir Factura A" → ARCA autoriza: neto $2.345.000 + IVA **$492.450** = **$2.837.450** con CAE válido.
2. El update post-CAE falla (timeout/503) → las 6 OS siguen `FIRMADA`.
3. El operador reintenta → **segunda factura legalmente válida con segundo CAE por las mismas OS**.

**Impacto:** débito fiscal **duplicado: $984.900** en el período; el cliente recibe dos facturas legales por el mismo servicio; cuenta corriente inflada en $2.837.450; y la corrección exige una NC… **que hoy no funciona (H1)** — círculo vicioso: H4 produce el daño y H1 impide repararlo.

**Con el fix:** guard de idempotencia **pre-emisión** (verifica `invoice_items.order_id` contra facturas autorizadas vigentes — no depende del update post-CAE), reintentos con alerta visible, y exclusión en UI de OS ya facturadas.

---

## §5 — Interdependencia y orden de ejecución dentro de la fase

```
H4 (previene el daño) ──┐
H1 (permite repararlo) ──┼── deben entrar JUNTOS antes de ERP-C productivo
H2 (corta los mock)    ──┤
H3 (ventana $0 actual) ──┘   una sola migración: 0071_fiscal_hardening.sql
```

Contenido exacto de la migración (lo único que toca la base): recreación de las vistas de compras con signo (H3) + filtro de ambiente en `customer_open_items` (H2). Todo lo demás (H1, H4, regla de corte en código, badges) es código TypeScript sin migración.

---

## §6 — Solicitud de aprobación explícita

Conforme a la directiva (cero migraciones, cero código hasta revisión final del plan), se solicita la aprobación presidencial explícita para:

1. **Escribir la migración `0071_fiscal_hardening.sql`** (vistas con signo + corte por ambiente — verificando numeración contra main).
2. Implementar H1–H4 en rama `feature/fiscal-hardening` → tsc/lint/build → Deploy Preview → FISCAL-HARDENING-EXECUTION-REPORT.md con las 4 verificaciones del plan.
3. Merge `--no-ff` y deploy **solo tras validación presidencial del preview**.

> Restricción cumplida: esta sesión es solo análisis sobre datos reales leídos de producción — cero código, cero migraciones.

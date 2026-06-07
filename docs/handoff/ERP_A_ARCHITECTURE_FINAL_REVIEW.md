# ERP-A · TREASURY FOUNDATION — REVISIÓN ARQUITECTÓNICA FINAL

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A_ARCHITECTURE_FINAL_REVIEW.md`
**Revisa:** `ERP_A_TREASURY_DESIGN.md` (freeze aprobado, D1–D5 congeladas).
**Naturaleza:** revisión adversarial de pre-implementación. No es código, migraciones ni commits. No modifica archivos existentes.

> **Objetivo:** romper el diseño antes de construirlo. Buscar inconsistencias contables, agujeros de integridad referencial, condiciones de carrera, fallas en anulaciones/parciales/transferencias, y errores en los cálculos derivados. Clasificar P0–P3 y emitir GO/NO-GO para ERP-A1.

---

## 0. Veredicto

**No se detectaron hallazgos P0 (bloqueantes).** El diseño es internamente coherente, no se contradice y nada impide iniciar ERP-A1 (modelo de datos).

Se detectaron **5 hallazgos P1** que **deben incorporarse al spec de A1/A4** antes de que esas fases se cierren (no bloquean *empezar* A1, pero son correcciones obligatorias al esquema y a las RPC). Más 7 P2 y 5 P3 de robustez/alcance.

➡️ **Recomendación: GO con condiciones.** Iniciar ERP-A1 incorporando los P1 al esquema `0053`/`0054`. Ver §4 (lista de cambios a aplicar) y §5 (GO formal).

---

## 1. Validación por eje

| Eje | Veredicto | Síntesis |
|---|---|---|
| 1. Consistencia contable | 🟡 OK con ajustes | Semántica retención (net=banco, gross=deuda) es correcta; falta CHECK que impida `net<0` (F2). Falta definir qué `estado_arca`/`status` cuenta como deuda en las vistas (F7). |
| 2. Integridad referencial | 🟡 OK con ajustes | FK correctas; pero el DELETE físico de un recibo (RLS admin) diverge banco vs. saldo factura (F3). Puntero polimórfico sin FK es aceptable si se prohíbe DELETE. |
| 3. Concurrencia | 🟠 Hallazgo real | Saldo bancario derivado: inmune (fortaleza de D1). **Sobre-imputación de allocations sí es vulnerable** a carrera; requiere lock por factura en la RPC (F1). |
| 4. Anulaciones | 🟡 OK con ajustes | Reversa por derivación es correcta; pero las vistas deben filtrar por estado del recibo/pago padre, no por existencia de la allocation (F4); falta trazabilidad de anulación (F5). |
| 5. Pagos parciales | ✅ OK | Soportados por allocations N:M. Limitación: no hay pago "a cuenta" sin factura (F9, documentar). |
| 6. Cobranzas parciales | ✅ OK | Ídem; retención bien integrada al parcial. |
| 7. Transferencias entre bancos | ✅ OK | Par de movimientos con `transfer_group_id` es sólido; `reference_id` nulo en transferencias (documentar, F13); anular debe anular ambas patas vía RPC (F17). |
| 8. Saldos derivados | ✅ OK | `opening + Σ(ingresos confirmados) − Σ(egresos confirmados)` correcto y libre de carrera. Costo a volumen mitigable (F-P2 perf). |
| 9. Cuenta corriente derivada | 🟡 OK con ajustes | Correcta por construcción; depende de F4 (estado padre) y F7 (qué facturas computan). |

---

## 2. Hallazgos detallados

### 🔴 P0 — bloqueantes
**Ninguno.**

### 🟠 P1 — obligatorios antes de cerrar A1/A4

**F1 — Sobre-imputación de allocations bajo concurrencia.**
El saldo de una factura es derivado (no hay columna que lockear). Dos cobranzas concurrentes sobre la misma factura leen `saldo=100`, ambas imputan `100`, y la factura queda imputada `200` sobre un total de `100`. El `CHECK` de fila **no puede** validar una suma cross-row. El `UNIQUE(receipt_id, invoice_id)` tampoco lo evita (son recibos distintos).
**Corrección (en RPC, A4):** serializar por factura dentro de la transacción con `SELECT … FOR UPDATE` sobre la fila de `customer_invoices`/`supplier_invoices` afectada (no se modifica: solo se bloquea), o `pg_advisory_xact_lock(hashtext(invoice_id::text))`. Recién entonces recomputar saldo e insertar la allocation. *Nota:* lockear la fila de la factura no viola D5 (no es UPDATE; es un lock de serialización) y no toca columnas fiscales (lock trigger no se dispara en SELECT).

**F2 — Retención puede producir `net_amount` negativo.**
El diseño fija `CHECK (net_amount = gross_amount − retention_amount)` y `retention_amount >= 0`, pero **no impide `retention_amount > gross_amount`** → `net_amount < 0` → movimiento bancario con monto negativo (viola `CHECK (amount > 0)` recién en el movimiento, abortando la transacción de forma poco clara).
**Corrección (en `0053`):** agregar `CHECK (retention_amount <= gross_amount)` en `customer_receipts`.

**F3 — DELETE físico de recibo/pago diverge banco vs. cuenta corriente.**
La RLS prevé `delete` para `admin`. Si se borra un `customer_receipt`: `receipt_allocations` cae por `ON DELETE CASCADE` (el saldo de la factura se recalcula y "revive" la deuda), **pero el `treasury_movement` asociado queda huérfano** (puntero polimórfico sin FK) → el saldo bancario sigue contando ese ingreso. **Banco y cuenta corriente quedan inconsistentes.**
**Corrección (en `0053`):** eliminar las policies de DELETE físico sobre `treasury_movements`, `customer_receipts`, `supplier_payments` (y allocations), dejando la **anulación lógica (void) como único camino**. Si se quiere conservar un DELETE de emergencia para `admin`, debe ser una RPC que borre movimiento + doc + allocations atómicamente. Recomendado: **append-only puro, sin DELETE**.

**F4 — Las vistas de saldo deben filtrar por estado del documento padre, no por la allocation.**
Las `*_allocations` no tienen estado propio. Al anular un recibo (`status='anulado'`), sus allocations **siguen existiendo físicamente**. Si una vista calcula `pagado = Σ allocations.amount` sin unir al estado del recibo/pago, **cuenta dinero anulado**.
**Corrección (en vistas, A4):** toda vista de saldo/cuenta corriente debe `JOIN` al recibo/pago y filtrar `parent.status = 'confirmado'`. Alternativa más robusta: denormalizar `status` en la allocation y mantenerlo sincronizado por la RPC de void. **Decisión recomendada:** filtrar por estado del padre (menos superficie, una sola fuente de verdad del estado).

**F5 — Falta trazabilidad de anulación (audit append-only incompleto).**
El dominio se declara append-only, pero `treasury_movements`/`customer_receipts`/`supplier_payments` solo tienen `created_at`/`created_by`. Al anular no queda **quién, cuándo ni por qué** (el resto de Nexus sí audita: `invoice_audit`, `po_events`).
**Corrección (en `0053`):** agregar `voided_at timestamptz`, `voided_by uuid → auth.users`, `void_reason text` a las tres entidades (o una tabla `treasury_audit` append-only análoga a `po_events`). La RPC `tesoreria_void_movement` los completa.

### 🟡 P2 — robustez / alcance (resolver en A, documentar si se difiere)

**F6 — Bypass de invariantes por INSERT directo.**
La RLS de tabla permite a `operaciones/supervisor` insertar `treasury_movements` directo vía PostgREST, salteando las RPC y sus invariantes (un `cobranza/ingreso` sin recibo, sin allocations). El tipo `ajuste` **sí** es un movimiento manual legítimo (ajuste de banco), pero `cobranza/pago/transferencia` no deberían poder crearse a mano.
**Mitigación:** un trigger `before insert` que rechace inserciones directas de `type in ('cobranza','pago_proveedor','transferencia')` salvo que provengan de las RPC (`security definer`), permitiendo manual solo `type='ajuste'`. O revocar INSERT directo y exponer todo por RPC.

**F7 — Definir qué facturas computan como deuda en las vistas.**
`customer_invoice_balances`/`customer_current_account` deben excluir `estado_arca in ('BORRADOR','RECHAZADO_ARCA','ERROR_ARCA','ANULADO')` y las `anulada=true`; una factura en borrador **no es** un crédito. Para proveedores, excluir `status='anulada'`. Sin esto, la cuenta corriente se infla con comprobantes no vigentes.
**Mitigación:** filtros explícitos en las vistas (A4). Documentar el conjunto "vigente".

**F8 — Validación del destino de la allocation + anulación de factura con allocations.**
(a) La RPC debe rechazar imputar a facturas no emitidas/autorizadas o anuladas. (b) Falta política para **anular una factura que ya tiene cobros/pagos confirmados imputados** (hoy nada lo impide y dejaría dinero imputado a un comprobante inexistente).
**Mitigación:** RPC valida `estado_arca`/`status` del destino; y se define regla: no se puede anular una factura con allocations confirmadas hasta anular/reasignar esos cobros (documentar para ERP-C/D, fuera de A si se prefiere).

**F9 — No hay cobro/pago "a cuenta" (sin factura).**
La invariante `Σ allocations = gross_amount/amount` obliga a imputar el 100%. No soporta anticipos / saldo a favor del cliente (caso real). *Parcial de una factura* sí está soportado; *pago sin factura* no.
**Mitigación:** declarar explícitamente fuera de alcance de ERP-A; documentar para ERP-D (introduciría allocations parciales con remanente "a cuenta").

**F10 — Cheque/Echeq se confirman inmediatamente.**
`payment_method` admite `cheque`/`echeq`, pero la RPC inserta el movimiento como `confirmado` al instante → el saldo bancario incluye instrumentos **no acreditados**. El enum `treasury_status_t` tiene `pendiente` pero queda **sin uso** en A.
**Mitigación:** documentar la simplificación de A (todo confirmado), reservando `pendiente` para el clearing de cheque/echeq en una fase posterior. O, si se quiere desde A: cheque/echeq nacen `pendiente` y no suman saldo hasta confirmar.

**F11 — Lectura de tesorería abierta a todo `authenticated`.**
`read = auth.role()='authenticated'` expone bancos/movimientos/cobros/pagos a **cualquier** usuario autenticado, incluido el rol legacy `cliente` (`user_role_t`) y el futuro `cliente_b2b`. Es el patrón de la casa (`0014`), pero tesorería es más sensible que AP.
**Mitigación:** por instrucción del freeze **se mantiene el patrón** ahora; se marca como endurecimiento a evaluar **después** de la validación funcional (restringir read a roles internos antes de habilitar cualquier portal de cliente).

**F12 — Multi-moneda sin guarda.**
El modelo tiene `currency`/`moneda` pero A opera solo ARS. Nada impide imputar un recibo ARS a una factura en otra moneda, ni transferir entre cuentas de distinta moneda sin tipo de cambio. Además `customer_invoices.moneda` usa el código ARCA `'PES'` vs `bank_accounts.currency='ARS'` (ambos pesos, etiquetas distintas).
**Mitigación:** RPC valida `bank_account.currency='ARS'` y que la factura sea pesos; FX queda fuera de A (documentar). Normalizar la lectura PES/ARS en la capa de datos.

### ⚪ P3 — menor / cosmético

- **F13 —** En transferencias, `reference_id` es nulo (no hay entidad transfer); el vínculo es `transfer_group_id`. Documentar la excepción al patrón polimórfico.
- **F14 —** La numeración no reinicia por año (sequence global + prefijo de año): `REC-2026-000500` → `REC-2027-000501`. Es **consistente con `FP-`** (`0014`); se mantiene a propósito.
- **F15 —** Un solo `attachment` por recibo/pago; comprobante + certificado de retención no caben juntos. Suficiente para A; documentar.
- **F16 —** `net_amount` podría ser `GENERATED ALWAYS AS (gross_amount - retention_amount) STORED` en lugar de CHECK + asignación en RPC (más simple, imposible de desincronizar). Evaluar en A1.
- **F17 —** Anular una sola pata de una transferencia vía UPDATE directo desincroniza bancos; reforzar que el void de transferencia es **solo por RPC** (cae bajo F6 si se restringe el UPDATE directo).

---

## 3. Lo que se validó y está correcto (no requiere cambios)

- **Saldo bancario derivado (D1):** libre de condiciones de carrera por construcción; anulaciones se reflejan solas. Núcleo sólido.
- **Transferencia como par de movimientos:** no hay doble conteo; cada banco ve su pata; el grupo es trazable.
- **Allocations N:M (D2):** modelan parciales y multi-factura sin rediseño. Invariante de suma correcta (con F1 para concurrencia).
- **Semántica de retención (D4):** `net` al banco, `gross` a la deuda, es contablemente correcta (con F2 para el borde negativo).
- **Cuenta corriente derivada (D5):** una sola fuente de verdad; sin tablas redundantes (con F4/F7 para los filtros de estado).
- **No-UPDATE sobre facturas:** evita el lock trigger ARCA y mantiene la verdad única. Confirmado seguro.
- **RLS `current_role()`:** usa el dominio legacy `user_role_t` = {admin, operaciones, supervisor, cliente}; `'supervisor'` existe → el predicado es válido y consistente con AP (`0014`).
- **Orden de migraciones `0052` (enum aislado) → `0053` → `0054`:** respeta la regla de la casa (`0021`/`0029`).

---

## 4. Cambios a incorporar en ERP-A1/A4 (derivados de P1/P2)

**En `0053_treasury_core.sql` (A1):**
1. `customer_receipts`: `CHECK (retention_amount <= gross_amount)` (F2).
2. Las tres entidades: columnas `voided_at`, `voided_by`, `void_reason` (F5).
3. RLS: **quitar DELETE físico**; anulación solo por void (F3).
4. Trigger que restringe INSERT directo de movimientos a `type='ajuste'`; el resto solo por RPC (F6).
5. Evaluar `net_amount` como columna `GENERATED` (F16).

**En `0054_treasury_fns.sql` (A4):**
6. RPCs de cobranza/pago: `SELECT … FOR UPDATE` / advisory lock por factura antes de imputar (F1).
7. RPCs: validar estado del destino de la allocation y coherencia de moneda ARS (F8, F12).
8. Todas las vistas de saldo/cuenta corriente: `JOIN` a estado del recibo/pago padre = `'confirmado'` (F4) y filtro de facturas vigentes por `estado_arca`/`status` (F7).
9. `tesoreria_void_movement`: completar `voided_*` y anular ambas patas de transferencia (F5, F17).

**Documentar (alcance de A, diferir a fases posteriores):**
10. Sin pago/cobro "a cuenta" sin factura (F9 → ERP-D).
11. Cheque/Echeq se confirman inmediatos; `pendiente` reservado para clearing futuro (F10).
12. Read RLS amplio se endurece tras validación funcional (F11).
13. FX/multi-moneda fuera de A (F12); detalle de retención (type/regime/certificate) → ERP-F (D4).

---

## 5. Recomendación formal

> ## ✅ GO — iniciar ERP-A1 con condiciones
>
> No existen hallazgos P0. El diseño congelado (D1–D5) es coherente y construible.
> Se autoriza avanzar a **ERP-A1 (modelo de datos)** incorporando al esquema los **5 P1** (F1–F5) y los ajustes de A1 listados en §4. Los P2 se resuelven o documentan dentro de A; los P3 son menores.
>
> **Secuencia confirmada:** `0052` (enum `tesoreria`, aislada) → `0053` (core + correcciones F2/F3/F5/F6) → `0054` (RPC + vistas con F1/F4/F7/F8).
>
> Pendiente: tu autorización explícita para escribir la primera migración. Hasta entonces, no se genera código.

---

## Anexo — Evidencia verificada en repo

| Afirmación de la revisión | Evidencia |
|---|---|
| `current_role()` retorna `user_role_t` (incluye 'supervisor') | `0001_init.sql:23,180-181`; `0005_fix_rls_recursion.sql:23-24` |
| Dominio legacy = {admin, operaciones, supervisor, cliente} | `0001_init.sql:23` |
| RBAC granular separado (roles.slug) | `0009_rbac.sql:17-28,217-225` |
| Lock trigger solo veta columnas fiscales (SELECT/FOR UPDATE no lo dispara) | `0011_arca_billing.sql:257-281` |
| Patrón read=authenticated en AP (base de F11) | `0014_supplier_invoices.sql:116-119` |
| `customer_invoices.moneda` default `'PES'` vs banco `'ARS'` (F12) | `0011:175` |
| Regla de enum aislado | `0021_wms_permission_module.sql`, `0029_pedidos_permission_module.sql` |

---

*Fin — Revisión Arquitectónica Final ERP-A. Recomendación: GO con condiciones. No se escribió código, migraciones ni se realizaron commits.*

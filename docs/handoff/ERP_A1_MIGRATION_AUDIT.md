# ERP-A1 · AUDITORÍA ADVERSARIAL DE MIGRACIONES

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_MIGRATION_AUDIT.md`
**Audita:** `0052_treasury_permission_module.sql` · `0053_treasury_core.sql`
**Modo:** revisión de release crítica, mentalidad adversarial (romper el diseño).
**Naturaleza:** solo auditoría. No se modifican migraciones, no se escribe `0054`, no hay código ni commits.

> **Aclaración de honestidad:** este informe audita código que yo mismo escribí. Prioricé encontrar fallas reales por sobre confirmar el diseño. Se hallaron **6 P1** (varios son agujeros que el diseño previo daba por cubiertos y NO lo estaban), además de 9 P2 y 6 P3. **Ninguno bloquea la *aplicación* de la migración, pero varios bloquean su *uso real* hasta corregirlos.**

---

## 1. Resumen ejecutivo

Las migraciones son sintácticamente sólidas, idempotentes y consistentes con las convenciones del repo. Pero la auditoría adversarial expone que **el principio append-only y las invariantes de imputación no están realmente cerrados a nivel de esquema/RLS** — dependen casi por completo de las RPC que aún no existen (`0054`), y dejan caminos directos (PostgREST con rol interno) para **alterar o fabricar registros financieros sin auditoría**.

Los tres hallazgos más graves:
- **H1 (P1):** F3 bloqueó DELETE pero **no UPDATE**. Un rol interno puede mutar `amount`/`direction`/`status` de un movimiento *confirmado* sin dejar rastro. Append-only es incompleto.
- **H2 (P1):** El guard F6 protege `treasury_movements` pero **no las `*_allocations`**. Un INSERT directo de una allocation corrompe la cuenta corriente derivada sin cash asociado.
- **H3 (P1):** La cobranza en **efectivo** no tiene dónde registrarse: `customer_receipts.bank_account_id` es nullable para efectivo, pero `treasury_movements.bank_account_id` es **NOT NULL** y no existe cuenta "Caja". Método aprobado, circuito imposible.

**Veredicto:** 🟡 **GO CON CONDICIONES** (ver §8). Aplicar `0052`/`0053` solo después de incorporar las correcciones P1 (en una migración correctiva o reescritura autorizada de `0053`, según definas).

---

## 2. Hallazgos clasificados

### 🔴 P0 — bloqueantes de aplicación
**Ninguno.** Las migraciones aplican (con la salvedad del bloque de storage, ver P2-H13).

### 🟠 P1 — deben corregirse antes de que el esquema respalde operación real

**H1 — Append-only incompleto: UPDATE de registros confirmados sin restricción.**
F3 eliminó las policies DELETE, pero las policies UPDATE (`treasury_movements`, `customer_receipts`, `supplier_payments`) permiten a `admin/operaciones/supervisor` **modificar cualquier columna** de una fila ya `confirmado`: cambiar `amount`, `direction`, `type`, `status`, anular sin llenar `voided_*`, etc. Un UPDATE que pone `amount=0` o cambia `direction` **equivale a borrar/falsear** el movimiento, salteando todo el modelo de void y la auditoría F5.
**Evidencia:** `0053` policies `"treasury_movements update"`, `"customer_receipts update"`, `"supplier_payments update"` (sin `tg_lock`).
**Corrección:** replicar el patrón `tg_lock_authorized_invoice` (`0011:257-281`): un trigger `before update` que, sobre filas `status='confirmado'`, **solo** permita la transición a `anulado` con `voided_at/by/reason` seteados, y rechace cambios a columnas financieras (`amount`, `direction`, `type`, `bank_account_id`, montos). Igual para recibos/pagos (bloquear cambios a `gross/retention/amount/...`).

**H2 — Allocations sin guard equivalente a F6: corrupción directa de cuenta corriente.**
El guard F6 cubre solo `treasury_movements`. `receipt_allocations`/`payment_allocations` tienen policy de INSERT para roles internos y **ningún guard**. Como la cuenta corriente (D5) se deriva de las allocations, un INSERT directo vía PostgREST (`receipt_allocations(receipt_id, customer_invoice_id, amount)`) **reduce el saldo de una factura sin cobro real**, o crea imputaciones desbalanceadas (Σ allocations ≠ gross). La invariante `Σ allocations = gross/amount` **no existe a nivel de esquema** — solo vivirá en la RPC.
**Evidencia:** `0053` policies `"receipt_allocations insert"` / `"payment_allocations insert"`; ausencia de guard.
**Corrección:** extender el guard `treasury.via_rpc` a las allocations (rechazar INSERT directo salvo dentro de RPC), o revocar INSERT directo y exponer solo por RPC. Documentar que el esquema **no** es backstop de la igualdad de suma.

**H3 — Cobranza en efectivo sin destino contable.**
`customer_receipts.bank_account_id` es nullable (comentario: "null permitido solo para efectivo"), pero `treasury_movements.bank_account_id` es **NOT NULL** y no se siembra una cuenta "Caja/Efectivo". La RPC de cobranza no podrá crear el movimiento `ingreso` de una cobranza en efectivo. `efectivo` es un método **aprobado** (`treasury_receipt_method_t`).
**Evidencia:** `0053` `customer_receipts.bank_account_id … references … ` (nullable) vs `treasury_movements.bank_account_id … not null`; seed bancos sin caja.
**Corrección:** sembrar una cuenta `('Caja','Caja Efectivo','caja_ahorro'…)` y forzar que el efectivo impute ahí; o hacer `treasury_movements.bank_account_id` nullable + un libro de caja. Definir antes de `0054`.

**H4 — RLS de escritura más permisiva que la matriz RBAC.**
Las policies de INSERT usan `current_role() in ('admin','operaciones','supervisor')`, pero la matriz RBAC (§4 del freeze) otorga `tesoreria.create` solo a `admin`/`director_ops` (operaciones = **solo view**; `supervisor` ni siquiera es un rol granular). Como las RPC serán `security definer` (bypassan RLS) y la RLS es el único candado a nivel DB para inserts directos de `ajuste`, **un usuario `operaciones` puede crear movimientos `ajuste` pese a ser "solo lectura" según RBAC**. Las dos capas se contradicen.
**Evidencia:** `0053` policies insert vs `0009`/matriz RBAC.
**Corrección:** alinear RLS write a `current_role()='admin'` (o validar `has_permission('tesoreria.create')` en la RPC y restringir la RLS de tabla a admin). Definir el rol operativo real de tesorería.

**H5 — Exposición de toda la información financiera a cualquier autenticado (incl. rol legacy `cliente`).**
`read = auth.role()='authenticated'` permite a **cualquier** usuario autenticado —incluido el rol legacy `cliente` (`user_role_t`) y el futuro `cliente_b2b`— hacer `SELECT` de cuentas bancarias, saldos, **todas** las cobranzas y **todos** los pagos. Es confidencialidad financiera de la empresa expuesta a cuentas no internas.
**Evidencia:** `0053` policies `"… read" using (auth.role()='authenticated')` en las 6 tablas.
**Corrección:** restringir lectura a roles internos (`current_role() in ('admin','operaciones','supervisor','compliance')` o `has_permission('tesoreria.view')`). *Nota:* el freeze pidió no endurecer aún; este hallazgo **eleva la prioridad** porque expone finanzas a `cliente`. Mínimo: excluir `cliente` antes de habilitar cualquier login externo.

**H6 — Falta CHECK de coherencia `type`↔`direction`.**
El esquema acepta un movimiento incoherente (`type='cobranza'` con `direction='egreso'`, o `pago_proveedor`/`ingreso`), que **invierte el signo** en los saldos derivados. No hay constraint que lo impida; queda 100% en manos de la RPC.
**Corrección (cheap backstop):** `check ((type='cobranza' and direction='ingreso') or (type='pago_proveedor' and direction='egreso') or type in ('transferencia','ajuste'))`.

### 🟡 P2 — robustez / operación

- **H7 — Bypass del guard F6 por GUC.** `current_setting/set_config('treasury.via_rpc',…)` es un GUC de namespace custom: **cualquier rol** puede setearlo. Un actor con acceso SQL hace `select set_config('treasury.via_rpc','on',true);` e inserta lo que quiera. El guard frena PostgREST *accidental*, no es frontera de seguridad. **Además:** si una RPC (u otro código) lo setea con `is_local=false`, con **pgbouncer (Supabase pooler)** el GUC puede **filtrarse a requests siguientes** en la misma conexión → guard desactivado para inserts ajenos. *Corrección:* documentar que F6 es defensa-en-profundidad; las RPC deben usar **siempre** `set_config(...,true)` (scope transacción).
- **H8 — Bypass de F6 por UPDATE de `type`.** El guard es `before insert`. Insertar `type='ajuste'` (permitido) y luego `UPDATE … set type='cobranza'` esquiva el guard. Se resuelve con H1 (lock de UPDATE).
- **H9 — Retención 100% → movimiento amount=0 inválido.** Si `retention_amount = gross_amount` → `net_amount=0`; la RPC intentaría crear el movimiento `ingreso` con `amount=0` y viola `check (amount > 0)`. *Corrección:* en la RPC, omitir el movimiento cuando `net=0` (o permitir `amount>=0`). Documentar.
- **H10 — Riesgo de deadlock en cobro/pago multi-factura.** Con el lock por factura de F1, una cobranza que imputa a varias facturas debe lockearlas en **orden determinístico** (p.ej. `order by customer_invoice_id`) o dos transacciones cruzadas deadlockean. *Corrección:* fijar orden de lock en `0054`.
- **H11 — Sin backstop de esquema para `Σ allocations ≤ total`.** El esquema no impide sobre-imputar una factura entre varios recibos/pagos; depende del lock RPC (F1). *Corrección:* aceptar enforcement RPC-only (documentado) o evaluar constraint trigger diferido.
- **H12 — Precisión numérica inconsistente.** Treasury usa `numeric(14,2)` (~1e12) pero `customer_invoices.total` es `numeric(15,2)` (~1e13). Una factura de ventas muy grande no es representable por `receipt_allocations.amount`. *Corrección:* usar `numeric(15,2)` en montos que tocan el lado ventas, o aceptar el límite (documentar).
- **H13 — Bloque de storage modelado sobre una migración nunca aplicada.** Las policies sobre `storage.objects` se basan en `0015`, que su propio header declara **"NO APLICADA A PRODUCCIÓN"**. No hay precedente probado de que `create policy on storage.objects` corra en el flujo de migraciones de este proyecto (puede requerir privilegios/dashboard). *Corrección:* separar storage en migración aparte (como 0015) o validar privilegios antes de aplicar `0053`.
- **H14 — Integridad de transferencia no garantizada por esquema.** Nada asegura que un `transfer_group_id` tenga exactamente 2 patas, una `ingreso` y una `egreso`, mismo `amount`. Queda en la RPC. *Corrección:* aceptar RPC-only; documentar.
- **H15 — `0052` (enum add) es irreversible.** `alter type … add value` no se puede revertir; un rollback exige recrear `permission_module_t` y recast de todas las columnas que lo usan. *Corrección:* documentar la complejidad de rollback; preferir roll-forward.

### ⚪ P3 — menores

- **H16 — `reference_type` es texto libre** sin CHECK; podría guardar valores arbitrarios. Sugerido: `check (reference_type in ('customer_receipt','supplier_payment','transfer','manual') or reference_type is null)`.
- **H17 — `created_by` no forzado a `auth.uid()`.** Un INSERT directo puede declarar `created_by` ajeno. La RPC debe setear `created_by = auth.uid()`.
- **H18 — Adjuntos huérfanos.** Al anular un recibo/pago, el archivo en el bucket `treasury` no se limpia. Menor.
- **H19 — Índice compuesto faltante para la vista de saldos.** `treasury_bank_balances` sumará por banco filtrando `status='confirmado'`; un índice parcial `(bank_account_id) where status='confirmado'` ayudaría a volumen alto (hoy prematuro).
- **H20 — `pendiente` en `treasury_status_t` sin uso** en A (reservado a clearing). Enum value muerto temporalmente; documentado.
- **H21 — Movimiento `net=0`** generaría una fila de monto 0 si se permitiera; ruido (ligado a H9).

---

## 3. Riesgos operativos

- **Orden de aplicación crítico (H15-adyacente):** `0052` debe aplicarse y **committearse en su propia transacción** antes de `0053`. Si el runner los corre en una sola transacción, falla por "unsafe use of new value of enum". Supabase CLI corre cada archivo por separado → OK, pero **verificar** en el flujo real de aplicación.
- **Storage (H13):** el bloque de policies puede fallar al aplicar según privilegios; planificar aplicación de storage por separado, como se hizo (o no) con `0015`.
- **Efectivo (H3):** sin cuenta de caja, el equipo no puede registrar cobranzas en efectivo → vacío operativo desde el día uno.

## 4. Riesgos contables

- **H1/H2:** registros financieros mutables/fabricables sin auditoría ⇒ la contabilidad pierde confiabilidad e integridad (lo más grave para un libro financiero).
- **H6:** coherencia signo (type/direction) no garantizada ⇒ saldos potencialmente invertidos.
- **Retención (D4):** `gross − net` (la retención) no se asienta como crédito en ninguna parte; cash y cuenta corriente no reconcilian por sí solos. Aceptado por D4 (detalle → ERP-F), pero debe constar.
- **H9:** cobranza 100% retención inoperable.

## 5. Riesgos de seguridad

- **H5:** exposición de finanzas a cualquier autenticado, incluido `cliente`. El más sensible.
- **H4:** RLS write contradice RBAC ⇒ usuarios "solo lectura" con capacidad de escritura directa.
- **H7:** guard F6 evadible por GUC + posible fuga por pooler.
- **Service role:** bypassa RLS y guards por diseño (Supabase). Toda escritura por service-role debe canalizarse por las RPC; documentar que el service-role es confianza total.

## 6. Riesgos de performance

- Índices base correctos (FK, status, date, ref). Crecimiento esperado moderado (movimientos ≈ recibos+pagos+2·transferencias+ajustes).
- **Faltante sugerido (H19):** índice parcial para la suma de saldos por banco a volumen alto.
- Vistas derivadas (D1/D5) harán agregaciones sobre `treasury_movements` y joins a `*_invoices`; aceptable a escala TOPS, con *materialized view* como opción futura (sin cambiar fuente de verdad).
- Sin riesgos de cardinalidad o índices ausentes que comprometan A.

## 7. Correcciones recomendadas (consolidado, para cuando autorices)

| # | Hallazgo | Corrección | Dónde |
|---|---|---|---|
| H1 | UPDATE muta confirmados | Trigger `tg_lock` estilo `0011:257-281`: confirmado → solo void | `0053` (correctiva) |
| H2 | Allocations sin guard | Extender `via_rpc` guard / RPC-only insert | `0053` (correctiva) |
| H3 | Efectivo sin destino | Seed cuenta "Caja" o `bank_account_id` nullable en movimientos | `0053` (correctiva) |
| H4 | RLS > RBAC | RLS write = `admin`; permisos finos en RPC | `0053` (correctiva) |
| H5 | Lectura abierta a `cliente` | Read = roles internos / `has_permission` | `0053` (correctiva) |
| H6 | type↔direction | `CHECK` de coherencia | `0053` (correctiva) |
| H7/H8 | Bypass F6 | Documentar defensa-en-profundidad; `set_config` local; lock UPDATE (H1) | `0053`/`0054` |
| H9/H21 | net=0 | RPC omite movimiento si net=0 | `0054` |
| H10 | Deadlock multi-factura | Lock en orden determinístico | `0054` |
| H11/H14 | Sin backstop de suma/transfer | Enforcement RPC-only documentado | `0054` |
| H12 | numeric 14,2 vs 15,2 | Unificar a 15,2 montos del lado ventas | `0053` (correctiva) |
| H13 | Storage sin precedente | Migración de storage separada / validar privilegios | reorg |
| H16/H17 | reference_type / created_by | CHECK + `created_by=auth.uid()` en RPC | `0053`/`0054` |

> Todas se aplican vía **una migración correctiva `0053b`/reescritura de `0053`** y reglas en `0054`, cuando lo autorices. **No se modifica nada ahora.**

---

## 8. Veredicto final

> ## 🟡 GO CON CONDICIONES
>
> Las migraciones `0052`/`0053` son aplicables y bien construidas, pero **no deben respaldar operación real hasta resolver los 6 hallazgos P1** (H1–H6). Tres de ellos (H1 UPDATE, H2 allocations, H3 efectivo) son agujeros que el diseño daba por cubiertos y la auditoría adversarial demostró abiertos.
>
> **Recomendación de avance:**
> 1. **No aplicar `0053` tal cual.** Incorporar H1–H6 (y H12) en una migración correctiva o reescritura autorizada.
> 2. Mantener `0052` como está (válida; solo documentar irreversibilidad H15).
> 3. Resolver H9–H11/H14/H17 en el diseño de `0054`.
> 4. Decidir H13 (storage separado) antes de cualquier aplicación.
>
> No hay P0: nada es catastrófico ni la migración rompe al aplicar. Pero en mentalidad de release crítica, **un libro financiero con UPDATE libre sobre confirmados (H1) y allocations sin guard (H2) no es apto para producción** hasta corregirse.
>
> Pendiente: tu decisión sobre cómo incorporar las correcciones (migración correctiva nueva vs. reescritura de `0053`). Hasta entonces, no se modifica ninguna migración.

---

## Anexo — Matriz de cobertura de los P1 del freeze (F1–F6) tras la auditoría

| Hallazgo freeze | ¿Cerrado en `0053`? | Nota de la auditoría |
|---|---|---|
| F1 (concurrencia) | ⏳ pendiente `0054` | Sin backstop de esquema (H11); cuidar deadlock (H10) |
| F2 (retención) | ✅ en esquema | CHECKs correctos; borde net=0 abre H9 |
| F3 (append-only) | ⚠️ **parcial** | Cubre DELETE; **UPDATE abierto (H1)** |
| F4 (vistas confirmado) | ⏳ pendiente `0054` | OK por diseño |
| F5 (auditoría void) | ⚠️ parcial | Columnas existen, pero UPDATE libre permite anular sin llenarlas (H1) |
| F6 (guard insert) | ⚠️ **parcial** | Solo movimientos, **no allocations (H2)**; evadible por GUC/UPDATE (H7/H8) |

---

*Fin — Auditoría Adversarial de Migraciones ERP-A1. Veredicto: GO CON CONDICIONES. No se modificaron migraciones ni se generó código.*

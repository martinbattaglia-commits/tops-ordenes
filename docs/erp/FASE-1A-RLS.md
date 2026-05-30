# FASE 1A · RLS

**Scope:** políticas de seguridad por tabla nueva.
**Estado:** diseño · no aplicar.
**Modelo base:** `current_role()` + `has_permission(slug)` (mig 0009) + pattern multi-tenant ya validado en 0011 y 0013.

---

## 0 · Convenciones aplicadas

Replico exactamente el pattern existente:

| Pattern | Origen | Aplicación |
|---------|--------|------------|
| `current_role() in ('admin','operaciones','supervisor')` | mig 0011 línea 296 | "lectura interna" |
| `current_role() in ('admin','operaciones')` | mig 0011 línea 325 | "escritura interna" |
| `current_role() = 'admin'` | mig 0011 línea 300 | "escritura admin" |
| Cliente lee `where client_id = (select client_id from profiles where id = auth.uid())` | mig 0011 línea 320 | "lectura cliente filtrada" |
| `has_permission('billing.view')` | mig 0009 función | "permisos granulares" — usable a futuro |
| Append-only | trigger pattern de `tg_lock_authorized_invoice` mig 0011 | aplicar a `customer_transactions` |
| Tablas catálogo: read all auth, write admin | mig 0011 puntos_venta | aplicar a `payment_terms`, `late_fee_rules` |

---

## 1 · Asunciones de roles

Roles operativos (per mig 0009 + `src/lib/rbac/data.ts`):

- **`admin`** — Ruth (Administración) + JL (Director)
- **`operaciones`** — Operaciones
- **`supervisor`** — Compliance, supervisor general
- **`comercial`** — Ventas (no toca facturación por default)
- **`cliente`** — usuario externo (lectura propia)
- **`auditor`** — read-only sobre todo

---

## 2 · Política por tabla

### 2.1 `payment_terms` (catálogo)

```
RLS enable
read all auth:
  using (auth.role() = 'authenticated')

write admin:
  for all
  using (current_role() = 'admin')
  with check (current_role() = 'admin')
```

**Racional:** catálogo bajo, leído por toda la app; solo admin puede agregar/editar/desactivar terms.

### 2.2 `recurring_contracts` (header)

```
RLS enable

read internal/cliente:
  using (
    current_role() in ('admin','operaciones','supervisor','auditor')
    or client_id = (select client_id from profiles where id = auth.uid())
  )

write internal:
  for insert, update, delete
  using (current_role() in ('admin','operaciones'))
  with check (current_role() in ('admin','operaciones'))

read auditor:
  ya cubierto por la primera policy (auditor in lista)
```

**Racional:** internos editan; cliente ve sólo sus contratos vigentes (no pasa por billing del cliente todavía pero deja el camino abierto).

### 2.3 `recurring_contract_lines`

```
RLS enable

read: hereda del contract
  using (exists (select 1 from recurring_contracts rc
                 where rc.id = contract_id
                 and (current_role() in ('admin','operaciones','supervisor','auditor')
                      or rc.client_id = (select client_id from profiles where id = auth.uid()))))

write internal:
  for all
  using (current_role() in ('admin','operaciones'))
  with check (current_role() in ('admin','operaciones'))
```

### 2.4 `recurring_runs` (log)

```
RLS enable

read internal + auditor:
  using (current_role() in ('admin','operaciones','supervisor','auditor'))

insert internal (motor + manual):
  with check (current_role() in ('admin','operaciones'))

update internal (sólo para corregir status):
  for update
  using (current_role() in ('admin','operaciones'))
  with check (current_role() in ('admin','operaciones'))

NO delete — log inmutable. Si hace falta limpiar, vía función SECURITY DEFINER admin-only.
```

**Racional:** log operativo. Cliente NO ve esto. Auditoría sí.

### 2.5 `customer_accounts`

```
RLS enable

read internal + cliente propio:
  using (
    current_role() in ('admin','operaciones','supervisor','auditor')
    or client_id = (select client_id from profiles where id = auth.uid())
  )

write admin:
  for all
  using (current_role() in ('admin','supervisor'))
  with check (current_role() in ('admin','supervisor'))
```

**Racional:** límite de crédito, stop_billing, default terms — decisiones administrativas, no operativas. Cliente lee su balance.

### 2.6 `customer_transactions`

```
RLS enable

read internal + cliente propio:
  using (
    current_role() in ('admin','operaciones','supervisor','auditor')
    or client_id = (select client_id from profiles where id = auth.uid())
  )

insert internal:
  with check (current_role() in ('admin','operaciones'))

update internal LIMITADO:
  for update
  using (current_role() in ('admin','operaciones'))
  with check (current_role() in ('admin','operaciones'))
  → además: trigger lock impide updates a campos económicos cuando posted=true

NO delete — append-only. Voiding via voided=true + voided_reason.
```

**Trigger lock obligatorio (replica `tg_lock_authorized_invoice`):**

```pseudo
on update on customer_transactions:
  if old.posted = true:
    si new.amount, new.direction, new.type, new.source_table, new.source_id,
       new.tx_date, new.due_date son distintos del old → RAISE
    permitido: new.voided=true + new.voided_reason + new.voided_by + new.voided_at
  new.updated... etc.
```

### 2.7 `customer_payments`

```
RLS enable

read internal + cliente propio:
  using (
    current_role() in ('admin','operaciones','supervisor','auditor')
    or client_id = (select client_id from profiles where id = auth.uid())
  )

write internal:
  for all
  using (current_role() in ('admin','operaciones'))
  with check (current_role() in ('admin','operaciones'))

trigger lock on CONFIRMADO:
  bloquea modificar amount, method, reference, currency una vez confirmado
  permitido pasar a ANULADO
```

### 2.8 `customer_payment_applications`

```
RLS enable

read: hereda de payment
  using (exists (select 1 from customer_payments p
                 where p.id = payment_id
                 and (current_role() in ('admin','operaciones','supervisor','auditor')
                      or p.client_id = (select client_id from profiles where id = auth.uid()))))

write internal:
  for all
  using (current_role() in ('admin','operaciones'))
  with check (current_role() in ('admin','operaciones'))

NO modificar applied_amount si payment.status=CONFIRMADO
  → trigger
```

### 2.9 `late_fee_rules` (catálogo)

```
RLS enable

read all auth:
  using (auth.role() = 'authenticated')

write admin:
  for all
  using (current_role() = 'admin')
  with check (current_role() = 'admin')
```

### 2.10 `customer_late_fee_charges` (instancias)

```
RLS enable

read internal + cliente:
  using (
    current_role() in ('admin','operaciones','supervisor','auditor')
    or client_id = (select client_id from profiles where id = auth.uid())
  )

insert internal:
  with check (current_role() in ('admin','operaciones'))

update internal (sólo para anular):
  for update
  using (current_role() in ('admin','supervisor'))
  with check (current_role() in ('admin','supervisor'))

NO delete.
```

### 2.11 View `customer_balances`

Views no tienen RLS directa — heredan de las tablas subyacentes (`customer_accounts` + `customer_transactions`). El cliente sólo ve su saldo porque las dos tablas underlying filtran por `client_id = profile.client_id`.

**Validación:** confirmar en testing que un cliente conectado solo ve 1 fila en `select * from customer_balances` (la suya).

---

## 3 · Storage RLS

### 3.1 Bucket `invoices` (existente)

Ya cubierto por mig 0013. **No tocar.** Las facturas generadas por el motor recurrente usan el mismo path canónico (`buildInvoicePdfPath`).

### 3.2 Bucket `receipts` (nuevo, para recibos de cobro)

```
bucket receipts: private (false)
path canónico: {client_id|'_global'}/{yyyy}/{mm}/REC-{payment_id-short}.pdf

policy "receipts read internal/cliente":
  using (
    bucket_id = 'receipts'
    and (
      current_role() in ('admin','operaciones','supervisor','auditor')
      or split_part(name,'/',1) = (select client_id::text from profiles where id = auth.uid())
    )
  )

policy "receipts write internal":
  for all
  using (bucket_id='receipts' and current_role() in ('admin','operaciones'))
  with check (bucket_id='receipts' and current_role() in ('admin','operaciones'))

policy "receipts delete admin":
  for delete
  using (bucket_id='receipts' and current_role() = 'admin')
```

### 3.3 Bucket `contracts` (nuevo, para PDFs de contratos recurrentes)

```
bucket contracts: private (false)
path canónico: {client_id}/CONTRATOS/{contract_code}.pdf

policy "contracts read internal/cliente": idem receipts
policy "contracts write internal": idem
policy "contracts delete admin": idem
```

---

## 4 · Permisos RBAC nuevos (catálogo en mig 0014)

Slugs a agregar a `permissions`:

| Slug | Label | Module |
|------|-------|--------|
| `billing.view` | Ver facturas + recurrentes + CC | billing |
| `billing.create` | Crear / editar / emitir facturas directas | billing |
| `billing.recurring.manage` | Gestionar contratos recurrentes (CRUD) | billing |
| `billing.recurring.run` | Disparar runs manualmente | billing |
| `billing.payments.register` | Registrar cobros | billing |
| `billing.payments.apply` | Aplicar cobros a facturas | billing |
| `billing.late_fees.manage` | Configurar reglas de mora | billing |
| `billing.adjustments.create` | Crear ajustes manuales en CC | billing |
| `billing.delete` | Anular facturas / cobros | billing |

### Asignación propuesta a roles existentes (rows en `role_permissions`)

| Rol slug | Permisos billing.* |
|----------|---------------------|
| `director` | TODOS |
| `administracion` (Ruth) | TODOS excepto `delete` (delete requiere doble confirmación → admin) |
| `operaciones` | `view`, `payments.register` |
| `comercial` | `view` |
| `supervisor` / `auditor` | `view`, `recurring.manage` (auditor: solo view) |
| `deposito` / `cliente` | ninguno (cliente ve via RLS sin slug) |

---

## 5 · Tests RLS obligatorios antes de pasar a prod

Para cumplir con el patrón "GATE 2 storage validado" usado en 0013:

| Test | Setup | Resultado esperado |
|------|-------|---------------------|
| T1: cliente A no ve contratos de cliente B | sesión user con `profile.client_id=A` → `select * from recurring_contracts` | solo filas con `client_id=A` |
| T2: cliente NO puede insertar transactions | sesión cliente → `insert into customer_transactions` | RLS violation |
| T3: cliente NO puede ver runs | sesión cliente → `select * from recurring_runs` | 0 filas |
| T4: admin ve todo | sesión admin → `select * from customer_transactions` | todas las filas |
| T5: operaciones puede confirmar cobro pero NO anular factura emitida | sesión operaciones → `update customer_invoices set anulada=true` | RLS o trigger violation |
| T6: trigger lock customer_transactions posted | sesión admin → `update customer_transactions set amount=999 where posted=true` | trigger RAISE |
| T7: cliente ve balance propio en view | sesión cliente → `select * from customer_balances` | exactamente 1 fila (la suya) |
| T8: contrato CASCADE → lines | delete contract en sandbox → lines desaparecen | OK |
| T9: cliente RESTRICT en transactions | intentar delete client con transactions → error FK | OK |
| T10: payment con applications → invoice RESTRICT | intentar delete invoice con applications → error FK | OK |
| T11: storage receipts cliente A no lee recibo de cliente B | path `B/...pdf` desde sesión A | 0 rows |
| T12: append-only transactions delete bloqueado | sesión admin → `delete from customer_transactions` | sin policy DELETE → 0 rows affected |

---

## 6 · Decisiones explícitas

| Decisión | Elegida | Alternativa |
|----------|---------|-------------|
| Append-only via trigger lock | Sí — replica `tg_lock_authorized_invoice` | sin lock — riesgo de tampering |
| Storage receipts/contracts bucket separado | Sí | reusar `invoices` — mezcla semántica |
| `payment.status='CONFIRMADO'` bloquea modificar | Sí (trigger) | mutable — pierde audit |
| Permisos billing.* granulares en mig 0014 | Sí (8 slugs) | 1 slug `billing.*` permisivo |
| Cliente lee `customer_transactions` | Sí (auditoría) | NO — solo balance |
| `auditor` role lee todo billing | Sí | solo módulos asignados |
| Realtime sobre `customer_transactions` | Sí (`alter publication supabase_realtime add table`) — para UI cuenta corriente live | sin realtime |
| Realtime sobre `recurring_runs` | Sí (monitoring cron en vivo) | sin |
| `comercial` role en billing | solo view | edit — ya tiene `comercial.edit` para clientify pero no acá |

---

## 7 · Resumen ejecutivo de RLS

```
catálogos              → read all auth · write admin
recurring_contracts    → read internal+cliente · write internal
recurring_runs         → read internal+auditor · insert internal · no delete
customer_accounts      → read internal+cliente · write admin/supervisor
customer_transactions  → read internal+cliente · insert internal · trigger lock posted · no delete
customer_payments      → read internal+cliente · write internal · trigger lock confirmado
customer_payment_apps  → read inherits payment · write internal
late_fee_rules         → read all auth · write admin
customer_late_fee_charges → read internal+cliente · write internal · no delete
customer_balances (view)  → herencia de underlying

storage:
  - invoices       → ya existente (0013)
  - receipts NUEVO → multi-tenant aislado pattern 0013
  - contracts NUEVO→ multi-tenant aislado pattern 0013

triggers de integridad:
  - lock posted en customer_transactions
  - lock confirmado en customer_payments
  - lock finalizado en recurring_contracts
  - source polimórfica válida en customer_transactions
```

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR
- 🛑 NO SQL ejecutable
- 🛑 NO TOCAR RLS existentes (mig 0009/0011/0013 intactas)
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT

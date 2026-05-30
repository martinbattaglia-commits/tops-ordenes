# FASE 1A · RISKS

**Scope:** análisis de riesgos exclusivos de la implementación de facturación recurrente + CC cliente.
**Estado:** diseño · análisis · sin implementación.
**Modelo de severidad:** Crítico · Alto · Medio · Bajo + probabilidad (alta/media/baja).

---

## 1 · Matriz de riesgos

| ID | Riesgo | Probab. | Impacto | Severidad | Estado |
|----|--------|---------|---------|-----------|--------|
| F1.R01 | Doble facturación del mismo período por race condition | media | crítico | 🚨 Crítico | mitigado por design (UNIQUE en runs) |
| F1.R02 | Backup externo Supabase no configurado al aplicar 0014 (RG5 heredado) | alta | crítico | 🚨 Crítico | bloqueante pre-deploy |
| F1.R03 | RBAC dormido = todos pasan billing.* via fallback | media | alto | 🔴 Alto | mitigado por R22 closure + warn explícito |
| F1.R04 | View `customer_balances` lenta con >50k transactions | media | medio | 🟡 Medio | mitigación: materialized view |
| F1.R05 | Cotización USD/ARS incorrecta al emitir → discrepancia con ARCA | media | alto | 🔴 Alto | mitigación: snapshot inmutable en run |
| F1.R06 | Cron Netlify scheduled function no dispara (fallo plataforma) | baja | alto | 🟡 Medio | mitigación: backfill manual + alerta |
| F1.R07 | Anulación retroactiva de factura emite NC pero CC no se actualiza | baja | alto | 🟡 Medio | mitigación: trigger sobre invoice.anulada |
| F1.R08 | Cliente acumula `unapplied_amount` sin aplicar (anticipos perdidos) | media | medio | 🟡 Medio | mitigación: report semanal + dashboard widget |
| F1.R09 | Mora aplicada después de cobro real (timing) | media | medio | 🟡 Medio | mitigación: cron de mora corre tras cron de cobros |
| F1.R10 | `customer_transactions.posted` violado por bug en código | baja | alto | 🟡 Medio | mitigación: trigger lock + tests |
| F1.R11 | RLS de view `customer_balances` no filtra correctamente cliente | baja | crítico | 🚨 Crítico | test T7 obligatorio + materialized alternativo |
| F1.R12 | Cambio de condición IVA del cliente afecta facturas previas | media | medio | 🟡 Medio | mitigación: snapshot ya en `customer_invoices` |
| F1.R13 | Idempotencia rota en run manual + cron simultáneo | baja | alto | 🟡 Medio | UNIQUE recurring_runs mitiga |
| F1.R14 | Auto-emisión genera factura errónea ARCA y se pasa a `AUTORIZADO` | media | alto | 🔴 Alto | flag `auto_emit=false` default + límite de monto |
| F1.R15 | Trigger lock impide corregir error genuino antes de CAE | media | medio | 🟡 Medio | UI muestra mensaje + fuerza NC |
| F1.R16 | Performance de listado `/billing` cae con >10k facturas | media | medio | 🟡 Medio | índices + paginación ya planeada |
| F1.R17 | Cliente sin email → mail "factura adjunta" falla silencioso | media | bajo | 🟢 Bajo | validación en `clients` + log |
| F1.R18 | Migration 0014 no idempotente rompe en re-aplicación | baja | crítico | 🚨 Crítico | guardas `if not exists` + `do$$` enforced |
| F1.R19 | Cotización source `BCRA_OFICIAL` cae → run FAILED | media | medio | 🟡 Medio | fallback a `cotizacion_fija` config |
| F1.R20 | Cambio de día del mes (calendar edge: 31/Jun no existe) | media | bajo | 🟢 Bajo | constraint `billing_day ≤ 28` |
| F1.R21 | Aplicación parcial de cobro a factura con NC pendiente | media | medio | 🟡 Medio | trigger valida `sum(applications) ≤ invoice.total` |
| F1.R22 | Late fees acumulados generan deuda imposible de cobrar | baja | medio | 🟢 Bajo | UI permite anular charges + cap por contrato |
| F1.R23 | Wizard nuevo contrato salva incompleto y aparece como ACTIVO | baja | medio | 🟢 Bajo | status default = BORRADOR + validación de activación |
| F1.R24 | Storage `receipts` bucket leak por path malformado | baja | crítico | 🚨 Crítico | pattern 0013 validado replicado + tests T11 |
| F1.R25 | `customer_payment_applications` permite aplicar > factura.total | baja | medio | 🟡 Medio | trigger `tg_validate_payment_application` |

---

## 2 · Top 5 críticos — detalle ampliado

### 🚨 F1.R02 — Backup externo Supabase (heredado RG5)

**Descripción:** No hay backup externo verificado de Supabase. Aplicar migration 0014 con dato productivo y luego corrupción/error → pérdida total.

**Impacto:** pérdida de TODO el ledger (transactions, payments, applications, contracts) + facturas históricas. Catastrófico.

**Probabilidad de manifestación:** baja por sí solo, pero **probabilidad de "que pase y no podamos recuperar" es alta** sin backup.

**Mitigación obligatoria pre-deploy:**
1. Configurar pg_dump diario hacia S3/GCS externo
2. Validar restore en sandbox antes de 0014
3. Documentar RPO/RTO real

**Pre-condición no negociable.**

---

### 🚨 F1.R11 — RLS de view `customer_balances` filtra incorrectamente

**Descripción:** Las views en Supabase heredan RLS de tablas subyacentes, pero hay edge cases donde el query planner aplica RLS incorrectamente (especialmente con LEFT JOIN).

**Impacto:** cliente A ve saldo de cliente B → leak de datos financieros confidenciales.

**Mitigación:**
1. **Test T7 (en `FASE-1A-RLS.md`) es obligatorio** antes de exponer view en producción
2. Validar con sesión de cliente real: `select * from customer_balances` debe retornar exactamente 1 fila
3. Si test falla → cambiar a **materialized view + función SECURITY DEFINER `get_my_balance(client_uuid)`**

**Plan B documentado.** Si view RLS falla, usamos función:

```sql
create or replace function public.get_customer_balance(p_client_id uuid)
returns table (
  client_id uuid,
  balance_pes numeric,
  overdue_30_pes numeric,
  ...
) language sql security definer stable as $$
  -- mismo cálculo que la view, pero como función
  -- caller debe validar permiso vía has_permission o ser el cliente
$$;
```

---

### 🚨 F1.R18 — Migration 0014 no idempotente

**Descripción:** Si 0014 no es idempotente y falla a mitad de camino, re-ejecutarla rompe ("type already exists", "column already exists").

**Impacto:** rollback complejo, posible drop de tablas con datos.

**Mitigación obligatoria:**
1. **Todas las cláusulas `create` deben tener `if not exists`** o `do$$ exception when duplicate_object$$`
2. Lint script que verifique antes del `migration up`
3. Test en sandbox con doble aplicación: `migration up && migration up` debe ser no-op
4. Ya prescrito en FASE 0 governance — no hay excusa

---

### 🚨 F1.R01 — Doble facturación por race condition

**Descripción:** Cron Netlify dispara y por lentitud Ruth también dispara "Run manual" para el mismo período. Se generan 2 facturas para el mismo contrato + período.

**Impacto:** cliente recibe 2 facturas; problema fiscal grave (ARCA acepta ambas y queda registro duplicado).

**Mitigación principal: UNIQUE index** en `recurring_runs(contract_id, periodo) where status in ('OK','PENDIENTE')`.

**Flujo de mitigación:**
1. Cron empieza → `INSERT INTO recurring_runs (... status=PENDIENTE)`. Si UNIQUE viola → ya hay un run en curso → skip.
2. Operador clickea "Run manual" → mismo INSERT con status=PENDIENTE → viola UNIQUE → mensaje "Ya hay un run en curso, esperá".
3. Sólo un winner crea la factura.

**Test obligatorio:** simular 2 INSERTs concurrentes en sandbox y verificar que solo 1 sobrevive.

---

### 🚨 F1.R24 — Storage `receipts` leak por path malformado

**Descripción:** Si código de subida no respeta el path canónico (`{client_id}/yyyy/mm/...`), un cliente puede leer recibos de otro.

**Impacto:** leak de documentos sensibles.

**Mitigación:**
1. Replicar pattern de 0013 con `split_part(name,'/',1) = profile.client_id`
2. Tests T11, T12 obligatorios pre-deploy
3. Helper `buildReceiptPath(clientId, payment)` en `src/lib/billing/storage.ts` con tests unitarios

---

## 3 · Top 5 altos — detalle ampliado

### 🔴 F1.R03 — RBAC dormido bypass

**Descripción:** R22 closure documentó fail-open con WARN cuando `user_roles` está vacía. Mientras esté dormido, cualquier usuario autenticado tiene `billing.*`.

**Mitigación:** seedeo de `user_roles` (Director, Administración) es **pre-condición** antes de deploy productivo de FASE 1A.

---

### 🔴 F1.R05 — Cotización USD/ARS

**Descripción:** Contrato en USD → al emitir factura, se necesita cotización. Si la cotización del momento es errónea y queda en `customer_invoices.cotizacion`, factura tiene importe en pesos que no se puede modificar (trigger lock).

**Mitigación:**
1. `recurring_runs.cotizacion_snapshot` se setea ANTES de emitir factura
2. Wizard "Run manual" muestra cotización y pide confirmación
3. Si fuente `BCRA_OFICIAL` falla → fallback a `cotizacion_fija` del contrato
4. Si ambos fallan → run = FAILED, no se emite factura

---

### 🔴 F1.R14 — Auto-emisión sin validación humana

**Descripción:** `auto_emit=true` skipea revisión Ruth → factura va directo a ARCA con CAE. Si tiene error, ya no se puede modificar (trigger lock), hay que emitir NC.

**Mitigación:**
1. `auto_emit` default = `false`
2. Sólo permitir `auto_emit=true` si:
   - Contrato tiene >3 facturas históricas sin issues
   - Total mensual < $X configurable
   - Cliente no está en stop_billing
3. UI muestra warning antes de activar

---

## 4 · Riesgos heredados que persisten

| ID | Origen | Estado en FASE 1A |
|----|--------|---------------------|
| RG5 (backup Supabase) | ERP V2 plan | **bloqueante** para 0014 (F1.R02) |
| PARIDAD-3 (config.toml) | FASE 0 governance | parcial; deja CLI funcional |
| R22 (RBAC fail-open) | red team Drive | mitigado por R22 closure pero aplica acá (F1.R03) |
| RG3 (OCR errors) | ERP V2 plan | irrelevante a FASE 1A (no hay OCR todavía) |
| RG6 (CC discrepante por cambios retroactivos) | ERP V2 plan | mitigado por snapshot en customer_invoices y append-only en transactions |

---

## 5 · Riesgos NUEVOS introducidos por FASE 1A

| Riesgo | Fuente |
|--------|--------|
| Cron Netlify dependency | scheduled function — punto único de falla |
| Storage buckets nuevos (`receipts`, `contracts`) | superficie de ataque adicional |
| Trigger pile-up | trigger `clients_create_account`, `transactions_lock`, `payments_lock`, etc. Performance en write masivo |
| Trigger ordering | si tg_update_customer_account_timestamps falla, ¿se cancela el INSERT? Debería ser AFTER → sí se hace pero RAISE rompe. Mitigación: `exception when others then null` en trigger no-crítico |
| `customer_balances` view: cold queries | primer query del día puede ser lento |
| Auto-aplicación FIFO de cobros | UX puede aplicar pago a factura "vieja" pero el operador esperaba aplicar a "específica" — confusión |

---

## 6 · Riesgos NO contemplados que requieren confirmación del usuario

| Pregunta abierta | Por qué importa |
|------------------|-----------------|
| ¿Qué pasa si un cliente paga **más** que su saldo total? | unapplied_amount queda como anticipo; ¿se nota o se devuelve? |
| ¿Los contratos pueden tener fecha de **revisión periódica** (revisión anual de precios)? | no está modelado |
| ¿Hay **clientes con multi-CUIT** que facturan en >1 razón social? | mig 0011 asume 1 client = 1 cuit; FASE 1A no resuelve eso |
| ¿Hay descuentos por **pronto pago**? | no modelado, podría ir como `customer_transactions.type='ADJUSTMENT'` |
| ¿Quién recibe la notificación de "Run failed"? | sólo Ruth o también JL? |
| ¿Las facturas recurrentes pueden incluir **adicionales del mes** (no recurrentes)? | requiere extender lines o usar factura directa post-run |
| ¿Hay **clientes consumidor final** con condición B/C? | sí, pero motor debe usar `client.condicion_iva` dinámicamente |

---

## 7 · Plan de mitigación por fase

### Pre-deploy
- [ ] Backup Supabase externo configurado y validado en restore (F1.R02)
- [ ] RBAC seedeado para roles `director`, `administracion`, `operaciones` (F1.R03)
- [ ] Migration 0014 con doble-aplicación validada en sandbox (F1.R18)
- [ ] Tests T1-T12 (FASE-1A-RLS.md) ejecutados en sandbox
- [ ] Validación de cotización BCRA con fallback (F1.R05, F1.R19)
- [ ] Decisiones del punto 6 confirmadas por el usuario

### Durante deploy
- [ ] Apply 0014 en horario de baja actividad (madrugada)
- [ ] Verificar `supabase migration list` post-apply
- [ ] Smoke tests inmediatos: insert/select sobre cada tabla nueva
- [ ] RLS tests T1-T12 en producción

### Post-deploy (primeras 2 semanas)
- [ ] Monitor cron runs con notificación a Ruth + JL
- [ ] Revisar customer_balances performance (< 500ms p99)
- [ ] Revisar unapplied_amount de pagos (F1.R08)
- [ ] Validar 1° corrida del motor recurrente con backup manual de OK

---

## 8 · Plan de rollback

| Escenario | Acción |
|-----------|--------|
| Migration 0014 falla mid-way | Revertir vía down-migration comentada + restore de backup |
| Cron genera facturas erróneas masivas | Pausar cron (env var) + anular facturas con NC bulk |
| Customer_balances leak (F1.R11) | Revoke view + reemplazar con función SECURITY DEFINER caliente |
| Trigger lock impide operación legítima | Hotfix → desactivar trigger temporalmente con `alter table disable trigger` + audit |
| Performance degrada producción | Drop indices opcionales + agregar materialized view + cron de refresh |

---

## 9 · Métricas de éxito que activarán "FASE 1A cerrada"

- ✅ ≥30 días de runs automáticos sin issues
- ✅ ≥3 contratos recurrentes activos generando facturas
- ✅ Cuenta corriente discrepancia <1% vs cálculo manual de Ruth
- ✅ 100% de cobros registrados aplican correctamente
- ✅ Cero leaks reportados (T11-T12 en producción periódicos)
- ✅ p99 de queries CC < 1seg
- ✅ Auto-emit usado en ≥1 contrato sin problemas

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO MODIFICAR producción
- 🛑 NO INVENTAR riesgos sin causa raíz identificable

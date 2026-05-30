# FASE 1A · IMPLEMENTATION PLAN

**Scope:** plan de implementación detallado con gates de aprobación, pre-requisitos, secuenciamiento.
**Estado:** documento de planificación. **NO ejecutar nada** sin aprobación explícita por etapa.

---

## 0 · Pre-condiciones bloqueantes

Antes de iniciar **CUALQUIER** etapa de implementación:

| # | Pre-condición | Responsable | Status actual |
|---|---------------|-------------|---------------|
| 1 | **Backup externo Supabase configurado y validado en restore** (RG5 / F1.R02) | DevOps | ❌ no verificado |
| 2 | **RBAC seedeado** para al menos `director` (JL) y `administracion` (Ruth) | Admin DB | ❌ user_roles dormida |
| 3 | **Decisiones del usuario** sobre 7 preguntas abiertas listadas en `FASE-1A-AUDIT.md §8` | Usuario | ⏳ pendiente |
| 4 | **Aprobación del scope** de los 9 documentos | Usuario | ⏳ pendiente |
| 5 | **Branch dedicada** `feature/fase-1a-recurring-billing` creada desde `feature/nexus-fullstack` HEAD `4d1dbff` | DevOps | ❌ no creada |
| 6 | **config.toml local** para Supabase CLI (PARIDAD-3 closure) | DevOps | ⚠️ parcial |
| 7 | **Sandbox Supabase** separado del prod para testing | DevOps | ⚠️ por confirmar |

**Si alguna está en ❌, NO arrancar codificación de FASE 1A.** Resolver primero.

---

## 1 · Secuenciamiento por etapas

```
ETAPA 0 — Pre-flight (sin código)
├── 0.1 Confirmación de pre-condiciones
├── 0.2 Decisiones del usuario sobre preguntas abiertas
├── 0.3 GATE 0 ✅ — aprobación para empezar etapa 1
│
ETAPA 1 — Backend: schema + data layer (sin UI)
├── 1.1 Crear branch + escribir SQL 0014 (local, no aplicar)
├── 1.2 Lint idempotencia + dry-run en sandbox
├── 1.3 Tests RLS T1-T12 en sandbox
├── 1.4 Crear `src/lib/billing/` con types + helpers
├── 1.5 Crear API routes con RBAC + rate-limit
├── 1.6 Unit tests data layer
├── 1.7 GATE 1 ✅ — schema validado en sandbox
│
ETAPA 2 — Motor recurrente (sin UI)
├── 2.1 Implementar `recurring/engine.ts` (cálculo + emisión)
├── 2.2 Implementar `recurring/scheduler.ts` (cron entry point)
├── 2.3 Implementar idempotencia (UNIQUE + dry-run flag)
├── 2.4 Tests de integración (sandbox ARCA mock)
├── 2.5 Smoke test manual: crear contrato vía API → trigger run → verificar factura
├── 2.6 GATE 2 ✅ — motor funcional en sandbox
│
ETAPA 3 — UI Facturación
├── 3.1 Refactor `/billing` a shell con tabs
├── 3.2 `/billing/recurrentes` lista + wizard
├── 3.3 `/billing/clientes` + cuenta corriente
├── 3.4 `/billing/cobros` wizard
├── 3.5 `/billing/vencimientos`
├── 3.6 Tests UI + a11y
├── 3.7 GATE 3 ✅ — UI completa en sandbox
│
ETAPA 4 — Dashboard ejecutivo
├── 4.1 Widgets MRR/ARR/cobranza/morosos
├── 4.2 Tests
├── 4.3 GATE 4 ✅ — dashboard listo
│
ETAPA 5 — Sandbox a producción
├── 5.1 Pre-flight checks (backup, RBAC seed, tests sandbox)
├── 5.2 Aplicar migration 0014 en producción
├── 5.3 Deploy Netlify
├── 5.4 Smoke tests producción
├── 5.5 GATE 5 ✅ — sistema vivo
│
ETAPA 6 — Operación supervisada (30 días)
├── 6.1 Monitor de runs + alertas
├── 6.2 Validación mensual con Ruth
├── 6.3 Ajustes según feedback real
├── 6.4 GATE 6 ✅ — FASE 1A cerrada
```

**Cada gate requiere aprobación explícita del usuario.** No avanzar sin OK.

---

## 2 · Etapa 1 · Backend schema + data layer

### 2.1 Crear branch

```bash
# No ejecutar todavía
git switch -c feature/fase-1a-recurring-billing  # desde HEAD 4d1dbff
```

### 2.2 Escribir SQL 0014

Implementar **literal** lo descrito en `FASE-1A-MIGRATION-0014.md`. Archivo target:

```
supabase/migrations/0014_recurring_billing_and_customer_accounts.sql
```

**Lint pre-commit:**

```bash
# Pseudo-script
grep -E "^create (table|type)" 0014_*.sql | grep -v "if not exists\|do \$\$" && echo "VIOLATIONS" || echo "OK"
```

Todo `create` debe estar guardado por `if not exists` o `do$$ exception when duplicate_object$$`.

### 2.3 Dry-run en sandbox

```bash
# En sandbox Supabase
supabase db reset --linked  # reset sandbox
supabase migration up --linked
# Ejecutar tests T1-T12
supabase migration up --linked  # segunda vez — debe ser no-op (idempotente)
```

### 2.4 Tests RLS T1-T12

Para cada test de `FASE-1A-RLS.md §5`:

```sql
-- Pseudo, ejemplo T1
set local role authenticated;
set local request.jwt.claims = '{"sub":"user-A-uuid"}';  -- user con client_id=A
select * from recurring_contracts;  -- esperar: solo rows con client_id=A
```

Documentar resultados en `docs/erp/FASE-1A-RLS-SANDBOX-RESULTS.md`.

### 2.5 Crear `src/lib/billing/`

Estructura propuesta:

```
src/lib/billing/
├── index.ts                ← re-exports
├── types.ts                ← contratos TS espejo de tablas SQL
├── recurring/
│   ├── engine.ts           ← cálculo + emisión de 1 contrato
│   ├── scheduler.ts        ← cron entry point
│   ├── validation.ts       ← zod schemas
│   └── data.ts             ← CRUD contratos + lines + runs
├── accounts/
│   ├── balance.ts          ← query view customer_balances
│   ├── transactions.ts     ← CRUD append-only
│   └── data.ts
├── payments/
│   ├── data.ts             ← CRUD payments + applications
│   ├── auto-apply.ts       ← FIFO/LIFO
│   └── validation.ts
├── late-fees/
│   ├── calculator.ts       ← compounding SIMPLE/COMPUESTO
│   ├── cron.ts             ← daily run
│   └── data.ts
├── terms/
│   └── data.ts             ← CRUD payment_terms
├── storage.ts              ← buildReceiptPath, buildContractPath
└── format.ts               ← fmtCurrency, fmtPeriod, etc.
```

### 2.6 API routes

Estructura:

```
src/app/api/billing/
├── recurring/
│   ├── contracts/route.ts          GET list / POST create
│   ├── contracts/[id]/route.ts     GET / PATCH / DELETE
│   ├── contracts/[id]/lines/route.ts
│   ├── contracts/[id]/run/route.ts POST trigger manual
│   ├── runs/route.ts               GET list
│   └── cron/route.ts               POST scheduled function entry
├── accounts/
│   ├── [clientId]/balance/route.ts
│   ├── [clientId]/transactions/route.ts
│   └── [clientId]/route.ts         GET/PATCH customer_accounts
├── payments/
│   ├── route.ts                    POST create, GET list
│   ├── [id]/route.ts
│   ├── [id]/confirm/route.ts       POST
│   ├── [id]/void/route.ts          POST
│   └── [id]/apply/route.ts         POST
├── late-fees/
│   ├── rules/route.ts
│   ├── cron/route.ts               POST scheduled function
│   └── charges/route.ts
└── terms/route.ts
```

Cada handler aplica:
- `requireBillingPermission(req, "billing.X", requestId)` (helper a crear, espejo de `requireDrivePermission`)
- `rateLimit(...)` (60/min default)
- Structured logging `logBilling(...)`
- Manejo de errores con `BillingError` class

### 2.7 Unit tests data layer

Usar Vitest o lo que ya use el proyecto. Cobertura objetivo:
- `recurring/engine.ts`: 100% (cálculos críticos)
- `payments/auto-apply.ts`: 100% (FIFO/LIFO + edge cases)
- `late-fees/calculator.ts`: 100% (compounding)
- `accounts/balance.ts`: smoke

### 2.8 GATE 1 — checklist

- [ ] Migration 0014 aplicada en sandbox sin errores
- [ ] Migration 0014 re-aplicada en sandbox sin errores (idempotencia OK)
- [ ] Tests T1-T12 RLS PASS
- [ ] Unit tests data layer PASS
- [ ] Branch comiteada localmente (sin push)
- [ ] Build local + typecheck verdes
- [ ] Reporte sandbox en `docs/erp/FASE-1A-SANDBOX-REPORT.md`

→ Esperar aprobación del usuario para ETAPA 2.

---

## 3 · Etapa 2 · Motor recurrente

### 3.1 `recurring/engine.ts`

Función principal:

```ts
// pseudocódigo
async function runContract(contractId: string, options: {
  triggeredBy: 'CRON' | 'MANUAL' | 'BACKFILL'
  dryRun?: boolean
  periodOverride?: string
  userId?: string
}): Promise<RunResult> {
  // 1. Lock idempotente: INSERT recurring_runs con PENDIENTE
  //    UNIQUE viola → ya hay un run → skip
  // 2. Validar: contract.status='ACTIVO', lines activas, cliente !stop_billing
  //    Si NOK → run = SKIPPED con razón, return
  // 3. Calcular total estimado + cotización snapshot
  // 4. Si dryRun → return preview, no crear factura
  // 5. Crear customer_invoices BORRADOR usando lib/invoicing/calc + emit
  // 6. Si contract.auto_emit → emit.ts dispara ARCA WSFEv1
  //    Si ERROR → run = FAILED con error_message
  //    Si OK → customer_invoices.estado = AUTORIZADO_ARCA
  // 7. Crear customer_transactions INSERT (type=INVOICE, direction=DEBIT)
  // 8. Update recurring_runs status=OK, invoice_id=...
  // 9. Update contract.next_run_date = calcNext(periodo, freq)
  // 10. Return RunResult
}
```

### 3.2 `recurring/scheduler.ts` — cron entry

```ts
// pseudocódigo
export async function runScheduledRecurringBatch(): Promise<BatchResult> {
  // 1. Validar es invocación de cron (header secret de Netlify)
  // 2. Query: contracts where status='ACTIVO' and next_run_date <= today
  // 3. Para cada: try await runContract(id, {triggeredBy:'CRON'}) catch → log
  // 4. Notificar a Ruth + JL con sumario (OK/Failed/Skipped)
  // 5. Return BatchResult
}
```

Netlify `netlify.toml`:

```toml
[[scheduled.functions]]
  path = "/api/billing/recurring/cron"
  schedule = "0 9 1 * *"  # 09:00 ART día 1 de cada mes
```

### 3.3 Tests motor

Casos:
- Run normal con contrato mensual → factura BORRADOR generada
- Run con auto_emit=true → CAE obtenido (mock)
- Run duplicado del mismo período → UNIQUE viola, skip
- Run contrato pausado → SKIPPED
- Run cliente con stop_billing → SKIPPED
- Run contrato sin líneas → FAILED
- Run con cotización fallback → OK con cotizacion_fija
- Run en período fuera de start/end_date → SKIPPED
- Dry-run → no crea factura, retorna preview

### 3.4 Smoke manual sandbox

1. Crear cliente test
2. Crear contrato mensual USD 1.000 con 1 línea
3. POST `/api/billing/recurring/contracts/{id}/run` con MANUAL
4. Verificar:
   - run row OK
   - factura BORRADOR creada
   - customer_transactions row INSERT con type=INVOICE
   - customer_balances.balance_pes refleja saldo
5. Confirmar factura manualmente (vía emit existing)
6. Crear payment + aplicación
7. Verificar saldo bajó

### 3.5 GATE 2 — checklist

- [ ] Motor pasa todos los tests
- [ ] Smoke manual en sandbox completo OK
- [ ] Idempotencia validada (run 2 veces mismo período → 1 factura)
- [ ] Cron scheduled function configurada localmente para test
- [ ] Reporte en `docs/erp/FASE-1A-ENGINE-REPORT.md`

→ Esperar aprobación para ETAPA 3.

---

## 4 · Etapa 3 · UI Facturación

### 4.1 Refactor `/billing` a shell con tabs

- Mover listado actual a `/billing/emitidas`
- Crear `/billing/page.tsx` shell con tabs y KPI cards (top)
- Componente compartido `<BillingTopKpis>` para el header

### 4.2 `/billing/recurrentes`

- Lista con filtros por status
- Componente `<RecurringContractWizard>` (5 steps)
- Detalle `[id]` con tabs Líneas/Runs/Facturas/Auditoría
- Acciones: pausar, reanudar, cancelar, run manual, duplicar

### 4.3 `/billing/clientes`

- Lista con `<AgedReceivablesTable>`
- Detalle `[clientId]` con `<CustomerAccountSummary>` + tabs

### 4.4 `/billing/cobros`

- Lista paginada
- Wizard 3 steps
- `<PaymentApplicationTable>` con FIFO sugerido

### 4.5 `/billing/vencimientos`

- Buckets crítico/atención/próximo
- Acciones por factura: recordatorio email / aplicar mora / ver factura

### 4.6 Tests UI

- React Testing Library para componentes
- Snapshots de wizards
- A11y con axe-core

### 4.7 GATE 3 — checklist

- [ ] Todas las pantallas renderizan en sandbox sin errores
- [ ] Wizards funcionan end-to-end
- [ ] Mobile responsive validado
- [ ] A11y > 95% Lighthouse
- [ ] Build + typecheck verdes

---

## 5 · Etapa 4 · Dashboard ejecutivo

### 5.1 Widgets

Componentes nuevos en `src/components/billing/` o `src/components/ejecutivo/`:

- `<MRRWidget>`
- `<FacturacionMesWidget>`
- `<ProyeccionWidget>`
- `<CobranzaPendienteWidget>`
- `<ClientesMorososWidget>`

### 5.2 Integración en `/ejecutivo`

Añadir nuevo `<section>` con grid de los widgets, **sin tocar widgets existentes**.

### 5.3 GATE 4 — checklist

- [ ] Widgets cargan en <2s
- [ ] Datos coinciden con queries directas
- [ ] No regresan KPIs existentes

---

## 6 · Etapa 5 · Sandbox a producción

### 6.1 Pre-flight producción

- [ ] **Backup Supabase prod verificado en restore en sandbox separado** (RG5)
- [ ] RBAC seedeado para Director + Admin en producción
- [ ] Tests sandbox 100% PASS en últimos 7 días
- [ ] Plan de rollback documentado y validado en sandbox
- [ ] Horario de baja actividad (madrugada) acordado

### 6.2 Aplicar 0014 en producción

```bash
# No ejecutar sin aprobación explícita
supabase migration up --linked --include-all  # solo 0014
supabase migration list  # verificar 0014 applied
```

### 6.3 Deploy Netlify

```bash
# Build local
npm run build
# Deploy con env vars de billing si hay alguna nueva
NETLIFY_AUTH_TOKEN=... npx netlify deploy --prod --dir=.next
```

### 6.4 Smoke tests producción

| Test | Comando |
|------|---------|
| `/api/billing/recurring/contracts` GET (no auth) | esperar 401 |
| `/api/billing/recurring/contracts` GET (auth admin) | esperar 200 con [] o lista existente |
| `/billing` UI carga | navegador autenticado |
| Tests T1-T12 RLS en producción | scripts |
| 1 contrato test con dry-run | esperar OK |

### 6.5 GATE 5 — checklist

- [ ] Migration aplicada sin errores
- [ ] Deploy verde
- [ ] Smoke tests todos PASS
- [ ] Tests RLS T1-T12 PASS en prod

---

## 7 · Etapa 6 · Operación supervisada (30 días)

### 7.1 Monitoreo

- Alertas en Slack/email por:
  - Run FAILED
  - Discrepancia entre `customer_transactions` y suma de aplicaciones
  - Latencia > 1s en `/billing/clientes`
  - Errores ARCA repetidos
- Dashboard ops privado con todas las métricas (no en `/ejecutivo`)

### 7.2 Validación con Ruth

- Semanal: revisión de runs + cobros + CC
- Discrepancias vs Excel histórico → fix individual + análisis raíz

### 7.3 Ajustes según feedback

- Bugs no críticos: hot-fix con deploy progresivo
- Cambios de UX: documentar y deployear en bach semanal
- Cambios de schema: requiere migration 0015+

### 7.4 GATE 6 — checklist (criterios de cierre FASE 1A)

- [ ] ≥30 días sin issues críticos
- [ ] ≥3 contratos recurrentes activos
- [ ] Discrepancia CC <1% vs Excel
- [ ] Cero leaks reportados
- [ ] Ruth firma "OK funcional"
- [ ] JL firma "OK ejecutivo"
- [ ] Reporte de cierre `docs/erp/FASE-1A-CLOSURE-REPORT.md`

---

## 8 · Estimación de tiempo

| Etapa | Estimado | Notas |
|-------|----------|-------|
| ETAPA 0 (pre-flight) | 1-2 semanas | depende de RG5 backup + decisiones |
| ETAPA 1 (schema + data) | 2 semanas | SQL + tests + libs |
| ETAPA 2 (motor) | 2-3 semanas | engine + scheduler + tests |
| ETAPA 3 (UI) | 3-4 semanas | 5 pantallas + wizards |
| ETAPA 4 (dashboard) | 1 semana | 5 widgets |
| ETAPA 5 (deploy) | 2-3 días | tests + cuts |
| ETAPA 6 (supervisión 30d) | 30 días calendario | passive monitoring |

**Total cronograma:** ~12-14 semanas calendario (3-3.5 meses) con 1 dev + 1 PO part-time.

---

## 9 · Recursos necesarios

| Recurso | Cantidad |
|---------|----------|
| Dev full-stack | 1 (Staff o Senior) |
| Product Owner / Ruth | 4 hrs/semana para feedback |
| DevOps | 1 día setup (backup + sandbox + scheduled fn) + soporte |
| QA / Tester | 1 día por etapa para validación |
| Diseñador UI | opcional — wireframes ya en UX doc |
| Acceso a sandbox Supabase | separado de prod |

---

## 10 · Riesgos del plan

| Riesgo | Mitigación |
|--------|------------|
| ETAPA 0 se atasca (backup demora) | bloquear y resolver primero — no skip |
| ETAPA 1 detecta gap en data model | volver a docs/erp, actualizar, re-aprobar |
| ARCA prod no responde al cutover | mantener sandbox + flag para volver |
| Equipo se distrae con otros gates (ej Drive integration) | priorización explícita por gate |
| Ruth no tiene tiempo para feedback | bloquear ETAPA 6 hasta que esté |

---

## 11 · Convenciones de PR / commits durante implementación

- 1 PR por etapa máximo
- Commit prefix: `feat(fase-1a):`, `fix(fase-1a):`, `docs(fase-1a):`
- Cada PR debe linkear al doc de la etapa correspondiente
- Code review obligatorio antes de merge (incluso si solo es 1 dev)
- CI: typecheck + build + unit tests + lint mig 0014 idempotencia

---

## 12 · Plan de aprobaciones requeridas

| # | Aprobación | Persona | Doc/gate |
|---|------------|---------|----------|
| 1 | Scope FASE 1A | Usuario | esta serie de 9 docs |
| 2 | Decisiones preguntas abiertas | Usuario | `FASE-1A-AUDIT.md §8` |
| 3 | Pre-condiciones cerradas | Usuario + DevOps | sección 0 de este doc |
| 4 | GATE 1 (schema + data) | Usuario | etapa 2 |
| 5 | GATE 2 (motor) | Usuario | etapa 3 |
| 6 | GATE 3 (UI) | Usuario + Ruth | etapa 4 |
| 7 | GATE 4 (dashboard) | Usuario + JL | etapa 5 |
| 8 | GATE 5 (deploy prod) | Usuario + DevOps | etapa 6 |
| 9 | GATE 6 (cierre FASE 1A) | Usuario + Ruth + JL | post-30d |

**Cada aprobación es explícita y se documenta.** Sin saltos.

---

## 13 · Documentos a generar durante implementación

| Fase | Doc nuevo |
|------|-----------|
| ETAPA 1 | `docs/erp/FASE-1A-SANDBOX-REPORT.md` (resultado tests T1-T12) |
| ETAPA 2 | `docs/erp/FASE-1A-ENGINE-REPORT.md` (validación motor) |
| ETAPA 3 | `docs/erp/FASE-1A-UI-REPORT.md` (a11y + perf + screenshots) |
| ETAPA 4 | `docs/erp/FASE-1A-DASHBOARD-REPORT.md` |
| ETAPA 5 | `docs/erp/FASE-1A-DEPLOY-REPORT.md` |
| ETAPA 6 | `docs/erp/FASE-1A-CLOSURE-REPORT.md` |

---

## 14 · Lo que NO entra en FASE 1A (debe quedar explícito)

| Excluido | Por qué |
|----------|---------|
| Tesorería (treasury_*) | FASE 3 — out of scope |
| Contabilidad / asientos automáticos | FASE 4 — out of scope |
| ARCA producción | sigue sandbox; gate de FASE 5 |
| Padrón AFIP validation | FASE 5 |
| Retenciones IVA/Ganancias/IIBB | FASE 5 |
| Vendor invoices + OCR | FASE 2 |
| Portal cliente externo | post-MVP |
| App móvil | out of scope |
| Email recordatorio automático de mora | FASE 1B (opcional siguiente) |
| Multi-currency completo | currency básico en este, ampliación futura |
| Indexación por inflación | flag existe en `recurring_contract_lines.apply_indexacion` pero motor lo ignora |

---

## 15 · Resumen ejecutivo del plan

```
ESTADO ACTUAL                                    OBJETIVO POST FASE 1A
─────────────────────                            ─────────────────────────────
- Facturación manual desde OS                    - Motor recurrente automático
- Cuenta corriente en Excel                      - CC integrada real-time
- Cobros registrados a mano                      - Wizard de cobros con FIFO
- Mora calculada a ojo                           - Cron diario con reglas
- MRR/ARR no visibles                            - Dashboard ejecutivo nuevo
- Sin trazabilidad fiscal de movimientos         - Append-only ledger auditable
- Riesgo de doble emisión                        - UNIQUE idempotencia garantizada

PRE-CONDICIONES BLOQUEANTES
─────────────────────────────
✗ Backup externo Supabase
✗ RBAC seedeado mínimo
⏳ Decisiones del usuario
⏳ Aprobación de docs

CRONOGRAMA
─────────────────────────────
~12-14 semanas calendario · 6 gates explícitos · 6 reportes documentales

RIESGOS PRINCIPALES
─────────────────────────────
🚨 Backup no verificado
🚨 RLS view leak
🚨 Doble facturación
🔴 RBAC dormido bypass
🔴 Cotización errónea
🔴 Auto-emit sin revisión

GATES TOTALES
─────────────────────────────
GATE 0 — Pre-flight
GATE 1 — Schema OK sandbox
GATE 2 — Motor OK sandbox
GATE 3 — UI OK sandbox
GATE 4 — Dashboard OK
GATE 5 — Deploy prod
GATE 6 — Cierre 30d
```

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR — solo plan
- 🛑 NO EJECUTAR MIGRACIONES
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO TOCAR producción
- 🛑 NO TOCAR credenciales
- 🛑 NO TOCAR Drive · ARCA · RBAC
- 🛑 NO INVENTAR plazos sin justificación

---

# DETENERSE

Los 9 entregables están listos en `docs/erp/`:

1. ✅ `FASE-1A-AUDIT.md`
2. ✅ `FASE-1A-DATA-MODEL.md`
3. ✅ `FASE-1A-RELATIONS.md`
4. ✅ `FASE-1A-RLS.md`
5. ✅ `FASE-1A-MIGRATION-0014.md`
6. ✅ `FASE-1A-UX.md`
7. ✅ `FASE-1A-RISKS.md`
8. ✅ `FASE-1A-IMPACT.md`
9. ✅ `FASE-1A-IMPL-PLAN.md` (este)

**Esperando aprobación explícita antes de escribir una sola línea de código.**

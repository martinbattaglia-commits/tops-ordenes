# FASE 1B · ROLLOUT — Estrategia de despliegue

> ⚠️ **AMENDMENT APLICADO 2026-05-29 — MONEDA ARS ÚNICA**
> Las secciones que mencionan **Cron 3 (Exchange Rate)** y **feature flag `BILLING_EXCHANGE_RATE_FORCE_FALLBACK`** quedan **superseded** por `docs/erp/FASE-1B-AMENDMENT-ARS-ONLY.md`.
> - **2 crons activos** (no 3): recurring 09:00 ART día 1 + late-fees 07:00 ART diario
> - **7 feature flags** (no 8)
> - Migration 0014 sin tabla `exchange_rates_log` (1 tabla menos = 9 en lugar de 10)
> - Cronograma: ~12 semanas (no 14)
> Resto del documento sigue vigente.

**Scope:** secuenciamiento de migraciones, cron jobs, RBAC, feature flags y deployment.
**Estado:** diseño · sin implementación.
**Restricciones:** sin ejecutar nada. Documento de referencia para fase de implementación futura.

---

## 1 · Estrategia general

| Principio | Aplicación |
|-----------|------------|
| **Aditivo siempre** | Cero break de funcionalidad existente |
| **Gates de aprobación explícitos** | 7 gates documentados (E0 → E11) |
| **Dark-launch primero** | Schema + libs sin UI activa antes de exponer |
| **Feature flags por módulo** | Recurrente / Directa / Mora / Dashboard controlables independientemente |
| **Reversibilidad** | Down-migration comentada + plan de rollback por gate |
| **Idempotencia** | Migraciones reaplicables sin destruir datos |
| **Monitoring antes de UX** | Alertas operativas configuradas antes de exponer a Ruth |
| **Cohorte pequeña antes de masivo** | 1-3 contratos test antes de 30+ |

---

## 2 · Secuencia de migraciones

### 2.1 Numeración

```
0001-0013   APLICADAS     (no tocar)
0012        RESERVADA     (skip)
0014        FASE 1A       ← propuesta esta serie
0015-0019   reservados    para FASE 1B follow-ups, FASE 2-5
```

### 2.2 Contenido de 0014

Bloque único (no se divide). El SQL completo está diseñado en `FASE-1A-MIGRATION-0014.md` + ajustes V1.1 documentados en `FASE-1B-MODULES.md §0`:

1. Enums (10)
2. payment_terms (catálogo + seeds)
3. exchange_rates_log (nuevo de 1B)
4. recurring_contracts
5. recurring_contract_lines
6. recurring_runs
7. customer_accounts (+ auto-create trigger)
8. customer_transactions (+ lock trigger)
9. customer_payments (+ lock trigger)
10. customer_payment_applications (+ validation trigger)
11. late_fee_rules (+ seed default)
12. customer_late_fee_charges
13. View customer_balances
14. RBAC permissions + role_permissions (9 slugs)
15. RLS por tabla (~25 policies)
16. Storage buckets `receipts` + `contracts` con multi-tenant RLS
17. Realtime publications (3 tablas)
18. Down-migration comentada

### 2.3 Orden cronológico de aplicación

| # | Paso | Cuándo | Persona |
|---|------|--------|---------|
| 1 | Apply en sandbox separado | E1.H02 | DevOps |
| 2 | Re-apply (idempotencia) | E1.H02 | DevOps |
| 3 | Tests T1-T12 en sandbox | E1.H02 | Dev + DevOps |
| 4 | Documentar resultados | E1.H02 | Dev |
| 5 | Apply en prod | E10.H02 | DevOps + Dev (pair) |
| 6 | Smoke tests prod | E10.H04 | Dev |

### 2.4 Política de re-aplicación

Si por algún motivo 0014 falla mid-way en producción:
- Si tabla X creada pero RLS no aplicada → re-run del bloque entero (idempotencia esperada)
- Si trigger creado pero error en seeds → idem
- Si error de FK porque tabla referenciada no existe → bug en orden del SQL → fix + re-run

**NUNCA hacer**:
- `DROP TABLE customer_transactions` en prod (datos perdidos)
- Modificar 0014 después de haber sido aplicada — escribir 0015 con el ajuste

---

## 3 · Cron jobs

### 3.1 Cron 1 · Recurring batch mensual

**Path:** `/api/billing/recurring/cron`
**Schedule UTC:** `0 12 1 * *` (12:00 UTC = 09:00 ART, día 1 de cada mes)
**Auth:** header `X-Netlify-Scheduled-Function: true` + secret env var
**Comportamiento:**
- Detecta contratos `ACTIVO` con `next_run_date <= today`
- Loop con `runContract()` para cada
- Email summary a Ruth + JL
- Logs estructurados a Netlify Functions

**Configuración `netlify.toml`:**
```toml
[[scheduled.functions]]
  path = "/api/billing/recurring/cron"
  schedule = "0 12 1 * *"
```

**Env vars requeridas:**
- `NETLIFY_SCHEDULED_FUNCTION_SECRET` (Netlify auto-genera, verificar)
- `EMAIL_NOTIFY_ADMIN` (Ruth)
- `EMAIL_NOTIFY_DIRECTOR` (JL)

### 3.2 Cron 2 · Late fees diario

**Path:** `/api/billing/late-fees/cron`
**Schedule UTC:** `0 10 * * *` (10:00 UTC = 07:00 ART, diario)
**Auth:** ídem cron 1
**Comportamiento:**
- Detecta facturas vencidas con saldo pendiente
- Aplica regla por cliente (o default 3% mensual)
- Insert charges + transactions
- Email summary diario a Ruth (solo si hubo cargos)

**Configuración `netlify.toml`:**
```toml
[[scheduled.functions]]
  path = "/api/billing/late-fees/cron"
  schedule = "0 10 * * *"
```

### 3.3 Cron 3 · Exchange rate cache (opcional)

**Path:** `/api/billing/exchange-rate/refresh` (POST sin body)
**Schedule UTC:** `0 11 * * 1-5` (08:00 ART, lunes-viernes)
**Propósito:** pre-cargar cotización del día antes del cron recurrente (09:00 ART)
**Necesario?:** opcional — `getRateForDate()` ya hace lazy fetch si no hay cache. Pero pre-warm evita race.

**Recomendación:** habilitar en FASE 1B, deshabilitar si no aporta.

### 3.4 Monitoreo de crons

| Cron | Métrica | Alerta si |
|------|---------|-----------|
| Recurring batch | Última ejecución exitosa | > 32 días sin run OK |
| Late fees | Última ejecución exitosa | > 2 días sin run OK |
| Exchange rate | Pre-warm OK | falla > 3 días seguidos |

Implementación: webhook a Slack/email + dashboard ops privado.

---

## 4 · RBAC progresivo

### 4.1 Asignación de permisos por rol

Migración 0014 sección `RBAC` propuesta:

| Rol slug | Permisos billing.* |
|----------|---------------------|
| `director` | TODOS (9) |
| `administracion` | TODOS excepto `delete` (8) |
| `operaciones` | `view`, `payments.register` (2) |
| `comercial` | `view` (1) |
| `supervisor` | `view`, `recurring.manage` (2) |
| `auditor` | `view` (1) |
| `deposito` | ninguno |
| `cliente` (externo) | ninguno (RLS expone sus datos sin slug) |

### 4.2 Seed de user_roles para Director + Admin (pre-deploy)

Antes de aplicar 0014 a prod, debe estar seedeada al menos:

```sql
-- Ejecutar en producción ANTES de 0014:
insert into public.user_roles (user_id, role_id, position_title)
values
  ('<jl-user-id>', (select id from roles where slug='director'), 'Director de Operaciones'),
  ('<ruth-user-id>', (select id from roles where slug='administracion'), 'Administración Verotin')
on conflict (user_id, role_id) do nothing;
```

**Por qué pre-deploy:**
- R22 closure: si `user_roles` está vacío globally → fail-open (todos pasan, log warn).
- Si seedeado para 2 personas pero un 3ero entra → fail-closed (denied) → bueno.
- Si NO seedeado al deploy → fail-open continúa hasta que se seedee → ventana de exposición.

**Decisión:** seedear ANTES de 0014 para minimizar ventana fail-open.

### 4.3 Rollout progresivo de permisos

| Etapa | Roles con billing.view | Roles con billing.create |
|-------|------------------------|--------------------------|
| 0 (pre-deploy) | director, administracion (seedeados) | director, administracion |
| 1 (deploy 0014) | + supervisor, auditor, comercial, operaciones | + ninguno nuevo |
| 2 (semana 2) | sin cambio | sin cambio |
| 3 (semana 4) | sin cambio | sin cambio |

**Permisos restantes** (`recurring.manage`, `payments.apply`, etc.) — seedeados en 0014 pero ningún usuario los recibe hasta que admin explícitamente asigna roles.

### 4.4 Política de revisión de permisos

- Mensual: review de `user_roles` por admin (JL)
- Trimestral: audit de roles vs función real (eliminar permisos sobrantes)

---

## 5 · Feature flags

### 5.1 Estrategia

Usar env vars de Netlify + check en lib/UI para activar/desactivar features sin redeploy de código.

### 5.2 Flags propuestas

| Flag | Default | Controla |
|------|---------|----------|
| `NEXT_PUBLIC_BILLING_RECURRING_ENABLED` | `false` | Mostrar tab "Recurrentes" en `/billing` |
| `NEXT_PUBLIC_BILLING_DIRECT_ENABLED` | `false` | Mostrar wizard `/billing/directa/nueva` |
| `NEXT_PUBLIC_BILLING_LATE_FEES_ENABLED` | `false` | Aplicar cron mora |
| `NEXT_PUBLIC_BILLING_KPI_WIDGETS_ENABLED` | `false` | Mostrar widgets en `/ejecutivo` |
| `NEXT_PUBLIC_BILLING_AUTO_EMIT_GLOBAL_KILLSWITCH` | `false` | Si `true`, NINGÚN contrato puede auto_emit (override) |
| `BILLING_EXCHANGE_RATE_FORCE_FALLBACK` | `false` | Server-side: forzar fallback a cotizacion_fija (test) |
| `BILLING_CRON_RECURRING_DISABLED` | `false` | Si `true`, cron retorna sin procesar |
| `BILLING_CRON_LATE_FEES_DISABLED` | `false` | Idem |

### 5.3 Implementación

```ts
// src/lib/billing/flags.ts
export const BillingFlags = {
  recurringEnabled: process.env.NEXT_PUBLIC_BILLING_RECURRING_ENABLED === 'true',
  directEnabled: process.env.NEXT_PUBLIC_BILLING_DIRECT_ENABLED === 'true',
  // ...
} as const
```

UI condicional:
```tsx
{BillingFlags.recurringEnabled && <Tab href="/billing/recurrentes">Recurrentes</Tab>}
```

API condicional:
```ts
if (process.env.BILLING_CRON_RECURRING_DISABLED === 'true') {
  return NextResponse.json({ ok: true, skipped: true, reason: 'killswitch' })
}
```

### 5.4 Plan de activación de flags

| Día | Flag activado | Impacto |
|-----|---------------|---------|
| Día 0 (deploy 0014) | ninguno | Schema en prod, UI invisible |
| Día +1 | `NEXT_PUBLIC_BILLING_KPI_WIDGETS_ENABLED=true` | JL ve dashboard widgets |
| Día +3 | `NEXT_PUBLIC_BILLING_DIRECT_ENABLED=true` | Ruth puede crear facturas directas |
| Día +5 | `NEXT_PUBLIC_BILLING_RECURRING_ENABLED=true` | Ruth crea primer contrato test |
| Día +7 | `recurring/cron` activado | primer run automático (con 1 contrato) |
| Día +14 | onboarding completo | escala a 5+ contratos reales |
| Día +21 | `NEXT_PUBLIC_BILLING_LATE_FEES_ENABLED=true` | mora activa después de validar fechas vencimiento |

---

## 6 · Estrategia de rollout por cohorte

### 6.1 Onboarding de contratos

**Semana 1 post-deploy:**
- Cohorte 1: 1 contrato test (cliente test, montos chicos, auto_emit=false)
- Validar: PDF correcto, ARCA OK, CC actualiza, email Ruth llega

**Semana 2:**
- Cohorte 2: 2-3 contratos reales (ANMAT bidcom, ANMAT bagó, 1 oficina)
- Migrar de Excel a sistema en paralelo (dual-run)

**Semana 3-4:**
- Cohorte 3: 5-10 contratos reales adicionales (gradualmente)

**Mes 2:**
- Cohorte 4: el resto (30+ contratos) onboarded

### 6.2 Dual-run protocol (semana 1-4)

Mientras Ruth mantiene Excel histórico en paralelo:
- Cada cierre mensual: comparar saldo sistema vs Excel
- Discrepancia <1% → OK, continuar
- Discrepancia > 1% → pausar onboarding, debug

### 6.3 Punto de no-retorno

Al **mes 3** post-deploy: Excel se archive, sistema es la verdad oficial. Ruth deja de actualizar Excel.

---

## 7 · Deployment pipeline

### 7.1 Branch + PR strategy

```
main                                    (producción)
  └── feature/nexus-fullstack            (estado actual, no afectado)
        └── feature/fase-1a-recurring-billing   (FASE 1A trabajo)
              ├── feat/0014-migration        (PR 1: schema)
              ├── feat/billing-libs          (PR 2: data + types + logger)
              ├── feat/exchange-rate         (PR 3: BCRA + cache)
              ├── feat/recurring-engine      (PR 4: motor)
              ├── feat/invoices-direct       (PR 5: facturación directa)
              ├── feat/accounts-cc           (PR 6: cuenta corriente)
              ├── feat/payments              (PR 7: cobros)
              ├── feat/late-fees             (PR 8: mora)
              ├── feat/billing-ui            (PR 9: pantallas)
              ├── feat/dashboard-widgets     (PR 10: cockpit)
              └── feat/deploy-config         (PR 11: netlify.toml + envs)
```

Cada PR se mergea a `feature/fase-1a-recurring-billing` (branch acumuladora). Al cerrar GATE 5, merge final a `feature/nexus-fullstack` y deploy.

### 7.2 CI pipeline

Por cada PR:
- `npm run typecheck` (obligatorio)
- `npm run build` (obligatorio)
- `npm run test` (unit tests)
- Lint migration 0014 idempotencia
- Code review aprobado
- Build size delta < 100 KB acceptable

### 7.3 Deploy environments

| Env | Branch | URL | Auto-deploy |
|-----|--------|-----|-------------|
| Sandbox Supabase | `feature/fase-1a-recurring-billing` | preview Netlify | sí (cada commit) |
| Staging (opcional) | tag `staging-*` | URL específica | manual |
| Producción | `feature/nexus-fullstack` (current) o `main` (futuro) | tops-ordenes.netlify.app | manual |

### 7.4 Comando de deploy producción

```bash
# Sin ejecutar
cd /Users/martinbattaglia/CODE/tops-ordenes
npm run build
npx netlify deploy --prod --dir=.next --message="FASE 1A v1.0 — recurring billing live"
```

---

## 8 · Plan de comunicación

### 8.1 Stakeholders

| Stakeholder | Tipo de comunicación | Frecuencia |
|-------------|----------------------|------------|
| JL (Director) | Status report ejecutivo | Semanal pre-deploy, mensual post |
| Ruth (Admin) | Demo + feedback session | Pre-deploy: 2 sesiones. Post: weekly |
| Operaciones | Email informativo | 1x antes de deploy + 1x post |
| Comercial | Email informativo | 1x post-deploy |
| Compliance/DT | No notificación específica | — |
| Contador externo | Aviso de plan (FASE 4 mención) | 1x cuando se inicie FASE 4 |
| Cliente externo | Sin notificación | Las facturas siguen igual |

### 8.2 Template email post-deploy a Ruth

```
Asunto: TOPS NEXUS — Facturación recurrente lista para usar

Ruth,

A partir de hoy podés acceder al nuevo módulo de facturación:

📍 tops-ordenes.netlify.app/billing

Funcionalidades disponibles:
✓ Contratos recurrentes (ANMAT, oficinas, cargas generales)
✓ Cuenta corriente por cliente con saldo real-time
✓ Wizard de cobros con aplicación FIFO automática
✓ Vencimientos clasificados por criticidad
✓ Facturación directa (sin OS)

Primera semana:
- Crear 1 contrato test (te ayudo)
- Validar PDF + email
- Continuar tu Excel en paralelo (dual-run 1 mes)

Próxima reunión: [fecha]

— Equipo NEXUS
```

### 8.3 Template alerta diaria (post-deploy)

A email Ruth, 09:30 ART día 1 de cada mes:

```
Asunto: 🟢 NEXUS — Facturación recurrente del mes ejecutada

Resumen del run automático del [día]:
✓ 11 contratos facturados OK ($X.XXX.XXX total)
⚠ 1 contrato SKIPPED:
  - C-X — cliente con stop_billing activado
⚠ 1 contrato FAILED:
  - C-Y — ARCA rechazó: "<reason>"

Para revisar y emitir manualmente:
[link a /billing/recurrentes/aprobaciones]

Cotización USD usada: $1.300,50 (BCRA Oficial fetched 08:55 ART)

Saldos de cuenta corriente actualizados.
```

---

## 9 · Plan de rollback por gate

| Gate | Si falla | Acción |
|------|----------|--------|
| GATE 0 (pre-flight) | Backup falta | Bloquear hasta resolver |
| GATE 1 (schema sandbox) | RLS test falla | Fix SQL + re-run sandbox |
| GATE 2 (motor sandbox) | runContract bug | Hotfix lib + re-test |
| GATE 3 (UI sandbox) | UX rota | Iteración rápida en UI |
| GATE 4 (dashboard) | Widget calculate wrong | Fix calc + redeploy preview |
| GATE 5 (deploy prod) | 0014 falla apply | DROP DEL ÚLTIMO BLOQUE creado + re-apply o down-migration |
| GATE 5 | Smoke test prod falla | `netlify rollback` al deploy anterior |
| GATE 6 (operación) | Discrepancia CC vs Excel >1% | Pausar onboarding, debug, no avanzar cohortes |

### 9.1 Rollback de migration 0014 en producción

**Solo bajo orden directa del usuario** + backup verificado disponible:

1. Activar killswitch crons (env vars)
2. Verificar no hay datos críticos en tablas nuevas (algunos rows de test → exportar)
3. Descomentar down-migration en local
4. `supabase migration down --linked` (riesgo: drop tables)
5. Restore desde backup si fail

**Preferencia:** **NO rollback de schema** — siempre forward-fix con migration 0015.

### 9.2 Rollback de deploy Netlify

Si UI rompe pero schema OK:
```bash
npx netlify deploy:list  # ver deploys recientes
npx netlify rollback --id=<previous-deploy-id>
```

Schema queda en prod sin cambio. UI vuelve a la versión anterior sin tabs de billing.

---

## 10 · Monitoring & observability

### 10.1 Métricas a exponer

| Métrica | Fuente | Alerta |
|---------|--------|--------|
| Runs/día (target: ≥ contratos activos en día de corte) | `recurring_runs.created_at` | si día 1 < contratos activos |
| Runs OK % | `recurring_runs.status='OK'/total` | si < 95% |
| Tiempo medio run | `recurring_runs` ms | si > 5s p95 |
| Cobros confirmados/día | `customer_payments.status='CONFIRMADO'` | informativo |
| Saldo total CC | `sum(customer_balances.balance_pes)` | informativo |
| Mora aplicada/día | `customer_late_fee_charges` | si > $500k súbito |
| Discrepancia reconcile | `accounts/reconcile.ts` | si > 1% en cualquier cliente |
| BCRA API errors | `exchange-rate/bcra-client` | si > 3 fails seguidos |
| Email send errors | Resend webhooks | si > 5% bounces |

### 10.2 Dashboards

| Dashboard | Audiencia | Refresh |
|-----------|-----------|---------|
| `/ejecutivo` (público interno) | JL, Ruth, operaciones | real-time |
| Dashboard ops privado (TBD) | Dev + Ruth | every 5 min |
| Sentry/Logflare (futuro) | Dev | real-time |

### 10.3 Health endpoints

```
GET /api/billing/health
  → { ok: true, schema_version: '0014', last_cron_recurring_at, last_cron_late_fees_at, bcra_last_success_at }
```

Sin auth (público). Para health check externos.

---

## 11 · Plan de capacitación

### 11.1 Sesiones programadas

| # | Sesión | Audiencia | Duración | Cuándo |
|---|--------|-----------|----------|--------|
| 1 | Demo arquitectura | JL + dev | 1h | Post GATE 1 |
| 2 | Demo wizard contratos + CC | Ruth | 2h | Post GATE 3 |
| 3 | Demo wizard cobros + vencimientos | Ruth | 1.5h | Post GATE 3 |
| 4 | Demo dashboard | JL | 30min | Post GATE 4 |
| 5 | Hands-on creación primer contrato real | Ruth + dev | 1h | Post deploy |
| 6 | Sesión de Q&A semanal | Ruth + dev | 30min | × 4 semanas |
| 7 | Sesión final de cierre | Ruth + JL | 1h | Post 30 días |

### 11.2 Documentación de usuario

Crear post-deploy (no en FASE 1B planning):
- `docs/usuario/MANUAL-FACTURACION-RECURRENTE.md` (PDF imprimible)
- Video screencast wizard contratos (5 min)
- Video screencast wizard cobros (3 min)
- FAQ común

---

## 12 · Resumen ejecutivo del rollout

```
DÍA 0 — Pre-flight (E0)
  ├── Backup OK ✓
  ├── RBAC seedeado ✓
  └── Branch creada ✓

SEMANA 1-3 — Schema + libs (E1, E2)
  ├── 0014 aplicada en sandbox
  ├── RLS T1-T12 PASS
  ├── BCRA integrado
  └── GATE 1 ✓

SEMANA 4-6 — Motor + Directa (E3, E4)
  ├── Engine OK con idempotencia
  ├── Cron configurado (no activo)
  ├── Directa OK
  └── GATE 2 ✓

SEMANA 7-9 — CC + Cobros + Mora (E5, E6, E7)
  └── Backend completo

SEMANA 10-13 — UI + Dashboard (E8, E9)
  └── GATE 3 + GATE 4 ✓

SEMANA 14 — Deploy prod (E10)
  ├── 0014 aplicada en prod (madrugada)
  ├── Deploy Netlify
  ├── Smoke tests
  ├── Flags activados progresivamente
  └── GATE 5 ✓

MES 4 — Operación supervisada (E11)
  ├── Cohorte 1 (1 contrato test)
  ├── Cohorte 2 (3 reales)
  ├── Cohorte 3 (10 reales)
  ├── Dual-run con Excel
  └── GATE 6 ✓ — FASE 1A CERRADA

MES 5+ — Excel archivado, sistema oficial
```

---

## 13 · Resumen de decisiones de rollout

| Aspecto | Decisión | Justificación |
|---------|----------|---------------|
| Migration numbering | 0014 único | Bloque atómico, evita orden de aplicación frágil |
| Feature flags | 8 flags por módulo | Activación progresiva sin redeploy |
| Cron timezone | UTC en cron, mostrar ART en UI | Netlify estándar; ART para usuarios |
| Cron schedule mes | 09:00 ART día 1 | Aprobado por usuario |
| Cron schedule mora | 07:00 ART diario | Antes del horario operativo de Ruth |
| RBAC seed pre-deploy | Director + Admin | Cierra ventana fail-open R22 |
| Dual-run con Excel | 1 mes | Validación incremental |
| Punto de no-retorno | Mes 3 post-deploy | Excel archivado oficialmente |
| Rollback de schema | Forward-fix (0015) preferido | Down-migration solo emergencia |
| Branch strategy | Feature branch acumuladora + 11 PRs | Code review granular |
| Email automation Ruth | Sí (cron + alertas) | Visibilidad operativa |

---

## 14 · Lo que NO entra en rollout FASE 1B

| Excluido | Por qué |
|----------|---------|
| Portal cliente para autoservicio | Out of scope FASE 1A |
| Sentry / Logflare integration | Futuro; structured logs ya compatibles |
| Multi-currency completo (más allá USD/ARS) | Futuro |
| Recordatorio automático email de mora a cliente | Posible FASE 1B follow-up |
| Conexión a Tesorería (cobros → bancos) | FASE 3 |
| Asientos automáticos | FASE 4 |
| ARCA prod | sigue sandbox; FASE 5 |
| App móvil | out of scope |
| Importadores externos (Excel mass-import) | post-MVP |

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR — solo estrategia
- 🛑 NO EJECUTAR migraciones · NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO tocar producción · credenciales · Drive · ARCA · RBAC core
- 🛑 NO INVENTAR — todo trazable a docs aprobados FASE 1A + decisiones funcionales aprobadas + módulos FASE 1B

# Frente CRM Comercial — Cierre Ejecutivo

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Rama:** `feature/crm-comercial-f2-1`
**Autor:** CTO de Release

---

## 1. Reporte ejecutivo final

> ## 🟢 Frente CRM Comercial — FUNCIONALMENTE COMPLETO y validado en PRODUCCIÓN
> El dominio CRM (lead → oportunidad → reserva → ganado → onboarding → ocupado) está **vivo en la base de PROD** y **operable de punta a punta desde la UI**, validado con un Write E2E real (V1–V9 PASS). Quedan tareas de **entrega** (commit del fix P0.3, deploy a Netlify, webhook Clientify en runtime de prod), no de construcción.

### Qué se entregó (capacidades)
| Capa | Capacidad | Estado |
|---|---|---|
| **F2.1 Write-Path** (W-1…W-4) | Transiciones de etapa atómicas (opp + ledger), reserva de capacidad, cierre de onboarding — RPCs transaccionales SECURITY INVOKER | 🟢 vivo en PROD |
| **F2.1 Ficha 360°** | Pantalla central de oportunidad: resumen, capacidad, cotizaciones, propuestas, contrato, onboarding, historial | 🟢 |
| **F2.2 Clientify Inbound** | Ingesta por webhook tokenizado (no firmado), dedup (clientify_id→email→phone), owner least-loaded, bandeja de leads, promoción lead→opp, reconciliación | 🟢 vivo en PROD |
| **Capacity Engine** | Motor corporativo (Luхán+Magaldi), `findAvailability`, snapshot committed, anti-doble-conteo (reservado/comprometido/ocupado) | 🟢 |
| **Dashboard de Vacancia** | Bandas física/comercial/proyectada alimentadas por el CRM en vivo | 🟢 |
| **P0.1** | Webhook tokenizado pasa el middleware sin sesión (resto protegido) | 🟢 commiteado |
| **P0.2** | Onboarding + 5 tareas auto-creados al pasar a Ganado (trigger) | 🟢 commiteado |
| **P0.3** | Ficha expone avance `calificado → propuesta` (hueco de UI cerrado) | 🟡 **implementado, sin commitear** |

### Validación acumulada
- **Schema PROD:** migraciones `0041`–`0051` aplicadas por SQL Editor + `PROD_VERIFY_CRM.sql` **11 PASS / 0 FAIL**.
- **Staging (pre-prod):** harness `pg` (BEGIN…ROLLBACK) por sub-fase; `w4-loop` **12/12 GO**.
- **Write E2E en PROD (V1–V9):** Lead (webhook real) → Calificar → Promover → Reservar → [P0.3] Propuesta → Negociación → Ganado → Onboarding auto (P0.2) → Completar → Ocupado → Dashboard restaura a 37.5%/3.770 m². **Todos PASS.** Datos E2E limpiados (cleanup 0/0/0 confirmado ×2).

### Propiedades críticas verificadas en PROD
RLS por `comercial.*`; contratos `RESTRICT`; ledgers append-only; anti-doble-conteo vía `committed_state`; separación INVOKER (write con sesión) / DEFINER (ingest/list sin sesión); `profiles_public` PII-safe; webhook fail-closed (token timing-safe).

---

## 2. Roadmap — estado actualizado

| Fase | Descripción | Estado |
|---|---|---|
| F2.1-6/7 | Ficha 360° + persistencia Supabase | ✅ |
| F2.1-8 (W-1…W-4) | Write-Path transaccional + lazo de vacancia | ✅ |
| UX-1 | Capture Bridge → crm_quotes/proposals | ✅ |
| F2.2-0…4 | Clientify Inbound (research→ingest→webhook→bandeja→promoción→reconciliación) | ✅ |
| P0.1 | Fix middleware webhook | ✅ commiteado |
| P0.2 | Onboarding auto al ganar | ✅ commiteado |
| **Fase 1 PROD** | Migraciones 0041–0051 aplicadas + verificadas (11 PASS) | ✅ |
| **Write E2E PROD** | V1–V9 punta a punta | ✅ |
| **P0.3** | UI avance `calificado→propuesta` | 🟡 implementado, **falta commit + push** |
| Deploy | App a Netlify + webhook Clientify en runtime prod | ⬜ pendiente (frente aparte) |
| Merge | `feature/crm-comercial-f2-1` → `main` | ⬜ pendiente |

---

## 3. Estado de la rama y de git

- **Rama:** `feature/crm-comercial-f2-1`.
- **Sync con origin:** **0 adelante / 0 atrás** → **NO hay commits pendientes de push.** Todo lo commiteado ya está en `origin`.
- **vs `origin/main`:** la rama está **+25 / −5** (25 commits de feature por encima; main avanzó 5; **sin merge**).
- **`main` / Netlify / PROD config:** intactos (sin merge, sin deploy).

### Commits del frente (ya pusheados)
```
21c886a feat(crm): auto-crear onboarding al pasar a Ganado (P0.2)
532f01f fix(mw): permitir webhook Clientify tokenizado sin sesión (P0.1)
058d802 docs(nexus): auditoría CTO + PROJECT_STATE_REVIEW
06aaff1 feat(crm): F2.2 Clientify Inbound
d87784b feat(crm): F2.1 Write-Path (W-1…W-4)
a76fff7 feat(crm): UX-1 Capture Bridge
e84effa feat(crm): F2.1-7 persistencia Supabase (Ficha 360°)
25b07fc feat(crm): F2.1-6 Ficha 360°
```

### Trabajo SIN commitear (pendiente de un commit, no de push)
| Tipo | Path | Nota |
|---|---|---|
| **Código (P0.3)** | `src/app/(app)/comercial/oportunidades/[id]/Opportunity360View.tsx` | el fix de UI — único cambio de código sin commit |
| Migración | `supabase/migrations/0040_profiles_pii_lockdown.sql` | **untracked** (dependencia de 0046; conviene incluirla) |
| Test | `supabase/tests/PROD_VERIFY_CRM.sql` | verificación PROD |
| Docs | `docs/comercial/*` (P0.3_CLOSURE_REPORT, CRM_WRITE_E2E_PROD_CLOSURE, este cierre, handoff, runbook…), `docs/PROD_*`, `docs/handoff/*`, `docs/TOPS_NEXUS_*` | documentación del frente |
| Ruido | `.next_corrupt_backup/`, `.next_old_*/`, `.playwright-mcp/` | **no commitear** (artefactos; idealmente a `.gitignore`) |

---

## 4. Recomendación de cierre formal + próximos frentes priorizados

### Cierre formal del frente CRM Comercial
**Recomendación:** declarar el frente **CERRADO a nivel construcción/validación**. El backend, el inbound, el write-path, el capacity engine y el dashboard están vivos en PROD y validados E2E. Lo que resta es **entrega**, no desarrollo.

### Próximos frentes (priorizados, sin ejecutar)
1. **P0.3 — commit + push** (XS, inmediato): commitear el fix de UI + docs + migración 0040 + PROD_VERIFY_CRM.sql; añadir artefactos al `.gitignore`. Cierra el último cabo suelto del frente. *Requiere tu autorización de commit/push.*
2. **Deploy a Netlify + webhook Clientify en runtime prod** (S/M): la app hoy corre local→PROD. Para operación real por usuarios: desplegar y setear `CLIENTIFY_WEBHOOK_SECRET` en el runtime de producción, luego registrar la URL del webhook en Clientify. *Frente de release, requiere decisión de deploy.*
3. **Merge `feature/crm-comercial-f2-1` → `main`** (S): resolver el −5 e integrar. Recomendado **después** de validar el deploy.
4. **F2.3 — Clientify Outbound** (M): hoy el sync es solo inbound; falta empujar cambios de Nexus → Clientify (deals/etapas).
5. **Flujo de Contrato** (M): `crm_contracts` existe (con RESTRICT y firma), pero no hay flujo de UI para emitir/firmar contrato al ganar.

### Backlog menor (no bloqueante, cosmético)
- Al "Completar onboarding", el encabezado pasa a COMPLETADO 100% pero los chips de tareas individuales siguen mostrando "pendiente". Es visual (el estado real del onboarding es completado). Polish, no funcional.

---

## 5. Restricciones respetadas
Sin nuevas pruebas · sin nuevos hallazgos · sin modificar PROD · sin merge/PR/deploy. Solo cierre documental y planificación.

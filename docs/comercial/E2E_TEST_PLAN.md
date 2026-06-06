# E2E_TEST_PLAN — Aceptación funcional CRM + Clientify Inbound

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Naturaleza:** plan de prueba E2E (solo validar; sin código nuevo, sin desplegar, sin tocar PROD).
**Herramienta:** Playwright sobre el entorno local.

---

## 1. Objetivo

Validar de punta a punta los 9 flujos del ciclo comercial inbound, vía navegador (UI → navegación → RPC → persistencia → Capacity Engine → Dashboard), capturando screenshots, errores, warnings e inconsistencias.

---

## 2. Flujos bajo prueba

| # | Flujo | Qué valida |
|---|---|---|
| 1 | **Lead Inbox** (`/comercial/leads`) | listado real, filtros, ownership, posible-duplicado, KPIs |
| 2 | **Calificación** | `setLeadStatus` (nuevo→contactado→calificado) bajo RLS |
| 3 | **Promoción** | `crm_promote_lead` → crea oportunidad, enlaza lead, status=promovido |
| 4 | **Opportunity 360°** (`/comercial/oportunidades/[id]`) | render, tabs, badges, fuente=Supabase |
| 5 | **Reserva de capacidad** | `crm_reserve_capacity` → assigned_site/units, committed=reservado |
| 6 | **Ganado** | `crm_advance_stage`→ganado (D-2 bloqueo si sin capacidad), committed=comprometido |
| 7 | **Onboarding** | tab onboarding |
| 8 | **Ocupado** | `crm_complete_onboarding` → committed=ocupado (anti-doble-conteo) |
| 9 | **Dashboard Corporativo** (`/comercial/dashboard-vacancia`) | vacancia física/comercial/proyectada reflejando los compromisos |

---

## 3. Precondiciones (para que el E2E de navegador sea ejecutable contra staging)

> El E2E de navegador requiere que la app corra **conectada a una base con `crm_*` y datos**, con **sesión autenticada**. Hoy NO se cumplen (ver `E2E_EXECUTION_REPORT.md`).

| # | Precondición | Estado actual |
|---|---|---|
| P-1 | App apuntando a una DB con esquema `crm_*` aplicado (staging) | ❌ `NEXT_PUBLIC_SUPABASE_URL` → **PROD** (sin `crm_*`) |
| P-2 | Claves **supabase-js de staging** (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` + `SERVICE_ROLE_KEY` de staging) en `.env.local` | ❌ no existen (solo `STAGING_DB_URL` pg crudo) |
| P-3 | **Usuario autenticado** con rol `comercial` (las rutas `/comercial/*` exigen login; `DEMO_MODE=0`) | ❌ sin credenciales (y no se debe loguear contra PROD) |
| P-4 | **Datos sembrados** en staging (`crm_leads`/`crm_opportunities`) | ❌ las validaciones usaron tx+ROLLBACK → staging sin datos residuales |
| P-5 | **Webhook tokenizado accesible** (middleware no debe bloquearlo) | ❌ middleware devuelve 401 a `/api/clientify/webhook/[token]` (defecto hallado) |

---

## 4. Procedimiento (cuando se cumplan las precondiciones)

1. `.env.local` con claves **staging** (P-1/P-2); reiniciar dev server.
2. Sembrar en staging un lead + datos mínimos (P-4) — fuera de tx (persistente para el E2E).
3. Login como usuario `comercial` (P-3).
4. Recorrer los 9 flujos con Playwright, capturando screenshot por paso y leyendo consola (errores/warnings).
5. Verificar persistencia (recargar y confirmar estado) y el reflejo en el Dashboard.
6. Limpiar los datos de prueba de staging al finalizar.

---

## 5. Criterios de aceptación

- Cada flujo completa sin error de consola crítico.
- La fuente de datos en la UI es **Supabase** (no "muestra local").
- Las transiciones **persisten** (sobreviven recarga).
- El Dashboard refleja committed/reservado/ocupado coherente con el lazo (validado en W-4: 401→201→… ANMAT Luján).
- Webhook: POST con token válido → 200 + lead en bandeja; token inválido → 401 (propio del handler).

---

## 6. Alcance / frontera

- ❌ Sin funcionalidades nuevas, sin cambios de arquitectura, sin desplegar, sin tocar PROD.
- La lógica de negocio ya está validada a nivel RPC/DB (≈162 asserts en staging); este plan valida la **capa de navegador** end-to-end.

> Resultado de la ejecución y GO/NO-GO en `E2E_EXECUTION_REPORT.md`.

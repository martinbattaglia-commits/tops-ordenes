# PRODUCTION_PHASE1_CLOSURE & WRITE_E2E_PLAN

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Autor:** CTO de Release

---

# 1. Reporte ejecutivo — Cierre de Fase 1

> ## ✅ FASE 1 CERRADA — Dominio CRM aplicado y validado en PRODUCCIÓN
> Migraciones `0041`–`0051` (11/11) aplicadas a Supabase PROD (`arsksytgdnzukbmfgkju`) por SQL Editor, **una por vez**, con verificación intermedia. Verificación final `PROD_VERIFY_CRM.sql`: **11 PASS / 0 FAIL**. UI confirmada en vivo: **fuente Supabase, sin datos de prueba**.

### Evidencia consolidada
| Fuente | Resultado |
|---|---|
| Aplicación 0041→0051 | 11/11 "Success", validación intermedia por migración (enums, tablas+RLS, R-G1 `confdeltype='r'`, ledgers append-only, RBAC seed, profiles_public PII-safe, funciones INVOKER/DEFINER, trigger onboarding) |
| `PROD_VERIFY_CRM.sql` | **11 PASS / 0 FAIL** (10 tablas · 10 enums · RLS×10 · 7 funciones · 3 DEFINER + 4 INVOKER · trigger · RBAC comercial.* · profiles_public) |
| UI en vivo (`/comercial/leads`, sesión real PROD) | **"fuente: Supabase (crm_leads)"** · TOTAL 0 (tabla real, vacía) — ya **no** cae a "muestra local" |
| Impacto en PROD | Solo schema additivo; **sin datos de prueba**; 0046 = seed RBAC idempotente; ninguna tabla pre-CRM alterada |

### Qué significa
El **dominio CRM Comercial está vivo en la base de producción**: la app (que apunta a PROD) ahora lee/escribe `crm_*` reales en vez de muestra local. Las propiedades críticas (RLS por rol, R-G1 contratos RESTRICT, ledgers inmutables, anti-doble-conteo vía committed_state, separación INVOKER/DEFINER, PII-safe) quedaron verificadas en PROD.

---

# 2. Estado actualizado del proyecto

| Capa | Estado |
|---|---|
| **Schema CRM en PROD** | 🟢 **VIVO** — 0041-0051 aplicadas + verificadas (11 PASS) |
| **Código (W-1…W-4, F2.2, P0.1, P0.2)** | 🟢 commiteado + pusheado en `feature/crm-comercial-f2-1` (origin sincronizado) |
| **App ejecutándose** | 🟡 **local contra PROD** (dev server) — NO desplegada en Netlify aún |
| **`main`** | ⚪ intacto (`c3fb359` local) · `origin/main` `073339d` — sin merge |
| **Datos CRM en PROD** | 🟢 limpios (0 leads / 0 opps) — sin datos de prueba |
| **Clientify webhook (prod)** | ⚪ no configurado (sin `CLIENTIFY_WEBHOOK_SECRET` en runtime) |
| **Staging** | 🟢 conservado como dry-run de migraciones (fuera del loop operativo) |

**Lectura:** el schema está en producción y la app local opera contra él. Falta (fuera de Fase 1): **desplegar la app a Netlify** y **configurar el webhook de Clientify en prod** para operación real por usuarios. El Write E2E que sigue se ejecuta sobre la app local→PROD (patrón histórico).

---

# 3. Plan detallado — Write E2E (Fase 2)

**Objetivo:** validar de punta a punta el flujo de escritura con persistencia real en PROD: Lead → Calificar → Promover → Opportunity → Reservar → Ganado → Onboarding → Ocupado → Dashboard.

**Entorno:** app local (puerto 3030) → **Supabase PROD** (ya configurado, sin claves nuevas). Navegador = tu Chrome (sesión real, extensión).

### Preconditiones (reevaluadas — ya NO falta nada de staging)
| # | Precondición | Estado |
|---|---|---|
| 1 | App → DB con `crm_*` | ✅ PROD (Fase 1) |
| 2 | Sesión autenticada | ✅ logueado (la bandeja renderiza con `comercial.view`) |
| 3 | Usuario con **`comercial.edit`** (para escrituras) | ⚠️ **confirmar** (el RBAC 0046 lo mapeó a admin/operaciones/comercial; tu usuario debe tener uno) |
| 4 | Un **lead inicial** para operar | ⚠️ **crear** (tabla vacía) — vía webhook (necesita `CLIENTIFY_WEBHOOK_SECRET`) **o** seed por RPC `crm_ingest_lead` |
| 5 | Backup PROD reciente | ✅ tomado pre-Fase 1 (recomendado confirmar vigencia) |

### Cómo crear el lead inicial (paso 1 del E2E) — dos opciones
- **(A) Webhook real** (prueba también P0.1 + ingest): setear `CLIENTIFY_WEBHOOK_SECRET` en `.env.local`, reiniciar, `POST /api/clientify/webhook/<secret>` con un contacto fixture. → lead aparece en la bandeja.
- **(B) Seed por RPC** (más directo): ejecutar `select crm_ingest_lead('{...}'::jsonb, null, 'e2e')` en SQL Editor (service/postgres). → lead persistido.

> Recomendado **(A)** para validar el inbound completo; **(B)** si se quiere ir directo al flujo de escritura.

### Captura de evidencia (durante el E2E)
- **Screenshot** por paso (tu Chrome).
- **Before/after** de `committed_state` y bandas del Dashboard, vía SQL Editor (read) en los hitos.

---

# 4. Riesgos residuales (antes del flujo completo)

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| **RR-1** | **Datos de prueba en el CRM productivo** (lead/opp/onboarding/stage_history reales en PROD) | 🟠 | Marcar como `e2e`; **cleanup obligatorio al cerrar** (delete lead+opp cascada). |
| **RR-2** | **Dashboard de vacancia en vivo se altera** por el `committed_state` de la opp de prueba (reservado→comprometido) | 🟠 | Se restaura al ocupar (paso 8) y/o al limpiar la opp. Ejecutar en ventana de baja consulta. |
| **RR-3** | `comercial.edit` ausente en el usuario → escrituras 401/RLS | 🟡 | Confirmar RBAC del usuario antes (query en §5). |
| **RR-4** | Si se usa webhook: `CLIENTIFY_WEBHOOK_SECRET` queda en `.env.local` | 🟡 | Token de prueba; quitarlo al terminar. No commitear `.env.local`. |
| **RR-5** | Usuarios comerciales reales ven el lead/opp de prueba mientras dura | 🟡 | Ventana acordada + cleanup inmediato. |
| **RR-6** | Cleanup: `crm_contracts` es `ON DELETE RESTRICT` | 🟢 | El E2E **no crea contrato** → el opp se borra con cascada (quotes/proposals/onboarding/stage_history). |
| **RR-7** | App no desplegada (corre local) | 🟢 | No afecta el E2E (opera local→PROD). El deploy es un frente aparte. |

> **Decisión clave a confirmar antes de ejecutar:** aceptar que el Write E2E **escribe datos reales en PROD** (con cleanup posterior). Es lo que el flujo histórico implica; va con backup + cleanup.

---

# 5. Checklist exacto del Write E2E (8 pasos)

> Pre: precondición 3 (RBAC) y 4 (lead inicial) resueltas. Yo conduzco tu Chrome (extensión) y capturo; vos/yo corremos los reads de before/after en SQL Editor.

| Paso | Acción | Verificación (V) | Evidencia |
|---|---|---|---|
| **0 · BEFORE** | SQL Editor (read): bandas de vacancia ANMAT@Luján (física/comercial/proyectada) + count leads/opps | baseline | valores antes |
| **1 · Lead** | Crear lead (webhook A o seed B) | **V1 Lead creado** — aparece en `/comercial/leads`, fuente Supabase | screenshot inbox |
| **2 · Calificar** | Fila del lead → **Contactar → Calificar** | estado lead = `calificado` (persistido) | screenshot |
| **3 · Promover** | Botón **Promover** → mini-form `service_type=anmat` (+ m²=200) → Confirmar → redirige a Ficha 360° | **V2 Lead promovido** (`status=promovido`, `opportunity_id`) · **V3 Opportunity creada** (`estado=calificado`) | screenshot Ficha |
| **4 · Reservar** | Ficha → tab **Capacidad** → sede `Pedro Luján 3159` + unidad → **Reservar capacidad** | **V4 Reserva** · **V5 committed_state=reservado** | screenshot + (SQL) committed_state |
| **5 · Ganado** | Header → **Pasar a negociación** → **Marcar ganado** | **V6 Ganado** · committed_state=`comprometido` · **onboarding auto-creado (P0.2)** | screenshot + (SQL) committed_state + onboarding existe |
| **6 · Onboarding** | Tab **Onboarding** → **Completar onboarding** | **V7 Onboarding** completado/100% | screenshot |
| **7 · Ocupado** | (resultado del paso 6) | **V8 committed_state=ocupado** (anti-doble-conteo) | (SQL) committed_state |
| **8 · Dashboard** | `/comercial/dashboard-vacancia` | **V9 Dashboard** refleja el ciclo (reservado→comprometido→ocupado restaura) | screenshot + (SQL) bandas AFTER |
| **9 · CLEANUP** | SQL Editor: borrar lead+opp de prueba (cascada) + fila `clientify_sync_log` | CRM productivo limpio (0 leads/0 opps de prueba) | conteo final |

**Verificaciones obligatorias 1–9 → mapeadas a pasos 1–8 arriba.**

**Patrón esperado del Dashboard (consistente con W-4 en staging):** reservar baja **proyectada**; ganar baja **comercial**; ocupar **restaura** ambas (el m² pasa a ocupación física del Twin).

---

## Estado / próximo
- ✅ **Fase 1 cerrada** (schema CRM vivo en PROD, 11 PASS, UI Supabase).
- ⏸️ **Write E2E (Fase 2): NO ejecutado.** Pendiente tu confirmación de: (a) aceptar datos de prueba en PROD + cleanup, (b) método de creación del lead (webhook/seed), (c) confirmar `comercial.edit` del usuario.

*Sin Write E2E, sin datos de prueba, sin cleanup, sin merge/PR/deploy en esta entrega. Solo informe + plan.*

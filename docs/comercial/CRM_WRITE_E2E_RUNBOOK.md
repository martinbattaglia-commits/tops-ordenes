# CRM_WRITE_E2E_RUNBOOK — Listo para ejecutar (espera 2 claves de staging)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Estado:** ⏸️ **EN ESPERA** de credenciales reales de STAGING. **No ejecutar hasta tenerlas.**
**Escenario (validado con evidencia):** **B + C** — la app usa supabase-js; falta repuntarla a staging + un usuario comercial. `STAGING_DB_URL` no lo usa la app.

> Sin workarounds. Sin producción. Sin modificar el flujo validado. Cambios de entorno **reversibles** (backup/restore de `.env.local`).

---

## 0. Lo que FALTA (bloqueo real, único)

| Dato | Estado |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` (staging) | ✅ derivable = `https://vrxosunxlhohmqymxots.supabase.co` |
| **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** (staging) | ❌ **REQUERIDO** (Dashboard Supabase → Project Settings → API → `anon public`) |
| **`SUPABASE_SERVICE_ROLE_KEY`** (staging) | ❌ **REQUERIDO** (misma pantalla → `service_role`) — para webhook ingest + provisión de usuario |
| Usuario comercial de staging | ❌ **REQUERIDO** (ver §2) |

Con esos 2 valores (+ usuario) el E2E corre completo.

---

## 1. Checklist de repoint a STAGING (reversible)

| # | Paso | Comando / acción | Guard |
|---|---|---|---|
| R1 | **Backup** de `.env.local` | `cp .env.local .env.local.PROD.bak` | conservar valores PROD |
| R2 | Setear URL staging | `NEXT_PUBLIC_SUPABASE_URL=https://vrxosunxlhohmqymxots.supabase.co` | debe contener `vrxosunxlhohmqymxots`, **no** `arsksytgdnzukbmfgkju` |
| R3 | Setear `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (anon staging) | en `.env.local` | — |
| R4 | Setear `SUPABASE_SERVICE_ROLE_KEY` = (service staging) | en `.env.local` | — |
| R5 | Setear `CLIENTIFY_WEBHOOK_SECRET` = (token de prueba, ≥32B) | en `.env.local` | para crear el lead vía webhook |
| R6 | **Reiniciar** dev server | preview_stop + preview_start (Next lee env al boot) | — |
| R7 | **Verificar repoint** | abrir `/comercial/leads` → debe decir **fuente: Supabase** (no "muestra local") | si dice "muestra local" → claves mal |
| R8 (post-E2E) | **Restaurar** PROD | `mv .env.local.PROD.bak .env.local` + reiniciar | volver a PROD; no dejar local en staging |

> **Nunca** apuntar a PROD durante el E2E de escritura. El guard R2/R7 lo asegura.

---

## 2. Usuario comercial de STAGING requerido

El login pasa a ser el de **staging** (la sesión PROD actual deja de valer). Se necesita un usuario que cumpla **todo**:

| Requisito | Por qué |
|---|---|
| Existe en `auth.users` de staging, **email confirmado**, con **password conocida** | login por email+password |
| Email `@logisticatops.com` o `@verotinsa.com` | el form sugiere dominio corporativo |
| `profiles.role ∈ {admin, operaciones, supervisor}` | para leer `clients` (enlace por CUIT en la promoción) |
| Rol RBAC **`comercial`** (`user_roles → roles.slug='comercial'`) | `has_permission('comercial.edit')` para las escrituras |
| `profiles.active = true` | habilitado |

**Dos vías:**
- **(a)** Credencial de un comercial de staging ya existente (si la hay).
- **(b)** **Provisionar** uno de prueba con la **service key** (R4): `auth.admin.createUser({email, password, email_confirm:true})` → luego `update profiles set role='operaciones', active=true` + `insert user_roles(comercial)` vía `STAGING_DB_URL`. **Marcar como e2e** y **limpiar al final**.

> Sin la service key (R4) no se puede provisionar → depende de la clave faltante.

---

## 3. E2E de 8 pasos — procedimiento exacto

**Pre:** R1–R7 OK · usuario comercial listo (§2). Navegador = Chrome local (extensión). Capturar **before/after** vía `pg` (`STAGING_DB_URL`) + **screenshot** por paso.

| Paso | Acción (navegador, salvo indicado) | Verificación obligatoria | Evidencia |
|---|---|---|---|
| **0 · BEFORE** | (pg) snapshot inicial: vacancia ANMAT@Luján (física/comercial/proyectada) | baseline registrado | valores antes |
| **1 · Lead** | Crear lead vía **webhook**: `POST /api/clientify/webhook/<CLIENTIFY_WEBHOOK_SECRET>` con un contacto fixture (id, nombre, email, cuit, tags) | **V1**: lead aparece en `/comercial/leads`, **fuente Supabase** | screenshot inbox |
| **2 · Calificar** | En la fila del lead: **Contactar → Calificar** | estado lead → `calificado` (persistido) | screenshot |
| **3 · Promover** | Botón **Promover** → mini-form `service_type=anmat` (+ m²=200) → Confirmar → redirige a Ficha | **V2** lead `promovido` + `opportunity_id`; **V3** oportunidad creada (`calificado`) | screenshot Ficha |
| **4 · Reservar** | Ficha → tab **Capacidad** → sede `Pedro Luján 3159` + unidad → **Reservar capacidad** | **V4** reserva; **V5** `committed_state` → `reservado`; capacity engine descuenta proyectada | screenshot + (pg) committed_state |
| **5 · Ganado** | Header: **Pasar a negociación** → **Marcar ganado** | **V6** estado `ganado`; `committed_state` → `comprometido`; (P0.2) **onboarding auto-creado** | screenshot + (pg) committed_state + onboarding existe |
| **6 · Onboarding** | Tab **Onboarding** → **Completar onboarding** | **V7** onboarding `completado`/100% | screenshot |
| **7 · Ocupado** | (resultado de paso 6) | **V8** `committed_state` → `ocupado` (anti-doble-conteo) | (pg) committed_state |
| **8 · Dashboard** | `/comercial/dashboard-vacancia` | **V9** vacancia comercial/proyectada refleja el ciclo (reservado→comprometido→ocupado) | screenshot + (pg) bands AFTER |

**AFTER vs BEFORE:** comparar `committed_state` por paso y las bandas del Dashboard (debe seguir el patrón W-4: reservar baja proyectada; ganar baja comercial; ocupar restaura — el m² pasa a ocupación física del Twin).

---

## 4. Verificaciones obligatorias → mapeo

| # | Verificación | Paso |
|---|---|---|
| 1 | Lead creado | 1 |
| 2 | Lead promovido | 3 |
| 3 | Opportunity creada | 3 |
| 4 | Reserva de capacidad | 4 |
| 5 | Cambio de committed_state | 4 (reservado), 5 (comprometido), 7 (ocupado) |
| 6 | Ganado | 5 |
| 7 | Onboarding | 5 (auto) / 6 (completar) |
| 8 | Ocupado | 7 |
| 9 | Actualización del Dashboard | 8 |

---

## 5. Cleanup (post-E2E, en staging)

- Borrar/anular los datos de prueba: oportunidad + lead + onboarding + stage_history + usuario e2e (o marcarlos `e2e`).
- **Restaurar `.env.local` a PROD** (R8) + reiniciar.
- (No tocar nada de PROD en ningún momento.)

---

## 6. Entregables del E2E (cuando se ejecute)

1. `E2E_WRITE_TEST_REPORT.md` (before/after, capacity engine, dashboard).
2. Screenshots por paso.
3. PASS/FAIL por verificación (1–9).
4. GO/NO-GO.

> **No ejecutar nada de §3 hasta tener `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` de staging.** Sin workarounds, sin producción, sin modificar el flujo validado.

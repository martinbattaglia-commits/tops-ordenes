# F3 · F3.2B — REPORTE FINAL DE DEPLOY A PRODUCCIÓN

> **Nexus Link RC1 (F3) — Deploy controlado a producción**
> **Resultado: ✅ GO — DEPLOY EXITOSO. Producción quedó en `88add4b`.**
> Autorización: Dirección (Martín Battaglia). Ejecución: 2026-07-01, 01:25–01:37 UTC.
> Documento archivado en `docs/superpowers/` (rama `feat/nexus-link-integration`).

---

## 0. Resumen ejecutivo

El deploy controlado de Nexus Link F3 a producción se ejecutó **exitosamente** siguiendo el procedimiento seguro validado en DRAFT (Node 22 + checkout NO-worktree + draft-first). Producción quedó publicada en el commit **`88add4b`**, Nexus Link está **visible y operativo**, los smoke tests dieron **0 respuestas 5xx**, el comportamiento **fail-closed** se verificó en todas las rutas y **el rollback no fue necesario**. **El outage del 30/06 NO se reprodujo.**

Quedan dos **deudas NO bloqueantes** (documentadas en `F3-2B-NON-BLOCKING-DEBTS.md`) y la **validación piloto pendiente** (runbook en `F3-PILOT-VALIDATION-RUNBOOK.md`) antes del cierre formal de F3 (criterios en `F3-CLOSURE-CRITERIA-AND-CHECKLIST.md`).

---

## 1. Datos del deploy

| Campo | Valor |
|---|---|
| **Deploy ID (nuevo, producción)** | `6a446ca4aa6e4e9f3b21711f` |
| **Commit publicado** | `88add4b` (rama `feat/nexus-link-integration`) |
| **Hora inicio (build+deploy)** | `2026-07-01T01:25:51Z` |
| **Hora fin (proceso, exit 0)** | `2026-07-01T01:27:09Z` |
| **Publicación efectiva (Netlify `published_at`)** | `2026-07-01T01:27:01Z` |
| **Duración build local (Next.js)** | 33.9 s |
| **Duración total pipeline Netlify** | 1 m 12.7 s |
| **Toolchain** | Node **v22.23.1** · npm 10.9.8 · netlify-cli 26.0.2 |
| **Checkout** | `~/CODE/deploy-f3-nexus-clean` (**NO-worktree**, `.git` real) |
| **Comando** | `netlify deploy --build --prod --site d84a7d34-b90c-4e61-aff6-678abf1ac432` |
| **Sitio Netlify** | `tops-ordenes` (`d84a7d34-b90c-4e61-aff6-678abf1ac432`) → `nexus.logisticatops.com` |
| **Context** | `production` · `state: ready` · `error_message: null` |
| **Runtime función** | `nodejs22.x` · `@netlify/plugin-nextjs@5.15.12` · bootstrap 2.16.0 |
| **Build** | `Compiled successfully` · 95 páginas · 222 archivos · 1 función + 1 edge function |

**Nota de fidelidad:** el working tree del checkout tenía `M package-lock.json` — normalización npm de dependencias **dev/optional/peer** (agrega `picomatch@4.0.4` bajo `@netlify/build`, quita metadata `libc` de binarios rollup de otras plataformas). **Cero impacto en el runtime de la app**; es el estado exacto que produjo el draft verde validado. No es cambio de código/fuente.

---

## 2. Versión publicada (`/api/version`)

```json
{"version":"88add4b","builtAt":"2026-07-01T01:25:59.365Z","environment":"production","servedAt":"2026-07-01T01:29:03.884Z"}
```
HTTP **200** ✅ — **producción confirmada en `88add4b`, entorno `production`.**

---

## 3. Smoke tests (resultado)

**Global: 0 respuestas 5xx en 27+ rutas probadas. 0 fail-open. Middleware fail-closed operativo.**

### 3.1 Salud base
| Ruta | HTTP | Nota |
|---|---|---|
| `/api/version` | 200 | version=88add4b |
| `/login` | 200 | render OK |
| `/` (homepage) | 307 | → `/login?from=%2F` (fail-closed) |

### 3.2 APIs críticas
| Ruta | HTTP | Nota |
|---|---|---|
| `/api/version` | 200 | OK |
| `/api/today` | 401 | fail-closed a nivel API |

---

## 4. Estado de rutas existentes (regresión)

**13 rutas core, todas `307 → /login?from=…` sin autenticación (fail-closed, 0 fail-open, 0 5xx):**
`/ejecutivo` · `/dashboard` · `/orders` · `/pedidos` · `/compras` · `/compras/ordenes` · `/anmat` · `/knowledge/admin` · `/wms` · `/tesoreria` · `/rrhh` · `/comercial/prospeccion` · `/settings/roles`

**Render autenticado verificado** (sesión de `martin@logisticatops.com`, navegación read-only):
- `/dashboard` (cockpit): render 100% completo (KPIs, gráficos "Servicios por depósito"/"Mix de servicios", navegación). Sin error boundary, sin pantalla rota. ✅

*(Observación: una ruta inexistente también redirige a `/login` sin auth — el middleware de auth precede al routing, por lo que el 404 recién aparece tras autenticar. Comportamiento fail-closed correcto.)*

---

## 5. Estado de Nexus Link (F3)

**7 rutas, todas `307 → /login` sin autenticación (fail-closed; `/buscar` preserva `?q`):**
`/connect` · `/connect/canales` · `/connect/notificaciones` · `/connect/buscar?q=magaldi` · `/connect/actividad` · `/connect/perfil` · `/connect/favoritos`

**Render autenticado verificado (read-only):**
- `/connect` (Inicio): **operativo** — "Hola, martin@logisticatops.com", buscador de conversaciones/contextos ERP, **Actividad reciente con datos reales del timeline** (`orders export_csv`, `custody cargado`, `treasury pago_proveedor MOV-2026-000045`…), Notificaciones, Favoritos, Canales activos. ✅
- `/connect/canales`: **operativo** — encabezado "NEXUS LINK · Canales", empty-state correcto ("No hay canales todavía"), botón "+ Crear". ✅

**→ Nexus Link visible y operativo en producción.** Evidencia visual: `~/CODE/{dashboard,login,connect-canales}-prod-88add4b.png`.

---

## 6. Estado RBAC (validación read-only, sin modificar)

**Fail-closed a nivel app confirmado** (todo redirige/401 sin auth). Modelo por rol (`otorgados` / universo 78 permisos):

| Rol | Otorgados | ¿edit? | Acciones |
|---|---|---|---|
| director_ops | 70 | sí | admin, create, delete, edit, export, sign, view |
| admin | 65 | sí | admin, create, delete, edit, export, sign, view |
| gerencia | 60 | **sí** | admin, create, delete, edit, export, sign, view |
| operaciones | 28 | sí | create, edit, sign, view |
| compliance | 23 | sí | admin, create, edit, export, view |
| comercial | 17 | sí | create, delete, edit, export, sign, view |
| jefe_deposito | 11 | **sí** | create, edit, sign, view |
| seguridad | 10 | sí* | admin, create, edit, view |
| rrhh_admin | 9 | sí* | admin, create, edit, export, view |
| rrhh_manager | 6 | sí | create, edit, export, view |
| rrhh_viewer | 3 | no | export, view |
| employee_self_service | 2 | no | view |
| cliente_b2b | 1 | no | view |

Confirmaciones vs. modelo esperado: `gerencia` y `jefe_deposito` tienen `edit` ✅ · `admin` y `director_ops` con set completo de acciones (full-ops) ✅.

**\* Observación (deuda no bloqueante, ver `F3-2B-NON-BLOCKING-DEBTS.md`):** el enunciado "rrhh_admin y seguridad no tienen edit" no es literal — cada uno tiene **exactamente un** grant `edit` **acotado a su dominio**:
- `rrhh_admin → rrhh.edit` ("Editar / anular RRHH") = **esperado/correcto**.
- `seguridad → knowledge.edit` ("Editar conocimiento") = **acotado, a revisar por Dirección** (no evidente que Seguridad edite Knowledge).

No fue introducido ni modificado por el deploy (RBAC vive en DB; el deploy fue solo-UI). No modificable en esta ventana.

---

## 7. Riesgos remanentes

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| R-D1 | **DEPLOY-1** (outage 30/06 por toolchain Netlify + deploy desde worktree) | Alta (histórica) | **MITIGADO** — Node 22 + NO-worktree + draft-first; NO se reprodujo en este deploy |
| R-1 | **Hydration mismatch del shell** (React #425/#422 por fecha localizada) | Baja (cosmético, recoverable) | Abierto — deuda no bloqueante, fix futuro |
| R-2 | **RBAC `seguridad → knowledge.edit`** | Baja (grant acotado, sin exposición amplia) | Abierto — requiere confirmación de Dirección |
| R-3 | `next@14.2.18` advisory pre-existente | Baja | Fuera de alcance de esta ventana |
| R-4 | 9 vistas SECURITY DEFINER (advisors ERROR) | Media (pre-existente, auditoría 2026-06-28) | Baseline conocido — 0 criticals NUEVOS por este deploy |

**Advisors de seguridad Supabase:** 275 entradas (todas categoría `SECURITY`) → 9 ERROR (`security_definer_view`, pre-existentes), 263 WARN, 3 INFO. Deploy UI-only → **0 criticals nuevos**.

---

## 8. Rollback point (referencia; NO ejecutado)

- **Deploy sano previo = `6a443775401cf1eb613dd99f` (`c310589`).**
- Restaurar vía Netlify dashboard → *Publish deploy* sobre `6a443775401cf1eb613dd99f`, o `netlify api restoreSiteDeploy --data '{"site_id":"d84a7d34-b90c-4e61-aff6-678abf1ac432","deploy_id":"6a443775401cf1eb613dd99f"}'`.
- Verificar `/api/version` == `c310589`.
- **NO revertir base de datos** salvo instrucción explícita: la capa DB de Nexus Link (migs 0142-0155) es **aditiva** y queda inerte si la UI se revierte.
- Rollback **no fue necesario** en este deploy.

---

## 9. Confirmación de estado

- ✅ **F3 quedó DESPLEGADA en producción** (commit `88add4b`, deploy `6a446ca4aa6e4e9f3b21711f`).
- ✅ Nexus Link visible y operativo.
- ✅ Smoke técnico verde (0 5xx, fail-closed OK).
- ✅ Rollback no requerido.
- ⏳ **Pendiente para cierre formal de F3:** validación piloto (7 usuarios) + aprobación de Dirección.
- 🚫 **F4 NO iniciada** (y no debe iniciarse hasta cerrar el piloto y F3).
- Git: rama `feat/nexus-link-integration` @ `88add4b` — **nada** pusheado/mergeado. DB **inalterada** por el deploy.

---

## Anexos / evidencia
- Log del deploy: `scratchpad/f3-prod-deploy.log`
- Screenshots: `~/CODE/dashboard-prod-88add4b.png`, `~/CODE/login-prod-88add4b.png` (Nexus Link Inicio), `~/CODE/connect-canales-prod-88add4b.png`
- Documentos relacionados: `F3-2B-SAFE-DEPLOY-PLAN.md`, `F3-2B-DRAFT-DEPLOY-REPORT.md`, `F3-2B-HANDOFF.md`, `F3-2B-NON-BLOCKING-DEBTS.md`, `F3-PILOT-VALIDATION-RUNBOOK.md`, `F3-CLOSURE-CRITERIA-AND-CHECKLIST.md`

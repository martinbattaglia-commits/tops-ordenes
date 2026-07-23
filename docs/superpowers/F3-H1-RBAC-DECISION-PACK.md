# F3 · H-1 — RBAC Dormido · Decision Pack

> Análisis read-only para decisión de Dirección sobre el hallazgo **H-1** (RBAC en modo dormido/anti-lockout) antes de autorizar las pruebas funcionales reales del piloto de Nexus Link F3.
> **2026-07-01 · SOLO lectura de código + consultas read-only. No se modificó nada.**
> Referencias: `F3-PILOT-VALIDATION-LOG.md`, `F3-2B-PROD-DEPLOY-REPORT.md`.

---

## 1. Resumen ejecutivo

**H-1:** el RBAC global de TOPS NEXUS está **desactivado por diseño (anti-lockout)**: la variable `RBAC_ENFORCE` no está en `"1"`, por lo que un usuario **sin ningún rol asignado** (`user_roles` vacío) recibe **acceso permisivo (fail-open)** en vez de fail-closed. Es un mecanismo **deliberado y documentado en el código** para no bloquear a nadie antes de sembrar los roles; **no es una regresión introducida por Nexus Link**.

**Impacto real, acotado:** activar `RBAC_ENFORCE=1` **solo cambia el comportamiento de los usuarios SIN rol** (hoy son **3**, y **los 3 son cuentas de Martín**). Los **7 usuarios del piloto ya están enforzados hoy** (los guards de usuarios asignados no dependen de `RBAC_ENFORCE`). Es decir: el "fail-open" vivo afecta a 3 cuentas internas controladas por el presidente; **blast-radius interno, 0 clientes**.

**Riesgo crítico de activación:** `martin@logisticatops.com` tiene `profiles.role='admin'` pero **NO tiene fila en `user_roles`** → con `RBAC_ENFORCE=1` quedaría **bloqueado de todos los módulos gateados** (el bootstrap per-user NO consulta el fallback admin). El código advierte explícitamente: *"Activar SOLO después de seedear `user_roles` en producción (si no, lockout total)"*.

**Recomendación (detalle §8):** **desacoplar** el enforcement global de RBAC (una decisión de hardening del ERP entero) del **cierre de F3**. Aceptar H-1 como **deuda temporal explícita (Opción A + D)** para el piloto interno, y planificar la activación controlada (Opción B) como hito separado con **seed previo del rol de `martin@`**. **Nexus Link no debe quedar bloqueado por una postura de RBAC preexistente y global.**

---

## 2. Evidencia técnica de H-1 (con archivos/líneas)

### 2.1 Dónde se define y default
- **`src/lib/env.ts:62`** → `enforce: process.env.RBAC_ENFORCE === "1"` → **default OFF** (cualquier valor ≠ `"1"` = dormido).
- **`src/lib/env.ts:57-60`** (comentario): *"fail-open de bootstrap: cuando `user_roles` está GLOBALMENTE vacía, checkPermission permite (RBAC dormido)… Con `RBAC_ENFORCE=1` ese caso pasa a fail-closed (403). Activar SOLO después de seedear `user_roles` en producción (si no, lockout total)."*

### 2.2 Guard de acceso — `src/lib/rbac/guard.ts:26-44` (`canAccess`)
```
if ((count ?? 0) === 0) return !env.rbac.enforce;   // SIN rol → permitir salvo enforce
const { data } = await supabase.rpc("has_permission", { p_slug: slug });
return data === true;                                // CON rol → enforcement real (ya vivo)
```
→ **Usuario CON rol: enforcement real HOY, sin depender de `RBAC_ENFORCE`** (el RPC `has_permission` tiene fallback `current_role()='admin'`). **Usuario SIN rol: permitido salvo `RBAC_ENFORCE=1`.**

### 2.3 Flags de boot (nav/secciones) — `src/lib/rbac/boot-permissions.ts`
- Línea **22** (doc): *"Usuario SIN user_roles → bootstrap per-user: todo `!RBAC_ENFORCE` (hoy: permitir)."*
- Líneas **106-109**: `if (count===0) { const open = !env.rbac.enforce; return {exec:open, sistema:open, rrhhDocs:open, knowledge:open, connect:open}; }` → el bootstrap **NO** consulta `isLegacyAdmin`.
- Líneas **133-138** (usuario asignado): `connect: slugs.has("connect.view") || isLegacyAdmin` (fallback `profiles.role='admin'` solo para asignados).

### 2.4 Nexus Link SÍ gatea — `src/app/(app)/connect/layout.tsx:15`
```
if (!(await canAccess("connect.view"))) return <AccesoRestringido modulo="Nexus Link" />;
```
→ `/connect` es **fail-closed vía `connect.view`** para usuarios asignados; para sin-rol depende del bootstrap global (permitido hoy).

### 2.5 Por qué es anti-lockout y NO una regresión de Nexus Link
- El flag, el bootstrap y los guards **preexisten a F3** (diseño 2026-06-08/09, ver `guard.ts:18-24`, `boot-permissions.ts:2-26`). Documentado como "RBAC dormido/fail-open" en la **auditoría de permisos 2026-06-28**.
- Nexus Link **agregó** su propio gate correcto (`connect.view`), **respetando** la misma semántica del resto del ERP. No cambió el flag ni el bootstrap.
- **Conclusión:** H-1 es una **postura global preexistente del ERP**, no un defecto de F3.

---

## 3. Matriz de usuarios (10 actuales)

| Email | `profiles.role` | Roles RBAC | Acceso HOY (dormido) | Acceso con `RBAC_ENFORCE=1` | Riesgo lockout | Recomendación |
|---|---|---|---|---|---|---|
| **martin@logisticatops.com** | admin | **(ninguno)** | Todo (bootstrap permisivo) | **BLOQUEADO en todo módulo gateado** (bootstrap ignora fallback admin) | **🔴 ALTO** | **Seedear rol `admin` en `user_roles` ANTES de activar** |
| martin.battaglia@logisticatops.com | operaciones | (ninguno) | Todo (bootstrap) | Bloqueado en gateados | 🟠 Medio (si se usa) | Asignar rol o confirmar que no opera |
| martinferbat@gmail.com *(gmail)* | operaciones | (ninguno) | Todo (bootstrap) | Bloqueado en gateados | 🟡 Bajo (cuenta personal) | Confirmar propósito; asignar o dejar fuera (H-5) |
| joseluis@logisticatops.com | admin | director_ops, rrhh_admin | Enforzado (amplio) | **Sin cambio** | ✅ Ninguno | OK |
| mariela@sullivancamejo.com.ar *(externo)* | admin | director_ops, rrhh_admin | Enforzado (amplio) | **Sin cambio** | ✅ Ninguno | OK — revisar dominio externo con privilegios (H-4) |
| cynthia@logisticatops.com | supervisor | gerencia | Enforzado (amplio) | **Sin cambio** | ✅ Ninguno | OK |
| martinrinas@logisticatops.com | supervisor | gerencia | Enforzado | **Sin cambio** | ✅ Ninguno | OK |
| ruth@logisticatops.com | supervisor | gerencia | Enforzado | **Sin cambio** | ✅ Ninguno | OK |
| despachos-lujan@logisticatops.com | operaciones | jefe_deposito | Enforzado (acotado) | **Sin cambio** | ✅ Ninguno | OK |
| despachos-magaldi@logisticatops.com | operaciones | jefe_deposito | Enforzado (acotado) | **Sin cambio** | ✅ Ninguno | OK |

**Lectura:** de los 10, **solo 3 (sin rol) cambian** con enforce; los 3 son cuentas de Martín. Los **7 del piloto no cambian**. El único lockout serio es **`martin@`** (falta `user_roles`).

---

## 4. Matriz por módulo (impacto de `RBAC_ENFORCE=1`)

**Comportamiento general:** el enforce **NO cambia** a los usuarios asignados (ya enforzados). **Solo** cambia a los sin-rol (pasan de permitido→denegado en módulos gateados). Módulos **sin gate** quedan abiertos a cualquier autenticado en ambos casos.

### Módulos GATEADOS (fail-closed para sin-rol con enforce=1)
| Módulo | Gate (archivo) | Slug | Roles con `.view` |
|---|---|---|---|
| **Nexus Link** `/connect` | `connect/layout.tsx:15` (AccesoRestringido) | `connect.view` | admin, director_ops, gerencia, jefe_deposito, operaciones, compliance, comercial, rrhh_admin, seguridad |
| Compras | `compras/layout.tsx:15` (→/dashboard) | `compras.view` | admin, director_ops, gerencia, operaciones |
| Pedidos | `pedidos/layout.tsx:13` | `pedidos.view` | admin, director_ops, gerencia, compliance, operaciones |
| Tesorería | `tesoreria/layout.tsx:14` | `tesoreria.view` | admin, director_ops, gerencia, compliance, operaciones |
| Comercial | `comercial/layout.tsx:14` | `comercial.view` | admin, director_ops, gerencia, comercial, operaciones |
| Operaciones | `operaciones/layout.tsx:14` | `operaciones.view` | admin, director_ops, gerencia, operaciones, seguridad |
| ANMAT | `anmat/layout.tsx:13` | `compliance.view` | admin, director_ops, gerencia, compliance |
| Drive | `drive/layout.tsx:14` | `compliance.view` | idem ANMAT |
| CCTV | `cctv/layout.tsx:13` | `cctv.view` | admin, director_ops, gerencia, compliance, operaciones, seguridad |
| Billing / Reports | `billing|reports/layout.tsx:13` | `analytics.view` | admin, director_ops, gerencia |
| Knowledge Admin | `knowledge/admin/page.tsx:30` | `knowledge.admin` | admin, director_ops, gerencia (holders de knowledge.admin) |
| RRHH | `rrhh/**/page.tsx` | `rrhh.view/edit/documentacion.view` | admin, director_ops, gerencia, rrhh_admin/manager/viewer |
| Settings / Roles / Users / Fiscal / Tracking / Comunicados / Templates / Organigrama | `settings/**`, `sistema/comunicados`, `templates`, `organigrama` | `sistema.view` (fallback `profiles.role='admin'`) | admins de perfil (joseluis, mariela) |
| Analytics | `analytics/page.tsx:14` (checkPermission) | `analytics.view` | admin, director_ops, gerencia |
| Prospección / Tesorería-conciliación | sub-gates en page | `prospeccion.*`, `tesoreria.conciliacion.*` | según rol |

### Módulos SIN gate RBAC (abiertos a cualquier autenticado; enforce NO cambia)
`dashboard` · `ejecutivo` (cockpit; el flag `exec` solo oculta bloques financieros) · `orders` · `wms` · `clientes` · `clients` · `c/[token]` (portal cliente).
> Observación colateral (no es H-1): estos módulos no tienen gate de página propio. Queda registrado para el hardening global, fuera del alcance de F3.

**Validaciones necesarias antes de enforce=1:** confirmar que cada rol operativo tiene los `.view` de los módulos que su gente usa a diario (la matriz de arriba indica que sí para los 7), y **seedear rol a las cuentas sin rol que deban seguir operando** (crítico: `martin@`).

---

## 5. Impacto de activar `RBAC_ENFORCE=1` (resumen)

- **Módulos afectados:** solo los **gateados** (§4), y **solo** para usuarios **sin rol**.
- **Rutas que podrían bloquearse:** todas las gateadas, para los 3 sin-rol.
- **Usuarios que perderían acceso:** `martin@` (🔴, admin sin user_roles), `martin.battaglia@`, `martinferbat@gmail` (todos de Martín).
- **Roles con permisos suficientes:** los 7 asignados ya cubren sus módulos (sin cambio).
- **Usuarios que necesitan rol antes de activar:** **`martin@` (obligatorio)**; opcionalmente `martin.battaglia@` / `martinferbat@`.
- **Riesgo de lockout administrativo:** **SÍ, real**, si se activa sin seedear `martin@` → el admin de perfil sin `user_roles` queda afuera. **Es exactamente lo que el código advierte.**

---

## 6. Opciones de decisión

### Opción A — Aceptar RBAC dormido para el piloto
- **Riesgo:** usuarios sin rol acceden (fail-open). **Alcance:** 3 cuentas, todas de Martín; **0 clientes**.
- **Mitigaciones:** piloto solo con los 7 usuarios con rol; convención `[PRUEBA]`; no exponer a externos; monitoreo.
- **Condiciones mínimas:** aceptación explícita de Dirección; no incorporar cuentas externas nuevas sin rol durante el piloto.
- **Por qué es aceptable SOLO para piloto interno:** blast-radius interno y controlado; los 7 legítimos ya están enforzados; permite validar F3 sin abrir el frente de hardening global.
- **Por qué NO debe ser definitivo:** deja fail-open a futuras cuentas sin rol; incompatible con exposición a clientes/externos.

### Opción B — Activar `RBAC_ENFORCE=1`
- **Precondiciones (obligatorias):** (1) **seedear rol `admin` a `martin@`** (y decidir sobre `martin.battaglia@`/`martinferbat@`); (2) confirmar cobertura de `.view` por rol (ya validada, §4); (3) plan de verificación post-activación.
- **Usuarios a corregir antes:** los 3 sin rol (mínimo `martin@`).
- **Riesgos:** lockout si se activa sin seed; requiere cambio de env var en Netlify + (posible) redeploy.
- **Rollback:** quitar `RBAC_ENFORCE` (o ≠"1") + redeploy → vuelve a dormido. Reversible.
- **Pasos:** seed user_roles (migración/seed, requiere autorización DB) → set env `RBAC_ENFORCE=1` → deploy/redeploy → smoke con cada rol → validar que ningún legítimo perdió acceso.
- **Validaciones:** login por rol; acceso a módulos esperados; que `martin@` conserve admin; que sin-rol queden fail-closed.
- **Posibilidad de lockout:** alta si se omite el seed; nula si se respeta la precondición.
- **Nota:** es **hardening global del ERP**, excede F3.

### Opción C — Enforcement específico para Connect (sin activar RBAC global)
- **Idea:** modificar `connect/layout.tsx` para exigir `connect.view` **ignorando** el bootstrap permisivo (p.ej. requerir presencia de rol o chequear el permiso sin la rama `!enforce`).
- **Evaluación:** **no recomendado.** (a) Requiere **cambio de código** (fuera de alcance/ventana); (b) crea una **excepción divergente** a la semántica RBAC global (deuda de consistencia, viola OCP/uniformidad); (c) el gap real (sin-rol permisivo) es **global**, no de Connect — resolverlo solo en Connect deja el resto del ERP igual. **Analizado, no implementar.**

### Opción D — Diferir H-1 como deuda formal
- **Impacto:** se mantiene el fail-open para sin-rol hasta la activación global.
- **Riesgo aceptado:** acceso de cuentas sin rol (hoy 3, internas).
- **Condiciones de aceptación:** registro formal (este pack), aceptación de Dirección, y **disparador de resolución**.
- **Fecha/fase sugerida:** activar Opción B **antes** de: (i) exponer el sistema a clientes/externos, o (ii) iniciar F5, lo que ocurra primero.

---

## 7. Riesgos

| ID | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| H-1 | Sin-rol acceden (fail-open) mientras RBAC dormido | Media (interno) | Opción A+D con aceptación explícita; resolver con B antes de exposición externa |
| Lockout `martin@` si se activa B sin seed | **Alta** | Seed obligatorio de rol admin antes de `RBAC_ENFORCE=1` |
| H-4 | `mariela@sullivancamejo.com.ar` (dominio externo) con director_ops+rrhh_admin+profile admin | Media | Confirmar que es acceso intencional (contadora externa); revisar en hardening |
| H-5 | `martinferbat@gmail.com` (gmail) sin rol con acceso permisivo | Baja | Confirmar propósito; asignar o excluir |
| Colateral | dashboard/ejecutivo/orders/wms/clientes/clients sin gate de página | Baja-Media | Fuera de F3; registrar para hardening global |

---

## 8. Recomendación

**Desacoplar H-1 del cierre de F3.** Concretamente:

1. **Aceptar H-1 como deuda temporal explícita para el piloto interno (Opción A + D).** Justificación: (a) es una postura **global y preexistente** del ERP, no un defecto de Nexus Link; (b) blast-radius **interno, 0 clientes**, 3 cuentas todas de Martín; (c) los **7 usuarios del piloto ya están enforzados**; (d) F3 es funcionalmente completo y seguro para el piloto.
2. **No activar `RBAC_ENFORCE=1` como condición de F3.** Activarlo es **hardening global** que requiere seed de roles (crítico: `martin@`) y validación por rol — un hito propio, no mezclar con F3.
3. **Planificar la Opción B como follow-up con disparador claro:** ejecutar **antes** de exponer el sistema a clientes/externos o de iniciar F5. Precondición dura: **seedear rol admin a `martin@`** (y resolver las otras 2 cuentas).
4. **Descartar Opción C** (excepción solo-Connect): añade deuda de consistencia sin resolver el gap global.
5. Registrar H-4/H-5 y el gap colateral (módulos sin gate) en el backlog de hardening global.

**Prioridades atendidas:** seguridad (blast-radius acotado + plan de cierre) · continuidad operativa (sin lockout, sin bloquear a nadie) · no bloquear F3 injustificadamente · evitar lockout (`martin@` seed obligatorio) · no mezclar F3 con el hardening global del ERP.

---

## 9. Criterio GO / NO GO para pruebas funcionales reales

**Recomendado: GO condicionado a la aceptación explícita de H-1 como deuda temporal (Opción A+D).**

- **Alcanza con** aceptación explícita de Dirección de H-1 como deuda temporal → **GO** para las pruebas funcionales del piloto con los **7 usuarios habilitados** (todos con rol y ya enforzados), usando convención `[PRUEBA]`.
- **NO es necesario** activar enforcement (Opción B) para correr el piloto, porque el riesgo de H-1 no involucra a los 7 usuarios del piloto ni a clientes.
- **NO GO** si Dirección **no** acepta H-1 y en cambio exige enforcement previo → entonces la precondición pasa a ser: seedear rol de `martin@` + activar B + validar sin lockout, y recién después correr el piloto.

**Resumen:** `GO` ⇐ (Dirección acepta H-1 como deuda temporal) **ó** (se ejecuta Opción B con seed previo y validación). Cualquiera de las dos habilita las pruebas funcionales.

---

## 10. Confirmación de no-modificación

Durante la elaboración de este pack **NO** se ejecutó: deploy · push · merge · migraciones · cambios de DB · cambios de permisos/roles · cambios de variables de entorno · cambios en Netlify · cambios de código · pruebas mutantes · creación de datos · inicio de F4. **Todo fue lectura de código + consultas SQL read-only (SELECT).** Producción intacta en `88add4b`. El archivo `HEAD` no fue tocado. Las deudas no fueron corregidas.

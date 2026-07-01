# F3 · Pilot Validation Log — Nexus Link

> Registro de evidencias de la validación piloto de Nexus Link F3 en producción (`nexus.logisticatops.com`, commit `88add4b`).
> **Pasada #1 — 2026-07-01 (técnica NO destructiva; sin datos creados).**
> Referencias: `F3-PILOT-VALIDATION-RUNBOOK.md`, `F3-2B-PROD-DEPLOY-REPORT.md`.

---

## Pasada #1 — Validación técnica no destructiva (read-only)

**Ejecutor:** sesión asistida (curl + Supabase read-only + navegación autenticada read-only de `martin@logisticatops.com`). **Sin** envío de mensajes / creación de canales / edición de perfiles.

### Etapa 1 — Pre-flight
| # | Chequeo | Resultado | PASS |
|---|---|---|---|
| 1 | Prod en `88add4b` | `/api/version` = 88add4b, env=production | ✅ |
| 2 | `/api/version` responde | HTTP 200 | ✅ |
| 3 | `/login` responde | HTTP 200 | ✅ |
| 4 | `/connect` responde | 307 → /login (sin auth) | ✅ |
| 5 | Sin 5xx | 0 respuestas 5xx (18 rutas) | ✅ |
| 6 | RBAC sin cambios | idéntico (director_ops 70 … cliente_b2b 1) | ✅ |
| 7 | Usuarios habilitados = 7 | total 10 / con rol 7 / sin rol 3 | ✅ |
| 8 | Usuarios sin rol | 3 (ver hallazgo H-1) | ⚠️ |
| 9 | Externos sin acceso | ver hallazgo H-1 (RBAC dormido) | ⚠️ |
| 10 | Git sin cambios pendientes | HEAD `a0f28f6`, tree limpio | ✅ |

### Etapa 2 — Rutas (fail-closed sin auth)
| Ruta | HTTP sin auth | Redirect | PASS |
|---|---|---|---|
| `/connect` | 307 | /login?from=%2Fconnect | ✅ |
| `/connect/canales` | 307 | /login | ✅ |
| `/connect/notificaciones` | 307 | /login | ✅ |
| `/connect/buscar?q=magaldi` | 307 | /login?q=magaldi&from=… | ✅ |
| `/connect/actividad` | 307 | /login | ✅ |
| `/connect/perfil` | 307 | /login | ✅ |
| `/connect/favoritos` | 307 | /login | ✅ |
| `/ejecutivo` `/dashboard` `/orders` `/compras` `/anmat` `/wms` `/tesoreria` `/rrhh` | 307 | /login | ✅ |
| `/api/today` | 401 | — | ✅ |

**Render autenticado (read-only, sesión `martin@logisticatops.com`):** `/connect` (Inicio, datos reales de timeline), `/connect/canales` (empty-state), `/dashboard` (cockpit completo) → renderizan al 100%. Consola: 0 errores propios de Nexus Link; 2 errores de shell (hydration #425/#422, deuda A). Red: `/rest/v1/notifications` → 200 ×3, token → 200; **0 5xx**.
*(Pendiente pasada autenticada de `/connect/{notificaciones,buscar,actividad,perfil,favoritos}` — se cubren en la ejecución con usuarios reales.)*

### Etapa 3 — Matriz de usuarios (estado actual en prod)
**Con rol RBAC (7 usuarios; joseluis y mariela tienen 2 roles):**
| Email | Rol(es) RBAC | connect.view | edit esperado |
|---|---|---|---|
| joseluis@logisticatops.com | director_ops + rrhh_admin | sí | full + rrhh.edit |
| mariela@sullivancamejo.com.ar *(dominio externo)* | director_ops + rrhh_admin | sí | full + rrhh.edit |
| cynthia@logisticatops.com | gerencia | sí | sí |
| martinrinas@logisticatops.com | gerencia | sí | sí |
| ruth@logisticatops.com | gerencia | sí | sí |
| despachos-lujan@logisticatops.com | jefe_deposito | sí | sí (acotado) |
| despachos-magaldi@logisticatops.com | jefe_deposito | sí | sí (acotado) |

**Sin rol RBAC (3):**
| Email | profile.role (legacy) | Acceso hoy (RBAC dormido) |
|---|---|---|
| martin@logisticatops.com | admin | Accede (bootstrap fail-open + admin) |
| martin.battaglia@logisticatops.com | operaciones | Accede (bootstrap fail-open) |
| martinferbat@gmail.com *(gmail)* | operaciones | Accede (bootstrap fail-open) |

**connect.view por rol (RBAC):** admin/director_ops = connect.* completo; gerencia/jefe_deposito/operaciones/compliance/comercial = create+edit+view; rrhh_admin/seguridad = create+view. **→ Los 7 usuarios del piloto tienen acceso propio a Nexus Link (no dependen del bypass).**

---

## Hallazgos (clasificación Etapa 6)

| ID | Hallazgo | Severidad | ¿Del deploy? | Acción |
|---|---|---|---|---|
| **H-1** | **RBAC en modo dormido/anti-lockout** (`RBAC_ENFORCE`≠"1") → usuarios SIN rol reciben acceso permisivo (fail-open) **por diseño**. Confirmado: `martin@` (sin rol RBAC) accede a `/connect`. | **Alta (decisión)** | **No** — estado pre-existente documentado (auditoría 2026-06-28) | Dirección decide si activa `RBAC_ENFORCE=1` (tras confirmar que todos los legítimos tienen rol) antes del rollout amplio. **No modificable en esta ventana.** |
| **H-2** | Hydration mismatch del shell (React #425/#422) | Baja (cosmético) | No (deuda A) | Fix futuro |
| **H-3** | `seguridad → knowledge.edit` (RBAC) | Baja (deuda B) | No | Decisión Dirección |
| **H-4** | `mariela@sullivancamejo.com.ar` (dominio externo) con `director_ops+rrhh_admin` | Observación | No | Confirmar que es acceso intencional (contadora externa) |
| **H-5** | `martinferbat@gmail.com` (gmail) como usuario sin rol con acceso permisivo | Observación | No | Cuenta personal de Martín; revisar en decisión de H-1 |

**0 hallazgos CRÍTICOS del deploy. Ninguno detiene el piloto.**

---

## Etapa 4 — Pruebas funcionales autorizables (PREPARADAS, NO ejecutadas)

> Requieren autorización explícita posterior. Ejecutar con los usuarios reales en ventana de piloto.

| Prueba | Dato que crea | Identificación | Limpieza / conservación | Riesgo | Criterio de éxito |
|---|---|---|---|---|---|
| Crear conversación de prueba | 1 fila `connect_conversations` (+owner) | título `[PRUEBA-F3]` | Conservar o archivar; borrable por admin | Bajo (interno) | Se crea, aparece en bandeja, visible solo a participantes |
| Enviar mensaje de prueba (DM) | filas `connect_messages` | prefijo `[PRUEBA]` | Conservar; sin PII real | Bajo | Entregado + realtime al receptor; markRead OK |
| Crear canal de prueba | 1 fila `connect_channels` `#piloto-f3` | slug `piloto-f3` | Archivar al cerrar piloto | Bajo | Canal creado; unión pública fail-closed (no-miembro no modera) |
| Modificar perfil | update `profiles`/perfil connect | campo con sufijo `(prueba)` | Revertir al valor original | Bajo | Guarda y refleja; sin romper otros datos |
| Marcar favorito | fila favoritos | conversación de prueba | Desmarcar al finalizar | Muy bajo | Aparece en `/connect/favoritos` |
| Probar notificación | evento que notifica | asociado a prueba | Se autolimpia | Bajo | Notificación aparece (realtime/polling) |
| Realtime entre 2 usuarios | mensajes en vivo | sesión A↔B `[PRUEBA]` | Conservar | Bajo | Mensaje de A aparece en B sin refrescar |

---

## Estado de cierre (parcial, tras pasada #1)
- Bloque técnico: **verde** (prod 88add4b, 0 5xx, fail-closed sin-auth OK, Nexus Link operativo, 7 usuarios provisionados).
- **Punto de decisión para cierre:** H-1 (RBAC dormido) — el criterio "usuarios sin rol/externos sin acceso" NO se cumple mientras `RBAC_ENFORCE`≠1. Es estado por diseño, no defecto; requiere decisión de Dirección.
- Próximo: ejecutar pruebas funcionales (Etapa 4) con los 7 usuarios, previa autorización.

---

## Pasada #2 — Piloto funcional autorizado (2026-07-01)

### Decisión de Dirección registrada
- **H-1 aceptado como deuda temporal (Opción A + D)**: RBAC dormido/anti-lockout se mantiene durante el piloto interno; **NO se activa `RBAC_ENFORCE=1`**, no se seedean roles, no se tocan env vars. H-1 = deuda técnica **preexistente y global** del ERP (no defecto de Nexus Link), a resolver como workstream separado **antes** de habilitar clientes/proveedores/externos o exposición mayor. Detalle: `F3-H1-RBAC-DECISION-PACK.md`.
- **Autorizadas** pruebas funcionales con alcance interno, mínima mutación, convención `[PRUEBA-F3]`.

### Restricción de ejecución (por qué el asistente NO mutó)
- **No hay sesión disponible** de ninguno de los 7 usuarios del piloto; la única sesión activa es `martin@logisticatops.com` = **usuario SIN rol** → por scope de Dirección, *"usuarios sin rol solo como observación documental"* + *"no suplantar usuarios / no pedir contraseñas / no resetear credenciales"* + *"si no hay sesión disponible, preparar checklist para validación manual"*.
- **Decisión:** el asistente **NO ejecuta mutaciones**. **Datos creados por el asistente: NINGUNO.** Se entrega el paquete de validación manual (abajo) para ejecución por cada usuario en su propia sesión.

### Observación documental (read-only, sesión `martin@`, sin mutar)
- `/connect` (Inicio), `/connect/canales`, `/dashboard` renderizan al 100% con datos reales (timeline). 7 rutas `/connect` fail-closed sin auth. 0 5xx. Consola: solo hydration del shell (#425/#422, deuda A). `martin@` accede por RBAC dormido (H-1, aceptado).

---

## Paquete de validación manual — a ejecutar por cada uno de los 7 usuarios

> Cada usuario abre `https://nexus.logisticatops.com` en su navegador (DevTools → Console + Network abiertos) y ejecuta en SU propia sesión. Prefijo obligatorio `[PRUEBA-F3]` en todo dato. No usar datos sensibles ni clientes reales. Ante 500/502, error crítico de consola, pérdida de acceso, falla de login o datos corruptos → **DETENER y reportar** (no improvisar fixes).

**Usuarios objetivo (7):** joseluis@ (director_ops+rrhh_admin) · mariela@sullivancamejo.com.ar (director_ops+rrhh_admin) · cynthia@ · martinrinas@ · ruth@ (gerencia) · despachos-lujan@ · despachos-magaldi@ (jefe_deposito).

| # | Prueba | Pasos | Esperado | PASS/FAIL | Evidencia | Dato creado |
|---|---|---|---|---|---|---|
| V1 | Login | Iniciar sesión | Acceso OK, sin error | | screenshot | — |
| V2 | Acceso `/connect` | Abrir Inicio | "Hola, <usuario>" + Actividad/Notif/Favoritos/Canales | | screenshot | — |
| V3 | Conversación | Crear/abrir conversación, enviar mensaje `[PRUEBA-F3] ping <inicial>` | Persiste + se lee + sin error | | screenshot | mensaje `[PRUEBA-F3]` |
| V4 | Lectura/markRead | Abrir el hilo, marcar leído | Estado leído correcto, sin duplicados | | screenshot | — |
| V5 | Canal (si rol permite) | Crear canal `[PRUEBA-F3]-<inicial>` | Canal creado, visible, uno mismo como miembro; **no invitar externos** | | screenshot | canal `[PRUEBA-F3]` |
| V6 | Búsqueda | `/connect/buscar?q=[PRUEBA-F3]` | Devuelve el contenido de prueba; FTS no rompe | | screenshot | — |
| V7 | Notificaciones | Abrir `/connect/notificaciones` | Lista/estado correcto; sin spam | | screenshot | — |
| V8 | Actividad | Abrir `/connect/actividad` | Feed con datos, sin error | | screenshot | — |
| V9 | Perfil (lectura) | Abrir `/connect/perfil` | Datos correctos. *Si se cambia una preferencia: anotar valor previo y restaurarlo.* | | screenshot | — (o revertido) |
| V10 | Favoritos | Marcar favorito de prueba, luego desmarcar | Aparece/desaparece en `/connect/favoritos` | | screenshot | favorito (revertido) |
| V11 | Realtime (2 sesiones) | Si hay 2 usuarios simultáneos: A envía `[PRUEBA-F3]`, B observa | Aparece en vivo sin refrescar. *Si no hay 2 sesiones → PENDIENTE manual.* | | screenshot | mensaje `[PRUEBA-F3]` |
| V12 | RBAC | Confirmar acceso acorde al rol; no intentar acciones fuera de permiso | Acceso esperado; sin fail-open indebido | | nota | — |

**Criterios de parada:** 500/502 · error crítico de consola · pérdida de acceso general · falla de login · datos corruptos · problema grave de permisos · regresión en módulos existentes → DETENER + reportar.

**Limpieza:** los `[PRUEBA-F3]` (mensajes/canales) pueden **archivarse** por el propio usuario (RPC `connect_archive_conversation` / `connect_delete_message` disponibles vía UI); si no hay acción segura, **dejar identificados con `[PRUEBA-F3]`** y documentar cuáles quedaron. **No ejecutar deletes directos en DB** sin autorización explícita.

---

## Estado de cierre (tras Pasada #2)
- **Capas técnicas: VERDES** (deploy sano 88add4b, 0 5xx, fail-closed sin-auth OK, Nexus Link operativo, 7 usuarios con `connect.view` propio, RBAC intacto). **0 hallazgos críticos.**
- **Validación funcional user-driven: PENDIENTE de ejecución manual** por los 7 usuarios (el asistente no dispone de sus sesiones; no suplanta). Paquete entregado arriba.
- **Datos de prueba en producción: NINGUNO creado por el asistente.**
- **Deudas no bloqueantes vigentes:** H-1 (aceptada A+D), A (hydration shell), B (`seguridad→knowledge.edit`), H-4 (mariela@ dominio externo), H-5 (martinferbat@ gmail).
- **Recomendación de cierre:** ver §Entregable 10 (informe inline). En tanto no aparezcan críticos en la ejecución manual, el rumbo es **B (aprobado con observaciones no bloqueantes)**.

---

## Pasada #2b — Smoke funcional excepcional (sesión `martin@`, autorizado por Dirección)

> Excepción puntual autorizada para validar el **write-path técnico** en la única sesión disponible (`martin@`, sin rol; NO reemplaza la validación manual de los 7). Fecha/hora: **2026-07-01 ~02:27–02:40 UTC**. Convención `[PRUEBA-F3]`.

### Datos creados (y estado final)
| Dato | Identificación | Estado final |
|---|---|---|
| Canal privado | `[PRUEBA-F3] Canal piloto` (slug `prueba-f3-canal-piloto`, CTX-2026-000001, conv `5114d6b4-…`) | **ARCHIVADO** (`archived_at=2026-07-01T02:39:42Z`, reversible) |
| Mensaje | `[PRUEBA-F3] Mensaje de validación` (1 fila DB, íntegro) | Dentro del canal archivado |

**Datos que quedaron en producción:** 1 canal privado archivado + 1 mensaje, ambos `[PRUEBA-F3]`, reversibles (desarchivar). No se ejecutaron deletes por SQL.

### Resultados por prueba
| # | Prueba | Resultado | Evidencia |
|---|---|---|---|
| V1/V2 | Acceso `/connect` (+Inicio) | ✅ PASS (render OK, red 0 5xx, solo hydration shell) | snapshot/red |
| V5 | Crear canal (privado) | ✅ PASS — `POST /connect/canales → 200`, owner=martin@, renderiza | screenshot |
| V3 | Enviar mensaje | ✅ PASS — persiste, **1 fila en DB** (íntegro), 0 5xx | screenshot + SQL count=1 |
| — | Archivar canal | ✅ PASS — `archived_at` seteado (write-path archivar OK) | SQL |
| V6 | **Búsqueda** | 🔴 **FAIL — BUG CONFIRMADO** (ver F-SEARCH) | screenshots + error SQL |
| V10 | Favoritos | ⚠️ INCONCLUSO — toggle ⭐ no expuesto en bandeja/hilo/header probados (`connect_participants.is_favorite` existe); pendiente manual en la superficie correcta | — |
| V7/V8 | Notificaciones/Actividad | ✅ vistas renderizan (Inicio: "Sin pendientes" + Actividad con timeline real); generación de evento por creación no verificada específicamente | snapshot |
| V11 | Realtime | ⏸️ PENDIENTE — sin 2ª sesión disponible | — |

### Hallazgo nuevo
| ID | Hallazgo | Severidad | ¿Del deploy/F3? |
|---|---|---|---|
| **F-SEARCH** | **Búsqueda global de Nexus Link ROTA.** `connect_search(text,int)` lanza `ERROR 42702: column reference "conversation_id" is ambiguous` (colisión entre la columna OUT `conversation_id` del `RETURNS TABLE` y `select conversation_id from my_convs`) → **siempre falla para cualquier usuario**; la UI **enmascara la excepción como "Sin resultados"**. Confirmado vía llamada directa a la RPC. **NO** es lag de indexación, tokenización del guion, ni artefacto de `martin@` sin rol (la data existe, el FTS matchea `true`, la membresía es correcta, `has_permission` pasó). Degrada con gracia (sin 5xx/crash/pérdida de datos). | **Alta** | **Sí — F3/RC1.4 (mig 0153 `connect_search`)** |
| F-SEARCH-2 (colateral) | La UI de búsqueda **traga la excepción** de la RPC y muestra "Sin resultados" en vez de un estado de error → oculta el fallo real. | Media | Sí |
| F-DUP-RENDER | Mensaje se renderiza 2× de forma **optimista transitoria**; reconcilia a 1 tras reload (DB=1 fila). Sin impacto de datos. | Baja | Sí (UI) |

**Fix sugerido F-SEARCH (NO aplicado):** calificar la columna del subquery, p.ej. `select mc.conversation_id from my_convs mc` (o renombrar la columna OUT / usar alias), en las 4 ramas del `connect_search`. Requiere migración → workstream separado, fuera de esta ventana.

### Clasificación del smoke
- **Write-path técnico: ✅ FUNCIONAL** (crear canal, enviar mensaje, persistir, archivar — todo OK, data íntegra, 0 5xx).
- **Pero** se confirmó **F-SEARCH (Alta)**: la búsqueda global está rota. Degrada con gracia (no crítica de parada), pero es un **defecto real de F3** que Dirección debe ponderar para el cierre.
- **Resultado del smoke: B — aprobado con observaciones** (write-path OK; búsqueda rota como observación de alta prioridad a corregir).

### Decisión Dirección + Hotfix preparado (2026-07-01)
- **Dirección NO acepta F-SEARCH como deuda:** la búsqueda es funcionalidad central → **debe corregirse antes del cierre formal de F3** (deploy NO se revierte; Nexus Link queda publicado; F3 NO cerrada hasta corregir/validar `connect_search`).
- **Hotfix preparado (NO aplicado):** migración `supabase/migrations/0156_fix_connect_search_ambiguous_conversation_id.sql` (`CREATE OR REPLACE`, califica las 4 subqueries `mc.conversation_id`; firma/lógica/grants/SECDEF intactos). Plan completo: `F3-FSEARCH-HOTFIX-PLAN.md`. Validado read-only (SELECT standalone devuelve el mensaje `[PRUEBA-F3]`). **Pendiente autorización de Dirección para aplicar `0156` a prod.**
- **`0156` APLICADA a prod (2026-07-01, `apply_migration` success, `schema_migrations` 20260701025846).** Bug #1 (`42702`) corregido y verificado (firma/SECDEF/owner/grants preservados). **PERO el smoke reveló un SEGUNDO bug pre-existente F-SEARCH-2:** `ERROR 0A000 invalid UNION ORDER BY` (el `order by sort_rank, occurred_at` del UNION referencia variables OUT). Estaba enmascarado por el `42702`. **Búsqueda sigue rota.** No se improvisó fix ni rollback (rollback reintroduce #1 sin arreglar nada). **`0157` PREPARADA** (`supabase/migrations/0157_fix_connect_search_union_order_by.sql`, ORDER BY posicional `order by 10,9`, validado read-only: devuelve el mensaje). **Pendiente autorización para aplicar `0157`.** Detalle: `F3-FSEARCH-HOTFIX-EXECUTION-LOG.md`. Commit local NO creado (smoke aún no pasa). F4 bloqueada.
- **✅ F-SEARCH RESUELTO (2026-07-01):** `0157` APLICADA a prod (`apply_migration` success, `schema_migrations`). Checkpoints OK (ORDER BY posicional; firma/SECDEF/owner/grants preservados). **Smoke RPC:** `mensaje`/`validación`/`PRUEBA-F3` → devuelven el mensaje `[PRUEBA-F3]`; sin `42702`/`0A000`. **Smoke UI:** `/connect/buscar?q=mensaje` → "1 resultado" visible, 0 errores consola, 0 5xx. **Búsqueda global de Nexus Link OPERATIVA (RPC+UI).** Rollback no requerido. Commit local `fix(db): repair Nexus Link search RPC` (docs+migraciones 0156/0157, sin push).

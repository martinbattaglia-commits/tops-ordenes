# F4.2 · Centro de Incidentes — Execution Log

## 0. 🏁 VENTANA APPLY+DEPLOY EJECUTADA (2026-07-02, autorizada por Dirección)

**Resultado: ÉXITO — rollback NO requerido. Prod = `484a447`.**

| Paso | Resultado | Evidencia |
|---|---|---|
| Pre-flight (14 puntos) | **PASS 14/14** | prod `bef2f78` sana (0 5xx), top `0163`, `0164-0167` libres, worktree `484a447` limpio, package files intactos, sin secretos, Netlify `tops-ordenes` (`d84a7d34…`) autenticado, Node v22.23.1, checkout NO-worktree `~/CODE/deploy-f3-nexus-clean` |
| Apply `0164` | **OK** 02:03:44→02:04:12Z | `schema_migrations` `20260702020412 0164_connect_incidents_schema` |
| Apply `0165` | **OK** →02:05:44Z | `20260702020544 0165_connect_incidents_rpcs` — permiso sembrado con `action='incident_admin'` SIN conflicto ni skip (fix C-1 verificado: C2.4=1) |
| Apply `0166` | **OK** →02:06:17Z | `20260702020617 0166_connect_incidents_knowledge` — fuente `enabled=false` (D5), 0 eventos |
| Checkpoints catálogo C1/C2/C6 | **PASS 18/18** | tabla+RLS+1 policy+2 enums+7 índices+realtime+0 grants de escritura; 5 RPCs+3 helpers+search_path 100%; adapter apagado |
| **⚠️ Fix in-window (declarado)** | `connect_incident_open` fallaba con **42702** (`conversation_id` ambiguo: PL/pgSQL sustituye OUT params en el target de `ON CONFLICT`) — detectado por el checkpoint funcional ANTES del deploy | Fix: `#variable_conflict use_column`; re-CREATE idéntico a 0165 corregida (misma firma, sin overload); archivo local 0165 actualizado y commiteado. **Observación**: 0152 (`connect_get_or_create_entity_conversation`, F3, en prod) comparte el patrón OUT-param+ON CONFLICT — revisar como follow-up |
| Checkpoint funcional C2-C5 (0-footprint, `__QA_ROLLBACK__`) | **PASS íntegro** | Alta (INC-format, 1er mensaje, fan-out ≥2 admins sin auto-notif) · asignación (notif+membresía) · resolve-only · máquina completa por asignado real (en_progreso↔en_espera, severidad) · no-admin NO fuerza cierre · resolver exige detalle · usuario sin permisos: open/steal/close DENEGADOS 3/3 · reapertura auditada (`prev_resolucion_len`, texto al hilo como system) y limpia resolución · terminal · claim de vacante OK y robo post-claim DENEGADO · `connect_post_message` OK · 1 sola firma · audit ≥8. Todo rollbackeado: footprint 0/0 |
| Regresiones C7 | **PASS** | mentions trigger, RPCs notif F4.1, search_profiles, guarda archivado intactos; outbox 34 pending SIN cambios (scheduler NO tocado); 0 overloads |
| Deploy DRAFT | **OK** | deploy `6a45c8ce9ea2f26c37ecb6a8`, draft URL `https://6a45c8ce9ea2f26c37ecb6a8--tops-ordenes.netlify.app`, build Node 22 sin ENOENT/PLUGIN_DIR |
| Smoke DRAFT | **PASS** | `/api/version=484a447`; login 200; 6 rutas connect + dashboard 307 fail-closed; `/api/today` 401; 0 5xx |
| Deploy PROD | **OK** 02:14→02:15Z | deploy **`6a45c96d220b1ec727fecf03`** → `https://nexus.logisticatops.com`. **Rollback point (no usado): `6a45a3bdd89a6fe23d1994ab` (`bef2f78`)** |
| Smoke PROD | **PASS** | `/api/version=484a447` production; 12/12 rutas OK (login 200, protegidas 307, api/today 401); **0 500/502; 0 PostgREST 300** |
| Smoke funcional autenticado | **PENDIENTE de Dirección** | Checklist de 20 puntos (mandato Etapa 8) = Validation Pack §5 + §C7 en vivo; sin credenciales en sesión asistida |

**Cumplimiento:** cero push/merge · migraciones SOLO 0164-0166 (0167 NO creada) · scheduler OPS F4.1 intacto · Knowledge drain intacto · sin WhatsApp/Email/Tareas/automatizaciones · RBAC_ENFORCE intacto · único cambio RBAC = `connect.incident_admin`.

**Cierre formal F4.2** = smoke funcional autenticado PASS por Dirección (o aceptación explícita).

---

# Parte I — Implementación LOCAL (histórico de la preparación)

> Fecha: 2026-07-02. Master Plan aprobado por Dirección con D1–D6 ratificadas
> (defaults). **Paquete 100% LOCAL: cero contacto de escritura con producción,
> cero deploy/push/merge; migraciones ENTREGADAS-NO-APLICADAS (G3).**
> Worktree `~/CODE/tops-ordenes-f42-incidents` · rama `feat/connect-f4-2-incidents-center`
> (base = `bef2f78` = prod; los commits previos sobre bef2f78 son 100% docs).

## 1. Decisiones D1–D6 aplicadas

| D | Aplicación | Ajuste técnico declarado |
|---|---|---|
| D1 | Migs `0164`/`0165`/`0166`; `0164` re-verificada libre (schema_migrations + worktrees + `git log --all`) antes de crear | El seed del permiso se movió de 0164→0165 por el hallazgo C-1 (misma numeración, ver §4) |
| D2 | TODAS las notificaciones críticas (apertura/asignación/estado/resolución/escalada) son INSERT síncronos dentro de las RPCs (patrón 0161). El outbox solo recibe el enqueue estándar de mensajes del hilo (inerte, deuda OPS intacta) | — |
| D3 | Permiso `connect.incident_admin` + grants a `admin`/`director_ops`. ÚNICO cambio RBAC. `RBAC_ENFORCE` intacto | `action='incident_admin'` (valor de enum nuevo) porque `('connect','admin')` está ocupado — C-1 |
| D4 | Máquina con reapertura AUDITADA (`connect.incident.reopen`) | "asignado" = atributo `asignado_a` (no estado); "reabierto" = transición `resuelto→en_progreso` (no estado) — previsto en el Master Plan §5.1 y avalado por el "salvo ajuste técnico del plan" de Dirección |
| D5 | Adapter Knowledge preparado y APAGADO (`knowledge_sources.enabled=false`); activación documentada en la propia 0166; Knowledge drain NO tocado | — |
| D6 | UI en `/connect/incidentes` (+`/nuevo`, +`/[incidentId]`), integrada al layout/gate/sidebar de Nexus Link; chat/canales/grupos/menciones/notificaciones intactos (solo adiciones: item de sidebar y caso `connect_incident` en `hrefFor`) | — |

## 2. Entregado

**Migraciones (entregadas-NO-aplicadas):**
- `0164_connect_incidents_schema.sql` — enums, tabla A2 + `public_id` INC-AAAA-NNNN,
  índices, RLS SELECT-only (escritura deny + revoke), realtime, valor de enum
  `incident_admin`.
- `0165_connect_incidents_rpcs.sql` — seed permiso+grants; helpers NULL-safe;
  `connect_incident_open/assign/set_status/set_severity/resolve` (SECDEF, P-1,
  FOR UPDATE, audit append-only, notifs síncronas acotadas).
- `0166_connect_incidents_knowledge.sql` — adapter opened/resolved APAGADO + backfill.
- `ROLLBACK_0164_0166.md`.

**Frontend (hexagonal, patrón canónico Connect):**
`domain/incident` (espejo UX de la máquina) · `ports/incident-port` ·
`adapters/supabase/incident-rpc.adapter` · `application/incident-use-cases` ·
`adapters/driving/incident-actions` · `read/incidents-data` (con `profiles_public`
y `hasIncidentAdmin()` fail-closed) · páginas lista/alta/detalle (detalle embebe
`ThreadView`: comentarios/fotos/menciones = motor existente) · chips ·
item sidebar · `hrefFor('connect_incident')` · seeds demo · 27 tests nuevos.

**Commits locales (SIN push/merge):**
| Commit | Contenido |
|---|---|
| `270fa73` | docs: Master Plan aprobado |
| `b5bac22` | feat: 0164 schema |
| `a407c73` | feat: 0165 RPCs + 0166 Knowledge |
| `f39a43d` | feat: UI Centro de Incidentes |
| `93620b6` | fix: hardening por revisión adversarial |
| (final) | docs: validation package (este log + pack + rollback) |

## 3. QA (final, tras fixes)

| Check | Resultado |
|---|---|
| `tsc --noEmit` | 0 errores |
| `next lint` | 0 errores, 0 warnings nuevos (persisten los 5 `alt-text` PDF pre-existentes) |
| `vitest run` | **437/437 PASS** (base F4.1 = 410; +27 de incidentes) |
| `next build` | Compiled successfully; rutas `/connect/incidentes{,/nuevo,/[incidentId]}` generadas |
| Preview demo (mock, sin prod) | Lista con orden crítica-primero y filtros; detalle con acciones coherentes por rol y hilo embebido; alta; 0 errores de consola. Verificado fix I-1 en vivo (sin "Asignarme" en incidente asignado; sí en vacante) |

## 4. Revisión adversarial (2 revisores independientes: SQL/seguridad y frontend)

### Clasificación y disposición

| # | Hallazgo | Clase | Disposición |
|---|---|---|---|
| SQL C-1 | INSERT del permiso violaba `UNIQUE(module,action)` de `permissions` (('connect','admin') ocupado por 0146) → 0164 abortaba en prod. **Verificado contra prod read-only** (constraint existe; `connect.admin` presente; precedente: `rrhh.documentacion.view` de 0070 NUNCA se insertó por el `on conflict do nothing` silencioso) | **Bloqueante** | **CORREGIDO** — 0164 agrega `alter type permission_action_t add value if not exists 'incident_admin'`; el seed (action=`incident_admin`) + grants van en 0165 (tx separada, regla enum-nuevo) |
| SQL I-1 / FE I-3 | Auto-asignación permitía "robar" incidentes ya asignados (y con eso hilo + resolve + close sin ser admin) | **Alto** | **CORREGIDO** — claim solo si `asignado_a is null` (RPC + dominio + tests + verificación en preview) |
| SQL I-2 | `has_permission()` puede devolver NULL (usuario sin fila en `profiles`) → `if not NULL` no levanta → guards fail-open (violación P-1) | **Alto** | **CORREGIDO** — helper `_connect_incident_is_admin()` con `coalesce(...,false)` + coalesce en `connect.create`; RLS con coalesce explícito |
| SQL I-3 / FE C-1 | Tres definiciones de "admin de incidentes": el fan-out (RBAC formal) notificaba a gente que la RLS (solo `is_admin()`) no dejaba ver; con RBAC dormido el fan-out era VACÍO (nadie se enteraba de aperturas) | **Alto** | **CORREGIDO** — RLS SELECT incluye `has_permission('connect.incident_admin')`; fan-out = tenedores RBAC UNION admins legacy (`profiles.role='admin'`) |
| SQL I-4 | `prev_resolucion` (texto libre) en payload de `audit_log`, legible por rol `supervisor` | **Alto** | **CORREGIDO** — la resolución anterior se preserva como mensaje `system` en el hilo (frontera de miembros); a audit va solo `prev_resolucion_len` |
| FE I-1 | `withNames` leía `profiles` (lockdown 0040) → nombres nunca resolvían para no-admins | **Alto** | **CORREGIDO** — `profiles_public` (patrón DEFECT-2) |
| FE I-2 | `isIncidentAdmin` vía `canAccess` fail-open (RBAC dormido) → botonera admin para casi todos, RPC rechazando cada click | **Alto** | **CORREGIDO** — `hasIncidentAdmin()` fail-closed vía RPC `has_permission` |
| FE I-4 | Orden en memoria + `limit 200` por `created_at desc` recortaba justo las críticas más antiguas | **Alto** | **CORREGIDO** — orden de negocio en SQL (`severidad desc, created_at asc`) antes del límite |
| SQL M-1 | `lpad` trunca en `INC-…-10000` → colisión determinística de `public_id` | Medio | **CORREGIDO** (`greatest(4, length)`) |
| SQL M-3 | Notifs duplicadas si reportante = asignado | Medio | **CORREGIDO** (guard `is distinct from`) |
| FE M-1 | Comodines `%`/`_` sin escapar en filtro sector | Medio | **CORREGIDO** (escape) |
| FE M-2/M-3 | Zod: uuid laxo en assign; título 200 vs 160 | Medio | **CORREGIDO** |
| FE M-4 | `busy` quedaba pegado si la server action lanzaba | Medio | **CORREGIDO** (`try/finally`) |
| SQL M-2 | `connect_incident_open` sin clave de idempotencia (doble-click/retry de red = 2 incidentes) | Bajo | **DOCUMENTADO** — la UI bloquea doble-submit (`busy`); follow-up: `p_client_ref` |
| SQL M-4 | `FOR UPDATE` antes del guard + oráculo existencia/permiso | Bajo | **ACEPTADO** documentado (impacto real mínimo) |
| SQL M-5 | El reportante (owner del hilo) puede archivar el hilo o remover al asignado (moderación 0144/0151) → asignado ciego con incidente abierto | Bajo | **DOCUMENTADO** — follow-up F4.2.x/F4.3: guardas de moderación para `kind='incident'` no cerrado (toca RPCs F3, fuera de alcance autorizado) |
| FE M-5 | Seeds demo: inc-2/inc-3 sin conversación mock (detalle demo muestra "hilo no disponible") | Bajo | **ACEPTADO** (solo demo; inc-1 tiene hilo completo) |
| FE M-6 | Filtro `asignado` presente en read pero sin UI ("Míos") | Bajo | **DOCUMENTADO** — cablearlo en piloto si se pide |
| FE M-7 | El buscador de asignados devuelve internos que el RPC luego rechaza por `profiles.role` no elegible | Bajo | **DOCUMENTADO** — error claro post-click; alinear criterios en follow-up |
| SQL obs. | 0161 (F4.1, en prod) comparte el patrón `has_permission` sin coalesce | Fuera de alcance | Registrado como observación para hardening futuro (NO tocado: prod) |

**Falsos positivos:** ninguno relevante. **Resultado final: 0 Bloqueantes / 0 Altos abiertos.**
Categorías verificadas limpias por los revisores: sintaxis/ambigüedad plpgsql, idempotencia
(post-fix), grants/revokes, compatibilidad 0142–0163 (cero objetos redefinidos), ruteo de
notificaciones front↔SQL, props de ThreadView, rollback (validado por el revisor SQL).

## 5. Riesgos remanentes

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Doble-submit de red crea incidente duplicado (SQL M-2) | UI bloquea doble-click; monitorear en piloto; follow-up `p_client_ref` |
| R2 | Sabotaje por moderación del hilo (SQL M-5) | Piloto interno acotado; follow-up guardas para `kind='incident'` |
| R3 | Sin coalescing de notifs de estado (toggling en_progreso↔en_espera genera 2 notifs por ciclo) | Eventos humanos de baja frecuencia; medir fatiga en piloto (criterio D-F41-2 si hace falta) |
| R4 | `alter type add value` de 0164 es irreversible (valor queda si se rollbackea) | Residuo inofensivo documentado en ROLLBACK |
| R5 | Asignables limitados a `profiles.role in (admin,operaciones,supervisor)` (criterio 0162/0158) | Consistente con F4.1; revisar si el piloto necesita otros roles |
| R6 | Deploy: riesgo DEPLOY-1 de siempre | Procedimiento validado obligatorio (Node 22.23.1, NO-worktree, draft-first) |

## 6. Smoke plan y GO/NO-GO de ventana

Ver `F4-2-INCIDENTS-CENTER-VALIDATION-PACK.md` (checkpoints C1–C7 de catálogo,
funcional 0-footprint, anti-forja, notificaciones en vivo, smoke UI, criterio
GO/NO-GO y relación con `ROLLBACK_0164_0166.md`).

## 7. Recomendación

**GO** para solicitar a Dirección la ventana única de apply (`0164`→`0165`→`0166`,
cada archivo un batch) + deploy draft-first + smoke + piloto por sector, con el
Validation Pack como guion. El paquete está completo, revisado adversarialmente
(bloqueante y altos corregidos y re-verificados), con QA verde y rollback listo.

## 8. Confirmaciones de cumplimiento

- Producción NO modificada (todas las consultas a prod fueron SELECT read-only de verificación).
- CERO push / merge / deploy / apply de migraciones.
- Scheduler OPS F4.1 NO tocado (finding sigue ABIERTO tal como lo dejó Dirección).
- WhatsApp / Email / Tareas F4.3 / automatizaciones externas NO implementadas.
- `RBAC_ENFORCE` NO activado; único cambio RBAC = permiso `connect.incident_admin` (D3).
- package.json / package-lock.json sin cambios; sin secretos en el repo.
